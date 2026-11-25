#!/usr/bin/env python3
"""Local GPU transcription pipeline for intensive video courses (TrilhaAtlas).

Discovers local course videos, safely skips incomplete/in-progress downloads,
extracts optional Telegram export metadata (result.json) leniently, runs
faster-whisper on CUDA (RTX GPU) to emit structured JSON transcripts with
retrieval chunks, WebVTT subtitles, timestamped plain text, and atomically
updated manifest.json / status.json files for the Next.js app.

No private paths are hardcoded; supply --course-id, --source-dir, and
--output-dir explicitly on the command line.
"""

from __future__ import annotations

import argparse
import gc
import glob
import hashlib
import json
import math
import os
import re
import signal
import site
import subprocess
import sys
import tempfile
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True

# Keep Windows CUDA DLL directory handles alive for the lifetime of the process.
_DLL_DIR_HANDLES: list[Any] = []

VIDEO_EXTENSIONS = frozenset({".mp4", ".mkv", ".webm", ".mov", ".m4v"})
MIN_FILE_SIZE_BYTES = 10 * 1024  # 10 KB minimum before probing
SCHEMA_VERSION = 1

# Leading lesson/module number patterns for smart natural sorting across mixed
# naming styles (e.g., "Aula 1 ...", "02_Aula_2_...", "03. Aula 3", "Aula_4_...", "10_...").
_LEADING_NUMBER_RE = re.compile(r"^\s*(\d+)(?:[\s._\-)]|$)")
_LESSON_PREFIX_NUMBER_RE = re.compile(
    r"^\s*(?:aula|lesson|class|epis[oó]dio|ep|cap[ií]tulo|cap|m[oó]dulo|mod|"
    r"parte|pt|v[ií]deo|vid|lecture|lec|bloco|unit|unidade)[\s._#\-]*(\d+)(?=\D|$)",
    re.IGNORECASE,
)
_NATURAL_SPLIT_RE = re.compile(r"(\d+)")

# Title cleanup patterns.
_TRAILING_BRACKET_ID_RE = re.compile(r"\s*\[[A-Za-z0-9_\-]{6,15}\]\s*$")
_TRAILING_UNDERSCORE_TOKEN_RE = re.compile(r"_([A-Za-z0-9\-]{6,15})$")
_REDUNDANT_LEADING_INDEX_RE = re.compile(
    r"^(\d+)[\s._\-]+((?:aula|lesson|epis[oó]dio|cap[ií]tulo|m[oó]dulo|parte)\s+(\d+)\b.*)$",
    re.IGNORECASE,
)
_LESSON_DASH_RE = re.compile(
    r"^((?:aula|lesson|epis[oó]dio|cap[ií]tulo|m[oó]dulo|parte)\s+\d+)\s+(?![\-\u2013\u2014:])(.+)$",
    re.IGNORECASE,
)

# Chunking bounds: ~2-3 minutes or ~300-450 words per retrieval window.
CHUNK_TARGET_SEC = 115.0
CHUNK_MAX_SEC = 180.0
CHUNK_TARGET_WORDS = 300
CHUNK_MAX_WORDS = 430

# Broadcast-grade WebVTT subtitle bounds (2 balanced lines x ~42 chars, no sub-0.6s flickers).
VTT_MAX_LINE_CHARS = 42
VTT_MAX_LINES = 2
VTT_MAX_CUE_CHARS = 84
VTT_MIN_CUE_DURATION = 0.60
VTT_MAX_MERGED_DURATION = 6.50
VTT_MAX_MERGE_GAP = 0.55

# Tolerance (seconds) when matching an existing transcript after lossless/CRF video compression.
DURATION_MATCH_TOLERANCE_SEC = 2.0

# Domain-aware default PT-BR electronics glossary for Whisper initial_prompt (~190 tokens,
# fitting cleanly within Whisper's 224-token prompt window alongside the lesson title).
DEFAULT_PT_ELECTRONICS_GLOSSARY = (
    "CTA Eletrônica, Mario Pinheiro, resistor, capacitor eletrolítico, cerâmico, tântalo, "
    "indutor, bobina, diodo, Zener, Schottky, LED, transistor, BJT, FET, MOSFET, IGBT, "
    "optoacoplador, TL431, PWM, fonte chaveada, SMPS, Flyback, Buck, Boost, multímetro, "
    "osciloscópio, queda de tensão, divisor de tensão, malha, curto-circuito, fuga, "
    "componente aberto, alterado, BGA, reballing, reflow, stencil, fluxo de solda, Amtech, "
    "lead-free, esferas de solda, estação de ar quente, ferro de solda, termopar, CMOS, "
    "álcool isopropílico, PTH, SMD, PCB, trilha, pad, Lei de Ohm, Kirchhoff, Thévenin, "
    "ohms, kΩ, MΩ, microfarads, nanofarads, miliamperes, hertz, quilohertz, megahertz, "
    "placa-mãe, chipset, processador."
)

_STOP_REQUESTED = False


