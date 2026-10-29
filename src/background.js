import { detectQuiz } from './kahoot.js';

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// Messages come from the kahoot.it page (via bridge.js), so validate them.
function cleanObservations(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 200).flatMap((o) => {
    if (!o || !Number.isInteger(o.index) || o.index < 0) return [];
    const choices = Array.isArray(o.choices) ? o.choices.slice(0, 12).map((c) => str(c, 500)) : [];
    return [{ index: o.index, title: str(o.title, 1000), choices: choices.every(Boolean) ? choices : [] }];
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'detect') return false;
  const total = Number.isInteger(msg.total) ? msg.total : 0;
  detectQuiz(cleanObservations(msg.observations), total)
    .then(async (quiz) => {
      if (!quiz) return sendResponse({ ok: false });
      await chrome.storage.local.set({ quiz: { ...quiz, autoDetected: true } });
      sendResponse({ ok: true, title: quiz.title });
    })
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true; // keeps the channel open for the async response
});
