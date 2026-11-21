export default function LoadingSyllabus() {
	return (
		<main role="status" aria-busy="true" className="h-dvh overflow-y-auto px-4 pb-16 pt-6 md:px-8">
			<div aria-hidden="true" className="mx-auto w-full max-w-5xl space-y-5 motion-safe:animate-pulse">
				<header className="space-y-3">
					<div className="flex flex-wrap items-center justify-between gap-2.5">
						<div className="h-9 w-28 rounded-lg border border-border bg-card" />
						<div className="flex items-center gap-2">
							<div className="h-9 w-32 rounded-lg border border-border bg-card" />
							<div className="h-9 w-32 rounded-lg border border-border bg-card" />
						</div>
					</div>
					<div className="flex flex-wrap items-end justify-between gap-3">
						<div className="space-y-2">
							<div className="h-8 w-64 rounded-md bg-muted" />
							<div className="h-3.5 w-80 rounded bg-muted" />
						</div>
						<div className="flex flex-wrap gap-1.5">
							<div className="h-9 w-24 rounded-full border border-border bg-card" />
							<div className="h-9 w-24 rounded-full border border-border bg-card" />
							<div className="h-9 w-28 rounded-full border border-border bg-card" />
						</div>
					</div>
				</header>

				<div className="flex flex-wrap gap-2">
					<div className="h-8 w-20 rounded-full bg-muted" />
					<div className="h-8 w-24 rounded-full bg-muted" />
					<div className="h-8 w-20 rounded-full bg-muted" />
					<div className="h-8 w-24 rounded-full bg-muted" />
				</div>

				<div className="space-y-4">
					{[0, 1, 2].map((index) => (
						<section key={index} className="cel-card space-y-3 p-5">
							<div className="flex items-center justify-between gap-3">
								<div className="h-5 w-56 rounded bg-muted" />
								<div className="h-5 w-20 rounded-full bg-muted" />
							</div>
							<div className="h-2 w-full rounded-full bg-muted" />
							<div className="grid gap-2 pt-1">
								<div className="h-11 w-full rounded-lg border border-border/60 bg-background/60" />
								<div className="h-11 w-full rounded-lg border border-border/60 bg-background/60" />
							</div>
						</section>
					))}
				</div>
			</div>
		</main>
	);
}
