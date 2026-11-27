// Gemeinsame Spieldaten für Server und Browser: Skins, Battlepass, Belohnungen, Elo.

export const START_ELO = 1200;
export const START_COINS = 150;

// ---------- Wertungen & Bedenkzeiten (wie bei Chess.com getrennt) ----------
export const RATING_TYPES = [
  { id: 'bullet', name: 'Bullet', icon: '⚡' },
  { id: 'blitz', name: 'Blitz', icon: '🔥' },
  { id: 'rapid', name: 'Schnellschach', icon: '⏱️' },
  { id: 'fourp', name: '4 Spieler', icon: '🎲' },
  { id: 'puzzle', name: 'Taktik', icon: '🧩' },
];

export const TIME_CONTROLS = {
  '1+0': { base: 60_000, inc: 0, type: 'bullet' },
  '2+1': { base: 120_000, inc: 1_000, type: 'bullet' },
  '3+0': { base: 180_000, inc: 0, type: 'blitz' },
  '3+2': { base: 180_000, inc: 2_000, type: 'blitz' },
  '5+0': { base: 300_000, inc: 0, type: 'blitz' },
  '10+0': { base: 600_000, inc: 0, type: 'rapid' },
  '15+10': { base: 900_000, inc: 10_000, type: 'rapid' },
};

// ---------- Skins ----------
// Brett-Skins: helle / dunkle Felder + Hervorhebungsfarbe
export const BOARD_SKINS = {
  classic: { name: 'Klassisch', light: '#eeeed2', dark: '#769656', accent: '#f6f669', price: 0 },
  wood:    { name: 'Holz',      light: '#f0d9b5', dark: '#b58863', accent: '#cdd26a', price: 0 },
  ocean:   { name: 'Ozean',     light: '#dbe9f4', dark: '#4b7399', accent: '#7fd1ff', price: 200 },
  candy:   { name: 'Zuckerwatte', light: '#ffe4f1', dark: '#e48bb8', accent: '#fff07a', price: 250 },
  marble:  { name: 'Marmor',    light: '#e8e8e8', dark: '#8a8f99', accent: '#c4e1ff', price: 300 },
  midnight:{ name: 'Mitternacht', light: '#5b6b8c', dark: '#26304a', accent: '#9a7bff', price: 400 },
  lava:    { name: 'Lava',      light: '#f4c27a', dark: '#a8321e', accent: '#ffe066', bp: true },
  emerald: { name: 'Smaragd',   light: '#c9f2d8', dark: '#1f7a4d', accent: '#f9ff8a', bp: true },
  galaxy:  { name: 'Galaxie',   light: '#8f7cc9', dark: '#2a1a4f', accent: '#ff7ce5', bp: true, premium: true },
  royal:   { name: 'Königlich', light: '#f7e7b4', dark: '#6b1d2f', accent: '#ffd700', bp: true, premium: true },
};

// Figuren-Skins: Füllfarbe + Konturfarbe pro Seite, optional Glow
export const PIECE_SKINS = {
  standard: { name: 'Standard', w: ['#ffffff', '#222'], b: ['#1b1b1b', '#ddd'], price: 0 },
  ivory:    { name: 'Elfenbein & Ebenholz', w: ['#fff6e0', '#6b4f2a'], b: ['#3b2412', '#e9d4a7'], price: 150 },
  neon:     { name: 'Neon', w: ['#7dfcff', '#003a40'], b: ['#ff4fd8', '#3d0030'], glow: true, price: 350 },
  ice:      { name: 'Eis', w: ['#e8fbff', '#3aa0c9'], b: ['#1d6f99', '#c9f1ff'], glow: true, price: 300 },
  gold:     { name: 'Gold & Silber', w: ['#ffd84d', '#7a5a00'], b: ['#b8c2cc', '#2b3138'], bp: true },
  fire:     { name: 'Feuer', w: ['#ffb347', '#7a1f00'], b: ['#c0261b', '#ffd27a'], glow: true, bp: true },
  shadow:   { name: 'Schatten', w: ['#d9d9ff', '#2a2a55'], b: ['#0a0a12', '#8a7dff'], glow: true, bp: true, premium: true },
  diamond:  { name: 'Diamant', w: ['#f0ffff', '#5fd3ff'], b: ['#2b4c7e', '#bff3ff'], glow: true, bp: true, premium: true },
};

