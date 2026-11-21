import { NextResponse } from "next/server";
import { resolveLocale } from "@/src/core";
import { localeDictionary } from "@/src/server";

/** Returns the flat message dictionary for a single requested interface locale. */
export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const locale = resolveLocale(searchParams.get("locale"));
	const messages = localeDictionary(locale);
	return NextResponse.json(
		{ locale, messages },
		{ headers: { "Cache-Control": "public, max-age=3600" } },
	);
}
