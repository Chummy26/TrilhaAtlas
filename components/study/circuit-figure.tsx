"use client";

import { useId, type CSSProperties } from "react";

export function CircuitFigure({ board, volts, resistance, closed }: { board: boolean; volts: number; resistance: number; closed: boolean }) {
	const pattern = useId();
	const x1 = 140, x2 = 248, x3 = 356;
	const path = board ? "M56 95 H140 V78 H158 M229 78 H248 V96 H356 V150 Q356 164 342 164 H73 Q56 164 56 147 V138"
		: "M65 99 V55 H146 l8 -11 11 22 11 -22 11 22 11 -22 11 22 8 -11 H335 V161 H65 V115";
	return <svg viewBox="0 0 420 206" className="lab-figure" role="img" aria-label={`${board ? "Protoboard" : "Esquema"} com fonte de ${volts} volts, resistor de ${resistance} quilohms e chave ${closed ? "fechada" : "aberta"}.`}>
		{board ? <>
			<defs><pattern id={pattern} width="18" height="18" x="131" y="51" patternUnits="userSpaceOnUse">
				<rect x="6.5" y="6.5" width="5" height="5" rx="1.4" fill="var(--lab-hole)" />
			</pattern></defs>
			<rect x="106" y="30" width="284" height="132" rx="10" fill="var(--lab-board)" />
			<path d="M117 40h260 M117 151h260" stroke="var(--lab-hole)" strokeOpacity=".3" />
			<rect x="117" y="52" width="262" height="93" fill={`url(#${pattern})`} />
			<g fill="none" strokeWidth="2" stroke="var(--lab-hole)" opacity=".5">
				{[x1,x2,x3].map(x => <path key={x} d={`M${x} 60v72`} />)}
			</g>
			<rect x="14" y="78" width="61" height="69" rx="8" fill="var(--card)" stroke="currentColor" />
			<text x="24" y="103">+</text><text x="24" y="136">−</text>
			<path d="M56 95 H140 V78" className="lab-wire lab-positive" />
			<path d="M248 78 V96" className="lab-wire lab-jumper" />
			<path d="M356 96 V150 Q356 164 342 164 H73 Q56 164 56 147 V138" className="lab-wire lab-return" />
			<path d="M140 78 H248" stroke="var(--lab-hole)" strokeWidth="4" />
			<rect x="160" y="68" width="67" height="20" rx="8" fill="#b98d62" stroke="var(--lab-hole)" strokeWidth="2" />
			<text x="194" y="83" textAnchor="middle" fill="#18191b" fontSize="14">R1</text>
			<path d={closed ? "M248 96 H356" : "M248 96 l93 -23"} stroke="var(--lab-hole)" strokeWidth="5" strokeLinecap="round" />
			{[x2,x3].map(x => <circle key={x} cx={x} cy="96" r="4" fill="var(--lab-hole)" />)}
			<text x="304" y="88" textAnchor="middle" fill="#18191b" fontSize="12">S1</text>
			<text x="106" y="193">{volts} V</text><text x="260" y="193">R1 · {resistance} kΩ</text>
		</> : <>
			<path d="M65 99 V55 H146 l8 -11 11 22 11 -22 11 22 11 -22 11 22 8 -11 H335 V86 M335 118 V161 H65 V115" className="lab-wire" />
			<path d={closed ? "M335 86 V118" : "M335 86 L357 114"} className="lab-wire" />
			<circle cx="335" cy="86" r="4" fill="currentColor" /><circle cx="335" cy="118" r="4" fill="currentColor" />
			<path d="M49 99 H81 M56 115 H74" className="lab-wire" />
			<text x="39" y="108" textAnchor="end">{volts} V</text><text x="182" y="30" textAnchor="middle">{resistance} kΩ</text>
			{closed && volts > 0 && <text x="188" y="120" className="lab-current" textAnchor="middle">I →</text>}
		</>}
		{closed && volts > 0 && <path d={path} className="lab-flow" style={{ "--flow-duration": `${Math.max(.45, 2.8 / Math.sqrt(volts / resistance))}s` } as CSSProperties} />}
	</svg>;
}
