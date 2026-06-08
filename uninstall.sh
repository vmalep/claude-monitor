#!/usr/bin/env bash
set -e

EXT_ID="claude-cost@local"

echo "▶ Disabling GNOME extension..."
gnome-extensions disable "$EXT_ID" 2>/dev/null || true
rm -rf "$HOME/.local/share/gnome-shell/extensions/$EXT_ID"

echo "▶ Removing native messaging host..."
rm -f "$HOME/.mozilla/native-messaging-hosts/claude_monitor_host.json"
rm -f "$HOME/.local/share/claude-monitor/claude_monitor_host.py"

echo "▶ Removing Claude Code hook..."
rm -f "$HOME/.claude/hooks/write_cost.py"

echo "▶ Removing hook from settings.json..."
python3 - <<'PYEOF'
import json, os
path = os.path.expanduser("~/.claude/settings.json")
if not os.path.exists(path):
    exit(0)
with open(path) as f:
    cfg = json.load(f)
stop_hooks = cfg.get("hooks", {}).get("Stop", [])
cfg["hooks"]["Stop"] = [
    b for b in stop_hooks
    if not any("write_cost.py" in h.get("command","") for h in b.get("hooks",[]))
]
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
print("  → settings.json cleaned")
PYEOF

echo ""
echo "✅ Uninstalled. Log out and back in to remove the top bar indicator."
