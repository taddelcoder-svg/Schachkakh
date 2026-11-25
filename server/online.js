// Online-Spiel: WebSocket-Verbindungen, Matchmaking, Räume, Herausforderungen, Zuschauen,
// serverseitige Uhren für 2-Spieler-Schach und 4-Spieler-Schach (mit Bots).
import crypto from 'node:crypto';
import { Chess } from 'chess.js';
import { WebSocketServer } from 'ws';
import * as db from './db.js';
import { applyElo, applyMultiElo, applyRewards } from './progress.js';
import { TIME_CONTROLS } from '../shared/catalog.js';
import { FourChess, COLORS as FP_COLORS, COLOR_NAMES, botMove } from '../shared/fourchess.js';

export { TIME_CONTROLS };
export const FP_TIME_CONTROLS = {
  '3+2': { base: 180_000, inc: 2_000 },
  '5+5': { base: 300_000, inc: 5_000 },
  '1+10': { base: 60_000, inc: 10_000 },
};

const FIRST_MOVE_TIMEOUT = 30_000;
const RECONNECT_GRACE = 30_000;
const FP_BOT_FILL_AFTER = 15_000;
const BOT_NAMES = ['Bot Bauer', 'Bot Springer', 'Bot Läufer', 'Bot Turm', 'Bot Dame', 'Bot Rochade', 'Bot Gambit'];

const sockets = new Map();    // userId -> Set<ws>
const queue = new Map();      // userId -> { tc, joinedAt, elo }
const fpQueue = new Map();    // userId -> { tc, joinedAt }
const rooms = new Map();      // code -> { kind, hostId, tc, members: [userId] }
const games = new Map();      // gameId -> game (2P oder 4P)
const userGame = new Map();   // userId -> gameId
const challenges = new Map(); // id -> { from, to, tc, rated, created }

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function sendUser(userId, msg) { for (const ws of sockets.get(userId) || []) send(ws, msg); }
function sendWatchers(g, msg) { for (const ws of g.spectators) send(ws, msg); }

export function isOnline(userId) { return sockets.has(userId); }
export function statusOf(userId) {
  if (!sockets.has(userId)) return 'offline';
  return userGame.has(userId) ? 'playing' : 'online';
}
export function onlineCount() { return sockets.size; }
export function currentGameOf(userId) { return userGame.get(userId) || null; }

function ratingType(tc) { return TIME_CONTROLS[tc]?.type || 'blitz'; }
function playerInfo(u, type) {
  return { id: u.id, name: u.name, elo: u.ratings[type].elo, board: u.equipped.board, pieces: u.equipped.pieces };
}

// =====================================================================
// 2-Spieler-Schach
// =====================================================================
function clocksNow(g) {
  const c = { w: g.clock.w, b: g.clock.b };
  if (g.clock.running && !g.over) c[g.chess.turn()] -= Date.now() - g.clock.lastTick;
  return c;
}

function scheduleFlag(g) {
  clearTimeout(g.flagTimer);
  if (g.over) return;
  if (!g.clock.running) {
    g.flagTimer = setTimeout(() => endGame(g, 'aborted', 'Kein Zug innerhalb von 30 Sekunden'), FIRST_MOVE_TIMEOUT);
    return;
  }
  const remaining = clocksNow(g)[g.chess.turn()];
  g.flagTimer = setTimeout(() => onFlag(g), Math.max(0, remaining) + 50);
}

function hasMatingMaterial(chess, color) {
  const pieces = chess.board().flat().filter((p) => p && p.color === color && p.type !== 'k');
  if (pieces.length === 0) return false;
  if (pieces.length === 1 && (pieces[0].type === 'n' || pieces[0].type === 'b')) return false;
  return true;
}

function onFlag(g) {
  if (g.over) return;
  const loser = g.chess.turn();
  const winner = loser === 'w' ? 'b' : 'w';
  if (!hasMatingMaterial(g.chess, winner)) endGame(g, 'draw', 'Zeit abgelaufen, aber kein Mattmaterial');
  else endGame(g, winner, 'Zeit abgelaufen');
}

