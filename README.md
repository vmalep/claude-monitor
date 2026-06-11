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

The top bar label shows the **session % in colour** (blue → yellow → red as you approach the limit), or the Claude Code cost if no web data is available.

## Components

```
claude-monitor/
├── gnome-extension/        GNOME Shell extension (top bar indicator)
├── native-host/
│   ├── claude_poller.py         Poller daemon (reads claude.ai usage every 60 s)
│   ├── claude-monitor.service   systemd user service for the poller
│   └── write_cost.py            Claude Code Stop hook
├── install.sh
└── uninstall.sh
```

## Requirements

- Ubuntu with GNOME Shell 45–50
- Python 3
- Firefox with an active claude.ai session (cookies are read from disk — Firefox need not be open)

## Installation

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

`install.sh` installs `claude_poller.py` as a systemd user service that starts on login and polls `claude.ai` every 60 seconds. It authenticates using the `sessionKey` and `cf_clearance` cookies stored in your Firefox profile on disk — **Firefox does not need to be running**, just previously logged in to claude.ai.

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
  "session_pct":   16,
  "session_reset": "in 50 min",
  "weekly_pct":    21,
  "weekly_reset":  "Sat 3:59 AM",
  "code_cost":     0.0123,
  "input_tokens":  5000,
  "output_tokens": 1200,
  "last_updated":  "2026-06-08T20:30:00+00:00"
}
```

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

```bash
./uninstall.sh
```

## License

MIT

