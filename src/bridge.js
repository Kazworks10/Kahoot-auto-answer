// Runs in the extension's isolated world. The game logic lives in page.js
// (main world, so it can reach React's handlers), which can't use chrome.*
// APIs, so this script relays the loaded quiz and settings to it.
(() => {
  const send = () => {
    chrome.storage.local.get(['quiz', 'settings'], (data) => {
      window.postMessage(
        { __kaa: 'state', quiz: data.quiz || null, settings: data.settings || {} },
        location.origin
      );
    });
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.quiz || changes.settings)) send();
  });

  // page.js says hello on startup in case it loaded after our first send.
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.__kaa === 'hello') send();
  });

  send();
})();