function startGame(userA, userB, tc, ranked, colors = null) {
  const [white, black] = colors || (Math.random() < 0.5 ? [userA, userB] : [userB, userA]);
  const t = TIME_CONTROLS[tc];
  const g = {
    id: crypto.randomUUID(), kind: '2p',
    tc, ranked, type: t.type,
    white: white.id, black: black.id,
    chess: new Chess(),
    clock: { w: t.base, b: t.base, inc: t.inc, running: false, lastTick: Date.now() },
    drawOffer: null, rematch: new Set(), takeback: null,
    over: false, startedAt: Date.now(),
    disconnectTimers: {}, spectators: new Set(),
  };
  g.chess.header('White', white.name, 'Black', black.name, 'Event', ranked ? 'Schachkakh gewertet' : 'Schachkakh',
    'Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'), 'TimeControl', tc);
  games.set(g.id, g);
  for (const u of [white, black]) {
    userGame.set(u.id, g.id);
    queue.delete(u.id); fpQueue.delete(u.id);
    removeRoomsOf(u.id);
  }
  for (const u of [white, black]) sendUser(u.id, gameStateMsg(g, u.id));
  scheduleFlag(g);
  return g;
}

function gameStateMsg(g, userId) {
  const w = db.getUser(g.white);
  const b = db.getUser(g.black);
  return {
    type: 'game_start', gameId: g.id,
    color: userId === g.white ? 'w' : userId === g.black ? 'b' : null,
    spectator: userId !== g.white && userId !== g.black,
    white: playerInfo(w, g.type), black: playerInfo(b, g.type),
    tc: g.tc, ranked: g.ranked, ratingType: g.type,
    pgn: g.chess.pgn(), fen: g.chess.fen(),
    clocks: clocksNow(g), clockRunning: g.clock.running, over: g.over,
  };
}

function endGame(g, result, reason) {
  if (g.over) return;
  g.over = true;
  clearTimeout(g.flagTimer);
  for (const t of Object.values(g.disconnectTimers)) clearTimeout(t);
  const white = db.getUser(g.white);
  const black = db.getUser(g.black);

  let elo = null;
  const rewards = {};
  if (result !== 'aborted') {
    const scoreWhite = result === 'w' ? 1 : result === 'b' ? 0 : 0.5;
    g.chess.header('Result', scoreWhite === 1 ? '1-0' : scoreWhite === 0 ? '0-1' : '1/2-1/2');
    if (g.ranked) elo = applyElo(white, black, scoreWhite, g.type);
    const mode = g.ranked ? 'ranked' : 'casual';
    rewards.w = applyRewards(white, scoreWhite === 1 ? 'win' : scoreWhite === 0 ? 'loss' : 'draw', mode);
    rewards.b = applyRewards(black, scoreWhite === 0 ? 'win' : scoreWhite === 1 ? 'loss' : 'draw', mode);
    db.recordGame({
      id: g.id, kind: '2p', ranked: g.ranked, tc: g.tc, type: g.type, endedAt: Date.now(),
      white: { id: white.id, name: white.name, elo: white.ratings[g.type].elo },
      black: { id: black.id, name: black.name, elo: black.ratings[g.type].elo },
      result, reason, pgn: g.chess.pgn(), elo,
    });
  }

  for (const [color, user] of [['w', white], ['b', black]]) {
    sendUser(user.id, {
      type: 'game_over', gameId: g.id, result, reason,
      eloChange: elo ? elo[color === 'w' ? 'white' : 'black'] : null,
      newElo: user.ratings[g.type].elo,
      rewards: rewards[color] || null,
      user: db.publicUser(user),
    });
    userGame.delete(user.id);
  }
  sendWatchers(g, { type: 'game_over', gameId: g.id, result, reason, spectator: true });
  setTimeout(() => games.delete(g.id), 120_000);
}

