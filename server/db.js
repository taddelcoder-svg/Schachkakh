// Speicher: Mit SUPABASE_URL + SUPABASE_SERVICE_KEY liegt alles als eine JSON-Zeile in Supabase
// und übersteht Neustarts/Deploys auf Render. Ohne die Variablen: lokale Datei data/db.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { START_ELO, START_COINS, DEFAULT_SKINS, SEASON, RATING_TYPES } from '../shared/catalog.js';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const TABLE = process.env.SUPABASE_TABLE || 'rangliste_speicher';
const ROW_ID = process.env.SUPABASE_ROW || 'schachkakh';
export const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);
const HEADERS = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY };

const TOKEN_TTL = 365 * 24 * 3600 * 1000; // ein Jahr angemeldet bleiben
const MAX_GAMES = 800;

let state = { users: {}, tokens: {}, games: [] };
let dirty = false;
let saving = false;

function emptyRating() {
  return { elo: START_ELO, peak: START_ELO, games: 0, wins: 0, losses: 0, draws: 0 };
}

// Ältere Datensätze auf das aktuelle Format bringen
function migrateUser(u) {
  u.ratings ||= {};
  if (u.elo != null && !u.ratings.blitz) {
    u.ratings.blitz = { elo: u.elo, peak: u.peakElo || u.elo, games: u.games || 0, wins: u.wins || 0, losses: u.losses || 0, draws: u.draws || 0 };
  }
  for (const t of RATING_TYPES) u.ratings[t.id] ||= emptyRating();
  delete u.elo; delete u.peakElo; delete u.games; delete u.wins; delete u.losses; delete u.draws;
  u.friends ||= [];
  u.settings ||= {};
  u.aiStats ||= {};
  u.puzzles ||= { solved: [], streak: 0, best: 0 };
}

export async function load() {
  if (USE_SUPABASE) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${ROW_ID}&select=daten`, { headers: HEADERS });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
        const rows = await res.json();
        if (rows[0]?.daten) state = rows[0].daten;
        console.log(`Daten aus Supabase geladen (${Object.keys(state.users || {}).length} Spieler).`);
        break;
      } catch (e) {
        console.error(`Laden aus Supabase fehlgeschlagen (Versuch ${attempt}):`, e.message);
        if (attempt === 5) {
          // Nicht mit leerem Stand starten – sonst würden echte Daten überschrieben
          console.error('Abbruch: Supabase nicht erreichbar.');
          process.exit(1);
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  } else {
    if (process.env.RENDER) console.warn('⚠️  SUPABASE_URL/SUPABASE_SERVICE_KEY fehlen – auf Render gehen Accounts bei jedem Neustart verloren!');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) state = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  }
  state.users ||= {}; state.tokens ||= {}; state.games ||= [];
  for (const u of Object.values(state.users)) migrateUser(u);
  const now = Date.now();
  for (const [t, e] of Object.entries(state.tokens)) if (now - (e.lastUsed || e.createdAt) > TOKEN_TTL) delete state.tokens[t];
}

export function save() { dirty = true; }

export async function flush() {
  if (!dirty || saving) return;
  saving = true; dirty = false;
  try {
    if (USE_SUPABASE) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ id: ROW_ID, daten: state, geaendert_am: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
    } else {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, DB_FILE);
    }
  } catch (e) {
    dirty = true;
    console.error('Speichern fehlgeschlagen:', e.message);
  }
  saving = false;
}
setInterval(flush, USE_SUPABASE ? 4000 : 1000).unref();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function findUserByName(name) {
  const lower = String(name).toLowerCase();
  return Object.values(state.users).find((u) => u.name.toLowerCase() === lower) || null;
}

export function getUser(id) {
  return state.users[id] || null;
}

export function createUser(name, password) {
  const id = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id, name, salt,
    passHash: hashPassword(password, salt),
    createdAt: Date.now(),
    coins: START_COINS,
    owned: { board: [...DEFAULT_SKINS.board], pieces: [...DEFAULT_SKINS.pieces] },
    equipped: { board: DEFAULT_SKINS.board[0], pieces: DEFAULT_SKINS.pieces[0] },
    pass: { season: SEASON.id, xp: 0, premium: false, claimedFree: [], claimedPremium: [] },
  };
  migrateUser(user);
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
  state.tokens[token] = { userId, createdAt: Date.now(), lastUsed: Date.now() };
  save();
  return token;
}

export function userFromToken(token) {
  const entry = token && state.tokens[token];
  if (!entry) return null;
  // Gleitendes Ablaufdatum: wer spielt, bleibt angemeldet
  if (Date.now() - (entry.lastUsed || 0) > 24 * 3600 * 1000) { entry.lastUsed = Date.now(); save(); }
  return getUser(entry.userId);
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
  if (state.games.length > MAX_GAMES) state.games.splice(0, state.games.length - MAX_GAMES);
  save();
}

export function gamesOf(userId, limit = 30) {
  const out = [];
  for (let i = state.games.length - 1; i >= 0 && out.length < limit; i--) {
    const g = state.games[i];
    if (g.white?.id === userId || g.black?.id === userId || g.players?.some((p) => p.id === userId)) out.push(g);
  }
  return out;
}

export function getGame(id) {
  return state.games.find((g) => g.id === id) || null;
}

// Öffentliche Sicht auf einen Nutzer (ohne Passwort-Hash)
export function publicUser(u) {
  if (!u) return null;
  const { salt, passHash, ...rest } = u;
  return rest;
}

// Profil für andere Spieler
export function profileOf(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, ratings: u.ratings, createdAt: u.createdAt, equipped: u.equipped };
}
