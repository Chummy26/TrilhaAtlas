/**
 * Profile — level, XP, tier per domain and light usage stats (estudos-sota
 * §2.10–2.11). Server-rendered; no interactivity beyond the back link.
 */

import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import type { IconName } from "@/components/icons/generated";
import type { StudyProfile, TranscriptChapterRow, TranscriptGradeLabel } from "@/src/core";

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

function gradePillClass(grade: TranscriptGradeLabel): string {
	if (grade === "A") return "study-pill study-pill-success";
	if (grade === "B" || grade === "C") return "study-pill study-pill-info";
	if (grade === "Reforço") return "study-pill study-pill-warning";
	return "study-pill";
}

function chapterAvgExamScore(chapter: TranscriptChapterRow): string {
	const scores = chapter.modules
		.map((m) => m.examScore)
		.filter((s): s is number => typeof s === "number");
	if (scores.length === 0) return "—";
	const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
	return avg.toFixed(1).replace(".", ",");
}

export function ProfileView({ profile }: { profile: StudyProfile }) {
	const { account, domains, usage, days } = profile;
	const maxDay = Math.max(60, ...days.map((d) => d.minutes));
	const weekMin = days.slice(-7).reduce((a, d) => a + d.minutes, 0);
	const periodMin = days.reduce((a, d) => a + d.minutes, 0);
	const levelPct = Math.round(account.fraction * 100);
	const maxModelTokens = Math.max(1, ...usage.byModel.map((m) => m.tokens));
	const transcriptDomains = domains.filter((d): d is typeof d & { transcript: NonNullable<typeof d.transcript> } => Boolean(d.transcript));

	return (
		<div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-12">
			<div className="mb-6 flex items-center gap-3">
				<Link href="/" aria-label="Voltar" className="cel-button cel-button-ghost lh-no-drag min-h-9 px-2.5 text-sm">
					<Icon name="chevron-left" size={18} tone={false} />
					Início
				</Link>
				<h1 className="cel-display text-2xl">Perfil</h1>
			</div>

			<section className="cel-card mb-5 flex flex-wrap items-center gap-4 p-5">
				<div className="cel-display flex size-18 shrink-0 flex-col items-center justify-center rounded-full border-2 border-[var(--cel-xp,var(--primary))] bg-[color-mix(in_srgb,var(--cel-xp,var(--primary))_12%,var(--background))]">
					<span className="text-[11px] uppercase tracking-wider text-muted-foreground">nível</span>
					<span className="text-2xl leading-none tabular-nums">{account.level}</span>
				</div>
				<div className="min-w-48 flex-1 space-y-2">
					<div className="flex flex-wrap items-baseline gap-2 text-sm">
						<span className="inline-flex items-center gap-1.5">
							<Icon name="xp" size={18} />
							<span className="cel-display text-lg tabular-nums">{fmt.format(account.xp)} XP</span>
						</span>
						<span className="ml-auto text-xs text-muted-foreground tabular-nums">
							{levelPct}% · faltam {fmt.format(account.xpToNext)} XP
						</span>
					</div>
					<div className="h-3 overflow-hidden rounded-full border border-border/70 bg-background/80">
						<div className="h-full rounded-full bg-[var(--cel-xp,var(--primary))] transition-all" style={{ width: `${levelPct}%` }} />
					</div>
				</div>
			</section>

			<div className="mb-5 grid gap-3.5 sm:grid-cols-2">
				{domains.map((d) => {
					const pct = d.leaves > 0 ? Math.round((100 * d.attained) / d.leaves) : 0;
					return (
						<section key={d.id} data-domain={d.id} className="cel-card flex flex-col gap-3 p-4">
							<div className="flex items-center gap-2.5">
								<Icon name={d.icon as IconName} size={26} />
								<div className="min-w-0 flex-1">
									<h2 className="cel-display truncate text-lg leading-tight">{d.title}</h2>
									<p className="text-xs text-muted-foreground tabular-nums">{d.attained > 0 && pct === 0 ? "<1%" : `${pct}%`} do percurso</p>
								</div>
								<span className="cel-chip shrink-0 text-xs" title={`${d.tier.pm} pontos de maestria`}>
									<Icon name="trophy" size={14} />
									{d.tier.label}
								</span>
							</div>
							<div>
								<div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
									<span>Estágios retidos</span>
									<span className="tabular-nums">{d.tier.pm} PM</span>
								</div>
								<div className="flex gap-1" aria-label="Estágios retidos">
									{d.tier.fractions.map((f, i) => (
										<div key={i} className="h-2.5 flex-1 overflow-hidden rounded-full border border-border/50 bg-background/80" title={`Estágio ${i + 1}: ${Math.round(f * 100)}%`}>
											<div className="h-full bg-[var(--cel-accent,var(--primary))]" style={{ width: `${Math.round(f * 100)}%` }} />
										</div>
									))}
								</div>
							</div>
							<dl className="grid grid-cols-3 divide-x divide-border/50 rounded-xl border border-border/45 bg-background/55 py-2 text-center text-xs text-muted-foreground">
								<div className="px-1">
									<dt>tópicos</dt>
									<dd className="cel-display mt-0.5 text-base text-foreground tabular-nums">
										{d.attained}/{d.leaves}
									</dd>
								</div>
								<div className="px-1">
									<dt>domínio</dt>
									<dd className="cel-display mt-0.5 text-base text-foreground tabular-nums">{d.mastered}</dd>
								</div>
								<div className="px-1">
									<dt>XP</dt>
									<dd className="cel-display mt-0.5 text-base text-foreground tabular-nums">{fmt.format(d.xp)}</dd>
								</div>
							</dl>
						</section>
					);
				})}
			</div>

			{transcriptDomains.length > 0 && (
				<section className="cel-card mb-5 p-5" aria-label="Boletim de Retenção Real (Histórico Escolar)">
					<div className="mb-4 flex flex-wrap items-center gap-2">
						<Icon name="stats" size={18} />
						<h2 className="cel-display text-lg">Boletim de Retenção Real (Histórico Escolar)</h2>
					</div>
					<div className="space-y-6">
						{transcriptDomains.map((d) => {
							const { transcript } = d;
							const alerts = transcript.coolingAlerts.slice(0, 4);
							return (
								<div key={d.id} data-domain={d.id} className="space-y-3 border-t border-border/50 pt-4 first:border-t-0 first:pt-0">
									<div className="flex flex-wrap items-center gap-2">
										<Icon name={d.icon as IconName} size={20} />
										<h3 className="cel-display text-base leading-tight">{d.title}</h3>
										<span className={gradePillClass(transcript.gradeLabel)}>{transcript.gradeLabel}</span>
										{transcript.avgRetention !== null && (
											<span className="text-xs text-muted-foreground tabular-nums">
												Retenção {Math.round(transcript.avgRetention * 100)}%
											</span>
										)}
										<Link
											href={`/ementa?dominio=${encodeURIComponent(d.id)}`}
											className="cel-button cel-button-ghost ml-auto min-h-7 px-2.5 py-0.5 text-xs"
										>
											<Icon name="book" size={13} tone={false} />
											Abrir ementa
										</Link>
									</div>

									{alerts.length > 0 && (
										<div className="rounded-xl border border-[var(--cel-warning,var(--border))]/45 bg-[color-mix(in_srgb,var(--cel-warning,var(--primary))_8%,var(--background))] px-3.5 py-2.5 text-xs">
											<div className="mb-1.5 flex items-center gap-1.5 font-semibold text-foreground">
												<Icon name="warning" size={14} />
												<span>Módulos esfriando (&lt; 85%)</span>
											</div>
											<ul className="space-y-1.5">
												{alerts.map((alert) => (
													<li key={alert.moduleId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
														<span className="study-pill study-pill-warning tabular-nums">
															{Math.round(alert.avgRetention * 100)}%
														</span>
														<span className="font-medium text-foreground">
															{alert.chapterLevel} · {alert.moduleTitle}
														</span>
														<Link
															href={`/mapa?dominio=${encodeURIComponent(d.id)}&no=${encodeURIComponent(alert.topNodeId)}`}
															className="ml-auto font-medium text-[var(--cel-link,var(--lh-accent))] underline underline-offset-2 hover:text-foreground"
														>
															Revisar {alert.topNodeTitle}
														</Link>
													</li>
												))}
											</ul>
										</div>
									)}

									<div className="overflow-x-auto">
										<table className="w-full text-sm tabular-nums">
											<thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
												<tr>
													<th className="pb-2 pr-3 font-medium">Capítulo</th>
													<th className="px-2 pb-2 text-right font-medium">Alcançadas</th>
													<th className="px-2 pb-2 text-right font-medium">Duradouras ≥24h</th>
													<th className="px-2 pb-2 text-right font-medium">Dominadas</th>
													<th className="px-2 pb-2 text-right font-medium">Retenção FSRS</th>
													<th className="px-2 pb-2 text-right font-medium">Nota Provas</th>
													<th className="pb-2 pl-2 text-right font-medium">Conceito</th>
												</tr>
											</thead>
											<tbody>
												{transcript.chapters.map((ch) => (
													<tr key={`${ch.index}-${ch.level}`} className="border-t border-border/50">
														<td className="min-w-40 py-2 pr-3">
															<span className="font-semibold text-foreground">{ch.level}</span>
															<span className="block text-xs text-muted-foreground">{ch.title}</span>
														</td>
														<td className="px-2 py-2 text-right text-muted-foreground">
															{ch.attained}/{ch.total}
														</td>
														<td className="px-2 py-2 text-right font-semibold text-foreground">
															{ch.durable}
														</td>
														<td className="px-2 py-2 text-right text-muted-foreground">
															{ch.mastered}
														</td>
														<td className="px-2 py-2 text-right text-muted-foreground">
															{ch.avgRetention !== null ? `${Math.round(ch.avgRetention * 100)}%` : "—"}
														</td>
														<td className="px-2 py-2 text-right text-muted-foreground">
															{chapterAvgExamScore(ch)}
														</td>
														<td className="py-2 pl-2 text-right">
															<span className={gradePillClass(ch.gradeLabel)}>{ch.gradeLabel}</span>
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							);
						})}
					</div>
				</section>
			)}

			<section className="cel-card mb-5 p-5">
				<div className="mb-3.5 flex flex-wrap items-baseline gap-2">
					<div className="flex items-center gap-2">
						<Icon name="clock" size={18} />
						<h2 className="cel-display text-lg">Tempo de estudo</h2>
					</div>
					<span className="ml-auto text-xs text-muted-foreground tabular-nums">
						7 dias: <strong className="font-semibold text-foreground">{hours(weekMin)}</strong> · 14 dias: <strong className="font-semibold text-foreground">{hours(periodMin)}</strong>
					</span>
				</div>
				<div className="flex h-28 items-end gap-1.5 border-b border-border/50 pb-2">
					{days.map((d, index) => {
						const isToday = index === days.length - 1;
						const barHeight = d.minutes > 0 ? Math.max(6, Math.round((d.minutes / maxDay) * 86)) : 3;
						return (
							<div key={d.day} className="group flex flex-1 flex-col items-center gap-1.5" title={`${d.day}: ${hours(d.minutes)}`}>
								<div
									className="w-full rounded-t-md bg-[var(--cel-accent,var(--primary))] transition-opacity group-hover:opacity-100"
									style={{ height: `${barHeight}px`, opacity: d.minutes > 0 ? (isToday ? 1 : 0.82) : 0.22 }}
								/>
								<span className={"text-[11px] tabular-nums " + (isToday ? "font-bold text-foreground" : "text-muted-foreground")}>
									{d.day.slice(8)}
								</span>
							</div>
						);
					})}
				</div>
			</section>

			<section className="cel-card p-5">
				<div className="mb-3 flex flex-wrap items-baseline gap-2">
					<div className="flex items-center gap-2">
						<Icon name="tokens" size={18} />
						<h2 className="cel-display text-lg">Tokens</h2>
					</div>
					<span className="ml-auto text-xs text-muted-foreground tabular-nums">
						<strong className="font-semibold text-foreground">{compact(usage.totalTokens)}</strong> em {fmt.format(usage.calls)} {usage.calls === 1 ? "chamada" : "chamadas"}
					</span>
				</div>
				{usage.byModel.length === 0 ? (
					<p className="text-sm text-muted-foreground">Nenhum uso registrado ainda.</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-sm tabular-nums">
							<thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
								<tr>
									<th className="pb-2 pr-3 font-medium">Modelo</th>
									<th className="pb-2 px-2 text-right font-medium">Entrada</th>
									<th className="pb-2 px-2 text-right font-medium">Saída</th>
									<th className="pb-2 px-2 text-right font-medium">Cache</th>
									<th className="pb-2 pl-2 text-right font-medium">Total</th>
								</tr>
							</thead>
							<tbody>
								{usage.byModel.map((m) => (
									<tr key={m.model} className="border-t border-border/50">
										<td className="max-w-52 py-2 pr-3">
											<span className="block truncate font-mono text-xs">{m.model}</span>
											<span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-border/35" aria-hidden="true">
												<span className="block h-full rounded-full bg-[var(--cel-accent,var(--primary))]" style={{ width: `${Math.max(4, Math.round((m.tokens / maxModelTokens) * 100))}%` }} />
											</span>
										</td>
										<td className="px-2 py-2 text-right text-muted-foreground">{compact(m.input)}</td>
										<td className="px-2 py-2 text-right text-muted-foreground">{compact(m.output)}</td>
										<td className="px-2 py-2 text-right text-muted-foreground">{compact(m.cached)}</td>
										<td className="cel-display py-2 pl-2 text-right">{compact(m.tokens)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</div>
	);
}
