# Módulo `progress` — XP, níveis, tiers, insígnias, streak e calibração Monte Carlo

Implementa a SÍNTESE §2.11 (e os anti-padrões da §1.4) seguindo o r7, parte A (fórmulas, invariantes I1–I7, Monte Carlo), com o ledger idempotente e as ligas determinísticas do mathua. Tudo em `src/core/progress/` é **puro** e browser-safe: decide, não persiste. A store grava `data/domains/<id>/progress/{xp-ledger.jsonl, streak.json, standing.json}` e lê `config/progression.json`.

## API pública (`src/core/progress/index.ts`)

| Arquivo | Exporta | Papel |
|---|---|---|
| `types.ts` | `ProgressEvent` (+ `ProgressEventBody`), `XpLedgerEntry`, `Tier`, `TierStanding`, `RegionBadgeState`, `StreakState`, `Standing`… | Contratos. Nenhum evento tem campo de nota: o XP não pode depender de Again/Hard/Good/Easy (I7). |
| `rules.ts` | `RULES` (`version: "2026-11-r1"`), `validateRules`, `deriveRules(base, patch, newVersion)`, `roundXp` | Todos os números do XP sob uma versão. Recalibrar = nova versão; linhas já concedidas não são repreçadas. |
| `elo.ts` | `eloUpdate`, `eloK`, `itemPriorB`, `ELO_PER_LOGIT` (+ `expectedScore(θ, b)` direto do arquivo) | Elo na escala 400 (Pelánek: K = 173,7/(1+0,05n)). `expectedScore` fica fora do barrel: o barrel de `lesson` já exporta uma função com esse nome e a mesma fórmula, e os dois `export *` em `src/core/index.ts` seriam ambíguos (TS2308). |
| `xp.ts` | `mDif`, `gReview`, `eventCredit`, `softCapped`, `creditEvent(ev, index)`, `recordEvent`, `replayXpLedger(events, { existing, rules, otherMinutesOn })`, `summarizeLedger`, `studyDay`, `MemoryLedgerIndex` | 1 XP ≈ 1 min focado × mDif(E) ou × gReview(R); soft cap diário ×0,5 após 240 min e ×0,25 após 360 min (por conta, em ordem cronológica); idempotente por `eventId`. |
| `levels.ts` | `levelFromXp`, `xpForLevel`, `xpToAdvance`, `levelProgress`, `fitLevelCurve`, `DEFAULT_LEVEL_CURVE` | XP(L) = a·L^p (padrão 20,10·L^1,696). Nível 1 começa em 0 XP; as duas funções são inversas exatas. |
| `tiers.ts` | `TIERS`, `tierStanding(core, retention, { thresholds })`, `masteryPoints`, `stageFractions`, `tierFromPm`, `divisionFor`, `structuralStage`, `updateTierPeak` | PM = Σ s·\|retidos(core[s])\|/\|core[s]\| (retido = R ≥ 0,7); tier = limiares τ₁…τ₇; divisões III/II/I por terços da faixa; título = pico. |
| `badges.ts` | `regionBadge(signals, previousPeak)`, `currentBadge`, `restoreTargets` | Explorada / Familiar / Proficiente / Dominada (+ chefão) e sobreposição "Enferrujada". |
| `streak.ts` | `computeStreak(days, asOf, config, { targetChanges })`, `weekStartOf`, `isValidDay` | Meta semanal 5/7, dia válido = 10 min ou fila zerada, 2 freezes, reparo em 48 h, modo viagem (14 dias/ano). Dobra pura sobre a atividade diária. |
| `config.ts` | `ProgressionConfig`, `parseProgressionConfig`, `progressionConfigOrDefault`, `DEFAULT_PROGRESSION_CONFIG` | Formato de `config/progression.json` (zod); padrões do r7 quando o arquivo falta ou é inválido. |
| `schema.ts` | `parseProgressEvent`, `parseLedgerEntry`, `parseLedgerLine` | Fronteira (`ctx.progress.record`): objetos **estritos**, então um evento com `rating`/`grade` é recusado. Leitor JSONL pula linhas ruins. |
| `standing.ts` | `computeStanding(input)`, `accountLevel` | Junta XP/nível do domínio, tier, picos (`levelPeak`, `tierPeak`). |
| `cohort.ts` | `pacePercentile`, `paceStandingFor`, `selfLeague`, `simulatedRivals`, `planWeek`, `moversFor` | Comparações opt-in (desligadas por padrão): "Eu vs Eu", coorte simulada **rotulada** (29 rivais) e liga determinística do mathua. |
| `simulate.ts` | `simulateLearner`, `simulateCohort`, `honestProfile`, `REFERENCE_CORE`, `fsrs7Memory` (padrão), `fsrs6Memory`, `createMemoryModel`, `SIM_MAXIMUM_INTERVAL_DAYS` (+ `quantileSorted`, `firstWeekDay` direto do arquivo) | Simulador Monte Carlo puro e semeado. Preça com `eventCredit` + `softCapped`, mede com `masteryPoints` + `structuralStage` e agenda com o FSRS-7 do aluno em runtime: as mesmas funções e o mesmo modelo do app. |
| `random.ts` | `mulberry32`, `deriveSeed`, `SimRng` | PRNG semeado: um fluxo por aluno simulado e por semana da coorte. |