function handleMove(user, g, { from, to, promotion }) {
  if (g.over) return;
  const color = user.id === g.white ? 'w' : 'b';
  if (g.chess.turn() !== color) return sendUser(user.id, { type: 'error', message: 'Du bist nicht am Zug', resync: true });

  const now = Date.now();
  if (g.clock.running) {
    g.clock[color] -= now - g.clock.lastTick;
    if (g.clock[color] <= 0) return onFlag(g);
  }
  let move;
  try {
    move = g.chess.move({ from, to, promotion: promotion || 'q' });
  } catch {
    return sendUser(user.id, { ...gameStateMsg(g, user.id), type: 'resync', message: 'Ungültiger Zug' });
  }
  if (g.clock.running) g.clock[color] += g.clock.inc;
  if (!g.clock.running && g.chess.history().length >= 2) g.clock.running = true;
  g.clock.lastTick = now;
  g.drawOffer = null;
  g.takeback = null;

  const msg = {
    type: 'move', gameId: g.id, san: move.san, from: move.from, to: move.to,
    fen: g.chess.fen(), clocks: clocksNow(g), clockRunning: g.clock.running,
  };
  sendUser(g.white, msg);
  sendUser(g.black, msg);
  sendWatchers(g, msg);

  const c = g.chess;
  if (c.isCheckmate()) endGame(g, color, 'Schachmatt');
  else if (c.isStalemate()) endGame(g, 'draw', 'Patt');
  else if (c.isInsufficientMaterial()) endGame(g, 'draw', 'Ungenügendes Material');
  else if (c.isThreefoldRepetition()) endGame(g, 'draw', 'Dreifache Stellungswiederholung');
  else if (c.isDraw()) endGame(g, 'draw', '50-Züge-Regel');
  else scheduleFlag(g);
}

function on2pMessage(user, g, msg) {
  const color = user.id === g.white ? 'w' : 'b';
  const opp = color === 'w' ? g.black : g.white;
  switch (msg.type) {
    case 'move': if (g.id === msg.gameId) handleMove(user, g, msg); break;
    case 'resign':
      if (!g.over) {
        if (g.chess.history().length < 2) endGame(g, 'aborted', 'Partie abgebrochen');
        else endGame(g, color === 'w' ? 'b' : 'w', 'Aufgabe');
      }
      break;
    case 'offer_draw':
      if (g.over) break;
      if (g.drawOffer && g.drawOffer !== color) endGame(g, 'draw', 'Remis vereinbart');
      else { g.drawOffer = color; sendUser(opp, { type: 'draw_offered' }); }
      break;
    case 'decline_draw':
      if (g.drawOffer && g.drawOffer !== color) { g.drawOffer = null; sendUser(opp, { type: 'draw_declined' }); }
      break;
    case 'takeback_request':
      if (g.over || g.chess.history().length === 0) break;
      g.takeback = color;
      sendUser(opp, { type: 'takeback_requested' });
      break;
    case 'takeback_accept': {
      if (g.over || !g.takeback || g.takeback === color) break;
      // Bis der Anfragende wieder am Zug ist
      const requester = g.takeback;
      g.chess.undo();
      if (g.chess.turn() !== requester && g.chess.history().length) g.chess.undo();
      g.takeback = null;
      g.clock.lastTick = Date.now();
      for (const id of [g.white, g.black]) sendUser(id, { ...gameStateMsg(g, id), type: 'resync', message: 'Zug zurückgenommen' });
      sendWatchers(g, { ...gameStateMsg(g, null), type: 'resync' });
      scheduleFlag(g);
      break;
    }
    case 'takeback_decline':
      if (g.takeback && g.takeback !== color) { g.takeback = null; sendUser(opp, { type: 'takeback_declined' }); }
      break;
    case 'abort':
      if (!g.over && g.chess.history().length < 2) endGame(g, 'aborted', 'Partie abgebrochen');
      break;
  }
}

// =====================================================================
// 4-Spieler-Schach
// =====================================================================
function fpClocks(g) {
  const c = { ...g.clock };
  if (!g.over && g.fc.active[g.fc.turn]) c[g.fc.turn] -= Date.now() - g.lastTick;
  return c;
}

function fpPublic(g) {
  return {
    gameId: g.id, tc: g.tc, ranked: g.ranked,
    seats: g.seats.map((s) => ({ color: s.color, name: s.name, bot: s.bot, elo: s.elo, id: s.userId })),
    state: g.fc.toJSON(), clocks: fpClocks(g), over: g.over,
  };
}

