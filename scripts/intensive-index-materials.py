#!/usr/bin/env python3
"""Study materials extractor and text indexer for intensive courses (TrilhaAtlas).

Recursively scans a local course materials directory, classifies files cleanly,
optionally collapses byte-identical mirror duplicates while picking the best
canonical location, extracts searchable text from PDFs (via pypdf), HTML,
plain text, Markdown, CSV, JSON, and DOCX documents, splits text into bounded
BM25-friendly retrieval chunks (~350-450 words), and atomically writes
per-material extracted JSON files plus manifest.json.

No private paths are hardcoded; supply --course-id, --source-dir, and
--output-dir explicitly on the command line.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import logging
import os
import re
import sys
import time
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True

SCHEMA_VERSION = 1
DEFAULT_TARGET_WORDS = 380
DEFAULT_MAX_WORDS = 450
MIN_TAIL_MERGE_WORDS = 60

SAFE_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,160}$")

# OS metadata and incomplete download artifacts to ignore.
SKIP_DIR_NAMES = frozenset(
    {
        "__macosx",
        ".git",
        ".svn",
        ".hg",
        "node_modules",
        ".spotlight-v100",
        ".trashes",
        "$recycle.bin",
        "system volume information",
    }
)
SKIP_FILE_NAMES = frozenset(
    {
        ".ds_store",
        "thumbs.db",
        "desktop.ini",
        "icon\r",
    }
)
SKIP_EXTENSIONS = frozenset(
    {
        ".part",
        ".crdownload",
        ".tmp",
        ".temp",
        ".ytdl",
        ".partial",
        ".download",
    }
)

# Material category mapping.
CATEGORY_BY_EXT: dict[str, str] = {
    # PDF
    ".pdf": "pdf",
    # Documents & presentations
    ".doc": "doc",
    ".docx": "doc",
    ".odt": "doc",
    ".rtf": "doc",
    ".ppt": "doc",
    ".pptx": "doc",
    ".odp": "doc",
    ".epub": "doc",
    # Text & web notes
    ".txt": "text",
    ".md": "text",
    ".markdown": "text",
    ".html": "text",
    ".htm": "text",
    ".json": "text",
    ".xml": "text",
    ".yaml": "text",
    ".yml": "text",
    ".srt": "text",
    ".vtt": "text",
    ".tex": "text",
    ".log": "text",
    # Spreadsheets & tabular data
    ".csv": "spreadsheet",
    ".tsv": "spreadsheet",
    ".xls": "spreadsheet",
    ".xlsx": "spreadsheet",
    ".ods": "spreadsheet",
    # Images
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".webp": "image",
    ".gif": "image",
    ".bmp": "image",
    ".svg": "image",
    ".tif": "image",
    ".tiff": "image",
    ".avif": "image",
    # Archives
    ".zip": "archive",
    ".7z": "archive",
    ".rar": "archive",
    ".tar": "archive",
    ".gz": "archive",
    ".bz2": "archive",
    ".xz": "archive",
    ".tgz": "archive",
}

PLAIN_TEXT_EXTENSIONS = frozenset({".txt", ".md", ".markdown", ".csv", ".tsv"})
HTML_EXTENSIONS = frozenset({".html", ".htm"})
JSON_EXTENSIONS = frozenset({".json"})

# Natural sorting patterns aligned with scripts/intensive-transcribe.py.
_LEADING_NUMBER_RE = re.compile(r"^\s*(\d+)(?:[\s._\-)]|$)")
_UNIT_PREFIX_NUMBER_RE = re.compile(
    r"^\s*(?:aula|lesson|class|epis[oó]dio|ep|cap[ií]tulo|cap|m[oó]dulo|mod|"
    r"parte|pt|bloco|unit|unidade|apostila)[\s._#\-]*(\d+)(?=\D|$)",
    re.IGNORECASE,
)
_LESSON_NUMBER_ANYWHERE_RE = re.compile(
    r"\b(?:aula|lesson|cap[ií]tulo|chapter|unidade|unit|m[oó]dulo|module)\s*0*(\d+)\b",
    re.IGNORECASE,
)
_LESSON_FOLDER_HINT_RE = re.compile(
    r"\b(?:aula|lesson|cap[ií]tulo|chapter|unidade|unit|m[oó]dulo|module|bloco)\b",
    re.IGNORECASE,
)
_GENERIC_SUPPORT_FOLDER_RE = re.compile(
    r"\b(?:telegram|suporte|support|boas[\s\-]*vindas|welcome|aviso|avisos)\b",
    re.IGNORECASE,
)
_NATURAL_SPLIT_RE = re.compile(r"(\d+)")

# HTML cleanup patterns.
_HTML_DROP_BLOCK_RE = re.compile(
    r"<(script|style|noscript|svg)\b[^>]*>.*?</\1>",
    re.IGNORECASE | re.DOTALL,
)
_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_HTML_BLOCK_TAG_RE = re.compile(
    r"</?(?:p|div|br|li|ul|ol|tr|td|th|table|h[1-6]|section|article|header|footer|blockquote|pre|hr)\b[^>]*>",
    re.IGNORECASE,
)
_HTML_ANY_TAG_RE = re.compile(r"<[^>]+>")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_CTRL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


@dataclass(frozen=True)
class DiscoveredFile:
    """Single non-junk file discovered under --source-dir."""

    abs_path: Path
    relative_path: Path
    relative_posix: str
    size_bytes: int
    mtime_ms: int
    category: str


@dataclass(frozen=True)
class TextChunk:
    """Bounded text window for BM25 retrieval and tutor context."""

    index: int
    page: int
    text: str


@dataclass(frozen=True)
class ExtractedDocument:
    """Result of text extraction for a single material file."""

    page_count: int
    word_count: int
    chunks: list[TextChunk]
    error: str | None = None


def _configure_stdio() -> None:
    """Ensure UTF-8 console output on Windows so accented titles never fail."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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