## Decisões

- **Rating fora do XP (I7), inclusive o "lapso ×0,8" do r7 §4.3.** Num flashcard, o lapso é a nota Again. Por isso a revisão depende só do tempo e de R. A fronteira zod recusa campos desconhecidos.
- **Regra de pressa na aula.** Um check reprovado com menos de 50% do tempo esperado dá 0 XP. Sem ela, o skimmer ficava em 0,73× o XP/h do honesto (r7 §5.5: 40,7 / 56,0), acima do limite de 0,7×. Com ela, ficava em 0,68× no simulador FSRS-6.
  - **Pendente (decisão de regra):** com o FSRS-7 do runtime, o skimmer fica em **0,71×** (verificação ✗ no bloco abaixo). A aula dele já rende só 0,40 XP/min (praticamente só os checks aprovados); a diferença vem das revisões, que são trabalho real e pagam ≈ 1,1 XP/min: partindo de Hard, os nós dele pedem mais revisões (37 % do tempo contra 34 % no FSRS-6). Baixar isso exige mudar as regras (nova versão, p. ex. `2026-11-r2`), o que não foi feito nesta revisão. O farmer de revisões antecipadas fica em 0,64×.
- **Doutor a 2 h/dia.** O "27 meses" do r7 é a mediana **entre quem chega a Doutor em 1.000 dias**; a verificação compara essa mesma estatística (27,1 meses aqui, 27,1 no r7). A mediana honesta, que conta quem não chega como "ainda não", é 29,2 meses e é a que aparece nas previsões.
- **Soft cap por conta.** `creditEvent` aceita `otherMinutesToday` para somar os minutos de outros domínios. Numa reconstrução (`replayXpLedger`), que cobre vários dias, esses minutos vêm por dia (`otherMinutesOn(dia)`); um `otherMinutesToday` único é recusado. O dia de estudo começa às 04:00 locais (`studyDay`) e precisa cair entre os anos 0000 e 9999 (fora disso a chave do dia não seria lida de volta pelo ledger).
- **Recalibração.** `replayXpLedger(events, { existing })` mantém as linhas existentes literalmente, e `deriveRules` exige uma versão nova. Nível e tier exibidos guardam o pico (`levelPeak`, `tierPeak`), então uma curva nova não rebaixa ninguém.
- **Limiares de tier.** τₖ é o PM mediano, entre os alunos de 3 h/dia, na avaliação semanal em que cada um **conclui o estágio k** pelo critério estrutural do r7 §4.2 (f₁..fₖ ≥ 0,8).
  - Com isso, o tier contínuo (PM) e o estrutural coincidem, e o calendário de 3 h/dia reproduz o r7 §5.2: Doutor em ≈ 18 meses.
  - Desvio do r7 §5.4, documentado: lá τ vinha das semanas 2/6/13/24/37/52/70. Isso põe Doutor na semana 70 (≈ 16 meses) e contradiz o próprio §5.2.
  - Ancorar num dia fixo tardio também é degenerado. Quem terminou o núcleo tem PM = 28 (com DR 0,9, quase todo nó aprendido fica com R ≥ 0,7), e aí τ₇ viraria 28.
  - Os padrões do código continuam sendo os valores do r7 (1,71 … 23,49), como pede a tarefa. O arquivo calibrado os substitui.
