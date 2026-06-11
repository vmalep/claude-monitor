#!/usr/bin/env bash
# Assembles and builds claude-monitor_<VERSION>_all.deb
set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="1.3"
PKG_NAME="claude-monitor_${VERSION}_all"
BUILD_DIR="$(mktemp -d)"
PKG="$BUILD_DIR/$PKG_NAME"

echo "Building $PKG_NAME.deb ..."

# ── Directory tree ────────────────────────────────────────────────────────────
mkdir -p "$PKG/DEBIAN"
mkdir -p "$PKG/usr/bin"
mkdir -p "$PKG/usr/lib/systemd/user"
mkdir -p "$PKG/usr/share/claude-monitor"
mkdir -p "$PKG/usr/share/gnome-shell/extensions/claude-cost@local"

# ── Source files ──────────────────────────────────────────────────────────────
cp "$REPO/native-host/claude_poller.py" "$PKG/usr/share/claude-monitor/"
cp "$REPO/native-host/write_cost.py"    "$PKG/usr/share/claude-monitor/"
chmod 755 "$PKG/usr/share/claude-monitor/claude_poller.py"

cp "$REPO/gnome-extension/claude-cost@local/extension.js" \
   "$PKG/usr/share/gnome-shell/extensions/claude-cost@local/"
cp "$REPO/gnome-extension/claude-cost@local/metadata.json" \
   "$PKG/usr/share/gnome-shell/extensions/claude-cost@local/"

# ── DEBIAN/control ────────────────────────────────────────────────────────────
cat > "$PKG/DEBIAN/control" <<EOF
Package: claude-monitor
Version: $VERSION
Architecture: all
Maintainer: vmalep <vmalep@pm.me>
Depends: python3, libnotify-bin
Description: GNOME top bar Claude usage monitor
 Shows Claude.ai session/weekly usage percentage and Claude Code
 cost in the GNOME top bar. A systemd user service polls claude.ai
 every 60 seconds using session cookies from your browser profile.
 .
 After installing, run: claude-monitor-setup
Homepage: https://github.com/vmalep/claude-monitor
EOF

# ── Systemd user service ──────────────────────────────────────────────────────
cat > "$PKG/usr/lib/systemd/user/claude-monitor.service" <<'EOF'
[Unit]
Description=Claude Monitor poller — writes claude.ai usage to ~/.claude_cost
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/share/claude-monitor/claude_poller.py
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
EOF

# ── claude-monitor-setup ──────────────────────────────────────────────────────
cat > "$PKG/usr/bin/claude-monitor-setup" <<'EOF'
#!/usr/bin/env bash
set -e

echo "Setting up Claude Monitor for $(id -un)..."

# GNOME extension — copy to user dir so gnome-extensions can enable it
mkdir -p "$HOME/.local/share/gnome-shell/extensions"
cp -r /usr/share/gnome-shell/extensions/claude-cost@local \
      "$HOME/.local/share/gnome-shell/extensions/"
gnome-extensions enable claude-cost@local 2>/dev/null \
    && echo "  ✓ GNOME extension enabled" \
    || echo "  → Log out and back in, then run: gnome-extensions enable claude-cost@local"

# Systemd user service
systemctl --user daemon-reload
systemctl --user enable --now claude-monitor.service \
    && echo "  ✓ Poller service started" \
    || echo "  → Run: systemctl --user enable --now claude-monitor.service"

# Claude Code hook
mkdir -p "$HOME/.claude/hooks"
cp /usr/share/claude-monitor/write_cost.py "$HOME/.claude/hooks/write_cost.py"
chmod +x "$HOME/.claude/hooks/write_cost.py"
echo "  ✓ Claude Code hook installed"

[ -f "$HOME/.claude/settings.json" ] || echo '{}' > "$HOME/.claude/settings.json"
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
            print("  ✓ Claude Code hook already registered")
            exit(0)
stop_hooks.append({"matcher": "", "hooks": [{"type": "command", "command": hook_cmd}]})
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
print("  ✓ Claude Code settings.json updated")
PYEOF

echo ""
echo "Done! Make sure you are logged in to claude.ai in Firefox."
EOF
chmod 755 "$PKG/usr/bin/claude-monitor-setup"

# ── claude-monitor-teardown ───────────────────────────────────────────────────
cat > "$PKG/usr/bin/claude-monitor-teardown" <<'EOF'
#!/usr/bin/env bash
systemctl --user disable --now claude-monitor.service 2>/dev/null || true
gnome-extensions disable claude-cost@local 2>/dev/null || true
rm -rf "$HOME/.local/share/gnome-shell/extensions/claude-cost@local"
rm -f  "$HOME/.claude/hooks/write_cost.py"
python3 - <<PYEOF
import json, os
path = os.path.expanduser("~/.claude/settings.json")
if not os.path.exists(path):
    exit(0)
with open(path) as f:
    cfg = json.load(f)
stop = cfg.get("hooks", {}).get("Stop", [])
cfg["hooks"]["Stop"] = [
    b for b in stop
    if not any("write_cost.py" in h.get("command","") for h in b.get("hooks",[]))
]
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
print("Claude Code hook removed from settings.json")
PYEOF
echo "Claude Monitor teardown complete."
EOF
chmod 755 "$PKG/usr/bin/claude-monitor-teardown"

# ── DEBIAN/postinst ───────────────────────────────────────────────────────────
cat > "$PKG/DEBIAN/postinst" <<'EOF'
#!/bin/bash
set -e
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Run this once to complete Claude Monitor setup  ║"
echo "║                                                  ║"
echo "║      claude-monitor-setup                        ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
EOF
chmod 755 "$PKG/DEBIAN/postinst"

# ── DEBIAN/prerm ──────────────────────────────────────────────────────────────
cat > "$PKG/DEBIAN/prerm" <<'EOF'
#!/bin/bash
echo "Run 'claude-monitor-teardown' to remove per-user configuration."
EOF
chmod 755 "$PKG/DEBIAN/prerm"

# ── Build ─────────────────────────────────────────────────────────────────────
dpkg-deb --build --root-owner-group "$PKG" "$REPO/${PKG_NAME}.deb"
rm -rf "$BUILD_DIR"

echo ""
echo "Built: ${PKG_NAME}.deb"
echo "Install with: sudo dpkg -i ${PKG_NAME}.deb"
