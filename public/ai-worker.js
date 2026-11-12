// KI-Gegner: Alpha-Beta-Suche mit Figur-Feld-Tabellen, Zugsortierung und Ruhesuche.
// Läuft als Web Worker, damit die Oberfläche flüssig bleibt.
import { Chess } from '/vendor/chess.js';

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Tabellen aus Sicht von Weiß (Index 0 = a8)
const PST = {
  p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5,
      0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
      -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
      -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
      0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10,
      20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
  kEnd: [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30,
      -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30,
      -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50],
};

const MATE = 100000;
let nodes = 0;
let deadline = Infinity;
class Timeout extends Error {}

// Bewertung aus Sicht der Seite am Zug
function evaluate(chess) {
  const board = chess.board();
  let score = 0;
  let nonPawn = 0;
  for (const row of board) for (const p of row) if (p && p.type !== 'p' && p.type !== 'k') nonPawn += VALUE[p.type];
  const endgame = nonPawn <= 1300;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p) continue;
      const idx = p.color === 'w' ? r * 8 + f : (7 - r) * 8 + f;
      const table = p.type === 'k' && endgame ? PST.kEnd : PST[p.type];
      const v = VALUE[p.type] + table[idx];
      score += p.color === 'w' ? v : -v;
    }
  }
  return chess.turn() === 'w' ? score : -score;
}

function orderMoves(moves) {
  return moves.sort((a, b) => scoreMove(b) - scoreMove(a));
}
function scoreMove(m) {
  let s = 0;
  if (m.captured) s += 10 * VALUE[m.captured] - VALUE[m.piece];
  if (m.promotion) s += VALUE[m.promotion];
  if (m.san.includes('+')) s += 50;
  return s;
}

function quiesce(chess, alpha, beta, depth) {
  nodes++;
  if ((nodes & 1023) === 0 && Date.now() > deadline) throw new Timeout();
  const stand = evaluate(chess);
  if (stand >= beta) return beta;
  if (alpha < stand) alpha = stand;
  if (depth <= 0) return alpha;
  const captures = orderMoves(chess.moves({ verbose: true }).filter((m) => m.captured || m.promotion));
  for (const m of captures) {
    chess.move(m);
    const score = -quiesce(chess, -beta, -alpha, depth - 1);
    chess.undo();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function search(chess, depth, alpha, beta, ply, useQuiesce) {
  nodes++;
  if ((nodes & 1023) === 0 && Date.now() > deadline) throw new Timeout();
  if (depth === 0) return useQuiesce ? quiesce(chess, alpha, beta, 4) : evaluate(chess);
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return chess.inCheck() ? -MATE + ply : 0;
  if (ply > 0 && (chess.isThreefoldRepetition() || chess.isInsufficientMaterial())) return 0;
  orderMoves(moves);
  for (const m of moves) {
    chess.move(m);
    const score = -search(chess, depth - 1, -beta, -alpha, ply + 1, useQuiesce);
    chess.undo();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

// Gibt alle Wurzelzüge mit Bewertung zurück (iterative Vertiefung)
function rootSearch(chess, maxDepth, timeMs, useQuiesce, exact) {
  deadline = Date.now() + timeMs;
  nodes = 0;
  let moves = orderMoves(chess.moves({ verbose: true }));
  let scored = moves.map((m) => ({ move: m, score: 0 }));
  for (let depth = 1; depth <= maxDepth; depth++) {
    const current = [];
    try {
      let alpha = -Infinity;
      for (const { move } of scored) {
        chess.move(move);
        // exact: volle Fensterbreite, damit die Zufallsauswahl echte Werte vergleicht
        const score = exact
          ? -search(chess, depth - 1, -Infinity, Infinity, 1, useQuiesce)
          : -search(chess, depth - 1, -Infinity, -alpha, 1, useQuiesce);
        chess.undo();
        current.push({ move, score });
        if (score > alpha) alpha = score;
      }
    } catch (e) {
      if (e instanceof Timeout) { while (chess.history().length > baseLen) chess.undo(); break; }
      throw e;
    }
    scored = current.sort((a, b) => b.score - a.score);
    if (scored[0].score > MATE - 100) break; // Matt gefunden
  }
  return scored;
}
let baseLen = 0;

self.onmessage = ({ data }) => {
  const { fen, pgn, depth, randomness, timeMs } = data;
  const chess = new Chess();
  if (pgn) chess.loadPgn(pgn); else chess.load(fen);
  baseLen = chess.history().length;
  const scored = rootSearch(chess, depth, timeMs ?? 4000, depth >= 3, randomness > 0);
  if (scored.length === 0) return self.postMessage({ move: null });

  // Schwächere Stufen wählen manchmal einen schlechteren Zug
  let pick = scored[0];
  if (randomness > 0 && Math.random() < randomness) {
    const tolerance = 150 + randomness * 400;
    const ok = scored.filter((s) => s.score >= scored[0].score - tolerance);
    pick = ok[Math.floor(Math.random() * ok.length)];
  }
  const m = pick.move;
  self.postMessage({ move: { from: m.from, to: m.to, promotion: m.promotion }, score: pick.score, nodes });
};
