#!/usr/bin/env python3
"""Safe deduplication, consolidation, and compression pipeline for TrilhaAtlas courses.

Manages local intensive video course libraries downloaded from Telegram or other
sources while preserving deterministic TrilhaAtlas lesson IDs and existing Whisper
transcripts:

- Safely skips actively downloading / growing / locked video files by enforcing a
  minimum size (> 10 KB), size+mtime stability across --min-stable-seconds, head/tail
  readability checks, and full ffprobe validation (valid video + audio + duration > 0).
- Deduplicates and consolidates one or more --incoming-dir folders into --canonical-dir:
  * Deletes verified duplicates (and sidecar _thumb.jpg) from --incoming-dir.
  * Replaces verified corrupt files in --canonical-dir with valid incoming copies.
  * Atomically moves brand-new completed lessons into --canonical-dir.
  * Performs safe internal deduplication inside --canonical-dir ONLY when both the
    normalized title AND SHA-256 hash are identical (never dropping distinct-titled lessons).
- Compresses uncompressed valid videos in --canonical-dir using a strict
  verify-then-swap workflow (defaulting to visually-lossless AV1 via libsvtav1 CRF 38
  preset 8, proven 100% playable across TrilhaAtlas Electron, Chrome, and Edge, with
  optional hevc_nvenc and h264_nvenc GPU modes).
- Preserves exact filenames (so lessonId never changes) and immediately syncs
  fileSize and fileMtimeMs in manifest.json and transcripts/<lessonId>.json so
  existing Whisper transcripts remain 100% valid with zero re-transcription.

No personal paths are hardcoded; pass --canonical-dir (and optional --incoming-dir
and --transcript-dir) explicitly on the command line.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True

VIDEO_EXTENSIONS = frozenset({".mp4", ".mkv", ".webm", ".mov", ".m4v"})
MIN_FILE_SIZE_BYTES = 10 * 1024  # 10 KB minimum before probing
OPT_TAG_PREFIX = "trilhaatlas-opt-v1"
TMP_COMPRESS_SUFFIX = ".trilha-opt.tmp.mp4"
TMP_MOVE_SUFFIX = ".trilha-move.tmp"
DURATION_MATCH_TOLERANCE_SEC = 2.0
COMPRESS_DURATION_TOLERANCE_SEC = 1.0
CORRUPT_MIN_AGE_SEC = 60.0

# Patterns mirrored from scripts/intensive-transcribe.py for 100% lessonId parity.
_LEADING_NUMBER_RE = re.compile(r"^\s*(\d+)(?:[\s._\-)]|$)")
_LESSON_PREFIX_NUMBER_RE = re.compile(
    r"^\s*(?:aula|lesson|class|epis[oó]dio|ep|cap[ií]tulo|cap|m[oó]dulo|mod|"
    r"parte|pt|v[ií]deo|vid|lecture|lec|bloco|unit|unidade)[\s._#\-]*(\d+)(?=\D|$)",
    re.IGNORECASE,
)
_NATURAL_SPLIT_RE = re.compile(r"(\d+)")
_TRAILING_BRACKET_ID_RE = re.compile(r"\s*\[([A-Za-z0-9_\-]{6,15})\]\s*$")
_TRAILING_UNDERSCORE_TOKEN_RE = re.compile(r"_([A-Za-z0-9\-]{6,15})$")
_TRAILING_UNDERSCORE_YT11_RE = re.compile(r"_([A-Za-z0-9_\-]{11})$")
_SPLIT_KEY_YT11_RE = re.compile(r"_([A-Za-z0-9_\-]{11})_([0-9a-fA-F]{4,8})_(\d{2,4})$")
_SPLIT_KEY_GENERIC_RE = re.compile(r"_([A-Za-z0-9\-]{6,15})_([0-9a-fA-F]{4,8})_(\d{2,4})$")
_REDUNDANT_LEADING_INDEX_RE = re.compile(
    r"^(\d+)[\s._\-]+((?:aula|lesson|epis[oó]dio|cap[ií]tulo|m[oó]dulo|parte)\s+(\d+)\b.*)$",
    re.IGNORECASE,
)
_LESSON_DASH_RE = re.compile(
    r"^((?:aula|lesson|epis[oó]dio|cap[ií]tulo|m[oó]dulo|parte)\s+\d+)\s+(?![\-\u2013\u2014:])(.+)$",
    re.IGNORECASE,
)
_STRIP_LEADING_PREFIX_RE = re.compile(r"^\s*\d+[\s._\-)]+")

_STOP_REQUESTED = False


def _configure_stdio() -> None:
    """Ensure UTF-8 console output on Windows so accented filenames never crash."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 format with millisecond precision."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def log(message: str) -> None:
    """Print a timestamped log line flushed immediately."""
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {message}", flush=True)


def format_bytes(num_bytes: int | float) -> str:
    """Human-readable byte formatter (MB / GB)."""
    abs_b = abs(float(num_bytes))
    sign = "-" if num_bytes < 0 else ""
    if abs_b >= 1024**3:
        return f"{sign}{abs_b / (1024**3):.2f} GB"
    if abs_b >= 1024**2:
        return f"{sign}{abs_b / (1024**2):.2f} MB"
    if abs_b >= 1024:
        return f"{sign}{abs_b / 1024:.1f} KB"
    return f"{sign}{int(abs_b)} B"


def _replace_with_retry(src: Path, dst: Path, attempts: int = 10) -> None:
    """Atomically replace dst with src, retrying briefly on Windows sharing violations."""
    last_err: OSError | None = None
    for idx in range(attempts):
        try:
            os.replace(src, dst)
            return
        except PermissionError as exc:
            last_err = exc
            time.sleep(0.1 * (idx + 1))
    if last_err is not None:
        raise last_err


