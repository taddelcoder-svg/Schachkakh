// Tagesaufgaben, Login-Bonus und Erfolge. Jedes Spiel-Ereignis läuft über track().
import crypto from 'node:crypto';
import {
  QUESTS, QUESTS_PER_DAY, QUEST_ALL_BONUS, ACHIEVEMENTS, loginBonusCoins, tierFromXp,
} from '../shared/catalog.js';
import { save } from './db.js';

const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

// Benachrichtigung an den Spieler (wird von online.js gesetzt, damit es per WebSocket ankommt)
let notifier = () => {};
export function setNotifier(fn) { notifier = fn; }

export function ensureState(user) {
  user.stats ||= {};
  user.achievements ||= {};
  user.daily ||= { last: null, streak: 0 };
  const d = today();
  if (!user.quests || user.quests.date !== d) {
    // Deterministische Auswahl pro Spieler und Tag
    const pool = [...QUESTS];
    const picked = [];
    let seed = parseInt(crypto.createHash('sha1').update(user.id + d).digest('hex').slice(0, 8), 16);
    while (picked.length < QUESTS_PER_DAY && pool.length) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      picked.push(pool.splice(seed % pool.length, 1)[0].id);
    }
    user.quests = { date: d, list: picked.map((id) => ({ id, progress: 0, done: false })), bonus: false };
  }
}

// Login-Bonus einmal pro Tag; gibt { streak, coins } zurück oder null
export function claimLoginBonus(user) {
  ensureState(user);
  const d = today();
  if (user.daily.last === d) return null;
  user.daily.streak = user.daily.last === yesterday() ? user.daily.streak + 1 : 1;
  user.daily.last = d;
  const coins = loginBonusCoins(user.daily.streak);
  user.coins += coins;
  save();
  checkAchievements(user, null, []);
  return { streak: user.daily.streak, coins };
}

// Wie viel zählt ein Ereignis für eine Aufgabe?
function questGain(id, event, d) {
  switch (id) {
    case 'play3': return event === 'game' ? 1 : 0;
    case 'win2': return event === 'game' && d.kind === '2p' && d.online && d.result === 'win' ? 1 : 0;
    case 'aiStrong': return event === 'game' && d.kind === 'ai' && d.result === 'win' && d.aiLevel >= 4 ? 1 : 0;
    case 'puzzle5': return event === 'puzzle' && d.solved ? 1 : 0;
    case 'rush10': return event === 'rush' && d.score >= 10 ? 1 : 0;
    case 'fourp1': return event === 'game' && d.kind === '4p' ? 1 : 0;
    case 'fourpTop2': return event === 'game' && d.kind === '4p' && d.place <= 2 ? 1 : 0;
    case 'bullet2': return event === 'game' && d.kind === '2p' && d.online && d.type === 'bullet' ? 1 : 0;
    case 'daily': return event === 'daily' ? 1 : 0;
    case 'tourney': return event === 'game' && d.tournament ? 1 : 0;
    case 'long': return event === 'game' && (d.plies || 0) >= 80 ? 1 : 0;
    default: return 0;
  }
}

/**
 * Ereignis verbuchen. event: 'game' | 'puzzle' | 'rush' | 'daily' | 'tournament' | 'state'
 * d (bei 'game'): { kind: '2p'|'4p'|'ai', online, result, type, aiLevel, place, plies, tournament, mate }
 */
