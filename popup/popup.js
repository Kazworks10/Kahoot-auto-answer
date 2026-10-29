import { UUID_RE, fetchQuiz, plain, searchQuizzes } from '../src/kahoot.js';

const DEFAULTS = {
  mode: 'auto',
  delayMin: 0.6,
  delayMax: 1.6,
  showOverlay: true,
  autoDetect: true,
  humanize: false,
  accuracy: 80,
};

const $ = (id) => document.getElementById(id);

let settings = { ...DEFAULTS };

// ------------------------------------------------------------------ Kahoot API

async function loadQuiz(uuid) {
  setStatus('Loading quiz\u2026');
  try {
    const quiz = await fetchQuiz(uuid);
    await chrome.storage.local.set({ quiz });
    renderQuiz(quiz);
    $('results').replaceChildren();
    setStatus(`Loaded ${quiz.questions.length} questions.`, 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function search(query) {
  setStatus('Searching\u2026');
  $('results').replaceChildren();
  try {
    const cards = await searchQuizzes(query);
    if (!cards.length) {
      setStatus('No public quizzes matched.', 'error');
      return;
    }
    setStatus('');
    for (const c of cards) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      const title = document.createElement('span');
      title.className = 'r-title';
      title.textContent = plain(c.title) || 'Untitled quiz';
      const meta = document.createElement('span');
      meta.className = 'r-meta';
      meta.textContent = [
        `${c.number_of_questions ?? '?'} questions`,
        c.creator_username && `by ${c.creator_username}`,
      ]
        .filter(Boolean)
        .join(' \u00B7 ');
      btn.append(title, meta);
      btn.addEventListener('click', () => loadQuiz(c.uuid));
      li.append(btn);
      $('results').append(li);
    }
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

// ------------------------------------------------------------------------ UI

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = kind;
}

function renderQuiz(quiz) {
  $('loaded').hidden = !quiz;
  if (!quiz) return;
  $('quiz-title').textContent = quiz.title;
  $('quiz-meta').textContent = [
    `${quiz.questions.length} questions`,
    quiz.creator && `by ${quiz.creator}`,
    quiz.autoDetected && 'auto-detected',
  ]
    .filter(Boolean)
    .join(' \u00B7 ');
  $('quiz-cover').hidden = !quiz.cover;
  if (quiz.cover) $('quiz-cover').src = quiz.cover;

  const list = $('answer-list');
  list.replaceChildren();
  for (const q of quiz.questions) {
    const li = document.createElement('li');
    const question = document.createElement('div');
    question.className = 'a-q';
    question.textContent = q.question || q.title || '(no text)';
    const answer = document.createElement('div');
    answer.className = 'a-a';
    answer.textContent = q.hint;
    li.append(question, answer);
    list.append(li);
  }
}

function renderSettings() {
  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.checked = r.value === settings.mode;
  });
  $('delay-min').value = settings.delayMin;
  $('delay-max').value = settings.delayMax;
  $('show-overlay').checked = settings.showOverlay;
  $('auto-detect').checked = settings.autoDetect;
  $('humanize').checked = settings.humanize;
  $('accuracy').value = settings.accuracy;
  $('accuracy').disabled = !settings.humanize;
}

function saveSettings() {
  const min = Math.max(0, Number($('delay-min').value) || 0);
  const max = Math.max(min, Number($('delay-max').value) || 0);
  const accuracy = $('accuracy').valueAsNumber;
  settings = {
    mode: document.querySelector('input[name="mode"]:checked')?.value || DEFAULTS.mode,
    delayMin: min,
    delayMax: max,
    showOverlay: $('show-overlay').checked,
    autoDetect: $('auto-detect').checked,
    humanize: $('humanize').checked,
    accuracy: Number.isNaN(accuracy) ? DEFAULTS.accuracy : Math.min(100, Math.max(0, Math.round(accuracy))),
  };
  renderSettings();
  chrome.storage.local.set({ settings });
}

$('id-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const match = $('quiz-id').value.match(UUID_RE);
  if (match) loadQuiz(match[0].toLowerCase());
  else setStatus("That doesn't look like a quiz ID. It's a long code like 1a2b3c4d-\u2026", 'error');
});

$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const query = $('search').value.trim();
  if (query) search(query);
});

$('clear').addEventListener('click', async () => {
  await chrome.storage.local.remove('quiz');
  renderQuiz(null);
  setStatus('Quiz unloaded.');
});

$('quiz-cover').addEventListener('error', () => {
  $('quiz-cover').hidden = true;
});

document.querySelectorAll('#settings input').forEach((el) => el.addEventListener('change', saveSettings));

// The background worker may load a detected quiz while the popup is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.quiz) return;
  const quiz = changes.quiz.newValue || null;
  renderQuiz(quiz);
  if (quiz && quiz.autoDetected) setStatus('');
});

chrome.storage.local.get(['quiz', 'settings'], (data) => {
  settings = { ...DEFAULTS, ...data.settings };
  renderSettings();
  renderQuiz(data.quiz || null);
});
