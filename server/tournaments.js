// Arena-Turniere: feste Startzeiten, ständige Paarungen, Punkte mit Siegesserien-Bonus, Preise für die Top 3.
import crypto from 'node:crypto';
import { ARENA_SCHEDULE, ARENA_PRIZES, TIME_CONTROLS, CUSTOM_TOURNEY } from '../shared/catalog.js';
import * as db from './db.js';
import { track } from './events.js';

const PAIR_COOLDOWN = 6000;      // kurze Pause zwischen zwei Partien (Ergebnis ansehen)
const NO_PAIR_BEFORE_END = 30_000; // kurz vor Schluss keine neuen Paarungen
const FINALIZE_GRACE = 4 * 60_000; // so lange warten wir auf laufende Partien

let hooks = null;               // { startGame, isOnline, inGame, sendUser, sendWs }
const tournaments = new Map();  // id -> tournament
const watchers = new Map();     // id -> Set<ws>

export function initTournaments(h) {
  hooks = h;
  restoreCustom();
  schedule();
  setInterval(tick, 2000).unref();
}

// ---------- Planung ----------
function slotStart(t) {
  const d = new Date(t);
  d.setUTCSeconds(0, 0);
  return d;
}

let demoCreated = false;
function schedule() {
  const now = Date.now();
  // Nur für Tests/Entwicklung: sofort eine kurze Arena anlegen (ARENA_DEMO_MINUTES=3)
  const demo = Number(process.env.ARENA_DEMO_MINUTES || 0);
  if (demo && !demoCreated) {
    demoCreated = true;
    const id = 'demo' + crypto.randomBytes(3).toString('hex');
    tournaments.set(id, {
      id, key: 'demo', name: 'Test-Arena', tc: '3+0', type: 'blitz', startsAt: now + 10_000, endsAt: now + 10_000 + demo * 60_000,
      status: 'upcoming', players: new Map(), games: new Set(), podium: null, finishedAt: null,
    });
  }
  // Die nächsten Startzeiten der kommenden 2 Stunden anlegen
  const base = slotStart(now);
  base.setUTCMinutes(0);
  for (let h = 0; h < 3; h++) {
    for (const s of ARENA_SCHEDULE) {
      const start = new Date(base.getTime() + h * 3600_000);
      start.setUTCMinutes(s.minute);
      const startsAt = start.getTime();
      const endsAt = startsAt + s.duration * 60_000;
      if (endsAt < now) continue;
      const key = `${s.tc}@${startsAt}`;
      if ([...tournaments.values()].some((t) => t.key === key)) continue;
      if (startsAt - now > 2 * 3600_000) continue;
      const id = crypto.randomBytes(5).toString('hex');
      tournaments.set(id, {
        id, key, name: s.name, tc: s.tc, type: TIME_CONTROLS[s.tc].type,
        startsAt, endsAt, status: startsAt <= now ? 'running' : 'upcoming',
        players: new Map(), games: new Set(), podium: null, finishedAt: null,
      });
    }
  }
}

function player(t, userId) {
  let p = t.players.get(userId);
  if (!p) {
    const u = db.getUser(userId);
    p = { id: userId, name: u.name, elo: u.ratings[t.type].elo, score: 0, streak: 0, games: 0, wins: 0, results: [], paused: false, inGame: false, lastEnd: 0, lastOpp: null, lastColor: null, joinedAt: Date.now() };
    t.players.set(userId, p);
  }
  return p;
}

// ---------- Ablauf ----------
function tick() {
  const now = Date.now();
  schedule();
  for (const t of tournaments.values()) {
    if (t.status === 'upcoming' && now >= t.startsAt) { t.status = 'running'; broadcast(t, true); }
    if (t.status === 'running') {
      if (now >= t.endsAt) { t.status = 'ending'; broadcast(t, true); }
      else pair(t, now);
    }
    if (t.status === 'ending' && (t.games.size === 0 || now > t.endsAt + FINALIZE_GRACE)) finalize(t);
    // Alte beendete Turniere aufräumen
    if (t.status === 'finished' && now - t.finishedAt > 30 * 60_000) { tournaments.delete(t.id); watchers.delete(t.id); }
  }
  for (const t of tournaments.values()) if (t.status === 'running' || t.status === 'upcoming') broadcast(t);
}

