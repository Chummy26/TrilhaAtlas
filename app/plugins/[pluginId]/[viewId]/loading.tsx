export default function LoadingPluginView() {
	return (
		<div role="status" aria-busy="true" className="flex h-dvh min-w-0 flex-col">
			<header aria-hidden="true" className="lh-drag lh-wco-gutter flex h-15 shrink-0 items-center gap-3 border-b border-border px-3 motion-safe:animate-pulse">
				<div className="size-9 rounded-lg bg-muted" />
				<div className="h-7 w-48 rounded-md bg-muted" />
				<div className="min-w-4 flex-1" />
				<div className="size-9 rounded-lg bg-muted" />
			</header>

			<div aria-hidden="true" className="flex-1 overflow-y-auto px-5 py-5 motion-safe:animate-pulse">
				<div className="mx-auto max-w-4xl space-y-4">
					<div className="cel-card space-y-3 p-5">
						<div className="h-5 w-44 rounded bg-muted" />
						<div className="h-4 w-3/4 rounded bg-muted" />
						<div className="h-4 w-1/2 rounded bg-muted" />
					</div>
					<div className="cel-card grid gap-3 p-5 sm:grid-cols-2">
						<div className="h-24 rounded-lg bg-muted/60" />
						<div className="h-24 rounded-lg bg-muted/60" />
					</div>
				</div>
			</div>
		</div>
	);
}