function startFourGame(userIds, tc, ranked) {
  const t = FP_TIME_CONTROLS[tc] || FP_TIME_CONTROLS['3+2'];
  const shuffled = [...userIds].sort(() => Math.random() - 0.5);
  const botNames = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const seats = FP_COLORS.map((color, i) => {
    const uid = shuffled[i];
    if (uid) {
      const u = db.getUser(uid);
      return { color, userId: uid, bot: false, name: u.name, elo: u.ratings.fourp.elo };
    }
    return { color, userId: null, bot: true, name: botNames[i], elo: null };
  });
  const g = {
    id: crypto.randomUUID(), kind: '4p', tc, ranked: ranked && userIds.length >= 2,
    seats, fc: new FourChess(),
    clock: Object.fromEntries(FP_COLORS.map((c) => [c, t.base])), inc: t.inc,
    lastTick: Date.now(), over: false, startedAt: Date.now(),
    disconnectTimers: {}, spectators: new Set(), moves: [],
  };
  games.set(g.id, g);
  for (const s of seats) if (s.userId) {
    userGame.set(s.userId, g.id);
    queue.delete(s.userId); fpQueue.delete(s.userId);
    removeRoomsOf(s.userId);
  }
  for (const s of seats) if (s.userId) sendUser(s.userId, { type: 'fp_start', myColor: s.color, ...fpPublic(g) });
  fpSchedule(g);
  return g;
}

function fpSeatOf(g, userId) { return g.seats.find((s) => s.userId === userId); }

function fpBroadcast(g, msg) {
  for (const s of g.seats) if (s.userId) sendUser(s.userId, msg);
  sendWatchers(g, msg);
}

function fpSchedule(g) {
  clearTimeout(g.flagTimer);
  clearTimeout(g.botTimer);
  if (g.over) return;
  // Ausgeschiedene Menschen sind frei für neue Partien; ohne aktive Menschen endet die Partie
  for (const s of g.seats) if (s.userId && !g.fc.active[s.color] && userGame.get(s.userId) === g.id) userGame.delete(s.userId);
  if (!g.seats.some((s) => s.userId && g.fc.active[s.color])) { g.fc.finish('Alle Menschen ausgeschieden'); return fpEnd(g); }
  const color = g.fc.turn;
  const seat = g.seats.find((s) => s.color === color);
  const remaining = fpClocks(g)[color];
  g.flagTimer = setTimeout(() => fpFlag(g, color), Math.max(0, remaining) + 50);
  if (seat.bot) {
    g.botTimer = setTimeout(() => {
      if (g.over || g.fc.turn !== color) return;
      const m = botMove(g.fc, color, 0.85);
      if (m) fpApplyMove(g, color, m.from, m.to);
    }, 450 + Math.random() * 650);
  }
}

function fpFlag(g, color) {
  if (g.over || g.fc.turn !== color) return;
  g.clock[color] = 0;
  fpEliminate(g, color, 'Zeit abgelaufen');
}

function fpEliminate(g, color, reason) {
  if (g.over || !g.fc.active[color]) return;
  const wasTurn = g.fc.turn === color;
  if (wasTurn) { g.clock[color] -= Date.now() - g.lastTick; g.lastTick = Date.now(); }
  g.fc.resign(color, reason);
  fpBroadcast(g, { type: 'fp_update', ...fpPublic(g), event: { type: 'out', color, reason } });
  if (g.fc.over) return fpEnd(g);
  fpSchedule(g);
}

function fpApplyMove(g, color, from, to) {
  if (g.over || g.fc.turn !== color) return false;
  const now = Date.now();
  g.clock[color] -= now - g.lastTick;
  if (g.clock[color] <= 0) { fpFlag(g, color); return false; }
  const rec = g.fc.move({ from, to });
  if (!rec) return false;
  g.clock[color] += g.inc;
  g.lastTick = now;
  g.moves.push([from, to]);
  fpBroadcast(g, { type: 'fp_update', ...fpPublic(g), record: rec });
  if (g.fc.over) fpEnd(g);
  else fpSchedule(g);
  return true;
}

