/**
 * LUCIDE COMPAT — drop-in replacements for every lucide-react icon the app
 * imports today (estudos-sota M8 — SÍNTESE §2.12; r9 §7.4; lh-ui-theme
 * §5.2 "migração incremental"). Same export names as lucide-react, so the
 * migration is an import swap with no JSX change:
 *
 *   - import { XIcon, SearchIcon } from "lucide-react";
 *   + import { XIcon, SearchIcon } from "@/components/icons/lucide-compat";
 *
 * LUCIDE_COMPAT is the single map (lucide name → cel icon); the inventory
 * came from a grep of every `from "lucide-react"` import under app/ and
 * components/ (71 names, 2026-11-18). lucide-only props (`strokeWidth`,
 * `absoluteStrokeWidth`) are accepted and ignored — the ink is a filled
 * outline, its weight is baked by the compiler; `color` sets currentColor.
 * Sizing keeps working through `className="size-4"` (and picks the micro
 * ink at ≤16 px) or `size`.
 */

import { createElement, type ComponentType } from "react";
import { Icon, type IconProps } from "./icon.tsx";
import type { IconName } from "./generated.ts";

/** lucide-react export name → cel icon name. */
export const LUCIDE_COMPAT = {
	ActivityIcon: "activity",
	ArrowDownIcon: "arrow-down",
	ArrowRight: "arrow-right",
	ArrowRightIcon: "arrow-right",
	ArrowUpRight: "arrow-up-right",
	BookIcon: "book",
	BookOpenIcon: "chapter",
	BotIcon: "bot",
	CheckIcon: "check",
	ChevronDownIcon: "chevron-down",
	ChevronLeftIcon: "chevron-left",
	ChevronRight: "chevron-right",
	ChevronRightIcon: "chevron-right",
	ChevronUpIcon: "chevron-up",
	CircleX: "error",
	ClipboardCheckIcon: "exercise",
	CopyIcon: "copy",
	CornerDownLeft: "enter",
	CornerDownLeftIcon: "enter",
	DownloadIcon: "download",
	DumbbellIcon: "practice",
	EllipsisIcon: "more",
	File: "file",
	FileArchive: "file-archive",
	FileAudio: "file-audio",
	FileCode: "file-code",
	FileImage: "file-image",
	FileSpreadsheet: "file-sheet",
	FileSymlinkIcon: "file-link",
	FileText: "file-text",
	FileTextIcon: "file-text",
	FileVideo: "file-video",
	Folder: "folder",
	FolderIcon: "folder",
	FolderOpenIcon: "folder-open",
	FolderPlusIcon: "folder-plus",
	GripVertical: "drag-handle",
	KeyIcon: "key",
	KeyboardIcon: "keyboard",
	ListTreeIcon: "list-tree",
	Loader2Icon: "loader",
	MaximizeIcon: "maximize",
	MessageCircleQuestion: "help",
	MessageCircleQuestionIcon: "help",
	Mic: "mic",
	MicIcon: "mic",
	MinusIcon: "minus",
	PaletteIcon: "theme",
	PanelLeftCloseIcon: "sidebar-close",
	PanelLeftOpenIcon: "sidebar-open",
	PaperclipIcon: "attach",
	PenToolIcon: "edit",
	Pencil: "edit",
	Pin: "pin",
	PinOff: "pin-off",
	PlayIcon: "play",
	PlugIcon: "plug",
	PlusIcon: "plus",
	PuzzleIcon: "plugin",
	Quote: "quote",
	RefreshCw: "sync",
	SearchIcon: "search",
	Settings: "settings",
	SettingsIcon: "settings",
	Square: "stop",
	SquareIcon: "stop",
	Trash2Icon: "trash",
	UploadIcon: "upload",
	WaypointsIcon: "map",
	X: "close",
	XIcon: "close",
} as const satisfies Readonly<Record<string, IconName>>;

/** A lucide-react export name this module replaces. */
export type LucideCompatName = keyof typeof LUCIDE_COMPAT;

/** lucide-react's props, accepted for compatibility. */
export type CompatIconProps = Omit<IconProps, "name"> & {
	strokeWidth?: number | string;
	absoluteStrokeWidth?: boolean;
	color?: string;
};

/** The component type, under lucide's name (`icon: LucideIcon` props keep compiling). */
export type LucideIcon = ComponentType<CompatIconProps>;

