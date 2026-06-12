#!/usr/bin/env python3
"""
Claude Monitor poller daemon — polls claude.ai usage API every 60 s
and writes session_pct/weekly_pct to ~/.claude_cost so the GNOME
extension works without Firefox open.

Auth: reads sessionKey + cf_clearance from the Firefox cookie database.
The cookies persist on disk; Firefox does not need to be running.
"""

import glob
import json
import logging
import os
import shutil
import sqlite3
import subprocess
import tempfile
import time
import urllib.error as urlerror
import urllib.request as urlrequest
from datetime import datetime, timezone

COST_FILE    = os.path.expanduser("~/.claude_cost")
POLL_SECONDS = 60
API_BASE     = "https://claude.ai/api"

# Require this many consecutive failures before sending a notification,
# to avoid spurious "disconnected / restored" pairs from transient errors.
NOTIFY_FAIL_THRESHOLD = 3

# Cookie names required from the Firefox profile
REQUIRED_COOKIES = {"sessionKey", "cf_clearance"}
USEFUL_COOKIES   = REQUIRED_COOKIES | {"__ssid", "activitySessionId"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s claude-poller %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)


def _firefox_profiles():
    patterns = [
        "~/.mozilla/firefox/*/cookies.sqlite",
        "~/snap/firefox/common/.mozilla/firefox/*/cookies.sqlite",
    ]
    found = []
    for pat in patterns:
        found.extend(glob.glob(os.path.expanduser(pat)))
    return found


def load_cookies():
    """Return a dict of cookie name→value for claude.ai from Firefox."""
    now_epoch = int(time.time())
    best = {}  # name → (value, expiry)

    for cookies_file in _firefox_profiles():
        tmp = tempfile.mktemp(suffix=".sqlite")
        try:
            shutil.copy2(cookies_file, tmp)
            for suf in ("-wal", "-shm"):
                src = cookies_file + suf
                if os.path.exists(src):
                    shutil.copy2(src, tmp + suf)

            conn = sqlite3.connect(f"file:{tmp}?immutable=1", uri=True)
            rows = conn.execute(
                "SELECT name, value, expiry FROM moz_cookies "
                "WHERE (host = 'claude.ai' OR host = '.claude.ai') "
                "  AND expiry > ?",
                (now_epoch,),
            ).fetchall()
            conn.close()

            for name, value, expiry in rows:
                if name not in USEFUL_COOKIES:
                    continue
                prev_expiry = best.get(name, (None, 0))[1]
                if expiry > prev_expiry:
                    best[name] = (value, expiry)
        except Exception as e:
            log.debug("could not read %s: %s", cookies_file, e)
        finally:
            for p in (tmp, tmp + "-wal", tmp + "-shm"):
                try:
                    os.unlink(p)
                except OSError:
                    pass

    cookies = {name: val for name, (val, _) in best.items()}
    missing = REQUIRED_COOKIES - cookies.keys()
    if missing:
        raise RuntimeError(
            f"Required cookies not found: {missing}. "
            "Make sure you are logged in to claude.ai in Firefox."
        )
    return cookies


def api_get(path, cookies):
    cookie_header = "; ".join(f"{k}={v}" for k, v in cookies.items())
    req = urlrequest.Request(
        f"{API_BASE}{path}",
        headers={
            "Cookie": cookie_header,
            "Accept": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64; rv:138.0) "
                "Gecko/20100101 Firefox/138.0"
            ),
            "Referer": "https://claude.ai/",
        },
    )
    with urlrequest.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def fmt_reset(iso_str):
    if not iso_str:
        return None
    d = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    diff_min = round((d - now).total_seconds() / 60)
    if diff_min < 60:
        return f"in {diff_min} min"
    if diff_min < 1440:
        return f"in {round(diff_min / 60)}h"
    return d.astimezone().strftime("%a %-I:%M %p")


def notify(summary, body):
    """Send a desktop notification, best-effort."""
    try:
        subprocess.run(
            ["notify-send", "--icon=dialog-warning", "--app-name=Claude Monitor",
             summary, body],
            timeout=5,
        )
    except Exception:
        pass


def fetch_and_write():
    cookies = load_cookies()

    orgs = api_get("/organizations", cookies)
    org_id = orgs[0]["uuid"]

    data = api_get(f"/organizations/{org_id}/usage", cookies)

    payload = {
        "session_pct":      data.get("five_hour", {}).get("utilization"),
        "session_reset":    fmt_reset(data.get("five_hour", {}).get("resets_at")),
        "session_reset_at": data.get("five_hour", {}).get("resets_at"),
        "weekly_pct":       data.get("seven_day", {}).get("utilization"),
        "weekly_reset":     fmt_reset(data.get("seven_day", {}).get("resets_at")),
    }

    existing = {}
    if os.path.exists(COST_FILE):
        try:
            with open(COST_FILE) as f:
                existing = json.load(f)
        except Exception:
            pass

    out = {
        **payload,
        "code_cost":     existing.get("code_cost"),
        "input_tokens":  existing.get("input_tokens"),
        "output_tokens": existing.get("output_tokens"),
        "last_updated":  datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }

    with open(COST_FILE, "w") as f:
        json.dump(out, f, indent=2)

    log.info("session=%s%% weekly=%s%%", payload["session_pct"], payload["weekly_pct"])


def main():
    log.info("starting (polling every %ds)", POLL_SECONDS)
    auth_ok = True   # assume OK at start; avoids spurious notification on first failure
    consec_fails = 0
    while True:
        try:
            fetch_and_write()
            if not auth_ok:
                log.info("authentication restored")
                notify("Claude Monitor restored", "Usage data is updating again.")
            auth_ok = True
            consec_fails = 0
        except RuntimeError as e:
            log.error("%s", e)
            consec_fails += 1
            if auth_ok and consec_fails >= NOTIFY_FAIL_THRESHOLD:
                notify("Claude Monitor: action needed",
                       "Log in to claude.ai in Firefox to restore usage tracking.")
                auth_ok = False
        except urlerror.HTTPError as e:
            log.warning("HTTP %s from claude.ai", e.code)
            consec_fails += 1
            if e.code in (401, 403) and auth_ok and consec_fails >= NOTIFY_FAIL_THRESHOLD:
                notify("Claude Monitor: action needed",
                       "Session expired — open claude.ai in Firefox to restore usage tracking.")
                auth_ok = False
        except Exception as e:
            log.warning("poll failed: %s", e)
            consec_fails += 1
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
