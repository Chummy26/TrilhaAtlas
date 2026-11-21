"use client";

import Link from "next/link";
import type { LessonCourseContext } from "@/src/core";

export function LessonCourseBar({
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
	const mapHref = "/mapa?" + new URLSearchParams({ dominio: domainId, no: nodeId });
	const syllabusHref = `/ementa?dominio=${encodeURIComponent(domainId)}`;
	const modPct = course.moduleTotal > 0 ? Math.round((100 * course.moduleCompleted) / course.moduleTotal) : 0;
	return (
		<nav
			aria-label="Posição no curso"
			data-testid="lesson-course-bar"
			className="lh-no-drag flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border/60 bg-background/90 px-4 py-1.5 text-xs text-muted-foreground backdrop-blur-sm"
		>
			<Link href="/" className="font-medium text-foreground underline-offset-2 hover:underline">
				← Campanha
			</Link>
			<span aria-hidden="true">·</span>
			<Link href={syllabusHref} className="font-medium text-foreground underline-offset-2 hover:underline">
				Ementa
			</Link>
			<span aria-hidden="true">›</span>
			<span className="font-medium text-foreground">{course.chapterLevel}</span>
			<span aria-hidden="true">·</span>
			<Link href={mapHref} className="truncate underline-offset-2 hover:underline" title={`Módulo ${course.moduleIndex} de ${course.totalModules}: ${course.moduleTitle}`}>
				{course.moduleTitle}
			</Link>
			<span className="whitespace-nowrap">
				· Aula {course.lessonIndex}/{course.moduleTotal}
			</span>
			<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
				<progress
					className="h-1.5 w-16"
					max={Math.max(1, course.moduleTotal)}
					value={course.moduleCompleted}
					aria-label={`Progresso do módulo: ${course.moduleCompleted} de ${course.moduleTotal}`}
				/>
				<span>{modPct}%</span>
			</span>
			{course.isAdvancedDefense && (
				<span
					className="study-pill study-pill-warning"
					title="Modo rigoroso de defesa e arguição"
				>
					Banca · Arguição
				</span>
			)}
			{course.isFinale && <span className="cel-chip px-1.5 py-0.5 text-[11px] font-medium">Missão final</span>}
			{completed && !reinforcement && <span className="cel-chip px-1.5 py-0.5 text-[11px] font-medium text-foreground">Concluída</span>}
			{reinforcement && <span className="cel-chip px-1.5 py-0.5 text-[11px] font-medium">Reforço</span>}
		</nav>
	);
}
