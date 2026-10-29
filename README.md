# Kahoot Auto Answer

A Chrome extension that loads a Kahoot quiz's answers and then answers for you (or just highlights the right answer) while you play on [kahoot.it](https://kahoot.it).

## Install

1. Download or clone this repo.
2. Open `chrome://extensions` (also works in Edge, Brave and other Chromium browsers).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick this folder.
5. Pin the extension so its icon shows in the toolbar.

## Use

1. Click the extension icon and load the quiz:
   - **Quiz ID or link**: paste the quiz's ID or any link that contains it, such as `create.kahoot.it/details/…/<id>` or the host's `play.kahoot.it/v2/?quizId=<id>`.
   - **Search**: type the quiz title (the host's screen shows it at the start) and pick the right result.
2. Join the game on kahoot.it as usual.
3. When each question opens, the extension answers it after a short random delay. A small overlay in the bottom-left corner shows the current question number and its answer.

### Settings

| Setting | What it does |
| --- | --- |
| **Auto-answer** | Highlights and presses the correct answer. |
| **Highlight** | Only highlights the correct answer; you tap it yourself. |
| **Off** | Does nothing on the page. |
| **Answer delay** | Waits a random time in this range before answering. Faster answers score more points. |
| **Show answer overlay** | Shows or hides the in-game overlay. **Alt+H** also toggles it, and clicking it collapses it. |

The popup's **Show all answers** list shows every question and its answer.

### Question types

| Type | Support |
| --- | --- |
| Quiz, True/False | Auto-answer |
| Multi-select quiz | Auto-answer (picks every correct choice, then submits) |
| Type answer | Shows the accepted answer(s) |
| Slider | Shows the correct value |
| Puzzle (jumble) | Shows the correct order |
| Polls, word cloud, brainstorm, slides | Nothing to answer |
| Pin answer | Not supported |

## How it works

- The popup fetches the quiz from Kahoot's public API (`create.kahoot.it/rest/kahoots/<id>`) and saves a trimmed copy in extension storage.
- `src/bridge.js` passes the quiz and settings to `src/page.js`, which runs in the page itself.
- `page.js` works out which question is on screen. It matches by question text first, then by the set of answer texts, then by the question number. To pick the button, it matches the answer text when the player shows it, otherwise it uses Kahoot's `answer-N` button IDs, which keep the quiz's original order even when the answers are shuffled.
- Kahoot ignores scripted clicks (it checks `event.isTrusted`), so the extension calls the React click handler behind each answer button directly.

## Limitations

- Only **public** quizzes can be loaded. Private quizzes return an error.
- The player app doesn't reveal which quiz is being played, so you have to load the right one yourself. If the number of answers on screen doesn't match the loaded quiz, the overlay turns orange with a warning and the extension won't auto-answer.
- If the host turns off showing questions and answers on players' devices *and* shuffles the answer order, there's no way to tell which shape is correct, so the answer may be wrong.
- Kahoot changes its site often. If answering stops working, the selectors in `src/page.js` probably need updating.

## Disclaimer

This is an unofficial project and isn't affiliated with Kahoot!. Using it may break Kahoot's terms of service, so only use it where that's okay, such as your own games or practice sessions.
