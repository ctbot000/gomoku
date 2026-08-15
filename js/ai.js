'use strict';

/* Gomoku AI: iterative-deepening alpha-beta over a pattern-based evaluation.

   Every line on the board (row, column, both diagonals) is rendered as a string
   from one player's point of view -- '1' own stone, '2' opponent or wall, '0'
   empty -- and scored by counting known shapes in it. Line scores are cached and
   only the four lines through a changed cell are recomputed, which makes
   make/unmake cheap enough to search several plies. */

/* Shapes are listed with their surrounding context so a blocked shape cannot
   match an open one. Overlapping matches are intentional: "0011100" scores as
   two open threes because it really does threaten an open four on both sides. */
const PATTERNS = [
  ['11111', 10000000],  // five
  ['011110', 500000],   // open four -- unstoppable
  ['211110', 60000],    // four, one end blocked
  ['011112', 60000],
  ['11011', 60000],     // split four
  ['10111', 60000],
  ['11101', 60000],
  ['001110', 12000],    // open three
  ['011100', 12000],
  ['011010', 11000],    // broken open three
  ['010110', 11000],
  ['211100', 1300],     // three, one end blocked
  ['001112', 1300],
  ['211010', 1200],
  ['010112', 1200],
  ['10011', 1200],
  ['11001', 1200],
  ['10101', 1200],
  ['001100', 800],      // open two
  ['01010', 600],
  ['200110', 150],
  ['011002', 150],
  ['211000', 120],
  ['000112', 120],
];

/* Board indices for every line, grouped by orientation. Lines shorter than five
   cells can never hold a win and are scored as zero. */
const LINES = (() => {
  const lines = [[], [], [], []];

  for (let r = 0; r < SIZE; r++) {
    const line = [];
    for (let c = 0; c < SIZE; c++) line.push(r * SIZE + c);
    lines[0][r] = line;
  }
  for (let c = 0; c < SIZE; c++) {
    const line = [];
    for (let r = 0; r < SIZE; r++) line.push(r * SIZE + c);
    lines[1][c] = line;
  }
  for (let k = 0; k < 2 * SIZE - 1; k++) {
    const line = [];
    for (let r = 0; r < SIZE; r++) {
      const c = r - k + SIZE - 1;
      if (c >= 0 && c < SIZE) line.push(r * SIZE + c);
    }
    lines[2][k] = line;
  }
  for (let k = 0; k < 2 * SIZE - 1; k++) {
    const line = [];
    for (let r = 0; r < SIZE; r++) {
      const c = k - r;
      if (c >= 0 && c < SIZE) line.push(r * SIZE + c);
    }
    lines[3][k] = line;
  }
  return lines;
})();

/* The four lines through a given cell, as indices into LINES[0..3]. */
const LINE_KEYS = (() => {
  const keys = new Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      keys[r * SIZE + c] = [r, c, r - c + SIZE - 1, r + c];
    }
  }
  return keys;
})();

/* A line's score depends only on its normalised text, and the same texts recur
   constantly across a search, so scoring is memoised on that text. */
const LINE_MEMO = new Map();
const LINE_MEMO_CAP = 200000;

function scoreText(text) {
  const cached = LINE_MEMO.get(text);
  if (cached !== undefined) return cached;

  let score = 0;
  for (let p = 0; p < PATTERNS.length; p++) {
    const pattern = PATTERNS[p][0];
    let from = text.indexOf(pattern);
    while (from !== -1) {
      score += PATTERNS[p][1];
      from = text.indexOf(pattern, from + 1);
    }
  }

  if (LINE_MEMO.size >= LINE_MEMO_CAP) LINE_MEMO.clear();
  LINE_MEMO.set(text, score);
  return score;
}

const WIN_SCORE = 100000000;

/* `depth` is in plies. Even depths end the search on the opponent's reply, which
   keeps the AI from talking itself into an attack that gets refuted at once. */
const LEVELS = {
  easy: { depth: 1, rootWidth: 12, noise: 0.45, blocks: false },
  medium: { depth: 4, rootWidth: 14, noise: 0.12, blocks: true },
  hard: { depth: 6, rootWidth: 16, noise: 0, blocks: true },
};