def write_json_atomic(target: Path, payload: dict[str, Any]) -> None:
    """Atomically write UTF-8 JSON via sibling temp file + fsync + os.replace."""
    target.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    tmp_path = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    with open(tmp_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(content)
        fh.flush()
        os.fsync(fh.fileno())
    _replace_with_retry(tmp_path, target)


def _strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


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

    pref = _UNIT_PREFIX_NUMBER_RE.match(norm)
    if pref:
        return (0, int(pref.group(1)), _natural_tokens(stem))

    return (1, 0, _natural_tokens(stem))


def natural_path_sort_key(relative_path: Path) -> tuple[tuple[int, int, tuple[tuple[int, int | str], ...]], ...]:
    return tuple(_component_sort_key(part) for part in relative_path.parts)


def classify_category(file_path: Path) -> str:
    """Classify a file into a normalized material category."""
    ext = file_path.suffix.lower()
    return CATEGORY_BY_EXT.get(ext, "other")


def clean_human_title(file_name: str, fallback_parent: str = "") -> str:
    """Build a readable title from a material filename while keeping codes intact."""
    stem = Path(file_name).stem
    title = stem.replace("_", " ")
    title = re.sub(r"\s+", " ", title).strip()
    # Keep hyphenated codes (e.g. M1-01, MT-01, STR-VX20), but reject punctuation-only stems.
    alnum = re.sub(r"[^A-Za-z0-9]", "", _strip_accents(title))
    if not alnum:
        parent_clean = re.sub(r"\s+", " ", fallback_parent.replace("_", " ")).strip()
        return parent_clean or "Material"
    return title


def make_material_id(relative_posix: str, title: str) -> str:
    """Build deterministic ID: <ascii-slug-max48>-<sha1(relativePosixPath)[:8]>."""
    ascii_title = _strip_accents(title).lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_title).strip("-")
    if len(slug) > 48:
        slug = slug[:48].rstrip("-")
    if not slug:
        slug = "material"
    digest = hashlib.sha1(relative_posix.encode("utf-8")).hexdigest()[:8]
    return f"{slug}-{digest}"


def _should_skip_file(file_name: str) -> bool:
    lower = file_name.lower()
    if lower in SKIP_FILE_NAMES:
        return True
    if file_name.startswith("."):
        return True
    ext = Path(lower).suffix
    if ext in SKIP_EXTENSIONS:
        return True
    return False