- **Memória no MC = a do runtime (FSRS-7).** O simulador usa o `FSRS7Algorithm` puro do ts-fsrs com `FSRS7_DEFAULT_WEIGHTS`, intervalo máximo de 1095 d e o passo de reaprendizagem de 20 min depois de um lapso — exatamente o que `src/core/learner/fsrs.ts` agenda (≈ 3 µs por revisão; os objetos de scheduler seriam lentos demais). Um teste de paridade compara, passo a passo, com o `reviewMemory` do learner.
  - A 1ª versão (e o `sim.mjs` do r7) usava FSRS-6, com intervalos 2–2,5× mais curtos (2/11/46/163 d contra 5/27/94/298 d em Goods seguidos): a carga de revisão e o calendário descreviam um agendador que o app não roda. A forma fechada do FSRS-6 continua disponível (`fsrs6Memory`, com `relearnStepDays: 0` para reproduzir o r7) e testada contra o `FSRS6Algorithm`.
  - Aproximações documentadas: granularidade diária, sem fuzz (o fuzz do runtime é não enviesado: média 48,1 d contra 48,0 d do simulador num caso medido), um nó aprendido começa no 1º Good do FSRS-7 (com um único passo de 20 min, o Good de um cartão novo já gradua no runtime), skimmers começam no 1º Hard.
  - Retido ⇔ `t ≤ retainedDays(estado, 0,7)` (o tempo até R = 0,7 no modelo), idêntico a R ≥ 0,7.
  - `config/progression.json` registra o modelo em `source.memoryModel` (`"fsrs-7"`); o teste da config exige esse valor.
  - Cada aluno tem o seu fluxo mulberry32 (`deriveSeed(seed, perfil, i)`).
- **Retentativas no MC não se acumulam.** Cada nova tentativa depois de um check reprovado custa 30 % da **primeira** tentativa (r7 §5.1). O `sim.mjs` do r7 multiplicava a tentativa anterior (0,3ᵏ), e um aluno que reprova quase todo check aprendia quase de graça (com check de 20 %, 1,4× a aula por nó em vez de 2,2×).
- **Streak.** A 1ª semana (parcial) nunca quebra.
  - Uma semana perdida com reparo ainda possível aparece como `broken` com oferta `repair` ({ lostStreak, lastDay, minutesNeeded = 20 }). Depois da sessão de reparo, o recálculo dá `repaired`.
  - A semana corrente conta no streak assim que a meta é batida.
  - Freezes são consumidos antes do reparo e nunca passam de 2.
- **Mediana honesta.** Quem não chega no horizonte conta como ∞, e não é descartado como no r7. Ver a nota sobre 2 h/dia abaixo.
- **Config que passa no schema é utilizável.** `parseProgressionConfig` exige ao menos 1 dia por curva de ritmo e ao menos 2 quantis quando há curvas ou perfis de coorte; antes, um arquivo assim era aceito e `pacePercentile`/`simulatedRivals` lançavam depois. `pacePercentile` recusa XP não finito (NaN caía no quantil mais alto, "p90").

### Bugs corrigidos na 2ª revisão adversarial

Cada um tem um teste que o pegaria (`tests/progress-boundaries.test.ts`, `progress-memory.test.ts`, `progress-cohort.test.ts`, `progress-elo.test.ts`):

1. Simulador em FSRS-6 enquanto o runtime agenda com FSRS-7 → trocado para FSRS-7 (paridade com `reviewMemory`), calibração refeita.
2. Retentativas acumuladas (0,3ᵏ) no simulador → custo fixo de 30 % da primeira tentativa.
3. `studyDay` gerava chaves `-000001-12-31` / `+010000-01-01` nas bordas dos anos 0000/9999; a linha ficava ilegível para o leitor do ledger (XP e chave de deduplicação perdidos) → recusada na entrada.
4. `replayXpLedger` somava um único `otherMinutesToday` a todos os dias reconstruídos → `otherMinutesOn(dia)`.
5. `pacePercentile(NaN)` respondia "p90" → `CohortError`.
6. Config aceita pelo schema que quebrava `pacePercentile`/`simulatedRivals` (curva sem dias, menos de 2 quantis) → recusada (e o caminho da store cai nos padrões).
7. `expectedScore` exportado pelos barrels de `progress` e de `lesson` (ambíguo em `src/core/index.ts`) → fora do barrel; o teste agora compara com **todos** os barrels irmãos.

