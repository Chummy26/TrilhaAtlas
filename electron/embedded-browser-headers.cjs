"use strict";

/**
 * Strip Electron / app brand tokens from the default User-Agent so embedded
 * educational sites see a standard desktop Chrome User-Agent.
 */
function cleanChromeUserAgent(ua) {
	if (typeof ua !== "string") return "";
	return ua
		.replace(/\s+(?:Electron|TrilhaAtlas|LearnHarness)\/[^\s]+/gi, "")
		.replace(/\s{2,}/g, " ")
		.trim();
}

/**
 * Rewrite a Set-Cookie line on an HTTPS subframe response so Chromium allows
 * the cookie inside the embedded browser iframe (SameSite=None; Secure).
 */
function allowCookieInHttpsSubframe(cookieLine) {
	if (typeof cookieLine !== "string" || !cookieLine.trim()) return cookieLine;
	let next = cookieLine.replace(/;\s*SameSite\s*=\s*(?:Lax|Strict|None)/gi, "");
	if (!/;\s*Secure\b/i.test(next)) next += "; Secure";
	next += "; SameSite=None";
	return next;
}

/**
 * Relax X-Frame-Options, CSP frame-ancestors, and SameSite cookie restrictions
 * for external HTTPS pages rendered inside the embedded study browser iframe.
 */
function embeddedSubframeResponseHeaders(details, appOrigin) {
	const rawHeaders = details?.responseHeaders;
	if (!rawHeaders || typeof rawHeaders !== "object") return rawHeaders;

	let parsedUrl;
	try {
		parsedUrl = new URL(details.url);
	} catch {
		return rawHeaders;
	}
	if (parsedUrl.origin === appOrigin) return rawHeaders;
	if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") return rawHeaders;

	const isSubFrameDoc = details.resourceType === "subFrame";
	const isInsideSubFrame =
		isSubFrameDoc ||
		Boolean(details.frame && details.webContents && details.frame !== details.webContents.mainFrame);
	if (!isInsideSubFrame) return rawHeaders;

	const out = {};
	for (const [key, value] of Object.entries(rawHeaders)) {
		const lower = key.toLowerCase();
		if (isSubFrameDoc && lower === "x-frame-options") {
			continue;
		}
		if (isSubFrameDoc && (lower === "content-security-policy" || lower === "content-security-policy-report-only")) {
			const list = Array.isArray(value) ? value : [String(value)];
			const cleaned = list
				.map((policy) =>
					String(policy)
						.replace(/(?:^|;)\s*frame-ancestors\s+[^;]*/gi, "")
						.replace(/^;\s*/, "")
						.trim(),
				)
				.filter(Boolean);
			if (cleaned.length > 0) out[key] = cleaned;
			continue;
		}
		if (parsedUrl.protocol === "https:" && lower === "set-cookie") {
			const list = Array.isArray(value) ? value : [String(value)];
			out[key] = list.map(allowCookieInHttpsSubframe);
			continue;
		}
		out[key] = value;
	}
	return out;
}

module.exports = {
	allowCookieInHttpsSubframe,
	cleanChromeUserAgent,
	embeddedSubframeResponseHeaders,
};
