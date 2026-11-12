// Online-Spiel: WebSocket-Verbindungen, Matchmaking, private Räume, serverseitige Uhren
import crypto from 'node:crypto';
import { Chess } from 'chess.js';
import { WebSocketServer } from 'ws';
import * as db from './db.js';
import { applyElo, applyRewards } from './progress.js';

export const TIME_CONTROLS = {
  '1+0': { base: 60_000, inc: 0 },
  '3+2': { base: 180_000, inc: 2_000 },
  '5+0': { base: 300_000, inc: 0 },
  '10+0': { base: 600_000, inc: 0 },
};

const FIRST_MOVE_TIMEOUT = 30_000;
const RECONNECT_GRACE = 30_000;

const sockets = new Map();   // userId -> Set<ws>
const queue = new Map();     // userId -> { tc, joinedAt, elo }
const rooms = new Map();     // code -> { hostId, tc }
const games = new Map();     // gameId -> game
const userGame = new Map();  // userId -> gameId

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function sendUser(userId, msg) {
  for (const ws of sockets.get(userId) || []) send(ws, msg);
}

function playerInfo(u) {
  return { id: u.id, name: u.name, elo: u.elo, board: u.equipped.board, pieces: u.equipped.pieces };
}

// ---------- Uhr ----------
function clocksNow(g) {
  const c = { w: g.clock.w, b: g.clock.b };
  if (g.clock.running) c[g.chess.turn()] -= Date.now() - g.clock.lastTick;
  return c;
}

function scheduleFlag(g) {
  clearTimeout(g.flagTimer);
  if (g.over) return;
  if (!g.clock.running) {
    // Erster Zug jeder Seite: ohne Uhr, aber mit Abbruch-Timeout
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

// ---------- Spiel-Lebenszyklus ----------
function startGame(userA, userB, tc, ranked) {
  const [white, black] = Math.random() < 0.5 ? [userA, userB] : [userB, userA];
  const t = TIME_CONTROLS[tc];
  const g = {
    id: crypto.randomUUID(),
    tc, ranked,
    white: white.id, black: black.id,
    chess: new Chess(),
    clock: { w: t.base, b: t.base, inc: t.inc, running: false, lastTick: Date.now() },
    drawOffer: null,
    over: false,
    startedAt: Date.now(),
    disconnectTimers: {},
  };
  games.set(g.id, g);
  userGame.set(white.id, g.id);
  userGame.set(black.id, g.id);
  queue.delete(white.id);
  queue.delete(black.id);
  for (const u of [white, black]) sendUser(u.id, gameStateMsg(g, u.id));
  scheduleFlag(g);
}

function gameStateMsg(g, userId) {
  const w = db.getUser(g.white);
  const b = db.getUser(g.black);
  return {
    type: 'game_start',
    gameId: g.id,
    color: userId === g.white ? 'w' : 'b',
    white: playerInfo(w),
    black: playerInfo(b),
    tc: g.tc,
    ranked: g.ranked,
    pgn: g.chess.pgn(),
    fen: g.chess.fen(),
    clocks: clocksNow(g),
    clockRunning: g.clock.running,
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
    if (g.ranked) elo = applyElo(white, black, scoreWhite);
    const mode = g.ranked ? 'ranked' : 'casual';
    rewards.w = applyRewards(white, scoreWhite === 1 ? 'win' : scoreWhite === 0 ? 'loss' : 'draw', mode);
    rewards.b = applyRewards(black, scoreWhite === 0 ? 'win' : scoreWhite === 1 ? 'loss' : 'draw', mode);
    db.recordGame({
      id: g.id, ranked: g.ranked, tc: g.tc, endedAt: Date.now(),
      white: { id: white.id, name: white.name }, black: { id: black.id, name: black.name },
      result, reason, pgn: g.chess.pgn(), elo,
    });
  }

  for (const [color, user] of [['w', white], ['b', black]]) {
    sendUser(user.id, {
      type: 'game_over', gameId: g.id, result, reason,
      eloChange: elo ? elo[color === 'w' ? 'white' : 'black'] : null,
      newElo: user.elo,
      rewards: rewards[color] || null,
      user: db.publicUser(user),
    });
    userGame.delete(user.id);
  }
  setTimeout(() => games.delete(g.id), 60_000);
}

function handleMove(user, g, { from, to, promotion }) {
  if (g.over) return;
  const color = user.id === g.white ? 'w' : 'b';
  if (g.chess.turn() !== color) return sendUser(user.id, { type: 'error', message: 'Du bist nicht am Zug' });

  const now = Date.now();
  if (g.clock.running) {
    g.clock[color] -= now - g.clock.lastTick;
    if (g.clock[color] <= 0) return onFlag(g);
  }
  let move;
  try {
    move = g.chess.move({ from, to, promotion: promotion || 'q' });
  } catch {
    return sendUser(user.id, { type: 'error', message: 'Ungültiger Zug', fen: g.chess.fen() });
  }
  if (g.clock.running) g.clock[color] += g.clock.inc;
  // Uhr läuft ab dem zweiten Zug von Schwarz-Antwort (beide Seiten haben gezogen)
  if (!g.clock.running && g.chess.history().length >= 2) g.clock.running = true;
  g.clock.lastTick = now;
  g.drawOffer = null;

  const msg = {
    type: 'move', gameId: g.id, san: move.san, from: move.from, to: move.to,
    fen: g.chess.fen(), clocks: clocksNow(g), clockRunning: g.clock.running,
  };
  sendUser(g.white, msg);
  sendUser(g.black, msg);

  const c = g.chess;
  if (c.isCheckmate()) endGame(g, color, 'Schachmatt');
  else if (c.isStalemate()) endGame(g, 'draw', 'Patt');
  else if (c.isInsufficientMaterial()) endGame(g, 'draw', 'Ungenügendes Material');
  else if (c.isThreefoldRepetition()) endGame(g, 'draw', 'Dreifache Stellungswiederholung');
  else if (c.isDraw()) endGame(g, 'draw', '50-Züge-Regel');
  else scheduleFlag(g);
}

// ---------- Matchmaking ----------
// Elo-Fenster wächst mit Wartezeit: ±100, +50 alle 5 s
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
      matched.add(idA);
      matched.add(best.idB);
      startGame(db.getUser(idA), db.getUser(best.idB), a.tc, true);
    }
  }
}

