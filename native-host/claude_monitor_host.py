#!/usr/bin/env python3
"""
Native Messaging Host for Claude Monitor.
Firefox cannot write to the filesystem directly; this script acts as a bridge.
It receives JSON messages from the Firefox extension and writes ~/.claude_cost.

Protocol: each message is a 4-byte little-endian length prefix + UTF-8 JSON body.
"""

import sys
import json
import struct
import os
from datetime import datetime, timezone

COST_FILE = os.path.expanduser("~/.claude_cost")


def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) == 0:
        return None
    length = struct.unpack("<I", raw_length)[0]
    message = sys.stdin.buffer.read(length).decode("utf-8")
    return json.loads(message)


def send_message(data):
    encoded = json.dumps(data).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def load_existing():
    if os.path.exists(COST_FILE):
        try:
            with open(COST_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def main():
    msg = read_message()
    if not msg:
        return

    existing = load_existing()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    # Merge web usage data with any existing Claude Code data
    out = {
        # claude.ai fields (from Firefox extension)
        "session_pct":   msg.get("session_pct"),
        "session_reset": msg.get("session_reset"),
        "weekly_pct":    msg.get("weekly_pct"),
        "weekly_reset":  msg.get("weekly_reset"),
        # Claude Code fields (preserved from previous writes)
        "code_cost":     existing.get("code_cost"),
        "input_tokens":  existing.get("input_tokens"),
        "output_tokens": existing.get("output_tokens"),
        "last_updated":  now,
    }

    with open(COST_FILE, "w") as f:
        json.dump(out, f, indent=2)

    send_message({"status": "ok"})


if __name__ == "__main__":
    main()
