export default function LoadingChat() {
	return (
		<div role="status" className="flex min-w-0 flex-1 flex-col gap-5 px-6 py-5">
			<p className="text-base text-muted-foreground">Abrindo conversa…</p>
			<div aria-hidden="true" className="grid max-w-prose gap-3 motion-safe:animate-pulse">
				<div className="h-4 w-2/3 rounded bg-muted" />
				<div className="h-4 w-5/6 rounded bg-muted" />
				<div className="h-4 w-1/2 rounded bg-muted" />
			</div>
		</div>
	);
}
