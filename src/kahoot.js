// Kahoot API helpers shared by the popup and the background worker.

export const API = 'https://create.kahoot.it/rest/kahoots/';
export const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// Strips Kahoot's rich-text markup. Regex-based because the service worker
// has no DOMParser.
export function plain(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// Comparison form; must stay in step with normText() in page.js.
export const norm = (s) =>
  plain(s)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

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
      return q.choices.map((c) => c.answer || '(image)').join(' \u2192 ');
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

export async function fetchQuiz(uuid) {
  return trimQuiz(await getJson(API + encodeURIComponent(uuid)));
}

// Public quizzes whose title, questions or answers match the query.
export async function searchQuizzes(query, limit = 20) {
  const data = await getJson(`${API}?query=${encodeURIComponent(query)}&limit=${limit}&cursor=0`);
  return (data.entities || []).map((e) => e.card).filter((c) => c && c.uuid);
}

// --------------------------------------------------------------- Detection
//
// An observation is what the player showed for one question:
// { index, title, choices: [answer texts] }. Either part may be empty.

const choiceSig = (texts) => texts.map(norm).sort().join('\n');

function observationScore(q, o) {
  if (!q) return 0;
  let score = 0;
  if (o.title) {
    if (norm(q.question || q.title) !== norm(o.title)) return 0;
    score += 2;
  }
  if (o.choices.length) {
    if (choiceSig(q.choices.map((c) => c.answer)) === choiceSig(o.choices)) score += 1;
    else if (!o.title) return 0;
  }
  return score;
}

function quizScore(quiz, observations, total) {
  const score = observations.reduce((s, o) => s + observationScore(quiz.questions[o.index], o), 0);
  return score && score + (quiz.questions.length === total ? 1 : 0);
}

// Finds the public quiz that best explains what the player has shown so far.
// Returns null when nothing matches (e.g. the quiz is private).
export async function detectQuiz(observations, total) {
  const obs = observations.filter((o) => o.title || o.choices.length);
  if (!obs.length) return null;

  // The longest texts are the most distinctive search terms.
  const queries = [...new Set(obs.map((o) => (o.title || o.choices.join(' ')).slice(0, 200)))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);
  const cards = new Map();
  const results = await Promise.all(queries.map((q) => searchQuizzes(q, 25).catch(() => [])));
  for (const list of results) {
    list.forEach((c, rank) => cards.has(c.uuid) || cards.set(c.uuid, { uuid: c.uuid, count: c.number_of_questions, rank }));
  }

  // Check the likeliest candidates: same length as the game, then search rank.
  const candidates = [...cards.values()]
    .sort((a, b) => (b.count === total) - (a.count === total) || a.rank - b.rank)
    .slice(0, 8);
  const quizzes = await Promise.all(candidates.map((c) => fetchQuiz(c.uuid).catch(() => null)));

  let best = null;
  let bestScore = 0;
  for (const quiz of quizzes) {
    const score = quiz ? quizScore(quiz, obs, total) : 0;
    if (score > bestScore) {
      best = quiz;
      bestScore = score;
    }
  }
  return best;
}