def _configure_stdio() -> None:
    """Ensure UTF-8 console output on Windows so Portuguese titles never crash."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def register_windows_cuda_dlls() -> list[str]:
    """Register pip-installed NVIDIA CUDA 12 / cuDNN 9 DLL directories on Windows.

    CTranslate2 dynamically loads cublas64_12.dll and cudnn64_9.dll at runtime.
    Adding site-packages/nvidia/*/bin via os.add_dll_directory and PATH avoids
    requiring a system-wide CUDA Toolkit installation.
    """
    added: list[str] = []
    if sys.platform != "win32":
        return added

    search_roots: list[str] = []
    try:
        search_roots.extend(site.getsitepackages())
    except Exception:
        pass
    try:
        user_sp = site.getusersitepackages()
        if isinstance(user_sp, str):
            search_roots.append(user_sp)
    except Exception:
        pass

    seen: set[str] = set()
    for base in search_roots:
        for pattern in (
            os.path.join(base, "nvidia", "*", "bin"),
            os.path.join(base, "nvidia", "*", "lib"),
            os.path.join(base, "ctranslate2"),
        ):
            for candidate in sorted(glob.glob(pattern)):
                norm = os.path.normcase(os.path.abspath(candidate))
                if norm in seen or not os.path.isdir(candidate):
                    continue
                seen.add(norm)
                try:
                    handle = os.add_dll_directory(candidate)
                    _DLL_DIR_HANDLES.append(handle)
                    added.append(candidate)
                except OSError:
                    pass

    if added:
        existing_path = os.environ.get("PATH", "")
        os.environ["PATH"] = os.pathsep.join(added) + (
            os.pathsep + existing_path if existing_path else ""
        )
    return added


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 format with millisecond precision."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def log(message: str) -> None:
    """Print a timestamped log line flushed immediately for daemon log streaming."""
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {message}", flush=True)


def atomic_write_json(target: Path, payload: dict[str, Any]) -> None:
    """Atomically write JSON via a sibling temp file + fsync + os.replace."""
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    encoded = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    with open(tmp_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(encoded)
        fh.flush()
        os.fsync(fh.fileno())
    _replace_with_retry(tmp_path, target)


def atomic_write_text(target: Path, content: str) -> None:
    """Atomically write UTF-8 text via a sibling temp file + fsync + os.replace."""
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    with open(tmp_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(content)
        fh.flush()
        os.fsync(fh.fileno())
    _replace_with_retry(tmp_path, target)


def _replace_with_retry(src: Path, dst: Path, attempts: int = 8) -> None:
    """Replace destination with brief retry on Windows sharing violations."""
    last_err: OSError | None = None
    for idx in range(attempts):
        try:
            os.replace(src, dst)
            return
        except PermissionError as exc:
            last_err = exc
            time.sleep(0.05 * (idx + 1))
    try:
        src.unlink(missing_ok=True)
    except OSError:
        pass
    if last_err is not None:
        raise last_err


def _strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def _looks_like_video_id(token: str) -> bool:
    """Heuristically identify trailing yt-dlp/YouTube video IDs appended with '_'."""
    if not (6 <= len(token) <= 15):
        return False
    has_upper = any("A" <= c <= "Z" for c in token)
    has_lower = any("a" <= c <= "z" for c in token)
    has_digit = any("0" <= c <= "9" for c in token)
    if not (has_upper and has_lower):
        return False
    # Count case transitions; normal words/acronyms (Solda, BGA, MOSFET, LM317)
    # have 0 or 1 transition, whereas random base64url IDs have >= 2 transitions
    # or combine upper + lower + digits across >= 8 chars.
    letters = [c for c in token if c.isalpha()]
    transitions = sum(
        1 for a, b in zip(letters, letters[1:]) if a.isupper() != b.isupper()
    )
    if transitions >= 2:
        return True
    if has_digit and len(token) >= 8:
        return True
    return False


def clean_human_title(file_name: str) -> str:
    """Convert raw video filename into a clean, readable Portuguese/English title."""
    stem = Path(file_name).stem
    stem = _TRAILING_BRACKET_ID_RE.sub("", stem)

    # Strip trailing underscore-delimited random IDs (e.g. "_INyU56K1AE4", "_eQqnKL")
    # before converting underscores into spaces.
    match = _TRAILING_UNDERSCORE_TOKEN_RE.search(stem)
    if match and _looks_like_video_id(match.group(1)):
        stem = stem[: match.start()]

    title = stem.replace("_", " ")
    title = re.sub(r"\s+", " ", title).strip(" -.")

    # Remove redundant leading sequence number when immediately repeated ("02 Aula 2 ...").
    dup = _REDUNDANT_LEADING_INDEX_RE.match(title)
    if dup:
        try:
            if int(dup.group(1)) == int(dup.group(3)):
                title = dup.group(2).strip()
        except ValueError:
            pass

    # Normalize "Aula 2 Diferença..." -> "Aula 2 - Diferença..." when separator missing.
    dash_match = _LESSON_DASH_RE.match(title)
    if dash_match:
        title = f"{dash_match.group(1)} - {dash_match.group(2)}"

    # Normalize spacing around hyphens.
    title = re.sub(r"\s*-\s*", " - ", title)
    title = re.sub(r"\s+", " ", title).strip()
    return title or Path(file_name).stem


def make_lesson_id(relative_posix_path: str) -> str:
    """Build a deterministic, URL-safe lessonId from slug + short hash of relative path."""
    base_name = Path(relative_posix_path).name
    clean = clean_human_title(base_name)
    ascii_clean = _strip_accents(clean).lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_clean).strip("-")
    if len(slug) > 48:
        slug = slug[:48].rstrip("-")
    if not slug:
        slug = "lesson"
    digest = hashlib.sha1(relative_posix_path.encode("utf-8")).hexdigest()[:8]
    return f"{slug}-{digest}"


def _natural_tokens(text: str) -> tuple[tuple[int, int | str], ...]:
    """Tokenize string into comparable numeric/text chunks for natural sorting."""
    norm = _strip_accents(text).lower()
    parts = _NATURAL_SPLIT_RE.split(norm)
    tokens: list[tuple[int, int | str]] = []
    for part in parts:
        if not part:
            continue
        if part.isdigit():
            tokens.append((0, int(part)))
        else:
            tokens.append((1, part))
    return tuple(tokens)


def _component_sort_key(name: str) -> tuple[int, int, tuple[tuple[int, int | str], ...]]:
    """Smart natural key aligning 'Aula 1', '02_Aula_2', '03. Aula 3', 'Aula_4', '10_...'."""
    stem = Path(name).stem
    norm = _strip_accents(stem).strip()

    lead = _LEADING_NUMBER_RE.match(norm)
    if lead:
        return (0, int(lead.group(1)), _natural_tokens(stem))

    pref = _LESSON_PREFIX_NUMBER_RE.match(norm)
    if pref:
        return (0, int(pref.group(1)), _natural_tokens(stem))

    return (1, 0, _natural_tokens(stem))


def natural_video_sort_key(relative_path: Path) -> tuple[tuple[int, int, tuple[tuple[int, int | str], ...]], ...]:
    """Sort key across nested directory segments and video filename."""
    return tuple(_component_sort_key(part) for part in relative_path.parts)


@dataclass
class TelegramMetadata:
    """Optional channel metadata parsed from Telegram Desktop's result.json."""

    course_name: str | None = None
    by_rel_path: dict[str, dict[str, Any]] = field(default_factory=dict)
    by_file_name: dict[str, dict[str, Any]] = field(default_factory=dict)

    def lookup(self, relative_posix: str, file_name: str) -> dict[str, Any] | None:
        rel_key = _norm_lookup_key(relative_posix)
        if rel_key in self.by_rel_path:
            return self.by_rel_path[rel_key]
        # Telegram often prefixes paths with "video_files/".
        vf_key = _norm_lookup_key(f"video_files/{relative_posix}")
        if vf_key in self.by_rel_path:
            return self.by_rel_path[vf_key]
        name_key = _norm_lookup_key(file_name)
        return self.by_file_name.get(name_key)


def _norm_lookup_key(value: str) -> str:
    return unicodedata.normalize("NFC", value.replace("\\", "/")).casefold().strip("/")


def _flatten_telegram_text(text_field: Any) -> str:
    """Flatten Telegram's string-or-entity-array message text field into plain text."""
    if isinstance(text_field, str):
        return text_field.strip()
    if isinstance(text_field, list):
        parts: list[str] = []
        for item in text_field:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                val = item.get("text")
                if isinstance(val, str):
                    parts.append(val)
        return "".join(parts).strip()
    return ""


def parse_telegram_result_json(source_dir: Path) -> TelegramMetadata:
    """Leniently parse Telegram's result.json in parent or source directory.

    Handles both complete JSON files and mid-export truncated JSON streams
    without ever raising on incomplete trailing data.
    """
    meta = TelegramMetadata()
    candidates = [source_dir.parent / "result.json", source_dir / "result.json"]
    result_path = next((p for p in candidates if p.is_file()), None)
    if result_path is None:
        return meta

    try:
        raw = result_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return meta

    if not raw.strip():
        return meta

    messages: list[dict[str, Any]] = []
    parsed_full = False
    try:
        doc = json.loads(raw)
        if isinstance(doc, dict):
            name = doc.get("name")
            if isinstance(name, str) and name.strip():
                meta.course_name = name.strip()
            raw_msgs = doc.get("messages")
            if isinstance(raw_msgs, list):
                messages = [m for m in raw_msgs if isinstance(m, dict)]
            parsed_full = True
    except json.JSONDecodeError:
        parsed_full = False

    if not parsed_full:
        # Lenient fallback for in-progress Telegram exports.
        name_match = re.search(r'"name"\s*:\s*"((?:\\.|[^"\\])*)"', raw[:4096])
        if name_match:
            try:
                meta.course_name = json.loads(f'"{name_match.group(1)}"').strip() or None
            except json.JSONDecodeError:
                pass

        msgs_match = re.search(r'"messages"\s*:\s*\[', raw)
        if msgs_match:
            decoder = json.JSONDecoder()
            idx = msgs_match.end()
            length = len(raw)
            while idx < length:
                while idx < length and raw[idx] in " \t\r\n,":
                    idx += 1
                if idx >= length or raw[idx] == "]":
                    break
                try:
                    obj, end_idx = decoder.raw_decode(raw, idx)
                except json.JSONDecodeError:
                    # Reached truncated tail of an active export; stop cleanly.
                    break
                if isinstance(obj, dict):
                    messages.append(obj)
                idx = end_idx

    for msg in messages:
        file_ref = msg.get("file")
        if not isinstance(file_ref, str) or not file_ref.strip():
            continue
        file_posix = file_ref.replace("\\", "/")
        entry = {
            "caption": _flatten_telegram_text(msg.get("text")),
            "date": msg.get("date") if isinstance(msg.get("date"), str) else None,
            "messageId": msg.get("id") if isinstance(msg.get("id"), int) else None,
            "durationSeconds": msg.get("duration_seconds")
            if isinstance(msg.get("duration_seconds"), (int, float))
            else None,
        }
        meta.by_rel_path[_norm_lookup_key(file_posix)] = entry
        meta.by_file_name[_norm_lookup_key(Path(file_posix).name)] = entry

    return meta


@dataclass
class ProbeResult:
    ok: bool
    duration_sec: float = 0.0
    has_audio: bool = False
    reason: str = ""


def decode_audio_ffmpeg(video_path: Path, sample_rate: int = 16000) -> Any:
    """Decode audio track to 16 kHz mono float32 PCM via ffmpeg and a temp file.

    Writing PCM to a short-lived temp file avoids PyAV version incompatibilities
    (e.g. PyAV 19 removing metadata_errors), avoids faster_whisper's per-file
    gc.collect(), and prevents Python subprocess pipe deadlocks under memory pressure.
    """
    import numpy as np

    fd, tmp_name = tempfile.mkstemp(prefix="lh-audio-", suffix=".s16le")
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        cmd = [
            "ffmpeg",
            "-y",
            "-nostdin",
            "-v",
            "error",
            "-threads",
            "2",
            "-i",
            str(video_path),
            "-vn",
            "-f",
            "s16le",
            "-ac",
            "1",
            "-acodec",
            "pcm_s16le",
            "-ar",
            str(sample_rate),
            str(tmp_path),
        ]
        proc = subprocess.run(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=180,
            check=False,
        )
        if proc.returncode != 0:
            err = proc.stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"ffmpeg decode failed ({proc.returncode}): {err}")
        if not tmp_path.exists() or tmp_path.stat().st_size == 0:
            raise RuntimeError("ffmpeg produced empty audio stream")
        raw_i16 = np.fromfile(tmp_path, dtype=np.int16)
        return raw_i16.astype(np.float32) / 32768.0
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass


def probe_video_file(video_path: Path) -> ProbeResult:
    """Verify file is readable and ffprobe confirms valid audio stream + duration > 0."""
    try:
        with open(video_path, "rb") as fh:
            head = fh.read(4096)
            if not head:
                return ProbeResult(ok=False, reason="empty file")
            size = video_path.stat().st_size
            if size > 4096:
                fh.seek(max(0, size - 4096))
                _ = fh.read(4096)
    except OSError as exc:
        return ProbeResult(ok=False, reason=f"file unreadable/locked: {exc}")

    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-show_entries",
        "stream=codec_type,codec_name",
        "-of",
        "json",
        str(video_path),
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
            check=False,
        )
    except FileNotFoundError:
        return ProbeResult(ok=False, reason="ffprobe not found in PATH")
    except subprocess.TimeoutExpired:
        return ProbeResult(ok=False, reason="ffprobe timed out")
    except OSError as exc:
        return ProbeResult(ok=False, reason=f"ffprobe error: {exc}")

    if proc.returncode != 0:
        err_msg = (proc.stderr or "").strip().splitlines()
        summary = err_msg[0] if err_msg else f"exit code {proc.returncode}"
        return ProbeResult(ok=False, reason=f"ffprobe rejected file: {summary}")

    try:
        info = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return ProbeResult(ok=False, reason="ffprobe returned invalid JSON")

    streams = info.get("streams") or []
    has_audio = any(
        isinstance(s, dict) and s.get("codec_type") == "audio" for s in streams
    )
    if not has_audio:
        return ProbeResult(ok=False, reason="no audio stream found")

    duration_raw = (info.get("format") or {}).get("duration")
    try:
        duration = float(duration_raw)
    except (TypeError, ValueError):
        duration = 0.0

    if duration <= 0.0:
        return ProbeResult(ok=False, reason="invalid or zero duration")

    return ProbeResult(ok=True, duration_sec=round(duration, 2), has_audio=True)


def discover_videos(source_dir: Path) -> list[tuple[Path, Path]]:
    """Discover all video files under source_dir in smart natural order.

    Returns a list of (absolute_path, relative_path) tuples.
    """
    found: list[tuple[Path, Path]] = []
    if not source_dir.exists():
        return found

    for root, dirs, files in os.walk(source_dir):
        # Skip hidden folders cleanly.
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        root_path = Path(root)
        for name in files:
            if name.startswith("."):
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext not in VIDEO_EXTENSIONS:
                continue
            full_path = root_path / name
            rel_path = full_path.relative_to(source_dir)
            found.append((full_path, rel_path))

    found.sort(key=lambda item: natural_video_sort_key(item[1]))
    return found


def find_thumbnail(video_path: Path) -> str | None:
    """Detect Telegram sidecar thumbnail (<video>_thumb.jpg) if present."""
    thumb = Path(f"{video_path}_thumb.jpg")
    if thumb.is_file() and thumb.stat().st_size > 0:
        return str(thumb.resolve())
    return None


def load_existing_transcript_meta(
    transcript_json_path: Path,
    transcript_vtt_path: Path,
    transcript_txt_path: Path,
    expected_size: int,
    expected_mtime_ms: int,
) -> dict[str, Any] | None:
    """Return existing transcript payload if it matches current file size & mtime."""
    if not (
        transcript_json_path.is_file()
        and transcript_vtt_path.is_file()
        and transcript_txt_path.is_file()
    ):
        return None
    try:
        data = json.loads(transcript_json_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    if data.get("schemaVersion") != SCHEMA_VERSION:
        return None
    if data.get("fileSize") != expected_size:
        return None
    prev_mtime = data.get("fileMtimeMs")
    if not isinstance(prev_mtime, int) or abs(prev_mtime - expected_mtime_ms) > 1000:
        return None
    if not isinstance(data.get("segments"), list) or not isinstance(data.get("chunks"), list):
        return None
    return data


def load_existing_transcript_by_duration(
    transcript_json_path: Path,
    transcript_vtt_path: Path,
    transcript_txt_path: Path,
    probed_duration_sec: float,
    tolerance_sec: float = DURATION_MATCH_TOLERANCE_SEC,
) -> dict[str, Any] | None:
    """Return existing transcript if valid and durationSec matches within tolerance.

    This keeps the pipeline resilient when a completed video is later compressed or
    remuxed (changing fileSize / fileMtimeMs while preserving audio duration), so
    we sync metadata instead of wasting GPU time re-transcribing the same lesson.
    """
    if probed_duration_sec <= 0.0:
        return None
    if not (
        transcript_json_path.is_file()
        and transcript_vtt_path.is_file()
        and transcript_txt_path.is_file()
    ):
        return None
    try:
        data = json.loads(transcript_json_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    if data.get("schemaVersion") != SCHEMA_VERSION:
        return None
    if not isinstance(data.get("segments"), list) or not isinstance(data.get("chunks"), list):
        return None
    prev_duration = data.get("durationSec")
    if not isinstance(prev_duration, (int, float)) or float(prev_duration) <= 0.0:
        return None
    if abs(float(prev_duration) - probed_duration_sec) > tolerance_sec:
        return None
    if probed_duration_sec > 5.0 and len(data["segments"]) == 0:
        return None
    return data


# ─── Electronics Glossary, Terminology Polishing & Hallucination Cleanup ─────

_BGA_CONTEXT_RE = re.compile(
    r"(?<!\w)(?:bga|reballing|rebalho|rebale|reballo|reflow|stencil|est[eê]nc(?:io|il)|"
    r"extensio|esferas?\s+(?:de\s+solda|no\s+chip|do\s+chip)|coloca[çc][aã]o\s+das?\s+esferas?|"
    r"inspe[çc][aã]o\s+(?:no\s+microsc[oó]pio|do\s+chip)|ball\s+grid|desumidificadora|chipset|pads?)(?!\w)",
    re.IGNORECASE,
)
_BGA_FLUX_CONTEXT_RE = re.compile(
    r"(?<!\w)(?:fluxo|nc-?559|559|kingbo|218|amtech|antec)(?!\w)",
    re.IGNORECASE,
)

# Foreign non-Latin scripts emitted by Whisper multilingual hallucinations over silence/noise.
_FOREIGN_SCRIPT_RE = re.compile(
    r"[\u0400-\u052F\u0590-\u06FF\u0900-\u097F\u0E00-\u0E7F"
    r"\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]"
)

# Pure single-word repeated outro hallucinations (e.g. "Tchau, tchau, tchau, tchau...").
_PURE_WORD_LOOP_RE = re.compile(
    r"^\s*([A-Za-zÀ-ÖØ-öø-ÿ]{2,14})(?:[\s,;.!?]+\1){3,}[\s,;.!?]*$",
    re.IGNORECASE,
)

# Known Whisper silence/outro filler strings safe to deduplicate when repeated consecutively.
_SHORT_SILENCE_FILLERS = frozenset(
    {
        "obrigado",
        "obrigada",
        "muito obrigado",
        "valeu",
        "tchau",
        "tchau tchau",
        "tá bom",
        "ta bom",
        "e aí",
        "e ai",
        "ok",
        "tá",
        "ta",
        "beleza",
        "maravilha",
        "até mais",
        "ate mais",
    }
)

_PT_NO_BREAK_AFTER = frozenset(
    {
        "o",
        "a",
        "os",
        "as",
        "um",
        "uma",
        "uns",
        "umas",
        "de",
        "do",
        "da",
        "dos",
        "das",
        "em",
        "no",
        "na",
        "nos",
        "nas",
        "ao",
        "à",
        "aos",
        "às",
        "por",
        "pelo",
        "pela",
        "pelos",
        "pelas",
        "para",
        "pra",
        "pro",
        "com",
        "sem",
        "que",
        "se",
        "não",
        "nao",
        "mais",
        "muito",
        "bem",
        "ou",
        "e",
        "seu",
        "sua",
        "seus",
        "suas",
        "meu",
        "minha",
        "esse",
        "essa",
        "este",
        "esta",
        "aquele",
        "aquela",
        "entre",
        "sobre",
        "até",
        "ate",
    }
)

_PT_CLAUSE_STARTERS = frozenset(
    {
        "e",
        "mas",
        "porém",
        "porem",
        "porque",
        "pois",
        "então",
        "entao",
        "que",
        "quando",
        "onde",
        "como",
        "se",
        "ou",
        "para",
        "pra",
        "com",
        "sem",
        "enquanto",
        "embora",
        "portanto",
        "logo",
        "assim",
        "senão",
        "senao",
    }
)


def build_effective_initial_prompt(
    language: str,
    lesson_title: str,
    custom_prompt: str | None = None,
) -> str | None:
    """Build Whisper initial_prompt combining PT-BR electronics glossary + lesson title."""
    title_clean = (lesson_title or "").strip()
    if custom_prompt is not None:
        custom_clean = custom_prompt.strip()
        if custom_clean == "-":
            return title_clean or None
        parts = [p for p in (custom_clean, title_clean) if p]
        return ". ".join(parts) or None

    lang_norm = (language or "pt").strip().lower().split("-")[0]
    parts: list[str] = []
    if lang_norm in ("pt", "auto"):
        parts.append(DEFAULT_PT_ELECTRONICS_GLOSSARY)
        if title_clean:
            parts.append(f"Aula: {title_clean}")
    elif title_clean:
        parts.append(title_clean)
    return " ".join(parts) or None


def detect_bga_context(title: str, full_text: str) -> bool:
    """Detect whether a lesson covers BGA / SMD rework so guarded rules can activate safely."""
    if _BGA_CONTEXT_RE.search(title or ""):
        return True
    hits = _BGA_CONTEXT_RE.findall(full_text or "")
    return len(hits) >= 2


def _is_sentence_start(text: str, pos: int, matched: str) -> bool:
    prefix = text[:pos].rstrip()
    if not prefix:
        return bool(matched) and matched[0].isupper()
    return prefix[-1] in ".!?…"


def _sub_sentence_case(
    text: str,
    pattern: re.Pattern[str],
    lower_term: str,
    title_term: str,
) -> str:
    def _repl(match: re.Match[str]) -> str:
        if _is_sentence_start(text, match.start(), match.group(0)):
            return title_term
        return lower_term

    return pattern.sub(_repl, text)


def _sub_preserve_prefix_case(
    text: str,
    pattern: re.Pattern[str],
    replacement_tail: str,
) -> str:
    def _repl(match: re.Match[str]) -> str:
        return f"{match.group(1)} {replacement_tail}"

    return pattern.sub(_repl, text)


# Precompiled high-precision electronics normalization patterns (word-boundary guarded).
_RE_SOL_DA_BGA = re.compile(r"(?<!\w)(?:sol\s+da|soda|sald[ao])\s+A?BGA(?!\w)", re.IGNORECASE)
_RE_SOLDA_ABGA = re.compile(r"(?<!\w)solda\s+ABGA(?!\w)", re.IGNORECASE)
_RE_PROB_CBGA = re.compile(
    r"(?<!\w)(probabilidade|possibilidade|chance)\s+de\s+CBGA(?!\w)",
    re.IGNORECASE,
)
_RE_REBALLING_TYPO = re.compile(
    r"(?<!\w)(?:rebalho|reballo|rebale|rebaling|rebalin|riballing|ribaling|"
    r"rebalhing|reballin|re-balling)(?!\w)",
    re.IGNORECASE,
)
_RE_REFLOW_TYPO = re.compile(
    r"(?<!\w)(?:re-flow|reflo|reflô|riflow|reflou)(?!\w)",
    re.IGNORECASE,
)
_RE_STENCIL_SINGULAR = re.compile(
    r"(?<!\w)(?:extensio|est[eê]ncio|est[eê]ncil|ist[eê]ncil|est[eê]nsil|stencil)(?!\w)",
    re.IGNORECASE,
)
_RE_STENCIL_PLURAL = re.compile(
    r"(?<!\w)(?:extensios|est[eê]ncios|est[eê]nceis|est[eê]ncils|stencils)(?!\w)",
    re.IGNORECASE,
)
_RE_LEAD_FREE = re.compile(r"(?<!\w)(?:LED|lead)[-\s]+free(?!\w)", re.IGNORECASE)
_RE_PRE_HEATER = re.compile(r"(?<!\w)pr[eé][-\s]+heater(?!\w)", re.IGNORECASE)
_RE_NO_CLEAN = re.compile(
    r"(?<!\w)(fluxo(?:\s+de\s+solda)?(?:\s+aqui)?)\s+no\s+clean(?!\w)",
    re.IGNORECASE,
)
_RE_MOSFET = re.compile(r"(?<!\w)mosfete?(s?)(?!\w)", re.IGNORECASE)
_RE_OPTOACOPLADOR = re.compile(r"(?<!\w)opto[\s-]+acoplador(es)?(?!\w)", re.IGNORECASE)
_RE_MULTIMETRO = re.compile(r"(?<!\w)multimetro(s?)(?!\w)", re.IGNORECASE)
_RE_OSCILOSCOPIO = re.compile(r"(?<!\w)osciloscopio(s?)(?!\w)", re.IGNORECASE)
_RE_PLACA_MAE = re.compile(r"(?<!\w)(placas?)\s+m[aã]e(?!\w)", re.IGNORECASE)
_RE_CURTO_CIRCUITO = re.compile(r"(?<!\w)curto\s+circuito(s?)(?!\w)", re.IGNORECASE)
_RE_TERMOPAR = re.compile(r"(?<!\w)termo\s+par(es)?(?!\w)", re.IGNORECASE)
_RE_INFRAVERMELHO = re.compile(r"(?<!\w)infra[\s-]+vermelh([oa]s?)(?!\w)", re.IGNORECASE)
_RE_ANTIESTATICO = re.compile(r"(?<!\w)anti-est[aá]tic([oa]s?)(?!\w)", re.IGNORECASE)
_RE_EPOXI = re.compile(r"(?<!\w)epox(?!\w)", re.IGNORECASE)
_RE_SOPRADOR = re.compile(r"(?<!\w)sopranador(es)?(?!\w)", re.IGNORECASE)
_RE_ESCOVINHA_ISOPROPILICO = re.compile(
    r"(?<!\w)escovinha\s+oxoprop[ií]lic([oa])(?!\w)", re.IGNORECASE
)
_RE_ISOPROPILICO = re.compile(r"(?<!\w)oxoprop[ií]lic([oa])(?!\w)", re.IGNORECASE)
_RE_CARVAO_ATIVADO = re.compile(r"(?<!\w)carav[aã]o\s+ativad[oa]s?(?!\w)", re.IGNORECASE)
_RE_MODULOS_AUTOMOTIVOS = re.compile(r"(?<!\w)m[oó]dulos\s+automativos(?!\w)", re.IGNORECASE)
_RE_OHMICO = re.compile(r"(?<!\w)[oô]mic([oa]s?)(?!\w)", re.IGNORECASE)
_RE_CMOS_CEMOSA = re.compile(r"(?<!\w)cemosa(?!\w)", re.IGNORECASE)
_RE_JUMPER_JAMPO = re.compile(r"(?<!\w)(no|o|um|desse|nesse)\s+jampo(?!\w)", re.IGNORECASE)
_RE_AFERICAO = re.compile(r"(?<!\w)feri[çc][aã]o(?!\w)", re.IGNORECASE)
_RE_CHIPSET = re.compile(r"(?<!\w)chip[\s-]+set(s?)(?!\w)", re.IGNORECASE)
_RE_TL431 = re.compile(r"(?<!\w)tl[\s-]?431(?!\w)", re.IGNORECASE)
_RE_KIRCHHOFF = re.compile(r"(?<!\w)kirch?off(?!\w)", re.IGNORECASE)
_RE_THEVENIN = re.compile(r"(?<!\w)th?[eé]venin(?!\w)", re.IGNORECASE)
_RE_SCHOTTKY = re.compile(r"(?<!\w)sch?ott?ky(?!\w)", re.IGNORECASE)
_RE_ZENER = re.compile(r"(?<!\w)zener(?!\w)", re.IGNORECASE)
_RE_LEI_DE_OHM = re.compile(r"(?<!\w)lei\s+de\s+ohm(?!\w)", re.IGNORECASE)
_RE_CTA_ELETRONICA = re.compile(r"(?<!\w)cta\s+eletr[oô]nica(?!\w)", re.IGNORECASE)
_RE_MICROFARAD = re.compile(r"(?<!\w)micro[\s-]+farad(s?)(?!\w)", re.IGNORECASE)
_RE_NANOFARAD = re.compile(r"(?<!\w)nano[\s-]+farad(s?)(?!\w)", re.IGNORECASE)
_RE_PICOFARAD = re.compile(r"(?<!\w)pico[\s-]+farad(s?)(?!\w)", re.IGNORECASE)
_RE_MILIAMPERE = re.compile(r"(?<!\w)mili[\s-]+amp[eèé]re(s?)(?!\w)", re.IGNORECASE)
_RE_QUILOHERTZ = re.compile(r"(?<!\w)quilo[\s-]+hertz(?!\w)", re.IGNORECASE)
_RE_MEGAHERTZ = re.compile(r"(?<!\w)mega[\s-]+hertz(?!\w)", re.IGNORECASE)

_ACRONYM_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?<!\w)smd(?!\w)", re.IGNORECASE), "SMD"),
    (re.compile(r"(?<!\w)pth(?!\w)", re.IGNORECASE), "PTH"),
    (re.compile(r"(?<!\w)pwm(?!\w)", re.IGNORECASE), "PWM"),
    (re.compile(r"(?<!\w)smps(?!\w)", re.IGNORECASE), "SMPS"),
    (re.compile(r"(?<!\w)cmos(?!\w)", re.IGNORECASE), "CMOS"),
    (re.compile(r"(?<!\w)gnd(?!\w)", re.IGNORECASE), "GND"),
    (re.compile(r"(?<!\w)pcb(s?)(?!\w)", re.IGNORECASE), r"PCB\1"),
    (re.compile(r"(?<!\w)bga(s?)(?!\w)", re.IGNORECASE), r"BGA\1"),
    (re.compile(r"(?<!\w)bjt(s?)(?!\w)", re.IGNORECASE), r"BJT\1"),
    (re.compile(r"(?<!\w)igbt(s?)(?!\w)", re.IGNORECASE), r"IGBT\1"),
    (re.compile(r"(?<!\w)fet(s?)(?!\w)", re.IGNORECASE), r"FET\1"),
    (re.compile(r"(?<!\w)led(s?)(?!\w)", re.IGNORECASE), r"LED\1"),
)

# BGA-context-guarded patterns (only active when lesson clearly discusses BGA rework).
_RE_BGA_IBGE = re.compile(r"(?<!\w)IBGE(?!\w)")
_RE_BGA_REFRAO = re.compile(
    r"(?<!\w)(fazer\s+(?:um|o)|dar\s+um|um|o|de|no|zona\s+de|temperatura\s+de|processo\s+de)\s+refr[aã]o(?!\w)",
    re.IGNORECASE,
)
_RE_BGA_EXTENSO_SING = re.compile(
    r"(?<!\w)(o|do|no|seu|esse|este|desse|deste|um)\s+extensos?(?!\w)",
    re.IGNORECASE,
)
_RE_BGA_EXTENSO_PLUR = re.compile(
    r"(?<!\w)(os|dos|nos|seus|esses|estes|alguns|de)\s+extensos(?!\w)",
    re.IGNORECASE,
)
_RE_BGA_ANTEC = re.compile(r"(?<!\w)Antec(?!\w)", re.IGNORECASE)
_RE_BGA_INSPECAO_EXPRESSAO = re.compile(
    r"(?<!\w)(fazer\s+(?:a|uma)|a|uma)\s+express[aã]o"
    r"(?=\s+(?:com\s+(?:o\s+microsc[oó]pio|a\s+lupa)|no\s+microsc[oó]pio|e\s+remover)|,\s*p(?:a)?ra\s+ver)(?!\w)",
    re.IGNORECASE,
)

# Whitespace & punctuation spacing cleanup.
_RE_MULTI_SPACE = re.compile(r"\s+")
_RE_SPACE_BEFORE_PUNCT = re.compile(r"\s+([,.;:!?])")


def polish_electronics_text(
    text: str,
    *,
    is_bga_context: bool = False,
    is_bga_flux_context: bool = False,
) -> str:
    """Conservatively normalize PT-BR electronics terminology without distorting speech.

    Every rule is regex word-boundary guarded, idempotent, and verified against
    real Brazilian Portuguese electronics & BGA rework transcripts.
    """
    if not text:
        return ""

    out = _RE_MULTI_SPACE.sub(" ", text).strip()
    if not out:
        return ""

    # Lead-free MUST run before the standalone LED acronym rule.
    out = _sub_sentence_case(out, _RE_LEAD_FREE, "lead-free", "Lead-free")
    out = _sub_sentence_case(out, _RE_PRE_HEATER, "pré-heater", "Pré-heater")

    # Malformed BGA phrases.
    out = _sub_sentence_case(out, _RE_SOL_DA_BGA, "solda BGA", "Solda BGA")
    out = _sub_sentence_case(out, _RE_SOLDA_ABGA, "solda BGA", "Solda BGA")
    out = _RE_PROB_CBGA.sub(r"\1 de ser BGA", out)

    # Reballing / reflow / stencil normalization.
    out = _sub_sentence_case(out, _RE_REBALLING_TYPO, "reballing", "Reballing")
    out = _sub_sentence_case(out, _RE_REFLOW_TYPO, "reflow", "Reflow")
    out = _sub_sentence_case(out, _RE_STENCIL_PLURAL, "stencils", "Stencils")
    out = _sub_sentence_case(out, _RE_STENCIL_SINGULAR, "stencil", "Stencil")

    # Context-guarded BGA rules (never fire on unrelated general lectures).
    if is_bga_context:
        out = _RE_BGA_IBGE.sub("BGA", out)
        out = _sub_preserve_prefix_case(out, _RE_BGA_REFRAO, "reflow")
        out = _sub_preserve_prefix_case(out, _RE_BGA_EXTENSO_PLUR, "stencils")
        out = _sub_preserve_prefix_case(out, _RE_BGA_EXTENSO_SING, "stencil")
        out = _sub_preserve_prefix_case(out, _RE_BGA_INSPECAO_EXPRESSAO, "inspeção")
        if is_bga_flux_context or _BGA_FLUX_CONTEXT_RE.search(out):
            out = _RE_BGA_ANTEC.sub("Amtech", out)

    # Electronics components, tools, and Portuguese bench spelling.
    out = _RE_NO_CLEAN.sub(r"\1 no-clean", out)
    out = _RE_MOSFET.sub(lambda m: f"MOSFET{m.group(1).lower()}", out)
    out = _RE_OPTOACOPLADOR.sub(
        lambda m: (
            ("Optoacoplador" if _is_sentence_start(out, m.start(), m.group(0)) else "optoacoplador")
            + (m.group(1).lower() if m.group(1) else "")
        ),
        out,
    )
    out = _RE_MULTIMETRO.sub(
        lambda m: (
            ("Multímetro" if _is_sentence_start(out, m.start(), m.group(0)) else "multímetro")
            + m.group(1).lower()
        ),
        out,
    )
    out = _RE_OSCILOSCOPIO.sub(
        lambda m: (
            ("Osciloscópio" if _is_sentence_start(out, m.start(), m.group(0)) else "osciloscópio")
            + m.group(1).lower()
        ),
        out,
    )
    out = _RE_PLACA_MAE.sub(r"\1-mãe", out)
    out = _RE_CURTO_CIRCUITO.sub(
        lambda m: (
            ("Curto-circuito" if _is_sentence_start(out, m.start(), m.group(0)) else "curto-circuito")
            + m.group(1).lower()
        ),
        out,
    )
    out = _RE_TERMOPAR.sub(
        lambda m: (
            ("Termopar" if _is_sentence_start(out, m.start(), m.group(0)) else "termopar")
            + (m.group(1).lower() if m.group(1) else "")
        ),
        out,
    )
    out = _RE_INFRAVERMELHO.sub(
        lambda m: (
            ("Infravermelh" if _is_sentence_start(out, m.start(), m.group(0)) else "infravermelh")
            + m.group(1).lower()
        ),
        out,
    )
    out = _RE_ANTIESTATICO.sub(
        lambda m: (
            ("Antiestátic" if _is_sentence_start(out, m.start(), m.group(0)) else "antiestátic")
            + m.group(1).lower()
        ),
        out,
    )
    out = _sub_sentence_case(out, _RE_EPOXI, "epóxi", "Epóxi")
    out = _RE_SOPRADOR.sub(
        lambda m: (
            ("Soprador" if _is_sentence_start(out, m.start(), m.group(0)) else "soprador")
            + (m.group(1).lower() if m.group(1) else "")
        ),
        out,
    )
    out = _RE_ESCOVINHA_ISOPROPILICO.sub(
        lambda m: f"escovinha com álcool isopropílic{m.group(1).lower()}", out
    )
    out = _RE_ISOPROPILICO.sub(lambda m: f"isopropílic{m.group(1).lower()}", out)
    out = _RE_CARVAO_ATIVADO.sub("carvão ativado", out)
    out = _RE_MODULOS_AUTOMOTIVOS.sub("módulos automotivos", out)
    out = _RE_OHMICO.sub(
        lambda m: (
            ("Ôhmic" if _is_sentence_start(out, m.start(), m.group(0)) else "ôhmic")
            + m.group(1).lower()
        ),
        out,
    )
    out = _RE_CMOS_CEMOSA.sub("CMOS", out)
    out = _RE_JUMPER_JAMPO.sub(r"\1 jumper", out)
    out = _sub_sentence_case(out, _RE_AFERICAO, "aferição", "Aferição")
    out = _RE_CHIPSET.sub(
        lambda m: (
            ("Chipset" if _is_sentence_start(out, m.start(), m.group(0)) else "chipset")
            + m.group(1).lower()
        ),
        out,
    )
    out = _RE_TL431.sub("TL431", out)
    out = _RE_KIRCHHOFF.sub("Kirchhoff", out)
    out = _RE_THEVENIN.sub("Thévenin", out)
    out = _RE_SCHOTTKY.sub("Schottky", out)
    out = _RE_ZENER.sub("Zener", out)
    out = _RE_LEI_DE_OHM.sub("Lei de Ohm", out)
    out = _RE_CTA_ELETRONICA.sub("CTA Eletrônica", out)
    out = _RE_MICROFARAD.sub(lambda m: f"microfarad{m.group(1).lower()}", out)
    out = _RE_NANOFARAD.sub(lambda m: f"nanofarad{m.group(1).lower()}", out)
    out = _RE_PICOFARAD.sub(lambda m: f"picofarad{m.group(1).lower()}", out)
    out = _RE_MILIAMPERE.sub(lambda m: f"miliampere{m.group(1).lower()}", out)
    out = _RE_QUILOHERTZ.sub("quilohertz", out)
    out = _RE_MEGAHERTZ.sub("megahertz", out)

    # Standard electronics acronym casing (keep plural 's' lowercase, e.g. LEDs, PCBs, BJTs).
    for pattern, repl in _ACRONYM_RULES:
        if r"\1" in repl:
            base = repl[:-2]
            out = pattern.sub(lambda m, b=base: f"{b}{m.group(1).lower()}", out)
        else:
            out = pattern.sub(repl, out)

    # Final whitespace / punctuation spacing tidy.
    out = _RE_SPACE_BEFORE_PUNCT.sub(r"\1", out)
    out = _RE_MULTI_SPACE.sub(" ", out).strip()
    return out


def _norm_dedup_key(text: str) -> str:
    stripped = re.sub(r"[^\w\s]", "", text, flags=re.UNICODE)
    return _RE_MULTI_SPACE.sub(" ", stripped).strip().casefold()


def clean_whisper_segments(
    raw_segments: list[dict[str, Any]],
    *,
    language: str = "pt",
    title: str = "",
) -> list[dict[str, Any]]:
    """Clean Whisper segments: remove foreign-script & loop hallucinations and polish terms."""
    if not raw_segments:
        return []

    lang_norm = (language or "pt").strip().lower().split("-")[0]
    latin_lang = lang_norm in ("pt", "en", "es", "fr", "de", "it", "auto")

    combined_text = " ".join(str(s.get("text") or "") for s in raw_segments)
    is_bga = detect_bga_context(title, combined_text)
    is_bga_flux = is_bga and bool(_BGA_FLUX_CONTEXT_RE.search(combined_text))

    cleaned: list[dict[str, Any]] = []
    prev_key = ""
    prev_end = 0.0

    for seg in raw_segments:
        text = str(seg.get("text") or "").strip()
        if not text:
            continue

        seg_start = max(0.0, round(float(seg.get("start", 0.0)), 2))
        seg_end = max(seg_start + 0.05, round(float(seg.get("end", seg_start + 0.05)), 2))
        seg_dur = seg_end - seg_start

        # Drop or strip foreign-script Whisper hallucinations in Latin-script lectures.
        if latin_lang and _FOREIGN_SCRIPT_RE.search(text):
            if len(text) <= 40 or seg_dur <= 2.0:
                continue
            text = _FOREIGN_SCRIPT_RE.sub("", text).strip()
            if not text:
                continue

        # Collapse pure single-word repeated outro hallucinations (e.g. "Tchau, tchau, tchau...").
        loop_m = _PURE_WORD_LOOP_RE.match(text)
        if loop_m:
            word = loop_m.group(1)
            text = f"{word}, {word.lower()}."

        text = polish_electronics_text(
            text,
            is_bga_context=is_bga,
            is_bga_flux_context=is_bga_flux,
        )
        if not text:
            continue

        # Suppress consecutive identical short hallucination loops (e.g. "Obrigado." x3,
        # "Tá bom." / "Tá bom?" / "Tá bom.", or trailing repeated "E aí" over fan noise).
        key = _norm_dedup_key(text)
        gap = seg_start - prev_end
        if key and key == prev_key and len(text) <= 24:
            if (seg_dur <= 2.0 and gap <= 0.6) or (
                key in _SHORT_SILENCE_FILLERS and gap <= 6.0
            ):
                continue

        # Enforce strictly non-overlapping monotonic segment timestamps.
        if cleaned and seg_start < cleaned[-1]["end"]:
            seg_start = cleaned[-1]["end"]
            seg_end = max(seg_start + 0.05, seg_end)

        cleaned.append(
            {
                "id": len(cleaned),
                "start": round(seg_start, 2),
                "end": round(seg_end, 2),
                "text": text,
            }
        )
        prev_key = key if len(text) <= 24 else ""
        prev_end = cleaned[-1]["end"]

    return cleaned


def build_chunks(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group Whisper segments into ~2-3 min / ~300-430 word retrieval windows."""
    chunks: list[dict[str, Any]] = []
    if not segments:
        return chunks

    buf: list[dict[str, Any]] = []
    buf_words = 0

    def flush() -> None:
        nonlocal buf, buf_words
        if not buf:
            return
        text = " ".join(s["text"] for s in buf).strip()
        if text:
            chunks.append(
                {
                    "index": len(chunks),
                    "start": round(float(buf[0]["start"]), 2),
                    "end": round(float(buf[-1]["end"]), 2),
                    "text": text,
                }
            )
        buf = []
        buf_words = 0

    for seg in segments:
        seg_text = seg["text"]
        seg_words = len(seg_text.split())
        if buf:
            projected_dur = float(seg["end"]) - float(buf[0]["start"])
            projected_words = buf_words + seg_words
            if projected_dur > CHUNK_MAX_SEC or projected_words > CHUNK_MAX_WORDS:
                flush()

        buf.append(seg)
        buf_words += seg_words

        cur_dur = float(buf[-1]["end"]) - float(buf[0]["start"])
        ends_sentence = seg_text.rstrip().endswith((".", "!", "?", "..."))
        if (cur_dur >= CHUNK_TARGET_SEC or buf_words >= CHUNK_TARGET_WORDS) and ends_sentence:
            flush()
        elif cur_dur >= CHUNK_MAX_SEC or buf_words >= CHUNK_MAX_WORDS:
            flush()

    flush()
    return chunks


def format_vtt_timestamp(seconds: float) -> str:
    """Format seconds as strict WebVTT timestamp HH:MM:SS.mmm."""
    total_ms = max(0, int(round(seconds * 1000)))
    ms = total_ms % 1000
    total_s = total_ms // 1000
    s = total_s % 60
    total_m = total_s // 60
    m = total_m % 60
    h = total_m // 60
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def format_txt_timestamp(seconds: float) -> str:
    """Format seconds as [MM:SS] or [H:MM:SS] for readable plain-text transcripts."""
    total_s = max(0, int(seconds))
    s = total_s % 60
    total_m = total_s // 60
    m = total_m % 60
    h = total_m // 60
    if h > 0:
        return f"[{h}:{m:02d}:{s:02d}]"
    return f"[{m:02d}:{s:02d}]"


def _fits_two_lines(
    text: str,
    max_line: int = VTT_MAX_LINE_CHARS,
    *,
    allow_short_orphan: bool = False,
) -> bool:
    """Return True if text wraps cleanly into <= 2 lines of <= max_line chars."""
    if len(text) <= max_line:
        return True
    if len(text) > max_line * 2 + 1:
        return False
    words = text.split()
    if len(words) <= 1:
        return True
    l1_len = 0
    total = len(text)
    has_any_valid = False
    for i in range(1, len(words)):
        l1_len += len(words[i - 1]) + (1 if i > 1 else 0)
        if l1_len > max_line:
            break
        l2_len = total - l1_len - 1
        if l2_len <= max_line:
            has_any_valid = True
            right_words = len(words) - i
            if allow_short_orphan or right_words >= 2 or len(words) < 4 or l2_len >= 12:
                return True
    return has_any_valid if allow_short_orphan else False


def _wrap_vtt_lines(text: str, max_line: int = VTT_MAX_LINE_CHARS) -> str:
    """Wrap a single subtitle cue into 1 or 2 balanced broadcast-style lines."""
    clean = _RE_MULTI_SPACE.sub(" ", text).strip()
    if len(clean) <= max_line:
        return clean

    words = clean.split()
    if len(words) <= 1:
        return clean

    candidates: list[tuple[int, int, int]] = []
    l1_len = 0
    total = len(clean)
    for i in range(1, len(words)):
        l1_len += len(words[i - 1]) + (1 if i > 1 else 0)
        if l1_len > max_line:
            break
        l2_len = total - l1_len - 1
        if l2_len <= max_line:
            candidates.append((i, l1_len, l2_len))

    if candidates:
        has_non_orphan = any((len(words) - i) >= 2 for i, _, _ in candidates)
        best_i = candidates[0][0]
        best_score = -1e9
        for i, l1, l2 in candidates:
            prev_w = words[i - 1]
            next_w = words[i]
            right_words = len(words) - i

            # Visually balanced line widths with slight broadcast bottom-pyramid preference.
            score = -0.85 * abs(l1 - l2)
            if 0 <= (l2 - l1) <= 6:
                score += 2.5

            # Avoid orphan 1-word hanging second line whenever a balanced 2+ word wrap exists.
            if right_words == 1 and has_non_orphan:
                score -= 75.0
            if i == 1 and len(words) >= 4:
                score -= 35.0

            # Syntactic and punctuation break preferences.
            if prev_w.endswith((".", "!", "?", "...", "…")):
                score += 28.0
            elif prev_w.endswith((";", ":", "—", "–")):
                score += 20.0
            elif prev_w.endswith(","):
                score += 15.0
            elif next_w.rstrip(",.;:!?").casefold() in _PT_CLAUSE_STARTERS:
                score += 7.0

            if (
                not prev_w.endswith((".", "!", "?", ",", ";", ":"))
                and prev_w.casefold() in _PT_NO_BREAK_AFTER
            ):
                score -= 18.0

            if score > best_score:
                best_score = score
                best_i = i

        return f"{' '.join(words[:best_i])}\n{' '.join(words[best_i:])}"

    # Fallback greedy wrap when an unbreakable long token forces > 2 lines or > max_line.
    wrapped: list[str] = []
    cur: list[str] = []
    cur_len = 0
    for w in words:
        add = len(w) + (1 if cur else 0)
        if cur and cur_len + add > max_line:
            wrapped.append(" ".join(cur))
            cur = [w]
            cur_len = len(w)
        else:
            cur.append(w)
            cur_len += add
    if cur:
        wrapped.append(" ".join(cur))
    return "\n".join(wrapped)


def _split_words_into_cues(
    words: list[str], max_line: int = VTT_MAX_LINE_CHARS
) -> list[str]:
    """Recursively split a long segment into <= 2-line cues at punctuation/clause boundaries."""
    if not words:
        return []
    joined = " ".join(words)
    if len(words) <= 1 or _fits_two_lines(joined, max_line):
        return [joined]

    total_len = len(joined)
    est_cues = max(2, math.ceil(total_len / 72))
    target_left = total_len / est_cues

    best_i = -1
    best_score = -1e9
    prefix_len = 0
    for i in range(1, len(words)):
        prefix_len += len(words[i - 1]) + (1 if i > 1 else 0)
        if prefix_len > max_line * 2 + 2:
            break
        left_text = " ".join(words[:i])
        if not _fits_two_lines(left_text, max_line):
            continue

        prev_w = words[i - 1]
        next_w = words[i]
        right_words = len(words) - i
        right_len = total_len - prefix_len - 1

        score = -0.45 * abs(prefix_len - target_left)

        if prefix_len < 16 and not prev_w.endswith((".", "!", "?", "...")):
            score -= 22.0
        if right_words == 1 and right_len < 18:
            score -= 36.0
        elif right_len < 12:
            score -= 24.0

        if prev_w.endswith((".", "!", "?", "...", "…")):
            score += 42.0
        elif prev_w.endswith((";", ":", "—", "–")):
            score += 28.0
        elif prev_w.endswith(","):
            score += 20.0
        elif next_w.rstrip(",.;:!?").casefold() in _PT_CLAUSE_STARTERS:
            score += 11.0

        if (
            not prev_w.endswith((".", "!", "?", ",", ";", ":"))
            and prev_w.casefold() in _PT_NO_BREAK_AFTER
        ):
            score -= 26.0

        if score > best_score:
            best_score = score
            best_i = i

    if best_i <= 0:
        # Relax orphan guard before falling back to greedy prefix split.
        best_i = 1
        for i in range(2, len(words)):
            if _fits_two_lines(" ".join(words[:i]), max_line, allow_short_orphan=True):
                best_i = i
            else:
                break

    left_chunk = " ".join(words[:best_i])
    return [left_chunk, *_split_words_into_cues(words[best_i:], max_line)]


def _split_vtt_cue(
    start: float,
    end: float,
    text: str,
    max_line: int = VTT_MAX_LINE_CHARS,
) -> list[tuple[float, float, str]]:
    """Split overly long subtitle segments proportionally by time into <= 2-line cues."""
    clean = _RE_MULTI_SPACE.sub(" ", text).strip()
    if not clean:
        return []
    if _fits_two_lines(clean, max_line):
        return [(start, end, clean)]

    parts = _split_words_into_cues(clean.split(), max_line)
    if len(parts) <= 1:
        return [(start, end, clean)]

    # Weight duration proportionally by character count (+ slight pause weight on sentence endings).
    weights = [
        len(p) + (4.0 if p.endswith((".", "!", "?", "...", "…")) else (1.5 if p.endswith(",") else 0.0))
        for p in parts
    ]
    total_weight = sum(weights) or 1.0
    duration = max(0.05 * len(parts), end - start)

    cues: list[tuple[float, float, str]] = []
    cursor = start
    for idx, (part, weight) in enumerate(zip(parts, weights)):
        if idx == len(parts) - 1:
            cue_end = max(cursor + 0.05, end)
        else:
            remaining_parts = len(parts) - idx - 1
            raw_dur = duration * (weight / total_weight)
            max_end = end - 0.05 * remaining_parts
            cue_end = min(max_end, max(cursor + 0.05, cursor + raw_dur))
        cues.append((cursor, cue_end, part))
        cursor = cue_end
    return cues


def _normalize_vtt_cues(
    raw_cues: list[tuple[float, float, str]],
    max_line: int = VTT_MAX_LINE_CHARS,
) -> list[tuple[float, float, str]]:
    """Eliminate overlapping timestamps and tiny sub-0.6s subtitle flickers."""
    if not raw_cues:
        return []

    # Work on mutable [start, end, text] entries enforcing strict monotonicity first.
    cues: list[list[Any]] = []
    for start, end, text in raw_cues:
        s = max(0.0, float(start))
        e = max(s + 0.05, float(end))
        if cues and s < cues[-1][1]:
            s = cues[-1][1]
            e = max(s + 0.05, e)
        cues.append([s, e, text])

    # Pass 1: extend sub-0.6s cues into available silence, or merge cleanly with adjacent cue.
    idx = 0
    while idx < len(cues):
        s, e, txt = cues[idx]
        dur = e - s
        if dur >= VTT_MIN_CUE_DURATION:
            idx += 1
            continue

        # 1a. Extend end into trailing silence without overlapping next cue.
        next_s = cues[idx + 1][0] if idx + 1 < len(cues) else float("inf")
        if next_s > e:
            e = min(next_s, s + VTT_MIN_CUE_DURATION)
            cues[idx][1] = e
            dur = e - s
            if dur >= VTT_MIN_CUE_DURATION:
                idx += 1
                continue

        # 1b. Borrow up to 0.35s of leading silence without overlapping previous cue.
        prev_e = cues[idx - 1][1] if idx > 0 else 0.0
        if s > prev_e:
            borrow = min(s - prev_e, 0.35, VTT_MIN_CUE_DURATION - dur)
            s -= borrow
            cues[idx][0] = s
            dur = e - s
            if dur >= VTT_MIN_CUE_DURATION:
                idx += 1
                continue

        # 1c. Merge into previous cue if adjacent and combined still fits cleanly in 2 lines.
        if idx > 0:
            ps, pe, ptxt = cues[idx - 1]
            combined = f"{ptxt} {txt}"
            if (
                (s - pe) <= VTT_MAX_MERGE_GAP
                and (e - ps) <= VTT_MAX_MERGED_DURATION
                and _fits_two_lines(combined, max_line)
            ):
                cues[idx - 1] = [ps, e, combined]
                cues.pop(idx)
                continue

        # 1d. Merge with next cue if adjacent and combined still fits cleanly in 2 lines.
        if idx + 1 < len(cues):
            ns, ne, ntxt = cues[idx + 1]
            combined = f"{txt} {ntxt}"
            if (
                (ns - e) <= VTT_MAX_MERGE_GAP
                and (ne - s) <= VTT_MAX_MERGED_DURATION
                and _fits_two_lines(combined, max_line)
            ):
                cues[idx] = [s, ne, combined]
                cues.pop(idx + 1)
                continue

        # 1e. Borrow a tiny slice from a long adjacent cue (>= 1.8s) to prevent flicker.
        need = VTT_MIN_CUE_DURATION - dur
        if idx + 1 < len(cues) and (cues[idx + 1][1] - cues[idx + 1][0]) >= 1.8 and need <= 0.45:
            cues[idx][1] = e + need
            cues[idx + 1][0] = cues[idx][1]
        elif idx > 0 and (cues[idx - 1][1] - cues[idx - 1][0]) >= 1.8 and need <= 0.45:
            cues[idx][0] = s - need
            cues[idx - 1][1] = cues[idx][0]

        idx += 1

    # Final strict monotonicity & non-overlap guard (rounded cleanly to milliseconds).
    result: list[tuple[float, float, str]] = []
    prev_end_ms = 0
    for s, e, txt in cues:
        s_ms = max(prev_end_ms, int(round(s * 1000)))
        e_ms = max(s_ms + 50, int(round(e * 1000)))
        result.append((s_ms / 1000.0, e_ms / 1000.0, txt))
        prev_end_ms = e_ms
    return result


def render_vtt(segments: list[dict[str, Any]]) -> str:
    """Render broadcast-grade WebVTT subtitle file for HTML5 <track> elements."""
    raw_cues: list[tuple[float, float, str]] = []
    for seg in segments:
        start = max(0.0, float(seg["start"]))
        end = max(start + 0.05, float(seg["end"]))
        text = str(seg["text"]).replace("-->", "->").strip()
        if not text:
            continue
        raw_cues.extend(_split_vtt_cue(start, end, text, VTT_MAX_LINE_CHARS))

    normalized_cues = _normalize_vtt_cues(raw_cues, VTT_MAX_LINE_CHARS)

    lines = ["WEBVTT", ""]
    for cue_num, (c_start, c_end, c_text) in enumerate(normalized_cues, start=1):
        lines.append(str(cue_num))
        lines.append(f"{format_vtt_timestamp(c_start)} --> {format_vtt_timestamp(c_end)}")
        lines.append(_wrap_vtt_lines(c_text, VTT_MAX_LINE_CHARS))
        lines.append("")
    return "\n".join(lines)


def render_txt(segments: list[dict[str, Any]]) -> str:
    """Render clean timestamped plain-text transcript."""
    lines: list[str] = []
    for seg in segments:
        text = str(seg["text"]).strip()
        if not text:
            continue
        lines.append(f"{format_txt_timestamp(float(seg['start']))} {text}")
    return "\n".join(lines) + ("\n" if lines else "")


@dataclass
class LessonState:
    lesson_id: str
    order: int
    title: str
    file_name: str
    relative_path: str
    file_path: str
    file_size: int
    file_mtime_ms: int
    status: str  # completed | pending | downloading | transcribing | failed
    duration_sec: float | None = None
    word_count: int | None = None
    segment_count: int | None = None
    chunk_count: int | None = None
    language: str | None = None
    model: str | None = None
    transcribed_at: str | None = None
    transcription_time_sec: float | None = None
    realtime_speedup: float | None = None
    telegram_caption: str = ""
    telegram_date: str | None = None
    thumbnail_path: str | None = None
    error: str | None = None

    def to_manifest_dict(self) -> dict[str, Any]:
        completed = self.status == "completed"
        return {
            "lessonId": self.lesson_id,
            "order": self.order,
            "title": self.title,
            "fileName": self.file_name,
            "relativePath": self.relative_path,
            "filePath": self.file_path,
            "fileSize": self.file_size,
            "fileMtimeMs": self.file_mtime_ms,
            "status": self.status,
            "durationSec": self.duration_sec,
            "wordCount": self.word_count,
            "segmentCount": self.segment_count,
            "chunkCount": self.chunk_count,
            "language": self.language,
            "model": self.model,
            "transcribedAt": self.transcribed_at,
            "transcriptionTimeSec": self.transcription_time_sec,
            "realtimeSpeedup": self.realtime_speedup,
            "telegramCaption": self.telegram_caption,
            "telegramDate": self.telegram_date,
            "thumbnailPath": self.thumbnail_path,
            "transcriptJson": f"transcripts/{self.lesson_id}.json" if completed else None,
            "transcriptVtt": f"transcripts/{self.lesson_id}.vtt" if completed else None,
            "transcriptTxt": f"transcripts/{self.lesson_id}.txt" if completed else None,
            "error": self.error,
        }


class TranscriberPipeline:
    """Stateful watch/once GPU transcription coordinator."""

    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.course_id: str = args.course_id
        self.source_dir: Path = Path(args.source_dir).resolve()
        self.output_dir: Path = Path(args.output_dir).resolve()
        self.transcripts_dir: Path = self.output_dir / "transcripts"
        self.manifest_path: Path = self.output_dir / "manifest.json"
        self.status_path: Path = self.output_dir / "status.json"

        self.started_monotonic = time.monotonic()
        self.started_at_iso = utc_now_iso()
        self.model: Any = None
        self.active_device: str = args.device
        self.active_compute_type: str = args.compute_type

        # Track file size/mtime observations across cycles for --min-stable-seconds.
        # Map: resolved path str -> (size, mtime_ns, first_seen_monotonic)
        self.stability_tracker: dict[str, tuple[int, int, float]] = {}

        # Session performance metrics for ETA and realtime speedup reporting.
        self.session_transcribed_count: int = 0
        self.session_audio_sec: float = 0.0
        self.session_transcribe_sec: float = 0.0
        self.recent_errors: list[dict[str, Any]] = []
        self.course_name: str | None = None

    def ensure_model_loaded(self) -> Any:
        """Lazily load faster-whisper on CUDA (never silently falling back to CPU)."""
        if self.model is not None:
            return self.model

        os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
        dll_dirs = register_windows_cuda_dlls()
        if dll_dirs:
            log(f"Registered {len(dll_dirs)} Windows CUDA DLL directorie(s).")

        import ctranslate2
        from faster_whisper import WhisperModel

        cuda_count = ctranslate2.get_cuda_device_count()
        requested_device = self.args.device
        if requested_device == "cuda":
            if cuda_count < 1:
                raise RuntimeError(
                    "CUDA device requested (--device cuda), but CTranslate2 detected "
                    "0 CUDA devices. Check NVIDIA drivers and nvidia-cublas-cu12 / "
                    "nvidia-cudnn-cu12 installation."
                )
            resolved_device = "cuda"
        elif requested_device == "auto":
            resolved_device = "cuda" if cuda_count > 0 else "cpu"
        else:
            resolved_device = "cpu"

        resolved_compute = self.args.compute_type
        if resolved_device == "cpu" and resolved_compute == "float16":
            resolved_compute = "int8"

        self.active_device = resolved_device
        self.active_compute_type = resolved_compute

        log(
            f"Loading faster-whisper model='{self.args.model}' "
            f"device='{resolved_device}' compute_type='{resolved_compute}' "
            f"(CUDA devices detected: {cuda_count})..."
        )
        t0 = time.monotonic()
        self.model = WhisperModel(
            self.args.model,
            device=resolved_device,
            compute_type=resolved_compute,
            download_root=self.args.download_root,
        )
        load_sec = time.monotonic() - t0
        log(f"Model loaded on {resolved_device} ({resolved_compute}) in {load_sec:.2f}s.")
        return self.model

    def write_state(
        self,
        lessons: list[LessonState],
        state: str,
        current_lesson: LessonState | None = None,
        current_started_at: str | None = None,
    ) -> None:
        """Atomically persist manifest.json and status.json."""
        completed = sum(1 for item in lessons if item.status == "completed")
        pending = sum(1 for item in lessons if item.status in ("pending", "transcribing"))
        downloading = sum(1 for item in lessons if item.status == "downloading")
        failed = sum(1 for item in lessons if item.status == "failed")
        total_duration = round(
            sum(item.duration_sec or 0.0 for item in lessons if item.status == "completed"), 2
        )
        total_words = sum(
            item.word_count or 0 for item in lessons if item.status == "completed"
        )
        remaining_audio = round(
            sum(
                item.duration_sec or 0.0
                for item in lessons
                if item.status in ("pending", "transcribing")
            ),
            2,
        )

        # Compute average realtime speedup from session runs (or persisted metadata).
        avg_speedup: float | None = None
        if self.session_transcribe_sec > 0.0 and self.session_audio_sec > 0.0:
            avg_speedup = round(self.session_audio_sec / self.session_transcribe_sec, 2)
        else:
            speedups = [
                item.realtime_speedup
                for item in lessons
                if item.realtime_speedup and item.realtime_speedup > 0
            ]
            if speedups:
                avg_speedup = round(sum(speedups) / len(speedups), 2)

        eta_sec: float | None = None
        if remaining_audio > 0.0 and avg_speedup and avg_speedup > 0.0:
            eta_sec = round(remaining_audio / avg_speedup, 1)
        elif pending == 0 and downloading == 0:
            eta_sec = 0.0

        now_iso = utc_now_iso()
        manifest_payload: dict[str, Any] = {
            "schemaVersion": SCHEMA_VERSION,
            "courseId": self.course_id,
            "courseName": self.course_name or self.course_id,
            "sourceDir": str(self.source_dir),
            "outputDir": str(self.output_dir),
            "language": self.args.language,
            "model": self.args.model,
            "device": self.active_device,
            "computeType": self.active_compute_type,
            "updatedAt": now_iso,
            "counts": {
                "totalDiscovered": len(lessons),
                "completed": completed,
                "pending": pending,
                "downloading": downloading,
                "failed": failed,
            },
            "totalDurationSec": total_duration,
            "totalWordCount": total_words,
            "lessons": [item.to_manifest_dict() for item in lessons],
        }
        status_payload: dict[str, Any] = {
            "schemaVersion": SCHEMA_VERSION,
            "courseId": self.course_id,
            "state": state,
            "mode": "watch" if self.args.watch else "once",
            "pid": os.getpid(),
            "startedAt": self.started_at_iso,
            "lastUpdatedAt": now_iso,
            "sourceDir": str(self.source_dir),
            "outputDir": str(self.output_dir),
            "model": self.args.model,
            "device": self.active_device,
            "computeType": self.active_compute_type,
            "language": self.args.language,
            "totalDiscovered": len(lessons),
            "completed": completed,
            "pending": pending,
            "downloading": downloading,
            "failed": failed,
            "currentLessonId": current_lesson.lesson_id if current_lesson else None,
            "currentFileName": current_lesson.file_name if current_lesson else None,
            "currentTitle": current_lesson.title if current_lesson else None,
            "currentStartedAt": current_started_at if current_lesson else None,
            "elapsedSec": round(time.monotonic() - self.started_monotonic, 2),
            "sessionTranscribedCount": self.session_transcribed_count,
            "sessionAudioSec": round(self.session_audio_sec, 2),
            "sessionTranscribeSec": round(self.session_transcribe_sec, 2),
            "avgRealtimeSpeedup": avg_speedup,
            "remainingAudioSec": remaining_audio,
            "etaSec": eta_sec,
            "recentErrors": self.recent_errors[-10:],
        }

        atomic_write_json(self.manifest_path, manifest_payload)
        atomic_write_json(self.status_path, status_payload)

    def _scan_lessons(self) -> list[LessonState]:
        """Discover videos, match existing transcripts, verify stability and ffprobe."""
        tg_meta = parse_telegram_result_json(self.source_dir)
        if tg_meta.course_name:
            self.course_name = tg_meta.course_name

        discovered = discover_videos(self.source_dir)
        now_mono = time.monotonic()

        lessons: list[LessonState] = []
        # Indices of lessons that need a stability wait before probing.
        need_stability_wait: list[tuple[LessonState, Path]] = []

        for order, (full_path, rel_path) in enumerate(discovered, start=1):
            rel_posix = rel_path.as_posix()
            file_name = full_path.name
            lesson_id = make_lesson_id(rel_posix)
            title = clean_human_title(file_name)
            tg_entry = tg_meta.lookup(rel_posix, file_name) or {}
            tg_caption = str(tg_entry.get("caption") or "")
            tg_date = tg_entry.get("date") if isinstance(tg_entry.get("date"), str) else None
            thumb = find_thumbnail(full_path)

            try:
                st = full_path.stat()
            except OSError as exc:
                lessons.append(
                    LessonState(
                        lesson_id=lesson_id,
                        order=order,
                        title=title,
                        file_name=file_name,
                        relative_path=rel_posix,
                        file_path=str(full_path.resolve()),
                        file_size=0,
                        file_mtime_ms=0,
                        status="downloading",
                        telegram_caption=tg_caption,
                        telegram_date=tg_date,
                        thumbnail_path=thumb,
                        error=f"stat failed: {exc}",
                    )
                )
                continue

            file_size = int(st.st_size)
            mtime_ms = int(round(st.st_mtime * 1000))
            resolved_str = str(full_path.resolve())

            t_json = self.transcripts_dir / f"{lesson_id}.json"
            t_vtt = self.transcripts_dir / f"{lesson_id}.vtt"
            t_txt = self.transcripts_dir / f"{lesson_id}.txt"

            existing = (
                None
                if self.args.force
                else load_existing_transcript_meta(t_json, t_vtt, t_txt, file_size, mtime_ms)
            )
            if existing is not None:
                # Keep lightweight header metadata (order, caption) synced if updated.
                header_changed = (
                    existing.get("order") != order
                    or (tg_caption and existing.get("telegramCaption") != tg_caption)
                )
                if header_changed:
                    existing["order"] = order
                    if tg_caption:
                        existing["telegramCaption"] = tg_caption
                    try:
                        atomic_write_json(t_json, existing)
                    except OSError:
                        pass

                lessons.append(
                    LessonState(
                        lesson_id=lesson_id,
                        order=order,
                        title=str(existing.get("title") or title),
                        file_name=file_name,
                        relative_path=rel_posix,
                        file_path=resolved_str,
                        file_size=file_size,
                        file_mtime_ms=mtime_ms,
                        status="completed",
                        duration_sec=existing.get("durationSec"),
                        word_count=existing.get("wordCount"),
                        segment_count=len(existing.get("segments") or []),
                        chunk_count=len(existing.get("chunks") or []),
                        language=existing.get("language"),
                        model=existing.get("model"),
                        transcribed_at=existing.get("transcribedAt"),
                        transcription_time_sec=existing.get("transcriptionTimeSec"),
                        realtime_speedup=existing.get("realtimeSpeedup"),
                        telegram_caption=str(existing.get("telegramCaption") or tg_caption),
                        telegram_date=tg_date,
                        thumbnail_path=thumb,
                    )
                )
                continue

            # Not yet transcribed: check minimum size first.
            if file_size <= MIN_FILE_SIZE_BYTES:
                self.stability_tracker.pop(resolved_str, None)
                lessons.append(
                    LessonState(
                        lesson_id=lesson_id,
                        order=order,
                        title=title,
                        file_name=file_name,
                        relative_path=rel_posix,
                        file_path=resolved_str,
                        file_size=file_size,
                        file_mtime_ms=mtime_ms,
                        status="downloading",
                        telegram_caption=tg_caption,
                        telegram_date=tg_date,
                        thumbnail_path=thumb,
                    )
                )
                continue

            # Check stability tracker over --min-stable-seconds.
            lesson = LessonState(
                lesson_id=lesson_id,
                order=order,
                title=title,
                file_name=file_name,
                relative_path=rel_posix,
                file_path=resolved_str,
                file_size=file_size,
                file_mtime_ms=mtime_ms,
                status="pending",
                telegram_caption=tg_caption,
                telegram_date=tg_date,
                thumbnail_path=thumb,
            )
            lessons.append(lesson)

            prev = self.stability_tracker.get(resolved_str)
            if prev is None or prev[0] != file_size or prev[1] != st.st_mtime_ns:
                self.stability_tracker[resolved_str] = (file_size, st.st_mtime_ns, now_mono)
                need_stability_wait.append((lesson, full_path))
            elif (now_mono - prev[2]) < self.args.min_stable_seconds:
                need_stability_wait.append((lesson, full_path))

        # Batch wait once across all newly-observed candidate files so we strictly
        # verify size stability over --min-stable-seconds without sleeping per file.
        if need_stability_wait and self.args.min_stable_seconds > 0:
            max_wait = 0.0
            now_mono = time.monotonic()
            for lesson, _ in need_stability_wait:
                entry = self.stability_tracker.get(lesson.file_path)
                if entry is not None:
                    rem = self.args.min_stable_seconds - (now_mono - entry[2])
                    if rem > max_wait:
                        max_wait = rem
            if max_wait > 0.0:
                log(
                    f"Verifying file size stability for {len(need_stability_wait)} "
                    f"candidate video(s) ({max_wait:.1f}s)..."
                )
                self._interruptible_sleep(max_wait)

            for lesson, full_path in need_stability_wait:
                try:
                    st2 = full_path.stat()
                except OSError:
                    lesson.status = "downloading"
                    continue
                if st2.st_size != lesson.file_size or int(round(st2.st_mtime * 1000)) != lesson.file_mtime_ms:
                    lesson.file_size = int(st2.st_size)
                    lesson.file_mtime_ms = int(round(st2.st_mtime * 1000))
                    self.stability_tracker[lesson.file_path] = (
                        int(st2.st_size),
                        st2.st_mtime_ns,
                        time.monotonic(),
                    )
                    lesson.status = "downloading"

        # Probe all size-stable pending videos via ffprobe before queueing.
        for lesson in lessons:
            if lesson.status != "pending":
                continue
            probe = probe_video_file(Path(lesson.file_path))
            if not probe.ok:
                lesson.status = "downloading"
                lesson.error = probe.reason
                log(f"Skipping incomplete video '{lesson.file_name}': {probe.reason}")
                continue

            # If the video was compressed/remuxed (fileSize/mtime changed) but an existing
            # valid transcript already matches its duration within ±2.0s, sync metadata
            # instead of wasting GPU time re-transcribing the same lesson.
            if not self.args.force:
                t_json = self.transcripts_dir / f"{lesson.lesson_id}.json"
                t_vtt = self.transcripts_dir / f"{lesson.lesson_id}.vtt"
                t_txt = self.transcripts_dir / f"{lesson.lesson_id}.txt"
                matched_by_dur = load_existing_transcript_by_duration(
                    t_json,
                    t_vtt,
                    t_txt,
                    probe.duration_sec,
                    tolerance_sec=DURATION_MATCH_TOLERANCE_SEC,
                )
                if matched_by_dur is not None:
                    matched_by_dur["fileSize"] = lesson.file_size
                    matched_by_dur["fileMtimeMs"] = lesson.file_mtime_ms
                    matched_by_dur["order"] = lesson.order
                    matched_by_dur["fileName"] = lesson.file_name
                    matched_by_dur["relativePath"] = lesson.relative_path
                    matched_by_dur["filePath"] = lesson.file_path
                    if lesson.telegram_caption:
                        matched_by_dur["telegramCaption"] = lesson.telegram_caption
                    try:
                        atomic_write_json(t_json, matched_by_dur)
                    except OSError:
                        pass
                    lesson.status = "completed"
                    lesson.title = str(matched_by_dur.get("title") or lesson.title)
                    lesson.duration_sec = matched_by_dur.get("durationSec") or probe.duration_sec
                    lesson.word_count = matched_by_dur.get("wordCount")
                    lesson.segment_count = len(matched_by_dur.get("segments") or [])
                    lesson.chunk_count = len(matched_by_dur.get("chunks") or [])
                    lesson.language = matched_by_dur.get("language")
                    lesson.model = matched_by_dur.get("model")
                    lesson.transcribed_at = matched_by_dur.get("transcribedAt")
                    lesson.transcription_time_sec = matched_by_dur.get("transcriptionTimeSec")
                    lesson.realtime_speedup = matched_by_dur.get("realtimeSpeedup")
                    lesson.telegram_caption = str(
                        matched_by_dur.get("telegramCaption") or lesson.telegram_caption
                    )
                    lesson.error = None
                    log(
                        f"Synced updated media metadata for '{lesson.title}' "
                        f"(duration {probe.duration_sec:.2f}s matches existing "
                        f"{float(matched_by_dur.get('durationSec') or 0.0):.2f}s); "
                        f"skipping re-transcription."
                    )
                    continue

            lesson.duration_sec = probe.duration_sec
            lesson.error = None

        return lessons

    def _transcribe_lesson(self, lesson: LessonState, all_lessons: list[LessonState]) -> bool:
        """Run faster-whisper on one verified complete video and write outputs."""
        model = self.ensure_model_loaded()

        lesson.status = "transcribing"
        lesson.error = None
        started_iso = utc_now_iso()
        self.write_state(
            all_lessons,
            state="transcribing",
            current_lesson=lesson,
            current_started_at=started_iso,
        )

        dur_label = f"{lesson.duration_sec:.1f}s" if lesson.duration_sec else "unknown duration"
        log(f"Transcribing [{lesson.order}] '{lesson.title}' ({dur_label})...")

        t0 = time.monotonic()
        audio: Any = None
        segments_iter: Any = None
        try:
            effective_prompt = build_effective_initial_prompt(
                self.args.language,
                lesson.title,
                self.args.initial_prompt,
            )

            lang_arg = None if self.args.language.lower() == "auto" else self.args.language

            # Retry once on transient memory/pagefile pressure (e.g. shared GPU on Windows).
            max_attempts = 2
            last_exc: Exception | None = None
            raw_segments: list[dict[str, Any]] = []
            info: Any = None
            for attempt in range(1, max_attempts + 1):
                try:
                    audio = decode_audio_ffmpeg(Path(lesson.file_path))
                    segments_iter, info = model.transcribe(
                        audio,
                        language=lang_arg,
                        initial_prompt=effective_prompt,
                        vad_filter=True,
                        vad_parameters={"min_silence_duration_ms": 500},
                        condition_on_previous_text=True,
                        beam_size=self.args.beam_size,
                    )

                    raw_segments = []
                    for seg in segments_iter:
                        text = (seg.text or "").strip()
                        if not text:
                            continue
                        seg_start = round(float(seg.start), 2)
                        seg_end = round(float(seg.end), 2)
                        raw_segments.append(
                            {
                                "id": len(raw_segments),
                                "start": seg_start,
                                "end": seg_end,
                                "text": text,
                            }
                        )
                    last_exc = None
                    break
                except (MemoryError, OSError) as exc:
                    is_pagefile = isinstance(exc, OSError) and getattr(exc, "winerror", None) == 1455
                    if not (isinstance(exc, MemoryError) or is_pagefile) or attempt >= max_attempts:
                        raise
                    last_exc = exc
                    log(
                        f"Transient memory pressure on '{lesson.file_name}' ({exc}); "
                        f"reclaiming memory and retrying ({attempt}/{max_attempts - 1})..."
                    )
                    audio = None
                    segments_iter = None
                    gc.collect()
                    self._interruptible_sleep(2.0)

            if last_exc is not None:
                raise last_exc

            elapsed = max(0.01, time.monotonic() - t0)
            detected_duration = float(getattr(info, "duration", 0.0) or 0.0)
            duration_sec = round(
                detected_duration if detected_duration > 0 else (lesson.duration_sec or 0.0),
                2,
            )
            detected_lang = str(getattr(info, "language", None) or self.args.language)
            segments = clean_whisper_segments(
                raw_segments,
                language=detected_lang,
                title=lesson.title,
            )
            full_text = " ".join(s["text"] for s in segments).strip()
            word_count = len(full_text.split()) if full_text else 0
            chunks = build_chunks(segments)
            speedup = round(duration_sec / elapsed, 2) if duration_sec > 0 else 0.0
            transcribed_at = utc_now_iso()

            transcript_payload: dict[str, Any] = {
                "schemaVersion": SCHEMA_VERSION,
                "courseId": self.course_id,
                "lessonId": lesson.lesson_id,
                "fileName": lesson.file_name,
                "relativePath": lesson.relative_path,
                "filePath": lesson.file_path,
                "fileSize": lesson.file_size,
                "fileMtimeMs": lesson.file_mtime_ms,
                "title": lesson.title,
                "order": lesson.order,
                "durationSec": duration_sec,
                "language": detected_lang,
                "model": self.args.model,
                "device": self.active_device,
                "computeType": self.active_compute_type,
                "transcribedAt": transcribed_at,
                "transcriptionTimeSec": round(elapsed, 2),
                "realtimeSpeedup": speedup,
                "telegramCaption": lesson.telegram_caption,
                "wordCount": word_count,
                "fullText": full_text,
                "segments": segments,
                "chunks": chunks,
            }

            t_json = self.transcripts_dir / f"{lesson.lesson_id}.json"
            t_vtt = self.transcripts_dir / f"{lesson.lesson_id}.vtt"
            t_txt = self.transcripts_dir / f"{lesson.lesson_id}.txt"

            atomic_write_text(t_vtt, render_vtt(segments))
            atomic_write_text(t_txt, render_txt(segments))
            atomic_write_json(t_json, transcript_payload)

            lesson.status = "completed"
            lesson.duration_sec = duration_sec
            lesson.word_count = word_count
            lesson.segment_count = len(segments)
            lesson.chunk_count = len(chunks)
            lesson.language = detected_lang
            lesson.model = self.args.model
            lesson.transcribed_at = transcribed_at
            lesson.transcription_time_sec = round(elapsed, 2)
            lesson.realtime_speedup = speedup
            lesson.error = None

            self.session_transcribed_count += 1
            self.session_audio_sec += duration_sec
            self.session_transcribe_sec += elapsed

            log(
                f"Done [{lesson.order}] '{lesson.title}': "
                f"{duration_sec:.1f}s audio in {elapsed:.2f}s ({speedup:.1f}x realtime), "
                f"{word_count} words, {len(segments)} segments, {len(chunks)} chunks."
            )
            self.write_state(all_lessons, state="transcribing")
            return True

        except Exception as exc:
            elapsed = time.monotonic() - t0
            err_str = f"{type(exc).__name__}: {exc}"
            lesson.status = "failed"
            lesson.error = err_str
            self.recent_errors.append(
                {
                    "at": utc_now_iso(),
                    "lessonId": lesson.lesson_id,
                    "fileName": lesson.file_name,
                    "error": err_str,
                }
            )
            log(f"FAILED [{lesson.order}] '{lesson.file_name}' after {elapsed:.2f}s: {err_str}")
            self.write_state(all_lessons, state="transcribing")
            return False
        finally:
            audio = None
            segments_iter = None
            gc.collect()

    def _interruptible_sleep(self, seconds: float) -> None:
        end = time.monotonic() + seconds
        while not _STOP_REQUESTED and time.monotonic() < end:
            time.sleep(min(0.25, max(0.0, end - time.monotonic())))

    def run(self) -> int:
        """Execute either --once or --watch transcription loop."""
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.transcripts_dir.mkdir(parents=True, exist_ok=True)

        log(
            f"Starting intensive-transcribe course='{self.course_id}' "
            f"mode={'watch' if self.args.watch else 'once'} "
            f"source='{self.source_dir}' output='{self.output_dir}'"
        )

        lessons: list[LessonState] = []
        self.write_state(lessons, state="starting")

        new_transcriptions_done = 0
        max_videos = self.args.max_videos

        try:
            while not _STOP_REQUESTED:
                lessons = self._scan_lessons()
                pending_lessons = [item for item in lessons if item.status == "pending"]
                downloading_count = sum(1 for item in lessons if item.status == "downloading")
                completed_count = sum(1 for item in lessons if item.status == "completed")

                log(
                    f"Scan complete: {len(lessons)} discovered, {completed_count} completed, "
                    f"{len(pending_lessons)} ready to transcribe, {downloading_count} downloading/incomplete."
                )
                self.write_state(lessons, state="scanning")

                for lesson in pending_lessons:
                    if _STOP_REQUESTED:
                        break
                    if max_videos is not None and new_transcriptions_done >= max_videos:
                        log(f"Reached --max-videos limit ({max_videos}); stopping.")
                        break
                    ok = self._transcribe_lesson(lesson, lessons)
                    if ok:
                        new_transcriptions_done += 1

                if not self.args.watch:
                    break
                if max_videos is not None and new_transcriptions_done >= max_videos:
                    break

                self.write_state(lessons, state="watching")
                self._interruptible_sleep(self.args.poll_seconds)

        except KeyboardInterrupt:
            log("Interrupted by user.")
        except Exception as exc:
            err_str = f"{type(exc).__name__}: {exc}"
            self.recent_errors.append({"at": utc_now_iso(), "error": err_str})
            self.write_state(lessons, state="error")
            log(f"Fatal pipeline error: {err_str}")
            return 1

        final_state = "stopped" if _STOP_REQUESTED else "completed"
        self.write_state(lessons, state=final_state)
        log(
            f"Pipeline finished ({final_state}). "
            f"Session transcribed: {self.session_transcribed_count} video(s), "
            f"audio: {self.session_audio_sec:.1f}s in {self.session_transcribe_sec:.2f}s."
        )
        return 0


def polish_existing_transcripts(output_dir: Path) -> int:
    """Fast offline polish pass over existing transcripts/*.json, .vtt, .txt, and manifest.json.

    Applies conservative PT-BR electronics terminology normalization, hallucination cleanup,
    broadcast-grade 2-line WebVTT formatting, refreshed plain-text transcripts, and atomic
    writes without loading Whisper or decoding audio.
    """
    t0 = time.monotonic()
    resolved_out = output_dir.resolve()
    transcripts_dir = resolved_out / "transcripts"
    manifest_path = resolved_out / "manifest.json"

    if not transcripts_dir.is_dir():
        log(f"Transcripts directory not found: '{transcripts_dir}'")
        return 1

    json_files = sorted(
        p for p in transcripts_dir.glob("*.json") if not p.name.startswith(".")
    )
    if not json_files:
        log(f"No transcript JSON files found in '{transcripts_dir}'.")
        return 0

    log(f"Polishing {len(json_files)} existing transcript(s) in '{transcripts_dir}'...")

    updated_metrics: dict[str, tuple[int, int, int]] = {}
    polished_count = 0
    errors = 0
    total_segs_changed = 0
    total_segs_removed = 0
    total_vtt_cues = 0

    for json_path in json_files:
        if _STOP_REQUESTED:
            log("Stop requested; halting polish pass.")
            break
        try:
            raw = json.loads(json_path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict) or not isinstance(raw.get("segments"), list):
                raise ValueError("Invalid transcript JSON payload (missing segments list)")

            raw_segments: list[dict[str, Any]] = raw["segments"]
            lang = str(raw.get("language") or "pt")
            title = str(raw.get("title") or json_path.stem)
            lesson_id = str(raw.get("lessonId") or json_path.stem)

            polished_segments = clean_whisper_segments(
                raw_segments,
                language=lang,
                title=title,
            )

            # Count modified/removed segments for transparent reporting.
            old_texts = [str(s.get("text") or "").strip() for s in raw_segments if str(s.get("text") or "").strip()]
            new_texts = [s["text"] for s in polished_segments]
            removed_here = max(0, len(old_texts) - len(new_texts))
            changed_here = sum(1 for a, b in zip(old_texts, new_texts) if a != b)
            total_segs_removed += removed_here
            total_segs_changed += changed_here

            full_text = " ".join(s["text"] for s in polished_segments).strip()
            word_count = len(full_text.split()) if full_text else 0
            chunks = build_chunks(polished_segments)

            # Preserve EVERY existing schema field verbatim (fileSize, fileMtimeMs, lessonId,
            # courseId, model, durationSec, etc.) and refresh only text/segments/chunks/wordCount.
            updated_payload = dict(raw)
            updated_payload["segments"] = polished_segments
            updated_payload["chunks"] = chunks
            updated_payload["fullText"] = full_text
            updated_payload["wordCount"] = word_count

            vtt_content = render_vtt(polished_segments)
            txt_content = render_txt(polished_segments)
            vtt_cues = sum(1 for line in vtt_content.splitlines() if " --> " in line)
            total_vtt_cues += vtt_cues

            vtt_path = json_path.with_suffix(".vtt")
            txt_path = json_path.with_suffix(".txt")

            atomic_write_text(vtt_path, vtt_content)
            atomic_write_text(txt_path, txt_content)
            atomic_write_json(json_path, updated_payload)

            updated_metrics[lesson_id] = (word_count, len(polished_segments), len(chunks))
            polished_count += 1
        except Exception as exc:
            errors += 1
            log(f"ERROR polishing '{json_path.name}': {type(exc).__name__}: {exc}")

    # Refresh manifest.json wordCount / segmentCount / chunkCount / totalWordCount
    # while preserving all other fields (fileSize, fileMtimeMs, downloading entries, etc.).
    if manifest_path.is_file() and updated_metrics:
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if isinstance(manifest, dict) and isinstance(manifest.get("lessons"), list):
                manifest_updated = 0
                for entry in manifest["lessons"]:
                    if not isinstance(entry, dict):
                        continue
                    lid = entry.get("lessonId")
                    if isinstance(lid, str) and lid in updated_metrics:
                        wc, sc, cc = updated_metrics[lid]
                        entry["wordCount"] = wc
                        entry["segmentCount"] = sc
                        entry["chunkCount"] = cc
                        manifest_updated += 1
                manifest["totalWordCount"] = sum(
                    int(item.get("wordCount") or 0)
                    for item in manifest["lessons"]
                    if isinstance(item, dict) and item.get("status") == "completed"
                )
                manifest["updatedAt"] = utc_now_iso()
                atomic_write_json(manifest_path, manifest)
                log(
                    f"Updated manifest.json ({manifest_updated} lesson(s), "
                    f"totalWordCount={manifest['totalWordCount']})."
                )
        except Exception as exc:
            errors += 1
            log(f"ERROR updating manifest.json: {type(exc).__name__}: {exc}")

    elapsed = time.monotonic() - t0
    log(
        f"Polish complete in {elapsed:.2f}s: {polished_count}/{len(json_files)} lesson(s) polished, "
        f"{total_segs_changed} segment(s) refined, {total_segs_removed} hallucination segment(s) removed, "
        f"{total_vtt_cues} broadcast WebVTT cue(s) written, {errors} error(s)."
    )
    return 0 if errors == 0 else 1


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Local RTX GPU faster-whisper transcription pipeline for TrilhaAtlas courses."
    )
    parser.add_argument(
        "--course-id",
        default=None,
        help="Stable course slug (e.g. cta-eletronica, lyse-2022). Required unless --polish-existing.",
    )
    parser.add_argument(
        "--source-dir",
        default=None,
        help="Directory containing local course video files. Required unless --polish-existing.",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Output directory under LH_DATA_DIR for manifest.json, status.json, and transcripts/.",
    )
    parser.add_argument(
        "--language",
        default="pt",
        help="Whisper language code (default: pt; pass 'auto' to auto-detect).",
    )
    parser.add_argument(
        "--model",
        default="large-v3-turbo",
        help="faster-whisper model name or local CTranslate2 path (default: large-v3-turbo).",
    )
    parser.add_argument(
        "--device",
        default="cuda",
        choices=("cuda", "cpu", "auto"),
        help="Inference device (default: cuda; fails loudly if CUDA is unavailable).",
    )
    parser.add_argument(
        "--compute-type",
        default="float16",
        help="CTranslate2 compute type (default: float16).",
    )
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--watch",
        action="store_true",
        help="Continuously poll --source-dir for new/completed videos.",
    )
    mode_group.add_argument(
        "--once",
        action="store_true",
        help="Transcribe currently complete videos once and exit (default).",
    )
    mode_group.add_argument(
        "--polish-existing",
        action="store_true",
        help="Offline fast pass: polish existing transcripts/*.json, rebuild broadcast WebVTT/.txt, and refresh manifest.json without loading Whisper.",
    )
    parser.add_argument(
        "--poll-seconds",
        type=float,
        default=15.0,
        help="Polling interval in seconds when --watch is active (default: 15).",
    )
    parser.add_argument(
        "--min-stable-seconds",
        type=float,
        default=5.0,
        help="Seconds a video file size/mtime must remain unchanged before probing (default: 5).",
    )
    parser.add_argument(
        "--max-videos",
        type=int,
        default=None,
        help="Optional cap on new transcriptions in this run (useful for smoke tests).",
    )
    parser.add_argument(
        "--beam-size",
        type=int,
        default=5,
        help="Whisper beam search width (default: 5).",
    )
    parser.add_argument(
        "--initial-prompt",
        default=None,
        help="Optional domain vocabulary prompt overriding the default PT-BR electronics glossary (pass '-' to disable glossary).",
    )
    parser.add_argument(
        "--download-root",
        default=None,
        help="Optional HuggingFace model cache directory override.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-transcribe videos even when a matching transcript already exists.",
    )
    args = parser.parse_args(argv)
    if not args.polish_existing:
        if not args.course_id:
            parser.error("--course-id is required unless --polish-existing is set")
        if not args.source_dir:
            parser.error("--source-dir is required unless --polish-existing is set")
    return args


def _handle_stop_signal(signum: int, _frame: Any) -> None:
    global _STOP_REQUESTED
    _STOP_REQUESTED = True
    log(f"Received signal {signum}; finishing current step and stopping cleanly...")


def main(argv: list[str] | None = None) -> int:
    _configure_stdio()
    signal.signal(signal.SIGINT, _handle_stop_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_stop_signal)

    args = parse_args(argv)
    if args.polish_existing:
        return polish_existing_transcripts(Path(args.output_dir))
    pipeline = TranscriberPipeline(args)
    return pipeline.run()


if __name__ == "__main__":
    raise SystemExit(main())
