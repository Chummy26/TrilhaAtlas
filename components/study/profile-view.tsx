/**
 * Profile — level, XP, tier per domain and light usage stats (estudos-sota
 * §2.10–2.11). Server-rendered; no interactivity beyond the back link.
 */

import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import type { IconName } from "@/components/icons/generated";
import type { StudyProfile } from "@/src/core";

const fmt = new Intl.NumberFormat("pt-BR");

function compact(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} M`;
	if (n >= 10_000) return `${Math.round(n / 1000)} mil`;
	return fmt.format(n);
}

function hours(minutes: number): string {
	const min = Math.round(minutes);
	if (min < 60) return `${min} min`;
	return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

export function ProfileView({ profile }: { profile: StudyProfile }) {
	const { account, domains, usage, days } = profile;
	const maxDay = Math.max(60, ...days.map((d) => d.minutes));
	const weekMin = days.slice(-7).reduce((a, d) => a + d.minutes, 0);
	return (
		<div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-14">
			<div className="mb-6 flex items-center gap-3">
				<Link href="/" aria-label="Voltar" className="lh-no-drag rounded-md p-1 hover:bg-accent">
					<Icon name="chevron-left" size={22} />
				</Link>
				<h1 className="cel-display text-2xl">Perfil</h1>
			</div>

			<section className="cel-card mb-5 flex items-center gap-4 p-4">
				<div className="cel-display flex size-16 shrink-0 flex-col items-center justify-center rounded-full border-2 border-current">
					<span className="text-[10px] uppercase tracking-wider text-muted-foreground">nível</span>
					<span className="text-2xl leading-none">{account.level}</span>
				</div>
				<div className="min-w-0 flex-1">
					<div className="mb-1 flex items-center gap-2 text-sm">
						<Icon name="xp" size={18} />
						<span className="cel-display">{fmt.format(account.xp)} XP</span>
						<span className="ml-auto text-xs text-muted-foreground">faltam {fmt.format(account.xpToNext)}</span>
					</div>
					<div className="h-3 overflow-hidden rounded-full border border-current/40">
						<div className="h-full bg-[var(--cel-xp,var(--primary))]" style={{ width: `${Math.round(account.fraction * 100)}%` }} />
					</div>
				</div>
			</section>

			<div className="mb-5 grid gap-3 sm:grid-cols-2">
				{domains.map((d) => (
					<section key={d.id} data-domain={d.id} className="cel-card p-4">
						<div className="mb-2 flex items-center gap-2">
							<Icon name={d.icon as IconName} size={26} />
							<h2 className="cel-display text-lg">{d.title}</h2>
							<span className="cel-chip ml-auto text-xs" title={`${d.tier.pm} pontos de maestria`}>
								<Icon name="trophy" size={14} />
								{d.tier.label}
							</span>
						</div>
						<div className="mb-2 flex gap-1" aria-label="Estágios retidos">
							{d.tier.fractions.map((f, i) => (
								<div key={i} className="h-2 flex-1 overflow-hidden rounded-sm bg-muted" title={`Estágio ${i + 1}: ${Math.round(f * 100)}%`}>
									<div className="h-full bg-[var(--cel-accent,var(--primary))]" style={{ width: `${Math.round(f * 100)}%` }} />
								</div>
							))}
						</div>
						<dl className="grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
							<div>
								<dt>tópicos</dt>
								<dd className="cel-display text-base text-foreground">
									{d.attained}/{d.leaves}
								</dd>
							</div>
							<div>
								<dt>domínio</dt>
								<dd className="cel-display text-base text-foreground">{d.mastered}</dd>
							</div>
							<div>
								<dt>XP</dt>
								<dd className="cel-display text-base text-foreground">{fmt.format(d.xp)}</dd>
							</div>
						</dl>
					</section>
				))}
			</div>

			<section className="cel-card mb-5 p-4">
				<div className="mb-3 flex items-baseline gap-2">
					<h2 className="cel-display text-lg">Tempo</h2>
					<span className="ml-auto text-xs text-muted-foreground">7 dias: {hours(weekMin)}</span>
				</div>
				<div className="flex h-24 items-end gap-1">
					{days.map((d) => (
						<div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${hours(d.minutes)}`}>
							<div className="w-full rounded-t-sm bg-[var(--cel-accent,var(--primary))]" style={{ height: `${Math.max(2, Math.round((d.minutes / maxDay) * 80))}px`, opacity: d.minutes > 0 ? 1 : 0.25 }} />
							<span className="text-[9px] text-muted-foreground">{d.day.slice(8)}</span>
						</div>
					))}
				</div>
			</section>

			<section className="cel-card p-4">
				<div className="mb-2 flex items-baseline gap-2">
					<h2 className="cel-display text-lg">Tokens</h2>
					<span className="ml-auto text-xs text-muted-foreground">
						{compact(usage.totalTokens)} em {fmt.format(usage.calls)} {usage.calls === 1 ? "chamada" : "chamadas"}
					</span>
				</div>
				{usage.byModel.length === 0 ? (
					<p className="text-sm text-muted-foreground">Nenhum uso ainda.</p>
				) : (
					<table className="w-full text-sm">
						<thead className="text-left text-xs text-muted-foreground">
							<tr>
								<th className="py-1 font-normal">modelo</th>
								<th className="py-1 text-right font-normal">entrada</th>
								<th className="py-1 text-right font-normal">saída</th>
								<th className="py-1 text-right font-normal">cache</th>
								<th className="py-1 text-right font-normal">total</th>
							</tr>
						</thead>
						<tbody>
							{usage.byModel.map((m) => (
								<tr key={m.model} className="border-t border-border/50">
									<td className="max-w-48 truncate py-1.5 font-mono text-xs">{m.model}</td>
									<td className="py-1.5 text-right">{compact(m.input)}</td>
									<td className="py-1.5 text-right">{compact(m.output)}</td>
									<td className="py-1.5 text-right">{compact(m.cached)}</td>
									<td className="cel-display py-1.5 text-right">{compact(m.tokens)}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</section>
		</div>
	);
}
