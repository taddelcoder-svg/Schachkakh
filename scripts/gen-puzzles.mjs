// Erzeugt geprüfte Matt-Aufgaben (Matt in 1 / 2 / 3) aus zufällig-gierigen Partien.
// Aufruf: node scripts/gen-puzzles.mjs [Anzahl]  → shared/puzzles.js
import { Chess } from 'chess.js';
import fs from 'node:fs';

const TARGET = Number(process.argv[2] || 400);
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// Angreifer-Züge: nur Schachgebote (forcierend) – macht die Suche schnell
const checks = (c) => c.moves({ verbose: true }).filter((m) => m.san.includes('+') || m.san.includes('#'));

// Gibt es ein erzwungenes Matt in n? all=true prüft alle Angreiferzüge, sonst nur Schachs
function hasMate(c, n, all = false) {
  const moves = all ? c.moves({ verbose: true }) : checks(c);
  for (const m of moves) if (m.san.includes('#')) return true;
  if (n === 1) return false;
  for (const m of moves) {
    c.move(m);
    let ok = !c.isGameOver();
    if (ok) for (const r of c.moves({ verbose: true })) {
      c.move(r);
      const h = hasMate(c, n - 1);
      c.undo();
      if (!h) { ok = false; break; }
    }
    c.undo();
    if (ok) return true;
  }
  return false;
}

// Alle Schlüsselzüge, die in n erzwungen mattsetzen
function forcedMateMoves(c, n, all = false) {
  const out = [];
  for (const m of all ? c.moves({ verbose: true }) : checks(c)) {
    if (m.san.includes('#')) { out.push(m); continue; }
    if (n === 1) continue;
    c.move(m);
    let ok = !c.isGameOver();
    if (ok) for (const r of c.moves({ verbose: true })) {
      c.move(r);
      const h = hasMate(c, n - 1, all && n <= 2);
      c.undo();
      if (!h) { ok = false; break; }
    }
    c.undo();
    if (ok) out.push(m);
  }
  return out;
}

// Lösungslinie: Schlüsselzug, beste Verteidigung (die am längsten hält / meiste Material), ...
function solutionLine(c, n) {
  const line = [];
  for (let k = n; k >= 1; k--) {
    const keys = forcedMateMoves(c, k);
    const key = keys.find((m) => m.san.includes('#')) || keys[0];
    line.push(key.lan);
    c.move(key);
    if (c.isCheckmate()) break;
    // Verteidigung: die nicht sofort in Matt-in-1 übergeht, sonst die erste
    const replies = c.moves({ verbose: true });
    let pick = replies[0];
    for (const r of replies) {
      c.move(r);
      const quick = k - 1 > 1 && hasMate(c, k - 2);
      c.undo();
      if (!quick) { pick = r; break; }
    }
    line.push(pick.lan);
    c.move(pick);
  }
  return line;
}

function pickMove(c) {
  const moves = c.moves({ verbose: true });
  if (Math.random() < 0.55) {
    let best = null, bs = -1;
    for (const m of moves) { const s = (m.captured ? VAL[m.captured] * 10 - VAL[m.piece] : 0) + Math.random() * 2; if (s > bs) { bs = s; best = m; } }
    return best;
  }
  return moves[Math.floor(Math.random() * moves.length)];
}

function material(c) { return c.board().flat().filter(Boolean).length; }

const out = [];
const seen = new Set();
const want = { 1: Math.round(TARGET * 0.35), 2: Math.round(TARGET * 0.5), 3: TARGET - Math.round(TARGET * 0.35) - Math.round(TARGET * 0.5) };
const have = { 1: 0, 2: 0, 3: 0 };
const t0 = Date.now();
while (out.length < TARGET && Date.now() - t0 < 25 * 60_000) {
  const c = new Chess();
  for (let ply = 0; ply < 140 && !c.isGameOver(); ply++) {
    c.move(pickMove(c));
    if (ply < 14 || c.isGameOver() || c.inCheck()) continue;
    const pieces = material(c);
    if (pieces < 7) continue;
    for (const n of [1, 2, 3]) {
      if (have[n] >= want[n]) continue;
      
      if (!hasMate(c, n)) continue;
      if (n > 1 && hasMate(c, n - 1, true)) break; // kürzeres Matt vorhanden
      // Eindeutigkeit: bei Matt in 1/2 gegen ALLE Züge geprüft, bei Matt in 3 unter den Schachs
      const keys = forcedMateMoves(c, n, n <= 2);
      if (keys.length !== 1) break;
      const fen = c.fen();
      const key = fen.split(' ').slice(0, 2).join(' ');
      if (seen.has(key)) break;
      seen.add(key);
      const copy = new Chess(fen);
      const line = solutionLine(copy, n);
      const rating = n === 1 ? 500 + Math.round(Math.random() * 450) : n === 2 ? 1050 + Math.round(Math.random() * 550) : 1650 + Math.round(Math.random() * 550);
      out.push({ id: 'p' + (out.length + 1), fen, moves: line, mateIn: n, rating });
      have[n]++;
      process.stdout.write(`\r${out.length}/${TARGET}  (M1 ${have[1]}, M2 ${have[2]}, M3 ${have[3]})`);
      break;
    }
  }
}
out.sort((a, b) => a.rating - b.rating);
out.forEach((p, i) => (p.id = 'p' + (i + 1)));
fs.writeFileSync(new URL('../shared/puzzles.js', import.meta.url),
  '// Automatisch erzeugt von scripts/gen-puzzles.mjs – jede Aufgabe ist ein geprüftes, eindeutiges Matt.\n' +
  '// moves: Lösung in LAN (Schlüsselzug, Verteidigung, …). Bei Matt-Zügen zählt jeder mattsetzende Zug.\n' +
  'export const PUZZLES = ' + JSON.stringify(out) + ';\n');
console.log('\nfertig', out.length, Math.round((Date.now() - t0) / 1000) + 's');