class GomokuAI {
  constructor(level = 'hard') {
    this.setLevel(level);
    this.cells = new Int8Array(SIZE * SIZE);
    /* scores[player][orientation][lineIndex] -- cached per-line evaluation. */
    this.scores = { [BLACK]: null, [WHITE]: null };
    this.totals = { [BLACK]: 0, [WHITE]: 0 };
    this.timeLimitMs = 4000;
    this.buffer = new Array(SIZE + 2);
    this.nodes = 0;
  }

  setLevel(level) {
    this.level = LEVELS[level] ? level : 'hard';
    this.config = LEVELS[this.level];
  }

  /* ---- evaluation -------------------------------------------------- */

  scoreLine(player, orientation, index) {
    const line = LINES[orientation][index];
    if (line.length < 5) return 0;

    const buffer = this.buffer;
    buffer.length = line.length + 2;
    buffer[0] = '2';
    let own = 0;
    for (let i = 0; i < line.length; i++) {
      const v = this.cells[line[i]];
      if (v === EMPTY) {
        buffer[i + 1] = '0';
      } else if (v === player) {
        buffer[i + 1] = '1';
        own++;
      } else {
        buffer[i + 1] = '2';
      }
    }
    if (own === 0) return 0; // every shape needs at least one own stone
    buffer[line.length + 1] = '2';

    return scoreText(buffer.join(''));
  }

  /* Rebuilds the whole score cache from the given position. */
  load(cells) {
    this.cells.set(cells);

    for (const player of [BLACK, WHITE]) {
      const byOrientation = [];
      let total = 0;
      for (let o = 0; o < 4; o++) {
        const row = new Float64Array(LINES[o].length);
        for (let i = 0; i < LINES[o].length; i++) {
          row[i] = this.scoreLine(player, o, i);
          total += row[i];
        }
        byOrientation.push(row);
      }
      this.scores[player] = byOrientation;
      this.totals[player] = total;
    }
  }

  /* Recomputes only the four lines through `index` -- the rest cannot change. */
  refresh(index) {
    const keys = LINE_KEYS[index];
    for (const player of [BLACK, WHITE]) {
      const cache = this.scores[player];
      for (let o = 0; o < 4; o++) {
        const li = keys[o];
        const next = this.scoreLine(player, o, li);
        this.totals[player] += next - cache[o][li];
        cache[o][li] = next;
      }
    }
  }

  make(index, player) {
    this.cells[index] = player;
    this.refresh(index);
  }

  unmake(index) {
    this.cells[index] = EMPTY;
    this.refresh(index);
  }

  /* Anti-symmetric, as negamax requires: evaluate(a) === -evaluate(b). */
  evaluate(player) {
    const opponent = player === BLACK ? WHITE : BLACK;
    return this.totals[player] - this.totals[opponent];
  }

  /* ---- move generation --------------------------------------------- */