function pair(t, now) {
  if (t.endsAt - now < NO_PAIR_BEFORE_END) return;
  const ready = [...t.players.values()].filter((p) => !p.paused && !p.inGame && now - p.lastEnd > PAIR_COOLDOWN
    && hooks.isOnline(p.id) && !hooks.inGame(p.id));
  if (ready.length < 2) return;
  ready.sort((a, b) => b.score - a.score || b.elo - a.elo);
  while (ready.length >= 2) {
    const a = ready.shift();
    // Nicht direkt wieder denselben Gegner, wenn es Alternativen gibt
    let j = ready.findIndex((p) => p.id !== a.lastOpp);
    if (j < 0) j = 0;
    const b = ready.splice(j, 1)[0];
    // Farben abwechseln
    const aWhite = a.lastColor === 'w' ? false : b.lastColor === 'w' ? true : Math.random() < 0.5;
    const [w, bl] = aWhite ? [a, b] : [b, a];
    const g = hooks.startGame(db.getUser(w.id), db.getUser(bl.id), t.tc, t.rated !== false, { tournamentId: t.id, tournamentName: t.name });
    if (!g) continue;
    t.games.add(g.id);
    for (const [p, color, opp] of [[w, 'w', bl], [bl, 'b', w]]) { p.inGame = g.id; p.lastColor = color; p.lastOpp = opp.id; }
  }
}

// Wird von online.js nach jeder Turnierpartie aufgerufen
export function onTournamentGameEnd(g, result, white, black) {
  const t = tournaments.get(g.tournamentId);
  if (!t) return null;
  t.games.delete(g.id);
  const out = {};
  for (const [u, color] of [[white, 'w'], [black, 'b']]) {
    const p = t.players.get(u.id);
    if (!p) continue;
    p.inGame = false;
    p.lastEnd = Date.now();
    p.elo = u.ratings[t.type].elo;
    if (result === 'aborted') {
      // Wer nicht gezogen hat, wird pausiert (sonst würde er immer wieder gepaart)
      const plies = g.chess.history().length;
      if ((plies === 0 && color === 'w') || (plies === 1 && color === 'b')) p.paused = true;
      p.results.push('–');
      continue;
    }
    const fire = p.streak >= 2;
    let pts = 0;
    if (result === color) { pts = 2; p.streak += 1; p.wins += 1; }
    else if (result === 'draw') { pts = 1; p.streak = 0; }
    else p.streak = 0;
    if (fire) pts *= 2;
    p.score += pts;
    p.games += 1;
    p.results.push(fire && pts ? `${pts}🔥` : String(pts));
    out[color] = { pts, fire, score: p.score, rank: rankOf(t, u.id) };
  }
  broadcast(t, true);
  return out;
}

function standings(t) {
  return [...t.players.values()].sort((a, b) => b.score - a.score || b.wins - a.wins || b.elo - a.elo);
}
function rankOf(t, id) { return standings(t).findIndex((p) => p.id === id) + 1; }

