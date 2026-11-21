// The dev server is externally launched and may still be building core packages
// or compiling its first route. Do not navigate Electron to a refused connection.
const http = require("node:http");
const https = require("node:https");

/**
 * Any HTTP response is ready: a Next development error page must remain visible.
 * A single total deadline also bounds connected servers that never send headers.
 * @param {string} url
 * @param {{signal?: AbortSignal, timeoutMs?: number, retryMs?: number, maxRetryMs?: number}} [options]
 * @returns {Promise<void>}
 */
async function waitForDevServer(url, { signal, timeoutMs = 30000, retryMs, maxRetryMs } = {}) {
	const target = new URL(url);
	const transport = target.protocol === "http:" ? http : target.protocol === "https:" ? https : null;
	if (!transport) throw new Error("Development server URL must use HTTP or HTTPS");
	const initialDelay = retryMs ?? 25;
	const maxDelay = maxRetryMs ?? (retryMs ?? 100);
	return new Promise((resolve, reject) => {
		let settled = false;
		let activeRequest;
		let retryTimer;
		let lastError;
		let nextDelay = initialDelay;
		const finish = (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(deadline);
			clearTimeout(retryTimer);
			signal?.removeEventListener("abort", abort);
			activeRequest?.destroy();
			if (error) reject(error);
			else resolve();
		};
		const abort = () => finish(signal.reason instanceof Error ? signal.reason : new Error("Development server startup cancelled"));
		const deadline = setTimeout(() => finish(new Error(
			`Development server ${url} did not respond within ${timeoutMs}ms`, { cause: lastError },
		)), timeoutMs);
		const attempt = () => {
			if (settled) return;
			const request = transport.get(target, { agent: false }, response => {
				response.on("error", () => {}); // Closing an unneeded response is intentional.
				response.resume();
				finish();
			});
			activeRequest = request;
			request.once("error", error => {
				if (settled) return;
				lastError = error;
				activeRequest = undefined;
				request.destroy();
				const delay = nextDelay;
				nextDelay = Math.min(nextDelay * 2, maxDelay);
				retryTimer = setTimeout(attempt, delay);
			});
		};
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
		else attempt();
	});
}
module.exports = { waitForDevServer };
