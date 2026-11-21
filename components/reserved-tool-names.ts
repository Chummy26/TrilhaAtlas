import { QUESTION_TOOLS } from "@/src/core";

/** The Markdown dispatch uses this same exclusive built-in language. */
export const BUILTIN_MERMAID_LANGUAGE = "mermaid";

/** Plain list of built-in artifact tool names matching `Object.keys(artifactRenderers)`.
 * Kept in a leaf module so RootLayout / PluginsProvider never pulls the artifact
 * renderers, chat component, or Streamdown into every non-chat route. */
export const RESERVED_ARTIFACT_TOOL_NAMES = [
	"research",
	"pdf",
	"demo",
	"present_lesson_exam",
	"conclude_lesson",
	"prepare_review",
	"study_activity",
	"attach_study_materials",
	"visual",
	"show_image",
	"probe_done",
	"read",
	"ls",
	"find",
	"grep",
	"problem",
	"conclude",
	"list_sessions",
	"list_propositions",
] as const;

/** Only actual exclusive presentation claims: not every backend/internal tool. */
export function reservedToolRendererNames(): string[] {
	return [...new Set([...RESERVED_ARTIFACT_TOOL_NAMES, ...QUESTION_TOOLS, "plan_init"])];
}
