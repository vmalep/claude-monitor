/**
 * content.js — runs on claude.ai pages
 *
 * Reads the usage % from the Plan usage limits popup DOM and sends
 * it to the background script, which forwards it via native messaging
 * to the local Python host.
 *
 * The popup is opened by clicking the usage indicator in claude.ai's UI.
 * This script observes DOM mutations to catch it whenever it appears.
 */

let lastSent = null;

function parseReset(text) {
    // e.g. "Resets in 50 min" or "Resets Sat 3:59 AM"
    if (!text) return null;
    const m = text.match(/resets?\s+(.+)/i);
    return m ? m[1].trim() : text.trim();
}

function parsePct(text) {
    // e.g. "16% used"
    if (!text) return null;
    const m = text.match(/(\d+)%/);
    return m ? parseInt(m[1], 10) : null;
}

function extractUsage() {
    // Look for the usage popup container
    // Claude.ai renders a modal/popover with "Plan usage limits" heading
    const headings = document.querySelectorAll('*');
    let container = null;

    for (const el of headings) {
        if (el.children.length === 0 &&
            el.textContent.trim() === 'Plan usage limits') {
            container = el.closest('[class*="modal"], [class*="popover"], [role="dialog"], [class*="popup"]')
                     || el.parentElement?.parentElement?.parentElement;
            break;
        }
    }

    if (!container) return null;

    const allText = container.innerText || container.textContent || '';
    const lines = allText.split('\n').map(l => l.trim()).filter(Boolean);

    // Find percentage lines and reset lines
    let sessionPct = null, sessionReset = null;
    let weeklyPct  = null, weeklyReset  = null;

    // Look for "Current session" block
    for (let i = 0; i < lines.length; i++) {
        if (/current session/i.test(lines[i])) {
            // Look ahead for "X% used" and "Resets ..."
            for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                if (parsePct(lines[j]) !== null && sessionPct === null)
                    sessionPct = parsePct(lines[j]);
                if (/resets?/i.test(lines[j]) && !sessionReset)
                    sessionReset = parseReset(lines[j]);
            }
        }
        if (/weekly/i.test(lines[i])) {
            for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                if (parsePct(lines[j]) !== null && weeklyPct === null)
                    weeklyPct = parsePct(lines[j]);
                if (/resets?/i.test(lines[j]) && !weeklyReset)
                    weeklyReset = parseReset(lines[j]);
            }
        }
    }

    if (sessionPct === null && weeklyPct === null) return null;

    return { sessionPct, sessionReset, weeklyPct, weeklyReset };
}

function sendUsage(data) {
    const key = JSON.stringify(data);
    if (key === lastSent) return; // no change, don't spam
    lastSent = key;

    browser.runtime.sendMessage({
        type: "usage_update",
        session_pct:   data.sessionPct,
        session_reset: data.sessionReset,
        weekly_pct:    data.weeklyPct,
        weekly_reset:  data.weeklyReset,
    });
}

// Watch for DOM changes (popup opening/closing)
const observer = new MutationObserver(() => {
    const data = extractUsage();
    if (data) sendUsage(data);
});

observer.observe(document.body, { childList: true, subtree: true });

// Also try immediately in case page already has the popup
const initial = extractUsage();
if (initial) sendUsage(initial);