## Integração (fora deste módulo)

- `src/store/progress-store.ts`:
  - o ledger `xp-ledger.jsonl` é *append-only*: valida com `parseLedgerEntry` ao escrever e `parseLedgerLine` ao ler; mantém um `MemoryLedgerIndex` vivo;
  - `streak.json` e `standing.json` guardam os picos (`levelPeak`, `tierPeak`) e as `targetChanges` da meta semanal;
  - lê `config/progression.json` via `progressionConfigOrDefault`.
- `src/server/progress.ts`:
  - `record(ev)` = `parseProgressEvent` → `creditEvent(ev, index, { otherMinutesToday, utcOffsetMin })` → append → evento de servidor `xp.awarded` (SÍNTESE §1.4: nada de celebração por diff no cliente);
  - `ctx.progress.record` na API de plugins (o Flashcards emite revisões; o Anki usa `eventId = anki:<revlogId>`).
- Learner model: fornece o `RetentionSnapshot` (R atual dos nós com `attainedAt`), o núcleo congelado `TierCore` por estágio e os sinais por região (`RegionSignals`). O θ/b do Elo vem de `elo.ts`.
- `src/core/index.ts` deve reexportar `./progress/index.ts`. Os nomes foram escolhidos para não colidir com nenhum barrel irmão (teste `barrel names`): nenhum `clamp`, `quantile` ou `expectedScore` sai do barrel. A duplicata de `expectedScore` em `src/core/lesson/orchestrator.ts` (mesma fórmula) pode passar a importar `progress/elo.ts`.
- Reconstrução do ledger de um domínio: `replayXpLedger(events, { existing, otherMinutesOn: (dia) => minutos dos outros domínios nesse dia })`.

## Como testar e calibrar

```bash
node scripts/run-tests.mjs "tests/progress-*.test.ts"     # invariantes I1–I7, Elo, níveis, tiers, badges, streak, simulador (paridade FSRS-7 com o learner), coorte
npx tsx scripts/calibrate-progression.ts                    # ≈ 8 min (FSRS-7); reescreve config/progression.json e o bloco abaixo
npx tsx scripts/calibrate-progression.ts --learners 300 --out /tmp/p.json --doc /tmp/p.md   # ensaio rápido
npx tsc --noEmit --allowImportingTsExtensions --strict --target es2022 --module esnext --moduleResolution bundler \
  --verbatimModuleSyntax --noUncheckedIndexedAccess --skipLibCheck --types node \
  src/core/progress/*.ts scripts/calibrate-progression.ts tests/progress-*.test.ts   # typecheck do módulo
```

O script sai com código 1 se alguma verificação de aceitação falhar. Mesmo assim ele grava os arquivos, com a verificação marcada ✗.

## Resultados da calibração Monte Carlo

<!-- calibration:begin -->
Gerado por `npx tsx scripts/calibrate-progression.ts` — 2000 alunos por perfil, 1100 dias, seed 20261118, núcleo de 1110 nós (940 h de aula), DR 0,90, memória FSRS-7 (ts-fsrs, pesos padrão — o modelo do aluno em runtime), regras `2026-11-r1`. Dia = dia de calendário desde o início; tiers avaliados semanalmente (dia 7w+6). "—" = a mediana não chega no horizonte.

**Verificações de aceitação**

| Verificação | Resultado | OK |
|---|---|---|
| Calendário de tiers a 3 h/dia (PM) reproduz r7 §5.2 (desvio ≤ 15 % além de 1 semana) | 13 / 27 / 76 / 160 / 279 / 412 / 552 d (desvio máx. 0,0 %) | ✓ |
| L10 no dia 7 (3 h/dia, mediana) | L10 | ✓ |
| L100 no dia 365 (3 h/dia, mediana) | L100 | ✓ |
| Doutor mediano a 3 h/dia = 18,2 ± 1 meses | 18,1 meses | ✓ |
| Doutor mediano a 4 h/dia ≈ 12–13 meses (11,6–13,6) | 13,1 meses | ✓ |
| Doutor a 2 h/dia ≈ 27 meses (25–29; estatística do r7: mediana entre quem chega em 1.000 dias) | 27,1 meses (mediana honesta, contando quem não chega: 29,2 meses) | ✓ |
| Farmer "Revisões antecipadas (50 % do tempo)" ≤ 0,7× XP/h do honesto | 0,64× | ✓ |
| Farmer "Skimmer (aula a 40 %, check 35 %)" ≤ 0,7× XP/h do honesto | 0,71× | ✗ |
| Limiares de tier estritamente crescentes | 1,18 < 2,91 < 5,60 < 9,34 < 14,13 < 19,94 < 26,75 | ✓ |

