// 4-Spieler-Schach „Jeder gegen jeden“ (angelehnt an Chess.com FFA)
// Brett 14×14 ohne die 3×3-Ecken. x = 0..13 (links→rechts), y = 0..13 (unten→oben, aus Sicht Rot).
// Regeln (vereinfacht):
//  - Zugreihenfolge Rot → Blau → Gelb → Grün
//  - Punkte fürs Schlagen: Bauer 1, Springer 3, Läufer 5, Turm 5, Dame 9, umgewandelte Dame 1
//  - Schachmatt: +20 für den Spieler, der mattsetzt; Matt wird nach jedem Zug für alle geprüft
//  - Patt (am eigenen Zug keine Züge, nicht im Schach): ausgeschieden, aber +20 für den Pattgesetzten
//  - Ausgeschiedene Figuren werden grau: sie ziehen nicht, geben kein Schach und bringen 0 Punkte
//  - Bauern wandeln auf der 8. Reihe (Brettmitte) in eine Dame um
//  - Könige können nicht geschlagen werden; Rochade ja, en passant nein
//  - Ende: nur noch ein Spieler übrig, zwei übrig mit über 20 Punkten Abstand, oder 50 Runden ohne Schlagen
//  - Platzierung nach Punkten (bei Gleichstand: wer länger überlebt hat)

export const SIZE = 14;
export const COLORS = ['r', 'b', 'y', 'g'];
export const COLOR_NAMES = { r: 'Rot', b: 'Blau', y: 'Gelb', g: 'Grün' };
export const POINTS = { p: 1, n: 3, b: 5, r: 5, q: 9, k: 0 };
const MATE_BONUS = 20;
const QUIET_LIMIT = 200; // Halbzüge (50 Runden) ohne Schlagen

export const onBoard = (x, y) =>
  x >= 0 && x < SIZE && y >= 0 && y < SIZE && !((x < 3 || x > 10) && (y < 3 || y > 10));
export const idx = (x, y) => y * SIZE + x;
export const xy = (i) => [i % SIZE, Math.floor(i / SIZE)];

// Vorwärtsrichtung der Bauern
const FORWARD = { r: [0, 1], b: [1, 0], y: [0, -1], g: [-1, 0] };
const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KING_DIRS = [...ROOK_DIRS, ...BISHOP_DIRS];

// Reihe relativ zur eigenen Grundreihe (0 = Grundreihe)
function relRank(color, x, y) {
  return color === 'r' ? y : color === 'y' ? 13 - y : color === 'b' ? x : 13 - x;
}

export class FourChess {
  constructor() {
    this.board = new Array(SIZE * SIZE).fill(null);
    this.turnIndex = 0;
    this.active = { r: true, b: true, y: true, g: true };
    this.points = { r: 0, b: 0, y: 0, g: 0 };
    this.eliminatedAt = {}; // color -> Halbzug-Nummer
    this.eliminatedReason = {};
    this.history = [];
    this.quiet = 0;
    this.over = false;
    this.endReason = null;
    this.setup();
  }

  setup() {
    const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    const backSwapped = ['r', 'n', 'b', 'k', 'q', 'b', 'n', 'r'];
    for (let i = 0; i < 8; i++) {
      const p = 3 + i;
      this.put(p, 0, 'r', back[i]); this.put(p, 1, 'r', 'p');
      this.put(p, 13, 'y', backSwapped[i]); this.put(p, 12, 'y', 'p');
      this.put(0, p, 'b', backSwapped[i]); this.put(1, p, 'b', 'p');
      this.put(13, p, 'g', back[i]); this.put(12, p, 'g', 'p');
    }
  }

  put(x, y, c, t) { this.board[idx(x, y)] = { c, t, moved: false }; }

  get turn() { return COLORS[this.turnIndex]; }
  isLive(color) { return this.active[color]; }

