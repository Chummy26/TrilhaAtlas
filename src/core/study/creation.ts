export type DomainCreationStatus =
	| { state: "planning" | "materials"; done: number; total: number }
	| { state: "ready"; domainId: string; title: string }
	| { state: "failed"; error: string };
