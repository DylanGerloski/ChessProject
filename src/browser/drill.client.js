'use strict';

/**
 * Page controller for the static opening-drill page (dist/italian-game-drill.html).
 *
 * This file is NOT loaded via CommonJS module loading -- it's appended as
 * plain text after src/chessPosition.js and src/drillLogic.js by
 * src/buildStatic.js's buildDrillBundle(), so it runs in the same top-level
 * scope and can call applyUciMove / applyUciMoves / START_BOARD / FILES /
 * RANKS (chessPosition.js) and normalizeMoveInput / gradeMove / pickReply /
 * applyRoundResult (drillLogic.js) directly, without any import statement.
 * All non-DOM logic lives in those two bundled modules; this file only
 * paints the board, wires up events, and reads/writes localStorage.
 *
 * Every move in the baked drill tree comes from the Lichess Opening
 * Explorer and is legal by construction (see chessPosition.js's own header
 * comment) -- this controller never validates a move's legality itself.
 *
 * Wrapped in an IIFE only to keep its own helper names out of the shared
 * top-level scope the bundled modules above it use.
 */
(function () {
  var STORAGE_KEY = 'lichess-stats.drill.italian-game.v1';
  var PIECE_NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

  // Baked drill percentages are stored as Number(x.toFixed(1)), which drops
  // a trailing zero (4.0 becomes the number 4) -- see src/render.js's
  // formatPct for the server-rendered-page counterpart of this same
  // render-time fix. Re-applying toFixed(1) here keeps this client-side
  // repaint at the same one-decimal precision as the rest of the site.
  function formatPct(n) {
    return typeof n === 'number' ? n.toFixed(1) : null;
  }

  // This file is bundled without src/render.js (see buildDrillBundle()'s
  // header comment), so it can't call render.js's escapeHtml -- this is a
  // standalone copy of the same five-character escaper, kept here because
  // renderCandidateTable() below builds HTML by string concatenation from
  // Lichess Opening Explorer data. That data is baked in at build time
  // rather than typed by a visitor, but it's still third-party content and
  // is treated as untrusted per the same rule render.js's escapeHtml
  // follows.
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var dataEl = document.getElementById('drill-data');
  if (!dataEl) return; // no drill data present -- nothing to wire up

  var drillData;
  try {
    drillData = JSON.parse(dataEl.textContent);
  } catch (err) {
    return; // corrupt data -- leave the server-rendered page as-is
  }

  var boardRoot = document.querySelector('[data-drill-board]');
  var form = document.getElementById('drill-move-form');
  var input = document.getElementById('drill-move-text');
  var showAnswerBtn = document.getElementById('drill-show-answer');
  var bandSelect = document.getElementById('drill-band');
  var levelSelect = document.getElementById('drill-level');
  var feedbackEl = document.getElementById('drill-feedback');
  var announceEl = document.getElementById('drill-announce');
  var candidateTableEl = document.getElementById('drill-candidate-table');
  var progressEl = document.getElementById('drill-level-progress');
  if (!boardRoot || !form || !input || !bandSelect || !levelSelect) return;

  function loadState() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) throw new Error('none saved yet');
      var parsed = JSON.parse(raw);
      if (typeof parsed.level !== 'number' || typeof parsed.cleanStreak !== 'number' || typeof parsed.band !== 'string') {
        throw new Error('unexpected shape');
      }
      if (!drillData.bands[parsed.band]) throw new Error('unknown band');
      return parsed;
    } catch (err) {
      var fallbackBand = Object.prototype.hasOwnProperty.call(drillData.bands, '1600-1800')
        ? '1600-1800'
        : Object.keys(drillData.bands)[0];
      return { level: 1, cleanStreak: 0, band: fallbackBand };
    }
  }

  function saveState(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      // localStorage unavailable (private mode, quota, disabled) -- the
      // drill still works for this page load, it just won't remember
      // progress on reload.
    }
  }

  var state = loadState();
  var round = null; // {board, oppNode, userNode, level, band, movesDone, clean, selected}

  function squareButtons() {
    return boardRoot.querySelectorAll('.board-sq');
  }

  function pieceLabel(piece) {
    if (!piece) return null;
    var isWhite = piece === piece.toUpperCase();
    return (isWhite ? 'white ' : 'black ') + (PIECE_NAMES[piece.toLowerCase()] || '');
  }

  function paintBoard(board) {
    var buttons = squareButtons();
    for (var i = 0; i < buttons.length; i += 1) {
      var btn = buttons[i];
      var sq = btn.getAttribute('data-square');
      var piece = board[sq];
      var isWhite = !!piece && piece === piece.toUpperCase();
      var glyph = piece ? drillData.glyphs[piece.toLowerCase()] : '';
      btn.innerHTML = glyph ? '<span class="board-pc--' + (isWhite ? 'w' : 'b') + '" aria-hidden="true">' + glyph + '</span>' : '';
      var label = pieceLabel(piece) ? sq + ', ' + pieceLabel(piece) : sq + ', empty';
      btn.setAttribute('aria-label', label);
      btn.setAttribute('aria-pressed', 'false');
    }
  }

  function announce(text) {
    if (announceEl) announceEl.textContent = text;
  }

  function setFeedback(verdict, text) {
    if (!feedbackEl) return;
    feedbackEl.className = verdict ? 'drill-feedback drill-feedback--' + verdict : 'drill-feedback';
    feedbackEl.textContent = text;
  }

  function renderCandidateTable(candidates) {
    if (!candidateTableEl) return;
    var rows = candidates
      .map(function (c) {
        return '<tr><td>' + escapeHtml(c.san) + '</td><td>' + (c.playedPct != null ? escapeHtml(formatPct(c.playedPct) + '%') : '-') + '</td><td>' +
          (c.winPct != null ? escapeHtml(formatPct(c.winPct) + '%') : '-') + '</td><td>' + escapeHtml(c.games.toLocaleString()) + '</td></tr>';
      })
      .join('');
    candidateTableEl.innerHTML = '<table><thead><tr><th scope="col">Move</th><th scope="col">Pick %</th><th scope="col">Score %</th><th scope="col">Games</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function applyMoveToBoard(uci) {
    round.board = applyUciMove(round.board, uci);
    paintBoard(round.board);
  }

  function isWhitePiece(piece) {
    return !!piece && piece === piece.toUpperCase();
  }

  function updateProgress() {
    if (!progressEl) return;
    var moveInRound = round ? round.movesDone + 1 : 1;
    progressEl.textContent = 'Level ' + state.level + ', move ' + Math.min(moveInRound, state.level) + ' of ' + state.level +
      '. Clean streak: ' + state.cleanStreak + '/3.';
  }

  function updateLevelOptions() {
    var options = levelSelect.options;
    for (var i = 0; i < options.length; i += 1) {
      var lvl = Number(options[i].value);
      options[i].disabled = lvl > state.level;
      options[i].textContent = 'Level ' + lvl + (lvl > state.level ? ' (locked)' : '');
    }
    levelSelect.value = String(state.level);
  }

  function clearSelection() {
    var buttons = squareButtons();
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].setAttribute('aria-pressed', 'false');
    }
  }

  function playOpponentPly() {
    var reply = pickReply(round.oppNode.replies, Math.random());
    applyMoveToBoard(reply.uci);
    round.userNode = reply.node;
    announce(
      'The opponent plays ' + reply.san +
        (reply.playedPct != null ? ' — ' + formatPct(reply.playedPct) + '% of players at ' + round.band + ' play this here.' : '.')
    );
    renderCandidateTable(round.userNode.candidates);
    updateProgress();
  }

  function startRound() {
    round = {
      board: applyUciMoves(START_BOARD, drillData.prefix.map(function (p) { return p.uci; })),
      oppNode: drillData.bands[state.band],
      userNode: null,
      level: state.level,
      band: state.band,
      movesDone: 0,
      clean: true,
      selected: null,
    };
    paintBoard(round.board);
    setFeedback('', '');
    playOpponentPly();
  }

  function finishRound() {
    var next = applyRoundResult({ level: state.level, cleanStreak: state.cleanStreak }, { clean: round.clean });
    var leveledUp = next.level > state.level;
    state.level = next.level;
    state.cleanStreak = next.cleanStreak;
    saveState(state);
    updateLevelOptions();
    announce(
      (round.clean ? 'Round complete, clean. ' : 'Round complete. ') +
        (leveledUp ? 'Level ' + state.level + ' unlocked!' : '')
    );
    round = null;
    updateProgress();
  }

  function gradeAndAdvance(rawInput, usedShowAnswer) {
    if (!round || !round.userNode) return;
    var result = gradeMove({ node: round.userNode, input: rawInput });
    var answer = result.answer;

    if (usedShowAnswer) {
      round.clean = false;
      setFeedback('unknown', 'The move is ' + answer.san + ' — ' + formatPct(answer.playedPct) + '% of players at ' + round.band + ' play this here, scoring ' + formatPct(answer.winPct) + '% for White.');
    } else if (result.verdict === 'correct') {
      setFeedback('correct', answer.san + ' — correct. ' + formatPct(answer.playedPct) + '% of ' + round.band + ' players play this here, and it scores ' + formatPct(answer.winPct) + '% for White (n = ' + answer.games.toLocaleString() + ').');
    } else if (result.verdict === 'offmeta') {
      round.clean = false;
      setFeedback('offmeta', result.played.san + ' — a real move, but off-meta here. ' + formatPct(result.played.playedPct) + '% of ' + round.band + ' players choose it and it scores ' + formatPct(result.played.winPct) + '% for White. The band-typical move is ' + answer.san + ': ' + formatPct(answer.playedPct) + '% pick rate, ' + formatPct(answer.winPct) + '% score.');
    } else {
      round.clean = false;
      setFeedback('unknown', 'That is not a move players make in this position at ' + round.band + '. The band-typical move is ' + answer.san + ' — ' + formatPct(answer.playedPct) + '% pick rate, ' + formatPct(answer.winPct) + '% score.');
    }

    // Only the top candidate's line continues into the baked tree, so every
    // round advances via the answer move regardless of what was typed --
    // the user still sees exactly what they played graded against it above.
    applyMoveToBoard(answer.uci);
    round.movesDone += 1;

    if (round.movesDone >= round.level || !round.userNode.then) {
      finishRound();
      return;
    }
    round.userNode = null;
    playOpponentPly();
  }

  function handleSquareClick(square) {
    if (!round || !round.userNode) return;
    var piece = round.board[square];
    if (round.selected == null) {
      if (!isWhitePiece(piece)) {
        announce('No white piece on ' + square + '.');
        return;
      }
      round.selected = square;
      clearSelection();
      var btn = boardRoot.querySelector('[data-square="' + square + '"]');
      if (btn) btn.setAttribute('aria-pressed', 'true');
      return;
    }
    if (round.selected === square) {
      round.selected = null;
      clearSelection();
      return;
    }
    var from = round.selected;
    round.selected = null;
    clearSelection();
    gradeAndAdvance(from + square, false);
  }

  boardRoot.addEventListener('click', function (event) {
    var target = event.target;
    while (target && target !== boardRoot && !target.classList.contains('board-sq')) {
      target = target.parentNode;
    }
    if (!target || target === boardRoot) return;
    handleSquareClick(target.getAttribute('data-square'));
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var value = input.value.trim();
    if (!value) return;
    input.value = '';
    gradeAndAdvance(value, false);
  });

  if (showAnswerBtn) {
    showAnswerBtn.addEventListener('click', function () {
      if (!round || !round.userNode) return;
      gradeAndAdvance(round.userNode.answerUci, true);
    });
  }

  bandSelect.addEventListener('change', function () {
    state.band = bandSelect.value;
    saveState(state);
    startRound();
  });

  levelSelect.addEventListener('change', function () {
    var lvl = Number(levelSelect.value);
    if (lvl > state.level) {
      levelSelect.value = String(state.level);
      return;
    }
    state.level = lvl;
    saveState(state);
    startRound();
  });

  bandSelect.value = state.band;
  updateLevelOptions();
  startRound();
})();