function fpEnd(g) {
  if (g.over) return;
  if (!g.fc.over) g.fc.finish('Partie beendet');
  g.over = true;
  clearTimeout(g.flagTimer); clearTimeout(g.botTimer);
  for (const t of Object.values(g.disconnectTimers)) clearTimeout(t);
  const places = g.fc.places();
  const humans = g.seats.filter((s) => s.userId).map((s) => ({ seat: s, user: db.getUser(s.userId), place: places[s.color] }));
  const deltas = g.ranked ? applyMultiElo(humans.map((h) => ({ user: h.user, place: h.place })), 'fourp') : null;
  humans.forEach((h, i) => {
    const res = h.place === 1 ? 'win' : h.place === 2 ? 'draw' : 'loss';
    h.rewards = applyRewards(h.user, res, g.ranked ? 'ranked' : 'casual');
    h.delta = deltas ? deltas[i] : null;
  });
  db.recordGame({
    id: g.id, kind: '4p', ranked: g.ranked, tc: g.tc, endedAt: Date.now(), reason: g.fc.endReason,
    players: g.seats.map((s) => ({ id: s.userId, name: s.name, color: s.color, bot: s.bot, place: places[s.color], points: g.fc.points[s.color] })),
    moves: g.moves,
  });
  const base = { type: 'fp_over', ...fpPublic(g), places, points: g.fc.points, reason: g.fc.endReason };
  for (const h of humans) {
    sendUser(h.user.id, { ...base, myColor: h.seat.color, eloChange: h.delta, rewards: h.rewards, user: db.publicUser(h.user) });
    userGame.delete(h.user.id);
  }
  sendWatchers(g, { ...base, spectator: true });
  setTimeout(() => games.delete(g.id), 120_000);
}

function on4pMessage(user, g, msg) {
  const seat = fpSeatOf(g, user.id);
  if (!seat) return;
  switch (msg.type) {
    case 'fp_move':
      if (!fpApplyMove(g, seat.color, Number(msg.from), Number(msg.to))) {
        sendUser(user.id, { type: 'fp_update', ...fpPublic(g) });
      }
      break;
    case 'resign':
      fpEliminate(g, seat.color, 'Aufgabe');
      if (!g.fc.active[seat.color]) {
        // Ausgeschiedene Spieler dürfen gehen und zuschauen
        userGame.delete(user.id);
        if (!g.over) sendUser(user.id, { type: 'fp_left', gameId: g.id });
      }
      break;
  }
}

function runFourQueue() {
  const now = Date.now();
  const byTc = {};
  for (const [id, q] of fpQueue) (byTc[q.tc] ||= []).push({ id, ...q });
  for (const [tc, list] of Object.entries(byTc)) {
    list.sort((a, b) => a.joinedAt - b.joinedAt);
    while (list.length >= 4) startFourGame(list.splice(0, 4).map((x) => x.id), tc, true);
    if (list.length && now - list[0].joinedAt >= FP_BOT_FILL_AFTER) startFourGame(list.map((x) => x.id), tc, true);
  }
}

// =====================================================================
// Matchmaking, Räume, Herausforderungen
// =====================================================================
function runMatchmaking() {
  const now = Date.now();
  const entries = [...queue.entries()];
  const matched = new Set();
  for (const [idA, a] of entries) {
    if (matched.has(idA)) continue;
    let best = null;
    for (const [idB, b] of entries) {
      if (idA === idB || matched.has(idB) || a.tc !== b.tc) continue;
      const diff = Math.abs(a.elo - b.elo);
      const windowA = 100 + Math.floor((now - a.joinedAt) / 5000) * 50;
      const windowB = 100 + Math.floor((now - b.joinedAt) / 5000) * 50;
      if (diff <= Math.min(windowA, windowB) && (!best || diff < best.diff)) best = { idB, diff };
    }
    if (best) {
      matched.add(idA); matched.add(best.idB);
      startGame(db.getUser(idA), db.getUser(best.idB), a.tc, true);
    }
  }
}

function broadcastQueueSizes() {
  const counts = {};
  for (const q of queue.values()) counts[q.tc] = (counts[q.tc] || 0) + 1;
  for (const q of fpQueue.values()) counts['4p:' + q.tc] = (counts['4p:' + q.tc] || 0) + 1;
  const msg = { type: 'queue_status', counts, online: sockets.size, live: games.size };
  for (const userId of [...queue.keys(), ...fpQueue.keys()]) sendUser(userId, msg);
}

