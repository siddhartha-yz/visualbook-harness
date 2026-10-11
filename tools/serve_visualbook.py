"""Manage a loopback-only reader independently of the calling terminal.

Linux user systemd is required. This transient service survives CLI sessions,
not necessarily logout or reboot. It serves existing files, without generation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
UNIT = "visualbook-reader.service"
DESCRIPTION = "VisualBook local reader"


def run(*args, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True)


def properties():
    result = run("systemctl", "--user", "show", UNIT,
                 "--property=LoadState,ActiveState,SubState,Description,MainPID,Restart,WorkingDirectory",
                 check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "Cannot contact user systemd")
    return dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)


def check_owner(state):
    if state.get("LoadState") != "not-found" and state.get("Description") != DESCRIPTION:
        raise RuntimeError(f"{UNIT} belongs to another service; left untouched")


def health(directory, port):
    local = (directory / "index.html").read_bytes()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(f"http://127.0.0.1:{port}/index.html", timeout=2) as response:
        body = response.read()
        if response.status != 200 or hashlib.sha256(body).digest() != hashlib.sha256(local).digest():
            raise RuntimeError("HTTP content does not match this reader directory")
    return {"http": 200, "indexSha256": hashlib.sha256(body).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "status", "stop"])
    parser.add_argument("--directory", type=Path, default=ROOT / "outputs/visualbook")
    parser.add_argument("--port", type=int, default=8768)
    args = parser.parse_args()
    directory = args.directory.resolve()
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    if not shutil.which("systemctl") or not shutil.which("systemd-run"):
        parser.error("Linux user systemd is required for session-independent serving")
    try:
        state = properties()
        check_owner(state)
        if args.action == "stop":
            if state.get("LoadState") != "not-found":
                run("systemctl", "--user", "stop", UNIT)
            print(json.dumps({"unit": UNIT, "stopped": True}))
            return
        if args.action == "start" and state.get("ActiveState") != "active":
            if not (directory / "index.html").is_file():
                raise RuntimeError(f"Missing reader: {directory / 'index.html'}")
            python = shutil.which("python3")
            if not python:
                raise RuntimeError("python3 is required")
            run("systemd-run", "--user", "--unit=" + UNIT, "--collect",
                "--description=" + DESCRIPTION, "--property=Restart=on-failure",
                "--property=RestartSec=2", "--working-directory=" + str(directory),
                python, "-m", "http.server", str(args.port), "--bind", "127.0.0.1",
                "--directory", str(directory))
            # A bounded readiness check; never infer readiness from launch exit 0.
            ready = False
            for attempt in range(20):
                state = properties()
                try:
                    health(directory, args.port)
                    if state.get("ActiveState") == "active":
                        ready = True
                        break
                except (OSError, RuntimeError):
                    pass
                time.sleep(0.1)
            if not ready:
                run("systemctl", "--user", "stop", UNIT, check=False)
                raise RuntimeError("Reader did not become healthy; stopped the new service. "
                                   "Check the directory and whether the port is occupied")
        state = properties()
        check_owner(state)
        if state.get("ActiveState") != "active":
            print(json.dumps({"unit": UNIT, "state": state}))
            raise RuntimeError("Reader is not running; use start or inspect journalctl --user -u " + UNIT)
        if state.get("WorkingDirectory") != str(directory):
            raise RuntimeError("Reader uses another directory; stop it before changing configuration")
        print(json.dumps({"unit": UNIT, "url": f"http://127.0.0.1:{args.port}/",
                          "state": state, "health": health(directory, args.port)}, ensure_ascii=False))
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        parser.exit(1, str(error) + "\n")


if __name__ == "__main__":
    main()