def discover_files(source_dir: Path) -> tuple[list[DiscoveredFile], int]:
    """Recursively discover study material files under source_dir."""
    discovered: list[DiscoveredFile] = []
    skipped_count = 0

    for dirpath, dirnames, filenames in os.walk(source_dir):
        # Prune junk/hidden directories in place.
        kept_dirs: list[str] = []
        for dname in dirnames:
            if dname.lower() in SKIP_DIR_NAMES or dname.startswith("."):
                skipped_count += 1
                continue
            kept_dirs.append(dname)
        kept_dirs.sort(key=_component_sort_key)
        dirnames[:] = kept_dirs

        cur_dir = Path(dirpath)
        for fname in filenames:
            if _should_skip_file(fname):
                skipped_count += 1
                continue
            abs_path = cur_dir / fname
            try:
                st = abs_path.stat()
            except OSError:
                skipped_count += 1
                continue
            if not abs_path.is_file():
                continue
            rel_path = abs_path.relative_to(source_dir)
            discovered.append(
                DiscoveredFile(
                    abs_path=abs_path,
                    relative_path=rel_path,
                    relative_posix=rel_path.as_posix(),
                    size_bytes=int(st.st_size),
                    mtime_ms=int(st.st_mtime * 1000),
                    category=classify_category(abs_path),
                )
            )

    discovered.sort(key=lambda item: natural_path_sort_key(item.relative_path))
    return discovered, skipped_count


def detect_wrapper_prefix(files: list[DiscoveredFile]) -> tuple[str, ...]:
    """Peel leading single-child wrapper folders shared by every discovered file.

    For example, archives that unpack into `<wrapper>/<course-folder>/<module>/...`
    yield clean top-level module sections while keeping relativePath exact.
    """
    if not files:
        return ()

    prefix: list[str] = []
    depth = 0
    while True:
        # Stop if any file sits directly at this depth (no subdirectory at this level).
        if any(len(f.relative_path.parts) <= depth + 1 for f in files):
            break
        dirs_at_depth = {f.relative_path.parts[depth] for f in files}
        if len(dirs_at_depth) != 1:
            break
        only_dir = next(iter(dirs_at_depth))
        # Avoid peeling if peeling would leave every single file without any folder section.
        if all(len(f.relative_path.parts) == depth + 2 for f in files):
            break
        prefix.append(only_dir)
        depth += 1

    return tuple(prefix)


def derive_section(relative_path: Path, wrapper_prefix: tuple[str, ...]) -> str:
    """Derive a clean top-level section label from relative_path after wrapper peeling."""
    parts = relative_path.parts
    if wrapper_prefix and parts[: len(wrapper_prefix)] == wrapper_prefix:
        parts = parts[len(wrapper_prefix) :]
    dir_parts = parts[:-1]
    if not dir_parts:
        return ""
    return re.sub(r"\s+", " ", dir_parts[0]).strip()


def _sha256_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(1024 * 1024)
            if not block:
                break
            hasher.update(block)
    return hasher.hexdigest()


def _canonical_duplicate_rank(item: DiscoveredFile) -> tuple[int, int, int, int, Any]:
    """Rank byte-identical duplicate paths so the most canonical home wins (lower wins)."""
    stem_alnum = re.sub(r"[^A-Za-z0-9]", "", _strip_accents(item.abs_path.stem))
    has_descriptive_name = 0 if len(stem_alnum) >= 2 else 1

    parent_chain = " / ".join(item.relative_path.parts[:-1])
    file_lessons = set(_LESSON_NUMBER_ANYWHERE_RE.findall(item.abs_path.stem))
    parent_lessons = set(_LESSON_NUMBER_ANYWHERE_RE.findall(parent_chain))
    # Prefer the copy located in the folder matching the lesson number in the filename.
    lesson_match_penalty = 0 if (file_lessons and (file_lessons & parent_lessons)) else 1

    # Prefer lesson/module folders over generic support/welcome attachment folders.
    is_support_folder = 1 if _GENERIC_SUPPORT_FOLDER_RE.search(parent_chain) else 0
    is_lesson_folder = 0 if _LESSON_FOLDER_HINT_RE.search(parent_chain) else 1

    return (
        has_descriptive_name,
        lesson_match_penalty,
        is_support_folder,
        is_lesson_folder,
        natural_path_sort_key(item.relative_path),
    )


