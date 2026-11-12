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

// Elo-Update für eine gewertete Partie. scoreWhite: 1 / 0.5 / 0
export function applyElo(white, black, scoreWhite) {
  const dW = eloChange(white.elo, black.elo, scoreWhite, white.games);
  const dB = eloChange(black.elo, white.elo, 1 - scoreWhite, black.games);
  for (const [u, d, s] of [[white, dW, scoreWhite], [black, dB, 1 - scoreWhite]]) {
    u.elo = Math.max(100, u.elo + d);
    u.peakElo = Math.max(u.peakElo, u.elo);
    u.games += 1;
    if (s === 1) u.wins += 1; else if (s === 0) u.losses += 1; else u.draws += 1;
  }
  save();
  return { white: dW, black: dB };
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
