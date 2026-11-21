"use client";

import { memo } from "react";
import Link from "next/link";
import { useT } from "@/components/i18n";
import type { LessonCourseContext } from "@/src/core";

export const LessonCourseBar = memo(function LessonCourseBar({
	domainId,
	nodeId,
	course,
	completed,
	reinforcement,
}: {
	domainId: string;
	nodeId: string;
	course: LessonCourseContext;
	completed: boolean;
	reinforcement?: string;
}) {
	const t = useT();
	const mapHref = "/mapa?" + new URLSearchParams({ dominio: domainId, no: nodeId });
	const syllabusHref = `/ementa?dominio=${encodeURIComponent(domainId)}`;
	const modPct = course.moduleTotal > 0 ? Math.round((100 * course.moduleCompleted) / course.moduleTotal) : 0;
	return (
		<nav
			aria-label={t("lesson.courseBar.navAria")}
			data-testid="lesson-course-bar"
			className="lh-no-drag flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border/60 bg-card/95 px-4 py-1.5 text-xs text-muted-foreground"
		>
			<Link href="/" className="font-medium text-foreground underline-offset-2 hover:underline">
				{t("lesson.courseBar.backCampaign")}
			</Link>
			<span aria-hidden="true">·</span>
			<Link href={syllabusHref} className="font-medium text-foreground underline-offset-2 hover:underline">
				{t("lesson.courseBar.syllabus")}
			</Link>
			<span aria-hidden="true">›</span>
			<span className="font-medium text-foreground">{course.chapterLevel}</span>
			<span aria-hidden="true">·</span>
			<Link
				href={mapHref}
				className="truncate underline-offset-2 hover:underline"
				title={t("lesson.courseBar.moduleTitle", {
					index: course.moduleIndex,
					total: course.totalModules,
					title: course.moduleTitle,
				})}
			>
				{course.moduleTitle}
			</Link>
			<span className="whitespace-nowrap">
				· {t("lesson.courseBar.lessonCounter", { index: course.lessonIndex, total: course.moduleTotal })}
			</span>
			<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
				<progress
					className="h-1.5 w-16"
					max={Math.max(1, course.moduleTotal)}
					value={course.moduleCompleted}
					aria-label={t("lesson.courseBar.progressAria", {
						completed: course.moduleCompleted,
						total: course.moduleTotal,
					})}
				/>
				<span>{modPct}%</span>
			</span>
			{course.isAdvancedDefense && (
				<span
					className="study-pill study-pill-warning"
					title={t("lesson.courseBar.defenseTitle")}
				>
					{t("lesson.courseBar.defenseBadge")}
				</span>
			)}
			{course.isFinale && (
				<span className="cel-chip px-1.5 py-0.5 text-[11px] font-medium">
					{t("lesson.courseBar.finaleBadge")}
				</span>
			)}
			{completed && !reinforcement && (
				<span className="cel-chip px-1.5 py-0.5 text-[11px] font-medium text-foreground">
					{t("lesson.courseBar.completedBadge")}
				</span>
			)}
			{reinforcement && (
				<span className="cel-chip px-1.5 py-0.5 text-[11px] font-medium">
					{t("lesson.courseBar.reinforcementBadge")}
				</span>
			)}
		</nav>
	);
});