export const DEFAULT_SKINS = { board: ['classic', 'wood'], pieces: ['standard'] };

// ---------- Battlepass ----------
export const SEASON = { id: 1, name: 'Saison 1: Erwachen der Könige', premiumPrice: 600 };
export const XP_PER_TIER = 100;
export const MAX_TIER = 30;

// Belohnung: { coins } | { board } | { pieces }
const FREE = {
  1: { coins: 25 }, 2: { coins: 25 }, 3: { coins: 30 }, 5: { board: 'lava' },
  7: { coins: 40 }, 9: { coins: 40 }, 10: { pieces: 'gold' }, 12: { coins: 50 },
  15: { board: 'emerald' }, 18: { coins: 60 }, 20: { pieces: 'fire' }, 22: { coins: 70 },
  25: { coins: 100 }, 28: { coins: 100 }, 30: { coins: 250 },
};
const PREMIUM = {
  1: { coins: 50 }, 4: { coins: 60 }, 6: { coins: 75 }, 8: { board: 'galaxy' },
  11: { coins: 80 }, 14: { coins: 90 }, 16: { pieces: 'shadow' }, 19: { coins: 100 },
  21: { coins: 100 }, 24: { board: 'royal' }, 27: { coins: 150 }, 30: { pieces: 'diamond' },
};

export const BATTLEPASS = Array.from({ length: MAX_TIER }, (_, i) => {
  const tier = i + 1;
  return { tier, free: FREE[tier] || null, premium: PREMIUM[tier] || null };
});

export function tierFromXp(xp) {
  return Math.min(MAX_TIER, Math.floor(xp / XP_PER_TIER));
}

// ---------- KI-Stufen ----------
export const AI_LEVELS = [
  { id: 1, name: 'Anfänger', elo: 400, depth: 1, randomness: 0.6, xpMult: 0.4, avatar: '🐣' },
  { id: 2, name: 'Einsteiger', elo: 800, depth: 2, randomness: 0.35, xpMult: 0.6, avatar: '🐢' },
  { id: 3, name: 'Fortgeschritten', elo: 1200, depth: 2, randomness: 0.12, xpMult: 0.8, avatar: '🦊' },
  { id: 4, name: 'Experte', elo: 1600, depth: 3, randomness: 0.04, xpMult: 1.0, avatar: '🦉' },
  { id: 5, name: 'Meister', elo: 2000, depth: 4, randomness: 0, xpMult: 1.2, avatar: '🐺' },
  { id: 6, name: 'Großmeister', elo: 2200, depth: 5, randomness: 0, xpMult: 1.4, avatar: '🐉' },
];

// ---------- Belohnungen pro Partie ----------
// result: 'win' | 'draw' | 'loss'; mode: 'ranked' | 'ai' | 'casual'
export function gameRewards(result, mode, aiLevel = 3) {
  const baseXp = { win: 60, draw: 35, loss: 20 }[result];
  const baseCoins = { win: 20, draw: 10, loss: 5 }[result];
  let mult = 1;
  if (mode === 'ranked') mult = 1.5;
  else if (mode === 'ai') mult = (AI_LEVELS.find((l) => l.id === aiLevel) || AI_LEVELS[2]).xpMult;
  else if (mode === 'casual') mult = 1;
  return { xp: Math.round(baseXp * mult), coins: Math.round(baseCoins * mult) };
}

// ---------- Elo ----------
export function expectedScore(ra, rb) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

