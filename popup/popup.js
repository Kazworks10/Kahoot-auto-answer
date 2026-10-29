const API = 'https://create.kahoot.it/rest/kahoots/';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const DEFAULTS = { mode: 'auto', delayMin: 0.6, delayMax: 1.6, showOverlay: true };
const POLL_TYPES = new Set([
  'survey',
  'multiple_select_poll',
  'word_cloud',
  'brainstorming',
  'feedback',
  'scale',
  'nps',
  'open_question',
]);

const $ = (id) => document.getElementById(id);
const parser = new DOMParser();
const plain = (html) =>
  (parser.parseFromString(String(html || ''), 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();

let settings = { ...DEFAULTS };

// ------------------------------------------------------------------ Kahoot API

async function getJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('Could not reach Kahoot. Check your connection.');
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error("That quiz is private, so its answers can't be loaded.");
  }
  if (res.status === 404) throw new Error('No quiz found with that ID.');
  if (!res.ok) throw new Error(`Kahoot returned an error (${res.status}).`);
  return res.json();
}

// What the overlay and answer list show for a question.
function hintFor(q) {
  const correct = q.choices.filter((c) => c.correct).map((c) => c.answer || '(image)');
  switch (q.type) {
    case 'quiz':
    case 'multiple_select_quiz':
      return correct.join(' + ') || 'No correct answer set';
    case 'open_ended':
      return `Type: ${correct.join(' / ')}`;
    case 'jumble':
      return q.choices.map((c) => c.answer || '(image)').join(' → ');
    case 'slider':
      return q.choiceRange ? `Slide to ${q.choiceRange.correct}` : 'Slider';
    case 'content':
      return 'Info slide, nothing to answer';
    case 'pin_it':
    case 'drop_pin':
      return 'Pin question, not supported';
    default:
      return POLL_TYPES.has(q.type) ? 'Poll, no correct answer' : `Unsupported type: ${q.type}`;
  }
}

// Keep only what the content script needs, with HTML stripped from text.
function trimQuiz(k) {
  return {
    uuid: k.uuid,
    title: plain(k.title) || 'Untitled quiz',
    creator: k.creator_username || '',
    cover: k.cover || '',
    questions: (k.questions || []).map((q) => {
      const out = {
        type: q.type,
        question: plain(q.question),
        title: plain(q.title),
        layout: q.layout || '',
        time: q.time || 0,
        choices: (q.choices || []).map((c) => ({ answer: plain(c.answer), correct: !!c.correct })),
        choiceRange: q.choiceRange || null,
      };
      out.hint = hintFor(out);
      return out;
    }),
  };
}

async function loadQuiz(uuid) {
  setStatus('Loading quiz…');
  try {
    const quiz = trimQuiz(await getJson(API + encodeURIComponent(uuid)));
    await chrome.storage.local.set({ quiz });
    renderQuiz(quiz);
    $('results').replaceChildren();
    setStatus(`Loaded ${quiz.questions.length} questions.`, 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function search(query) {
  setStatus('Searching…');
  $('results').replaceChildren();
  try {
    const data = await getJson(`${API}?query=${encodeURIComponent(query)}&limit=20&cursor=0`);
    const cards = (data.entities || []).map((e) => e.card).filter((c) => c && c.uuid);
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
        .join(' · ');
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
  $('quiz-meta').textContent = [`${quiz.questions.length} questions`, quiz.creator && `by ${quiz.creator}`]
    .filter(Boolean)
    .join(' · ');
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
}

function saveSettings() {
  const min = Math.max(0, Number($('delay-min').value) || 0);
  const max = Math.max(min, Number($('delay-max').value) || 0);
  settings = {
    mode: document.querySelector('input[name="mode"]:checked')?.value || DEFAULTS.mode,
    delayMin: min,
    delayMax: max,
    showOverlay: $('show-overlay').checked,
  };
  renderSettings();
  chrome.storage.local.set({ settings });
}

$('id-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const match = $('quiz-id').value.match(UUID_RE);
  if (match) loadQuiz(match[0].toLowerCase());
  else setStatus("That doesn't look like a quiz ID. It's a long code like 1a2b3c4d-…", 'error');
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

chrome.storage.local.get(['quiz', 'settings'], (data) => {
  settings = { ...DEFAULTS, ...data.settings };
  renderSettings();
  renderQuiz(data.quiz || null);
});