def atomic_write_json(target: Path, payload: dict[str, Any]) -> None:
    """Atomically write UTF-8 JSON via a sibling temp file + fsync + os.replace."""
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    encoded = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    try:
        with open(tmp_path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(encoded)
            fh.flush()
            os.fsync(fh.fileno())
        _replace_with_retry(tmp_path, target)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def _looks_like_video_id(token: str, require_transitions: int = 2) -> bool:
    """Heuristically identify YouTube / yt-dlp random base64url IDs."""
    if not (6 <= len(token) <= 15):
        return False
    if not all(c.isascii() and (c.isalnum() or c in "_-") for c in token):
        return False
    has_upper = any("A" <= c <= "Z" for c in token)
    has_lower = any("a" <= c <= "z" for c in token)
    has_digit = any("0" <= c <= "9" for c in token)
    if not (has_upper and has_lower):
        return False
    letters = [c for c in token if c.isalpha()]
    transitions = sum(1 for a, b in zip(letters, letters[1:]) if a.isupper() != b.isupper())
    if transitions >= require_transitions:
        return True
    if "_" not in token and has_digit and len(token) >= 8:
        return True
    return False


def clean_human_title(file_name: str) -> str:
    """Mirror scripts/intensive-transcribe.py title cleaning for exact lessonId parity."""
    stem = Path(file_name).stem
    stem = _TRAILING_BRACKET_ID_RE.sub("", stem)

    match = _TRAILING_UNDERSCORE_TOKEN_RE.search(stem)
    if match and _looks_like_video_id(match.group(1)):
        stem = stem[: match.start()]

    title = stem.replace("_", " ")
    title = re.sub(r"\s+", " ", title).strip(" -.")

    dup = _REDUNDANT_LEADING_INDEX_RE.match(title)
    if dup:
        try:
            if int(dup.group(1)) == int(dup.group(3)):
                title = dup.group(2).strip()
        except ValueError:
            pass

    dash_match = _LESSON_DASH_RE.match(title)
    if dash_match:
        title = f"{dash_match.group(1)} - {dash_match.group(2)}"

    title = re.sub(r"\s*-\s*", " - ", title)
    title = re.sub(r"\s+", " ", title).strip()
    return title or Path(file_name).stem


def make_lesson_id(relative_posix_path: str) -> str:
    """Build deterministic URL-safe lessonId matching scripts/intensive-transcribe.py."""
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


def normalize_title_key(file_name: str) -> str:
    """Normalized lowercase ASCII title used to preserve distinct-titled lessons."""
    cleaned = _strip_accents(clean_human_title(file_name)).lower()
    return re.sub(r"[^a-z0-9]+", " ", cleaned).strip()


def extract_canonical_key(file_name: str) -> str:
    """Extract a stable canonical deduplication key from a course video filename.

    Priority order:
    1. Split part key (e.g. ``VAiV1C5NJEQ_ff910_001``) -> ``split:<id>_<hex>_<part>``
    2. YouTube bracket ID (e.g. ``[ByRl7SkjEbo]``) -> ``yt:<id>``
    3. Trailing underscore video ID (e.g. ``_INyU56K1AE4``, ``_yNJ_ylrTFyI``, ``_eQqnKL``)
       -> ``yt:<id>``
    4. Fallback normalized lowercase stem without leading numbering prefix -> ``stem:<text>``
    """
    stem = Path(file_name).stem.strip()

    # 1. Split video chunks: distinguish _001, _002, etc.
    split_m = _SPLIT_KEY_YT11_RE.search(stem)
    if split_m and _looks_like_video_id(split_m.group(1), require_transitions=2):
        return f"split:{split_m.group(1)}_{split_m.group(2).lower()}_{split_m.group(3)}"
    split_g = _SPLIT_KEY_GENERIC_RE.search(stem)
    if split_g and _looks_like_video_id(split_g.group(1), require_transitions=2):
        return f"split:{split_g.group(1)}_{split_g.group(2).lower()}_{split_g.group(3)}"

    # 2. YouTube bracket ID at end of filename.
    br_m = _TRAILING_BRACKET_ID_RE.search(stem)
    if br_m:
        return f"yt:{br_m.group(1)}"

    # 3. Trailing underscore 11-char YouTube ID (may contain an internal underscore).
    yt11_m = _TRAILING_UNDERSCORE_YT11_RE.search(stem)
    if yt11_m and _looks_like_video_id(yt11_m.group(1), require_transitions=2):
        return f"yt:{yt11_m.group(1)}"

    # 4. Trailing underscore 6-15 char ID (handles truncated exports like _eQqnKL).
    us_m = _TRAILING_UNDERSCORE_TOKEN_RE.search(stem)
    if us_m and _looks_like_video_id(us_m.group(1), require_transitions=2):
        return f"yt:{us_m.group(1)}"

    # 5. Normalized lowercase stem without leading numbering prefix.
    norm = _strip_accents(stem).lower()
    norm = _STRIP_LEADING_PREFIX_RE.sub("", norm)
    norm = re.sub(r"[^a-z0-9]+", " ", norm).strip()
    return f"stem:{norm or stem.lower()}"


def _natural_tokens(text: str) -> tuple[tuple[int, int | str], ...]:
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
    stem = Path(name).stem
    norm = _strip_accents(stem).strip()
    lead = _LEADING_NUMBER_RE.match(norm)
    if lead:
        return (0, int(lead.group(1)), _natural_tokens(stem))
    pref = _LESSON_PREFIX_NUMBER_RE.match(norm)
    if pref:
        return (0, int(pref.group(1)), _natural_tokens(stem))
    return (1, 0, _natural_tokens(stem))


def natural_video_sort_key(
    relative_path: Path,
) -> tuple[tuple[int, int, tuple[tuple[int, int | str], ...]], ...]:
    return tuple(_component_sort_key(part) for part in relative_path.parts)


def is_temp_or_hidden_name(name: str) -> bool:
    """Return True for hidden files or temporary artifacts that must never be processed."""
    lower = name.lower()
    if name.startswith("."):
        return True
    if lower.endswith(TMP_COMPRESS_SUFFIX) or lower.endswith(TMP_MOVE_SUFFIX):
        return True
    if lower.endswith(".part") or lower.endswith(".tmp") or lower.endswith(".crdownload"):
        return True
    return False


def discover_videos(root_dir: Path) -> list[tuple[Path, Path]]:
    """Discover all non-temporary video files under root_dir as (full_path, rel_path)."""
    found: list[tuple[Path, Path]] = []
    if not root_dir.exists():
        return found
    for root, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        root_path = Path(root)
        for name in files:
            if is_temp_or_hidden_name(name):
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext not in VIDEO_EXTENSIONS:
                continue
            full_path = root_path / name
            rel_path = full_path.relative_to(root_dir)
            found.append((full_path, rel_path))
    found.sort(key=lambda item: natural_video_sort_key(item[1]))
    return found


def sidecar_thumb_path(video_path: Path) -> Path:
    """Return the Telegram sidecar thumbnail path (<video>_thumb.jpg)."""
    return Path(f"{video_path}_thumb.jpg")


def compute_sha256(file_path: Path, chunk_size: int = 4 * 1024 * 1024) -> str:
    """Stream-hash a file with SHA-256 without loading it into RAM."""
    h = hashlib.sha256()
    with open(file_path, "rb") as fh:
        while True:
            chunk = fh.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


@dataclass
class VideoProbe:
    ok: bool
    duration_sec: float = 0.0
    width: int = 0
    height: int = 0
    video_codec: str = ""
    audio_codec: str = ""
    has_video: bool = False
    has_audio: bool = False
    comment_tag: str = ""
    bitrate_bps: int = 0
    reason: str = ""

    @property
    def is_optimized(self) -> bool:
        return self.comment_tag.startswith(OPT_TAG_PREFIX)


def probe_video_file(video_path: Path) -> VideoProbe:
    """Verify head/tail readability and validate streams/duration via ffprobe."""
    try:
        with open(video_path, "rb") as fh:
            head = fh.read(4096)
            if not head:
                return VideoProbe(ok=False, reason="empty file")
            size = video_path.stat().st_size
            if size <= MIN_FILE_SIZE_BYTES:
                return VideoProbe(ok=False, reason=f"file too small ({size} bytes)")
            if size > 4096:
                fh.seek(max(0, size - 4096))
                _ = fh.read(4096)
    except OSError as exc:
        return VideoProbe(ok=False, reason=f"unreadable/locked: {exc}")

    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration,bit_rate:format_tags=comment:stream=codec_type,codec_name,width,height",
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
            timeout=25,
            check=False,
        )
    except FileNotFoundError:
        return VideoProbe(ok=False, reason="ffprobe not found in PATH")
    except subprocess.TimeoutExpired:
        return VideoProbe(ok=False, reason="ffprobe timed out")
    except OSError as exc:
        return VideoProbe(ok=False, reason=f"ffprobe error: {exc}")

    if proc.returncode != 0:
        err_lines = (proc.stderr or "").strip().splitlines()
        summary = err_lines[0] if err_lines else f"exit code {proc.returncode}"
        return VideoProbe(ok=False, reason=f"ffprobe failed: {summary}")

    try:
        info = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return VideoProbe(ok=False, reason="ffprobe returned invalid JSON")

    streams = info.get("streams") or []
    v_stream = next(
        (
            s
            for s in streams
            if isinstance(s, dict)
            and s.get("codec_type") == "video"
            and int(s.get("width") or 0) > 0
            and int(s.get("height") or 0) > 0
        ),
        None,
    )
    a_stream = next(
        (s for s in streams if isinstance(s, dict) and s.get("codec_type") == "audio"),
        None,
    )

    if v_stream is None:
        return VideoProbe(ok=False, reason="no valid video stream found")
    if a_stream is None:
        return VideoProbe(ok=False, reason="no audio stream found")

    fmt = info.get("format") or {}
    try:
        duration = float(fmt.get("duration") or 0.0)
    except (TypeError, ValueError):
        duration = 0.0
    if duration <= 0.0:
        return VideoProbe(ok=False, reason="invalid or zero duration")

    try:
        bitrate = int(fmt.get("bit_rate") or 0)
    except (TypeError, ValueError):
        bitrate = 0

    tags = fmt.get("tags") or {}
    comment = ""
    if isinstance(tags, dict):
        for k, v in tags.items():
            if isinstance(k, str) and k.lower() == "comment" and isinstance(v, str):
                comment = v.strip()
                break

    return VideoProbe(
        ok=True,
        duration_sec=round(duration, 3),
        width=int(v_stream.get("width") or 0),
        height=int(v_stream.get("height") or 0),
        video_codec=str(v_stream.get("codec_name") or ""),
        audio_codec=str(a_stream.get("codec_name") or ""),
        has_video=True,
        has_audio=True,
        comment_tag=comment,
        bitrate_bps=bitrate,
    )


