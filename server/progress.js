// Shop, Battlepass und Belohnungslogik (serverseitig = fälschungssicher)
import {
  BOARD_SKINS, PIECE_SKINS, BATTLEPASS, SEASON, tierFromXp, gameRewards, eloChange,
} from '../shared/catalog.js';
import { save } from './db.js';

const SKIN_TABLES = { board: BOARD_SKINS, pieces: PIECE_SKINS };

export class GameError extends Error {}

export function applyRewards(user, result, mode, aiLevel) {
  const r = gameRewards(result, mode, aiLevel);
  user.coins += r.coins;
  const tierBefore = tierFromXp(user.pass.xp);
  user.pass.xp += r.xp;
  const tierAfter = tierFromXp(user.pass.xp);
  save();
  return { ...r, tierBefore, tierAfter };
}

// Elo-Update für eine gewertete Partie in einer Wertungsart. scoreWhite: 1 / 0.5 / 0
export function applyElo(white, black, scoreWhite, type = 'blitz') {
  const rw = white.ratings[type];
  const rb = black.ratings[type];
  const dW = eloChange(rw.elo, rb.elo, scoreWhite, rw.games);
  const dB = eloChange(rb.elo, rw.elo, 1 - scoreWhite, rb.games);
  for (const [r, d, s] of [[rw, dW, scoreWhite], [rb, dB, 1 - scoreWhite]]) {
    r.elo = Math.max(100, r.elo + d);
    r.peak = Math.max(r.peak, r.elo);
    r.games += 1;
    if (s === 1) r.wins += 1; else if (s === 0) r.losses += 1; else r.draws += 1;
  }
  save();
  return { white: dW, black: dB };
}

// Mehrspieler-Elo: jede Paarung zählt als Einzelduell (nach Platzierung), K wird geteilt
export function applyMultiElo(players, type = 'fourp') {
  // players: [{ user, place }] – place 1 = bester
  const n = players.length;
  const deltas = players.map(() => 0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const a = players[i].user.ratings[type];
      const b = players[j].user.ratings[type];
      const score = players[i].place < players[j].place ? 1 : players[i].place > players[j].place ? 0 : 0.5;
      deltas[i] += eloChange(a.elo, b.elo, score, a.games) / (n - 1);
    }
  }
  players.forEach((p, i) => {
    const r = p.user.ratings[type];
    const d = Math.round(deltas[i]);
    r.elo = Math.max(100, r.elo + d);
    r.peak = Math.max(r.peak, r.elo);
    r.games += 1;
    if (p.place === 1) r.wins += 1; else r.losses += 1;
    deltas[i] = d;
  });
  save();
  return deltas;
}

export function buySkin(user, type, id) {
  const skin = SKIN_TABLES[type]?.[id];
  if (!skin) throw new GameError('Unbekannter Skin');
  if (skin.bp) throw new GameError('Dieser Skin ist nur im Battlepass erhältlich');
  if (user.owned[type].includes(id)) throw new GameError('Bereits im Besitz');
  if (user.coins < skin.price) throw new GameError('Nicht genug Münzen');
  user.coins -= skin.price;
  user.owned[type].push(id);
  save();
}

export function equipSkin(user, type, id) {
  if (!SKIN_TABLES[type]) throw new GameError('Unbekannter Typ');
  if (!user.owned[type].includes(id)) throw new GameError('Skin nicht im Besitz');
  user.equipped[type] = id;
  save();
}

export function buyPremium(user) {
  if (user.pass.premium) throw new GameError('Premium-Pass bereits aktiv');
  if (user.coins < SEASON.premiumPrice) throw new GameError('Nicht genug Münzen');
  user.coins -= SEASON.premiumPrice;
  user.pass.premium = true;
  save();
}

export function claimTier(user, track, tier) {
  const entry = BATTLEPASS.find((t) => t.tier === tier);
  if (!entry) throw new GameError('Unbekannte Stufe');
  const reward = track === 'premium' ? entry.premium : track === 'free' ? entry.free : null;
  if (!reward) throw new GameError('Keine Belohnung auf dieser Stufe');
  if (track === 'premium' && !user.pass.premium) throw new GameError('Premium-Pass benötigt');
  if (tierFromXp(user.pass.xp) < tier) throw new GameError('Stufe noch nicht erreicht');
  const claimed = track === 'premium' ? user.pass.claimedPremium : user.pass.claimedFree;
  if (claimed.includes(tier)) throw new GameError('Bereits abgeholt');
  claimed.push(tier);
  if (reward.coins) user.coins += reward.coins;
  if (reward.board && !user.owned.board.includes(reward.board)) user.owned.board.push(reward.board);
  if (reward.pieces && !user.owned.pieces.includes(reward.pieces)) user.owned.pieces.push(reward.pieces);
  save();
  return reward;
}
