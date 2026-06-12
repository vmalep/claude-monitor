# Claude Monitor

A GNOME top bar indicator that shows your **Claude.ai usage** (session %, weekly %) and **Claude Code session cost** in real time on Ubuntu/GNOME.

![Screenshot showing Claude: 34% in the GNOME top bar](screenshot.png)

## What it shows

Clicking the indicator opens a dropdown with:

| Field | Source |
|---|---|
| Session % used + reset time | claude.ai (via poller daemon) |
| Weekly % used + reset time | claude.ai (via poller daemon) |
| Claude Code session cost ($) | Claude Code hook |
| Input / output tokens | Claude Code hook |
| Last updated time | automatic |

The top bar label shows the **session % in colour** (blue → yellow → red as you approach the limit), or the Claude Code cost if no web data is available. When the session reaches 100% and Claude becomes unavailable, the label switches to **`Claude: FULL – reset in Xm`** and counts down live every 5 seconds until the session resets.

## Components

```
claude-monitor/
├── gnome-extension/        GNOME Shell extension (top bar indicator)
├── native-host/
│   ├── claude_poller.py         Poller daemon (reads claude.ai usage every 60 s)
│   ├── claude-monitor.service   systemd user service for the poller
│   └── write_cost.py            Claude Code Stop hook
├── packaging/
│   └── build-deb.sh             Builds the .deb package
├── install.sh
└── uninstall.sh
```

## Requirements

- Ubuntu with GNOME Shell 45–50
- Python 3
- A claude.ai account (Pro or Max plan)

## Installation

### Option 1 — .deb package (recommended)

Download the latest `.deb` from the [Releases page](https://github.com/vmalep/claude-monitor/releases) and install it:

```bash
sudo dpkg -i claude-monitor_1.4_all.deb
```

Then run the one-time per-user setup:

```bash
claude-monitor-setup
```

Log out and back in if prompted to reload the GNOME extension.

### Option 2 — from source

```bash
git clone https://github.com/vmalep/claude-monitor
cd claude-monitor
chmod +x install.sh
./install.sh
```

Then **log out and back in** (required for GNOME to load the new extension).

After logging back in:

```bash
gnome-extensions enable claude-cost@local
```

### Poller daemon

Both installation methods set up `claude_poller.py` as a systemd user service that starts on login and polls `claude.ai` every 60 seconds. It authenticates by reading session cookies from your Firefox profile on disk — no browser needs to be open.

Check its status at any time:

```bash
systemctl --user status claude-monitor
journalctl --user -u claude-monitor -f   # live logs
```

### Test it

The GNOME top bar updates within 60 seconds of installation.

To test Claude Code tracking manually:

```bash
echo '{"cost_usd": 0.005, "input_tokens": 1000, "output_tokens": 200}' \
  | python3 ~/.claude/hooks/write_cost.py
cat ~/.claude_cost
```

## Data format

All data is stored in `~/.claude_cost` as JSON:

```json
{
  "session_pct":      16,
  "session_reset":    "in 50 min",
  "session_reset_at": "2026-06-12T19:20:00Z",
  "weekly_pct":       21,
  "weekly_reset":     "Sat 3:59 AM",
  "code_cost":        0.0123,
  "input_tokens":     5000,
  "output_tokens":    1200,
  "last_updated":     "2026-06-12T18:30:00+00:00"
}
```

`session_reset_at` is the raw ISO timestamp used by the extension to compute the live countdown without waiting for the next poll.

## Troubleshooting

**Indicator shows "Claude: no data"**
→ `~/.claude_cost` doesn't exist yet. Check the poller is running:
```bash
systemctl --user status claude-monitor
journalctl --user -u claude-monitor --since "5 minutes ago"
```

**Poller fails with "Required cookies not found"**
→ Log in to claude.ai in Firefox at least once; the cookies are then stored on disk and the poller can read them without the browser being open.

**Poller fails with HTTP 403**
→ The `cf_clearance` Cloudflare cookie may have expired. Open claude.ai in Firefox (Cloudflare will silently refresh the cookie), then restart the service:
```bash
systemctl --user restart claude-monitor
```

**Getting "action needed / restored" desktop notifications repeatedly**
→ The poller requires 3 consecutive failures (~3 minutes) before notifying, so transient errors (e.g. the brief 401 that occurs when your session hits 100%) are silently retried and won't trigger a notification.

**GNOME extension in ERROR state**
```bash
journalctl /usr/bin/gnome-shell --since "5 minutes ago" | grep -A5 claude-cost
```

**Claude Code hook not firing**
```bash
cat ~/.claude/settings.json  # verify the Stop hook is present
echo '{"cost_usd":0.01}' | python3 ~/.claude/hooks/write_cost.py
cat ~/.claude_cost
```

## Uninstall

**.deb install:**
```bash
claude-monitor-teardown
sudo dpkg -r claude-monitor
```

**Source install:**
```bash
./uninstall.sh
```

## License

MIT
