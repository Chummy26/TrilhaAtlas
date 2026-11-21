import type { ComicMood, ComicScene } from "@/src/core";

const INK = "#1e1b2e";

export type StoryMotif =
	| "name"
	| "origin"
	| "work"
	| "family"
	| "listen"
	| "say"
	| "write"
	| "order"
	| "observe"
	| "measure"
	| "compare"
	| "circuit"
	| "goal"
	| "story"
	| "path";

function normalizeText(value: string): string {
	return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Pick a charming storybook motif from a title, graph topology, or explicit hint. */
export function pickStoryMotif(
	title: string,
	incoming: number,
	outgoing: boolean,
	hint?: string,
): StoryMotif {
	if (hint && ["listen", "say", "write", "order", "observe", "measure", "compare"].includes(hint)) {
		return hint as StoryMotif;
	}
	const s = normalizeText(title);
	if (/nome|cham|cumpriment|saudac|apresent|greet|name/.test(s)) return "name";
	if (/origem|pais|cidade|onde|mor|from|where|country/.test(s)) return "origin";
	if (/trabalh|profiss|ocupac|escritor|empreg|job|work/.test(s)) return "work";
	if (/famil|casa|irma|pai|mae|home|family/.test(s)) return "family";
	if (/tensao|corrente|resist|circuit|eletr|ohm|volt|led/.test(s)) return "circuit";
	if (/ouvir|escut|pista|audio|som|listen/.test(s)) return "listen";
	if (/dizer|falar|convers|dialog|pronunc|pergunt|speak|talk/.test(s)) return "say";
	if (/anotar|escrev|ficha|formul|escrit|write|form/.test(s)) return "write";
	if (/ordem|ordenar|etapa|passo|order|step/.test(s)) return "order";
	if (/medir|medicao|escala|measur|gauge/.test(s)) return "measure";
	if (/compar|diferen|contraste|compare/.test(s)) return "compare";
	if (/observ|olhar|identif|observe|spot/.test(s)) return "observe";
	if (!outgoing) return "goal";
	if (incoming === 0) return "story";
	return "path";
}

/** Infer a comic background scene when a panel omits one. */
export function inferComicScene(text: string): ComicScene {
	const s = normalizeText(text);
	if (/recepc|ficha|balcao|inscri|atendent|welcome|check-in/.test(s)) return "reception";
	if (/cafe|restaur|pedir|cardap|coffee|tea|croissant/.test(s)) return "cafe";
	if (/trabalh|escritor|reuniao|job|work|office/.test(s)) return "work";
	if (/famil|casa|cozinha|home|family|sister|brother/.test(s)) return "home";
	if (/rua|onibus|hotel|aeroport|cidade|street|city|from/.test(s)) return "street";
	if (/circuit|volt|resistor|amper|laborat|experim|pilha|lampad/.test(s)) return "lab";
	if (/parque|jardim|clima|tempo|park|tree|sun/.test(s)) return "park";
	return "classroom";
}

/** Palette tint for each storybook motif pill backdrop. */
const MOTIF_BG: Record<StoryMotif, string> = {
	name: "#ffe5b4",
	origin: "#cdeeff",
	work: "#ffe9a8",
	family: "#ffd9d9",
	listen: "#e6dcff",
	say: "#ffd8c7",
	write: "#fff1bf",
	order: "#d2f6e3",
	observe: "#d6eeff",
	measure: "#ffe0c2",
	compare: "#e8ddff",
	circuit: "#fff0a6",
	goal: "#d5f7df",
	story: "#ffdcc4",
	path: "#d8f2ff",
};

/**
 * Playful cel-shaded mini-illustration (designed for a 36×24 pill box,
 * centered around x=18, y=12). Safe inside both standalone <svg> and PlanDiagram <g>.
 */
export function StoryBadgeGlyph({ motif }: { motif: StoryMotif }) {
	return (
		<g strokeLinecap="round" strokeLinejoin="round">
			{/* Soft cel-shaded pastel pill with hard ink outline */}
			<rect x="0" y="0" width="36" height="24" rx="10" fill={MOTIF_BG[motif]} stroke={INK} strokeWidth="1.5" />
			<path d="M5 3.2 H31" stroke="#fffdf7" strokeWidth="1.4" opacity="0.7" />
			{motif === "name" && (
				<g>
					{/* Smiling cartoon character + name tag */}
					<circle cx="15" cy="12" r="6.8" fill="#ffd9b3" stroke={INK} strokeWidth="1.4" />
					<path d="M9 10 C10 5.5 20 5.5 21 10 C19 8.2 11 8.2 9 10 Z" fill="#ff7a59" stroke={INK} strokeWidth="1.2" />
					<circle cx="13" cy="11.8" r="1" fill={INK} />
					<circle cx="17" cy="11.8" r="1" fill={INK} />
					<circle cx="11.4" cy="13.4" r="1.1" fill="#ff9aa2" opacity="0.85" />
					<circle cx="18.6" cy="13.4" r="1.1" fill="#ff9aa2" opacity="0.85" />
					<path d="M13.2 14.3 Q15 16.2 16.8 14.3" fill="none" stroke={INK} strokeWidth="1.3" />
					<rect x="23" y="8" width="9" height="8" rx="2.5" fill="#ffd23f" stroke={INK} strokeWidth="1.3" />
					<path d="M25.2 11 H29.8 M25.2 13.5 H28.5" stroke={INK} strokeWidth="1.2" />
				</g>
			)}
			{motif === "origin" && (
				<g>
					{/* Cute globe + coral map pin */}
					<circle cx="16.5" cy="12.5" r="7.2" fill="#4fb3ff" stroke={INK} strokeWidth="1.4" />
					<path d="M12.5 9.5 C14.5 9.2 16 10.6 15.4 12.2 C14.8 13.4 13.2 14.5 12.2 13.5 C11.4 12.6 11.4 10.2 12.5 9.5 Z" fill="#3dd68c" stroke={INK} strokeWidth="1" />
					<path d="M18.2 11 C20.4 10.8 21.8 12.8 20.8 15 C19.5 16.2 17.6 15.2 17.8 13.4 Z" fill="#3dd68c" stroke={INK} strokeWidth="1" />
					<path d="M25.8 5.2 C23.6 5.2 22 6.8 22 8.9 C22 11.7 25.8 15.2 25.8 15.2 C25.8 15.2 29.6 11.7 29.6 8.9 C29.6 6.8 28 5.2 25.8 5.2 Z" fill="#ff7a59" stroke={INK} strokeWidth="1.3" />
					<circle cx="25.8" cy="8.8" r="1.4" fill="#fff5d8" />
				</g>
			)}
			{motif === "work" && (
				<g>
					{/* Golden satchel briefcase */}
					<path d="M14.5 7.5 V6.2 C14.5 5.4 15.2 4.8 16 4.8 H20 C20.8 4.8 21.5 5.4 21.5 6.2 V7.5" fill="none" stroke={INK} strokeWidth="1.4" />
					<rect x="9" y="7.5" width="18" height="11.5" rx="3" fill="#ffb020" stroke={INK} strokeWidth="1.4" />
					<path d="M9 12.2 H27" stroke={INK} strokeWidth="1.3" />
					<rect x="16" y="10.8" width="4" height="3.2" rx="1" fill="#ff7a59" stroke={INK} strokeWidth="1.2" />
				</g>
			)}
			{motif === "family" && (
				<g>
					{/* Cozy house + little heart */}
					<path d="M9.5 11.5 L18 5 L26.5 11.5" fill="#ff7a59" stroke={INK} strokeWidth="1.4" />
					<rect x="11.5" y="11" width="13" height="8.5" rx="1.8" fill="#fff5d8" stroke={INK} strokeWidth="1.4" />
					<rect x="16" y="14.2" width="4" height="5.3" rx="1" fill="#4fb3ff" stroke={INK} strokeWidth="1.2" />
					<path d="M27.8 8.2 C27.8 7 29.4 6.8 29.8 8 C30.2 6.8 31.8 7 31.8 8.2 C31.8 9.6 29.8 10.9 29.8 10.9 C29.8 10.9 27.8 9.6 27.8 8.2 Z" fill="#ff5c7a" stroke={INK} strokeWidth="1" />
				</g>
			)}
			{motif === "listen" && (
				<g>
					{/* Cute headphones + sound waves */}
					<path d="M11 13.5 A7 7 0 0 1 25 13.5" fill="none" stroke={INK} strokeWidth="1.8" />
					<rect x="8.8" y="12" width="4.2" height="6.8" rx="2" fill="#a98bff" stroke={INK} strokeWidth="1.3" />
					<rect x="23" y="12" width="4.2" height="6.8" rx="2" fill="#a98bff" stroke={INK} strokeWidth="1.3" />
					<path d="M16 14.5 Q18 12.2 20 14.5" fill="none" stroke="#ff7a59" strokeWidth="1.5" />
					<circle cx="18" cy="17.2" r="1.2" fill="#ffd23f" stroke={INK} strokeWidth="1" />
				</g>
			)}
			{motif === "say" && (
				<g>
					{/* Two playful speech bubbles */}
					<path d="M7.5 7.5 C7.5 6 8.8 5 10.5 5 H19.5 C21.2 5 22.5 6 22.5 7.5 V12 C22.5 13.5 21.2 14.5 19.5 14.5 H13.5 L10 17.2 L10.6 14.5 H10.5 C8.8 14.5 7.5 13.5 7.5 12 Z" fill="#ff7a59" stroke={INK} strokeWidth="1.3" />
					<path d="M16.5 11.2 C16.5 9.9 17.6 9 19 9 H26.2 C27.6 9 28.8 9.9 28.8 11.2 V14.8 C28.8 16.1 27.6 17 26.2 17 H25.2 L26 19.5 L22.5 17 H19 C17.6 17 16.5 16.1 16.5 14.8 Z" fill="#4fb3ff" stroke={INK} strokeWidth="1.3" />
					<circle cx="12.5" cy="9.8" r="1" fill="#fff5d8" />
					<circle cx="15.8" cy="9.8" r="1" fill="#fff5d8" />
					<circle cx="21" cy="13.2" r="1" fill="#fff5d8" />
					<circle cx="24.2" cy="13.2" r="1" fill="#fff5d8" />
				</g>
			)}
			{motif === "write" && (
				<g>
					{/* Clipboard + yellow pencil */}
					<rect x="9.5" y="5.5" width="12.5" height="14" rx="2.5" fill="#fffdf7" stroke={INK} strokeWidth="1.3" />
					<rect x="13" y="4.2" width="5.5" height="2.6" rx="1" fill="#4fb3ff" stroke={INK} strokeWidth="1.1" />
					<path d="M12.2 10.5 H19.2 M12.2 13.5 H18 M12.2 16.5 H16.8" stroke={INK} strokeWidth="1.1" />
					<path d="M21 15 L26.5 8.2 L29 10.2 L23.5 17 L20.4 17.8 Z" fill="#ffd23f" stroke={INK} strokeWidth="1.3" />
				</g>
			)}
			{motif === "order" && (
				<g>
					{/* Colorful stepping blocks 1-2-3 */}
					<rect x="7" y="12.5" width="6.5" height="6.5" rx="1.8" fill="#ff7a59" stroke={INK} strokeWidth="1.3" />
					<rect x="14.8" y="9" width="6.5" height="10" rx="1.8" fill="#ffd23f" stroke={INK} strokeWidth="1.3" />
					<rect x="22.5" y="5.5" width="6.5" height="13.5" rx="1.8" fill="#3dd68c" stroke={INK} strokeWidth="1.3" />
				</g>
			)}
			{motif === "observe" && (
				<g>
					{/* Friendly magnifying glass */}
					<circle cx="16.5" cy="11" r="5.6" fill="#97d4f7" stroke={INK} strokeWidth="1.5" />
					<path d="M14.2 8.8 A3 3 0 0 1 17.5 8.2" fill="none" stroke="#fffdf7" strokeWidth="1.5" />
					<path d="M20.8 15.2 L26.2 19.6" stroke="#ff7a59" strokeWidth="3.2" />
					<path d="M20.8 15.2 L26.2 19.6" stroke={INK} strokeWidth="1.3" />
				</g>
			)}
			{motif === "measure" && (
				<g>
					{/* Playful analog dial */}
					<path d="M9.5 17.5 A8.5 8.5 0 0 1 26.5 17.5 Z" fill="#fffdf7" stroke={INK} strokeWidth="1.4" />
					<path d="M18 16.5 L22.5 10.8" stroke="#ff7a59" strokeWidth="2" />
					<circle cx="18" cy="16.8" r="2" fill="#ffd23f" stroke={INK} strokeWidth="1.2" />
				</g>
			)}
			{motif === "compare" && (
				<g>
					{/* Balanced comic scale */}
					<path d="M18 5.5 V18.5 M13.5 18.5 H22.5 M10.5 9.2 H25.5" stroke={INK} strokeWidth="1.5" />
					<path d="M8.5 13.5 H14.5 C14.5 15.8 8.5 15.8 8.5 13.5 Z" fill="#ffd23f" stroke={INK} strokeWidth="1.2" />
					<path d="M21.5 13.5 H27.5 C27.5 15.8 21.5 15.8 21.5 13.5 Z" fill="#4fb3ff" stroke={INK} strokeWidth="1.2" />
				</g>
			)}
			{motif === "circuit" && (
				<g>
					{/* Glowing cartoon lightbulb */}
					<circle cx="18" cy="10.5" r="5.2" fill="#ffd23f" stroke={INK} strokeWidth="1.4" />
					<rect x="15.5" y="15.5" width="5" height="3.5" rx="1.2" fill="#c3ccd8" stroke={INK} strokeWidth="1.3" />
					<path d="M18 3.2 V4.2 M9.8 10.5 H11 M25 10.5 H26.2 M12.2 5.4 L13 6.2 M23.8 5.4 L23 6.2" stroke="#ff7a59" strokeWidth="1.4" />
				</g>
			)}
			{motif === "goal" && (
				<g>
					{/* Golden star + coral victory flag */}
					<path d="M12.5 19.5 V5.2" stroke={INK} strokeWidth="1.6" />
					<path d="M12.5 5.5 L25.5 8.8 L12.5 13 Z" fill="#ff7a59" stroke={INK} strokeWidth="1.4" />
					<path d="M26 14 L27.1 16.4 L29.7 16.7 L27.8 18.4 L28.3 20.9 L26 19.6 L23.7 20.9 L24.2 18.4 L22.3 16.7 L24.9 16.4 Z" fill="#ffd23f" stroke={INK} strokeWidth="1.1" />
				</g>
			)}
			{motif === "story" && (
				<g>
					{/* Open storybook with sparkle */}
					<path d="M8.5 7.8 C12 7 15.5 7.5 18 9.2 C20.5 7.5 24 7 27.5 7.8 V18 C24 17.2 20.5 17.7 18 19.2 C15.5 17.7 12 17.2 8.5 18 Z" fill="#fffdf7" stroke={INK} strokeWidth="1.4" />
					<path d="M18 9.2 V19.2" stroke={INK} strokeWidth="1.3" />
					<path d="M11 11.2 H15.2 M11 14 H14.8 M20.8 11.2 H25 M20.8 14 H24.5" stroke="#ff7a59" strokeWidth="1.2" />
					<circle cx="18" cy="5.3" r="1.6" fill="#ffd23f" stroke={INK} strokeWidth="1" />
				</g>
			)}
			{motif === "path" && (
				<g>
					{/* Sunny stepping-stone path */}
					<path d="M8.5 17.5 C12 11 22 15 27.2 7.5" fill="none" stroke={INK} strokeWidth="1.6" strokeDasharray="2.8 2.4" />
					<circle cx="9.2" cy="17.2" r="2.6" fill="#4fb3ff" stroke={INK} strokeWidth="1.3" />
					<circle cx="18.2" cy="13.2" r="2.6" fill="#ffd23f" stroke={INK} strokeWidth="1.3" />
					<circle cx="27" cy="7.6" r="2.8" fill="#3dd68c" stroke={INK} strokeWidth="1.3" />
				</g>
			)}
		</g>
	);
}

/** Standalone SVG wrapper for StoryBadgeGlyph (used in lesson-activity cards). */
export function StoryBadge({
	motif,
	width = 44,
	height = 30,
	className,
}: {
	motif: StoryMotif;
	width?: number;
	height?: number;
	className?: string;
}) {
	return (
		<svg
			viewBox="0 0 36 24"
			width={width}
			height={height}
			aria-hidden="true"
			className={className}
		>
			<StoryBadgeGlyph motif={motif} />
		</svg>
	);
}

/** Expressive hand-drawn storybook character (cel-shaded). */
function ComicCharacter({
	x,
	y,
	variant,
	mood,
	facing = "right",
}: {
	x: number;
	y: number;
	variant: "host" | "learner";
	mood: ComicMood;
	facing?: "left" | "right";
}) {
	const shirt = variant === "host" ? "#ff7a59" : "#4fb3ff";
	const shirtShade = variant === "host" ? "#d34a4b" : "#3386d8";
	const hair = variant === "host" ? "#4b2e39" : "#2f2a44";
	const skin = variant === "host" ? "#ffd6b0" : "#f7c99f";
	const flip = facing === "left" ? -1 : 1;

	return (
		<g transform={`translate(${x}, ${y})`} strokeLinecap="round" strokeLinejoin="round">
			{/* Soft ground shadow */}
			<ellipse cx="0" cy="46" rx="22" ry="5" fill="#1e1b2e" opacity="0.14" />

			{/* Torso / cozy sweater */}
			<path
				d="M-21 44 C-21 26 -14 21 0 21 C14 21 21 26 21 44 Z"
				fill={shirt}
				stroke={INK}
				strokeWidth="2.4"
			/>
			{/* Cel self-shade band on torso */}
			<path
				d="M7 22 C16 24 20 30 20 43 H11 C11 33 10 26 7 22 Z"
				fill={shirtShade}
				opacity="0.7"
			/>
			{/* Collar / badge detail */}
			<path d="M-7 22 Q0 28 7 22" fill="#fffdf7" stroke={INK} strokeWidth="2" />
			{variant === "host" && (
				<rect x="-12" y="30" width="10" height="6.5" rx="2" fill="#ffd23f" stroke={INK} strokeWidth="1.6" />
			)}
			{variant === "learner" && (
				<path d="M-12 23 L-10 43 M12 23 L10 43" stroke="#ffd23f" strokeWidth="3" />
			)}

			{/* Waving hand when friendly or happy */}
			{(mood === "friendly" || mood === "happy") && (
				<g transform={`translate(${flip * 22}, 22)`}>
					<circle cx="0" cy="0" r="6" fill={skin} stroke={INK} strokeWidth="2.2" />
					<path d={`M${flip * 6} -6 Q${flip * 11} -2 ${flip * 8} 4`} fill="none" stroke={INK} strokeWidth="1.8" />
				</g>
			)}

			{/* Thinking hand on chin */}
			{mood === "thinking" && (
				<circle cx={flip * 10} cy="17" r="5.5" fill={skin} stroke={INK} strokeWidth="2.2" />
			)}

			{/* Back hair bun for host */}
			{variant === "host" && (
				<circle cx={-flip * 18} cy="-12" r="8.5" fill={hair} stroke={INK} strokeWidth="2.3" />
			)}

			{/* Big friendly storybook head */}
			<circle cx="0" cy="0" r="21" fill={skin} stroke={INK} strokeWidth="2.5" />

			{/* Hair silhouette */}
			{variant === "host" ? (
				<path
					d="M-21 -3 C-20 -20 -6 -24 4 -22 C16 -20 22 -11 21 -2 C15 -9 6 -11 -4 -9 C-12 -8 -17 -5 -21 -3 Z"
					fill={hair}
					stroke={INK}
					strokeWidth="2.3"
				/>
			) : (
				<path
					d="M-21 -2 C-22 -18 -9 -25 3 -23 C14 -22 22 -13 21 -3 C17 -10 10 -12 4 -10 C0 -14 -7 -12 -12 -8 C-16 -7 -19 -4 -21 -2 Z"
					fill={hair}
					stroke={INK}
					strokeWidth="2.3"
				/>
			)}

			{/* Cute rosy cheeks */}
			<ellipse cx="-11" cy="5.5" rx="3.4" ry="2.2" fill="#ff9aa2" opacity="0.72" />
			<ellipse cx="11" cy="5.5" rx="3.4" ry="2.2" fill="#ff9aa2" opacity="0.72" />

			{/* Eyes + eyebrows based on mood */}
			<g transform={`translate(${flip * 2}, 0)`}>
				{mood === "happy" ? (
					<>
						<path d="M-10 0 Q-7 -4 -4 0" fill="none" stroke={INK} strokeWidth="2.4" />
						<path d="M4 0 Q7 -4 10 0" fill="none" stroke={INK} strokeWidth="2.4" />
					</>
				) : mood === "surprised" ? (
					<>
						<circle cx="-7" cy="-1" r="3.4" fill="#fffdf7" stroke={INK} strokeWidth="2" />
						<circle cx="7" cy="-1" r="3.4" fill="#fffdf7" stroke={INK} strokeWidth="2" />
						<circle cx="-7" cy="-1" r="1.4" fill={INK} />
						<circle cx="7" cy="-1" r="1.4" fill={INK} />
						<path d="M-11 -8 Q-7 -11 -3 -8" fill="none" stroke={INK} strokeWidth="1.9" />
						<path d="M3 -8 Q7 -11 11 -8" fill="none" stroke={INK} strokeWidth="1.9" />
					</>
				) : (
					<>
						<circle cx="-7" cy="-1" r="2.6" fill={INK} />
						<circle cx="7" cy="-1" r="2.6" fill={INK} />
						<circle cx="-7.8" cy="-2" r="0.9" fill="#fffdf7" />
						<circle cx="6.2" cy="-2" r="0.9" fill="#fffdf7" />
						{mood === "curious" && (
							<>
								<path d="M-10.5 -7 Q-7 -8.5 -4 -7" fill="none" stroke={INK} strokeWidth="1.8" />
								<path d="M3.5 -9 Q7 -11.5 10.5 -8.5" fill="none" stroke={INK} strokeWidth="1.8" />
							</>
						)}
						{mood === "confused" && (
							<>
								<path d="M-10.5 -6.5 L-4 -8.2" stroke={INK} strokeWidth="1.8" />
								<path d="M4 -8.2 L10.5 -6.5" stroke={INK} strokeWidth="1.8" />
							</>
						)}
						{mood === "thinking" && (
							<>
								<path d="M-10 -7.5 H-4" stroke={INK} strokeWidth="1.8" />
								<path d="M4 -8.5 Q7 -10 10.5 -8" fill="none" stroke={INK} strokeWidth="1.8" />
							</>
						)}
					</>
				)}

				{/* Round playful glasses for host */}
				{variant === "host" && (
					<g fill="none" stroke={INK} strokeWidth="1.5" opacity="0.85">
						<circle cx="-7" cy="-1" r="5.6" />
						<circle cx="7" cy="-1" r="5.6" />
						<path d="M-1.4 -1 H1.4" />
					</g>
				)}

				{/* Mouth based on mood */}
				{mood === "happy" && (
					<path d="M-6 6.5 Q0 14 6 6.5 Z" fill="#ff5c7a" stroke={INK} strokeWidth="2" />
				)}
				{mood === "friendly" && (
					<path d="M-5.5 7.2 Q0 12.2 5.5 7.2" fill="none" stroke={INK} strokeWidth="2.3" />
				)}
				{mood === "curious" && (
					<path d="M-4 8.5 Q0 10.8 4.5 7.5" fill="none" stroke={INK} strokeWidth="2.2" />
				)}
				{mood === "surprised" && (
					<ellipse cx="0" cy="9.5" rx="3.2" ry="4" fill="#ff5c7a" stroke={INK} strokeWidth="2" />
				)}
				{mood === "thinking" && (
					<path d="M-4 9 Q0 8 4 9.5" fill="none" stroke={INK} strokeWidth="2.1" />
				)}
				{mood === "confused" && (
					<path d="M-5 9.5 Q-2 7.2 0 9.5 T5 9.5" fill="none" stroke={INK} strokeWidth="2.1" />
				)}
			</g>

			{/* Playful comic emotion accents */}
			{mood === "happy" && (
				<path d="M23 -20 L25 -15 L30 -14 L26 -11 L27 -6 L23 -9 L19 -6 L20 -11 L16 -14 L21 -15 Z" fill="#ffd23f" stroke={INK} strokeWidth="1.4" />
			)}
			{mood === "curious" && (
				<g transform="translate(22, -22)">
					<circle cx="0" cy="0" r="7.5" fill="#ffd23f" stroke={INK} strokeWidth="1.7" />
					<path d="M-2 -2 C-2 -4.5 2.5 -4.5 2.5 -1.8 C2.5 0 0 0.5 0 2" fill="none" stroke={INK} strokeWidth="1.8" />
					<circle cx="0" cy="4.4" r="1" fill={INK} />
				</g>
			)}
			{mood === "surprised" && (
				<g stroke="#ff7a59" strokeWidth="2.4">
					<path d="M-26 -18 L-32 -23" />
					<path d="M-28 -8 L-35 -9" />
					<path d="M26 -18 L32 -23" />
				</g>
			)}
			{mood === "thinking" && (
				<g fill="#fffdf7" stroke={INK} strokeWidth="1.6">
					<circle cx="21" cy="-14" r="2.8" />
					<circle cx="27" cy="-21" r="4.2" />
				</g>
			)}
			{mood === "confused" && (
				<path d="M21 -16 C19 -11 23 -9 23 -13 C23 -15 21 -16 21 -16 Z" fill="#4fb3ff" stroke={INK} strokeWidth="1.5" />
			)}
		</g>
	);
}

/** Illustrated storybook backdrop for each of the 8 comic scenes. */
function SceneBackdrop({ scene }: { scene: ComicScene }) {
	switch (scene) {
		case "reception":
			return (
				<g strokeLinecap="round" strokeLinejoin="round">
					<rect width="240" height="126" fill="#fff6e0" />
					{/* Soft mint wall stripe */}
					<rect y="0" width="240" height="82" fill="#e4f7ee" />
					{/* Welcome poster on wall */}
					<rect x="86" y="12" width="68" height="28" rx="6" fill="#ffd23f" stroke={INK} strokeWidth="2" />
					<text x="120" y="30" textAnchor="middle" fill={INK} fontSize="11.5" fontWeight="800" letterSpacing="0.06em">HELLO!</text>
					{/* Cute potted plant */}
					<path d="M204 72 C198 55 206 46 210 56 C214 44 224 53 216 72 Z" fill="#3dd68c" stroke={INK} strokeWidth="2" />
					<path d="M201 72 H219 L216 86 H204 Z" fill="#ff7a59" stroke={INK} strokeWidth="2" />
					{/* Wooden reception desk foreground */}
					<rect x="0" y="96" width="240" height="30" fill="#e5a96d" stroke={INK} strokeWidth="2.2" />
					<rect x="0" y="96" width="240" height="7" fill="#f5c994" stroke={INK} strokeWidth="2" />
					{/* Clipboard form on counter */}
					<rect x="102" y="90" width="28" height="19" rx="3" fill="#fffdf7" stroke={INK} strokeWidth="1.8" />
					<rect x="111" y="88" width="10" height="4" rx="1.5" fill="#4fb3ff" stroke={INK} strokeWidth="1.4" />
					<path d="M107 96 H125 M107 100 H122 M107 104 H119" stroke={INK} strokeWidth="1.3" />
				</g>
			);
		case "cafe":
			return (
				<g strokeLinecap="round" strokeLinejoin="round">
					<rect width="240" height="126" fill="#fff2dc" />
					{/* Arched sunny window */}
					<path d="M88 78 V32 A32 32 0 0 1 152 32 V78 Z" fill="#cdeeff" stroke={INK} strokeWidth="2.2" />
					<circle cx="132" cy="28" r="9" fill="#ffd23f" stroke={INK} strokeWidth="1.8" />
					<path d="M88 52 H152 M120 12 V78" stroke={INK} strokeWidth="1.8" />
					{/* Table top */}
					<rect x="0" y="98" width="240" height="28" fill="#d9945a" stroke={INK} strokeWidth="2.2" />
					{/* Steaming coffee cup */}
					<rect x="108" y="85" width="18" height="15" rx="3" fill="#ffd23f" stroke={INK} strokeWidth="2" />
					<path d="M126 89 C131 89 131 96 126 96" fill="none" stroke={INK} strokeWidth="2" />
					<path d="M113 80 Q115 75 113 72 M119 80 Q121 75 119 72" fill="none" stroke="#ff7a59" strokeWidth="1.8" />
				</g>
			);
		case "classroom":
			return (
				<g strokeLinecap="round" strokeLinejoin="round">
					<rect width="240" height="126" fill="#f7f1e3" />
					{/* Green chalkboard */}
					<rect x="28" y="12" width="184" height="66" rx="8" fill="#2c6e58" stroke="#c8894b" strokeWidth="4.5" />
					<rect x="28" y="12" width="184" height="66" rx="8" fill="none" stroke={INK} strokeWidth="2" />
					<text x="120" y="42" textAnchor="middle" fill="#fff5d8" fontSize="14" fontWeight="700" opacity="0.88">A · B · C</text>
					<path d="M85 55 H155" stroke="#ffd23f" strokeWidth="2" strokeDasharray="5 4" />
					{/* Desk strip */}
					<rect x="0" y="98" width="240" height="28" fill="#e5b97d" stroke={INK} strokeWidth="2.2" />
				</g>
			);
		case "home":
			return (
				<g strokeLinecap="round" strokeLinejoin="round">
					<rect width="240" height="126" fill="#ffece1" />
					{/* Framed picture on wall */}
					<rect x="98" y="16" width="44" height="34" rx="5" fill="#fffdf7" stroke={INK} strokeWidth="2" />
					<circle cx="113" cy="31" r="5" fill="#ffd23f" stroke={INK} strokeWidth="1.5" />
					<circle cx="127" cy="33" r="4.5" fill="#ff7a59" stroke={INK} strokeWidth="1.5" />
					{/* Warm floor lamp */}
					<path d="M206 102 V40" stroke={INK} strokeWidth="2.2" />
					<path d="M192 40 H220 L214 22 H198 Z" fill="#ffd23f" stroke={INK} strokeWidth="2" />
					{/* Cozy floor + rug */}
					<rect x="0" y="98" width="240" height="28" fill="#d9b28a" stroke={INK} strokeWidth="2.2" />
					<ellipse cx="120" cy="112" rx="68" ry="10" fill="#a98bff" stroke={INK} strokeWidth="1.8" />
				</g>
			);
		case "work":
			return (
				<g strokeLinecap="round" strokeLinejoin="round">
					<rect width="240" height="126" fill="#efeaff" />
					{/* Wall clock */}
					<circle cx="120" cy="30" r="14" fill="#fffdf7" stroke={INK} strokeWidth="2" />
					<path d="M120 30 V22 M120 30 L126 32" stroke={INK} strokeWidth="2" />
					{/* Sticky note */}
					<rect x="182" y="20" width="24" height="24" rx="3" fill="#ffd23f" stroke={INK} strokeWidth="1.8" />
					<path d="M187 28 H201 M187 34 H198" stroke={INK} strokeWidth="1.4" />
					{/* Desk + laptop */}
					<rect x="0" y="98" width="240" height="28" fill="#c3ccd8" stroke={INK} strokeWidth="2.2" />
					<path d="M98 100 L103 82 H137 L142 100 Z" fill="#4fb3ff" stroke={INK} strokeWidth="2" />
				</g>
			);
		case "street":
			return (
				<g strokeLinecap="round" strokeLinejoin="round">
					<rect width="240" height="126" fill="#d4f0ff" />
					{/* Fluffy clouds */}
					<path d="M24 32 C24 24 35 22 40 27 C45 20 59 23 58 32 Z" fill="#fffdf7" stroke={INK} strokeWidth="1.7" />
					<path d="M174 28 C174 20 185 18 190 23 C195 16 209 19 208 28 Z" fill="#fffdf7" stroke={INK} strokeWidth="1.7" />
					{/* Townhouses */}
					<rect x="16" y="54" width="52" height="50" fill="#ffd8c7" stroke={INK} strokeWidth="2" />
					<rect x="168" y="48" width="56" height="56" fill="#fff1bf" stroke={INK} strokeWidth="2" />
					{/* Street sign */}
					<path d="M120 100 V46" stroke={INK} strokeWidth="2.4" />
					<rect x="96" y="42" width="48" height="15" rx="4" fill="#3dd68c" stroke={INK} strokeWidth="1.8" />
					{/* Sidewalk */}
					<rect x="0" y="100" width="240" height="26" fill="#d9d2c5" stroke={INK} strokeWidth="2.2" />
				</g>
			);
		case "lab":
			return (
				<g strokeLinecap="round" strokeLinejoin="round">
					<rect width="240" height="126" fill="#eaf6ff" />
					{/* Glowing lightbulb + spark */}
					<circle cx="120" cy="30" r="13" fill="#ffd23f" stroke={INK} strokeWidth="2.1" />
					<rect x="114" y="42" width="12" height="7" rx="2" fill="#c3ccd8" stroke={INK} strokeWidth="1.8" />
					<path d="M120 10 V13 M98 30 H102 M138 30 H142 M104 16 L107 19 M136 16 L133 19" stroke="#ff7a59" strokeWidth="2.2" />
					{/* Workbench + meter */}
					<rect x="0" y="98" width="240" height="28" fill="#d9c6a3" stroke={INK} strokeWidth="2.2" />
					<rect x="102" y="82" width="36" height="20" rx="4" fill="#fffdf7" stroke={INK} strokeWidth="2" />
					<path d="M120 98 L128 88" stroke="#ff7a59" strokeWidth="2" />
				</g>
			);
		case "park":
			return (
				<g strokeLinecap="round" strokeLinejoin="round">
					<rect width="240" height="126" fill="#d2f1ff" />
					{/* Smiling sun */}
					<circle cx="204" cy="26" r="13" fill="#ffd23f" stroke={INK} strokeWidth="2" />
					{/* Puffy cartoon tree */}
					<rect x="34" y="64" width="12" height="36" fill="#b26b3b" stroke={INK} strokeWidth="2" />
					<circle cx="40" cy="52" r="22" fill="#3dd68c" stroke={INK} strokeWidth="2.2" />
					{/* Grass hill */}
					<path d="M0 100 Q120 86 240 100 V126 H0 Z" fill="#85e0a3" stroke={INK} strokeWidth="2.2" />
				</g>
			);
	}
}

/**
 * Full illustrated comic panel scene with expressive cel-shaded characters.
 * Pure SVG (SSR-safe, deterministic, works in both Cel Noite and Cel Papel).
 */
export function ComicPanelArt({
	scene,
	mood,
	speaker,
	hasReply,
}: {
	scene: ComicScene;
	mood: ComicMood;
	speaker: string;
	hasReply: boolean;
}) {
	const speakerIsLearner = /\b(voce|aluno|aluna|you|estudante|eu)\b/.test(normalizeText(speaker));
	const primaryVariant = speakerIsLearner ? "learner" : "host";
	const secondaryVariant = speakerIsLearner ? "host" : "learner";
	return (
		<svg
			viewBox="0 0 240 126"
			className="comic-scene-svg"
			role="img"
			aria-hidden="true"
		>
			<SceneBackdrop scene={scene} />
			{hasReply ? (
				<>
					<ComicCharacter x={64} y={64} variant={primaryVariant} mood={mood} facing="right" />
					<ComicCharacter x={176} y={64} variant={secondaryVariant} mood="friendly" facing="left" />
				</>
			) : (
				<ComicCharacter x={120} y={64} variant={primaryVariant} mood={mood} facing="right" />
			)}
		</svg>
	);
}
