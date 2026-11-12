// HTTP-Server: REST-API + statische Dateien + WebSocket
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import * as db from './db.js';
import { attachWebSocket, onlineCount } from './online.js';
import { GameError, applyRewards, buySkin, equipSkin, buyPremium, claimTier } from './progress.js';
import { AI_LEVELS } from '../shared/catalog.js';

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

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const ip = req.socket.remoteAddress;

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
      user = db.findUserByName(name);
      if (!user || !db.checkPassword(user, password)) throw new GameError('Name oder Passwort falsch');
    }
    return json(res, 200, { token: db.createToken(user.id), user: db.publicUser(user) });
  }

  if (route === 'GET /api/leaderboard') {
    const top = db.allUsers()
      .filter((u) => u.games > 0)
      .sort((a, b) => b.elo - a.elo)
      .slice(0, 50)
      .map((u) => ({ name: u.name, elo: u.elo, games: u.games, wins: u.wins, losses: u.losses, draws: u.draws }));
    return json(res, 200, { top, online: onlineCount() });
  }

  const user = authUser(req);
  if (!user) return json(res, 401, { error: 'Nicht angemeldet' });

  switch (route) {
    case 'GET /api/me':
      return json(res, 200, { user: db.publicUser(user), online: onlineCount() });
    case 'POST /api/logout':
      db.deleteToken((req.headers.authorization || '').slice(7));
      return json(res, 200, { ok: true });
    case 'GET /api/history':
      return json(res, 200, { games: db.gamesOf(user.id) });
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
  }
  return json(res, 404, { error: 'Nicht gefunden' });
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

db.load();

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
  process.on(sig, () => { db.flush(); process.exit(0); });
}
