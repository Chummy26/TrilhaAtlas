/** Install an authored curriculum into local learner storage. Existing domains are never replaced. */
import fs from "node:fs";
import path from "node:path";
import { CurriculumSeedFileSchema } from "../src/core/curriculum/schema.ts";
import { installStudyDomain } from "../src/server/install-study-domain.ts";

function install(folder: string) {
	const files = fs.readdirSync(folder).filter(name => name.endsWith(".json")).sort().map(name =>
		CurriculumSeedFileSchema.parse(JSON.parse(fs.readFileSync(path.join(folder, name), "utf8").replace(/^\uFEFF/, ""))));
	const manifest = installStudyDomain(files);
	console.log("Installed " + manifest.title.en + ". Select it in the study domain menu.");
}

try {
	const folder = process.argv[2];
	if (!folder) throw new Error("Usage: npm run domain:import -- <folder-of-curriculum-json-files>");
	install(path.resolve(folder));
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
