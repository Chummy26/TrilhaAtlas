/**
 * Visual styles for the curriculum skill tree canvas (`/mapa`).
 * Pure and browser-safe.
 */

export const SKILL_MAP_STYLES = [
	"constellation",
	"hextech",
	"citadel",
	"atlas",
	"clarity",
] as const;

export type SkillMapStyle = (typeof SKILL_MAP_STYLES)[number];

export function isSkillMapStyle(value: unknown): value is SkillMapStyle {
	return typeof value === "string" && (SKILL_MAP_STYLES as readonly string[]).includes(value);
}

/** Pick one of the 5 map styles uniformly at random (used when creating a new tree/domain). */
export function pickRandomSkillMapStyle(random: () => number = Math.random): SkillMapStyle {
	const raw = random();
	const clamped = Number.isFinite(raw) ? Math.min(0.9999999, Math.max(0, raw)) : 0;
	return SKILL_MAP_STYLES[Math.floor(clamped * SKILL_MAP_STYLES.length)]!;
}

/** Deterministic fallback for legacy domains whose domain.json has no mapStyle yet. */
export function defaultSkillMapStyleForDomain(domainId: string): SkillMapStyle {
	let hash = 2166136261;
	for (let i = 0; i < domainId.length; i++) {
		hash ^= domainId.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return SKILL_MAP_STYLES[(hash >>> 0) % SKILL_MAP_STYLES.length]!;
}