function broadcastQueueSizes() {
  const counts = {};
  for (const q of queue.values()) counts[q.tc] = (counts[q.tc] || 0) + 1;
  for (const userId of queue.keys()) sendUser(userId, { type: 'queue_status', counts, online: sockets.size });
}

// ---------- WebSocket-Nachrichten ----------
function onMessage(user, ws, msg) {
  const gameId = userGame.get(user.id);
  const g = gameId && games.get(gameId);

  switch (msg.type) {
    case 'queue': {
      if (g) return send(ws, { type: 'error', message: 'Du bist bereits in einer Partie' });
      if (!TIME_CONTROLS[msg.tc]) return send(ws, { type: 'error', message: 'Unbekannte Bedenkzeit' });
      queue.set(user.id, { tc: msg.tc, joinedAt: Date.now(), elo: user.elo });
      sendUser(user.id, { type: 'queued', tc: msg.tc });
      runMatchmaking();
      break;
    }
    case 'unqueue':
      queue.delete(user.id);
      sendUser(user.id, { type: 'unqueued' });
      break;
    case 'create_room': {
      if (g) return send(ws, { type: 'error', message: 'Du bist bereits in einer Partie' });
      if (!TIME_CONTROLS[msg.tc]) return send(ws, { type: 'error', message: 'Unbekannte Bedenkzeit' });
      for (const [code, r] of rooms) if (r.hostId === user.id) rooms.delete(code);
      const code = crypto.randomBytes(3).toString('hex').toUpperCase();
      rooms.set(code, { hostId: user.id, tc: msg.tc });
      send(ws, { type: 'room_created', code, tc: msg.tc });
      break;
    }
    case 'join_room': {
      const code = String(msg.code || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, { type: 'error', message: 'Raum nicht gefunden' });
      if (room.hostId === user.id) return send(ws, { type: 'error', message: 'Das ist dein eigener Raum' });
      if (userGame.has(room.hostId)) return send(ws, { type: 'error', message: 'Gastgeber spielt bereits' });
      rooms.delete(code);
      startGame(db.getUser(room.hostId), user, room.tc, false);
      break;
    }
    case 'cancel_room':
      for (const [code, r] of rooms) if (r.hostId === user.id) rooms.delete(code);
      break;
    case 'move':
      if (g && g.id === msg.gameId) handleMove(user, g, msg);
      break;
    case 'resign':
      if (g && !g.over) endGame(g, user.id === g.white ? 'b' : 'w', 'Aufgabe');
      break;
    case 'offer_draw':
      if (g && !g.over) {
        const color = user.id === g.white ? 'w' : 'b';
        if (g.drawOffer && g.drawOffer !== color) endGame(g, 'draw', 'Remis vereinbart');
        else {
          g.drawOffer = color;
          sendUser(color === 'w' ? g.black : g.white, { type: 'draw_offered' });
        }
      }
      break;
    case 'decline_draw':
      if (g && g.drawOffer) {
        const other = g.drawOffer === 'w' ? g.white : g.black;
        g.drawOffer = null;
        sendUser(other, { type: 'draw_declined' });
      }
      break;
    case 'chat':
      if (g) {
        const text = String(msg.text || '').slice(0, 200).trim();
        if (text) for (const id of [g.white, g.black]) sendUser(id, { type: 'chat', from: user.name, text });
      }
      break;
    case 'ping':
      send(ws, { type: 'pong' });
      break;
  }
}

function onDisconnect(user) {
  queue.delete(user.id);
  for (const [code, r] of rooms) if (r.hostId === user.id) rooms.delete(code);
  const gameId = userGame.get(user.id);
  const g = gameId && games.get(gameId);
  if (g && !g.over) {
    const opp = user.id === g.white ? g.black : g.white;
    sendUser(opp, { type: 'opponent_disconnected', seconds: RECONNECT_GRACE / 1000 });
    g.disconnectTimers[user.id] = setTimeout(() => {
      if (!sockets.has(user.id)) endGame(g, user.id === g.white ? 'b' : 'w', 'Verbindung verloren');
    }, RECONNECT_GRACE);
  }
}

export function attachWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  wss.on('connection', (ws) => {
    let user = null;
    const authTimeout = setTimeout(() => ws.close(4001, 'auth timeout'), 10_000);

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
          send(ws, gameStateMsg(g, user.id));
          sendUser(user.id === g.white ? g.black : g.white, { type: 'opponent_reconnected' });
        }
        return;
      }
      onMessage(user, ws, msg);
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (!user) return;
      const set = sockets.get(user.id);
      set?.delete(ws);
      if (set && set.size === 0) {
        sockets.delete(user.id);
        onDisconnect(user);
      }
    });
  });

  setInterval(() => { runMatchmaking(); broadcastQueueSizes(); }, 2000).unref();
  return wss;
}

export function onlineCount() {
  return sockets.size;
}
