// HTTP-Server: REST-API + statische Dateien + WebSocket
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import * as db from './db.js';
import { attachWebSocket, onlineCount, statusOf, liveGames, currentGameOf } from './online.js';
import { GameError, applyRewards, buySkin, equipSkin, buyPremium, claimTier } from './progress.js';
import { AI_LEVELS, RATING_TYPES, eloChange } from '../shared/catalog.js';
import { PUZZLES } from '../shared/puzzles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);

const STATIC = [
  ['/shared/', path.join(ROOT, 'shared')],
  ['/vendor/chess.js', path.join(ROOT, 'node_modules/chess.js/dist/esm/chess.js')],
  ['/', path.join(ROOT, 'public')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.ico': 'image/x-icon',
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 64_000) { reject(new GameError('Anfrage zu groß')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new GameError('Ungültiges JSON')); } });
    req.on('error', reject);
  });
}

function authUser(req) {
  const h = req.headers.authorization || '';
  return db.userFromToken(h.startsWith('Bearer ') ? h.slice(7) : null);
}

// Einfaches Rate-Limit für Login/Registrierung
const attempts = new Map();
function rateLimited(key, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  attempts.set(key, list);
  return list.length > max;
}

// Schutz gegen doppeltes Einreichen derselben KI-Partie
const seenAiGames = new Map();
const lastAiSubmit = new Map();

function verifyAiGame(user, { pgn, level, color, resigned }) {
  const lvl = AI_LEVELS.find((l) => l.id === Number(level));
  if (!lvl) throw new GameError('Unbekannte KI-Stufe');
  if (color !== 'w' && color !== 'b') throw new GameError('Ungültige Farbe');
  const now = Date.now();
  if (now - (lastAiSubmit.get(user.id) || 0) < 10_000) throw new GameError('Zu schnell – bitte kurz warten');
  const hash = crypto.createHash('sha256').update(user.id + pgn).digest('hex');
  if (seenAiGames.has(hash)) throw new GameError('Partie wurde bereits gewertet');

  const chess = new Chess();
  try { chess.loadPgn(String(pgn || '')); } catch { throw new GameError('Ungültige PGN'); }
  const plies = chess.history().length;

  let result;
  if (resigned) result = 'loss';
  else if (chess.isCheckmate()) result = chess.turn() === color ? 'loss' : 'win';
  else if (chess.isDraw()) result = 'draw';
  else throw new GameError('Partie ist noch nicht beendet');
  if (result !== 'loss' && plies < 10) throw new GameError('Partie zu kurz für Belohnungen');

  seenAiGames.set(hash, now);
  lastAiSubmit.set(user.id, now);
  if (seenAiGames.size > 10_000) seenAiGames.delete(seenAiGames.keys().next().value);

  const stats = (user.aiStats[lvl.id] ||= { win: 0, draw: 0, loss: 0 });
  stats[result] += 1;
  return { result, rewards: applyRewards(user, result, 'ai', lvl.id) };
}

const NAME_RE = /^[A-Za-z0-9_äöüÄÖÜß-]{3,16}$/;
const PUZZLE_BY_ID = new Map(PUZZLES.map((p) => [p.id, p]));