function finalize(t) {
  t.status = 'finished';
  t.finishedAt = Date.now();
  const list = standings(t).filter((p) => p.games > 0);
  t.podium = list.slice(0, 3).map((p) => ({ id: p.id, name: p.name, score: p.score }));
  let paidOut = 0;
  list.forEach((p, i) => {
    const u = db.getUser(p.id);
    if (!u) return;
    let prize;
    if (t.custom) {
      // Eigenes Turnier: Preistopf des Veranstalters (50/30/20), nur an Spieler mit Punkten
      prize = p.score > 0 ? Math.floor((t.prizePool || 0) * (CUSTOM_TOURNEY.shares[i] || 0)) : 0;
      paidOut += prize;
    } else {
      // Preisgeld nur mit Punkten; kleine Turniere (unter 4 Spielern) zahlen die Hälfte – gegen Münz-Farming
      prize = p.score > 0 ? ARENA_PRIZES[i] || 0 : 0;
      if (list.length < 4) prize = Math.floor(prize / 2);
    }
    const xp = t.custom ? 15 : 30;
    u.coins += prize;
    u.pass.xp += xp;
    track(u, 'tournament', { place: i + 1, games: p.games, players: list.length });
    hooks.sendUser(p.id, { type: 'tournament_result', id: t.id, name: t.name, place: i + 1, players: list.length, score: p.score, coins: prize, xp });
  });
  if (t.custom) {
    // Nicht verteilte Münzen gehen an den Veranstalter zurück
    const rest = (t.prizePool || 0) - paidOut;
    const creator = db.getUser(t.creatorId);
    if (creator && rest > 0) {
      creator.coins += rest;
      hooks.sendUser(creator.id, { type: 'toast', message: `🏟️ ${t.name}: ${rest} nicht vergebene Münzen zurück an dich` });
    }
    db.deleteCustomTournament(t.id);
  }
  db.recordTournament({ id: t.id, name: t.name, tc: t.tc, startsAt: t.startsAt, endsAt: t.endsAt, players: list.length, podium: t.podium, custom: !!t.custom, creatorName: t.creatorName || null, private: !!t.private });
  broadcast(t, true);
}

// ---------- Nachrichten ----------
function publicState(t, userId) {
  const list = standings(t);
  const me = t.players.get(userId);
  return {
    id: t.id, name: t.name, tc: t.tc, type: t.type, status: t.status, startsAt: t.startsAt, endsAt: t.endsAt,
    now: Date.now(), playerCount: t.players.size, podium: t.podium, ...customInfo(t, userId),
    standings: list.slice(0, 50).map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, elo: p.elo, score: p.score, fire: p.streak >= 2, games: p.games, results: p.results.slice(-12), playing: !!p.inGame, paused: p.paused })),
    me: me ? { joined: true, paused: me.paused, score: me.score, rank: list.indexOf(me) + 1, playing: !!me.inGame, fire: me.streak >= 2 } : { joined: false },
  };
}

function customInfo(t, userId) {
  if (!t.custom) return { custom: false, rated: true };
  const insider = userId === t.creatorId || t.players.has(userId);
  return {
    custom: true, rated: t.rated !== false, private: !!t.private, prizePool: t.prizePool || 0,
    creatorId: t.creatorId, creatorName: t.creatorName, description: t.description || '',
    code: t.private ? (insider ? t.code : null) : t.code,
  };
}

const lastBroadcast = new Map();
function broadcast(t, force = false) {
  const now = Date.now();
  if (!force && now - (lastBroadcast.get(t.id) || 0) < 3000) return;
  lastBroadcast.set(t.id, now);
  if (force && t.custom && t.status !== 'finished') persist(t);
  for (const p of t.players.values()) hooks.sendUser(p.id, { type: 'tournament', t: publicState(t, p.id) });
  for (const ws of watchers.get(t.id) || []) if (ws.userId && !t.players.has(ws.userId)) hooks.sendWs(ws, { type: 'tournament', t: publicState(t, ws.userId) });
}

export function listTournaments(userId) {
  schedule();
  const recent = db.recentTournaments(5);
  return {
    current: [...tournaments.values()].filter((t) => t.status !== 'finished' && visibleTo(t, userId)).sort((a, b) => a.startsAt - b.startsAt).map((t) => ({
      id: t.id, name: t.name, tc: t.tc, status: t.status, startsAt: t.startsAt, endsAt: t.endsAt, players: t.players.size,
      joined: t.players.has(userId) && !t.players.get(userId).paused,
      custom: !!t.custom, private: !!t.private, rated: t.rated !== false, prizePool: t.prizePool || 0, creatorName: t.creatorName || null,
      mine: t.creatorId === userId,
    })),
    finished: [
      ...[...tournaments.values()].filter((t) => t.status === 'finished' && visibleTo(t, userId)).map((t) => ({ id: t.id, name: t.name, tc: t.tc, endsAt: t.endsAt, players: t.players.size, podium: t.podium, custom: !!t.custom })),
      ...recent.filter((r) => !tournaments.has(r.id) && !r.private),
    ].slice(0, 6),
    now: Date.now(),
  };
}

