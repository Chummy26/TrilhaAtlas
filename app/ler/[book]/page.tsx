import { notFound } from "next/navigation";
import { BookReader } from "@/components/study/book-reader.tsx";
import { StudyHeartbeat } from "@/components/study/study-heartbeat.tsx";
import { regionalBookUnit, StudyError } from "@/src/server";

export const dynamic = "force-dynamic";

export default async function ReadingPage({ params, searchParams }: {
	params: Promise<{ book: string }>;
	searchParams: Promise<{ domain?: string; region?: string; node?: string; unit?: string }>;
}) {
	const { book } = await params;
	const { domain, region, node, unit } = await searchParams;
	if (!domain || !region || !node) notFound();
	let page;
	try {
		page = await regionalBookUnit(domain, region, book, Number(unit ?? 1), true);
	} catch (error) {
		if (error instanceof StudyError) notFound();
		throw error;
	}
	return <>
		<StudyHeartbeat domain={domain} kind="reading" />
		<BookReader key={[domain, region, node, book, page.unit].join("/")} {...{ domain, region, node, book, page }} />
	</>;
}