  // ---------- Angriffe ----------
  isAttacked(sq, defender) {
    const [x, y] = xy(sq);
    const enemy = (p) => p && p.c !== defender && this.active[p.c];
    for (const [dx, dy] of KNIGHT) {
      const nx = x + dx, ny = y + dy;
      if (!onBoard(nx, ny)) continue;
      const p = this.board[idx(nx, ny)];
      if (enemy(p) && p.t === 'n') return true;
    }
    for (const [dx, dy] of KING_DIRS) {
      const diag = dx !== 0 && dy !== 0;
      let nx = x + dx, ny = y + dy, dist = 1;
      while (onBoard(nx, ny)) {
        const p = this.board[idx(nx, ny)];
        if (p) {
          if (enemy(p)) {
            if (p.t === 'q' || (diag ? p.t === 'b' : p.t === 'r')) return true;
            if (dist === 1 && p.t === 'k') return true;
            if (dist === 1 && diag && p.t === 'p') {
              // Bauer schlägt schräg vorwärts: Angreifer steht "hinter" dem Feld
              const [fx, fy] = FORWARD[p.c];
              const ax = -dx, ay = -dy; // Richtung vom Bauern zum Feld
              if ((fx !== 0 && ax === fx) || (fy !== 0 && ay === fy)) return true;
            }
          }
          break;
        }
        nx += dx; ny += dy; dist++;
      }
    }
    return false;
  }

  kingSquare(color) {
    for (let i = 0; i < this.board.length; i++) {
      const p = this.board[i];
      if (p && p.c === color && p.t === 'k') return i;
    }
    return -1;
  }

  inCheck(color) {
    const k = this.kingSquare(color);
    return k >= 0 && this.isAttacked(k, color);
  }

  // ---------- Zuggenerierung ----------
  pseudoMoves(color) {
    const moves = [];
    const canLand = (p) => !p || (p.c !== color && p.t !== 'k') || (p && !this.active[p.c] && p.c !== color && p.t !== 'k');
    for (let i = 0; i < this.board.length; i++) {
      const p = this.board[i];
      if (!p || p.c !== color) continue;
      const [x, y] = xy(i);
      if (p.t === 'p') {
        const [fx, fy] = FORWARD[color];
        const ox = x + fx, oy = y + fy;
        if (onBoard(ox, oy) && !this.board[idx(ox, oy)]) {
          moves.push(this.mk(i, idx(ox, oy), color));
          const ox2 = ox + fx, oy2 = oy + fy;
          if (relRank(color, x, y) === 1 && onBoard(ox2, oy2) && !this.board[idx(ox2, oy2)]) moves.push(this.mk(i, idx(ox2, oy2), color));
        }
        const sides = fx === 0 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
        for (const [sx, sy] of sides) {
          const cx = x + fx + sx, cy = y + fy + sy;
          if (!onBoard(cx, cy)) continue;
          const t = this.board[idx(cx, cy)];
          if (t && t.c !== color && t.t !== 'k') moves.push(this.mk(i, idx(cx, cy), color));
        }
        continue;
      }
      if (p.t === 'n' || p.t === 'k') {
        for (const [dx, dy] of p.t === 'n' ? KNIGHT : KING_DIRS) {
          const nx = x + dx, ny = y + dy;
          if (!onBoard(nx, ny)) continue;
          const t = this.board[idx(nx, ny)];
          if (canLand(t)) moves.push(this.mk(i, idx(nx, ny), color));
        }
        if (p.t === 'k' && !p.moved) this.castleMoves(i, color, moves);
        continue;
      }
      const dirs = p.t === 'r' ? ROOK_DIRS : p.t === 'b' ? BISHOP_DIRS : KING_DIRS;
      for (const [dx, dy] of dirs) {
        let nx = x + dx, ny = y + dy;
        while (onBoard(nx, ny)) {
          const t = this.board[idx(nx, ny)];
          if (t) { if (canLand(t)) moves.push(this.mk(i, idx(nx, ny), color)); break; }
          moves.push(this.mk(i, idx(nx, ny), color));
          nx += dx; ny += dy;
        }
      }
    }
    return moves;
  }

  mk(from, to, color) {
    const p = this.board[from];
    const [tx, ty] = xy(to);
    const m = { from, to };
    if (p.t === 'p' && relRank(color, tx, ty) === 7) m.promotion = 'q';
    return m;
  }

  castleMoves(kSq, color, moves) {
    if (this.inCheck(color)) return;
    const [kx, ky] = xy(kSq);
    const horizontal = color === 'r' || color === 'y';
    for (const dir of [1, -1]) {
      let nx = kx, ny = ky, rookSq = -1;
      for (;;) {
        if (horizontal) nx += dir; else ny += dir;
        if (!onBoard(nx, ny)) break;
        const t = this.board[idx(nx, ny)];
        if (t) { if (t.c === color && t.t === 'r' && !t.moved) rookSq = idx(nx, ny); break; }
      }
      if (rookSq < 0) continue;
      const step1 = horizontal ? idx(kx + dir, ky) : idx(kx, ky + dir);
      const step2 = horizontal ? idx(kx + 2 * dir, ky) : idx(kx, ky + 2 * dir);
      if (this.isAttacked(step1, color) || this.isAttacked(step2, color)) continue;
      moves.push({ from: kSq, to: step2, castle: { rookFrom: rookSq, rookTo: step1 } });
    }
  }