export function onTournamentMessage(user, ws, msg) {
  const t = tournaments.get(msg.id);
  switch (msg.type) {
    case 'tournaments':
      hooks.sendWs(ws, { type: 'tournaments', ...listTournaments(user.id) });
      return true;
    case 'tournament_watch': {
      for (const set of watchers.values()) set.delete(ws);
      if (!t) { hooks.sendWs(ws, { type: 'error', message: 'Turnier nicht gefunden' }); return true; }
      ws.userId = user.id;
      if (!watchers.has(t.id)) watchers.set(t.id, new Set());
      watchers.get(t.id).add(ws);
      hooks.sendWs(ws, { type: 'tournament', t: publicState(t, user.id) });
      return true;
    }
    case 'tournament_join': {
      if (!t || t.status === 'finished' || t.status === 'ending') { hooks.sendWs(ws, { type: 'error', message: 'Turnier ist vorbei' }); return true; }
      // Nur in einem Turnier gleichzeitig
      for (const other of tournaments.values()) {
        const p = other.players.get(user.id);
        if (other !== t && p && (other.status === 'running' || other.status === 'upcoming')) p.paused = true;
      }
      const p = player(t, user.id);
      p.paused = false;
      broadcast(t, true);
      return true;
    }
    case 'tournament_create': {
      try {
        const nt = createCustom(user, msg);
        hooks.sendWs(ws, { type: 'tournament_created', id: nt.id, code: nt.code });
        hooks.sendUser(user.id, { type: 'user_update' });
        broadcast(nt, true);
      } catch (e) { hooks.sendWs(ws, { type: 'error', message: e.message }); }
      return true;
    }
    case 'tournament_cancel': {
      try { cancelCustom(user, t); hooks.sendWs(ws, { type: 'tournament_cancelled', id: msg.id }); hooks.sendUser(user.id, { type: 'user_update' }); }
      catch (e) { hooks.sendWs(ws, { type: 'error', message: e.message }); }
      return true;
    }
    case 'tournament_code': {
      const code = String(msg.code || '').trim().toUpperCase();
      const found = [...tournaments.values()].find((x) => x.code === code && x.status !== 'finished');
      if (!found) { hooks.sendWs(ws, { type: 'error', message: 'Kein laufendes Turnier mit diesem Code' }); return true; }
      hooks.sendWs(ws, { type: 'tournament_found', id: found.id });
      return true;
    }
    case 'tournament_pause': {
      const p = t?.players.get(user.id);
      if (p) { p.paused = true; broadcast(t, true); }
      return true;
    }
  }
  return false;
}

// ---------- Eigene Turniere ----------
class TourneyError extends Error {}

function visibleTo(t, userId) {
  return !t.private || t.creatorId === userId || t.players.has(userId);
}

function serialize(t) {
  return {
    id: t.id, name: t.name, tc: t.tc, type: t.type, startsAt: t.startsAt, endsAt: t.endsAt, custom: true,
    creatorId: t.creatorId, creatorName: t.creatorName, rated: t.rated, private: t.private, code: t.code,
    prizePool: t.prizePool, description: t.description,
    players: [...t.players.values()].map(({ inGame, lastEnd, ...rest }) => rest),
  };
}
function persist(t) { if (t.custom) db.saveCustomTournament(serialize(t)); }

