/** Read-time API-dollar estimates. Pi owns both rates and arithmetic.
 * Catalog resolution is key-independent; no provider dispatch/auth is needed.
 * Never mutate saved native messages: calculateCost mutates its usage.cost.
 */
import { calculateCost, type Api, type Model, type Usage } from "@earendil-works/pi-ai";
import { piModels } from "../agent/models.ts";
import { CUSTOM_PROVIDER } from "../core/auth-keys.ts";
import { CLAUDE_CODE_PROVIDER } from "../core/contracts/claude-code.ts";
import type { CallUsage, ChatRecord, JobRecord, TurnUsage } from "../core/contracts.ts";
import { isSubscriptionModel, sessionCost as foldSessionCost, turnCost as foldTurnCost, jobCost as foldJobCost } from "../core/prices.ts";

function isExcludedBillingModel(id: string, colon: number): boolean {
	// Native CLI routing determines billing. Adapter zero-rate placeholders
	// must never become an apparent $0 estimate or subscription classification.
	if (colon < 0 || isSubscriptionModel(id)) return true;
	const provider = id.slice(0, colon);
	return provider === CLAUDE_CODE_PROVIDER || provider === CUSTOM_PROVIDER.id;
}

function catalogModel(id: string, models?: ReturnType<typeof piModels>): Model<Api> | undefined {
	const colon = id.indexOf(":");
	if (isExcludedBillingModel(id, colon)) return undefined;
	return (models ?? piModels()).getModel(id.slice(0, colon), id.slice(colon + 1));
}

function priceCallWithModel(call: Partial<CallUsage>, model: Model<Api> | undefined): number | null {
	if (!model || call.inputTokens === undefined || call.outputTokens === undefined) return null;
	const input = call.inputTokens;
	const output = call.outputTokens;
	const cacheRead = call.cacheReadTokens ?? 0;
	const cacheWrite = call.cacheWriteTokens ?? 0;
	const cacheWrite1h = call.cacheWrite1hTokens ?? 0;
	if ([input, output, cacheRead, cacheWrite, cacheWrite1h].some((v) => !Number.isFinite(v) || v < 0) || cacheWrite1h > cacheWrite) return null;
	// Old records discarded this split. Only price them if it cannot affect
	// the result; do not invent short-retention precision from a missing field.
	if (cacheWrite > 0 && call.cacheWrite1hTokens === undefined &&
		[model.cost, ...(model.cost.tiers ?? [])].some((rate) => rate.cacheWrite !== 2 * rate.input)) return null;
	const usage: Usage = {
		input, output, cacheRead, cacheWrite, cacheWrite1h,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	const total = calculateCost(model, usage).total;
	return Number.isFinite(total) && total >= 0 ? total : null;
}

/** Per-fold cached pricer: resolves piModels() at most once and caches catalog lookups per modelId. */
export function createCallPricer(): (call: Partial<CallUsage>, modelId: string) => number | null {
	const resolved = new Map<string, Model<Api> | undefined>();
	let models: ReturnType<typeof piModels> | undefined;
	const lookup = (modelId: string): Model<Api> | undefined => {
		if (resolved.has(modelId)) return resolved.get(modelId);
		const colon = modelId.indexOf(":");
		if (isExcludedBillingModel(modelId, colon)) {
			resolved.set(modelId, undefined);
			return undefined;
		}
		models ??= piModels();
		const model = models.getModel(modelId.slice(0, colon), modelId.slice(colon + 1));
		resolved.set(modelId, model);
		return model;
	};
	return (call, modelId) => {
		if (call.inputTokens === undefined || call.outputTokens === undefined) return null;
		return priceCallWithModel(call, lookup(modelId));
	};
}

export function callCost(call: Partial<CallUsage>, modelId: string): number | null {
	if (call.inputTokens === undefined || call.outputTokens === undefined) return null;
	return priceCallWithModel(call, catalogModel(modelId));
}

export function turnCost(turn: TurnUsage): number | null {
	return foldTurnCost(turn, createCallPricer());
}
export function sessionCost(record: Pick<ChatRecord, "turns">) {
	return foldSessionCost(record, createCallPricer());
}
export function jobCost(job: Pick<JobRecord, "usage">): number | null {
	const usage = job.usage;
	if (!usage || usage.steps < 1) return null;
	const model = catalogModel(usage.model);
	const hasCalls = usage.calls?.length === usage.steps;
	if (!hasCalls && usage.steps > 1 && model?.cost.tiers?.length) return null;
	return foldJobCost(job, (call, modelId) => (modelId === usage.model ? priceCallWithModel(call, model) : callCost(call, modelId)));
}
