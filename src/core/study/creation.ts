/** Calendar assumptions are planning presets. Actual hours come from authored activities. */
export const campaignPaces = {
	focused: { label: "Ciclo focado", weeks: 12, days: 3, minutes: 60, minRegions: 4, maxRegions: 8, minSkills: 4 },
	semester: { label: "Campanha intermediária", weeks: 32, days: 4, minutes: 90, minRegions: 12, maxRegions: 18, minSkills: 6 },
	extended: { label: "Campanha de mais de um ano", weeks: 60, days: 5, minutes: 120, minRegions: 24, maxRegions: 32, minSkills: 9 },
} as const;
export type CampaignPace = keyof typeof campaignPaces;
export function campaignHours(pace: CampaignPace) {
	const { weeks, days, minutes } = campaignPaces[pace];
	return weeks * days * minutes / 60;
}

export type DomainCreationStatus =
	| { state: "planning" | "materials"; done: number; total: number }
	| { state: "ready"; domainId: string; title: string; workload?: { skills: number; regions: number; lessonHours: number; practiceHours: number } }
	| { state: "failed"; error: string };
