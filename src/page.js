// Runs in the kahoot.it page's own JS world (see manifest "world": "MAIN").
// It watches the player UI, works out which question is on screen, and then
// highlights and/or presses the correct answer from the quiz loaded in the
// popup. Kahoot ignores synthetic clicks (it checks event.isTrusted), so
// answers are pressed by calling the React handler behind each button.
(() => {
  const DEFAULTS = { mode: 'auto', delayMin: 0.6, delayMax: 1.6, showOverlay: true };
  const SHAPES = [
    { icon: '▲', name: 'Red' },
    { icon: '◆', name: 'Blue' },
    { icon: '●', name: 'Yellow' },
    { icon: '■', name: 'Green' },
  ];
  const AUTO_TYPES = new Set(['quiz', 'multiple_select_quiz']);
  const MODE_LABELS = { auto: 'Auto', highlight: 'Highlight', off: 'Off' };

  let quiz = null;
  let settings = { ...DEFAULTS };
  let store = null;
  let handledKey = null;
  let answerTimer = null;
  let overlay = null;
  let overlayHidden = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const normText = (s) =>
    String(s || '')
      .normalize('NFKC')
      .replace(/[​-‍﻿]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  // ---------------------------------------------------------------- React

  const reactKey = (el, prefix) => Object.keys(el).find((k) => k.startsWith(prefix));

  function fakeEvent(el, type) {
    return {
      type,
      isTrusted: true,
      target: el,
      currentTarget: el,
      bubbles: true,
      defaultPrevented: false,
      nativeEvent: { type, isTrusted: true },
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      isDefaultPrevented() { return this.defaultPrevented; },
      isPropagationStopped() { return false; },
      persist() {},
    };
  }

  // Calls el's React prop handler (e.g. onClick) directly. False if absent.
  function invoke(el, handler) {
    const key = reactKey(el, '__reactProps$');
    const fn = key && el[key] && el[key][handler];
    if (typeof fn !== 'function') return false;
    fn(fakeEvent(el, handler.slice(2).toLowerCase()));
    return true;
  }

  const press = (el) => invoke(el, 'onClick') || el.click();

  // The Redux store, found by walking up the fiber tree to react-redux's
  // <Provider>. Gives the current question index/title without relying on
  // CSS class names.
  function findStore() {
    if (store) return store;
    const start = document.querySelector('[data-functional-selector]');
    const key = start && reactKey(start, '__reactFiber$');
    for (let f = key && start[key]; f; f = f.return) {
      const p = f.memoizedProps;
      const s = p && (p.store || (p.value && p.value.store));
      if (s && typeof s.getState === 'function') return (store = s);
    }
    return null;
  }

  // ----------------------------------------------------------- Game state

  function readGame() {
    const info = { index: null, title: '' };
    try {
      const features = (findStore() && store.getState().features) || {};
      const async = features.asyncGameBlock;
      const asyncBlock = async && async.gameBlocks && async.gameBlocks[async.currentGameBlockIndex];
      if (asyncBlock) {
        // Self-paced challenge: blocks can be queued out of order, so only
        // trust the title.
        info.title = asyncBlock.question || asyncBlock.title || '';
      } else if (features.gameSession) {
        const gs = features.gameSession;
        if (Number.isInteger(gs.questionNumber)) info.index = gs.questionNumber;
        info.title = (gs.gameBlockState && gs.gameBlockState.gameBlockTitle) || '';
      }
    } catch (e) {
      store = null;
    }
    const counter = document.querySelector('[data-functional-selector="question-index-counter"]');
    const shown = counter && parseInt(counter.textContent, 10);
    if (shown > 0) info.index = shown - 1;
    return info;
  }

  // The answer buttons/labels currently on screen. "answer-N" uses the
  // quiz's original choice index even when Kahoot shuffles the display.
  function readAnswers() {
    const out = [];
    document.querySelectorAll('[data-functional-selector^="answer-"]').forEach((el) => {
      const m = /^answer-(\d+)$/.exec(el.getAttribute('data-functional-selector'));
      if (!m) return;
      const label = el.querySelector('[data-functional-selector^="question-choice-text-"]');
      out.push({ el, n: Number(m[1]), pos: out.length, text: normText(label && label.textContent) });
    });
    return out;
  }

  function resolveQuestion(info, answers) {
    const qs = quiz.questions;
    const all = qs.map((_, i) => i);
    const nearest = (hits) =>
      info.index === null
        ? hits[0]
        : hits.reduce((a, b) => (Math.abs(b - info.index) < Math.abs(a - info.index) ? b : a));

    const title = normText(info.title);
    if (title) {
      const hits = all.filter((i) => qs[i]._title === title);
      if (hits.length) return nearest(hits);
    }
    if (answers.length && answers.every((a) => a.text)) {
      const sig = answers.map((a) => a.text).sort().join('\n');
      const hits = all.filter((i) => [...qs[i]._choices].sort().join('\n') === sig);
      if (hits.length) return nearest(hits);
    }
    return info.index !== null && info.index < qs.length ? info.index : -1;
  }

  // Which on-screen answers are correct: match by text when the player shows
  // answer text, otherwise fall back to the original choice index.
  function pickTargets(q, answers) {
    const correct = q.choices.map((c, i) => (c.correct ? i : -1)).filter((i) => i >= 0);
    const wanted = new Set(correct.map((i) => q._choices[i]).filter(Boolean));
    const byText = answers.filter((a) => a.text && wanted.has(a.text));
    if (byText.length) return byText;
    return answers.filter((a) => correct.includes(a.n));
  }

  const shapeOf = (q, pos) => SHAPES[q.layout === 'TRUE_FALSE' ? (pos + 1) % 2 : pos % 4];

  // Calling React handlers skips the browser's disabled check, so do it here.
  function isDisabled(el) {
    const box = el.querySelector('input');
    return el.disabled || el.getAttribute('aria-disabled') === 'true' || !!(box && box.disabled);
  }

  // -------------------------------------------------------------- Actions

  function scheduleAnswer(q, targets) {
    clearTimeout(answerTimer);
    const min = Math.max(0, Number(settings.delayMin) || 0);
    const max = Math.max(min, Number(settings.delayMax) || 0);
    let ms = (min + Math.random() * (max - min)) * 1000;
    if (q.time) ms = Math.min(ms, Math.max(0, q.time - 1500));
    const key = handledKey;
    const wanted = targets.map((t) => t.n);
    answerTimer = setTimeout(() => {
      if (handledKey !== key) return;
      const live = readAnswers().filter((a) => wanted.includes(a.n) && !isDisabled(a.el));
      if (!live.length) return;
      if (q.type === 'multiple_select_quiz') answerMulti(live);
      else press(live[0].el);
    }, ms);
  }

  async function answerMulti(targets) {
    const key = handledKey;
    for (const t of targets) {
      const box = t.el.querySelector('input[type="checkbox"]');
      if (box) {
        if (!box.checked && !invoke(box, 'onChange')) box.click();
      } else {
        press(t.el);
      }
      await sleep(120 + Math.random() * 180);
    }
    // The submit button enables once React has processed the selections.
    for (let i = 0; i < 20 && handledKey === key; i++) {
      await sleep(150);
      const submit = document.querySelector('[data-functional-selector="multi-select-submit-button"]');
      if (submit && !submit.disabled) {
        submit.click();
        return;
      }
    }
  }

  function applyHighlights(answers, targets) {
    const on = settings.mode !== 'off';
    for (const a of answers) {
      const value = !on ? null : targets.includes(a) ? 'correct' : 'other';
      if (value === null) a.el.removeAttribute('data-kaa');
      else if (a.el.getAttribute('data-kaa') !== value) a.el.setAttribute('data-kaa', value);
    }
  }

  // -------------------------------------------------------------- Overlay

  function ensureOverlay() {
    if (overlay && overlay.root.isConnected) return overlay;
    const root = document.createElement('div');
    root.id = 'kaa-overlay';
    root.innerHTML =
      '<div class="kaa-head"><span class="kaa-dot"></span><span class="kaa-name">Auto Answer</span>' +
      '<span class="kaa-mode"></span><span class="kaa-q"></span></div>' +
      '<div class="kaa-body"><div class="kaa-quiz"></div><div class="kaa-answer"></div></div>';
    root.title = 'Click to collapse · Alt+H to hide';
    root.addEventListener('click', () => root.toggleAttribute('data-collapsed'));
    // Outside <body> so our own updates don't wake the page observer.
    document.documentElement.appendChild(root);
    overlay = {
      root,
      mode: root.querySelector('.kaa-mode'),
      q: root.querySelector('.kaa-q'),
      quiz: root.querySelector('.kaa-quiz'),
      answer: root.querySelector('.kaa-answer'),
    };
    return overlay;
  }

  function setText(el, value) {
    if (el.textContent !== value) el.textContent = value;
  }

  function render({ state, q = '', answer = '' }) {
    const o = ensureOverlay();
    const hidden = !settings.showOverlay || overlayHidden;
    if (o.root.hidden !== hidden) o.root.hidden = hidden;
    if (o.root.getAttribute('data-state') !== state) o.root.setAttribute('data-state', state);
    setText(o.mode, MODE_LABELS[settings.mode] || '');
    setText(o.q, q);
    setText(o.quiz, quiz ? quiz.title : 'No quiz loaded');
    setText(o.answer, answer);
  }

  // ------------------------------------------------------------ Main loop

  function tick() {
    const answers = readAnswers();
    if (!quiz) {
      applyHighlights(answers, []);
      render({ state: 'idle', answer: 'Open the extension popup and load a quiz.' });
      return;
    }

    const info = readGame();
    const qi = resolveQuestion(info, answers);
    const q = quiz.questions[qi];
    if (!q) {
      handledKey = null;
      render({
        state: 'idle',
        q: info.index === null ? '' : `Q${info.index + 1}`,
        answer: info.index === null ? 'Waiting for a question…' : 'Question not found in this quiz',
      });
      return;
    }

    const qLabel = `Q${qi + 1}/${quiz.questions.length}`;
    const auto = AUTO_TYPES.has(q.type);
    const targets = auto && answers.length ? pickTargets(q, answers) : [];
    const mismatch = auto && answers.length > 0 && answers.length !== q.choices.length;
    applyHighlights(answers, mismatch ? [] : targets);

    let answer = q.hint;
    if (mismatch) {
      answer = `Wrong quiz? Screen shows ${answers.length} answers, quiz has ${q.choices.length}. Expected: ${q.hint}`;
    } else if (targets.length) {
      answer = targets
        .map((t) => {
          const s = shapeOf(q, t.pos);
          const text = q.choices[t.n] ? q.choices[t.n].answer : '';
          return `${s.icon} ${s.name}${text ? ` · ${text}` : ''}`;
        })
        .join('\n');
    }
    render({ state: mismatch ? 'warn' : 'ok', q: qLabel, answer });

    if (!answers.length) {
      handledKey = null;
      return;
    }
    if (answers.every((a) => isDisabled(a.el))) return;
    const key = `${qi}|${answers.map((a) => a.n).join(',')}`;
    if (key === handledKey) return;
    handledKey = key;
    if (settings.mode === 'auto' && targets.length && !mismatch) scheduleAnswer(q, targets);
  }

  let queued = false;
  function queueTick() {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      tick();
    }, 50);
  }

  function setQuiz(raw) {
    quiz = raw && Array.isArray(raw.questions) ? raw : null;
    if (!quiz) return;
    for (const q of quiz.questions) {
      q.choices = q.choices || [];
      q._title = normText(q.question || q.title);
      q._choices = q.choices.map((c) => normText(c.answer));
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__kaa !== 'state') return;
    setQuiz(e.data.quiz);
    settings = { ...DEFAULTS, ...e.data.settings };
    handledKey = null;
    clearTimeout(answerTimer);
    tick();
  });

  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyH') {
      overlayHidden = !overlayHidden;
      tick();
    }
  });

  new MutationObserver(queueTick).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  setInterval(tick, 1000);
  window.postMessage({ __kaa: 'hello' }, location.origin);
  tick();
})();
