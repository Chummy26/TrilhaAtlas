export default function LoadingChat() {
	return (
		<div role="status" aria-busy="true" className="flex h-dvh min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			<header aria-hidden="true" className="lh-drag lh-wco-gutter flex h-15 shrink-0 items-center gap-3 border-b border-border px-3 motion-safe:animate-pulse">
				<div className="size-9 rounded-lg bg-muted" />
				<div className="h-7 w-56 rounded-md bg-muted" />
			</header>

			<div aria-hidden="true" className="mx-auto flex w-full max-w-[46rem] flex-1 flex-col gap-6 px-4 py-6 motion-safe:animate-pulse">
				<div className="ml-auto h-10 w-56 rounded-2xl border border-border bg-card" />
				<div className="grid max-w-prose gap-3">
					<div className="h-4 w-2/3 rounded bg-muted" />
					<div className="h-4 w-5/6 rounded bg-muted" />
					<div className="h-4 w-1/2 rounded bg-muted" />
				</div>
				<div className="grid max-w-prose gap-3 pt-2">
					<div className="h-4 w-4/5 rounded bg-muted" />
					<div className="h-4 w-3/5 rounded bg-muted" />
				</div>
			</div>

			<div aria-hidden="true" className="mx-auto w-full max-w-[46rem] px-4 pb-4 motion-safe:animate-pulse">
				<div className="flex h-14 items-center justify-between rounded-2xl border border-border bg-card px-3.5 shadow-lg">
					<div className="h-4 w-44 rounded bg-muted" />
					<div className="size-10 rounded-[10px] bg-muted" />
				</div>
			</div>
		</div>
	);
}