function restoreCustom() {
  for (const d of db.customTournaments()) {
    if (tournaments.has(d.id)) continue;
    const players = new Map(d.players.map((p) => [p.id, { ...p, inGame: false, lastEnd: 0 }]));
    const now = Date.now();
    const status = now < d.startsAt ? 'upcoming' : now < d.endsAt ? 'running' : 'ending';
    tournaments.set(d.id, { ...d, players, games: new Set(), status, podium: null, finishedAt: null });
  }
}

function newCode() {
  for (;;) {
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    if (![...tournaments.values()].some((t) => t.code === code)) return code;
  }
}

export function createCustom(user, o) {
  const C = CUSTOM_TOURNEY;
  const name = String(o.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
  if (name.length < 3) throw new TourneyError('Name: mindestens 3 Zeichen');
  if (!TIME_CONTROLS[o.tc]) throw new TourneyError('Unbekannte Bedenkzeit');
  const duration = Number(o.duration);
  if (!C.durations.includes(duration)) throw new TourneyError('Ungültige Dauer');
  const startIn = Number(o.startIn);
  if (!C.startIns.includes(startIn)) throw new TourneyError('Ungültige Startzeit');
  const pool = Math.floor(Number(o.prizePool) || 0);
  if (pool < 0 || pool > C.maxPool) throw new TourneyError(`Preistopf: 0 bis ${C.maxPool} Münzen`);
  if (pool > user.coins) throw new TourneyError('Nicht genug Münzen für den Preistopf');
  const active = [...tournaments.values()].filter((t) => t.custom && t.status !== 'finished');
  if (active.some((t) => t.creatorId === user.id)) throw new TourneyError('Du hast schon ein offenes Turnier – warte, bis es vorbei ist, oder sag es ab');
  if (active.length >= C.maxActive) throw new TourneyError('Gerade laufen zu viele eigene Turniere – versuch es später');
  const now = Date.now();
  const startsAt = now + startIn * 60_000;
  const t = {
    id: 'c' + crypto.randomBytes(5).toString('hex'), key: null, name, tc: o.tc, type: TIME_CONTROLS[o.tc].type,
    startsAt, endsAt: startsAt + duration * 60_000, status: 'upcoming',
    players: new Map(), games: new Set(), podium: null, finishedAt: null,
    custom: true, creatorId: user.id, creatorName: user.name, rated: o.rated !== false, private: !!o.private,
    code: newCode(), prizePool: pool, description: String(o.description || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 140),
  };
  user.coins -= pool;
  tournaments.set(t.id, t);
  if (o.join !== false) player(t, user.id);
  persist(t);
  db.save();
  return t;
}

export function cancelCustom(user, t) {
  if (!t || !t.custom) throw new TourneyError('Turnier nicht gefunden');
  if (t.creatorId !== user.id) throw new TourneyError('Nur der Veranstalter kann absagen');
  if (t.status !== 'upcoming') throw new TourneyError('Das Turnier läuft schon');
  user.coins += t.prizePool || 0;
  tournaments.delete(t.id);
  db.deleteCustomTournament(t.id);
  for (const p of t.players.values()) if (p.id !== user.id) hooks.sendUser(p.id, { type: 'toast', message: `🏟️ „${t.name}“ wurde abgesagt` });
  for (const ws of watchers.get(t.id) || []) hooks.sendWs(ws, { type: 'tournament_cancelled', id: t.id });
  watchers.delete(t.id);
  db.save();
}

// Namensänderung in laufenden Turnieren übernehmen
export function renamePlayer(userId, name) {
  for (const t of tournaments.values()) {
    const p = t.players.get(userId);
    if (p) p.name = name;
    if (t.creatorId === userId) t.creatorName = name;
    for (const q of t.podium || []) if (q.id === userId) q.name = name;
    if (t.custom && t.status !== 'finished') persist(t);
  }
}

export function unwatchTournaments(ws) {
  for (const set of watchers.values()) set.delete(ws);
}

// Für Tests
export function _tournaments() { return tournaments; }
export function _tick() { tick(); }