  // Zug ausführen ohne Regeln drumherum (für Legalitätsprüfung); gibt Undo-Info zurück
  makeRaw(m) {
    const moving = this.board[m.from];
    const captured = this.board[m.to];
    const undo = { m, moving, movedBefore: moving.moved, captured, rook: null };
    this.board[m.to] = m.promotion ? { c: moving.c, t: 'q', moved: true, promoted: true } : moving;
    this.board[m.from] = null;
    moving.moved = true;
    if (m.castle) {
      const rook = this.board[m.castle.rookFrom];
      undo.rook = { piece: rook, moved: rook.moved };
      this.board[m.castle.rookTo] = rook;
      this.board[m.castle.rookFrom] = null;
      rook.moved = true;
    }
    return undo;
  }

  undoRaw(u) {
    this.board[u.m.from] = u.moving;
    u.moving.moved = u.movedBefore;
    this.board[u.m.to] = u.captured;
    if (u.rook) {
      this.board[u.m.castle.rookFrom] = u.rook.piece;
      this.board[u.m.castle.rookTo] = null;
      u.rook.piece.moved = u.rook.moved;
    }
  }

  legalMoves(color = this.turn) {
    if (!this.active[color] || this.over) return [];
    return this.pseudoMoves(color).filter((m) => {
      const u = this.makeRaw(m);
      const ok = !this.inCheck(color);
      this.undoRaw(u);
      return ok;
    });
  }

  movesFrom(sq) {
    return this.legalMoves().filter((m) => m.from === sq);
  }

  // ---------- Spielablauf ----------
  move({ from, to }) {
    if (this.over) return null;
    const color = this.turn;
    const m = this.legalMoves(color).find((x) => x.from === from && x.to === to);
    if (!m) return null;
    const target = this.board[to];
    let gained = 0;
    if (target) gained = this.active[target.c] ? (target.promoted ? 1 : POINTS[target.t]) : 0;
    const piece = this.board[from].t;
    this.makeRaw(m);
    this.points[color] += gained;
    this.quiet = target ? 0 : this.quiet + 1;
    const record = { color, from, to, piece, captured: target ? target.t : null, gained, promotion: m.promotion || null, castle: !!m.castle, events: [] };
    this.history.push(record);

    // Nach jedem Zug: wurde jemand mattgesetzt?
    for (const c of COLORS) {
      if (c === color || !this.active[c]) continue;
      if (this.inCheck(c) && this.legalMovesIgnoringTurn(c).length === 0) {
        this.points[color] += MATE_BONUS;
        record.events.push({ type: 'mate', color: c, by: color });
        this.eliminate(c, 'Schachmatt');
      }
    }
    if (record.events.length === 0) {
      const checked = COLORS.filter((c) => c !== color && this.active[c] && this.inCheck(c));
      if (checked.length) record.events.push({ type: 'check', colors: checked });
    }
    this.advanceTurn();
    this.checkEnd();
    return record;
  }

  legalMovesIgnoringTurn(color) {
    return this.pseudoMoves(color).filter((m) => {
      const u = this.makeRaw(m);
      const ok = !this.inCheck(color);
      this.undoRaw(u);
      return ok;
    });
  }

  eliminate(color, reason) {
    if (!this.active[color]) return;
    this.active[color] = false;
    this.eliminatedAt[color] = this.history.length;
    this.eliminatedReason[color] = reason;
    const k = this.kingSquare(color);
    if (k >= 0) this.board[k] = null;
  }

  // Aufgabe / Zeit / Verbindung: Spieler scheidet aus, ggf. ist dann der nächste dran
  resign(color, reason = 'Aufgabe') {
    if (this.over || !this.active[color]) return;
    const wasTurn = this.turn === color;
    this.eliminate(color, reason);
    this.history.push({ color, resign: true, reason, events: [] });
    if (wasTurn) this.advanceTurn(true);
    this.checkEnd();
  }

