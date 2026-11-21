export default function LoadingBookReader() {
	return (
		<main role="status" aria-busy="true" className="book-reader">
			<div aria-hidden="true" className="motion-safe:animate-pulse">
				<div className="h-4 w-32 rounded bg-muted" />
				<header className="space-y-2">
					<div className="h-4 w-40 rounded bg-muted" />
					<div className="h-9 w-2/3 max-w-xl rounded-md bg-muted" />
				</header>

				<div className="reader-nav">
					<div className="h-9 w-28 rounded-lg bg-muted" />
					<div className="h-9 w-24 rounded-lg bg-muted" />
					<div className="h-9 w-28 rounded-lg bg-muted" />
					<div className="ml-auto h-5 w-40 rounded bg-muted" />
				</div>

				<div className="reader-layout">
					<div className="reader-paper space-y-4">
						<div className="h-6 w-2/5 rounded bg-muted" />
						<div className="space-y-2.5">
							<div className="h-4 w-full rounded bg-muted" />
							<div className="h-4 w-11/12 rounded bg-muted" />
							<div className="h-4 w-5/6 rounded bg-muted" />
							<div className="h-4 w-full rounded bg-muted" />
							<div className="h-4 w-4/5 rounded bg-muted" />
						</div>
						<div className="h-64 w-full rounded-lg bg-muted/60" />
						<div className="space-y-2.5">
							<div className="h-4 w-full rounded bg-muted" />
							<div className="h-4 w-10/12 rounded bg-muted" />
							<div className="h-4 w-3/4 rounded bg-muted" />
						</div>
					</div>
					<aside className="cel-card reader-actions">
						<div className="h-5 w-36 rounded bg-muted" />
						<div className="h-4 w-full rounded bg-muted" />
						<div className="h-24 w-full rounded-lg bg-muted/70" />
						<div className="h-10 w-full rounded-lg bg-muted" />
					</aside>
				</div>
			</div>
		</main>
	);
}
