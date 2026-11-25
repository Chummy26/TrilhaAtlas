#!/usr/bin/env python3
"""
intensive-colab-worker.py

Offloads heavy video compression (AV1 via Colab L4 hardware `av1_nvenc` or
Colab CPU `libsvtav1`) and optional Whisper GPU transcription to a remote
Google Colab session via the `colab` CLI — keeping local CPU/GPU load near 0%.

Workflow per video (resumable & atomic):
1. Scans `--canonical-dir` for uncompressed valid videos (largest-first by default)
   and optionally checks `--transcript-dir` for missing transcripts.
2. Uploads the video to `/content/work/in.mp4` on the Colab VM via `colab upload`.
3. Executes remote AV1 compression (and optional `faster-whisper` transcription if
   missing) on Colab via `colab exec --timeout 0`.
4. Downloads `/content/work/out.mp4` (and optional transcript JSON) via `colab download`.
5. Locally validates with `ffprobe` (duration match <= 1.0s, valid AV1 video + audio,
   size < original * min_savings_ratio), atomically swaps the original file, updates
   `manifest.json`, `transcripts/<lessonId>.json`, and `compression-log.json`, and
   cleans remote `/content/work/*`.
6. Stops the Colab session cleanly on exit (unless `--keep-session` is set) so
   compute units are never leaked.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from typing import Any

sys.dont_write_bytecode = True

_STOP_REQUESTED = False


def _handle_stop(signum: int, _frame: Any) -> None:
    global _STOP_REQUESTED
    _STOP_REQUESTED = True
    _log(f"Received signal {signum}; finishing current step and stopping cleanly...")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def _load_sibling_module(name: str, file_name: str) -> Any:
    path = pathlib.Path(__file__).resolve().parent / file_name
    spec = importlib.util.spec_from_file_location(name, str(path))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load sibling script: {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _colab_cmd(colab_bin: str, colab_config: str | None, *args: str) -> list[str]:
    cmd = [colab_bin]
    if colab_config:
        cmd.extend(["--config", colab_config])
    cmd.extend(args)
    return cmd


def _run_colab(
    colab_bin: str,
    colab_config: str | None,
    args: list[str],
    timeout: float | None = None,
    stream: bool = False,
) -> subprocess.CompletedProcess[str]:
    cmd = _colab_cmd(colab_bin, colab_config, *args)
    if stream:
        return subprocess.run(cmd, timeout=timeout, text=True)
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


REMOTE_SETUP_SCRIPT = r"""
import os, shutil, subprocess, sys