function removeRoomsOf(userId) {
  for (const [code, r] of rooms) {
    if (r.hostId === userId) {
      rooms.delete(code);
      for (const m of r.members) if (m !== userId) sendUser(m, { type: 'room_closed', code });
    } else if (r.members.includes(userId)) {
      r.members = r.members.filter((m) => m !== userId);
      roomUpdate(code, r);
    }
  }
}

function roomUpdate(code, r) {
  const msg = {
    type: 'room_update', code, kind: r.kind, tc: r.tc, hostId: r.hostId,
    members: r.members.map((id) => ({ id, name: db.getUser(id)?.name })),
  };
  for (const m of r.members) sendUser(m, msg);
}

function liveGames() {
  const out = [];
  for (const g of games.values()) {
    if (g.over) continue;
    if (g.kind === '2p') {
      const w = db.getUser(g.white), b = db.getUser(g.black);
      out.push({
        id: g.id, kind: '2p', tc: g.tc, ranked: g.ranked, moves: g.chess.history().length,
        players: [{ name: w.name, elo: w.ratings[g.type].elo }, { name: b.name, elo: b.ratings[g.type].elo }],
        spectators: g.spectators.size,
      });
    } else {
      out.push({
        id: g.id, kind: '4p', tc: g.tc, ranked: g.ranked, moves: g.fc.history.length,
        players: g.seats.map((s) => ({ name: s.name, elo: s.elo, bot: s.bot, color: s.color })), spectators: g.spectators.size,
      });
    }
  }
  return out.sort((a, b) => b.moves - a.moves).slice(0, 30);
}
export { liveGames };

function cleanupChallenges() {
  const now = Date.now();
  for (const [id, c] of challenges) if (now - c.created > 60_000) {
    challenges.delete(id);
    sendUser(c.from, { type: 'challenge_expired', id });
    sendUser(c.to, { type: 'challenge_expired', id });
  }
}

