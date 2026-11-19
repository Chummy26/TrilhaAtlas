/**
 * Local sentence embedder on transformers.js v4 (r4 §7.2 "embeddings locais
 * multilingual-e5-small q8 via @huggingface/transformers"; SÍNTESE §2.5
 * Stack). 384 dims, mean pooling + L2 normalisation, E5 prefixes
 * ("query: " / "passage: ") as the model card requires.
 *
 * Lazy by construction: nothing is imported or downloaded until the first
 * `embed` call, so tests and cold app starts never pay for ONNX. The module
 * loader is injectable (tests use a fake; production uses the dynamic import).
 * The model cache dir is configurable (normally `modelCacheDir(LH_DATA_DIR)`),
 * so the desktop build never writes inside the read-only app bundle.
 *
 * Failure policy: a failed load is not cached — the next call retries — and
 * the error propagates to MemoryDb, which reports it and keeps the L0 log
 * intact (recall then runs on FTS/graph/time/learner only).
 */

import { MemoryError, type Embedder } from "../../core/memory/types.ts";

export const DEFAULT_EMBEDDING_MODEL = "Xenova/multilingual-e5-small";
export const DEFAULT_EMBEDDING_DTYPE = "q8";
export const E5_SMALL_DIM = 384;

interface FeatureTensor {
	data: ArrayLike<number>;
	dims: readonly number[];
}

type FeaturePipeline = ((texts: string[], options: { pooling: "mean"; normalize: boolean }) => Promise<FeatureTensor>) & {
	dispose?: () => Promise<unknown>;
};

/** The slice of the transformers.js module this embedder uses. */
export interface TransformersModule {
	env: { cacheDir: string | null; allowRemoteModels: boolean };
	pipeline: (task: "feature-extraction", model: string, options: { dtype: string }) => Promise<FeaturePipeline>;
}

export interface TransformersEmbedderOptions {
	model?: string;
	dtype?: string;
	dim?: number;
	/** Where model files are cached (default: the library's own cache). */
	cacheDir?: string;
	/** false = only use files already in the cache (offline mode). Default true. */
	allowRemoteModels?: boolean;
	/** Texts per forward pass (default 32). */
	batchSize?: number;
	/** Inject the module (tests, alternative builds). Default: dynamic import of @huggingface/transformers. */
	loader?: () => Promise<TransformersModule>;
}

async function importTransformers(): Promise<TransformersModule> {
	const mod: unknown = await import("@huggingface/transformers");
	return mod as TransformersModule;
}

export class TransformersEmbedder implements Embedder {
	readonly id: string;
	readonly dim: number;
	private readonly model: string;
	private readonly dtype: string;
	private readonly cacheDir: string | undefined;
	private readonly allowRemoteModels: boolean;
	private readonly batchSize: number;
	private readonly loader: () => Promise<TransformersModule>;
	private pipe: Promise<FeaturePipeline> | null = null;

	constructor(options: TransformersEmbedderOptions = {}) {
		this.model = options.model ?? DEFAULT_EMBEDDING_MODEL;
		this.dtype = options.dtype ?? DEFAULT_EMBEDDING_DTYPE;
		this.dim = options.dim ?? E5_SMALL_DIM;
		this.cacheDir = options.cacheDir;
		this.allowRemoteModels = options.allowRemoteModels ?? true;
		this.batchSize = options.batchSize ?? 32;
		this.loader = options.loader ?? importTransformers;
		if (!Number.isInteger(this.dim) || this.dim < 1) throw new RangeError(`dimensão inválida: ${this.dim}`);
		if (!Number.isInteger(this.batchSize) || this.batchSize < 1) throw new RangeError(`batchSize inválido: ${this.batchSize}`);
		this.id = `transformers:${this.model}:${this.dtype}`;
	}

	/** True once the pipeline has been requested (the module is loading or loaded). */
	get loaded(): boolean {
		return this.pipe !== null;
	}

	private pipeline(): Promise<FeaturePipeline> {
		if (!this.pipe) {
			const attempt = (async () => {
				const mod = await this.loader();
				if (this.cacheDir) mod.env.cacheDir = this.cacheDir;
				mod.env.allowRemoteModels = this.allowRemoteModels;
				return mod.pipeline("feature-extraction", this.model, { dtype: this.dtype });
			})();
			this.pipe = attempt;
			attempt.catch(() => {
				if (this.pipe === attempt) this.pipe = null;
			});
		}
		return this.pipe;
	}

	async embed(texts: readonly string[], kind: "query" | "passage"): Promise<Float32Array[]> {
		if (texts.length === 0) return [];
		const pipe = await this.pipeline();
		const prefix = kind === "query" ? "query: " : "passage: ";
		const out: Float32Array[] = [];
		for (let i = 0; i < texts.length; i += this.batchSize) {
			const batch = texts.slice(i, i + this.batchSize).map((t) => prefix + t);
			const tensor = await pipe(batch, { pooling: "mean", normalize: true });
			const width = tensor.dims[tensor.dims.length - 1];
			if (width !== this.dim || tensor.data.length !== batch.length * this.dim) {
				throw new MemoryError("embedder", `o modelo ${this.model} devolveu dimensões ${JSON.stringify(tensor.dims)}; esperado [${batch.length}, ${this.dim}]`);
			}
			for (let r = 0; r < batch.length; r++) {
				out.push(Float32Array.from({ length: this.dim }, (_, c) => tensor.data[r * this.dim + c] as number));
			}
		}
		return out;
	}

	/** Release the ONNX session (the next `embed` reloads it). */
	async dispose(): Promise<void> {
		const pending = this.pipe;
		this.pipe = null;
		if (!pending) return;
		try {
			const pipe = await pending;
			await pipe.dispose?.();
		} catch {
			// a pipeline that never loaded has nothing to release
		}
	}
}

export function createTransformersEmbedder(options: TransformersEmbedderOptions = {}): TransformersEmbedder {
	return new TransformersEmbedder(options);
}