**Parâmetros calibrados** (gravados em `config/progression.json`)

| Parâmetro | Valor |
|---|---|
| Curva de nível | XP(L) = 17,6726 · L^1,7262 (r7: 20,10 · L^1,696) |
| XP mediano 3 h/dia no dia 7 / 365 | 941 / 50.084 |
| XP para subir L1→2 · L10→11 · L50→51 · L100→101 · L150→151 | 58 · 168 · 526 · 868 · 1.163 |
| Limiares de PM τ₁…τ₇ = PM mediano ao concluir o estágio k (r7 §5.4: 1,71 / 3,71 / 6,32 / 9,69 / 13,37 / 17,69 / 23,49) | 1,18 / 2,91 / 5,60 / 9,34 / 14,13 / 19,94 / 26,75 |
| Calendário estrutural a 3 h/dia, mediana em dias (r7 §5.2: 6 / 27 / 76 / 160 / 279 / 412 / 556) | 6 / 27 / 69 / 153 / 279 / 412 / 552 |

**Quando cada tier é atingido (critério PM)** — mediana [p10–p90] e fração que chega no horizonte

| Tier | 1 h/dia | 2 h/dia | 3 h/dia | 4 h/dia |
|---|---|---|---|---|
| Bronze | 27 d (0,9 m) [20–41] 100 % | 13 d (0,4 m) [13–20] 100 % | 13 d (0,4 m) [6–13] 100 % | 6 d (0,2 m) [6–13] 100 % |
| Prata | 97 d (3,2 m) [69–132] 100 % | 48 d (1,6 m) [34–62] 100 % | 27 d (0,9 m) [20–41] 100 % | 20 d (0,7 m) [13–34] 100 % |
| Ouro | 265 d (8,7 m) [202–349] 100 % | 118 d (3,9 m) [90–160] 100 % | 76 d (2,5 m) [55–104] 100 % | 55 d (1,8 m) [41–76] 100 % |
| Platina | 566 d (18,6 m) [433–734] 100 % | 251 d (8,2 m) [195–335] 100 % | 160 d (5,3 m) [118–216] 100 % | 111 d (3,6 m) [83–153] 100 % |
| Diamante | 1.000 d (32,9 m) [790–—] 69 % | 447 d (14,7 m) [348–580] 100 % | 279 d (9,2 m) [209–377] 100 % | 202 d (6,6 m) [153–265] 100 % |
| Mestre | — d (— m) [—–—] 5 % | 668 d (21,9 m) [517–854] 99 % | 412 d (13,5 m) [314–552] 100 % | 300 d (9,9 m) [229–391] 100 % |
| Doutor | — d (— m) [—–—] 0 % | 888 d (29,2 m) [692–—] 87 % | 552 d (18,1 m) [419–734] 100 % | 398 d (13,1 m) [307–524] 100 % |

**Critério estrutural (q = 0,8 por estágio, em ordem)** — mediana em dias, para conferir o alinhamento com o PM

| Tier | 1 h/dia | 2 h/dia | 3 h/dia | 4 h/dia |
|---|---|---|---|---|
| Bronze | 20 d | 6 d | 6 d | 6 d |
| Prata | 83 d | 41 d | 27 d | 20 d |
| Ouro | 251 d | 111 d | 69 d | 55 d |
| Platina | 559 d | 251 d | 153 d | 111 d |
| Diamante | 993 d | 440 d | 279 d | 195 d |
| Mestre | — d | 664 d | 412 d | 293 d |
| Doutor | — d | 881 d | 552 d | 391 d |

**XP acumulado e nível (medianas)**

