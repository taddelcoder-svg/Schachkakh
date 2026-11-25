import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'schach-'));
const db = await import('../server/db.js');
const { applyElo, applyRewards, buySkin, buyPremium, claimTier, equipSkin, GameError } = await import('../server/progress.js');
const { applyMultiElo } = await import('../server/progress.js');
const { eloChange, tierFromXp } = await import('../shared/catalog.js');

test('Elo: gleich starke Spieler tauschen K/2 Punkte', () => {
  assert.equal(eloChange(1200, 1200, 1, 0), 20);
  assert.equal(eloChange(1200, 1200, 0, 0), -20);
  assert.equal(eloChange(1200, 1200, 0.5, 50), 0);
  assert.ok(eloChange(1000, 1600, 1, 50) > eloChange(1600, 1000, 1, 50));
});

test('applyElo aktualisiert Statistik beider Spieler', () => {
  const a = db.createUser('Alpha', 'secret1');
  const b = db.createUser('Beta', 'secret1');
  const d = applyElo(a, b, 1, 'blitz');
  assert.equal(a.ratings.blitz.elo, 1200 + d.white);
  assert.equal(b.ratings.blitz.elo, 1200 + d.black);
  assert.equal(a.ratings.blitz.wins, 1); assert.equal(b.ratings.blitz.losses, 1);
  assert.equal(a.ratings.bullet.games, 0, 'andere Wertungen bleiben unberührt');
});

test('Shop: kaufen, ausrüsten, Battlepass-Skins nicht kaufbar', () => {
  const u = db.createUser('Shopper', 'secret1');
  u.coins = 1000;
  buySkin(u, 'board', 'ocean');
  assert.equal(u.coins, 800);
  equipSkin(u, 'board', 'ocean');
  assert.equal(u.equipped.board, 'ocean');
  assert.throws(() => buySkin(u, 'board', 'ocean'), GameError);
  assert.throws(() => buySkin(u, 'board', 'lava'), GameError);
  assert.throws(() => equipSkin(u, 'pieces', 'neon'), GameError);
});

test('Battlepass: Stufen freispielen und abholen', () => {
  const u = db.createUser('Passer', 'secret1');
  assert.throws(() => claimTier(u, 'free', 1), GameError);
  for (let i = 0; i < 4; i++) applyRewards(u, 'win', 'ranked'); // 4 × 90 XP
  assert.equal(tierFromXp(u.pass.xp), 3);
  const coins = u.coins;
  claimTier(u, 'free', 1);
  assert.equal(u.coins, coins + 25);
  assert.throws(() => claimTier(u, 'free', 1), GameError);
  assert.throws(() => claimTier(u, 'premium', 1), GameError);
  u.coins = 1000;
  buyPremium(u);
  claimTier(u, 'premium', 1);
  assert.equal(u.coins, 1000 - 600 + 50);
});

test('Passwort-Prüfung', () => {
  const u = db.createUser('Login', 'richtig1');
  assert.ok(db.checkPassword(u, 'richtig1'));
  assert.ok(!db.checkPassword(u, 'falsch11'));
});

test('4-Spieler-Elo: Platz 1 gewinnt, Platz 4 verliert', () => {
  const us = ['V1', 'V2', 'V3', 'V4'].map((n) => db.createUser(n, 'secret1'));
  const d = applyMultiElo(us.map((user, i) => ({ user, place: i + 1 })));
  assert.ok(d[0] > 0 && d[3] < 0);
  assert.ok(d[0] > d[1]);
});
