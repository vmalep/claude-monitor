let lastSent = null;

function extractUsage() {
    const allText = document.body.innerText;
    const pctMatches = [...allText.matchAll(/(\d+)%\s*used/gi)];
    const resetMatches = [...allText.matchAll(/Resets?\s+([^\n]+)/gi)];
    if (pctMatches.length === 0) return null;
    return {
        sessionPct:   pctMatches[0] ? parseInt(pctMatches[0][1]) : null,
        sessionReset: resetMatches[0] ? resetMatches[0][1].trim() : null,
        weeklyPct:    pctMatches[1] ? parseInt(pctMatches[1][1]) : null,
        weeklyReset:  resetMatches[1] ? resetMatches[1][1].trim() : null,
    };
}

function sendUsage(data) {
    const key = JSON.stringify(data);
    if (key === lastSent) return;
    lastSent = key;
    browser.runtime.sendMessage({
        type: "usage_update",
        session_pct:   data.sessionPct,
        session_reset: data.sessionReset,
        weekly_pct:    data.weeklyPct,
        weekly_reset:  data.weeklyReset,
    });
}

const observer = new MutationObserver(() => {
    const data = extractUsage();
    if (data) sendUsage(data);
});
observer.observe(document.body, { childList: true, subtree: true });

const initial = extractUsage();
if (initial) sendUsage(initial);
