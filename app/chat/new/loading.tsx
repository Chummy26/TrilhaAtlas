export default function LoadingNewSession() {
	return (
		<div role="status" aria-busy="true" className="study-session-start relative flex h-dvh min-w-0 flex-col overflow-hidden">
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			<header aria-hidden="true" className="flex items-center gap-2 px-3 py-2 motion-safe:animate-pulse">
				<div className="size-9 rounded-lg border border-border bg-card" />
				<div className="h-9 w-36 rounded-lg border border-border bg-card" />
			</header>

			<div aria-hidden="true" className="flex flex-1 flex-col items-center justify-center gap-2 px-4 motion-safe:animate-pulse">
				<div className="h-6 w-44 rounded bg-muted" />
				<div className="h-4 w-72 rounded bg-muted" />
			</div>

			<div aria-hidden="true" className="w-full pb-4">
				<div className="mx-auto w-full max-w-[46rem] space-y-2.5 px-4 motion-safe:animate-pulse">
					<div className="flex h-14 items-center justify-between rounded-2xl border border-border bg-card px-3.5 shadow-lg">
						<div className="h-4 w-48 rounded bg-muted" />
						<div className="size-10 rounded-[10px] bg-muted" />
					</div>
					<div className="flex items-center justify-between px-1">
						<div className="h-6 w-32 rounded-full bg-muted" />
						<div className="h-6 w-28 rounded-full bg-muted" />
					</div>
				</div>
			</div>
		</div>
	);
}
