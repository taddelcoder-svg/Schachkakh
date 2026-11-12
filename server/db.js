// Sehr einfache JSON-Datei-Datenbank. Reicht für den Start; später gegen SQLite/Postgres tauschbar.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { START_ELO, START_COINS, DEFAULT_SKINS, SEASON } from '../shared/catalog.js';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let state = { users: {}, tokens: {}, games: [] };
let saveTimer = null;

export function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    state = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    state.games ||= [];
  }
}

export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 200);
}

export function flush() {
  clearTimeout(saveTimer);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, DB_FILE);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function findUserByName(name) {
  const lower = name.toLowerCase();
  return Object.values(state.users).find((u) => u.name.toLowerCase() === lower) || null;
}

export function getUser(id) {
  return state.users[id] || null;
}

export function createUser(name, password) {
  const id = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id,
    name,
    salt,
    passHash: hashPassword(password, salt),
    createdAt: Date.now(),
    elo: START_ELO,
    peakElo: START_ELO,
    games: 0, wins: 0, losses: 0, draws: 0,
    coins: START_COINS,
    owned: { board: [...DEFAULT_SKINS.board], pieces: [...DEFAULT_SKINS.pieces] },
    equipped: { board: DEFAULT_SKINS.board[0], pieces: DEFAULT_SKINS.pieces[0] },
    pass: { season: SEASON.id, xp: 0, premium: false, claimedFree: [], claimedPremium: [] },
    aiStats: {},
  };
  state.users[id] = user;
  save();
  return user;
}

export function checkPassword(user, password) {
  const a = Buffer.from(hashPassword(password, user.salt), 'hex');
  const b = Buffer.from(user.passHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  state.tokens[token] = { userId, createdAt: Date.now() };
  save();
  return token;
}

export function userFromToken(token) {
  const entry = token && state.tokens[token];
  return entry ? getUser(entry.userId) : null;
}

export function deleteToken(token) {
  delete state.tokens[token];
  save();
}

export function allUsers() {
  return Object.values(state.users);
}

export function recordGame(game) {
  state.games.push(game);
  if (state.games.length > 5000) state.games.splice(0, state.games.length - 5000);
  save();
}

export function gamesOf(userId, limit = 20) {
  const out = [];
  for (let i = state.games.length - 1; i >= 0 && out.length < limit; i--) {
    const g = state.games[i];
    if (g.white?.id === userId || g.black?.id === userId) out.push(g);
  }
  return out;
}

// Öffentliche Sicht auf einen Nutzer (ohne Passwort-Hash)
export function publicUser(u) {
  if (!u) return null;
  const { salt, passHash, ...rest } = u;
  return rest;
}