def move_file_atomically(src: Path, dst: Path) -> None:
    """Move src to dst atomically (instant os.replace on same volume; safe copy+swap across volumes)."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        _replace_with_retry(src, dst)
        return
    except OSError:
        # Cross-volume fallback: copy into sibling temp file, fsync, atomic replace, then unlink src.
        pass

    tmp_dst = dst.with_name(f".{dst.name}.{os.getpid()}{TMP_MOVE_SUFFIX}")
    src_size = src.stat().st_size
    try:
        shutil.copy2(src, tmp_dst)
        if tmp_dst.stat().st_size != src_size:
            raise RuntimeError(f"cross-volume copy size mismatch for '{src.name}'")
        _replace_with_retry(tmp_dst, dst)
    except Exception:
        try:
            tmp_dst.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    src.unlink(missing_ok=True)


@dataclass
class ScannedVideo:
    full_path: Path
    rel_path: Path
    rel_posix: str
    file_name: str
    size: int
    mtime_ns: int
    mtime_ms: int
    age_sec: float
    canonical_key: str
    title_key: str
    stable: bool = False
    probe: VideoProbe | None = None


@dataclass
class RunStats:
    duplicates_deleted: int = 0
    duplicates_bytes_reclaimed: int = 0
    corrupt_replaced: int = 0
    corrupt_removed: int = 0
    corrupt_bytes_reclaimed: int = 0
    new_moved: int = 0
    new_bytes_moved: int = 0
    internal_dups_deleted: int = 0
    internal_dups_bytes_reclaimed: int = 0
    compressed_count: int = 0
    compressed_bytes_before: int = 0
    compressed_bytes_after: int = 0
    compressed_encode_sec: float = 0.0
    compressed_audio_sec: float = 0.0
    skipped_already_opt: int = 0
    skipped_no_savings: int = 0
    skipped_downloading: int = 0
    transcripts_synced: int = 0
    errors: list[str] = field(default_factory=list)


class CompressionLog:
    """Persistent idempotency ledger tracking optimized & non-compressible videos."""

    def __init__(self, log_path: Path) -> None:
        self.log_path = log_path
        self.data: dict[str, Any] = {"schemaVersion": 1, "updatedAt": utc_now_iso(), "entries": {}}
        self._load()

    def _load(self) -> None:
        if not self.log_path.is_file():
            return
        try:
            raw = json.loads(self.log_path.read_text(encoding="utf-8"))
            if isinstance(raw, dict) and isinstance(raw.get("entries"), dict):
                self.data = raw
        except (OSError, json.JSONDecodeError):
            pass

    def save(self) -> None:
        self.data["updatedAt"] = utc_now_iso()
        atomic_write_json(self.log_path, self.data)

    def get(self, rel_posix: str) -> dict[str, Any] | None:
        entry = self.data.get("entries", {}).get(rel_posix)
        return entry if isinstance(entry, dict) else None

    def is_already_handled(
        self,
        rel_posix: str,
        file_size: int,
        file_mtime_ms: int,
        codec: str,
        quality: int,
        preset: str,
    ) -> str | None:
        """Return previous status ('compressed' or 'skipped_no_savings') if unchanged."""
        entry = self.get(rel_posix)
        if not entry:
            return None
        if entry.get("fileSize") != file_size:
            return None
        prev_mtime = entry.get("fileMtimeMs")
        if not isinstance(prev_mtime, int) or abs(prev_mtime - file_mtime_ms) > 1000:
            return None
        status = entry.get("status")
        if status == "compressed":
            return "compressed"
        if (
            status == "skipped_no_savings"
            and entry.get("codec") == codec
            and entry.get("quality") == quality
            and str(entry.get("preset")) == str(preset)
        ):
            return "skipped_no_savings"
        return None

    def record(self, rel_posix: str, payload: dict[str, Any]) -> None:
        self.data.setdefault("entries", {})[rel_posix] = payload
        self.save()


def sync_transcript_metadata(
    transcript_dir: Path | None,
    rel_posix: str,
    file_name: str,
    new_size: int,
    new_mtime_ms: int,
    dry_run: bool = False,
) -> bool:
    """Sync fileSize and fileMtimeMs in manifest.json and transcripts/<lessonId>.json.

    Keeps existing Whisper transcripts 100% valid after in-place video optimization
    so scripts/intensive-transcribe.py never re-transcribes already completed lessons.
    """
    if transcript_dir is None or not transcript_dir.exists():
        return False

    lesson_id = make_lesson_id(rel_posix)
    norm_rel = unicodedata.normalize("NFC", rel_posix).casefold()
    norm_name = unicodedata.normalize("NFC", file_name).casefold()
    synced_any = False

    # 1. Update manifest.json if present and find matching lessonId(s).
    matched_lesson_ids: set[str] = {lesson_id}
    manifest_path = transcript_dir / "manifest.json"
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            log(f"WARNING: Could not parse manifest.json for sync: {exc}")
            manifest = None

        if isinstance(manifest, dict) and isinstance(manifest.get("lessons"), list):
            changed = False
            for item in manifest["lessons"]:
                if not isinstance(item, dict):
                    continue
                item_id = str(item.get("lessonId") or "")
                item_rel = unicodedata.normalize(
                    "NFC", str(item.get("relativePath") or "").replace("\\", "/")
                ).casefold()
                item_name = unicodedata.normalize(
                    "NFC", str(item.get("fileName") or "")
                ).casefold()
                if item_id == lesson_id or item_rel == norm_rel or item_name == norm_name:
                    if item_id:
                        matched_lesson_ids.add(item_id)
                    if item.get("fileSize") != new_size or item.get("fileMtimeMs") != new_mtime_ms:
                        item["fileSize"] = new_size
                        item["fileMtimeMs"] = new_mtime_ms
                        changed = True
            if changed:
                manifest["updatedAt"] = utc_now_iso()
                if not dry_run:
                    atomic_write_json(manifest_path, manifest)
                synced_any = True

    # 2. Update matching transcripts/<lessonId>.json file(s).
    transcripts_dir = transcript_dir / "transcripts"
    if transcripts_dir.is_dir():
        for lid in sorted(matched_lesson_ids):
            t_json = transcripts_dir / f"{lid}.json"
            if not t_json.is_file():
                continue
            try:
                doc = json.loads(t_json.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                log(f"WARNING: Could not parse transcript '{t_json.name}' for sync: {exc}")
                continue
            if not isinstance(doc, dict):
                continue
            if doc.get("fileSize") != new_size or doc.get("fileMtimeMs") != new_mtime_ms:
                doc["fileSize"] = new_size
                doc["fileMtimeMs"] = new_mtime_ms
                if not dry_run:
                    atomic_write_json(t_json, doc)
                synced_any = True

    return synced_any


def _parse_ffmpeg_out_time_sec(value: str) -> float | None:
    """Parse ffmpeg -progress out_time_us / out_time_ms / out_time into seconds."""
    value = value.strip()
    if not value or value.upper() == "N/A":
        return None
    try:
        return int(value) / 1_000_000.0
    except ValueError:
        return None


class MediaPipeline:
    """Resumable deduplication, consolidation, and visually-lossless compression coordinator."""

    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.canonical_dir: Path = Path(args.canonical_dir).resolve()
        self.transcript_dir: Path | None = (
            Path(args.transcript_dir).resolve() if args.transcript_dir else None
        )

        # Deduplicate and filter incoming dirs so canonical_dir is never treated as incoming.
        canon_norm = os.path.normcase(str(self.canonical_dir))
        seen_inc: set[str] = {canon_norm}
        self.incoming_dirs: list[Path] = []
        for raw in args.incoming_dir or []:
            inc = Path(raw).resolve()
            norm = os.path.normcase(str(inc))
            if norm in seen_inc:
                if norm == canon_norm:
                    log(f"WARNING: Ignoring --incoming-dir identical to --canonical-dir: {inc}")
                continue
            seen_inc.add(norm)
            self.incoming_dirs.append(inc)

        # Resolve codec defaults.
        self.codec: str = args.codec
        if self.codec == "libsvtav1":
            self.quality: int = args.crf if args.crf is not None else 38
            self.preset: str = str(args.preset) if args.preset is not None else "8"
        elif self.codec == "hevc_nvenc":
            self.quality = args.cq if args.cq is not None else 34
            self.preset = str(args.preset) if args.preset is not None else "p5"
        else:  # h264_nvenc
            self.quality = args.cq if args.cq is not None else 28
            self.preset = str(args.preset) if args.preset is not None else "p5"

        self.audio_bitrate: str = args.audio_bitrate

        log_path = (
            self.transcript_dir / "compression-log.json"
            if self.transcript_dir is not None
            else self.canonical_dir / ".trilhaatlas-compression-log.json"
        )
        self.compression_log = CompressionLog(log_path)

        # Stability tracker across poll cycles: resolved path str -> (size, mtime_ns, first_seen_mono)
        self.stability_tracker: dict[str, tuple[int, int, float]] = {}

    def _interruptible_sleep(self, seconds: float) -> None:
        end = time.monotonic() + max(0.0, seconds)
        while not _STOP_REQUESTED and time.monotonic() < end:
            time.sleep(min(0.25, max(0.0, end - time.monotonic())))

    def _scan_and_verify_stability(
        self,
        root_dir: Path,
        *,
        probe_all: bool = True,
    ) -> list[ScannedVideo]:
        """Discover videos under root_dir, batch-verify stability, and ffprobe stable files."""
        discovered = discover_videos(root_dir)
        now_mono = time.monotonic()
        now_wall = time.time()

        items: list[ScannedVideo] = []
        need_wait: list[ScannedVideo] = []

        for full_path, rel_path in discovered:
            try:
                st = full_path.stat()
            except OSError:
                continue
            size = int(st.st_size)
            mtime_ns = int(st.st_mtime_ns)
            mtime_ms = int(round(st.st_mtime * 1000))
            age_sec = max(0.0, now_wall - st.st_mtime)
            rel_posix = rel_path.as_posix()

            item = ScannedVideo(
                full_path=full_path,
                rel_path=rel_path,
                rel_posix=rel_posix,
                file_name=full_path.name,
                size=size,
                mtime_ns=mtime_ns,
                mtime_ms=mtime_ms,
                age_sec=age_sec,
                canonical_key=extract_canonical_key(full_path.name),
                title_key=normalize_title_key(full_path.name),
                stable=False,
            )
            items.append(item)

            resolved_str = str(full_path.resolve())
            if size <= MIN_FILE_SIZE_BYTES:
                self.stability_tracker.pop(resolved_str, None)
                continue

            prev = self.stability_tracker.get(resolved_str)
            if prev is None or prev[0] != size or prev[1] != mtime_ns:
                self.stability_tracker[resolved_str] = (size, mtime_ns, now_mono)
                need_wait.append(item)
            elif (now_mono - prev[2]) < self.args.min_stable_seconds:
                need_wait.append(item)
            else:
                item.stable = True

        # Batch wait once across newly observed files so we never touch active downloads.
        if need_wait and self.args.min_stable_seconds > 0:
            max_wait = 0.0
            now_mono = time.monotonic()
            for item in need_wait:
                entry = self.stability_tracker.get(str(item.full_path.resolve()))
                if entry is not None:
                    rem = self.args.min_stable_seconds - (now_mono - entry[2])
                    if rem > max_wait:
                        max_wait = rem
            if max_wait > 0.0:
                log(
                    f"Checking size/mtime stability for {len(need_wait)} file(s) "
                    f"in '{root_dir.name}' ({max_wait:.1f}s)..."
                )
                self._interruptible_sleep(max_wait)
                if _STOP_REQUESTED:
                    return items

            for item in need_wait:
                resolved_str = str(item.full_path.resolve())
                try:
                    st2 = item.full_path.stat()
                except OSError:
                    item.stable = False
                    continue
                if int(st2.st_size) == item.size and int(st2.st_mtime_ns) == item.mtime_ns:
                    item.stable = True
                else:
                    item.size = int(st2.st_size)
                    item.mtime_ns = int(st2.st_mtime_ns)
                    item.mtime_ms = int(round(st2.st_mtime * 1000))
                    self.stability_tracker[resolved_str] = (
                        item.size,
                        item.mtime_ns,
                        time.monotonic(),
                    )
                    item.stable = False
        elif need_wait:
            for item in need_wait:
                item.stable = True

        if probe_all:
            for item in items:
                if _STOP_REQUESTED:
                    break
                if not item.stable:
                    continue
                item.probe = probe_video_file(item.full_path)

        return items

    def _delete_video_and_thumb(self, video_path: Path, dry_run: bool) -> int:
        """Delete a video file and its optional _thumb.jpg sidecar; return bytes reclaimed."""
        reclaimed = 0
        try:
            reclaimed += int(video_path.stat().st_size)
        except OSError:
            pass
        thumb = sidecar_thumb_path(video_path)
        thumb_exists = thumb.is_file()
        if thumb_exists:
            try:
                reclaimed += int(thumb.stat().st_size)
            except OSError:
                pass

        if not dry_run:
            video_path.unlink(missing_ok=True)
            if thumb_exists:
                thumb.unlink(missing_ok=True)
        return reclaimed

    def _remove_corrupt_in_canonical(self, canonical_items: list[ScannedVideo], stats: RunStats) -> None:
        """Safely remove proven-corrupt, stale, unreadable video files from canonical_dir."""
        min_age = max(CORRUPT_MIN_AGE_SEC, self.args.min_stable_seconds * 2.0)
        kept: list[ScannedVideo] = []
        for item in canonical_items:
            if not item.stable or item.probe is None or item.probe.ok:
                kept.append(item)
                continue
            if item.age_sec < min_age:
                log(
                    f"Skipping recent unreadable file in canonical (age {item.age_sec:.0f}s < "
                    f"{min_age:.0f}s): '{item.file_name}' ({item.probe.reason})"
                )
                kept.append(item)
                continue

            # Double-check readability and re-stat right before deleting to guarantee not growing.
            try:
                st_recheck = item.full_path.stat()
            except OSError:
                continue
            if int(st_recheck.st_size) != item.size or int(st_recheck.st_mtime_ns) != item.mtime_ns:
                log(f"Skipping changed file during corrupt recheck: '{item.file_name}'")
                kept.append(item)
                continue

            reprobe = probe_video_file(item.full_path)
            if reprobe.ok:
                item.probe = reprobe
                kept.append(item)
                continue

            action = "[DRY-RUN] Would remove" if self.args.dry_run else "Removing"
            reclaimed = self._delete_video_and_thumb(item.full_path, self.args.dry_run)
            stats.corrupt_removed += 1
            stats.corrupt_bytes_reclaimed += reclaimed
            log(
                f"{action} proven-corrupt file '{item.file_name}' "
                f"({format_bytes(reclaimed)}, reason: {reprobe.reason})"
            )

        canonical_items[:] = kept

    def _run_dedup(self, stats: RunStats) -> None:
        """Deduplicate incoming directories into canonical_dir and check safe internal duplicates."""
        self.canonical_dir.mkdir(parents=True, exist_ok=True)
        canonical_items = self._scan_and_verify_stability(self.canonical_dir, probe_all=True)

        if self.args.remove_corrupt:
            self._remove_corrupt_in_canonical(canonical_items, stats)

        # Build lookup indices for canonical_dir.
        by_name: dict[str, list[ScannedVideo]] = {}
        by_key: dict[str, list[ScannedVideo]] = {}

        def index_canonical(item: ScannedVideo) -> None:
            by_name.setdefault(item.file_name.casefold(), []).append(item)
            by_key.setdefault(item.canonical_key, []).append(item)

        for item in canonical_items:
            index_canonical(item)

        # Process each --incoming-dir safely.
        for inc_dir in self.incoming_dirs:
            if _STOP_REQUESTED:
                break
            if not inc_dir.exists():
                log(f"Incoming directory does not exist (skipping): {inc_dir}")
                continue

            inc_items = self._scan_and_verify_stability(inc_dir, probe_all=True)
            for inc in inc_items:
                if _STOP_REQUESTED:
                    break
                if not inc.stable:
                    stats.skipped_downloading += 1
                    log(
                        f"Skipping active/unstable incoming download: '{inc.file_name}' "
                        f"({format_bytes(inc.size)})"
                    )
                    continue
                if inc.probe is None or not inc.probe.ok:
                    stats.skipped_downloading += 1
                    reason = inc.probe.reason if inc.probe else "not probed"
                    log(
                        f"Skipping incomplete/invalid incoming file: '{inc.file_name}' "
                        f"({format_bytes(inc.size)}, {reason})"
                    )
                    continue

                # Gather candidate matches in canonical_dir (exact filename first, then canonical key).
                candidates: list[ScannedVideo] = []
                seen_paths: set[str] = set()
                for group in (by_name.get(inc.file_name.casefold(), []), by_key.get(inc.canonical_key, [])):
                    for c in group:
                        key_p = str(c.full_path)
                        if key_p not in seen_paths:
                            seen_paths.add(key_p)
                            candidates.append(c)

                valid_match = next(
                    (
                        c
                        for c in candidates
                        if c.stable
                        and c.probe is not None
                        and c.probe.ok
                        and abs(c.probe.duration_sec - inc.probe.duration_sec)
                        <= DURATION_MATCH_TOLERANCE_SEC
                    ),
                    None,
                )
                corrupt_match = next(
                    (
                        c
                        for c in candidates
                        if c.stable and c.probe is not None and not c.probe.ok
                    ),
                    None,
                )

                if valid_match is not None:
                    # Canonical already has a valid copy with matching duration -> delete duplicate!
                    action = "[DRY-RUN] Would delete" if self.args.dry_run else "Deleted"
                    reclaimed = self._delete_video_and_thumb(inc.full_path, self.args.dry_run)
                    stats.duplicates_deleted += 1
                    stats.duplicates_bytes_reclaimed += reclaimed
                    log(
                        f"{action} duplicate from '{inc_dir.parent.name}/{inc_dir.name}': "
                        f"'{inc.file_name}' ({format_bytes(reclaimed)}, key={inc.canonical_key}, "
                        f"matched canonical '{valid_match.file_name}', "
                        f"dur={inc.probe.duration_sec:.1f}s vs {valid_match.probe.duration_sec:.1f}s)"
                    )
                    continue

                if corrupt_match is not None:
                    # Replace corrupt canonical file with valid incoming video.
                    dst_video = corrupt_match.full_path
                    action = "[DRY-RUN] Would replace" if self.args.dry_run else "Replaced"
                    inc_thumb = sidecar_thumb_path(inc.full_path)
                    dst_thumb = sidecar_thumb_path(dst_video)
                    if not self.args.dry_run:
                        move_file_atomically(inc.full_path, dst_video)
                        if inc_thumb.is_file():
                            move_file_atomically(inc_thumb, dst_thumb)
                        st_new = dst_video.stat()
                        corrupt_match.size = int(st_new.st_size)
                        corrupt_match.mtime_ns = int(st_new.st_mtime_ns)
                        corrupt_match.mtime_ms = int(round(st_new.st_mtime * 1000))
                        corrupt_match.probe = inc.probe
                        sync_transcript_metadata(
                            self.transcript_dir,
                            corrupt_match.rel_posix,
                            corrupt_match.file_name,
                            corrupt_match.size,
                            corrupt_match.mtime_ms,
                            dry_run=False,
                        )
                    else:
                        corrupt_match.probe = inc.probe
                    stats.corrupt_replaced += 1
                    log(
                        f"{action} corrupt canonical '{dst_video.name}' with valid incoming "
                        f"'{inc.file_name}' ({format_bytes(inc.size)}, dur={inc.probe.duration_sec:.1f}s)"
                    )
                    continue

                # Brand-new lesson: move atomically into canonical_dir!
                dst_video = self.canonical_dir / inc.rel_path
                if dst_video.exists():
                    # Same path appeared concurrently or duration mismatched a valid file -> do not overwrite!
                    log(
                        f"WARNING: Destination already exists with different duration; "
                        f"skipping move for '{inc.file_name}' to avoid overwrite."
                    )
                    continue

                inc_thumb = sidecar_thumb_path(inc.full_path)
                dst_thumb = sidecar_thumb_path(dst_video)
                action = "[DRY-RUN] Would move" if self.args.dry_run else "Moved"
                if not self.args.dry_run:
                    move_file_atomically(inc.full_path, dst_video)
                    if inc_thumb.is_file() and not dst_thumb.exists():
                        move_file_atomically(inc_thumb, dst_thumb)
                    st_moved = dst_video.stat()
                    new_item = ScannedVideo(
                        full_path=dst_video,
                        rel_path=inc.rel_path,
                        rel_posix=inc.rel_posix,
                        file_name=dst_video.name,
                        size=int(st_moved.st_size),
                        mtime_ns=int(st_moved.st_mtime_ns),
                        mtime_ms=int(round(st_moved.st_mtime * 1000)),
                        age_sec=0.0,
                        canonical_key=inc.canonical_key,
                        title_key=inc.title_key,
                        stable=True,
                        probe=inc.probe,
                    )
                else:
                    new_item = ScannedVideo(
                        full_path=dst_video,
                        rel_path=inc.rel_path,
                        rel_posix=inc.rel_posix,
                        file_name=dst_video.name,
                        size=inc.size,
                        mtime_ns=inc.mtime_ns,
                        mtime_ms=inc.mtime_ms,
                        age_sec=0.0,
                        canonical_key=inc.canonical_key,
                        title_key=inc.title_key,
                        stable=True,
                        probe=inc.probe,
                    )
                canonical_items.append(new_item)
                index_canonical(new_item)
                stats.new_moved += 1
                stats.new_bytes_moved += inc.size
                log(
                    f"{action} brand-new lesson into canonical: '{inc.file_name}' "
                    f"({format_bytes(inc.size)}, key={inc.canonical_key}, dur={inc.probe.duration_sec:.1f}s)"
                )

        # Safe internal deduplication inside canonical_dir:
        # ONLY remove internal duplicates when BOTH normalized title AND SHA-256 hash match!
        valid_canon = [c for c in canonical_items if c.stable and c.probe and c.probe.ok]
        by_canon_key: dict[str, list[ScannedVideo]] = {}
        for c in valid_canon:
            by_canon_key.setdefault(c.canonical_key, []).append(c)

        for key, group in sorted(by_canon_key.items()):
            if len(group) < 2:
                continue
            by_title: dict[str, list[ScannedVideo]] = {}
            for c in group:
                by_title.setdefault(c.title_key, []).append(c)

            if len(by_title) > 1:
                names = ", ".join(f"'{c.file_name}'" for c in group)
                log(
                    f"Keeping {len(group)} distinct-titled lessons sharing key {key}: {names}"
                )

            for title_k, same_title_items in by_title.items():
                if len(same_title_items) < 2:
                    continue
                # Group by exact byte size first, then SHA-256 to confirm byte-for-byte identity.
                by_size: dict[int, list[ScannedVideo]] = {}
                for c in same_title_items:
                    by_size.setdefault(c.size, []).append(c)
                for _sz, same_sz_items in by_size.items():
                    if len(same_sz_items) < 2:
                        continue
                    by_hash: dict[str, list[ScannedVideo]] = {}
                    for c in same_sz_items:
                        try:
                            digest = compute_sha256(c.full_path)
                        except OSError:
                            continue
                        by_hash.setdefault(digest, []).append(c)
                    for digest, exact_dups in by_hash.items():
                        if len(exact_dups) < 2:
                            continue
                        # Keep optimized or shortest relative path first.
                        exact_dups.sort(
                            key=lambda x: (
                                0 if (x.probe and x.probe.is_optimized) else 1,
                                len(x.rel_posix),
                                x.rel_posix,
                            )
                        )
                        keeper = exact_dups[0]
                        for dup in exact_dups[1:]:
                            action = "[DRY-RUN] Would remove" if self.args.dry_run else "Removed"
                            reclaimed = self._delete_video_and_thumb(dup.full_path, self.args.dry_run)
                            stats.internal_dups_deleted += 1
                            stats.internal_dups_bytes_reclaimed += reclaimed
                            log(
                                f"{action} exact internal duplicate '{dup.file_name}' "
                                f"(same title '{title_k}' + sha256={digest[:12]}, "
                                f"keeping '{keeper.file_name}', reclaimed {format_bytes(reclaimed)})"
                            )

    def _build_ffmpeg_compress_cmd(
        self,
        src: Path,
        tmp_dst: Path,
        probe: VideoProbe,
    ) -> list[str]:
        """Build verified classroom ffmpeg compression command for the selected codec."""
        comment = f"{OPT_TAG_PREFIX};codec={self.codec};q={self.quality};p={self.preset}"
        cmd = [
            "ffmpeg",
            "-y",
            "-nostdin",
            "-v",
            "error",
            "-progress",
            "pipe:1",
            "-nostats",
            "-i",
            str(src),
            "-map",
            "0:v:0",
            "-map",
            "0:a:0",
        ]

        # Preserve exact resolution unless an odd pixel dimension requires even rounding for yuv420p.
        if (probe.width % 2 != 0) or (probe.height % 2 != 0):
            cmd.extend(["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"])

        if self.codec == "libsvtav1":
            cmd.extend(
                [
                    "-c:v",
                    "libsvtav1",
                    "-crf",
                    str(self.quality),
                    "-preset",
                    self.preset,
                    "-g",
                    "240",
                    "-pix_fmt",
                    "yuv420p",
                ]
            )
        elif self.codec == "hevc_nvenc":
            cmd.extend(
                [
                    "-c:v",
                    "hevc_nvenc",
                    "-preset",
                    self.preset,
                    "-tune",
                    "hq",
                    "-rc",
                    "vbr",
                    "-cq",
                    str(self.quality),
                    "-b:v",
                    "0",
                    "-bf",
                    "3",
                    "-b_ref_mode",
                    "middle",
                    "-spatial-aq",
                    "1",
                    "-temporal-aq",
                    "1",
                    "-rc-lookahead",
                    "24",
                    "-g",
                    "240",
                    "-pix_fmt",
                    "yuv420p",
                    "-tag:v",
                    "hvc1",
                ]
            )
        else:  # h264_nvenc
            cmd.extend(
                [
                    "-c:v",
                    "h264_nvenc",
                    "-preset",
                    self.preset,
                    "-tune",
                    "hq",
                    "-rc",
                    "vbr",
                    "-cq",
                    str(self.quality),
                    "-b:v",
                    "0",
                    "-spatial-aq",
                    "1",
                    "-temporal-aq",
                    "1",
                    "-rc-lookahead",
                    "24",
                    "-g",
                    "240",
                    "-pix_fmt",
                    "yuv420p",
                ]
            )

        cmd.extend(
            [
                "-c:a",
                "aac",
                "-b:a",
                self.audio_bitrate,
                "-ac",
                "1",
                "-movflags",
                "+faststart",
                "-metadata",
                f"comment={comment}",
                str(tmp_dst),
            ]
        )
        return cmd

    def _compress_one(self, item: ScannedVideo, stats: RunStats) -> bool:
        """Compress one verified video using strict verify-then-swap and transcript sync."""
        assert item.probe is not None and item.probe.ok
        old_size = item.size
        old_mtime_ns = item.mtime_ns
        old_dur = item.probe.duration_sec
        old_kbps = (old_size * 8.0) / (old_dur * 1000.0) if old_dur > 0 else 0.0

        tmp_path = item.full_path.with_name(f"{item.full_path.stem}{TMP_COMPRESS_SUFFIX}")

        if self.args.dry_run:
            log(
                f"[DRY-RUN] Would compress '{item.file_name}' "
                f"({format_bytes(old_size)}, {item.probe.width}x{item.probe.height} "
                f"{item.probe.video_codec} {old_kbps:.0f} kbps, dur={old_dur:.1f}s) "
                f"via {self.codec} q={self.quality} p={self.preset}"
            )
            return True

        # Clean up any leftover temp file from an interrupted prior run.
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass

        log(
            f"Compressing '{item.file_name}' ({format_bytes(old_size)}, "
            f"{item.probe.width}x{item.probe.height} {item.probe.video_codec} "
            f"{old_kbps:.0f} kbps, {old_dur:.1f}s) -> {self.codec} q={self.quality} p={self.preset}..."
        )

        cmd = self._build_ffmpeg_compress_cmd(item.full_path, tmp_path, item.probe)
        t0 = time.monotonic()
        proc: subprocess.Popen[str] | None = None
        last_progress_log = t0
        try:
            popen_kwargs: dict[str, Any] = {
                "stdin": subprocess.DEVNULL,
                "stdout": subprocess.PIPE,
                "stderr": subprocess.PIPE,
                "text": True,
                "encoding": "utf-8",
                "errors": "replace",
            }
            if os.name == "nt":
                popen_kwargs["creationflags"] = getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0x00004000)
            proc = subprocess.Popen(cmd, **popen_kwargs)
            assert proc.stdout is not None
            for line in proc.stdout:
                if _STOP_REQUESTED:
                    proc.terminate()
                    break
                if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
                    now_m = time.monotonic()
                    if now_m - last_progress_log >= 30.0:
                        out_sec = _parse_ffmpeg_out_time_sec(line.split("=", 1)[1])
                        if out_sec is not None and old_dur > 0:
                            pct = min(99.9, (out_sec / old_dur) * 100.0)
                            elapsed_so_far = max(0.01, now_m - t0)
                            spd = out_sec / elapsed_so_far
                            eta = max(0.0, (old_dur - out_sec) / spd) if spd > 0 else 0.0
                            log(
                                f"  progress '{item.file_name}': {pct:.1f}% "
                                f"({spd:.2f}x realtime, ETA {eta:.0f}s)"
                            )
                            last_progress_log = now_m

            stderr_text = ""
            if proc.stderr is not None:
                stderr_text = proc.stderr.read()
            rc = proc.wait(timeout=30)

            if _STOP_REQUESTED:
                log(f"Interrupted during '{item.file_name}'; discarding temporary file.")
                return False

            if rc != 0:
                err_summary = (stderr_text or "").strip().splitlines()
                msg = err_summary[0] if err_summary else f"ffmpeg exit code {rc}"
                raise RuntimeError(f"ffmpeg failed ({rc}): {msg}")

            elapsed = max(0.01, time.monotonic() - t0)
            if not tmp_path.is_file():
                raise RuntimeError("compressed temp file missing after ffmpeg exited 0")

            new_size = int(tmp_path.stat().st_size)
            if new_size <= MIN_FILE_SIZE_BYTES:
                raise RuntimeError(f"compressed output too small ({new_size} bytes)")

            new_probe = probe_video_file(tmp_path)
            if not new_probe.ok:
                raise RuntimeError(f"compressed output failed ffprobe: {new_probe.reason}")

            if abs(new_probe.duration_sec - old_dur) > COMPRESS_DURATION_TOLERANCE_SEC:
                raise RuntimeError(
                    f"duration mismatch after encode: old={old_dur:.2f}s vs new={new_probe.duration_sec:.2f}s"
                )

            if abs(new_probe.width - item.probe.width) > 1 or abs(new_probe.height - item.probe.height) > 1:
                raise RuntimeError(
                    f"resolution mismatch after encode: "
                    f"{item.probe.width}x{item.probe.height} vs {new_probe.width}x{new_probe.height}"
                )

            if not new_probe.is_optimized:
                raise RuntimeError("missing optimization metadata tag on encoded output")

            # Verify meaningful space savings (< min_savings_ratio, default 0.90).
            if new_size >= int(old_size * self.args.min_savings_ratio):
                ratio_pct = (1.0 - new_size / old_size) * 100.0
                log(
                    f"Keeping original '{item.file_name}': savings {ratio_pct:.1f}% < "
                    f"{(1.0 - self.args.min_savings_ratio) * 100.0:.0f}% threshold "
                    f"({format_bytes(old_size)} -> {format_bytes(new_size)})."
                )
                tmp_path.unlink(missing_ok=True)
                self.compression_log.record(
                    item.rel_posix,
                    {
                        "status": "skipped_no_savings",
                        "fileName": item.file_name,
                        "fileSize": old_size,
                        "fileMtimeMs": item.mtime_ms,
                        "codec": self.codec,
                        "quality": self.quality,
                        "preset": self.preset,
                        "candidateSize": new_size,
                        "checkedAt": utc_now_iso(),
                    },
                )
                stats.skipped_no_savings += 1
                return False

            # Ensure source file was not externally modified while encoding.
            st_check = item.full_path.stat()
            if int(st_check.st_size) != old_size or int(st_check.st_mtime_ns) != old_mtime_ns:
                raise RuntimeError("source file changed during encode; aborting swap")

            # Atomic verify-then-swap preserving exact filename (so lessonId NEVER changes).
            _replace_with_retry(tmp_path, item.full_path)

            st_final = item.full_path.stat()
            final_size = int(st_final.st_size)
            final_mtime_ms = int(round(st_final.st_mtime * 1000))

            synced = sync_transcript_metadata(
                self.transcript_dir,
                item.rel_posix,
                item.file_name,
                final_size,
                final_mtime_ms,
                dry_run=False,
            )
            if synced:
                stats.transcripts_synced += 1

            saved_bytes = old_size - final_size
            reduction_pct = (saved_bytes / old_size) * 100.0
            speed_x = old_dur / elapsed if old_dur > 0 else 0.0
            new_kbps = (final_size * 8.0) / (new_probe.duration_sec * 1000.0)

            self.compression_log.record(
                item.rel_posix,
                {
                    "status": "compressed",
                    "fileName": item.file_name,
                    "lessonId": make_lesson_id(item.rel_posix),
                    "codec": self.codec,
                    "quality": self.quality,
                    "preset": self.preset,
                    "audioBitrate": self.audio_bitrate,
                    "oldSize": old_size,
                    "fileSize": final_size,
                    "fileMtimeMs": final_mtime_ms,
                    "savedBytes": saved_bytes,
                    "reductionPct": round(reduction_pct, 2),
                    "durationSec": new_probe.duration_sec,
                    "encodeSec": round(elapsed, 2),
                    "speedX": round(speed_x, 2),
                    "transcriptSynced": synced,
                    "compressedAt": utc_now_iso(),
                },
            )

            stats.compressed_count += 1
            stats.compressed_bytes_before += old_size
            stats.compressed_bytes_after += final_size
            stats.compressed_encode_sec += elapsed
            stats.compressed_audio_sec += old_dur

            log(
                f"Optimized '{item.file_name}': {format_bytes(old_size)} ({old_kbps:.0f} kbps) -> "
                f"{format_bytes(final_size)} ({new_kbps:.0f} kbps) | -{reduction_pct:.1f}% "
                f"(saved {format_bytes(saved_bytes)}) | {speed_x:.2f}x ({elapsed:.1f}s) | "
                f"transcript_synced={synced}"
            )
            return True

        except Exception as exc:
            err_msg = f"{item.file_name}: {exc}"
            stats.errors.append(err_msg)
            log(f"ERROR compressing '{item.file_name}': {exc} (original preserved untouched)")
            return False
        finally:
            if proc is not None and proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=5)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass

    def _run_compress(self, stats: RunStats, already_done_session: int) -> int:
        """Compress uncompressed valid videos in canonical_dir up to --max-videos."""
        canonical_items = self._scan_and_verify_stability(self.canonical_dir, probe_all=True)

        if self.args.remove_corrupt and not self.args.dedup:
            self._remove_corrupt_in_canonical(canonical_items, stats)

        candidates: list[ScannedVideo] = []
        for item in canonical_items:
            if not item.stable:
                stats.skipped_downloading += 1
                continue
            if item.probe is None or not item.probe.ok:
                stats.skipped_downloading += 1
                continue
            if item.probe.is_optimized:
                stats.skipped_already_opt += 1
                continue
            prev_status = self.compression_log.is_already_handled(
                item.rel_posix,
                item.size,
                item.mtime_ms,
                self.codec,
                self.quality,
                self.preset,
            )
            if prev_status == "compressed":
                stats.skipped_already_opt += 1
                continue
            if prev_status == "skipped_no_savings":
                stats.skipped_no_savings += 1
                continue
            candidates.append(item)

        if self.args.sort == "largest":
            candidates.sort(key=lambda x: (-x.size, x.rel_posix))
        elif self.args.sort == "smallest":
            candidates.sort(key=lambda x: (x.size, x.rel_posix))
        # else "natural" order already returned by discover_videos.

        log(
            f"Compression scan: {len(canonical_items)} video(s) in canonical, "
            f"{len(candidates)} candidate(s) to compress, "
            f"{stats.skipped_already_opt} already optimized, "
            f"{stats.skipped_no_savings} skipped (<10% savings)."
        )

        done = already_done_session
        max_videos = self.args.max_videos
        for item in candidates:
            if _STOP_REQUESTED:
                break
            if max_videos is not None and done >= max_videos:
                log(f"Reached --max-videos limit ({max_videos}); stopping compression pass.")
                break
            if self._compress_one(item, stats):
                done += 1

        return done

    def run(self) -> int:
        if not (self.args.dedup or self.args.compress or self.args.remove_corrupt):
            log("ERROR: Specify at least one action flag: --dedup, --compress, or --remove-corrupt.")
            return 2

        log(
            f"Starting intensive-media-pipeline mode={'watch' if self.args.watch else 'once'} "
            f"dry_run={self.args.dry_run} dedup={self.args.dedup} compress={self.args.compress} "
            f"remove_corrupt={self.args.remove_corrupt} codec={self.codec} "
            f"q={self.quality} preset={self.preset} canonical='{self.canonical_dir}'"
        )
        if self.incoming_dirs:
            log("Incoming dirs: " + ", ".join(str(p) for p in self.incoming_dirs))
        if self.transcript_dir:
            log(f"Transcript dir: {self.transcript_dir}")

        stats = RunStats()
        compressed_session = 0

        try:
            while not _STOP_REQUESTED:
                if self.args.dedup:
                    self._run_dedup(stats)
                elif self.args.remove_corrupt and not self.args.compress:
                    canonical_items = self._scan_and_verify_stability(self.canonical_dir, probe_all=True)
                    self._remove_corrupt_in_canonical(canonical_items, stats)

                if self.args.compress and not _STOP_REQUESTED:
                    compressed_session = self._run_compress(stats, compressed_session)

                if not self.args.watch:
                    break
                if (
                    self.args.compress
                    and self.args.max_videos is not None
                    and compressed_session >= self.args.max_videos
                ):
                    break

                self._interruptible_sleep(self.args.poll_seconds)
        except KeyboardInterrupt:
            log("Interrupted by user.")

        saved_compress = stats.compressed_bytes_before - stats.compressed_bytes_after
        total_reclaimed = (
            stats.duplicates_bytes_reclaimed
            + stats.corrupt_bytes_reclaimed
            + stats.internal_dups_bytes_reclaimed
            + saved_compress
        )
        pct_compress = (
            (saved_compress / stats.compressed_bytes_before) * 100.0
            if stats.compressed_bytes_before > 0
            else 0.0
        )
        avg_spd = (
            stats.compressed_audio_sec / stats.compressed_encode_sec
            if stats.compressed_encode_sec > 0
            else 0.0
        )
        log(
            "Summary: "
            f"dups_deleted={stats.duplicates_deleted} ({format_bytes(stats.duplicates_bytes_reclaimed)}), "
            f"new_moved={stats.new_moved} ({format_bytes(stats.new_bytes_moved)}), "
            f"corrupt_replaced={stats.corrupt_replaced}, "
            f"corrupt_removed={stats.corrupt_removed} ({format_bytes(stats.corrupt_bytes_reclaimed)}), "
            f"internal_dups={stats.internal_dups_deleted} ({format_bytes(stats.internal_dups_bytes_reclaimed)}), "
            f"compressed={stats.compressed_count} ({format_bytes(stats.compressed_bytes_before)} -> "
            f"{format_bytes(stats.compressed_bytes_after)}, -{pct_compress:.1f}%, {avg_spd:.2f}x avg), "
            f"transcripts_synced={stats.transcripts_synced}, "
            f"total_disk_reclaimed={format_bytes(total_reclaimed)}, "
            f"errors={len(stats.errors)}"
        )
        return 1 if stats.errors else 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Safe deduplication, consolidation, and visually-lossless classroom video "
            "compression pipeline for TrilhaAtlas courses."
        )
    )
    parser.add_argument(
        "--canonical-dir",
        required=True,
        help="Canonical course video directory (files here preserve exact lessonId filenames).",
    )
    parser.add_argument(
        "--incoming-dir",
        action="append",
        default=[],
        help="Optional incoming download directory to deduplicate/consolidate into --canonical-dir (repeatable).",
    )
    parser.add_argument(
        "--transcript-dir",
        default=None,
        help="Optional TrilhaAtlas intensive media directory (manifest.json + transcripts/) to keep fileSize/fileMtimeMs synced.",
    )
    parser.add_argument(
        "--codec",
        default="libsvtav1",
        choices=("libsvtav1", "hevc_nvenc", "h264_nvenc"),
        help=(
            "Target video encoder (default: libsvtav1 — proven 100%% playable in Electron, "
            "Chrome, and Edge with best 1080p classroom compression & zero GPU contention)."
        ),
    )
    parser.add_argument(
        "--cq",
        type=int,
        default=None,
        help="NVENC constant-quality value (defaults: 34 for hevc_nvenc, 28 for h264_nvenc).",
    )
    parser.add_argument(
        "--crf",
        type=int,
        default=None,
        help="SVT-AV1 CRF value (default: 38).",
    )
    parser.add_argument(
        "--preset",
        default=None,
        help="Encoder speed preset (defaults: '8' for libsvtav1, 'p5' for NVENC codecs).",
    )
    parser.add_argument(
        "--audio-bitrate",
        default="80k",
        help="AAC mono audio bitrate (default: 80k).",
    )
    parser.add_argument(
        "--dedup",
        action="store_true",
        help="Deduplicate/consolidate --incoming-dir into --canonical-dir and run safe internal dedup.",
    )
    parser.add_argument(
        "--compress",
        action="store_true",
        help="Compress uncompressed valid videos in --canonical-dir with verify-then-swap.",
    )
    parser.add_argument(
        "--remove-corrupt",
        action="store_true",
        help="Safely delete stale, stable, ffprobe-unreadable corrupt files in --canonical-dir.",
    )
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--once",
        action="store_true",
        help="Run a single pass and exit (default).",
    )
    mode_group.add_argument(
        "--watch",
        action="store_true",
        help="Continuously poll every --poll-seconds for newly completed downloads.",
    )
    parser.add_argument(
        "--poll-seconds",
        type=float,
        default=15.0,
        help="Polling interval in seconds for --watch mode (default: 15).",
    )
    parser.add_argument(
        "--min-stable-seconds",
        type=float,
        default=6.0,
        help="Seconds file size and mtime must remain unchanged before probing/acting (default: 6).",
    )
    parser.add_argument(
        "--max-videos",
        type=int,
        default=None,
        help="Optional cap on the number of videos compressed in this run.",
    )
    parser.add_argument(
        "--sort",
        default="largest",
        choices=("largest", "natural", "smallest"),
        help="Compression ordering inside --canonical-dir (default: largest).",
    )
    parser.add_argument(
        "--min-savings-ratio",
        type=float,
        default=0.90,
        help="Maximum allowed newSize/oldSize ratio to accept swap (default: 0.90 = >=10%% savings).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log planned actions without deleting, moving, or replacing any files.",
    )
    return parser.parse_args(argv)


def _handle_stop_signal(signum: int, _frame: Any) -> None:
    global _STOP_REQUESTED
    _STOP_REQUESTED = True
    log(f"Received signal {signum}; finishing current safe step and stopping cleanly...")


def main(argv: list[str] | None = None) -> int:
    _configure_stdio()
    signal.signal(signal.SIGINT, _handle_stop_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _handle_stop_signal)

    args = parse_args(argv)
    pipeline = MediaPipeline(args)
    return pipeline.run()


if __name__ == "__main__":
    raise SystemExit(main())
