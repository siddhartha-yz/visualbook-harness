"""Freeze public course identity, prefer accessible Chinese subtitles, fetch missing audio.

No cookies, account extraction or model calls. Raw API responses and signed media
URLs stay in ignored work/. Existing successful parts are hash-checked on resume.
"""
import argparse
import concurrent.futures
import hashlib
import json
import math
from pathlib import Path
import re
import threading
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/"}
API = "https://api.bilibili.com"
REQUEST_LOCK = threading.Lock()
LAST_REQUEST = 0.0


def sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def save(path, value):
    pending = path.with_suffix(path.suffix + ".pending")
    pending.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    pending.replace(path)


def request_json(url):
    global LAST_REQUEST
    for attempt in range(3):
        try:
            with REQUEST_LOCK:
                time.sleep(max(0, 0.4 - (time.monotonic() - LAST_REQUEST)))
                LAST_REQUEST = time.monotonic()
            request = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except (OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def checked_subtitle(body, duration):
    rows = body.get("body", []) if isinstance(body, dict) else []
    if not rows:
        raise ValueError("empty-subtitle")
    previous = -1.0
    for row in rows:
        start, end = float(row["from"]), float(row["to"])
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start or start < previous or not str(row.get("content", "")).strip():
            raise ValueError("invalid-subtitle-timeline")
        previous = start
    coverage = max(float(row["to"]) for row in rows) / duration
    if not 0.9 <= coverage <= 1.1:
        raise ValueError("subtitle-duration-mismatch")
    return rows, coverage


def download(stream, target):
    urls = [stream.get("baseUrl") or stream.get("base_url")]
    urls += stream.get("backupUrl") or stream.get("backup_url") or []
    failures = []
    for attempt, url in enumerate(filter(None, urls), 1):
        pending = target.with_name(target.name + f".attempt-{time.time_ns()}-{attempt}.partial")
        try:
            request = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(request, timeout=60) as response, pending.open("xb") as output:
                expected = response.headers.get("Content-Length")
                for block in iter(lambda: response.read(1024 * 1024), b""):
                    output.write(block)
            if not pending.stat().st_size or (expected and pending.stat().st_size != int(expected)):
                raise ValueError("stream-length-mismatch")
            pending.replace(target)
            return {"bytes": target.stat().st_size, "sha256": sha(target), "downloadFailures": failures}
        except (OSError, ValueError) as error:
            failures.append({"attempt": attempt, "type": type(error).__name__})
    raise RuntimeError("No provided media stream completed: " + json.dumps(failures))


def part(out, bvid, page, video=False):
    number = page["page"]
    prefix = f"p{number:03d}"
    result_path = out / "parts" / (prefix + ".json")
    if result_path.exists():
        record = json.loads(result_path.read_text())
        if record.get("cid") != page["cid"] or record.get("bvid") != bvid:
            raise ValueError("Cached part identity changed")
        resource = out / record["path"]
        if sha(resource) != record["sha256"]:
            raise ValueError("Cached part content changed")
        if record.get("video") and sha(out / record["video"]["path"]) != record["video"]["sha256"]:
            raise ValueError("Cached board video content changed")
        if not video or record.get("video"):
            return {"page": number, "status": "reused", "source": record["source"]}
    else:
        record = {"bvid": bvid, "cid": page["cid"], "page": number,
                  "title": page["part"], "expectedDuration": page["duration"]}
        player = request_json(API + "/x/player/v2?" + urllib.parse.urlencode({"bvid": bvid, "cid": page["cid"]}))
        save(out / "raw" / (prefix + "-player.json"), player)
        tracks = player.get("data", {}).get("subtitle", {}).get("subtitles", [])
        candidates = [track for track in tracks if "zh" in track.get("lan", "").lower() and track.get("subtitle_url")]
        candidates.sort(key=lambda track: (track.get("lan", "").startswith("ai-"), track.get("lan", "") != "zh-Hans"))
        record["subtitleAttempts"] = []
        for track in candidates:
            try:
                url = track["subtitle_url"]
                body = request_json("https:" + url if url.startswith("//") else url)
                rows, coverage = checked_subtitle(body, page["duration"])
                target = out / "subtitles" / (prefix + ".json")
                save(target, body)
                record.update(source="platform-subtitle", path=str(target.relative_to(out)),
                              sha256=sha(target), coverage=coverage, subtitleLanguage=track["lan"])
                break
            except (OSError, ValueError, KeyError) as error:
                record["subtitleAttempts"].append({"id": str(track.get("id")), "errorType": type(error).__name__})
        if "source" not in record:
            record["subtitleAvailability"] = "no-accessible-chinese-track" if not candidates else "accessible-tracks-rejected"
            play = request_json(API + "/x/player/playurl?" + urllib.parse.urlencode({"bvid": bvid, "cid": page["cid"], "fnval": 16, "qn": 32, "fourk": 0}))
            save(out / "raw" / (prefix + "-playurl.json"), play)
            media = play.get("data", {})
            duration = media.get("timelength", 0) / 1000
            if not duration or abs(duration - page["duration"]) > max(5, page["duration"] * 0.02):
                raise ValueError("Audio metadata duration does not match requested part")
            audio = media.get("dash", {}).get("audio", [])
            if not audio:
                raise ValueError("No accessible audio stream")
            stream = max(audio, key=lambda item: item["bandwidth"])
            target = out / "media" / (prefix + ".m4a")
            details = download(stream, target)
            record.update(source="audio-for-local-asr", path=str(target.relative_to(out)),
                          **details, streamDuration=duration, bandwidth=stream["bandwidth"])
        save(result_path, record)
    if video and not record.get("video"):
        play = request_json(API + "/x/player/playurl?" + urllib.parse.urlencode({"bvid": bvid, "cid": page["cid"], "fnval": 16, "qn": 32, "fourk": 0}))
        save(out / "raw" / (prefix + "-video-playurl.json"), play)
        choices = [item for item in play.get("data", {}).get("dash", {}).get("video", [])
                   if str(item.get("codecs", "")).startswith("avc1") and item.get("height", 0) <= 480]
        if not choices:
            raise ValueError("No accessible AVC board video")
        stream = max(choices, key=lambda item: item["height"])
        target = out / "media" / (prefix + "-board.mp4")
        record["video"] = {"path": str(target.relative_to(out)), "width": stream["width"],
                           "height": stream["height"], **download(stream, target)}
        save(result_path, record)
    return {"page": number, "status": "completed", "source": record["source"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("output", type=Path)
    parser.add_argument("--max-parts", type=int, default=32)
    parser.add_argument("--workers", type=int, choices=[1, 2, 3, 4], default=2)
    parser.add_argument("--video", action="store_true", help="Also retain accessible <=480p board video")
    args = parser.parse_args()
    match = re.search(r"BV[0-9A-Za-z]{10}", args.url)
    if not match or not 1 <= args.max_parts <= 512:
        parser.error("Need a BV URL and max-parts in 1..512")
    bvid = match.group()
    out = args.output.resolve()
    if not out.is_relative_to((ROOT / "work").resolve()):
        parser.error("Source media and signed URLs must stay in ignored work/")
    for name in ["raw", "parts", "media", "subtitles"]:
        (out / name).mkdir(parents=True, exist_ok=True)
    view = request_json(API + "/x/web-interface/view?bvid=" + bvid)
    if view.get("code") != 0:
        raise SystemExit("Public metadata unavailable")
    save(out / "raw" / "view.json", view)
    data = view["data"]
    pages = data["pages"]
    if len(pages) > args.max_parts:
        raise SystemExit("Course exceeds explicit part budget; no audio downloaded")
    identity = {"bvid": bvid, "title": data["title"], "sourceUrl": f"https://www.bilibili.com/video/{bvid}/",
                "pages": [{key: page[key] for key in ["page", "cid", "part", "duration"]} for page in pages]}
    identity_path = out / "course.json"
    if identity_path.exists() and json.loads(identity_path.read_text()) != identity:
        raise SystemExit("Course identity changed; use a new output directory")
    save(identity_path, identity)
    failures = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        tasks = {pool.submit(part, out, bvid, page, args.video): page for page in pages}
        for future in concurrent.futures.as_completed(tasks):
            page = tasks[future]
            try:
                print(json.dumps(future.result()), flush=True)
            except Exception as error:
                row = {"page": page["page"], "status": "failed", "errorType": type(error).__name__}
                failures.append(row)
                print(json.dumps(row), flush=True)
    save(out / ("fetch-attempt-" + str(time.time_ns()) + ".json"), {"parts": len(pages), "failures": failures})
    if failures:
        raise SystemExit("Some parts failed; successful parts retained for hash-checked resume")


if __name__ == "__main__":
    main()
