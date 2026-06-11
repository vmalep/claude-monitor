const HOST = "claude_monitor_host";
const POLL_INTERVAL_MS = 60 * 1000;

async function getOrgId() {
    const resp = await fetch("https://claude.ai/api/organizations", { credentials: "include" });
    if (!resp.ok) return null;
    const orgs = await resp.json();
    return orgs?.[0]?.uuid || null;
}

function fmtReset(isoStr) {
    if (!isoStr) return null;
    const d = new Date(isoStr);
    const now = new Date();
    const diffMs = d - now;
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 60) return `in ${diffMin} min`;
    if (diffMin < 1440) return `in ${Math.round(diffMin / 60)}h`;
    return d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

async function fetchUsage() {
    try {
        const orgId = await getOrgId();
        if (!orgId) return;

        const resp = await fetch(`https://claude.ai/api/organizations/${orgId}/usage`, {
            credentials: "include"
        });
        if (!resp.ok) return;

        const data = await resp.json();

        const payload = {
            session_pct:   data.five_hour?.utilization ?? null,
            session_reset: fmtReset(data.five_hour?.resets_at),
            weekly_pct:    data.seven_day?.utilization ?? null,
            weekly_reset:  fmtReset(data.seven_day?.resets_at),
        };

        console.log("Claude Monitor: sending", payload);

        browser.runtime.sendNativeMessage(HOST, payload)
            .catch(err => console.error("Claude Monitor: native messaging error:", err));

    } catch (err) {
        console.error("Claude Monitor: fetch error", err);
    }
}

fetchUsage();
setInterval(fetchUsage, POLL_INTERVAL_MS);

browser.runtime.onMessage.addListener((message) => {
    if (message.type === "usage_update") {
        browser.runtime.sendNativeMessage(HOST, {
            session_pct:   message.session_pct,
            session_reset: message.session_reset,
            weekly_pct:    message.weekly_pct,
            weekly_reset:  message.weekly_reset,
        }).catch(err => console.error("Claude Monitor: native messaging error:", err));
    }
});
