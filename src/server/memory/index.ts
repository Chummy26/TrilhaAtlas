/**
 * Server composition of the per-domain memory (SÍNTESE §2.3 MemoryService,
 * §2.2 layout `domains/<id>/memory/memory.db`, §2.5 Stack; r4 §7).
 *
 * `createMemoryService` wires the store's DomainMemoryService to:
 *   - the domain folder layout (core/domains/paths.ts memoryDir),
 *   - the local embedder (transformers.js, model cache under
 *     `profile/model-cache`, loaded lazily) or an injected one,
 *   - the LLM extractor when a model-call function is given (no call = the
 *     memory still records, recalls and forgets; extraction is skipped),
 *   - per-domain curriculum/learner ports supplied by the caller.
 */

import { memoryDir, modelCacheDir } from "../../core/domains/paths.ts";
import type { CurriculumNeighbors, Embedder, LearnerPort, ProfilePort } from "../../core/memory/types.ts";
import type { MemorySettings } from "../../core/memory/settings.ts";
import { DomainMemoryService } from "../../store/memory/service.ts";
import { TransformersEmbedder } from "./embedder.ts";
import { createLlmExtractor, type MemoryLlmCall, type MemoryOp } from "./extractor.ts";

export { DEFAULT_EMBEDDING_DTYPE, DEFAULT_EMBEDDING_MODEL, E5_SMALL_DIM, TransformersEmbedder, createTransformersEmbedder, type TransformersEmbedderOptions, type TransformersModule } from "./embedder.ts";
export { HASH_EMBEDDER_DIM, HashEmbedder, fnv1a, hashEmbed } from "./hash-embedder.ts";
export {
	LlmMemoryExtractor,
	MEMORY_OP_ROLES,
	MEMORY_PROMPTS_DIR,
	MEMORY_PROMPT_FILES,
	RETRY_DROP_RATIO,
	createLlmExtractor,
	extractJson,
	type LlmExtractorOptions,
	type MemoryLlmCall,
	type MemoryLlmMessage,
	type MemoryLlmRequest,
	type MemoryLlmResponse,
	type MemoryOp,
} from "./extractor.ts";

export interface MemoryServerOptions {
	/** Workspace root (LH_DATA_DIR). */
	dataRoot: string;
	/** Model call for the memory roles; omitted = no LLM work (record/recall/forget only). */
	call?: MemoryLlmCall;
	/** Operations the LLM extractor performs (default: all). */
	ops?: readonly MemoryOp[];
	/** Default: multilingual-e5-small q8 cached in `profile/model-cache`. */
	embedder?: Embedder;
	promptsDir?: string;
	curriculumFor?: (domainId: string) => CurriculumNeighbors | undefined;
	learnerFor?: (domainId: string) => LearnerPort | undefined;
	profile?: ProfilePort;
	titleFor?: (domainId: string) => string;
	settings?: Partial<MemorySettings>;
	onError?: (error: unknown, op: string, domainId: string) => void;
	maxOpen?: number;
}

export function createMemoryService(options: MemoryServerOptions): DomainMemoryService {
	const root = options.dataRoot;
	const embedder = options.embedder ?? new TransformersEmbedder({ cacheDir: modelCacheDir(root) });
	const extractor = options.call
		? createLlmExtractor({ call: options.call, ...(options.promptsDir ? { promptsDir: options.promptsDir } : {}), ...(options.ops ? { ops: options.ops } : {}) })
		: undefined;
	return new DomainMemoryService({
		dirFor: (domainId) => memoryDir(root, domainId),
		embedder,
		...(extractor ? { extractorFor: () => extractor } : {}),
		...(options.curriculumFor ? { curriculumFor: options.curriculumFor } : {}),
		...(options.learnerFor ? { learnerFor: options.learnerFor } : {}),
		...(options.profile ? { profile: options.profile } : {}),
		...(options.titleFor ? { titleFor: options.titleFor } : {}),
		...(options.settings ? { settings: options.settings } : {}),
		...(options.onError ? { onError: options.onError } : {}),
		...(options.maxOpen !== undefined ? { maxOpen: options.maxOpen } : {}),
	});
}
