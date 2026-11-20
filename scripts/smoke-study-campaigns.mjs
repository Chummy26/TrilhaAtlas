// Run against a disposable app with the named domains installed.
// node scripts/smoke-study-campaigns.mjs http://127.0.0.1:PORT electronics map-reading topography
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const [address, ...args] = process.argv.slice(2);
// --teach spends one configured model turn on the last domain in the list.
const teach = args.includes("--teach");
const domains = args.filter(arg => arg !== "--teach");
const origin = new URL(address).origin;
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname) && domains.length);
const select = async active => {
	const response = await fetch(origin + "/api/domains", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) });
	assert.ok(response.ok, await response.text());
};
const initial = await (await fetch(origin + "/api/domains")).json();
const browser = await puppeteer.launch({ executablePath: process.env.LH_TEST_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
	const page = await browser.newPage();
	page.setDefaultTimeout(90_000);
	await page.setViewport({ width: 390, height: 844 });
	await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
	for (const domain of domains) {
		await select(domain);
		const today = await (await fetch(origin + "/api/study/today")).json();
		assert.equal(today.domain.id, domain);
		const current = today.chapters.find(c => c.known < c.total);
		assert.ok(current && today.next?.kind === "new", "expected a fresh test learner");
		const card = `[data-testid="today-card"][data-domain="${domain}"]`;
		const chatIds = async () => (await (await fetch(origin + "/api/chats")).json()).chats.map(c => c.id).sort();
		const before = await chatIds();
		for (const mode of ["teach", "practice"]) {
			await page.goto(origin + "/chat/new" + (mode === "practice" ? "?mode=practice" : ""));
			await page.waitForSelector(card + " .study-campaign");
			assert.ok(await page.$eval(card, (el, title) => el.innerText.includes(title), today.next.brief.title));
			assert.equal(await page.$eval('[data-testid="profile-link"]', el => el.getAttribute("href")), "/profile");
			for (const id of ["profile-link", "open-chain-table"]) {
				assert.ok(await page.$eval(`[data-testid="${id}"]`, el => {
					const box = el.getBoundingClientRect();
					return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
				}), id + " covered by another control");
			}
			assert.equal(await page.$eval(`[data-testid="home-mode-${mode}"]`, el => el.getAttribute("aria-pressed")), "true");
			await page.focus('[data-testid="domain-switcher"] button');
			await page.keyboard.press("Enter");
			await page.waitForSelector('[role=listbox] [role=option][aria-selected=true]');
			await page.keyboard.press("Enter");
			await page.focus('[data-testid="open-chain-table"]');
			await page.keyboard.press("Enter");
			await page.waitForSelector('[data-testid="chain-table-overlay"]');
			await page.focus('button[aria-label="Close chains"]');
			await page.keyboard.press("Enter");
			await page.waitForSelector('[data-testid="chain-table-overlay"]', { hidden: true });
		}
		assert.deepEqual(await chatIds(), before, "opening new-session views created a chat");
		await page.goto(origin);
		await page.waitForSelector(card + " .study-campaign nav a[aria-current=step]");
		assert.ok(await page.$eval(card, el => el.innerText.includes("Começar missão")));
		assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		const summary = await page.waitForSelector(card + " .study-campaign details summary");
		await summary.focus();
		await page.keyboard.press("Enter");
		const links = await page.$$eval(card + " .study-campaign details[open] a", nodes => nodes.map(node => node.href));
		assert.deepEqual(links.map(link => new URL(link).searchParams.get("no")), current.landmarks.map(s => s.id));
		const stops = await page.$$(card + " .study-campaign nav a");
		assert.equal(stops.length, today.chapters.length);
		await stops.at(-1).focus();
		await page.keyboard.press("Enter");
		const target = today.chapters.at(-1);
		await page.waitForFunction((id, node) => location.pathname === "/mapa" && new URLSearchParams(location.search).get("dominio") === id &&
			new URLSearchParams(location.search).get("no") === node && /Onde parei|Ponto de partida/.test(document.body.innerText), {}, domain, target.entry);
		await page.waitForFunction(title => document.body.innerText.includes(title), {}, target.landmarks[0].title);
		const after = await (await fetch(origin + "/api/study/today")).json();
		assert.equal(after.next.nodeId, today.next.nodeId);
		console.log(domain, today.chapters.length, "capítulos,", today.progress.leaves, "habilidades,", today.next.brief.title);
	}
	if (teach) {
		await page.goto(origin);
		const start = await page.waitForSelector('[data-testid="today-start"]:enabled');
		await start.focus();
		await page.keyboard.press("Enter");
		await page.waitForFunction(() => location.pathname.startsWith("/chat/chat_"));
		const id = new URL(page.url()).pathname.split("/").pop();
		const result = await page.waitForFunction(async chatId => {
			const chat = await (await fetch("/api/chats/" + chatId)).json();
			if (chat.turnInFlight) return false;
			if (!chat.messages[0]?.details?.campaignLesson) throw new Error("A missão perdeu seu contexto.");
			for (const message of chat.messages.filter(m => m.role === "assistant")) {
				if (message.stopReason === "error") throw new Error("O modelo interrompeu a aula.");
				for (const part of message.content) {
					if (part.type === "text" && part.text.trim().length > 200) return { model: message.model, text: part.text.slice(0, 350) };
					if (part.type === "toolCall" && part.name === "probe") throw new Error("Sondagem antes da explicação.");
				}
			}
			return false;
		}, { polling: 2000, timeout: 240_000 }, id);
		console.log("Abertura da missão", await result.jsonValue());
	}
} finally {
	await browser.close();
	await select(initial.active);
}
