// Gemeinsame Spieldaten für Server und Browser: Skins, Battlepass, Belohnungen, Elo.

export const START_ELO = 1200;
export const START_COINS = 150;

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
  { id: 1, name: 'Anfänger',      depth: 1, randomness: 0.6, xpMult: 0.5 },
  { id: 2, name: 'Fortgeschritten', depth: 2, randomness: 0.25, xpMult: 0.8 },
  { id: 3, name: 'Experte',       depth: 3, randomness: 0.05, xpMult: 1.0 },
  { id: 4, name: 'Großmeister',   depth: 4, randomness: 0, xpMult: 1.3 },
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
