"use client";

import type { SkillMapStyle } from "@/src/core";

/**
 * Hand-crafted cel-shading SVG icons for the 5 skill tree visual styles.
 * Geometric, closed paths — crisp at 15–24 px in both Cel Noite and Cel Papel.
 */
export function MapStyleIcon({ style, size = 16, className }: { style: SkillMapStyle; size?: number; className?: string }) {
	const common = {
		width: size,
		height: size,
		viewBox: "0 0 24 24",
		fill: "none",
		xmlns: "http://www.w3.org/2000/svg",
		"aria-hidden": true as const,
		className,
	};

	switch (style) {
		case "constellation":
			return (
				<svg {...common}>
					{/* Outer astrolabe ring */}
					<circle cx="12" cy="12" r="8.8" stroke="currentColor" strokeWidth="1.45" strokeDasharray="3.2 2.4" opacity="0.7" />
					{/* Radial skill highways */}
					<path d="M12 3.2V7.6M12 16.4V20.8M3.2 12H7.6M16.4 12H20.8" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
					{/* Central faceted Keystone */}
					<path d="M12 6.8L16.8 12L12 17.2L7.2 12Z" fill="currentColor" fillOpacity="0.22" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
					<circle cx="12" cy="12" r="1.7" fill="currentColor" />
					{/* Cardinal notables */}
					<circle cx="12" cy="3.2" r="1.65" fill="currentColor" />
					<circle cx="20.8" cy="12" r="1.65" fill="currentColor" />
					<circle cx="12" cy="20.8" r="1.65" fill="currentColor" />
					<circle cx="3.2" cy="12" r="1.65" fill="currentColor" />
				</svg>
			);

		case "hextech":
			return (
				<svg {...common}>
					{/* Primary 8-tooth closed mechanical gear */}
					<path
						d="M8.6 5.2H11.4L11.8 7.1A5.2 5.2 0 0 1 13.4 7.8L15 6.7L17 8.7L15.9 10.3A5.2 5.2 0 0 1 16.6 11.9L18.5 12.3V15.1L16.6 15.5A5.2 5.2 0 0 1 15.9 17.1L17 18.7L15 20.7L13.4 19.6A5.2 5.2 0 0 1 11.8 20.3L11.4 22.2H8.6L8.2 20.3A5.2 5.2 0 0 1 6.6 19.6L5 20.7L3 18.7L4.1 17.1A5.2 5.2 0 0 1 3.4 15.5L1.5 15.1V12.3L3.4 11.9A5.2 5.2 0 0 1 4.1 10.3L3 8.7L5 6.7L6.6 7.8A5.2 5.2 0 0 1 8.2 7.1Z"
						transform="translate(0 -0.4) scale(0.92)"
						fill="currentColor"
						fillOpacity="0.18"
						stroke="currentColor"
						strokeWidth="1.6"
						strokeLinejoin="round"
					/>
					<circle cx="9.2" cy="12.2" r="2.6" fill="currentColor" fillOpacity="0.28" stroke="currentColor" strokeWidth="1.6" />
					{/* Meshed secondary escapement gear */}
					<circle cx="18.6" cy="6.4" r="3.2" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.6" />
					<path d="M18.6 2.1V3.2M18.6 9.6V10.7M14.3 6.4H15.4M21.8 6.4H22.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
					<circle cx="18.6" cy="6.4" r="1.05" fill="currentColor" />
				</svg>
			);

		case "citadel":
			return (
				<svg {...common}>
					{/* Elevated top isometric hexagonal prism */}
					<path d="M12 2.4L17.4 5.4V10.6L12 13.6L6.6 10.6V5.4Z" fill="currentColor" fillOpacity="0.24" stroke="currentColor" strokeWidth="1.65" strokeLinejoin="round" />
					<path d="M12 8.4L17.4 5.4M12 8.4L6.6 5.4M12 8.4V13.6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" opacity="0.82" />
					{/* Lower-left isometric terrace */}
					<path d="M6.6 11.2L11.2 13.7V18.5L6.6 21L2 18.5V13.7Z" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.55" strokeLinejoin="round" />
					{/* Lower-right isometric terrace */}
					<path d="M17.4 11.2L22 13.7V18.5L17.4 21L12.8 18.5V13.7Z" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.55" strokeLinejoin="round" />
				</svg>
			);

		case "clarity":
			return (
				<svg {...common}>
					{/* Clean horizontal reading swimlanes */}
					<rect x="2.2" y="3.5" width="19.6" height="4.8" rx="2.4" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="1.55" />
					<rect x="2.2" y="9.8" width="19.6" height="4.8" rx="2.4" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="1.55" />
					<rect x="2.2" y="16.1" width="14.5" height="4.4" rx="2.2" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="1.55" />
					<circle cx="5.6" cy="5.9" r="1.35" fill="currentColor" />
					<path d="M8.5 5.9H18.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
					<circle cx="5.6" cy="12.2" r="1.35" fill="currentColor" />
					<path d="M8.5 12.2H18.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
					<circle cx="5.6" cy="18.3" r="1.25" fill="currentColor" />
					<path d="M8.5 18.3H13.8" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
				</svg>
			);

		case "atlas":
		default:
			return (
				<svg {...common}>
					{/* Structured cartographic regions & upward flow */}
					<rect x="2.5" y="3.5" width="8.5" height="6.8" rx="2.2" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="1.6" />
					<rect x="13" y="3.5" width="8.5" height="6.8" rx="2.2" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="1.6" />
					<rect x="7" y="13.7" width="10" height="6.8" rx="2.2" fill="currentColor" fillOpacity="0.24" stroke="currentColor" strokeWidth="1.6" />
					<path d="M12 13.7V12C12 11.1 6.75 11.4 6.75 10.3M12 13.7V12C12 11.1 17.25 11.4 17.25 10.3" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
					<circle cx="12" cy="17.1" r="1.55" fill="currentColor" />
				</svg>
			);
	}
}
