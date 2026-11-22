/**
 * Visual styles for the curriculum skill tree canvas (`/mapa`).
 * Pure and browser-safe.
 */

export const SKILL_MAP_STYLES = [
	"atlas",
	"clarity",
	"constellation",
	"hextech",
	"citadel",
] as const;

export type SkillMapStyle = (typeof SKILL_MAP_STYLES)[number];

/** Default visual style for new and legacy skill trees. */
export const DEFAULT_SKILL_MAP_STYLE: SkillMapStyle = "atlas";

export function isSkillMapStyle(value: unknown): value is SkillMapStyle {
	return typeof value === "string" && (SKILL_MAP_STYLES as readonly string[]).includes(value);
}

/** Pick one of the 5 map styles uniformly at random. */
export function pickRandomSkillMapStyle(random: () => number = Math.random): SkillMapStyle {
	const raw = random();
	const clamped = Number.isFinite(raw) ? Math.min(0.9999999, Math.max(0, raw)) : 0;
	return SKILL_MAP_STYLES[Math.floor(clamped * SKILL_MAP_STYLES.length)]!;
}

/** Default fallback for domains whose domain.json has no mapStyle yet. */
export function defaultSkillMapStyleForDomain(_domainId?: string): SkillMapStyle {
	return DEFAULT_SKILL_MAP_STYLE;
}
