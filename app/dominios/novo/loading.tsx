export default function LoadingNewDomain() {
	return (
		<main role="status" aria-busy="true" className="h-dvh overflow-y-auto px-5 py-10">
			<div aria-hidden="true" className="mx-auto max-w-2xl space-y-5 motion-safe:animate-pulse">
				<div className="space-y-2">
					<div className="h-4 w-32 rounded bg-muted" />
					<div className="h-9 w-64 rounded-md bg-muted" />
				</div>

				<div className="cel-card space-y-5 p-6">
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<div className="h-4 w-44 rounded bg-muted" />
							<div className="h-3.5 w-16 rounded bg-muted" />
						</div>
						<div className="h-36 w-full rounded-lg border border-border bg-background" />
					</div>

					<div className="space-y-2.5">
						<div className="h-4 w-40 rounded bg-muted" />
						<div className="grid gap-2 sm:grid-cols-3">
							<div className="h-20 rounded-xl border border-border bg-background" />
							<div className="h-20 rounded-xl border border-border bg-background" />
							<div className="h-20 rounded-xl border border-border bg-background" />
						</div>
					</div>

					<div className="h-10 w-44 rounded-lg bg-muted" />
				</div>
			</div>
		</main>
	);
}
