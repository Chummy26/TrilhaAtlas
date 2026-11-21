/** Study integration layer (curriculum → learner projection, API wire shapes). Browser-safe. */
export * from "./projection.ts";
export * from "./types.ts";
export * from "./map.ts";
export * from "./attachments.ts";
export * from "./map-layout.ts";
export { isLessonExamAnswer, pendingLessonExam } from "./lesson-conclusion.ts";
export type { CampaignChapter, CampaignModule, CampaignModuleLesson, CampaignQueueItem, LessonCourseContext, LessonCourseProgress } from "./campaign.ts";
export {
	analyzeLessonPedagogy,
	buildMissionPedagogyDirective,
	isAdvancedDefenseNode,
	type LessonPedagogyStage,
	type LessonPedagogyState,
	type MissionPedagogyObjective,
	type ScaffoldLevel,
} from "./tutor-pedagogy.ts";
export * from "./syllabus.ts";
export * from "./transcript.ts";
export * from "./notebook.ts";
export * from "./flipped-reading.ts";
export * from "./module-exam.ts";
export * from "./problem-set.ts";
export * from "./placement.ts";
