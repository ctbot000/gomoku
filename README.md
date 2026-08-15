# Gomoku

Five in a row on a 15×15 board, with a computer opponent. No build step, no
dependencies — open `index.html` in a browser and play.

```bash
open index.html
```

## Rules

Freestyle Gomoku: black moves first, and the first player to get five or more of
their stones in an unbroken line — horizontal, vertical, or diagonal — wins.
There are no forbidden moves, and an overline (six or more) counts as a win.

## Playing

Click an intersection to place a stone. The panel tracks whose turn it is, the
running score across games, and the move list in `H8` notation.

| | |
|---|---|
| **Opponent** | Computer as white or black, two players at one keyboard, or computer vs computer |
| **Difficulty** | Easy, Medium, Hard |
| **Undo** | Steps back to your own turn — against the computer that means taking back both plies |
| <kbd>U</kbd> / <kbd>N</kbd> | Undo / new game |

Switching opponent mode starts a fresh game; changing difficulty applies from the
computer's next move.

## How the computer plays

`js/ai.js` is an iterative-deepening alpha–beta search over a pattern-based
evaluation.

**Evaluation.** Each line on the board — every row, column, and diagonal — is
rendered as a string from one player's point of view (`1` own stone, `2`
opponent or wall, `0` empty) and scored by counting known shapes in it: an open
four is worth far more than a blocked one, an open three more than a dead three,
and so on. Shapes are written with their surrounding context, so `011110` (open
four) and `211110` (blocked four) score differently.

**Incremental scoring.** Placing a stone can only change the four lines through
that square, so make/unmake recomputes just those and adjusts a running total.
Line scores are memoised on the line's text, which recurs constantly during a
search. Together these make a node cheap enough to search six plies in well under
a second.

**Search.** Move generation is restricted to empty squares near existing stones.
Ordering does real work near the root — ranking a square by what it gains for
*both* players, since a square valuable to the opponent is exactly the one worth
taking away — and nothing near the leaves, where nodes are too numerous to pay
for it. Because the leaf ordering is cheap and narrow, the search checks tactics
itself before ordering: it returns immediately on a move that makes five, and if
the opponent threatens five it considers only blocking replies. That keeps a
narrow move list from ever hiding a forced win or loss.

Difficulty sets search depth and how often the engine settles for a move that is
good but not best — Easy also skips the "block a four" shortcut, so it can be
caught out.

## Layout

```
index.html      markup
css/style.css   styling
js/board.js     board state, move history, win detection
js/ai.js        evaluation and search
js/ui.js        canvas rendering, input, turn scheduling
```

`js/board.js` has no dependencies, and `js/ai.js` depends only on the board. The
scripts are plain globals loaded in order, so the page works over `file://` with
no server.
