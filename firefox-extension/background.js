/**
 * background.js
 *
 * Receives usage data from content.js and forwards it to the
 * native messaging host (claude_monitor_host.py), which writes ~/.claude_cost.
 */

const HOST = "claude_monitor_host";

browser.runtime.onMessage.addListener((message) => {
    if (message.type !== "usage_update") return;

    const payload = {
        session_pct:   message.session_pct,
        session_reset: message.session_reset,
        weekly_pct:    message.weekly_pct,
        weekly_reset:  message.weekly_reset,
    };

    browser.runtime.sendNativeMessage(HOST, payload).catch((err) => {
        console.error("Claude Monitor: native messaging error:", err);
    });
});
