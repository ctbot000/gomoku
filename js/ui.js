'use strict';

/* Canvas rendering and game flow: board drawing, input, and turn scheduling. */

(() => {
  const TAU = Math.PI * 2;
  const STAR_POINTS = [
    [3, 3], [3, 11], [11, 3], [11, 11], [7, 7],
  ];

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const el = {
    status: document.getElementById('status'),
    mode: document.getElementById('mode'),
    level: document.getElementById('level'),
    undo: document.getElementById('undo'),
    restart: document.getElementById('restart'),
    moveList: document.getElementById('move-list'),
    moveCount: document.getElementById('move-count'),
    banner: document.getElementById('banner'),
    bannerTitle: document.getElementById('banner-title'),
    bannerSub: document.getElementById('banner-sub'),
    bannerAgain: document.getElementById('banner-again'),
    sideBlack: document.getElementById('side-black'),
    sideWhite: document.getElementById('side-white'),
    roleBlack: document.getElementById('role-black'),
    roleWhite: document.getElementById('role-white'),
    scoreBlack: document.getElementById('score-black'),
    scoreWhite: document.getElementById('score-white'),
  };

  const board = new Board();
  const ai = new GomokuAI(el.level.value);

  const state = {
    mode: el.mode.value,   // ai-white | ai-black | human | ai-ai
    thinking: false,
    hover: -1,
    placedAt: 0,           // timestamp of the newest stone, for the drop-in
    wonAt: 0,              // timestamp of the winning move, for the pulse
    scores: { [BLACK]: 0, [WHITE]: 0 },
    timer: null,
  };

  /* Board geometry in CSS pixels, recomputed on resize. */
  const view = { size: 600, pad: 30, cell: 38 };

  /* Fixed grain so redraws do not shimmer. */
  const GRAIN = Array.from({ length: 22 }, (_, i) => ({
    y: (i + 0.5) / 22,
    amp: 0.004 + ((i * 37) % 11) / 900,
    phase: ((i * 53) % 100) / 100 * TAU,
    alpha: 0.02 + ((i * 29) % 7) / 320,
  }));

  /* ---- roles ------------------------------------------------------- */

  function isComputer(player) {
    if (state.mode === 'ai-ai') return true;
    if (state.mode === 'human') return false;
    return state.mode === 'ai-black' ? player === BLACK : player === WHITE;
  }

  function humanColor() {
    if (state.mode === 'ai-black') return WHITE;
    if (state.mode === 'ai-white') return BLACK;
    return null; // both or neither
  }

  /* ---- geometry ---------------------------------------------------- */

  function pointOf(index) {
    const r = (index / SIZE) | 0;
    const c = index % SIZE;
    return { x: view.pad + c * view.cell, y: view.pad + r * view.cell };
  }

  function resize() {
    const width = canvas.getBoundingClientRect().width;
    if (!width) return;

    const dpr = window.devicePixelRatio || 1;
    const pixels = Math.round(width * dpr);
    if (canvas.width !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    view.size = width;
    view.pad = width * 0.062;
    view.cell = (width - view.pad * 2) / (SIZE - 1);
    draw();
  }

  function indexFromPointer(event) {
    const rect = canvas.getBoundingClientRect();
    const scale = view.size / rect.width;
    const x = (event.clientX - rect.left) * scale;
    const y = (event.clientY - rect.top) * scale;

    const c = Math.round((x - view.pad) / view.cell);
    const r = Math.round((y - view.pad) / view.cell);
    if (!inBounds(r, c)) return -1;

    const dx = x - (view.pad + c * view.cell);
    const dy = y - (view.pad + r * view.cell);
    if (Math.hypot(dx, dy) > view.cell * 0.52) return -1;

    return r * SIZE + c;
  }

  /* ---- drawing ----------------------------------------------------- */

  function drawSurface() {
    const { size } = view;

    const wood = ctx.createLinearGradient(0, 0, size * 0.7, size);
    wood.addColorStop(0, '#eac385');
    wood.addColorStop(0.45, '#ddb069');
    wood.addColorStop(1, '#cb9950');
    ctx.fillStyle = wood;
    ctx.fillRect(0, 0, size, size);

    ctx.lineWidth = size * 0.006;
    for (const grain of GRAIN) {
      ctx.beginPath();
      for (let x = 0; x <= size; x += size / 24) {
        const y = grain.y * size + Math.sin(x / size * 5 + grain.phase) * grain.amp * size;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(120, 76, 26, ${grain.alpha})`;
      ctx.stroke();
    }

    /* Inner shading so the board reads as a raised surface. */
    const vignette = ctx.createRadialGradient(
      size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.75);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(80, 45, 10, 0.18)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, size, size);
  }

  function drawGrid() {
    const { pad, cell, size } = view;
    const span = cell * (SIZE - 1);
    const thin = Math.max(0.8, size / 750);

    ctx.strokeStyle = 'rgba(64, 40, 12, 0.6)';
    ctx.lineWidth = thin;
    ctx.beginPath();
    for (let i = 0; i < SIZE; i++) {
      const at = pad + i * cell;
      ctx.moveTo(pad, at);
      ctx.lineTo(pad + span, at);
      ctx.moveTo(at, pad);
      ctx.lineTo(at, pad + span);
    }
    ctx.stroke();

    ctx.lineWidth = thin * 2;
    ctx.strokeRect(pad, pad, span, span);

    ctx.fillStyle = 'rgba(64, 40, 12, 0.75)';
    for (const [r, c] of STAR_POINTS) {
      const { x, y } = pointOf(r * SIZE + c);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, cell * 0.09), 0, TAU);
      ctx.fill();
    }
  }

  function drawLabels() {
    const { pad, cell, size } = view;
    ctx.fillStyle = 'rgba(74, 47, 16, 0.62)';
    ctx.font = `${Math.max(9, Math.round(size * 0.021))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < SIZE; i++) {
      const at = pad + i * cell;
      ctx.fillText(String.fromCharCode(65 + i), at, pad - cell * 0.62);
      ctx.fillText(String(SIZE - i), pad - cell * 0.62, at);
    }
  }

  function drawStone(x, y, player, radius, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.beginPath();
    ctx.arc(x + radius * 0.09, y + radius * 0.14, radius * 0.99, 0, TAU);
    ctx.fillStyle = 'rgba(48, 28, 6, 0.28)';
    ctx.fill();

    const shade = ctx.createRadialGradient(
      x - radius * 0.34, y - radius * 0.4, radius * 0.08, x, y, radius);
    if (player === BLACK) {
      shade.addColorStop(0, '#68707c');
      shade.addColorStop(0.4, '#252a31');
      shade.addColorStop(1, '#0b0d10');
    } else {
      shade.addColorStop(0, '#ffffff');
      shade.addColorStop(0.5, '#f0f3f6');
      shade.addColorStop(1, '#b9bfc7');
    }
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fillStyle = shade;
    ctx.fill();

    ctx.strokeStyle = player === BLACK ? 'rgba(255,255,255,0.07)' : 'rgba(90,96,104,0.35)';
    ctx.lineWidth = radius * 0.06;
    ctx.stroke();

    ctx.restore();
  }

  function drawStones(now) {
    const radius = view.cell * 0.44;
    const last = board.lastMove;

    for (let i = 0; i < board.moves.length; i++) {
      const index = board.moves[i];
      const { x, y } = pointOf(index);
      let scale = 1;

      /* The newest stone drops in. */
      if (index === last && state.placedAt) {
        const t = Math.min(1, (now - state.placedAt) / 150);
        scale = 0.62 + 0.38 * (1 - (1 - t) * (1 - t));
      }
      drawStone(x, y, board.cells[index], radius * scale, 1);
    }

    if (last >= 0 && !board.winningRun) {
      const { x, y } = pointOf(last);
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.24, 0, TAU);
      ctx.fillStyle = board.cells[last] === BLACK ? 'rgba(232,190,120,0.9)' : 'rgba(196,120,40,0.85)';
      ctx.fill();
    }
  }

  function drawWinningRun(now) {
    if (!board.winningRun) return;

    const pulse = 0.55 + 0.45 * Math.sin((now - state.wonAt) / 260);
    const radius = view.cell * 0.44;

    ctx.save();
    ctx.strokeStyle = `rgba(255, 232, 150, ${0.45 + 0.5 * pulse})`;
    ctx.lineWidth = Math.max(2, view.cell * 0.09);
    for (const index of board.winningRun) {
      const { x, y } = pointOf(index);
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.16, 0, TAU);
      ctx.stroke();
    }

    const first = pointOf(board.winningRun[0]);
    const lastPoint = pointOf(board.winningRun[board.winningRun.length - 1]);
    ctx.strokeStyle = `rgba(255, 240, 180, ${0.3 + 0.35 * pulse})`;
    ctx.lineWidth = Math.max(2, view.cell * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    ctx.lineTo(lastPoint.x, lastPoint.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawHover() {
    if (state.hover < 0 || board.isOver || state.thinking) return;
    if (board.cells[state.hover] !== EMPTY) return;
    if (isComputer(board.turn)) return;

    const { x, y } = pointOf(state.hover);
    drawStone(x, y, board.turn, view.cell * 0.44, 0.36);
  }

  function draw() {
    const now = performance.now();
    ctx.clearRect(0, 0, view.size, view.size);
    drawSurface();
    drawGrid();
    drawLabels();
    drawHover();
    drawStones(now);
    drawWinningRun(now);

    /* Keep animating only while something is actually moving. */
    const dropping = state.placedAt && now - state.placedAt < 160;
    if (dropping || board.winningRun) requestAnimationFrame(draw);
  }

  /* ---- panel ------------------------------------------------------- */

  function describe(player) {
    if (state.mode === 'human') return 'Player ' + (player === BLACK ? '1' : '2');
    if (state.mode === 'ai-ai') return 'Computer';
    return isComputer(player) ? 'Computer' : 'You';
  }

  function renderPanel() {
    el.roleBlack.textContent = describe(BLACK);
    el.roleWhite.textContent = describe(WHITE);
    el.scoreBlack.textContent = state.scores[BLACK];
    el.scoreWhite.textContent = state.scores[WHITE];

    const activeBlack = !board.isOver && board.turn === BLACK;
    el.sideBlack.classList.toggle('active', activeBlack);
    el.sideWhite.classList.toggle('active', !board.isOver && board.turn === WHITE);

    const name = board.turn === BLACK ? 'Black' : 'White';
    el.status.classList.toggle('thinking', state.thinking);

    if (board.winner !== EMPTY) {
      const winner = board.winner === BLACK ? 'Black' : 'White';
      el.status.textContent = `${winner} wins`;
    } else if (board.isDraw) {
      el.status.textContent = 'Draw — the board is full';
    } else if (state.thinking) {
      el.status.textContent = `${name} is thinking`;
    } else if (isComputer(board.turn)) {
      el.status.textContent = `${name} to play`;
    } else if (state.mode === 'human') {
      el.status.textContent = `${name} to play`;
    } else {
      el.status.textContent = `Your move — ${name}`;
    }

    el.moveCount.textContent = board.moveCount;
    el.undo.disabled = state.thinking || state.mode === 'ai-ai' || board.moveCount === 0;
    canvas.classList.toggle('waiting', state.thinking);
    canvas.classList.toggle('done', board.isOver);
  }

  function renderMoves() {
    const list = el.moveList;
    list.textContent = '';

    board.moves.forEach((index, i) => {
      const item = document.createElement('li');
      if (i === board.moves.length - 1) item.className = 'latest';

      const dot = document.createElement('span');
      dot.className = 'dot ' + (i % 2 === 0 ? 'black' : 'white');

      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = i + 1 + '.';

      const coord = document.createElement('span');
      coord.textContent = toCoord(index);

      item.append(dot, num, coord);
      list.append(item);
    });

    list.scrollTop = list.scrollHeight;
  }

  function showBanner() {
    if (!board.isOver) {
      el.banner.hidden = true;
      return;
    }
    if (board.winner === EMPTY) {
      el.bannerTitle.textContent = 'Draw';
      el.bannerSub.textContent = 'The board is full';
    } else {
      const winner = board.winner === BLACK ? 'Black' : 'White';
      const human = humanColor();
      el.bannerTitle.textContent = `${winner} wins`;
      el.bannerSub.textContent =
        human === null ? `Five in a row in ${board.moveCount} moves`
          : board.winner === human ? 'Nice game — you win'
            : 'The computer got there first';
    }
    el.banner.hidden = false;
  }

  function render() {
    renderPanel();
    renderMoves();
    draw();
  }

  /* ---- game flow --------------------------------------------------- */

  function finishIfOver() {
    if (!board.isOver) return false;

    if (board.winner !== EMPTY) {
      state.scores[board.winner]++;
      state.wonAt = performance.now();
    }
    return true;
  }

  function play(index) {
    if (!board.play(index)) return false;

    state.placedAt = performance.now();
    state.hover = -1;
    const over = finishIfOver();
    render();
    if (over) showBanner();
    else scheduleComputer();
    return true;
  }

  function scheduleComputer() {
    clearTimeout(state.timer);
    if (board.isOver || !isComputer(board.turn)) return;

    state.thinking = true;
    renderPanel();

    /* A timer rather than requestAnimationFrame: rAF is suspended while the tab
       is in the background, which would strand the game on "thinking" until the
       user came back. The delay gives the status a chance to paint before the
       search blocks the thread. */
    state.timer = setTimeout(() => {
      if (board.isOver || !isComputer(board.turn)) {
        state.thinking = false;
        render();
        return;
      }

      const move = ai.findMove(board.cells, board.turn);
      state.thinking = false;

      if (move < 0 || !board.canPlay(move)) { render(); return; }
      play(move);
    }, state.mode === 'ai-ai' ? 280 : 40);
  }

  function newGame() {
    clearTimeout(state.timer);
    board.reset();
    state.thinking = false;
    state.hover = -1;
    state.placedAt = 0;
    state.wonAt = 0;
    el.banner.hidden = true;
    render();
    scheduleComputer();
  }

  function undo() {
    if (state.thinking || state.mode === 'ai-ai' || !board.moveCount) return;
    clearTimeout(state.timer);

    const human = humanColor();
    board.undo();
    /* Against the computer, step back past its reply to the player's own turn. */
    while (human !== null && board.moveCount > 0 && board.turn !== human) board.undo();

    state.placedAt = 0;
    state.wonAt = 0;
    el.banner.hidden = true;
    render();
    scheduleComputer();
  }

  /* ---- events ------------------------------------------------------ */

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (board.isOver || state.thinking || isComputer(board.turn)) return;

    const index = indexFromPointer(event);
    if (index >= 0) play(index);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const index = indexFromPointer(event);
    if (index === state.hover) return;
    state.hover = index;
    draw();
  });

  canvas.addEventListener('pointerleave', () => {
    if (state.hover === -1) return;
    state.hover = -1;
    draw();
  });

  el.mode.addEventListener('change', () => {
    state.mode = el.mode.value;
    newGame();
  });

  el.level.addEventListener('change', () => ai.setLevel(el.level.value));
  el.restart.addEventListener('click', newGame);
  el.bannerAgain.addEventListener('click', newGame);
  el.undo.addEventListener('click', undo);

  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;

    if (event.key === 'u' || event.key === 'U') { event.preventDefault(); undo(); }
    if (event.key === 'n' || event.key === 'N') { event.preventDefault(); newGame(); }
  });

  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);

  resize();
  render();
  scheduleComputer();

  /* Exposed for the test harness. */
  window.gomoku = { board, ai, state, play, newGame, undo };
})();