export function track(user, event, d = {}) {
  ensureState(user);
  const notes = [];
  const st = user.stats;
  if (event === 'game') {
    st.games = (st.games || 0) + 1;
    if (d.kind === '2p' && d.online && d.result === 'win') st.onlineWins = (st.onlineWins || 0) + 1;
    if (d.kind === '4p' && d.place === 1) st.fpWins = (st.fpWins || 0) + 1;
  }
  if (event === 'tournament') {
    st.tourneys = (st.tourneys || 0) + 1;
  }

  for (const q of user.quests.list) {
    if (q.done) continue;
    const def = QUESTS.find((x) => x.id === q.id);
    const gain = questGain(q.id, event, d);
    if (!def || !gain) continue;
    q.progress = Math.min(def.target, q.progress + gain);
    if (q.progress >= def.target) {
      q.done = true;
      user.coins += def.coins;
      user.pass.xp += def.xp;
      notes.push({ kind: 'quest', icon: def.icon, text: def.text, coins: def.coins, xp: def.xp });
    }
  }
  if (!user.quests.bonus && user.quests.list.every((q) => q.done)) {
    user.quests.bonus = true;
    user.coins += QUEST_ALL_BONUS;
    notes.push({ kind: 'quest', icon: '🎁', text: 'Alle Tagesaufgaben erledigt!', coins: QUEST_ALL_BONUS, xp: 0 });
  }
  checkAchievements(user, { event, ...d }, notes);
  save();
  if (notes.length) notifier(user.id, notes);
  return notes;
}

function bestElo(u) {
  return Math.max(u.ratings.bullet.elo, u.ratings.blitz.elo, u.ratings.rapid.elo);
}

function achieved(id, u, e) {
  const st = u.stats;
  switch (id) {
    case 'first_win': return (st.onlineWins || 0) >= 1;
    case 'wins10': return (st.onlineWins || 0) >= 10;
    case 'wins50': return (st.onlineWins || 0) >= 50;
    case 'quick_mate': return e?.event === 'game' && e.kind === '2p' && e.online && e.result === 'win' && e.mate && e.plies <= 20;
    case 'elo1400': return bestElo(u) >= 1400;
    case 'elo1600': return bestElo(u) >= 1600;
    case 'elo1900': return bestElo(u) >= 1900;
    case 'ai_master': return e?.event === 'game' && e.kind === 'ai' && e.result === 'win' && e.aiLevel >= 5;
    case 'ai_gm': return e?.event === 'game' && e.kind === 'ai' && e.result === 'win' && e.aiLevel >= 6;
    case 'puzzle50': return u.ratings.puzzle.wins >= 50;
    case 'puzzle200': return u.ratings.puzzle.wins >= 200;
    case 'puzzle1600': return u.ratings.puzzle.elo >= 1600;
    case 'rush15': return (u.puzzles?.rushBest || 0) >= 15;
    case 'rush30': return (u.puzzles?.rushBest || 0) >= 30;
    case 'fp_win': return (st.fpWins || 0) >= 1;
    case 'fp_wins10': return (st.fpWins || 0) >= 10;
    case 'tourney_play': return (st.tourneys || 0) >= 1;
    case 'tourney_podium': return e?.event === 'tournament' && e.place <= 3 && e.games > 0;
    case 'tourney_win': return e?.event === 'tournament' && e.place === 1 && e.games > 0;
    case 'streak7': return (u.daily?.streak || 0) >= 7;
    case 'daily7': return (u.puzzles?.dailyStreak || 0) >= 7;
    case 'friends5': return (u.friends?.length || 0) >= 5;
    case 'collector': return u.owned.board.length + u.owned.pieces.length >= 8;
    case 'pass10': return tierFromXp(u.pass.xp) >= 10;
    case 'pass30': return tierFromXp(u.pass.xp) >= 30;
    default: return false;
  }
}

export function checkAchievements(user, e, notes = []) {
  ensureState(user);
  let any = false;
  for (const a of ACHIEVEMENTS) {
    if (user.achievements[a.id]) continue;
    if (!achieved(a.id, user, e)) continue;
    user.achievements[a.id] = Date.now();
    user.coins += a.coins;
    notes.push({ kind: 'achievement', icon: a.icon, text: a.name, desc: a.desc, coins: a.coins });
    any = true;
  }
  if (any) save();
  if (!e && notes.length) notifier(user.id, notes.splice(0));
  return notes;
}
