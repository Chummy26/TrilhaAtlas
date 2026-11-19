import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { isSubscriptionProvider } from "../agent/subscription-connections.ts";
import { catalogProviders, refreshConnectionCatalog } from "./model-catalog.ts";
import { effectiveSettings } from "./stores.ts";
import { observeEngineUsage } from "./study-usage.ts";

/** A learner-requested curriculum is a foreground operation, even before the
 * domain exists. Attribute it to its own ID regardless of the active map. */
export async function domainAuthoringEngine(domainId: string, model?: { provider: string; id: string }): Promise<PiEngine> {
	const strong = effectiveSettings().models.strong;
	const spec = model ?? strong;
	if (!spec) throw new Error("Escolha o modelo principal em Configurações → Agent.");
	if (isSubscriptionProvider(spec.provider)) await refreshConnectionCatalog(spec.provider);
	if (!catalogProviders().some(connection => connection.id === spec.provider && connection.keyPresent)) {
		throw new Error("Conecte a conta do modelo em Configurações → Providers.");
	}
	const sameSlot = strong?.provider === spec.provider && strong.id === spec.id;
	const engine = piEngineForSpec(sameSlot ? strong : spec, false, undefined, () => effectiveSettings().models.strong?.cacheRetention);
	return observeEngineUsage(engine, "curriculum.generate", { domain: domainId, background: false });
}
