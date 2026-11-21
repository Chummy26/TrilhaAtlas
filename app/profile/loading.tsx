export default function LoadingProfile() {
	return (
		<div role="status" aria-busy="true" className="h-dvh overflow-y-auto">
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			<div aria-hidden="true" className="mx-auto w-full max-w-3xl px-4 pb-16 pt-12 motion-safe:animate-pulse">
				<div className="mb-6 flex items-center gap-3">
					<div className="h-9 w-24 rounded-lg border border-border bg-card" />
					<div className="h-8 w-40 rounded-md bg-muted" />
				</div>

				<section className="cel-card mb-5 flex flex-wrap items-center gap-4 p-5">
					<div className="size-20 shrink-0 rounded-full border-4 border-border bg-muted" />
					<div className="min-w-48 flex-1 space-y-2.5">
						<div className="flex items-center justify-between gap-2">
							<div className="h-6 w-28 rounded bg-muted" />
							<div className="h-4 w-32 rounded bg-muted" />
						</div>
						<div className="h-2.5 w-full rounded-full bg-muted" />
						<div className="h-3.5 w-48 rounded bg-muted" />
					</div>
				</section>

				<div className="mb-5 grid gap-4 sm:grid-cols-3">
					<div className="cel-card h-24 p-4">
						<div className="h-3.5 w-20 rounded bg-muted" />
						<div className="mt-3 h-7 w-24 rounded bg-muted" />
					</div>
					<div className="cel-card h-24 p-4">
						<div className="h-3.5 w-24 rounded bg-muted" />
						<div className="mt-3 h-7 w-20 rounded bg-muted" />
					</div>
					<div className="cel-card h-24 p-4">
						<div className="h-3.5 w-20 rounded bg-muted" />
						<div className="mt-3 h-7 w-28 rounded bg-muted" />
					</div>
				</div>

				<section className="cel-card space-y-3 p-5">
					<div className="h-5 w-44 rounded bg-muted" />
					<div className="h-32 w-full rounded-lg bg-muted/60" />
				</section>
			</div>
		</div>
	);
}