  advanceTurn(fromCurrent = false) {
    if (this.activeColors().length <= 1) return;
    let i = this.turnIndex;
    for (let n = 0; n < 4; n++) {
      if (!(fromCurrent && n === 0)) i = (i + 1) % 4;
      fromCurrent = false;
      const c = COLORS[i];
      if (!this.active[c]) continue;
      if (this.legalMovesIgnoringTurn(c).length === 0) {
        // Am Zug, aber keine Züge: Matt (sollte schon erkannt sein) oder Patt
        if (!this.inCheck(c)) { this.points[c] += MATE_BONUS; this.eliminate(c, 'Patt'); }
        else this.eliminate(c, 'Schachmatt');
        if (this.activeColors().length <= 1) { this.turnIndex = i; return; }
        continue;
      }
      this.turnIndex = i;
      return;
    }
  }

  activeColors() { return COLORS.filter((c) => this.active[c]); }

  checkEnd() {
    if (this.over) return;
    const alive = this.activeColors();
    if (alive.length <= 1) return this.finish('Nur noch ein Spieler übrig');
    if (alive.length === 2 && Math.abs(this.points[alive[0]] - this.points[alive[1]]) > MATE_BONUS) {
      return this.finish('Uneinholbarer Vorsprung');
    }
    if (this.quiet >= QUIET_LIMIT) return this.finish('50 Runden ohne Schlagen');
  }

  finish(reason) {
    this.over = true;
    this.endReason = reason;
  }

  // Platzierung: Punkte, dann Überlebensdauer
  ranking() {
    const surv = (c) => (this.active[c] ? Infinity : this.eliminatedAt[c]);
    return [...COLORS].sort((a, b) => this.points[b] - this.points[a] || surv(b) - surv(a));
  }

  places() {
    const order = this.ranking();
    const places = {};
    order.forEach((c, i) => {
      const prev = order[i - 1];
      places[c] = prev && this.points[prev] === this.points[c] && this.active[prev] === this.active[c] && this.eliminatedAt[prev] === this.eliminatedAt[c] ? places[prev] : i + 1;
    });
    return places;
  }

  toJSON() {
    return {
      board: this.board, turnIndex: this.turnIndex, active: this.active, points: this.points,
      eliminatedAt: this.eliminatedAt, eliminatedReason: this.eliminatedReason,
      quiet: this.quiet, over: this.over, endReason: this.endReason, lastMove: this.history[this.history.length - 1] || null,
      plies: this.history.length,
    };
  }

  static fromJSON(j) {
    const g = new FourChess();
    Object.assign(g, {
      board: j.board.map((p) => (p ? { ...p } : null)), turnIndex: j.turnIndex, active: { ...j.active },
      points: { ...j.points }, eliminatedAt: { ...j.eliminatedAt }, eliminatedReason: { ...j.eliminatedReason },
      quiet: j.quiet, over: j.over, endReason: j.endReason,
    });
    g.history = j.lastMove ? [j.lastMove] : [];
    return g;
  }
}

// ---------- Einfache KI ----------
// Bewertet jeden Zug: Material + Sicherheit der Zielfigur + Schach + Fortschritt, mit etwas Zufall
export function botMove(game, color = game.turn, skill = 0.8) {
  const moves = game.legalMoves(color);
  if (!moves.length) return null;
  let best = null, bestScore = -Infinity;
  for (const m of moves) {
    const piece = game.board[m.from];
    const target = game.board[m.to];
    let score = 0;
    if (target) score += game.active[target.c] ? (target.promoted ? 1 : POINTS[target.t]) * 1.1 : 0.3;
    const pieceVal = piece.t === 'k' ? 4 : piece.promoted ? 6 : POINTS[piece.t] || 1;
    const wasAttacked = game.isAttacked(m.from, color);
    const u = game.makeRaw(m);
    const nowAttacked = game.isAttacked(m.to, color);
    if (nowAttacked) score -= pieceVal * 0.9;
    if (wasAttacked && !nowAttacked) score += pieceVal * 0.6;
    if (m.promotion) score += 6;
    for (const c of COLORS) {
      if (c === color || !game.active[c]) continue;
      if (game.inCheck(c)) {
        score += 0.6;
        if (game.legalMovesIgnoringTurn(c).length === 0) score += 25;
      }
    }
    game.undoRaw(u);
    const [tx, ty] = xy(m.to);
    const center = 6.5 - (Math.abs(tx - 6.5) + Math.abs(ty - 6.5)) / 2;
    score += center * 0.05;
    if (piece.t === 'p') score += 0.1;
    if (m.castle) score += 0.8;
    if (piece.t === 'k' && !m.castle) score -= 0.3;
    score += Math.random() * (1.6 - skill * 1.4);
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}