def deduplicate_files(files: list[DiscoveredFile]) -> tuple[list[DiscoveredFile], int]:
    """Collapse byte-identical files (same size + SHA-256) keeping the canonical copy."""
    by_size: dict[int, list[DiscoveredFile]] = defaultdict(list)
    for item in files:
        by_size[item.size_bytes].append(item)

    kept: list[DiscoveredFile] = []
    collapsed_count = 0

    for group in by_size.values():
        if len(group) == 1:
            kept.append(group[0])
            continue
        by_hash: dict[str, list[DiscoveredFile]] = defaultdict(list)
        for item in group:
            try:
                digest = _sha256_file(item.abs_path)
            except OSError:
                kept.append(item)
                continue
            by_hash[digest].append(item)
        for identical_items in by_hash.values():
            if len(identical_items) == 1:
                kept.append(identical_items[0])
            else:
                identical_items.sort(key=_canonical_duplicate_rank)
                kept.append(identical_items[0])
                collapsed_count += len(identical_items) - 1

    kept.sort(key=lambda item: natural_path_sort_key(item.relative_path))
    return kept, collapsed_count


def _clean_text(raw: str) -> str:
    """Normalize extracted text while keeping paragraph structure readable."""
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    text = _CTRL_CHARS_RE.sub("", text)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    cleaned = "\n".join(lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _read_text_with_fallback(path: Path) -> str:
    data = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _extract_html_text(path: Path) -> str:
    raw = _read_text_with_fallback(path)
    stripped = _HTML_DROP_BLOCK_RE.sub(" ", raw)
    stripped = _HTML_COMMENT_RE.sub(" ", stripped)
    stripped = _HTML_BLOCK_TAG_RE.sub("\n", stripped)
    stripped = _HTML_ANY_TAG_RE.sub(" ", stripped)
    unescaped = html.unescape(stripped)
    return _clean_text(unescaped)


def _extract_json_text(path: Path) -> str:
    raw = _read_text_with_fallback(path)
    try:
        parsed = json.loads(raw)
        pretty = json.dumps(parsed, ensure_ascii=False, indent=2)
        return _clean_text(pretty)
    except Exception:
        return _clean_text(raw)


def _extract_docx_text(path: Path) -> str:
    """Extract DOCX paragraphs and tables via python-docx or stdlib XML fallback."""
    try:
        import docx  # type: ignore[import-not-found]

        document = docx.Document(str(path))
        parts: list[str] = []
        for para in document.paragraphs:
            text = para.text.strip()
            if text:
                parts.append(text)
        for table in document.tables:
            for row in table.rows:
                row_cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                if row_cells:
                    parts.append(" | ".join(row_cells))
        return _clean_text("\n\n".join(parts))
    except ImportError:
        pass

    # Pure-stdlib XML fallback when python-docx is not installed.
    with zipfile.ZipFile(path, "r") as zf:
        xml_bytes = zf.read("word/document.xml")
    root = ET.fromstring(xml_bytes)
    w_ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs: list[str] = []
    for para in root.iter(f"{w_ns}p"):
        texts = [node.text for node in para.iter(f"{w_ns}t") if node.text]
        joined = "".join(texts).strip()
        if joined:
            paragraphs.append(joined)
    return _clean_text("\n\n".join(paragraphs))


def _split_oversized_unit(text: str, target_words: int, max_words: int) -> list[str]:
    """Split a paragraph that exceeds max_words on sentence or word boundaries."""
    words = text.split()
    if len(words) <= max_words:
        return [text]

    sentences = [s.strip() for s in _SENTENCE_SPLIT_RE.split(text) if s.strip()]
    if len(sentences) <= 1:
        pieces: list[str] = []
        for start in range(0, len(words), target_words):
            pieces.append(" ".join(words[start : start + target_words]))
        return pieces

    pieces = []
    buf: list[str] = []
    buf_words = 0
    for sentence in sentences:
        s_words = sentence.split()
        s_count = len(s_words)
        if s_count > max_words:
            if buf:
                pieces.append(" ".join(buf))
                buf = []
                buf_words = 0
            for start in range(0, s_count, target_words):
                pieces.append(" ".join(s_words[start : start + target_words]))
            continue
        if buf and buf_words + s_count > max_words:
            pieces.append(" ".join(buf))
            buf = [sentence]
            buf_words = s_count
        else:
            buf.append(sentence)
            buf_words += s_count
    if buf:
        pieces.append(" ".join(buf))
    return pieces


def build_chunks(
    pages: list[tuple[int, str]],
    target_words: int = DEFAULT_TARGET_WORDS,
    max_words: int = DEFAULT_MAX_WORDS,
) -> tuple[list[TextChunk], int]:
    """Split paginated text into bounded BM25 chunks (~350-450 words each)."""
    raw_chunks: list[tuple[int, str, int]] = []  # (start_page, text, word_count)
    total_words = 0

    cur_parts: list[str] = []
    cur_words = 0
    cur_page = 1

    def flush() -> None:
        nonlocal cur_parts, cur_words
        if cur_parts:
            text = "\n\n".join(cur_parts).strip()
            if text:
                raw_chunks.append((cur_page, text, cur_words))
            cur_parts = []
            cur_words = 0

    for page_num, raw_page_text in pages:
        cleaned_page = _clean_text(raw_page_text)
        if not cleaned_page:
            continue

        # Flush before a new page if the current chunk has already reached target size.
        if cur_parts and cur_words >= target_words:
            flush()

        paragraphs = [p.strip() for p in re.split(r"\n{2,}", cleaned_page) if p.strip()]
        units: list[str] = []
        for para in paragraphs:
            if len(para.split()) <= max_words:
                units.append(para)
            else:
                lines = [ln.strip() for ln in para.split("\n") if ln.strip()]
                if len(lines) > 1:
                    for ln in lines:
                        units.extend(_split_oversized_unit(ln, target_words, max_words))
                else:
                    units.extend(_split_oversized_unit(para, target_words, max_words))

        for unit in units:
            unit_words = len(unit.split())
            if unit_words == 0:
                continue
            total_words += unit_words

            if not cur_parts:
                cur_page = max(1, page_num)
                cur_parts.append(unit)
                cur_words = unit_words
            elif cur_words + unit_words <= max_words:
                cur_parts.append(unit)
                cur_words += unit_words
            else:
                flush()
                cur_page = max(1, page_num)
                cur_parts.append(unit)
                cur_words = unit_words

    flush()

    # Avoid tiny trailing fragment chunks when they fit safely onto the preceding chunk.
    if (
        len(raw_chunks) >= 2
        and raw_chunks[-1][2] < MIN_TAIL_MERGE_WORDS
        and raw_chunks[-2][2] + raw_chunks[-1][2] <= max_words + MIN_TAIL_MERGE_WORDS
    ):
        prev_page, prev_text, prev_words = raw_chunks[-2]
        _, last_text, last_words = raw_chunks[-1]
        raw_chunks[-2] = (prev_page, f"{prev_text}\n\n{last_text}", prev_words + last_words)
        raw_chunks.pop()

    chunks = [
        TextChunk(index=idx, page=page, text=text)
        for idx, (page, text, _) in enumerate(raw_chunks)
    ]
    return chunks, total_words


def extract_pdf_document(
    path: Path,
    target_words: int,
    max_words: int,
) -> ExtractedDocument:
    """Extract page-by-page text from a PDF using pypdf."""
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError(
            "pypdf is required to index PDF files. Install it with: uv pip install pypdf"
        ) from exc

    try:
        reader = PdfReader(str(path), strict=False)
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception:
                return ExtractedDocument(
                    page_count=0,
                    word_count=0,
                    chunks=[],
                    error="PDF is password-protected",
                )
        page_count = len(reader.pages)
        pages: list[tuple[int, str]] = []
        for idx, page in enumerate(reader.pages, start=1):
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""
            if text.strip():
                pages.append((idx, text))

        chunks, word_count = build_chunks(
            pages,
            target_words=target_words,
            max_words=max_words,
        )
        return ExtractedDocument(
            page_count=page_count,
            word_count=word_count,
            chunks=chunks,
        )
    except Exception as exc:
        return ExtractedDocument(
            page_count=0,
            word_count=0,
            chunks=[],
            error=f"PDF extraction failed: {exc}",
        )


def extract_document(
    item: DiscoveredFile,
    target_words: int,
    max_words: int,
) -> ExtractedDocument:
    """Dispatch text extraction by file extension."""
    ext = item.abs_path.suffix.lower()

    if ext == ".pdf":
        return extract_pdf_document(item.abs_path, target_words, max_words)

    if ext in PLAIN_TEXT_EXTENSIONS:
        try:
            text = _clean_text(_read_text_with_fallback(item.abs_path))
            chunks, word_count = build_chunks(
                [(1, text)] if text else [],
                target_words=target_words,
                max_words=max_words,
            )
            return ExtractedDocument(page_count=0, word_count=word_count, chunks=chunks)
        except Exception as exc:
            return ExtractedDocument(page_count=0, word_count=0, chunks=[], error=str(exc))

    if ext in HTML_EXTENSIONS:
        try:
            text = _extract_html_text(item.abs_path)
            chunks, word_count = build_chunks(
                [(1, text)] if text else [],
                target_words=target_words,
                max_words=max_words,
            )
            return ExtractedDocument(page_count=0, word_count=word_count, chunks=chunks)
        except Exception as exc:
            return ExtractedDocument(page_count=0, word_count=0, chunks=[], error=str(exc))

    if ext in JSON_EXTENSIONS:
        try:
            text = _extract_json_text(item.abs_path)
            chunks, word_count = build_chunks(
                [(1, text)] if text else [],
                target_words=target_words,
                max_words=max_words,
            )
            return ExtractedDocument(page_count=0, word_count=word_count, chunks=chunks)
        except Exception as exc:
            return ExtractedDocument(page_count=0, word_count=0, chunks=[], error=str(exc))

    if ext == ".docx":
        try:
            text = _extract_docx_text(item.abs_path)
            chunks, word_count = build_chunks(
                [(1, text)] if text else [],
                target_words=target_words,
                max_words=max_words,
            )
            return ExtractedDocument(page_count=0, word_count=word_count, chunks=chunks)
        except Exception as exc:
            return ExtractedDocument(page_count=0, word_count=0, chunks=[], error=str(exc))

    return ExtractedDocument(page_count=0, word_count=0, chunks=[])


def index_materials(
    course_id: str,
    source_dir: Path,
    output_dir: Path,
    deduplicate: bool = True,
    clean_stale: bool = True,
    target_words: int = DEFAULT_TARGET_WORDS,
    max_words: int = DEFAULT_MAX_WORDS,
) -> dict[str, Any]:
    """Index all study materials in source_dir and write manifest + extracted JSONs."""
    # Silence noisy pypdf parser warnings on malformed producer metadata.
    logging.getLogger("pypdf").setLevel(logging.ERROR)

    started = time.perf_counter()
    discovered, skipped_count = discover_files(source_dir)
    wrapper_prefix = detect_wrapper_prefix(discovered)

    collapsed_duplicates = 0
    if deduplicate:
        active_files, collapsed_duplicates = deduplicate_files(discovered)
    else:
        active_files = discovered

    extracted_dir = output_dir / "extracted"
    extracted_dir.mkdir(parents=True, exist_ok=True)

    materials_manifest: list[dict[str, Any]] = []
    active_extracted_files: set[str] = set()
    indexed_text_files = 0
    total_pages = 0
    total_word_count = 0
    errors: list[tuple[str, str]] = []

    total_count = len(active_files)
    for idx, item in enumerate(active_files, start=1):
        parent_name = item.relative_path.parent.name if len(item.relative_path.parts) > 1 else ""
        title = clean_human_title(item.abs_path.name, fallback_parent=parent_name)
        material_id = make_material_id(item.relative_posix, title)
        section = derive_section(item.relative_path, wrapper_prefix)

        doc = extract_document(item, target_words=target_words, max_words=max_words)
        if doc.error:
            errors.append((item.relative_posix, doc.error))

        has_text = len(doc.chunks) > 0 and doc.word_count > 0
        extracted_rel: str | None = None
        if has_text:
            indexed_text_files += 1
            extracted_rel = f"extracted/{material_id}.json"
            active_extracted_files.add(f"{material_id}.json")
            extracted_payload = {
                "schemaVersion": SCHEMA_VERSION,
                "courseId": course_id,
                "materialId": material_id,
                "title": title,
                "fileName": item.abs_path.name,
                "relativePath": item.relative_posix,
                "section": section,
                "category": item.category,
                "sizeBytes": item.size_bytes,
                "pageCount": doc.page_count,
                "wordCount": doc.word_count,
                "extractedAt": _utc_now_iso(),
                "chunks": [
                    {
                        "index": chunk.index,
                        "page": chunk.page,
                        "text": chunk.text,
                    }
                    for chunk in doc.chunks
                ],
            }
            write_json_atomic(extracted_dir / f"{material_id}.json", extracted_payload)

        total_pages += doc.page_count
        total_word_count += doc.word_count

        materials_manifest.append(
            {
                "materialId": material_id,
                "title": title,
                "fileName": item.abs_path.name,
                "relativePath": item.relative_posix,
                "section": section,
                "category": item.category,
                "sizeBytes": item.size_bytes,
                "mtimeMs": item.mtime_ms,
                "pageCount": doc.page_count,
                "wordCount": doc.word_count,
                "chunkCount": len(doc.chunks),
                "hasText": has_text,
                "extractedJson": extracted_rel,
            }
        )

        if idx % 50 == 0 or idx == total_count:
            print(
                f"[{idx}/{total_count}] Indexed {indexed_text_files} text docs, "
                f"{total_pages} pages, {total_word_count:,} words",
                flush=True,
            )

    if clean_stale:
        for existing in extracted_dir.glob("*.json"):
            if existing.name not in active_extracted_files:
                try:
                    existing.unlink()
                except OSError:
                    pass

    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "courseId": course_id,
        "sourceDir": str(source_dir.resolve()),
        "updatedAt": _utc_now_iso(),
        "totalFiles": len(materials_manifest),
        "indexedTextFiles": indexed_text_files,
        "totalPages": total_pages,
        "totalWordCount": total_word_count,
        "materials": materials_manifest,
    }
    write_json_atomic(output_dir / "manifest.json", manifest)

    elapsed = time.perf_counter() - started
    print(
        f"\nCompleted in {elapsed:.2f}s | discovered={len(discovered)} "
        f"skipped_junk={skipped_count} collapsed_duplicates={collapsed_duplicates} "
        f"indexed_materials={len(materials_manifest)} with_text={indexed_text_files} "
        f"pages={total_pages} words={total_word_count:,}",
        flush=True,
    )
    if errors:
        print(f"Extraction warnings ({len(errors)}):", file=sys.stderr, flush=True)
        for rel, msg in errors[:20]:
            print(f"  - {rel}: {msg}", file=sys.stderr, flush=True)

    return manifest


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract and index local study materials into manifest.json and searchable text chunks.",
    )
    parser.add_argument(
        "--course-id",
        required=True,
        help="Safe intensive course identifier (e.g. electronics-course-1).",
    )
    parser.add_argument(
        "--source-dir",
        required=True,
        help="Root directory containing raw extracted course material files.",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory where manifest.json and extracted/<materialId>.json will be written.",
    )
    parser.add_argument(
        "--no-deduplicate",
        action="store_true",
        help="Keep byte-identical duplicate files instead of collapsing them to their canonical path.",
    )
    parser.add_argument(
        "--keep-stale",
        action="store_true",
        help="Do not delete orphaned extracted/*.json files from previous runs.",
    )
    parser.add_argument(
        "--target-words",
        type=int,
        default=DEFAULT_TARGET_WORDS,
        help=f"Target words per chunk (default: {DEFAULT_TARGET_WORDS}).",
    )
    parser.add_argument(
        "--max-words",
        type=int,
        default=DEFAULT_MAX_WORDS,
        help=f"Maximum words per chunk (default: {DEFAULT_MAX_WORDS}).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    _configure_stdio()
    args = parse_args(argv)

    if not SAFE_ID_RE.match(args.course_id) or ".." in args.course_id:
        print(f"Error: invalid --course-id: {args.course_id}", file=sys.stderr)
        return 2

    source_dir = Path(args.source_dir).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    if not source_dir.exists() or not source_dir.is_dir():
        print(f"Error: --source-dir does not exist or is not a directory: {source_dir}", file=sys.stderr)
        return 2

    if args.target_words < 50 or args.max_words < args.target_words:
        print("Error: --max-words must be >= --target-words >= 50", file=sys.stderr)
        return 2

    output_dir.mkdir(parents=True, exist_ok=True)
    index_materials(
        course_id=args.course_id,
        source_dir=source_dir,
        output_dir=output_dir,
        deduplicate=not args.no_deduplicate,
        clean_stale=not args.keep_stale,
        target_words=args.target_words,
        max_words=args.max_words,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
