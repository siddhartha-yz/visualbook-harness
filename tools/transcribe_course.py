"""Turn frozen course audio/subtitles into traceable timed transcripts.

Local ASR is an explicit adapter, not native multimodal listening or a verbatim
accuracy guarantee. Decode duration, input hash and uncertain spans are retained.
Install the pinned runtime separately; this tool never downloads model weights.
"""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def save(path, value):
    temp = path.with_suffix(path.suffix + ".pending")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temp.replace(path)


def stamp(seconds):
    total = int(seconds)
    return f"{total // 60:02d}:{total % 60:02d}"


def uncertainty(segment):
    reasons = []
    if segment.get("avg_logprob", 0) < -0.6:
        reasons.append("low-segment-likelihood")
    if segment.get("no_speech_prob", 0) > 0.5:
        reasons.append("possible-silence-hallucination")
    if "\ufffd" in segment["text"]:
        reasons.append("replacement-character")
    words = segment.get("words", [])
    if words and sum(word["probability"] < 0.45 for word in words) / len(words) > 0.15:
        reasons.append("many-low-confidence-words")
    return reasons


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("course", type=Path, help="Directory produced by fetch_bilibili_course")
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--model-pin", type=Path, required=True)
    parser.add_argument("--batch-size", type=int, choices=[1, 2, 4, 8, 16], default=8)
    parser.add_argument("--wait-minutes", type=int, default=20)
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--end", type=int)
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    parser.add_argument("--compute-type", choices=["float16", "int8_float16", "int8", "float32"], default="float16")
    args = parser.parse_args()
    course, output = args.course.resolve(), args.output.resolve()
    if not output.is_relative_to((ROOT / "work").resolve()):
        parser.error("Transcripts must stay in ignored work/")
    identity = json.loads((course / "course.json").read_text())
    pages = identity["pages"]
    end = args.end or len(pages)
    if not 1 <= args.start <= end <= len(pages) or not 0 <= args.wait_minutes <= 120:
        parser.error("Invalid part range/wait budget")
    pin = json.loads(args.model_pin.read_text())
    model_path = args.model.resolve()
    if not (model_path / "model.bin").is_file() or not pin.get("revision"):
        parser.error("Existing fixed model weights and revision are required")
    output.mkdir(parents=True, exist_ok=True)
    settings = {"courseSha256": sha(course / "course.json"), "model": pin,
                "weights": {p.name: sha(p) for p in model_path.glob("*") if p.is_file()},
                "batchSize": args.batch_size, "device": args.device, "computeType": args.compute_type,
                "packages": {name: importlib.metadata.version(name) for name in ["faster-whisper", "ctranslate2", "av", "onnxruntime", "numpy"]},
                "beamSize": 5, "language": "zh", "wordTimestamps": True, "vadFilter": True}
    setting_path = output / "settings.json"
    if setting_path.exists() and json.loads(setting_path.read_text()) != settings:
        raise SystemExit("ASR settings changed; use a new transcript output")
    save(setting_path, settings)
    model, pipeline = None, None
    failed = []
    for page in pages[args.start - 1:end]:
        number, cid = page["page"], page["cid"]
        prefix = f"p{number:03d}"
        target = output / (prefix + ".json")
        try:
            ready = course / "parts" / (prefix + ".json")
            deadline = time.monotonic() + args.wait_minutes * 60
            while not ready.exists() and time.monotonic() < deadline:
                time.sleep(1)
            if not ready.exists():
                raise ValueError("Source part was not ready within wait budget")
            source = json.loads(ready.read_text())
            if source["cid"] != cid or source["page"] != number or source["bvid"] != identity["bvid"]:
                raise ValueError("Input part identity mismatch")
            resource = course / source["path"]
            if sha(resource) != source["sha256"]:
                raise ValueError("Source bytes changed before ASR")
            if target.exists():
                prior = json.loads(target.read_text())
                if prior["inputSha256"] != source["sha256"] or prior["settingsSha256"] != sha(setting_path):
                    raise ValueError("Existing transcript belongs to another input/settings")
                print(json.dumps({"part": number, "status": "reused"}), flush=True)
                continue
            started = time.monotonic()
            if source["source"] == "platform-subtitle":
                body = json.loads(resource.read_text())["body"]
                rows = [{"id": i, "start": row["from"], "end": row["to"], "text": row["content"]} for i, row in enumerate(body)]
                duration = source["expectedDuration"]
                speech_duration = None
            else:
                if model is None:
                    from faster_whisper import WhisperModel, BatchedInferencePipeline
                    model = WhisperModel(str(model_path), device=args.device, compute_type=args.compute_type, cpu_threads=4, num_workers=1)
                    pipeline = BatchedInferencePipeline(model=model)
                segments, info = pipeline.transcribe(str(resource), language="zh", batch_size=args.batch_size, beam_size=5,
                    vad_filter=True, word_timestamps=True,
                    initial_prompt="丘维声，清华大学，高等代数，未知量，线性方程组，矩阵，行列式，线性空间，数域，线性相关，线性无关，极大线性无关组，齐次方程组，克莱姆法则，初等行变换，代数余子式，多项式，辗转相除，商空间，线性映射，特征值，特征向量，最小多项式，约当标准形，对偶基，双线性函数，施密特正交化，酉空间，二次型。")
                duration, speech_duration = info.duration, info.duration_after_vad
                if abs(duration - page["duration"]) > max(5, page["duration"] * 0.02):
                    raise ValueError("Decoded audio duration differs from frozen course metadata")
                rows = [{"id": s.id, "start": s.start, "end": s.end, "text": s.text,
                         "avg_logprob": s.avg_logprob, "no_speech_prob": s.no_speech_prob,
                         "compression_ratio": s.compression_ratio,
                         "words": [{"start": w.start, "end": w.end, "word": w.word, "probability": w.probability} for w in (s.words or [])]}
                        for s in segments]
            if not rows or any(row["start"] < 0 or row["end"] > duration + 2 for row in rows):
                raise ValueError("Empty/out-of-bounds transcript")
            uncertain = []
            for i, row in enumerate(rows):
                row["anchor"] = f"{prefix}-s{i:03d}"
                reasons = uncertainty(row)
                if reasons:
                    uncertain.append({"anchor": row["anchor"], "start": row["start"], "end": row["end"], "reasons": reasons})
            record = {"bvid": identity["bvid"], "cid": cid, "page": number, "title": page["part"],
                      "source": "platform-subtitle" if source["source"] == "platform-subtitle" else "local-asr",
                      "inputSha256": source["sha256"], "settingsSha256": sha(setting_path),
                      "duration": duration, "expectedDuration": page["duration"], "speechDuration": speech_duration,
                      "elapsedSeconds": time.monotonic() - started, "segments": rows, "uncertain": uncertain,
                      "scope": "Timed source transcript; confidence is not word-error accuracy or proof validation. No silent correction of original ASR."}
            save(target, record)
            text = [f"# {page['part']}", "", f"来源：{record['source']}；原始识别未人工改写，数学符号需结合板书核对。", ""]
            text += [f"[{row['anchor']} {stamp(row['start'])}–{stamp(row['end'])}] {row['text']}" for row in rows]
            (output / (prefix + ".md")).write_text("\n\n".join(text) + "\n")
            print(json.dumps({"part": number, "status": "completed", "duration": duration,
                              "seconds": round(record["elapsedSeconds"], 2), "segments": len(rows), "uncertain": len(uncertain)}), flush=True)
        except Exception as error:
            row = {"part": number, "status": "failed", "errorType": type(error).__name__, "message": str(error)}
            failed.append(row)
            save(output / f"{prefix}-failure-{time.time_ns()}.json", row)
            print(json.dumps({k: row[k] for k in ["part", "status", "errorType"]}), flush=True)
            if len(failed) >= 3:
                break
    save(output / f"attempt-{time.time_ns()}.json", {"start": args.start, "end": end, "failures": failed})
    if failed:
        raise SystemExit("ASR failures retained; diagnose before retry")


if __name__ == "__main__":
    main()
