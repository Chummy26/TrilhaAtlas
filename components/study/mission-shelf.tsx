"use client";

import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { useT } from "@/components/i18n";
import type { LessonResource } from "@/src/core";

export function MissionShelf({
	aids,
	mapHref,
	topClass = "top-14",
}: {
	aids: LessonResource[];
	mapHref: string;
	topClass?: string;
}) {
	const t = useT();
	return (
		<details
			className={`mission-shelf lh-no-drag absolute right-4 ${topClass} z-20 text-sm`}
			onKeyDown={(event) => {
				// Keep native disclosure/link activation when the chat's quiz is also waiting for Enter.
				if (event.key === "Enter" || event.key === " ") event.stopPropagation();
			}}
		>
			<summary className="cel-button ml-auto min-h-8 w-fit cursor-pointer list-none px-3 py-1 text-xs">
				<Icon name="book" size={14} tone={false} />
				{t("lesson.shelf.materials")}
			</summary>
			<div className="cel-card mt-1.5 space-y-2.5 p-3.5">
				{aids.map((m) => (
					<a
						key={m.kind + m.url}
						href={m.url}
						target="_blank"
						rel="noreferrer"
						className="flex items-start gap-2.5 rounded-lg p-1.5 transition-colors hover:bg-accent"
					>
						<Icon name={m.kind === "book" ? "book" : "video"} size={17} />
						<span className="min-w-0 flex-1">
							<strong className="block text-sm leading-snug">
								{m.kind === "book" ? t("lesson.shelf.reading") : t("lesson.shelf.video")} · {m.title}
							</strong>
							<span className="mt-0.5 block text-xs text-muted-foreground">
								{m.suggested ? t("lesson.shelf.suggestionPrefix") : ""}
								{m.part}
							</span>
						</span>
					</a>
				))}
				<div className="border-t border-border/50 pt-2">
					<Link
						className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--cel-link,var(--lh-accent))] underline underline-offset-2"
						href={mapHref}
					>
						<Icon name="map" size={14} tone={false} />
						{t("lesson.shelf.openRegionOnMap")}
					</Link>
				</div>
			</div>
		</details>
	);
}
