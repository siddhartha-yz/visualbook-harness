"""Freeze complete Markdown sections from configurable strata before authoring.

No model or network calls. Original files stay untouched. Fenced code headings
are not treated as section boundaries. All input hashes and eligible pools are
recorded; existing outputs cannot be overwritten or redrawn after a failure.
"""
import argparse
import hashlib
import json
import random
import re
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def sections(raw, level):
    lines = raw.splitlines(keepends=True)
    headings, fence = [], None
    for i, line in enumerate(lines):
        match = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if match:
            token = match[1]
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            continue
        if fence:
            continue
        match = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", line)
        if match:
            headings.append((i, len(match[1]), match[2]))
    result = []
    for j, (start, depth, title) in enumerate(headings):
        if depth != level:
            continue
        end = next((h[0] for h in headings[j + 1:] if h[1] <= depth), len(lines))
        text = "".join(lines[start:end])
        result.append(dict(title=title, startLine=start + 1, endLine=end,
                           text=text, characters=len(text), sha256=sha(text.encode())))
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input", type=Path)
    p.add_argument("strata", type=Path)
    p.add_argument("output", type=Path)
    p.add_argument("--seed", type=int, required=True)
    args = p.parse_args()
    if args.output.exists():
        raise SystemExit("Selection exists; preserve it instead of redrawing")
    config = json.loads(args.strata.read_text())
    files = sorted(args.input.glob(config.get("glob", "*.md")))
    if not files:
        raise SystemExit("No Markdown inputs")
    sources, pool = [], []
    for f in files:
        data = f.read_bytes()
        source = dict(file=f.name, sha256=sha(data), bytes=len(data))
        sources.append(source)
        for s in sections(data.decode("utf-8"), config.get("level", 3)):
            pool.append({**s, "file": f.name, "fileSha256": source["sha256"]})
    rng, used, selected = random.Random(args.seed), set(), []
    for group in config["strata"]:
        candidates = [s for s in pool
                      if re.search(group.get("file", ".*"), s["file"])
                      and re.search(group["heading"], s["title"])
                      and config.get("minCharacters", 1000) <= s["characters"] <= config.get("maxCharacters", 16000)
                      and s["sha256"] not in used]
        if not candidates:
            raise SystemExit("Empty eligible pool: " + group["id"])
        chosen = rng.choice(candidates)
        used.add(chosen["sha256"])
        selected.append({"id": group["id"], "pool": [{k:v for k,v in s.items() if k != "text"} for s in candidates], "selected": chosen})
    args.output.mkdir(parents=True)
    records, chapters = [], []
    for record in selected:
        chosen = record["selected"]
        dest = args.output / (record["id"] + ".md")
        dest.write_bytes(chosen["text"].encode())
        records.append({**record, "selected": {k:v for k,v in chosen.items() if k != "text"}})
        chapters.append({"id": record["id"], "source": str(dest.resolve())})
    frozen = dict(seed=str(args.seed), algorithm="random.Random(seed).choice in fixed stratum order; complete level-matched sections; no reselection", sources=sources, strataSha256=sha(args.strata.read_bytes()), sections=records, limits="Small stratified exploratory sample, not a population success rate or full-book coverage")
    (args.output / "selection.json").write_text(json.dumps(frozen, ensure_ascii=False, indent=2) + "\n")
    manifest = {"title": config.get("title", "教材选章"), "description": config.get("description"), "chapters": chapters}
    (args.output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "selected": [{"id":r["id"],"title":r["selected"]["title"]} for r in records]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
