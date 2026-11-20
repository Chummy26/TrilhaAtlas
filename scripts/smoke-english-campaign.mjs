// Usage: node scripts/smoke-english-campaign.mjs http://127.0.0.1:<isolated-app-port>
// The app must have English active and a configured model. Launching the C2
// exploration may consume one real lesson turn on that connection.
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const origin = new URL(process.argv[2]).origin;
const chrome = process.env.LH_TEST_CHROME || (process.platform === "win32"
	? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
try {
	const page = await browser.newPage();
	page.setDefaultTimeout(60_000);
	await page.setViewport({ width: 390, height: 844 });
	await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
	const initial = await (await fetch(origin + "/api/study/today")).json();
	assert.equal(initial.domain.id, "english");
	const checkpoint = initial.chapters.map(c => c.known);
	for (const chapter of initial.chapters) {
		await page.goto(origin);
		const link = await page.waitForSelector(`.study-campaign nav a[href*="${chapter.entry}"]`);
		assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		await link.focus();
		await page.keyboard.press("Enter");
		await page.waitForFunction(() => ["Leitura ·", "Vídeo ·"].every(text =>
			[...document.querySelectorAll("h4")].some(h => h.textContent.startsWith(text))));
		console.log(chapter.level, chapter.total, chapter.entry, "leitura + vídeo");
	}
	const position = await page.evaluate(() => document.body.innerText.match(/Onde parei[^\n]*/)?.[0]);
	await page.waitForFunction(() => [...document.querySelectorAll("button, a")].some(el => /^(Retomar exploração|Explorar em aula avulsa)$/.test(el.textContent)));
	await page.evaluate(() => [...document.querySelectorAll("button, a")].find(el => /^(Retomar exploração|Explorar em aula avulsa)$/.test(el.textContent)).click());
	await page.waitForFunction(() => location.pathname.startsWith("/chat/chat_"));
	const chatId = new URL(page.url()).pathname.split("/").pop();
	await page.waitForSelector(".mission-shelf summary");
	await page.focus(".mission-shelf summary");
	await page.keyboard.press("Enter");
	assert.equal(await page.$$eval(".mission-shelf[open] a[target=_blank]", a => a.length), 2);
	// Wait for a substantive completed model message; a created chat or a
	// probe handoff by itself cannot pass the real-model check.
	const response = await page.waitForFunction(async id => {
		const chat = await (await fetch("/api/chats/" + id)).json();
		if (chat.turnInFlight) return false;
		const reply = chat.messages.find(m => m.role === "assistant" && m.model && m.stopReason !== "error" &&
			m.content.some(part => part.type === "text" && part.text.length > 200));
		return reply ? { model: reply.model, provider: reply.provider } : false;
	}, { polling: 2000, timeout: 180_000 }, chatId);
	assert.deepEqual((await (await fetch(origin + "/api/study/today")).json()).chapters.map(c => c.known), checkpoint);
	console.log("Exploração C2", await response.jsonValue(), position ?? "perfil sem aula principal");
} finally {
	await browser.close();
}