function today() { return new Date().toISOString().slice(0, 10); }
function dailyPuzzle() {
  // Deterministisch pro Tag, aus dem mittleren Schwierigkeitsbereich
  const pool = PUZZLES.filter((p) => p.rating >= 900 && p.rating <= 1800);
  const d = today();
  let h = 0;
  for (const ch of d) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

function nextPuzzle(user) {
  const r = user.ratings.puzzle.elo;
  const solved = new Set(user.puzzles.solved);
  const recent = new Set(user.puzzles.recent || []);
  let pool = PUZZLES.filter((p) => !solved.has(p.id) && !recent.has(p.id) && Math.abs(p.rating - r) <= 250);
  if (pool.length < 5) pool = PUZZLES.filter((p) => !solved.has(p.id) && !recent.has(p.id));
  if (!pool.length) pool = PUZZLES;
  pool.sort((a, b) => Math.abs(a.rating - r) - Math.abs(b.rating - r));
  return pool[Math.floor(Math.random() * Math.min(pool.length, 12))];
}

function friendView(id) {
  const u = db.getUser(id);
  if (!u) return null;
  return { id: u.id, name: u.name, status: statusOf(u.id), gameId: currentGameOf(u.id), ratings: Object.fromEntries(RATING_TYPES.map((t) => [t.id, u.ratings[t.id].elo])) };
}

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  if (route === 'POST /api/register' || route === 'POST /api/login') {
    if (rateLimited(ip)) return json(res, 429, { error: 'Zu viele Versuche, bitte warte eine Minute' });
    const { name, password } = await readBody(req);
    if (typeof name !== 'string' || typeof password !== 'string') throw new GameError('Name und Passwort angeben');
    let user;
    if (route === 'POST /api/register') {
      if (!NAME_RE.test(name)) throw new GameError('Name: 3–16 Zeichen, Buchstaben/Zahlen/_/-');
      if (password.length < 6) throw new GameError('Passwort muss mindestens 6 Zeichen haben');
      if (db.findUserByName(name)) throw new GameError('Name ist schon vergeben');
      user = db.createUser(name, password);
    } else {
      user = db.findUserByName(name.trim());
      if (!user || !db.checkPassword(user, password)) throw new GameError('Name oder Passwort falsch');
    }
    return json(res, 200, { token: db.createToken(user.id), user: db.publicUser(user) });
  }

  if (route === 'GET /api/leaderboard') {
    const type = RATING_TYPES.some((t) => t.id === url.searchParams.get('type')) ? url.searchParams.get('type') : 'blitz';
    const top = db.allUsers()
      .filter((u) => u.ratings[type].games > 0)
      .sort((a, b) => b.ratings[type].elo - a.ratings[type].elo)
      .slice(0, 100)
      .map((u) => { const r = u.ratings[type]; return { id: u.id, name: u.name, elo: r.elo, games: r.games, wins: r.wins, losses: r.losses, draws: r.draws }; });
    return json(res, 200, { top, type, online: onlineCount() });
  }

  if (route === 'GET /api/health') return json(res, 200, { ok: true, storage: db.USE_SUPABASE ? 'supabase' : 'file' });

  const user = authUser(req);
  if (!user) return json(res, 401, { error: 'Nicht angemeldet' });

  // Routen mit Parameter
  let m;
  if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/user\/([^/]+)$/))) {
    const u = db.findUserByName(decodeURIComponent(m[1]));
    if (!u) return json(res, 404, { error: 'Spieler nicht gefunden' });
    return json(res, 200, { profile: db.profileOf(u), status: statusOf(u.id), games: db.gamesOf(u.id, 20).map(slimGame), isFriend: user.friends.includes(u.id) });
  }
  if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/game\/([\w-]+)$/))) {
    const g = db.getGame(m[1]);
    if (!g) return json(res, 404, { error: 'Partie nicht gefunden' });
    return json(res, 200, { game: g });
  }

  switch (route) {
    case 'GET /api/me':
      return json(res, 200, { user: db.publicUser(user), online: onlineCount(), puzzleCount: PUZZLES.length });
    case 'POST /api/logout':
      db.deleteToken((req.headers.authorization || '').slice(7));
      return json(res, 200, { ok: true });
    case 'GET /api/history':
      return json(res, 200, { games: db.gamesOf(user.id).map(slimGame) });
    case 'GET /api/live':
      return json(res, 200, { games: liveGames() });
    case 'POST /api/settings': {
      const { settings } = await readBody(req);
      const allowed = ['sound', 'coords', 'autoQueen', 'premoves', 'animation', 'highlight', 'confirmResign', 'moveStyle'];
      for (const k of allowed) if (settings && k in settings) user.settings[k] = settings[k];
      db.save();
      return json(res, 200, { user: db.publicUser(user) });
    }
    case 'GET /api/friends':
      return json(res, 200, { friends: user.friends.map(friendView).filter(Boolean) });
    case 'POST /api/friends/add': {
      const { name } = await readBody(req);
      const f = db.findUserByName(String(name || '').trim());
      if (!f) throw new GameError('Spieler nicht gefunden');
      if (f.id === user.id) throw new GameError('Du kannst dich nicht selbst hinzufügen');
      if (user.friends.includes(f.id)) throw new GameError('Ist schon dein Freund');
      if (user.friends.length >= 100) throw new GameError('Maximal 100 Freunde');
      user.friends.push(f.id);
      if (!f.friends.includes(user.id)) f.friends.push(user.id); // Freundschaft beidseitig
      db.save();
      return json(res, 200, { friends: user.friends.map(friendView).filter(Boolean) });
    }
    case 'POST /api/friends/remove': {
      const { id } = await readBody(req);
      user.friends = user.friends.filter((x) => x !== id);
      const f = db.getUser(id);
      if (f) f.friends = f.friends.filter((x) => x !== user.id);
      db.save();
      return json(res, 200, { friends: user.friends.map(friendView).filter(Boolean) });
    }
    case 'POST /api/shop/buy': {
      const { type, id } = await readBody(req);
      buySkin(user, type, id);
      return json(res, 200, { user: db.publicUser(user) });
    }
    case 'POST /api/equip': {
      const { type, id } = await readBody(req);
      equipSkin(user, type, id);
      return json(res, 200, { user: db.publicUser(user) });
    }
    case 'POST /api/battlepass/premium':
      buyPremium(user);
      return json(res, 200, { user: db.publicUser(user) });
    case 'POST /api/battlepass/claim': {
      const { track, tier } = await readBody(req);
      const reward = claimTier(user, track, Number(tier));
      return json(res, 200, { reward, user: db.publicUser(user) });
    }
    case 'POST /api/ai-result': {
      const out = verifyAiGame(user, await readBody(req));
      return json(res, 200, { ...out, user: db.publicUser(user) });
    }
    case 'GET /api/puzzle/next':
      return json(res, 200, { puzzle: nextPuzzle(user), rating: user.ratings.puzzle.elo });
    case 'GET /api/puzzle/daily': {
      const p = dailyPuzzle();
      return json(res, 200, { puzzle: p, date: today(), solved: user.puzzles.dailyDone === today() });
    }
    case 'GET /api/puzzle/rush': {
      // Aufgaben mit steigender Schwierigkeit für Puzzle Rush
      const sorted = [...PUZZLES].sort((a, b) => a.rating - b.rating);
      const list = [];
      for (let i = 0; i < 60; i++) {
        const target = 500 + i * 40;
        const near = sorted.filter((p) => Math.abs(p.rating - target) < 120 && !list.includes(p));
        list.push(near.length ? near[Math.floor(Math.random() * near.length)] : sorted[Math.min(sorted.length - 1, i * 4)]);
      }
      return json(res, 200, { puzzles: list, best: user.puzzles.rushBest || 0 });
    }
    case 'POST /api/puzzle/result': {
      const { id, solved, mode } = await readBody(req);
      const p = PUZZLE_BY_ID.get(id);
      if (!p) throw new GameError('Unbekannte Aufgabe');
      const pz = user.puzzles;
      pz.recent = [...(pz.recent || []).filter((x) => x !== id), id].slice(-40);
      let delta = 0, coins = 0;
      if (mode === 'daily') {
        if (solved && pz.dailyDone !== today()) {
          pz.dailyDone = today();
          pz.dailyStreak = pz.lastDaily === new Date(Date.now() - 86400000).toISOString().slice(0, 10) ? (pz.dailyStreak || 0) + 1 : 1;
          pz.lastDaily = today();
          coins = 25;
          user.coins += coins;
          user.pass.xp += 25;
        }
      } else if (!pz.solved.includes(id)) {
        // Nur der erste Versuch zählt für die Wertung
        const r = user.ratings.puzzle;
        delta = eloChange(r.elo, p.rating, solved ? 1 : 0, r.games);
        r.elo = Math.max(100, r.elo + delta);
        r.peak = Math.max(r.peak, r.elo);
        r.games += 1;
        if (solved) { r.wins += 1; pz.streak = (pz.streak || 0) + 1; pz.best = Math.max(pz.best || 0, pz.streak); }
        else { r.losses += 1; pz.streak = 0; }
        pz.solved.push(id);
        if (pz.solved.length > 5000) pz.solved.splice(0, 1000);
        if (solved) { user.pass.xp += 5; coins = 2; user.coins += coins; }
      }
      db.save();
      return json(res, 200, { delta, coins, rating: user.ratings.puzzle.elo, user: db.publicUser(user) });
    }
    case 'POST /api/puzzle/rush-result': {
      const { score } = await readBody(req);
      const s = Math.max(0, Math.min(60, Math.floor(Number(score) || 0)));
      const best = user.puzzles.rushBest || 0;
      const record = s > best;
      if (record) user.puzzles.rushBest = s;
      const coins = Math.min(30, s * 2);
      user.coins += coins;
      user.pass.xp += Math.min(40, s * 3);
      db.save();
      return json(res, 200, { record, best: user.puzzles.rushBest || 0, coins, user: db.publicUser(user) });
    }
  }
  return json(res, 404, { error: 'Nicht gefunden' });
}

function slimGame(g) {
  const { pgn, moves, ...rest } = g;
  return rest;
}

function serveStatic(req, res, url) {
  for (const [prefix, target] of STATIC) {
    if (!url.pathname.startsWith(prefix)) continue;
    let file = target;
    if (prefix.endsWith('/')) {
      const rel = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
      file = path.join(target, rel);
      if (!file.startsWith(target)) break; // Path traversal
    } else if (url.pathname !== prefix) continue;
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        // SPA-Fallback
        if (prefix === '/' && !path.extname(url.pathname)) return serveFile(res, path.join(ROOT, 'public/index.html'));
        res.writeHead(404); return res.end('Not found');
      }
      serveFile(res, file);
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
}

function serveFile(res, file) {
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

await db.load();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    try { await api(req, res, url); } catch (e) {
      if (e instanceof GameError) json(res, 400, { error: e.message });
      else { console.error(e); json(res, 500, { error: 'Serverfehler' }); }
    }
    return;
  }
  serveStatic(req, res, url);
});

attachWebSocket(server);

server.listen(PORT, () => console.log(`♟  Schachkakh läuft auf http://localhost:${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { db.save(); await db.flush(); process.exit(0); });
}
