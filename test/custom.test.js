import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'schach-cu-'));
const db = await import('../server/db.js');
const tour = await import('../server/tournaments.js');

const sent = [];
const started = [];
tour.initTournaments({
  startGame: (w, b, tc, ranked) => { const g = { id: 'g' + started.length, ranked, chess: { history: () => ['e4', 'e5'] } }; started.push({ g, w, b, ranked }); return g; },
  isOnline: () => true, inGame: () => false, sendUser: (id, m) => sent.push([id, m]), sendWs: (ws, m) => sent.push(['ws', m]),
});

test('Name ändern: Partien und Turniere zeigen den neuen Namen', () => {
  const u = db.createUser('AlterName', 'secret1');
  db.recordGame({ id: 'r1', kind: '2p', white: { id: u.id, name: 'AlterName' }, black: { id: 'x', name: 'X' }, result: 'w', pgn: '' });
  const old = db.renameUser(u, 'NeuerName');
  assert.equal(old, 'AlterName');
  assert.equal(db.getGame('r1').white.name, 'NeuerName');
  assert.equal(db.findUserByName('neuername').id, u.id);
  assert.equal(db.findUserByName('AlterName'), null);
  assert.ok(u.nameChangedAt > 0);
});

test('Passwort ändern meldet andere Geräte ab', () => {
  const u = db.createUser('PwUser', 'secret1');
  const keep = db.createToken(u.id);
  const other = db.createToken(u.id);
  db.setPassword(u, 'neuesPasswort', keep);
  assert.ok(db.checkPassword(u, 'neuesPasswort'));
  assert.ok(!db.checkPassword(u, 'secret1'));
  assert.ok(db.userFromToken(keep));
  assert.equal(db.userFromToken(other), null);
});

test('Eigenes Turnier: Preistopf wird eingezogen und bei Absage erstattet', () => {
  const u = db.createUser('Veranstalter', 'secret1');
  u.coins = 1000;
  const t = tour.createCustom(u, { name: 'Freitagsturnier', tc: '5+0', duration: 30, startIn: 10, prizePool: 400, private: true, rated: false });
  assert.equal(u.coins, 600);
  assert.equal(t.code.length, 6);
  assert.ok(t.players.has(u.id), 'Veranstalter nimmt automatisch teil');
  assert.ok(db.customTournaments().some((x) => x.id === t.id), 'überlebt Neustart');
  assert.throws(() => tour.createCustom(u, { name: 'Zweites', tc: '5+0', duration: 30, startIn: 10 }), /offenes Turnier/);
  // Private Turniere sind für Fremde unsichtbar
  const stranger = db.createUser('Fremder', 'secret1');
  assert.ok(!tour.listTournaments(stranger.id).current.some((x) => x.id === t.id));
  assert.ok(tour.listTournaments(u.id).current.some((x) => x.id === t.id));
  tour.cancelCustom(u, t);
  assert.equal(u.coins, 1000);
  assert.ok(!db.customTournaments().some((x) => x.id === t.id));
});

test('Eigenes Turnier: ungültige Eingaben werden abgelehnt', () => {
  const u = db.createUser('Pruefer', 'secret1');
  u.coins = 100;
  assert.throws(() => tour.createCustom(u, { name: 'ab', tc: '5+0', duration: 30, startIn: 10 }), /Name/);
  assert.throws(() => tour.createCustom(u, { name: 'Gut', tc: '99+0', duration: 30, startIn: 10 }), /Bedenkzeit/);
  assert.throws(() => tour.createCustom(u, { name: 'Gut', tc: '5+0', duration: 7, startIn: 10 }), /Dauer/);
  assert.throws(() => tour.createCustom(u, { name: 'Gut', tc: '5+0', duration: 30, startIn: 10, prizePool: 500 }), /Münzen/);
});

test('Eigenes Turnier: Preise 50/30/20, Rest zurück, ungewertete Partien', () => {
  const host = db.createUser('Gastgeber', 'secret1');
  host.coins = 500;
  const t = tour.createCustom(host, { name: 'Pokal', tc: '3+0', duration: 10, startIn: 1, prizePool: 500, rated: false });
  const a = db.createUser('Spieler1', 'secret1');
  tour.onTournamentMessage(a, {}, { type: 'tournament_join', id: t.id });
  t.startsAt = Date.now() - 1000;
  tour._tick();
  assert.equal(t.status, 'running');
  const last = started.at(-1);
  assert.equal(last.ranked, false, 'ungewertet');
  last.g.tournamentId = t.id;
  t.games.add(last.g.id);
  tour.onTournamentGameEnd(last.g, last.w.id === a.id ? 'w' : 'b', last.w, last.b); // Spieler1 gewinnt
  // Erfolg "Turnierluft" vorab als erreicht markieren, damit nur das Preisgeld gezählt wird
  a.achievements = { tourney_play: 1 }; host.achievements = { tourney_play: 1 };
  const coinsA = a.coins, coinsHost = host.coins;
  t.endsAt = Date.now() - 1;
  tour._tick(); // -> ending
  tour._tick(); // -> finalize
  assert.equal(t.status, 'finished');
  assert.equal(a.coins - coinsA, 250, 'Platz 1 bekommt 50 %');
  assert.equal(host.coins - coinsHost, 250, 'Platz 2 hat 0 Punkte -> Rest zurück an den Gastgeber');
  assert.ok(!db.customTournaments().some((x) => x.id === t.id));
});
