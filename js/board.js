'use strict';

/* Core game state: a 15x15 Gomoku board with move history and win detection.
   Freestyle rules -- five or more in a row wins, no forbidden moves. */

const SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

/* The four line orientations. Each is scanned in both directions. */
const DIRS = [
  [0, 1],  // horizontal
  [1, 0],  // vertical
  [1, 1],  // diagonal  \
  [1, -1], // diagonal  /
];

function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

/* Returns the run of stones through `index` if it is five or longer, else null.
   `cells` is the raw board array, `player` the colour just played there. */
function findRun(cells, index, player) {
  const r0 = (index / SIZE) | 0;
  const c0 = index % SIZE;

  for (const [dr, dc] of DIRS) {
    const run = [index];

    for (const sign of [1, -1]) {
      let r = r0 + dr * sign;
      let c = c0 + dc * sign;
      while (inBounds(r, c) && cells[r * SIZE + c] === player) {
        run.push(r * SIZE + c);
        r += dr * sign;
        c += dc * sign;
      }
    }

    if (run.length >= 5) return run;
  }
  return null;
}

/* True if the stone at `index` completes five in a row. Hot path for the AI. */
function makesFive(cells, index, player) {
  const r0 = (index / SIZE) | 0;
  const c0 = index % SIZE;

  for (const [dr, dc] of DIRS) {
    let count = 1;
    for (const sign of [1, -1]) {
      let r = r0 + dr * sign;
      let c = c0 + dc * sign;
      while (inBounds(r, c) && cells[r * SIZE + c] === player) {
        count++;
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}

class Board {
  constructor() {
    this.cells = new Int8Array(SIZE * SIZE);
    this.moves = [];        // indices, in play order
    this.winner = EMPTY;
    this.winningRun = null; // indices of the five-in-a-row, once won
  }

  get turn() {
    return this.moves.length % 2 === 0 ? BLACK : WHITE;
  }

  get moveCount() {
    return this.moves.length;
  }

  get isOver() {
    return this.winner !== EMPTY || this.moves.length === SIZE * SIZE;
  }

  get isDraw() {
    return this.winner === EMPTY && this.moves.length === SIZE * SIZE;
  }

  get lastMove() {
    return this.moves.length ? this.moves[this.moves.length - 1] : -1;
  }

  canPlay(index) {
    return !this.isOver && index >= 0 && index < SIZE * SIZE && this.cells[index] === EMPTY;
  }

  /* Plays the current player's stone. Returns true if the move was legal. */
  play(index) {
    if (!this.canPlay(index)) return false;

    const player = this.turn;
    this.cells[index] = player;
    this.moves.push(index);

    const run = findRun(this.cells, index, player);
    if (run) {
      this.winner = player;
      this.winningRun = run;
    }
    return true;
  }

  undo() {
    if (!this.moves.length) return false;

    const index = this.moves.pop();
    this.cells[index] = EMPTY;
    this.winner = EMPTY;
    this.winningRun = null;
    return true;
  }

  reset() {
    this.cells.fill(EMPTY);
    this.moves.length = 0;
    this.winner = EMPTY;
    this.winningRun = null;
  }
}

/* "H8" style notation: columns A-O left to right, rows 15 down to 1. */
function toCoord(index) {
  const r = (index / SIZE) | 0;
  const c = index % SIZE;
  return String.fromCharCode(65 + c) + (SIZE - r);
}
