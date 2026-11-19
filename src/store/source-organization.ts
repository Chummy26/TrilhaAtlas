import fs from "node:fs";
import path from "node:path";
import { GRAPH_FILES } from "../../config.ts";
import { emptySourceOrganization, parseSourceOrganization } from "../core/source-organization.ts";
import type { SourceOrganizationStore } from "../core/ports.ts";
import { emit } from "../core/events.ts";
import { assertGraphFormat, ensureGraphFormat } from "./graph-format.ts";
import { removeLeftoverTemps, writeFileAtomicSync } from "./atomic-write.ts";

export const sourceOrganizationStore: SourceOrganizationStore = {
	read() {
		assertGraphFormat();
		let raw: string;
		try { raw = fs.readFileSync(GRAPH_FILES.sourceOrganization, "utf8"); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptySourceOrganization();
			throw error;
		}
		return parseSourceOrganization(JSON.parse(raw));
	},
	write(state) {
		assertGraphFormat();
		const valid = parseSourceOrganization(state);
		fs.mkdirSync(path.dirname(GRAPH_FILES.sourceOrganization), { recursive: true });
		ensureGraphFormat();
		writeFileAtomicSync(GRAPH_FILES.sourceOrganization, JSON.stringify(valid, null, "\t") + "\n");
		removeLeftoverTemps(GRAPH_FILES.sourceOrganization); // crash leftovers could still place deleted sources
		emit("sources-changed", {});
	},
};