// =====================================================================
// WebSocket-Nachrichten
// =====================================================================
function onMessage(user, ws, msg) {
  const gameId = userGame.get(user.id);
  const g = gameId && games.get(gameId);
  const busy = () => { if (g && !g.over) { send(ws, { type: 'error', message: 'Du bist bereits in einer Partie' }); return true; } return false; };

  if (g && !g.over && g.kind === '2p' && ['move', 'resign', 'offer_draw', 'decline_draw', 'takeback_request', 'takeback_accept', 'takeback_decline', 'abort'].includes(msg.type)) {
    return on2pMessage(user, g, msg);
  }
  if (g && !g.over && g.kind === '4p' && ['fp_move', 'resign'].includes(msg.type)) return on4pMessage(user, g, msg);

  switch (msg.type) {
    case 'queue': {
      if (busy()) return;
      if (!TIME_CONTROLS[msg.tc]) return send(ws, { type: 'error', message: 'Unbekannte Bedenkzeit' });
      fpQueue.delete(user.id);
      queue.set(user.id, { tc: msg.tc, joinedAt: Date.now(), elo: user.ratings[ratingType(msg.tc)].elo });
      sendUser(user.id, { type: 'queued', tc: msg.tc, kind: '2p' });
      runMatchmaking();
      break;
    }
    case 'queue_4p': {
      if (busy()) return;
      const tc = FP_TIME_CONTROLS[msg.tc] ? msg.tc : '3+2';
      queue.delete(user.id);
      fpQueue.set(user.id, { tc, joinedAt: Date.now() });
      sendUser(user.id, { type: 'queued', tc, kind: '4p', botFillSeconds: FP_BOT_FILL_AFTER / 1000 });
      runFourQueue();
      break;
    }
    case 'unqueue':
      queue.delete(user.id); fpQueue.delete(user.id);
      sendUser(user.id, { type: 'unqueued' });
      break;
    case 'play_bots_4p': {
      if (busy()) return;
      const tc = FP_TIME_CONTROLS[msg.tc] ? msg.tc : '5+5';
      startFourGame([user.id], tc, false);
      break;
    }
    case 'create_room': {
      if (busy()) return;
      const kind = msg.kind === '4p' ? '4p' : '2p';
      const tc = kind === '4p' ? (FP_TIME_CONTROLS[msg.tc] ? msg.tc : '5+5') : msg.tc;
      if (kind === '2p' && !TIME_CONTROLS[tc]) return send(ws, { type: 'error', message: 'Unbekannte Bedenkzeit' });
      removeRoomsOf(user.id);
      const code = crypto.randomBytes(3).toString('hex').toUpperCase();
      const r = { kind, hostId: user.id, tc, members: [user.id] };
      rooms.set(code, r);
      send(ws, { type: 'room_created', code, tc, kind });
      roomUpdate(code, r);
      break;
    }
    case 'join_room': {
      if (busy()) return;
      const code = String(msg.code || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, { type: 'error', message: 'Raum nicht gefunden' });
      if (room.members.includes(user.id)) return send(ws, { type: 'error', message: 'Du bist schon in diesem Raum' });
      if (userGame.has(room.hostId)) return send(ws, { type: 'error', message: 'Gastgeber spielt bereits' });
      if (room.kind === '2p') {
        rooms.delete(code);
        startGame(db.getUser(room.hostId), user, room.tc, false);
      } else {
        if (room.members.length >= 4) return send(ws, { type: 'error', message: 'Raum ist voll' });
        removeRoomsOf(user.id);
        room.members.push(user.id);
        roomUpdate(code, room);
      }
      break;
    }
    case 'start_room': {
      for (const [code, r] of rooms) {
        if (r.hostId === user.id && r.kind === '4p') {
          rooms.delete(code);
          startFourGame(r.members, r.tc, false);
        }
      }
      break;
    }
    case 'cancel_room':
      removeRoomsOf(user.id);
      break;
    case 'challenge': {
      if (busy()) return;
      const target = db.getUser(msg.to);
      if (!target || target.id === user.id) return send(ws, { type: 'error', message: 'Spieler nicht gefunden' });
      if (!isOnline(target.id)) return send(ws, { type: 'error', message: `${target.name} ist nicht online` });
      if (userGame.has(target.id)) return send(ws, { type: 'error', message: `${target.name} spielt gerade` });
      if (!TIME_CONTROLS[msg.tc]) return send(ws, { type: 'error', message: 'Unbekannte Bedenkzeit' });
      const id = crypto.randomBytes(6).toString('hex');
      const type = ratingType(msg.tc);
      challenges.set(id, { from: user.id, to: target.id, tc: msg.tc, rated: !!msg.rated, created: Date.now() });
      sendUser(target.id, { type: 'challenge', id, from: { id: user.id, name: user.name, elo: user.ratings[type].elo }, tc: msg.tc, rated: !!msg.rated });
      send(ws, { type: 'challenge_sent', id, to: target.name });
      break;
    }
    case 'challenge_accept': {
      const c = challenges.get(msg.id);
      if (!c || c.to !== user.id) return send(ws, { type: 'error', message: 'Herausforderung ist abgelaufen' });
      challenges.delete(msg.id);
      if (busy()) return;
      const from = db.getUser(c.from);
      if (!isOnline(from.id) || userGame.has(from.id)) return send(ws, { type: 'error', message: `${from.name} ist nicht mehr verfügbar` });
      startGame(from, user, c.tc, c.rated);
      break;
    }
    case 'challenge_decline': {
      const c = challenges.get(msg.id);
      if (c && c.to === user.id) { challenges.delete(msg.id); sendUser(c.from, { type: 'challenge_declined', name: user.name }); }
      break;
    }
    case 'rematch': {
      const old = games.get(msg.gameId);
      if (!old || !old.over || old.kind !== '2p' || (old.white !== user.id && old.black !== user.id)) return;
      const opp = old.white === user.id ? old.black : old.white;
      if (busy()) return;
      old.rematch.add(user.id);
      if (old.rematch.has(opp)) {
        if (!isOnline(opp) || userGame.has(opp)) return send(ws, { type: 'error', message: 'Gegner ist nicht mehr verfügbar' });
        old.rematch.clear();
        // Farben tauschen
        startGame(null, null, old.tc, old.ranked, [db.getUser(old.black), db.getUser(old.white)]);
      } else {
        sendUser(opp, { type: 'rematch_offered', gameId: old.id, name: user.name });
        send(ws, { type: 'rematch_sent' });
      }
      break;
    }
    case 'watch': {
      const w = games.get(msg.gameId);
      if (!w) return send(ws, { type: 'error', message: 'Partie nicht mehr live' });
      for (const other of games.values()) other.spectators.delete(ws);
      w.spectators.add(ws);
      if (w.kind === '2p') send(ws, { ...gameStateMsg(w, user.id), spectator: true, color: null });
      else send(ws, { type: 'fp_start', myColor: null, spectator: true, ...fpPublic(w) });
      break;
    }
    case 'unwatch':
      for (const other of games.values()) other.spectators.delete(ws);
      break;
    case 'live_games':
      send(ws, { type: 'live_games', games: liveGames() });
      break;
    case 'chat': {
      const target = g || [...games.values()].find((x) => x.spectators.has(ws));
      if (!target) break;
      const text = String(msg.text || '').slice(0, 200).trim();
      if (!text) break;
      const out = { type: 'chat', from: user.name, text };
      if (target.kind === '2p') { sendUser(target.white, out); sendUser(target.black, out); }
      else for (const s of target.seats) if (s.userId) sendUser(s.userId, out);
      sendWatchers(target, out);
      break;
    }
    case 'sync': {
      const target = g || [...games.values()].find((x) => x.spectators.has(ws));
      if (target?.kind === '2p') send(ws, { ...gameStateMsg(target, user.id), type: 'resync' });
      break;
    }
    case 'ping':
      send(ws, { type: 'pong' });
      break;
  }
}