  /* Empty cells within `radius` of an existing stone; everything further out is
     dead space this early in a line's life. */
  nearbyEmpties(radius) {
    const out = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const index = r * SIZE + c;
        if (this.cells[index] !== EMPTY) continue;

        let weight = 0;
        for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (!inBounds(nr, nc) || this.cells[nr * SIZE + nc] === EMPTY) continue;
            /* Closer neighbours count for more. */
            weight += radius + 1 - Math.max(Math.abs(dr), Math.abs(dc));
          }
        }
        if (weight > 0) out.push({ index, weight, rank: weight });
      }
    }
    return out;
  }

  /* Move ordering drives alpha-beta, so it is worth real work near the root and
     nothing at all near the leaves, where there are far more nodes to pay for.
     Near the leaves the list is left in proximity order, which is why `search`
     handles the tactical moves itself rather than trusting this ranking. */
  rankMoves(candidates, player, depth, width) {
    const opponent = player === BLACK ? WHITE : BLACK;

    if (depth >= 3) {
      for (const move of candidates) {
        /* A square that is valuable to the opponent is exactly the square worth
           taking away from them. */
        move.rank = this.gain(move.index, player) + this.gain(move.index, opponent) * 0.9;
      }
    } else if (depth === 2) {
      for (const move of candidates) {
        move.rank = this.gain(move.index, player) + move.weight;
      }
    }

    candidates.sort((a, b) => b.rank - a.rank);
    return candidates.length > width ? candidates.slice(0, width) : candidates;
  }

  orderedMoves(player, depth, width) {
    return this.rankMoves(this.nearbyEmpties(depth >= 3 ? 2 : 1), player, depth, width);
  }

  /* How much `player`'s own score improves by playing `index`. */
  gain(index, player) {
    const before = this.totals[player];
    this.make(index, player);
    const after = this.totals[player];
    this.unmake(index);
    return after - before;
  }

  /* ---- search ------------------------------------------------------- */

  search(depth, alpha, beta, player, ply) {
    if (depth <= 0) return this.evaluate(player);

    this.nodes++;
    if ((this.nodes & 255) === 0 && Date.now() > this.deadline) {
      this.aborted = true;
      return this.evaluate(player);
    }

    const opponent = player === BLACK ? WHITE : BLACK;
    const candidates = this.nearbyEmpties(depth >= 3 ? 2 : 1);
    if (!candidates.length) return 0; // nothing reachable: the board is full

    /* Tactics are settled before ordering, so a narrow move list can never hide
       them. A square completing five always touches an existing stone, so it is
       certain to be in `candidates`. */
    for (const move of candidates) {
      if (makesFive(this.cells, move.index, player)) return WIN_SCORE - ply;
    }

    /* If the opponent threatens five, blocking it is the only thing that can
       matter -- we already know we cannot win outright this move. */
    let moves = candidates.filter((m) => makesFive(this.cells, m.index, opponent));
    if (!moves.length) {
      moves = this.rankMoves(candidates, player, depth, depth >= 3 ? 12 : depth === 2 ? 10 : 8);
    }

    let best = -Infinity;
    for (const move of moves) {
      this.make(move.index, player);
      const value = -this.search(depth - 1, -beta, -alpha, opponent, ply + 1);
      this.unmake(move.index);

      if (value > best) best = value;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break; // refuted; the rest cannot matter
    }
    return best;
  }

  /* Picks a move for `player` in the given position. Returns a board index,
     or -1 if there is nowhere to play. */
  findMove(cells, player) {
    this.load(cells);
    this.deadline = Date.now() + this.timeLimitMs;
    this.aborted = false;
    this.nodes = 0;

    const opponent = player === BLACK ? WHITE : BLACK;
    const center = ((SIZE - 1) / 2) * SIZE + (SIZE - 1) / 2;

    let stones = 0;
    for (let i = 0; i < cells.length; i++) if (cells[i] !== EMPTY) stones++;
    if (stones === 0) return center;

    const candidates = this.orderedMoves(player, 3, this.config.rootWidth);
    if (!candidates.length) return this.cells[center] === EMPTY ? center : -1;

    /* Tactics the search must never miss, whatever the depth. */
    for (const move of candidates) {
      if (makesFive(this.cells, move.index, player)) return move.index;
    }
    if (this.config.blocks) {
      for (const move of candidates) {
        if (makesFive(this.cells, move.index, opponent)) return move.index;
      }
    }

    /* Iterative deepening: each pass re-sorts the root moves for the next one,
       and a pass cut short by the clock is discarded rather than trusted. */
    let scored = candidates.map((m) => ({ index: m.index, value: m.rank }));
    let best = candidates[0].index;
    let order = candidates.slice();

    for (let depth = 1; depth <= this.config.depth; depth++) {
      const results = [];
      let alpha = -Infinity;

      for (const move of order) {
        this.make(move.index, player);
        const value = -this.search(depth - 1, -Infinity, -alpha, opponent, 1);
        this.unmake(move.index);

        if (this.aborted) break;
        results.push({ index: move.index, value });
        if (value > alpha) alpha = value;
      }

      if (this.aborted || !results.length) break;

      results.sort((a, b) => b.value - a.value);
      scored = results;
      best = results[0].index;
      order = results.map((r) => ({ index: r.index }));

      if (Math.abs(results[0].value) >= WIN_SCORE - 100) break; // already decided
    }

    /* Weaker levels sometimes settle for a move that is good but not best. */
    if (this.config.noise > 0 && scored.length > 1 && scored[0].value < WIN_SCORE - 100) {
      const cutoff = scored[0].value - 12000;
      const pool = scored.slice(0, 4).filter((m) => m.value > cutoff);
      if (pool.length > 1 && Math.random() < this.config.noise) {
        return pool[1 + Math.floor(Math.random() * (pool.length - 1))].index;
      }
    }

    return best;
  }
}
