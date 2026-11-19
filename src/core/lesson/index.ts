/**
 * Lesson module barrel (docs/research/00-SINTESE.md §1.3 "Protocolo de aula
 * por nó", §2.4). Pure and browser-safe: protocol + plan compiler, turn
 * budget, deterministic grading with SI units, hint ladder, fatigue, the
 * orchestrator state machine and the prompt-request builders.
 *
 * Server-only exports (they read answer keys): lessonItem, renderRequest,
 * graderRequest, formatAnswer, revealsAnswer, gradeResponse. Clients get
 * toClientItem / toClientLessonOutline / toClientLessonView projections.
 */

export * from "./text.ts";
export * from "./units.ts";
export * from "./protocol.ts";
export * from "./budget.ts";
export * from "./grading.ts";
export * from "./hints.ts";
export * from "./fatigue.ts";
export * from "./orchestrator.ts";
export * from "./payloads.ts";