// score: 1 = Sieg, 0.5 = Remis, 0 = Niederlage (aus Sicht von A)
export function eloChange(ra, rb, score, gamesPlayed = 30) {
  const k = gamesPlayed < 30 ? 40 : ra >= 2400 ? 10 : 20;
  return Math.round(k * (score - expectedScore(ra, rb)));
}

export function rankName(elo) {
  if (elo >= 2200) return 'Großmeister';
  if (elo >= 1900) return 'Meister';
  if (elo >= 1600) return 'Diamant';
  if (elo >= 1400) return 'Platin';
  if (elo >= 1200) return 'Gold';
  if (elo >= 1000) return 'Silber';
  return 'Bronze';
}

// ---------- Tagesaufgaben ----------
// event + match: welche Ereignisse zählen (die Prüfung läuft auf dem Server)
export const QUESTS = [
  { id: 'play3', text: 'Spiele 3 Partien (egal welche)', icon: '♟', target: 3, coins: 30, xp: 30 },
  { id: 'win2', text: 'Gewinne 2 Online-Partien', icon: '🏆', target: 2, coins: 50, xp: 50 },
  { id: 'aiStrong', text: 'Besiege den Computer ab Stufe „Experte“', icon: '🦉', target: 1, coins: 40, xp: 40 },
  { id: 'puzzle5', text: 'Löse 5 Rätsel', icon: '🧩', target: 5, coins: 30, xp: 30 },
  { id: 'rush10', text: 'Schaffe 10 Punkte im Puzzle Rush', icon: '⚡', target: 1, coins: 40, xp: 40 },
  { id: 'fourp1', text: 'Spiele eine 4-Spieler-Partie', icon: '🎲', target: 1, coins: 30, xp: 30 },
  { id: 'fourpTop2', text: 'Werde 1. oder 2. im 4-Spieler-Schach', icon: '🥈', target: 1, coins: 50, xp: 50 },
  { id: 'bullet2', text: 'Spiele 2 Bullet-Partien online', icon: '⚡', target: 2, coins: 30, xp: 30 },
  { id: 'daily', text: 'Löse das tägliche Rätsel', icon: '📅', target: 1, coins: 20, xp: 20 },
  { id: 'tourney', text: 'Spiele eine Turnierpartie', icon: '🏟️', target: 1, coins: 40, xp: 40 },
  { id: 'long', text: 'Spiele eine Partie mit mindestens 40 Zügen', icon: '⏳', target: 1, coins: 30, xp: 30 },
];
export const QUESTS_PER_DAY = 3;
export const QUEST_ALL_BONUS = 50;

// Login-Bonus: 10 Münzen pro Tag in Folge, höchstens 70
export function loginBonusCoins(streak) { return 10 * Math.min(Math.max(1, streak), 7); }

