import type { ArtifactPartProps } from "@/src/core";

export function ReviewPrepared({ part }: ArtifactPartProps) {
	if (part.state === "output-error") return <p role="status">Não foi possível preparar a revisão.</p>;
	if (part.state !== "output-available") return null;
	const message = (part.output as { message?: unknown } | undefined)?.message;
	return <p className="text-sm text-muted-foreground">{typeof message === "string" ? message : "Revisão da habilidade · painel Hoje"}</p>;
}
