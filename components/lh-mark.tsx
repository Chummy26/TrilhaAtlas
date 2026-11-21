export function TrilhaAtlasMark({ className = "" }: { className?: string }) {
	// eslint-disable-next-line @next/next/no-img-element -- fixed-size vector shared with the desktop icons.
	return <img src="/trilhaatlas.svg" width={24} height={24} alt="" className={className} />;
}