// ---------- Erfolge ----------
export const ACHIEVEMENTS = [
  { id: 'first_win', name: 'Erster Sieg', desc: 'Gewinne eine Online-Partie', icon: '🎉', coins: 25 },
  { id: 'wins10', name: 'Siegertyp', desc: 'Gewinne 10 Online-Partien', icon: '🏅', coins: 50 },
  { id: 'wins50', name: 'Unaufhaltsam', desc: 'Gewinne 50 Online-Partien', icon: '👑', coins: 150 },
  { id: 'quick_mate', name: 'Blitzmatt', desc: 'Setze online in höchstens 10 Zügen matt', icon: '💥', coins: 50 },
  { id: 'elo1400', name: 'Platin', desc: 'Erreiche 1400 Elo in Bullet, Blitz oder Schnellschach', icon: '💠', coins: 50 },
  { id: 'elo1600', name: 'Diamant', desc: 'Erreiche 1600 Elo', icon: '💎', coins: 100 },
  { id: 'elo1900', name: 'Meister', desc: 'Erreiche 1900 Elo', icon: '🏆', coins: 200 },
  { id: 'ai_master', name: 'Wolfsjäger', desc: 'Besiege den Computer „Meister“', icon: '🐺', coins: 75 },
  { id: 'ai_gm', name: 'Drachentöter', desc: 'Besiege den Computer „Großmeister“', icon: '🐉', coins: 150 },
  { id: 'puzzle50', name: 'Taktiker', desc: 'Löse 50 gewertete Rätsel', icon: '🧩', coins: 50 },
  { id: 'puzzle200', name: 'Rätselkönig', desc: 'Löse 200 gewertete Rätsel', icon: '🧠', coins: 150 },
  { id: 'puzzle1600', name: 'Scharfer Blick', desc: 'Erreiche 1600 Taktik-Wertung', icon: '🎯', coins: 100 },
  { id: 'rush15', name: 'Schnelldenker', desc: 'Schaffe 15 Punkte im Puzzle Rush', icon: '⚡', coins: 50 },
  { id: 'rush30', name: 'Turbo-Hirn', desc: 'Schaffe 30 Punkte im Puzzle Rush', icon: '🚀', coins: 150 },
  { id: 'fp_win', name: 'Herrscher der vier', desc: 'Gewinne eine 4-Spieler-Partie', icon: '🎲', coins: 50 },
  { id: 'fp_wins10', name: 'Kreuzritter', desc: 'Gewinne 10 4-Spieler-Partien', icon: '⚔️', coins: 150 },
  { id: 'tourney_play', name: 'Turnierluft', desc: 'Spiele in einem Arena-Turnier mit', icon: '🏟️', coins: 25 },
  { id: 'tourney_podium', name: 'Aufs Treppchen', desc: 'Werde Top 3 in einem Turnier (ab 4 Spielern)', icon: '🥉', coins: 100 },
  { id: 'tourney_win', name: 'Turniersieger', desc: 'Gewinne ein Turnier (ab 4 Spielern)', icon: '🏆', coins: 200 },
  { id: 'streak7', name: 'Stammgast', desc: 'Komm 7 Tage in Folge vorbei', icon: '📆', coins: 75 },
  { id: 'daily7', name: 'Rätsel-Routine', desc: 'Löse das tägliche Rätsel 7 Tage in Folge', icon: '📅', coins: 75 },
  { id: 'friends5', name: 'Gesellig', desc: 'Habe 5 Freunde', icon: '👥', coins: 40 },
  { id: 'collector', name: 'Sammler', desc: 'Besitze 8 Skins', icon: '🎨', coins: 75 },
  { id: 'pass10', name: 'Aufsteiger', desc: 'Erreiche Battlepass-Stufe 10', icon: '🎖️', coins: 50 },
  { id: 'pass30', name: 'Saison-Held', desc: 'Erreiche Battlepass-Stufe 30', icon: '🌟', coins: 200 },
];

// ---------- Arena-Turniere ----------
// Jede halbe Stunde startet eine Arena (UTC-Halbstunden). Punkte: Sieg 2, Remis 1; ab 2 Siegen in Folge doppelt (🔥).
export const ARENA_SCHEDULE = [
  { minute: 0, name: 'Blitz-Arena', tc: '3+0', duration: 25 },
  { minute: 30, name: 'Bullet-Arena', tc: '1+0', duration: 20 },
];
export const ARENA_PRIZES = [300, 150, 75];

// ---------- Emotes ----------
export const EMOTES = ['👍', '😂', '😮', '😡', '😢', '🔥', '🤝', 'GG'];

// ---------- Eigene Turniere ----------
export const CUSTOM_TOURNEY = {
  durations: [10, 20, 30, 45, 60, 90],        // Minuten
  startIns: [1, 5, 10, 15, 30, 60, 120, 240], // Start in … Minuten
  maxPool: 2000,                             // Preistopf aus eigenen Münzen
  shares: [0.5, 0.3, 0.2],                   // Aufteilung Platz 1–3
  maxActive: 30,
};

// Namensänderung: höchstens alle 7 Tage
export const RENAME_COOLDOWN_DAYS = 7;
