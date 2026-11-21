/** Older clients posted self-assessments here. Only the teacher tool closes a campaign mission. */
export function POST() {
	return Response.json({ error: "O professor conclui o nó depois de avaliar o seu desempenho." }, { status: 403 });
}
