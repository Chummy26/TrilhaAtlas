const { randomBytes, timingSafeEqual } = require("node:crypto");
const { createServer, request } = require("node:http");
const { HEADER } = require("./desktop-api.cjs");

const HOSTNAME = "trilhaatlas.localhost";
const PAIRING_PATH = "/__trilhaatlas/browser";
const COOKIE = "trilhaatlas_browser";
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

function filteredHeaders(headers) {
	const connection = String(headers.connection ?? "").toLowerCase().split(",").map((name) => name.trim());
	return Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP_HEADERS.has(name) && !connection.includes(name)));
}

function matchesToken(value, expected) {
	return typeof value === "string" && value.length === expected.length && timingSafeEqual(Buffer.from(value, "latin1"), Buffer.from(expected));
}

function refuse(res, code, message) {
	res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
	res.end(message);
}

function forward(req, res, upstreamPort, secret) {
	const headers = filteredHeaders(req.headers);
	delete headers.cookie;
	delete headers.forwarded;
	for (const name of Object.keys(headers)) {
		if (name.startsWith("x-forwarded-")) delete headers[name];
	}
	headers[HEADER] = secret;
	const upstream = request({ hostname: "127.0.0.1", port: upstreamPort, path: req.url, method: req.method, headers }, (reply) => {
		const responseHeaders = filteredHeaders(reply.headers);
		delete responseHeaders["set-cookie"];
		res.writeHead(reply.statusCode, {
			...responseHeaders,
			"cache-control": "no-store",
			"referrer-policy": "no-referrer",
		});
		reply.on("error", (error) => res.destroy(error));
		reply.pipe(res);
	});
	upstream.on("error", () => {
		if (res.headersSent) res.destroy();
		else refuse(res, 502, "O servidor do TrilhaAtlas está indisponível.");
	});
	res.once("close", () => upstream.destroy());
	req.pipe(upstream);
}

async function startBrowserGateway({ upstreamPort, secret, port = 43387 }) {
	const browserSession = randomBytes(32).toString("hex");
	let pairing;
	let host;
	let origin;
	const server = createServer((req, res) => {
		if (!host || req.headers.host !== host || !req.url?.startsWith("/") || req.url.startsWith("//")) {
			return refuse(res, 403, "Endereço local inválido.");
		}
		const url = new URL(req.url, origin);
		if (url.origin !== origin) return refuse(res, 403, "Endereço local inválido.");
		if (url.pathname === PAIRING_PATH) {
			if (req.method !== "GET" || !pairing || Date.now() > pairing.expires || !matchesToken(url.searchParams.get("code"), pairing.code)) {
				return refuse(res, 403, "Abra o navegador novamente pelo aplicativo TrilhaAtlas.");
			}
			pairing = undefined;
			res.writeHead(303, {
				Location: "/",
				"Set-Cookie": `${COOKIE}=${browserSession}; Path=/; HttpOnly; SameSite=Strict`,
				"Cache-Control": "no-store",
				"Referrer-Policy": "no-referrer",
			});
			return res.end();
		}
		const cookie = String(req.headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(COOKIE + "="));
		if (!matchesToken(cookie?.slice(COOKIE.length + 1), browserSession)) {
			return refuse(res, 403, "Use Exibir → Abrir no navegador no aplicativo TrilhaAtlas.");
		}
		const site = req.headers["sec-fetch-site"];
		if ((req.headers.origin && req.headers.origin !== origin) ||
			(site && site !== "same-origin" && (site !== "none" || !READ_METHODS.has(req.method)))) {
			return refuse(res, 403, "Acesso entre sites recusado.");
		}
		forward(req, res, upstreamPort, secret);
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
	const boundPort = server.address().port;
	host = `${HOSTNAME}:${boundPort}`;
	origin = `http://${host}`;
	return {
		host,
		port: boundPort,
		pairingUrl() {
			pairing = { code: randomBytes(32).toString("hex"), expires: Date.now() + 60_000 };
			return origin + PAIRING_PATH + "?code=" + pairing.code;
		},
		close() {
			server.close();
			server.closeAllConnections();
		},
	};
}

module.exports = { startBrowserGateway };
