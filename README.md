# Kahoot Auto Answer

A Chrome extension that works out which Kahoot quiz you're playing, then answers for you (or just highlights the right answer) while you play on [kahoot.it](https://kahoot.it).

## Install

1. Download or clone this repo.
2. Open `chrome://extensions` (also works in Edge, Brave and other Chromium browsers).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick this folder.
5. Pin the extension so its icon shows in the toolbar.

## Use

1. Join the game on kahoot.it as usual.
2. When the first question opens, the extension finds the quiz on its own (see [Auto-detect](#auto-detect)). It then answers each question after a short random delay.
3. A small overlay in the bottom-left corner shows the current question number and its answer, or what it's waiting for.

### Auto-detect

Kahoot never tells players which quiz is being played, so the extension works it out:

1. For each question it notes the question text and the answer texts shown on your device.
2. It searches Kahoot's public quizzes for that text. Kahoot's search covers question and answer text, not just titles.
3. It checks the top results against every question seen so far, plus the total number of questions, and loads the best match.

This usually takes under a second. If a later question doesn't fit the loaded quiz, it detects again.

Auto-detect can't work if:

- **The quiz is private.** Only public quizzes are searchable.
- **Your device only shows coloured shapes**, because the host turned off showing questions and answers on players' devices. There's no text to search with.

In both cases the overlay says so, and you can load the quiz yourself.

### Loading a quiz yourself

Click the extension icon and either:

- **Search** for the quiz title. The host's screen usually shows it when the game starts.
- **Paste the quiz ID or a link** that contains it. The ID is the long code like `272db6c3-a162-4fea-8169-b7794b9bfb3c`. You'll find it in the quiz's page link (`create.kahoot.it/details/…/<id>`) or in the host's browser address bar (`play.kahoot.it/v2/?quizId=<id>`). Players can't see it in their own game.

### Settings

| Setting | What it does |
| --- | --- |
| **Auto-answer** | Highlights and presses the correct answer. |
| **Highlight** | Only highlights the correct answer; you tap it yourself. |
| **Off** | Does nothing on the page. |
| **Answer delay** | Waits a random time in this range before answering. Faster answers score more points. |
| **Detect the quiz automatically** | Turns auto-detect on or off. |
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

- Quizzes come from Kahoot's public API (`create.kahoot.it/rest/kahoots/<id>`) and a trimmed copy is saved in extension storage. `src/kahoot.js` holds the API, search and detection code shared by the popup and the background worker (`src/background.js`).
- `src/bridge.js` passes the quiz and settings to `src/page.js`, which runs in the page itself, and forwards its detection requests to the background worker.
- `page.js` works out which question is on screen. It matches by question text first, then by the set of answer texts, then by the question number. To pick the button, it matches the answer text when the player shows it, otherwise it uses Kahoot's `answer-N` button IDs, which keep the quiz's original order even when the answers are shuffled.
- Kahoot ignores scripted clicks (it checks `event.isTrusted`), so the extension calls the React click handler behind each answer button directly.

## Limitations

- Only **public** quizzes can be loaded or detected.
- If the loaded quiz doesn't contain the question on screen, or has a different number of answers, the overlay turns orange and the extension won't auto-answer.
- Teachers often copy public quizzes. If the game uses an edited copy, auto-detect finds the closest public version, whose answers may differ.
- If the host turns off showing questions and answers on players' devices *and* shuffles the answer order, there's no way to tell which shape is correct, so the answer may be wrong.
- Kahoot changes its site often. If answering stops working, the selectors in `src/page.js` probably need updating.

## Disclaimer

This is an unofficial project and isn't affiliated with Kahoot!. Using it may break Kahoot's terms of service, so only use it where that's okay, such as your own games or practice sessions.
