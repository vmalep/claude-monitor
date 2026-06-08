#!/usr/bin/env python3
"""
Claude Code Stop hook — appends session cost to ~/.claude_cost.
Preserves any claude.ai usage data already in the file.

Install: see README.md
"""

import json
import sys
import os
from datetime import datetime, timezone

COST_FILE = os.path.expanduser("~/.claude_cost")


def main():
    raw = sys.stdin.read().strip()
    if not raw:
        return

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return

    cost_usd   = data.get("cost_usd") or data.get("total_cost") or 0.0
    input_tok  = data.get("input_tokens") or data.get("usage", {}).get("input_tokens") or 0
    output_tok = data.get("output_tokens") or data.get("usage", {}).get("output_tokens") or 0

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    existing = {}
    if os.path.exists(COST_FILE):
        try:
            with open(COST_FILE) as f:
                existing = json.load(f)
        except Exception:
            existing = {}

    out = {
        # Preserve claude.ai fields
        "session_pct":   existing.get("session_pct"),
        "session_reset": existing.get("session_reset"),
        "weekly_pct":    existing.get("weekly_pct"),
        "weekly_reset":  existing.get("weekly_reset"),
        # Accumulate Claude Code fields
        "code_cost":     round(existing.get("code_cost", 0.0) + cost_usd, 6),
        "input_tokens":  existing.get("input_tokens", 0) + input_tok,
        "output_tokens": existing.get("output_tokens", 0) + output_tok,
        "last_updated":  now,
    }

    with open(COST_FILE, "w") as f:
        json.dump(out, f, indent=2)


if __name__ == "__main__":
    main()