function onDisconnect(user) {
  queue.delete(user.id);
  fpQueue.delete(user.id);
  removeRoomsOf(user.id);
  const gameId = userGame.get(user.id);
  const g = gameId && games.get(gameId);
  if (!g || g.over) return;
  if (g.kind === '2p') {
    const opp = user.id === g.white ? g.black : g.white;
    sendUser(opp, { type: 'opponent_disconnected', seconds: RECONNECT_GRACE / 1000 });
  } else {
    fpBroadcast(g, { type: 'chat', from: 'System', text: `${user.name} hat die Verbindung verloren (${RECONNECT_GRACE / 1000}s)` });
  }
  g.disconnectTimers[user.id] = setTimeout(() => {
    if (sockets.has(user.id) || g.over) return;
    if (g.kind === '2p') endGame(g, user.id === g.white ? 'b' : 'w', 'Verbindung verloren');
    else { const s = fpSeatOf(g, user.id); if (s) fpEliminate(g, s.color, 'Verbindung verloren'); userGame.delete(user.id); }
  }, RECONNECT_GRACE);
}

export function attachWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  wss.on('connection', (ws) => {
    let user = null;
    const authTimeout = setTimeout(() => ws.close(4001, 'auth timeout'), 15_000);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!user) {
        if (msg.type !== 'auth') return;
        user = db.userFromToken(msg.token);
        if (!user) { send(ws, { type: 'auth_failed' }); return ws.close(4003, 'bad token'); }
        clearTimeout(authTimeout);
        if (!sockets.has(user.id)) sockets.set(user.id, new Set());
        sockets.get(user.id).add(ws);
        send(ws, { type: 'auth_ok', online: sockets.size });
        // Wiederverbinden mit laufender Partie
        const g = games.get(userGame.get(user.id));
        if (g && !g.over) {
          clearTimeout(g.disconnectTimers[user.id]);
          if (g.kind === '2p') {
            send(ws, gameStateMsg(g, user.id));
            sendUser(user.id === g.white ? g.black : g.white, { type: 'opponent_reconnected' });
          } else {
            send(ws, { type: 'fp_start', myColor: fpSeatOf(g, user.id)?.color, ...fpPublic(g) });
          }
        }
        return;
      }
      try { onMessage(user, ws, msg); } catch (e) { console.error('WS-Fehler', e); }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      for (const g of games.values()) g.spectators.delete(ws);
      if (!user) return;
      const set = sockets.get(user.id);
      set?.delete(ws);
      if (set && set.size === 0) {
        sockets.delete(user.id);
        onDisconnect(user);
      }
    });
  });

  // Tote Verbindungen erkennen (Render-Proxy schließt sonst stumm)
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 25_000).unref();

  setInterval(() => { runMatchmaking(); runFourQueue(); broadcastQueueSizes(); cleanupChallenges(); }, 2000).unref();
  return wss;
}