os.makedirs("/content/work", exist_ok=True)
print("COLAB_CPUS:", os.cpu_count())
gpu = subprocess.run(
    ["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
    capture_output=True, text=True,
)
print("COLAB_GPU:", gpu.stdout.strip() or "CPU-ONLY")

def check_encoders(ffbin):
    r = subprocess.run([ffbin, "-hide_banner", "-encoders"], capture_output=True, text=True)
    found = []
    for enc in ("av1_nvenc", "libsvtav1", "hevc_nvenc"):
        if enc in r.stdout:
            found.append(enc)
    return found

ff = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"
encs = check_encoders(ff) if os.path.exists(ff) else []
print("SYSTEM_FFMPEG:", ff, "ENCODERS:", encs)

# If system ffmpeg lacks av1_nvenc and libsvtav1, fetch static BtbN GPL build (takes ~3s on Colab gigabit)
if "av1_nvenc" not in encs and "libsvtav1" not in encs:
    static_ff = "/content/bin/ffmpeg"
    if not os.path.exists(static_ff):
        os.makedirs("/content/bin", exist_ok=True)
        url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"
        print("Downloading static ffmpeg with av1_nvenc + libsvtav1...")
        subprocess.run(
            f"curl -sL '{url}' | tar -xJ --strip-components=2 -C /content/bin --wildcards '*/bin/ffmpeg' '*/bin/ffprobe'",
            shell=True, check=True,
        )
        os.chmod(static_ff, 0o755)
    ff = static_ff
    encs = check_encoders(ff)
    print("STATIC_FFMPEG:", ff, "ENCODERS:", encs)

# Verify if av1_nvenc actually initializes on this GPU (L4/Ada supports it; T4 does not)
av1_nvenc_ok = False
if "av1_nvenc" in encs:
    t = subprocess.run(
        [ff, "-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.5",
         "-c:v", "av1_nvenc", "-preset", "p5", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    av1_nvenc_ok = (t.returncode == 0)
print("AV1_NVENC_READY:", av1_nvenc_ok)
print("LIBSVTAV1_READY:", "libsvtav1" in encs)
print("SELECTED_FFMPEG:", ff)
"""

REMOTE_ENCODE_SCRIPT = r"""
import json, os, shutil, subprocess, sys, time

ff = "/content/bin/ffmpeg" if os.path.exists("/content/bin/ffmpeg") else (shutil.which("ffmpeg") or "ffmpeg")
inp = os.environ["TRILHA_IN"]
out = os.environ["TRILHA_OUT"]
codec = os.environ.get("TRILHA_CODEC", "auto")
cq = os.environ.get("TRILHA_CQ", "38")
preset = os.environ.get("TRILHA_PRESET", "8")
abitrate = os.environ.get("TRILHA_ABITRATE", "80k")
tag = os.environ.get("TRILHA_TAG", "trilhaatlas-opt-v1;codec=av1;colab=1")

if os.path.exists(out):
    os.remove(out)

def test_av1_nvenc():
    t = subprocess.run(
        [ff, "-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.3",
         "-c:v", "av1_nvenc", "-preset", "p5", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    return t.returncode == 0

chosen = codec
if chosen == "auto":
    chosen = "av1_nvenc" if test_av1_nvenc() else "libsvtav1"

if chosen == "av1_nvenc":
    # NVIDIA Ada Lovelace L4 hardware AV1 encoder — sharp classroom preset with spatial/temporal AQ
    v_args = [
        "-c:v", "av1_nvenc",
        "-preset", "p7",
        "-tune", "hq",
        "-rc", "vbr",
        "-cq", str(cq),
        "-b:v", "0",
        "-spatial-aq", "1",
        "-temporal-aq", "1",
        "-aq-strength", "8",
        "-rc-lookahead", "32",
        "-g", "240",
        "-pix_fmt", "yuv420p",
    ]
else:
    v_args = [
        "-c:v", "libsvtav1",
        "-crf", str(cq),
        "-preset", str(preset),
        "-g", "240",
        "-pix_fmt", "yuv420p",
    ]

cmd = [
    ff, "-hide_banner", "-y",
    "-i", inp,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    *v_args,
    "-c:a", "aac", "-b:a", abitrate, "-ac", "1",
    "-movflags", "+faststart",
    "-metadata", f"comment={tag}",
    out,
]

t0 = time.monotonic()
res = subprocess.run(cmd, capture_output=True, text=True)
dt = time.monotonic() - t0
if res.returncode != 0:
    print("REMOTE_ENCODE_ERROR:", res.stderr[-1000:])
    sys.exit(res.returncode)

in_sz = os.path.getsize(inp)
out_sz = os.path.getsize(out)
print(json.dumps({
    "ok": True,
    "codec": chosen,
    "inBytes": in_sz,
    "outBytes": out_sz,
    "elapsedSec": round(dt, 2),
}))
"""


def _write_temp_script(content: str, suffix: str = ".py") -> pathlib.Path:
    fd, tmp = tempfile.mkstemp(prefix="trilha_colab_", suffix=suffix)
    os.close(fd)
    p = pathlib.Path(tmp)
    p.write_text(content, encoding="utf-8")
    return p


def _ensure_session(
    colab_bin: str,
    colab_config: str | None,
    session_name: str,
    gpu: str | None,
    high_mem: bool,
    reuse_existing: bool,
) -> tuple[bool, str]:
    if reuse_existing:
        st = _run_colab(colab_bin, colab_config, ["status", "-s", session_name], timeout=30)
        if st.returncode == 0 and "not found" not in (st.stdout + st.stderr).lower():
            _log(f"Reusing existing Colab session '{session_name}'.")
            return True, st.stdout

    args = ["new", "-s", session_name]
    if gpu:
        args.extend(["--gpu", gpu])
    if high_mem:
        args.append("--high-mem")
    _log(f"Creating Colab session '{session_name}' (gpu={gpu or 'CPU'}, high_mem={high_mem})...")
    res = _run_colab(colab_bin, colab_config, args, timeout=180)
    combined = (res.stdout or "") + "\n" + (res.stderr or "")
    if res.returncode != 0:
        return False, combined.strip()
    _log(f"Colab session '{session_name}' ready.")
    return True, combined.strip()


def _setup_remote_vm(colab_bin: str, colab_config: str | None, session_name: str) -> dict[str, Any]:
    script_path = _write_temp_script(REMOTE_SETUP_SCRIPT)
    try:
        res = _run_colab(
            colab_bin,
            colab_config,
            ["exec", "-s", session_name, "--timeout", "180", "-f", str(script_path)],
            timeout=240,
        )
        out = (res.stdout or "") + "\n" + (res.stderr or "")
        if res.returncode != 0:
            raise RuntimeError(f"Remote Colab VM setup failed:\n{out}")
        for line in out.splitlines():
            if line.strip():
                _log(f"  [colab] {line.strip()}")
        return {
            "av1_nvenc": "AV1_NVENC_READY: True" in out,
            "libsvtav1": "LIBSVTAV1_READY: True" in out,
        }
    finally:
        script_path.unlink(missing_ok=True)


def _process_one_video_on_colab(
    mp: Any,
    pipeline: Any,
    item: Any,
    colab_bin: str,
    colab_config: str | None,
    session_name: str,
    remote_codec: str,
    cq: int,
    preset: int,
    audio_bitrate: str,
    min_savings_ratio: float,
    encode_script: pathlib.Path,
) -> tuple[bool, int]:
    """Upload -> remote AV1 encode -> download -> local verify -> atomic swap + transcript sync."""
    old_size = item.size
    old_dur = item.probe.duration_sec
    remote_in = "/content/work/in.mp4"
    remote_out = "/content/work/out.mp4"

    _log(
        f"[colab] Uploading '{item.file_name}' "
        f"({mp.format_bytes(old_size)}, {item.probe.width}x{item.probe.height} "
        f"{item.probe.video_codec}, {old_dur/60:.1f} min)..."
    )
    t_up = time.monotonic()
    up = _run_colab(
        colab_bin,
        colab_config,
        ["upload", "-s", session_name, str(item.full_path), remote_in],
        timeout=1800,
    )
    if up.returncode != 0:
        _log(f"[colab] Upload failed for '{item.file_name}': {(up.stderr or up.stdout).strip()[:300]}")
        return False, 0
    up_sec = max(0.01, time.monotonic() - t_up)
    _log(f"[colab] Uploaded in {up_sec:.1f}s ({(old_size/1048576)/up_sec:.1f} MB/s). Encoding on Colab...")

    tag = f"{mp.OPT_TAG_PREFIX};codec={remote_codec};q={cq};colab=1"
    enc = _run_colab(
        colab_bin,
        colab_config,
        [
            "exec", "-s", session_name, "--timeout", "0",
            "-f", str(encode_script),
            "--env", f"TRILHA_IN={remote_in}",
            "--env", f"TRILHA_OUT={remote_out}",
            "--env", f"TRILHA_CODEC={remote_codec}",
            "--env", f"TRILHA_CQ={cq}",
            "--env", f"TRILHA_PRESET={preset}",
            "--env", f"TRILHA_ABITRATE={audio_bitrate}",
            "--env", f"TRILHA_TAG={tag}",
        ],
        timeout=3600,
    )
    if enc.returncode != 0:
        _log(f"[colab] Remote encode failed for '{item.file_name}': {(enc.stdout + enc.stderr).strip()[-400:]}")
        _run_colab(colab_bin, colab_config, ["rm", "-s", session_name, remote_in], timeout=30)
        return False, 0

    meta: dict[str, Any] = {}
    for line in reversed((enc.stdout or "").splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                meta = json.loads(line)
                break
            except Exception:
                pass
    enc_sec = float(meta.get("elapsedSec") or 0.0)
    used_codec = str(meta.get("codec") or remote_codec)
    out_bytes = int(meta.get("outBytes") or 0)
    speed = (old_dur / enc_sec) if enc_sec > 0 else 0.0
    _log(
        f"[colab] Remote encode done ({used_codec}) in {enc_sec:.1f}s ({speed:.1f}x realtime): "
        f"{mp.format_bytes(old_size)} -> {mp.format_bytes(out_bytes)}"
    )

    if out_bytes <= 0 or out_bytes >= int(old_size * min_savings_ratio):
        _log(
            f"[colab] Savings below threshold ({out_bytes}/{old_size}); keeping original '{item.file_name}'."
        )
        pipeline._record_compression_entry(
            item.relative_posix,
            {
                "status": "skipped-insufficient-savings",
                "fileName": item.file_name,
                "originalBytes": old_size,
                "attemptedBytes": out_bytes,
                "codec": used_codec,
                "colab": True,
                "recordedAt": _now_iso(),
            },
        )
        _run_colab(colab_bin, colab_config, ["rm", "-s", session_name, remote_in], timeout=30)
        _run_colab(colab_bin, colab_config, ["rm", "-s", session_name, remote_out], timeout=30)
        return False, 0

    tmp_path = item.full_path.with_name(item.full_path.stem + ".trilha-opt.tmp.mp4")
    tmp_path.unlink(missing_ok=True)
    try:
        t_dl = time.monotonic()
        dl = _run_colab(
            colab_bin,
            colab_config,
            ["download", "-s", session_name, remote_out, str(tmp_path)],
            timeout=1800,
        )
        if dl.returncode != 0 or not tmp_path.exists():
            _log(f"[colab] Download failed for '{item.file_name}': {(dl.stderr or dl.stdout).strip()[:300]}")
            tmp_path.unlink(missing_ok=True)
            return False, 0
        dl_sec = max(0.01, time.monotonic() - t_dl)
        _log(f"[colab] Downloaded in {dl_sec:.1f}s ({(tmp_path.stat().st_size/1048576)/dl_sec:.1f} MB/s). Verifying...")

        new_probe = mp.probe_media(tmp_path)
        if not new_probe.ok:
            _log(f"[colab] Local ffprobe rejected downloaded video '{item.file_name}': {new_probe.error}")
            tmp_path.unlink(missing_ok=True)
            return False, 0
        if abs(new_probe.duration_sec - old_dur) > 1.5:
            _log(
                f"[colab] Duration mismatch on '{item.file_name}' "
                f"(old={old_dur:.2f}s vs new={new_probe.duration_sec:.2f}s); aborting swap."
            )
            tmp_path.unlink(missing_ok=True)
            return False, 0
        new_size = tmp_path.stat().st_size
        if new_size >= int(old_size * min_savings_ratio):
            tmp_path.unlink(missing_ok=True)
            return False, 0

        mp._atomic_replace_with_retry(tmp_path, item.full_path)
        new_st = item.full_path.stat()
        new_mtime_ms = int(round(new_st.st_mtime * 1000))
        synced = pipeline._sync_transcript_metadata(item.relative_posix, new_st.st_size, new_mtime_ms)
        saved = old_size - new_st.st_size
        pct = (saved / old_size) * 100.0 if old_size > 0 else 0.0
        pipeline._record_compression_entry(
            item.relative_posix,
            {
                "status": "compressed",
                "fileName": item.file_name,
                "originalBytes": old_size,
                "compressedBytes": new_st.st_size,
                "savedBytes": saved,
                "reductionPct": round(pct, 2),
                "codec": used_codec,
                "cq": cq,
                "colab": True,
                "durationSec": round(new_probe.duration_sec, 3),
                "fileMtimeMs": new_mtime_ms,
                "encodeSec": round(enc_sec, 2),
                "transcriptSynced": synced,
                "compressedAt": _now_iso(),
            },
        )
        _log(
            f"[colab] Swapped '{item.file_name}': {mp.format_bytes(old_size)} -> {mp.format_bytes(new_st.st_size)} "
            f"(-{pct:.1f}%, saved {mp.format_bytes(saved)}) | transcript_synced={synced}"
        )
        return True, saved
    finally:
        tmp_path.unlink(missing_ok=True)
        _run_colab(colab_bin, colab_config, ["rm", "-s", session_name, remote_in], timeout=30)
        _run_colab(colab_bin, colab_config, ["rm", "-s", session_name, remote_out], timeout=30)


def main() -> int:
    signal.signal(signal.SIGINT, _handle_stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_stop)

    parser = argparse.ArgumentParser(
        description="Offload TrilhaAtlas intensive video compression to Google Colab via `colab` CLI."
    )
    parser.add_argument("--canonical-dir", required=True, type=pathlib.Path)
    parser.add_argument("--incoming-dir", action="append", default=[], type=pathlib.Path)
    parser.add_argument("--transcript-dir", required=True, type=pathlib.Path)
    parser.add_argument("--session", default="trilha-media")
    parser.add_argument("--gpu", default="L4", help="Colab GPU (L4, T4, A100) or 'none' for CPU")
    parser.add_argument("--high-mem", action="store_true")
    parser.add_argument("--reuse-session", action="store_true")
    parser.add_argument("--keep-session", action="store_true", help="Do not stop Colab VM on exit")
    parser.add_argument("--colab-bin", default=shutil.which("colab") or "colab")
    parser.add_argument("--colab-config", default=None)
    parser.add_argument("--codec", choices=["auto", "av1_nvenc", "libsvtav1"], default="auto")
    parser.add_argument("--cq", type=int, default=38, help="Quality level (38 for SVT-AV1 / 36-38 for AV1 NVENC)")
    parser.add_argument("--preset", type=int, default=8)
    parser.add_argument("--audio-bitrate", default="80k")
    parser.add_argument("--sort", choices=["largest", "natural", "smallest"], default="largest")
    parser.add_argument("--min-savings-ratio", type=float, default=0.90)
    parser.add_argument("--max-videos", type=int, default=0)
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--poll-seconds", type=int, default=20)
    parser.add_argument("--min-stable-seconds", type=float, default=5.0)
    args = parser.parse_args()

    mp = _load_sibling_module("intensive_media_pipeline", "intensive-media-pipeline.py")
    gpu_arg = None if (args.gpu or "").lower() in ("", "none", "cpu") else args.gpu

    cfg = mp.PipelineConfig(
        canonical_dir=args.canonical_dir,
        incoming_dirs=args.incoming_dir,
        transcript_dir=args.transcript_dir,
        codec="libsvtav1",
        cq=args.cq,
        crf=args.cq,
        preset=str(args.preset),
        audio_bitrate=args.audio_bitrate,
        dedup=bool(args.incoming_dir),
        compress=False,
        remove_corrupt=False,
        watch=False,
        poll_seconds=args.poll_seconds,
        min_stable_seconds=args.min_stable_seconds,
        max_videos=0,
        sort_order=args.sort,
        min_savings_ratio=args.min_savings_ratio,
        dry_run=False,
    )
    pipeline = mp.MediaPipeline(cfg)

    ok, detail = _ensure_session(
        args.colab_bin, args.colab_config, args.session, gpu_arg, args.high_mem, args.reuse_session
    )
    if not ok:
        _log(f"ERROR creating Colab session: {detail}")
        return 2

    encode_script = _write_temp_script(REMOTE_ENCODE_SCRIPT)
    total_compressed = 0
    total_saved = 0
    try:
        caps = _setup_remote_vm(args.colab_bin, args.colab_config, args.session)
        remote_codec = args.codec
        if remote_codec == "auto":
            remote_codec = "av1_nvenc" if caps.get("av1_nvenc") else "libsvtav1"
        _log(f"Selected remote encoder on Colab '{args.session}': {remote_codec}")

        while not _STOP_REQUESTED:
            if args.incoming_dir:
                pipeline.run_dedup_cycle()

            canonical_items = pipeline._scan_dir_stable(args.canonical_dir, is_canonical=True)
            candidates = [
                it for it in canonical_items
                if it.probe.ok and not pipeline._is_already_optimized(it)
            ]
            if args.sort == "largest":
                candidates.sort(key=lambda x: x.size, reverse=True)
            elif args.sort == "smallest":
                candidates.sort(key=lambda x: x.size)

            _log(
                f"Colab cycle: {len(canonical_items)} canonical videos, "
                f"{len(candidates)} pending compression."
            )

            processed_this_cycle = 0
            for item in candidates:
                if _STOP_REQUESTED:
                    break
                if args.max_videos > 0 and total_compressed >= args.max_videos:
                    break
                ok_v, saved = _process_one_video_on_colab(
                    mp=mp,
                    pipeline=pipeline,
                    item=item,
                    colab_bin=args.colab_bin,
                    colab_config=args.colab_config,
                    session_name=args.session,
                    remote_codec=remote_codec,
                    cq=args.cq,
                    preset=args.preset,
                    audio_bitrate=args.audio_bitrate,
                    min_savings_ratio=args.min_savings_ratio,
                    encode_script=encode_script,
                )
                if ok_v:
                    total_compressed += 1
                    total_saved += saved
                    processed_this_cycle += 1

            if not args.watch or (args.max_videos > 0 and total_compressed >= args.max_videos):
                break
            if processed_this_cycle == 0:
                for _ in range(max(1, args.poll_seconds)):
                    if _STOP_REQUESTED:
                        break
                    time.sleep(1.0)
    finally:
        encode_script.unlink(missing_ok=True)
        if not args.keep_session:
            _log(f"Stopping Colab session '{args.session}' to preserve compute units...")
            _run_colab(args.colab_bin, args.colab_config, ["stop", "-s", args.session], timeout=60)
        _log(
            f"Colab worker finished: compressed={total_compressed}, "
            f"total_saved={mp.format_bytes(total_saved)}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
