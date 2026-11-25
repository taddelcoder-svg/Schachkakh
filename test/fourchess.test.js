import test from 'node:test';
import assert from 'node:assert/strict';
import { FourChess, botMove, idx, COLORS } from '../shared/fourchess.js';

test('Startstellung: jeder hat 20 Züge, Rot beginnt', () => {
  const g = new FourChess();
  assert.equal(g.turn, 'r');
  for (const c of COLORS) assert.equal(g.legalMoves(c).length, 20);
});

test('Zugreihenfolge und Doppelschritt', () => {
  const g = new FourChess();
  assert.ok(g.move({ from: idx(7, 1), to: idx(7, 3) }));
  assert.equal(g.turn, 'b');
  assert.ok(g.move({ from: idx(1, 6), to: idx(3, 6) }));
  assert.equal(g.turn, 'y');
  assert.equal(g.move({ from: idx(7, 3), to: idx(7, 4) }), null, 'Rot ist nicht dran');
});

test('Schlagen bringt Punkte, Aufgabe scheidet aus', () => {
  const g = new FourChess();
  g.board[idx(6, 2)] = { c: 'b', t: 'n', moved: true };
  const rec = g.move({ from: idx(7, 1), to: idx(6, 2) });
  assert.equal(rec.gained, 3);
  assert.equal(g.points.r, 3);
  g.resign('b');
  assert.equal(g.active.b, false);
  assert.equal(g.turn, 'y');
});

test('Bot-Partien laufen regelkonform zu Ende', () => {
  for (let n = 0; n < 5; n++) {
    const g = new FourChess();
    let plies = 0;
    while (!g.over && plies < 2000) { const m = botMove(g); assert.ok(m); assert.ok(g.move(m)); plies++; }
    assert.ok(g.over, 'Partie endet');
    const places = g.places();
    assert.equal(Object.keys(places).length, 4);
  }
});