| Perfil | d1 | d7 | d30 | d90 | d180 | d365 | d540 | d730 | d1095 |
|---|---|---|---|---|---|---|---|---|---|
| XP 1 h/dia | 38 | 310 | 1.381 | 4.159 | 8.338 | 17.070 | 25.258 | 34.273 | 51.454 |
| Nível 1 h/dia | 1 | 5 | 12 | 23 | 35 | 53 | 67 | 80 | 101 |
| XP 2 h/dia | 85 | 630 | 2.787 | 8.260 | 16.581 | 33.993 | 50.239 | 67.790 | 89.710 |
| Nível 2 h/dia | 2 | 7 | 18 | 35 | 52 | 79 | 100 | 119 | 140 |
| XP 3 h/dia | 134 | 941 | 4.117 | 12.306 | 24.582 | 50.084 | 71.372 | 84.768 | 92.941 |
| Nível 3 h/dia | 3 | 10 | 23 | 44 | 66 | 100 | 122 | 135 | 143 |
| XP 4 h/dia | 182 | 1.218 | 5.249 | 15.500 | 31.127 | 62.058 | 77.384 | 83.017 | 90.065 |
| Nível 4 h/dia | 3 | 11 | 27 | 50 | 75 | 113 | 128 | 134 | 140 |

**Esforço e revisões**

| Perfil | XP/h (180 d) | Horas até Doutor (p50) | Tempo em revisões (incl. reaprendizagem) | Revisões × 3 min / tempo (métrica do r7) |
|---|---|---|---|---|
| 1 h/dia | 57,1 | — h | 42,6 % | 35,0 % |
| 2 h/dia | 56,6 | 1.443 h | 40,5 % | 33,4 % |
| 3 h/dia | 55,6 | 1.362 h | 42,0 % | 34,7 % |
| 4 h/dia | 53,1 | 1.293 h | 43,0 % | 35,4 % |
| 3 h/dia, check 75 % | 50,9 | 1.425 h | 40,7 % | 33,5 % |
| 3 h/dia, velocidade 1,3× (mais lento) | 55,0 | 1.707 h | 34,7 % | 28,6 % |
| 3 h/dia, velocidade 0,8× (mais rápido) | 56,0 | 1.173 h | 47,4 % | 39,1 % |

**Sensibilidade (3 h/dia)** — Doutor pelo critério PM

| Variante | Doutor p50 | Ouro p50 | PM @180 d |
|---|---|---|---|
| base (check 90 %, κ ~ LogN(1; 0,25)) | 552 d (18,1 m) [419–734] 100 % | 76 d | 10,09 |
| 3 h/dia, check 75 % | 580 d (19,1 m) [447–762] 100 % | 83 d | 9,76 |
| 3 h/dia, velocidade 1,3× (mais lento) | 696 d (22,8 m) [629–783] 100 % | 97 d | 8,50 |
| 3 h/dia, velocidade 0,8× (mais rápido) | 475 d (15,6 m) [426–538] 100 % | 62 d | 11,26 |

**Anti-farming (3 h/dia, 180 dias, medianas)**

| Estratégia | XP/h (regras 2026-11-r1) | × honesto | XP/h (regra ingênua +50/aula, +10/revisão) | × honesto (ingênua) | PM @180 d | Tiers @180 d |
|---|---|---|---|---|---|---|
| Honesto | 55,6 | 1,00× | 108,7 | 1,00× | 10,09 | 4 |
| Revisões antecipadas (50 % do tempo) | 35,6 | 0,64× | 151,0 | 1,39× | 6,93 | 3 |
| Skimmer (aula a 40 %, check 35 %) | 39,7 | 0,71× | 195,5 | 1,80× | 8,46 | 3 |

Nota sobre 2 h/dia: o r7 relatou 27,1 meses como a mediana **entre os alunos que chegam a Doutor em 1.000 dias** (76 % deles). Aqui a mediana conta quem não chega como "ainda não" (horizonte de 1100 dias); a estatística equivalente à do r7 dá 27,1 meses.

Informativo (receita r7 §5.4, item 4): a 2 h/dia o aluno mediano chega a L100 por volta do dia 545, e perto de L100 cada nível custa ~868 XP ≈ 9,4 dias de estudo (meta da receita: ≤ 7 dias). Os níveis finais a 2 h/dia ficam, portanto, um pouco mais espaçados que a meta; a curva é ajustada para o aluno de referência de 3 h/dia, como pede a SÍNTESE.
<!-- calibration:end -->
