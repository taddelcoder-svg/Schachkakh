import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'schach-ev-'));
const db = await import('../server/db.js');
const ev = await import('../server/events.js');
const tour = await import('../server/tournaments.js');
const { QUESTS } = await import('../shared/catalog.js');

test('Tagesaufgaben: 3 Stück, Fortschritt und Belohnung', () => {
  const u = db.createUser('Quester', 'secret1');
  ev.ensureState(u);
  assert.equal(u.quests.list.length, 3);
  assert.equal(new Set(u.quests.list.map((q) => q.id)).size, 3);
  // Jede Aufgabe gezielt erfüllen
  const coins = u.coins;
  for (const q of u.quests.list) {
    const def = QUESTS.find((x) => x.id === q.id);
    for (let i = 0; i < def.target; i++) {
      const map = {
        play3: ['game', { kind: 'ai', result: 'loss' }], win2: ['game', { kind: '2p', online: true, result: 'win' }],
        aiStrong: ['game', { kind: 'ai', result: 'win', aiLevel: 4 }], puzzle5: ['puzzle', { solved: true }],
        rush10: ['rush', { score: 12 }], fourp1: ['game', { kind: '4p', place: 3 }], fourpTop2: ['game', { kind: '4p', place: 2 }],
        bullet2: ['game', { kind: '2p', online: true, type: 'bullet', result: 'loss' }], daily: ['daily', {}],
        tourney: ['game', { kind: '2p', online: true, tournament: true, result: 'draw' }], long: ['game', { kind: 'ai', plies: 90 }],
      };
      ev.track(u, ...map[q.id]);
    }
  }
  assert.ok(u.quests.list.every((q) => q.done), JSON.stringify(u.quests));
  assert.ok(u.quests.bonus);
  assert.ok(u.coins > coins + 50);
});

test('Login-Bonus nur einmal pro Tag', () => {
  const u = db.createUser('Login2', 'secret1');
  const b = ev.claimLoginBonus(u);
  assert.equal(b.streak, 1);
  assert.equal(b.coins, 10);
  assert.equal(ev.claimLoginBonus(u), null);
});

test('Erfolge: erster Sieg und Blitzmatt', () => {
  const u = db.createUser('Achiever', 'secret1');
  ev.track(u, 'game', { kind: '2p', online: true, result: 'win', mate: true, plies: 7 });
  assert.ok(u.achievements.first_win);
  assert.ok(u.achievements.quick_mate);
  const coins = u.coins;
  ev.track(u, 'game', { kind: '2p', online: true, result: 'win', mate: true, plies: 7 });
  assert.equal(u.coins >= coins, true);
});

test('Arena: Punkte, Siegesserie verdoppelt', () => {
  const started = [];
  tour.initTournaments({
    startGame: (w, b, tc) => { const g = { id: 'g' + started.length, tournamentId: null, chess: { history: () => ['e4', 'e5'] } }; started.push({ g, w, b }); return g; },
    isOnline: () => true, inGame: () => false, sendUser: () => {}, sendWs: () => {},
  });
  const t = [...tour._tournaments().values()][0];
  t.status = 'running'; t.startsAt = Date.now() - 1000; t.endsAt = Date.now() + 600_000;
  const a = db.createUser('ArenaA', 'secret1'), b = db.createUser('ArenaB', 'secret1');
  const ws = {};
  tour.onTournamentMessage(a, ws, { type: 'tournament_join', id: t.id });
  tour.onTournamentMessage(b, ws, { type: 'tournament_join', id: t.id });
  const play = (winnerUser) => {
    for (const p of t.players.values()) p.lastEnd = 0;
    tour._tick();
    const { g, w, b: bl } = started.at(-1);
    g.tournamentId = t.id;
    t.games.add(g.id);
    return tour.onTournamentGameEnd(g, winnerUser.id === w.id ? 'w' : 'b', w, bl);
  };
  play(a); play(a); const third = play(a);
  const pa = t.players.get(a.id);
  assert.equal(pa.score, 2 + 2 + 4, 'dritter Sieg in Folge zählt doppelt');
  assert.ok(Object.values(third).some((x) => x.fire));
  assert.equal(t.players.get(b.id).score, 0);
});
