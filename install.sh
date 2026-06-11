#!/usr/bin/env bash
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_ID="claude-cost@local"
GNOME_EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$EXT_ID"
HOOK_DIR="$HOME/.claude/hooks"
SETTINGS_FILE="$HOME/.claude/settings.json"

echo "╔══════════════════════════════════════╗"
echo "║     Claude Monitor — Installer       ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── 1. GNOME extension ──────────────────────────────────────────────────────
echo "▶ Installing GNOME Shell extension..."
mkdir -p "$GNOME_EXT_DIR"
cp "$REPO_DIR/gnome-extension/$EXT_ID/metadata.json" "$GNOME_EXT_DIR/"
cp "$REPO_DIR/gnome-extension/$EXT_ID/extension.js"  "$GNOME_EXT_DIR/"
echo "  → $GNOME_EXT_DIR"

# ── 2. Claude Code hook ──────────────────────────────────────────────────────
echo "▶ Installing Claude Code hook..."
mkdir -p "$HOOK_DIR"
cp "$REPO_DIR/native-host/write_cost.py" "$HOOK_DIR/write_cost.py"
chmod +x "$HOOK_DIR/write_cost.py"
echo "  → $HOOK_DIR/write_cost.py"

echo "▶ Patching Claude Code settings.json..."
if [ ! -f "$SETTINGS_FILE" ]; then
    echo '{}' > "$SETTINGS_FILE"
fi

python3 - <<PYEOF
import json, os
path = os.path.expanduser("~/.claude/settings.json")
with open(path) as f:
    cfg = json.load(f)

hook_cmd = f"python3 {os.path.expanduser('~/.claude/hooks/write_cost.py')}"
hooks = cfg.setdefault("hooks", {})
stop_hooks = hooks.setdefault("Stop", [])

for block in stop_hooks:
    for h in block.get("hooks", []):
        if "write_cost.py" in h.get("command", ""):
            print("  Hook already present, skipping.")
            exit(0)

stop_hooks.append({"matcher": "", "hooks": [{"type": "command", "command": hook_cmd}]})
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
print("  → ~/.claude/settings.json updated")
PYEOF

# ── 4. Claude poller (systemd user service) ──────────────────────────────────
echo "▶ Installing Claude poller daemon..."
POLLER_SCRIPT="$HOME/.local/share/claude-monitor/claude_poller.py"
cp "$REPO_DIR/native-host/claude_poller.py" "$POLLER_SCRIPT"
chmod +x "$POLLER_SCRIPT"
echo "  → $POLLER_SCRIPT"

SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
mkdir -p "$SYSTEMD_USER_DIR"
cp "$REPO_DIR/native-host/claude-monitor.service" "$SYSTEMD_USER_DIR/claude-monitor.service"
echo "  → $SYSTEMD_USER_DIR/claude-monitor.service"

systemctl --user daemon-reload
systemctl --user enable --now claude-monitor.service \
    && echo "  → service enabled and started" \
    || echo "  → could not start service; run: systemctl --user enable --now claude-monitor.service"

# ── 5. Enable GNOME extension ────────────────────────────────────────────────
echo "▶ Enabling GNOME extension..."
gnome-extensions enable "$EXT_ID" 2>/dev/null && echo "  → Enabled" || echo "  → Log out and back in, then run: gnome-extensions enable $EXT_ID"

echo ""
echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "  1. The poller daemon is now running — GNOME top bar updates every 60 s"
echo "     Check status: systemctl --user status claude-monitor"
echo "  2. Make sure you are logged in to claude.ai in Firefox at least once"
echo "     (the poller reads session cookies from Firefox's on-disk database)"
echo ""
echo "To uninstall: run uninstall.sh"