/** The cel icon a lucide name maps to. */
export function compatIconName(lucide: LucideCompatName): IconName {
	return LUCIDE_COMPAT[lucide];
}

function compat(lucide: LucideCompatName): LucideIcon {
	const name = LUCIDE_COMPAT[lucide];
	const C = ({ strokeWidth: _w, absoluteStrokeWidth: _a, color, style, ...rest }: CompatIconProps) =>
		createElement(Icon, { ...rest, name, style: color ? { color, ...style } : style });
	C.displayName = lucide;
	return C;
}

export const ActivityIcon = compat("ActivityIcon");
export const ArrowDownIcon = compat("ArrowDownIcon");
export const ArrowRight = compat("ArrowRight");
export const ArrowRightIcon = compat("ArrowRightIcon");
export const ArrowUpRight = compat("ArrowUpRight");
export const BookIcon = compat("BookIcon");
export const BookOpenIcon = compat("BookOpenIcon");
export const BotIcon = compat("BotIcon");
export const CheckIcon = compat("CheckIcon");
export const ChevronDownIcon = compat("ChevronDownIcon");
export const ChevronLeftIcon = compat("ChevronLeftIcon");
export const ChevronRight = compat("ChevronRight");
export const ChevronRightIcon = compat("ChevronRightIcon");
export const ChevronUpIcon = compat("ChevronUpIcon");
export const CircleX = compat("CircleX");
export const ClipboardCheckIcon = compat("ClipboardCheckIcon");
export const CopyIcon = compat("CopyIcon");
export const CornerDownLeft = compat("CornerDownLeft");
export const CornerDownLeftIcon = compat("CornerDownLeftIcon");
export const DownloadIcon = compat("DownloadIcon");
export const DumbbellIcon = compat("DumbbellIcon");
export const EllipsisIcon = compat("EllipsisIcon");
export const File = compat("File");
export const FileArchive = compat("FileArchive");
export const FileAudio = compat("FileAudio");
export const FileCode = compat("FileCode");
export const FileImage = compat("FileImage");
export const FileSpreadsheet = compat("FileSpreadsheet");
export const FileSymlinkIcon = compat("FileSymlinkIcon");
export const FileText = compat("FileText");
export const FileTextIcon = compat("FileTextIcon");
export const FileVideo = compat("FileVideo");
export const Folder = compat("Folder");
export const FolderIcon = compat("FolderIcon");
export const FolderOpenIcon = compat("FolderOpenIcon");
export const FolderPlusIcon = compat("FolderPlusIcon");
export const GripVertical = compat("GripVertical");
export const KeyIcon = compat("KeyIcon");
export const KeyboardIcon = compat("KeyboardIcon");
export const ListTreeIcon = compat("ListTreeIcon");
export const Loader2Icon = compat("Loader2Icon");
export const MaximizeIcon = compat("MaximizeIcon");
export const MessageCircleQuestion = compat("MessageCircleQuestion");
export const MessageCircleQuestionIcon = compat("MessageCircleQuestionIcon");
export const Mic = compat("Mic");
export const MicIcon = compat("MicIcon");
export const MinusIcon = compat("MinusIcon");
export const PaletteIcon = compat("PaletteIcon");
export const PanelLeftCloseIcon = compat("PanelLeftCloseIcon");
export const PanelLeftOpenIcon = compat("PanelLeftOpenIcon");
export const PaperclipIcon = compat("PaperclipIcon");
export const PenToolIcon = compat("PenToolIcon");
export const Pencil = compat("Pencil");
export const Pin = compat("Pin");
export const PinOff = compat("PinOff");
export const PlayIcon = compat("PlayIcon");
export const PlugIcon = compat("PlugIcon");
export const PlusIcon = compat("PlusIcon");
export const PuzzleIcon = compat("PuzzleIcon");
export const Quote = compat("Quote");
export const RefreshCw = compat("RefreshCw");
export const SearchIcon = compat("SearchIcon");
export const Settings = compat("Settings");
export const SettingsIcon = compat("SettingsIcon");
export const Square = compat("Square");
export const SquareIcon = compat("SquareIcon");
export const Trash2Icon = compat("Trash2Icon");
export const UploadIcon = compat("UploadIcon");
export const WaypointsIcon = compat("WaypointsIcon");
export const X = compat("X");
export const XIcon = compat("XIcon");
