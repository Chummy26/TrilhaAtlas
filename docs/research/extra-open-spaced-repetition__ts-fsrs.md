# ts-fsrs v6 (FSRS-7) + @open-spaced-repetition/binding — análise para integração

> Relatório de pesquisa — 2026-11-18. Fonte analisada: clone raso em
> `_refs/extra/open-spaced-repetition__ts-fsrs` (commit `1edb96b1`, 2026-11-17).
> Nada do repositório foi executado (sem install/build/scripts): só leitura de código, docs e testes.
> Todos os caminhos `packages/...`, `docs/...`, `examples/...` abaixo são relativos a essa pasta.

---

## 0. TL;DR

- **O que é:** monorepo TypeScript com três pacotes publicados:
  - **`ts-fsrs@6.0.0`** é o agendador. Publicado em 2026-10-28, licença MIT, sem dependências de runtime além de `@open-spaced-repetition/srs-kit@1.0.0` (BSD-3-Clause).
  - **`@open-spaced-repetition/srs-kit@1.0.0`** é o framework genérico de SRS: Model, Chrono, Middleware e Scheduler.
  - **`@open-spaced-repetition/binding@0.6.1`** é o otimizador de pesos. Saiu em 2026-11-10, licença MIT, ainda em beta. É Rust (`fsrs-rs`) exposto via napi-rs, com builds nativos e WASI.
- **Modelo padrão:** **FSRS-7**, com 34 pesos e memória de duplo traço (`stability`, `stabilityFast`, `difficulty`). Os intervalos são em dias fracionários.
- **Benchmark:** no srs-benchmark (anki-revlogs-10k, verificado em 2026-11-18), o FSRS-7 treinado tem log loss 0,3206, RMSE(bins) 0,0615 e AUC 0,7475 com reviews no mesmo dia. O FSRS-6 tem 0,3842, 0,0985 e 0,6830. Mesmo com os **parâmetros default**, sem treino, o FSRS-7 fica em 0,3399 / 0,0895 / 0,7283, ou seja, melhor que o FSRS-6 treinado nesse cenário. Isso é ótimo para um app que começa sem histórico (ver §2).
- **API nova:** `defineScheduler({ model, chrono }).use(...middlewares).create({ config })` ou o preset assíncrono `DefaultScheduler()`. As operações são `newCard`, `preview`, `review`, `rollback`, `forget`, `nextInterval` e `forward`, todas puras, síncronas e imutáveis. Para reconstruir memória a partir do histórico há `Reschedule` (`ts-fsrs/reschedule`). O otimizador é `computeParameters` + `convertCsvToFsrsItems` + `evaluateWithTimeSeriesSplits`.
- **Compatibilidade com o nosso app (verificado):**
  - O Electron do learnharness é o **44.9.3**, que embute **Node 24.22.0, N-API 10**. Isso satisfaz `engines: node >=24` de ambos os pacotes. O binding nativo exige napi5 e existe para `win32-x64-msvc`, `darwin-arm64` etc.
  - **Licenças MIT e BSD-3 são compatíveis com AGPL-3.0.** Basta preservar os avisos de copyright (ver §11).
- **Achado importante no próprio learnharness:** já existe `plugins/flashcards/` com um agendador **FSRS-6 vendorizado de ts-fsrs 5.2.3** (`plugins/flashcards/src/scheduler.cjs`). O histórico completo de reviews é guardado em `state.reviews` com `{propositionId, rating, at, before, after}`. Isso torna viável migrar para FSRS-7 via `Reschedule.replay()` sem perder dados (ver §14.6).
- **Recomendação:**
  - Usar **`ts-fsrs@6` como dependência** (bundlada por esbuild no plugin ou importada no core). Montar um `defineScheduler` explícito com FSRS-7, `dateChrono` com `fractionalDays: true` e os 7 middlewares padrão, opcionalmente mais o leech.
  - **Não portar à mão** o framework de middleware. Se precisar vendorizar, os arquivos do modelo FSRS-7 são autocontidos (~450 linhas, ver §13.2).
  - Usar o **binding** só no processo Node (core/Electron main) para treinar pesos **por domínio** (Inglês, Eletrônica) depois de haver histórico suficiente.

---

## 1. Identificação e estado atual

| Item | Valor (verificado) |
|---|---|
| Repo | https://github.com/open-spaced-repetition/ts-fsrs |
| Commit analisado | `1edb96b1dd6e3d4ad6068bbb1f795b2636e2a618` (2026-11-17) |
| `ts-fsrs` npm | `latest = 6.0.0` (publicado 2026-10-28T14:11Z); betas 6.0.0-beta.1…15 entre set–out/2026 |
| `@open-spaced-repetition/srs-kit` npm | `latest = 1.0.0` (2026-10-28) |
| `@open-spaced-repetition/binding` npm | `latest = 0.6.1` (2026-11-10); 0.6.0 em 2026-10-28 |
| Engines | `ts-fsrs` e `binding`: Node `>=24.0.0`; `srs-kit`: Node `>=20` |
| Toolchain do repo | pnpm 12, Turbo, TypeScript 7 (tsgo) na raiz, tsdown (Rolldown), Vitest 5, Biome |
| Rust | crate `fsrs-binding` (edition 2024), `fsrs` (fsrs-rs) fixado em `rev = 65224f1d…`, `napi 3.14`, `jiff 0.2.41` (tzdb embutido), `csv 1.4` |
| Docs | https://open-spaced-repetition.github.io/ts-fsrs/ (+ `llms.txt` para agentes) |

Layout do monorepo:

```
packages/
  srs-kit/        # framework genérico (BSD-3): primitives, schema, model, chrono, middleware, scheduler
  fsrs/           # ts-fsrs (MIT): modelos FSRS-3..7, middlewares FSRS, DefaultScheduler, Reschedule, API legada
  binding/        # Rust + napi-rs (MIT): otimizador, CSV→FSRSItem, avaliação, passos ótimos
  binding/npm/*   # pacotes por plataforma (win32-x64-msvc, darwin-arm64, …, wasm32-wasip1, wasm32-wasi)
  binding-test/   # testes do binding (train/csv/dynamic/threadless)
docs/             # site Rspress (guias em docs/src/en-US/guide, snippets executáveis em docs/src/snippets/run-code)
examples/nextjs   # treino via API route (nativo) + Web Worker (wasm32-wasip1)
examples/vite     # treino no browser
```

---

## 2. Por que FSRS-7: números atuais do srs-benchmark

Os números abaixo vêm do README de https://github.com/open-spaced-repetition/srs-benchmark (lido em 2026-11-18): médias com IC 99%, dataset anki-revlogs-10k.

**Com reviews no mesmo dia** (10.000 coleções, 519.296.315 reviews avaliadas):

| Modelo | Params | Log Loss ↓ | RMSE(bins) ↓ | AUC ↑ |
|---|---|---|---|---|
| RWKV-Instant (rede) | 2.762.884 | 0,2660 | 0,0321 | 0,8450 |
| LSTM | 8.869 | 0,3140 | 0,0520 | 0,7622 |
| GRU | 503 | 0,3141 | 0,0536 | 0,7606 |
| FSRS-7 "recency", 100 épocas | 34 | 0,3177 | 0,0561 | 0,7533 |
| **FSRS-7** | 34 | **0,3206** | **0,0615** | **0,7475** |
| SBD | 7 | 0,3218 | 0,0586 | 0,7445 |
| **FSRS-7 (pesos default)** | 0 treinados | 0,3399 | 0,0895 | 0,7283 |
| FSRS-6 | 21 | 0,3842 | 0,0985 | 0,6830 |

**Sem reviews no mesmo dia** (9.999 coleções, 349,9M reviews): FSRS-7 tem log loss 0,3401 e AUC 0,7167; FSRS-6 tem 0,3460 e 0,7034; FSRS-7 default tem 0,3620 e 0,7029.

O que isso significa para nós:

- O FSRS-7 é o melhor **modelo leve e interpretável** (34 parâmetros, sem rede neural) do benchmark. O ganho sobre o FSRS-6 é enorme quando há reviews no mesmo dia, que é exatamente o nosso caso: sessões de estudo com cartões ao fim de cada aula, revisitados no mesmo dia.
- Redes como RWKV e LSTM são melhores, mas não têm biblioteca TS pronta e exigem inferência pesada. Não se justificam como agendador.
- **Começar com pesos default é aceitável.** Treinar pesos próprios melhora a log loss em cerca de 6% (0,3399 → 0,3206). A variante "recency" (peso maior a reviews recentes no treino) existe no benchmark, mas **não** está exposta no binding 0.6.1. Não encontrei a opção no código.

---

## 3. Arquitetura (srs-kit + ts-fsrs)

### 3.1 Quatro peças

| Peça | Responsabilidade | Onde |
|---|---|---|
| **Model** | `step` (atualiza memória), `nextInterval` (intervalo base para uma retenção), `forgettingCurve` (R(t)), `forward` (replay) | contrato em `packages/srs-kit/src/model/model.ts`; FSRS-7 em `packages/fsrs/src/models/fsrs-7/` |
| **Chrono** | representação do tempo e aritmética de dias: `now`, `difference`, `add`, `compare`; normaliza `{previous,current}` a partir de campos do card/revlog | `packages/srs-kit/src/chrono/chrono.ts`, presets em `chrono/presets/{date,numeric,temporal-instant}` |
| **Middleware** | políticas: retenção desejada, passos de aprendizado, fuzz, limites, estatísticas, leech, Cost-ADR. Estende schemas de config/card/revlog | `packages/srs-kit/src/middleware/middleware.ts`; built-ins em `packages/fsrs/src/middlewares/*` |
| **Scheduler** | compõe schemas, valida, orquestra `newCard/review/preview/rollback/forget/nextInterval/forward` | `packages/srs-kit/src/scheduler/{define-scheduler.ts,base.ts,scheduler-schema.ts,default-value.ts}` |

### 3.2 Definição versus instância

`defineScheduler(...)` retorna uma **definição** imutável. Cada `.use(...)` cria um novo nó numa lista ligada de middlewares (`define-scheduler.ts`, `flattenMiddlewares`) e devolve uma nova definição.

`.create({ config })` parseia a config com o schema composto (modelo + chrono + todos os middlewares) e instancia `BaseScheduler`. O modelo é criado com `bypass: true`, porque a config já foi validada.

Na prática: **a definição fica em escopo de módulo e as instâncias são criadas por usuário/domínio/config.**

### 3.3 Fluxo de um `review` (`packages/srs-kit/src/scheduler/base.ts`)

1. O schema composto faz `parse(card)`. O card de saída contém **somente** os campos declarados por modelo, chrono, core (`state`, `scheduleStatus`) e middlewares. **Campos desconhecidos são descartados** (`scheduler-schema.ts`, `card = defineSchema(...)`).
2. `chrono.normalize({card, time: now})` produz `{ previous: lastReviewAt, current: dueAt }`.
3. `elapsedDays` vale `0` se `state === New`; caso contrário, `chrono.difference(previous ?? current, now)`. É validado por `elapsedDaysSchema`, que **lança erro se for negativo**.
4. `retrievability = model.forgettingCurve(memoryState, elapsedDays)`.
5. Um **candidate** cacheia, por nota, o estado pós-review (`step`) e os intervalos (`nextInterval`) por retenção. Os middlewares podem decorar `candidate.nextInterval`: é assim que fuzz e learning-steps funcionam.
6. Os middlewares rodam em "cebola": para `.use(A,B)` a ordem é `A antes → B antes → core → B depois → A depois`. Na review, os handlers `review` e `nextInterval` de cada middleware são intercalados na mesma posição (`reviewIntervalHandlers`).
7. O **core** (centro da cebola) faz `memoryState = candidate.step(grade)` e `scheduledDays ??= candidate.nextInterval(memoryState, desiredRetention[grade])`. O card recebe o novo estado de memória, com `state=Review` e `scheduleStatus='review'` por padrão. O revlog recebe o estado **pré-review**, `rating`, `state` e `scheduleStatus` antigos.
8. Os defaults do chrono gravam `card.dueAt = chrono.add(now, scheduledDays)` e `card.lastReviewAt = now`. No revlog gravam `dueAt` (pré-review), `lastReviewAt` (review anterior) e `reviewTime = now`.
9. Card e revlog são re-parseados pelos schemas e retornados como objetos novos. **Nada é mutado nem persistido.**

`preview` faz os passos 1–5 uma vez e devolve um **iterável preguiçoso** (`createLazyIterable`) com as 4 notas `{grade, card, revlog}`. `rollback` executa os handlers `rollback` e restaura o card a partir do snapshot pré-review do revlog. `forget` recria o card com os defaults, preservando `cardId`; zera ou não `reps/lapses` conforme `clearStatsOnForget`.

---

## 4. API pública do `ts-fsrs@6` (o que usar)

### 4.1 Entry points (package.json `exports`)

| Import | Conteúdo útil |
|---|---|
| `ts-fsrs` | `DefaultScheduler`, `defineScheduler`, `defineModel`, `defineChrono`, `defineMiddleware`, `dateChrono`, `numericChrono`, `temporalInstantChrono`, `Rating`, `State`, `type Grade`, schemas (`gradeSchema`, `desiredRetentionSchema`…), `FSRSMemoryStateSchema`, todos os middlewares (re-export), **API legada deprecada** (`fsrs()`, `FSRS`, `createEmptyCard`…) |
| `ts-fsrs/middlewares` | `schedulerDesiredRetentionMiddleware`, `schedulerFuzzingMiddleware`, `createSchedulerFuzzingMiddleware`, `schedulerStatsMiddleware`, `schedulerScheduledDaysMiddleware`, `schedulerLearningStepsMiddleware`, `schedulerMaximumIntervalMiddleware`, `schedulerMonotonicIntervalMiddleware`, `schedulerLeechMiddleware`, `schedulerCostAdrMiddleware`, `calculateLearningSteps`, schemas |
| `ts-fsrs/models/fsrs-7` | `FSRS7Model`, `FSRS7Algorithm`, `curve`, `FSRS7_DEFAULT_WEIGHTS`, `FSRS7_MODEL_BOUNDS`, `FSRS7ParameterBounds`, `clip/check/migrateFSRS7Parameters`, `FSRS7MemoryStateSchema`, `type FSRS7State` |
| `ts-fsrs/models/fsrs-6` (e -5, -4dot5, -4, -3) | `FSRS6Model`, `FSRS6_DEFAULT_WEIGHTS`, `migrateFSRS6Parameters`, `forgetting_curve`… |
| `ts-fsrs/reschedule` | `Reschedule` (`replay`, `reschedule`) |

O pacote tem `sideEffects: false`, saída ESM (`.mjs`), CJS (`.cjs`) e tipos `.d.mts`/`.d.cts`. O preset `DefaultScheduler` usa `import()` dinâmico por versão de modelo (`scheduler/preset.ts`). Por isso ele é `async`.

### 4.2 `DefaultScheduler(options)` (`packages/fsrs/src/scheduler/default-scheduler.ts`)

| Opção | Default | Observação |
|---|---|---|
| `version` | `'FSRS-7'` | `'FSRS-3'…'FSRS-7'` |
| `weights` | pesos default da versão | passa por `migrateFSRSxParameters` |
| `desiredRetention` | `0.9` | `(0,1)` aberto; aceita também `Record<Grade, number>` (**retenção por nota**) |
| `enableShortTerm` | `true` | no FSRS-7 controla **só** os passos explícitos; o traço rápido do modelo é intrínseco |
| `learningSteps` | `['1m','10m']` | formato `${number}${'m'\|'h'\|'d'}` |
| `relearningSteps` | `['10m']` | |
| `graduatingInterval` | `1` (dia) | intervalos finais menores que isso mantêm o card em Learning/Relearning |
| `allowModelOverride` | `true` **só no FSRS-7** | se o intervalo do modelo for maior que o passo, ele prevalece |
| `enableFuzz` | `false` | fuzz determinístico por `cardId + reps` |
| `maximumInterval` | `36500` | inteiro positivo |
| `clearStatsOnForget` | `true` | no v5 o comportamento equivalente era `false` |

O preset usa `dateChrono` com `fractionalDays: isFSRS7` e esta ordem de middlewares:
`desiredRetention → fuzzing → stats → scheduledDays → learningSteps → maximumInterval → monotonicInterval` (`preset.ts`).

### 4.3 Métodos do scheduler (`SchedulerCore`, em `packages/srs-kit/src/scheduler/scheduler.ts`)

| Método | Assinatura (simplificada) | Notas |
|---|---|---|
| `newCard({ now?, cardId? })` | → Card | `cardId` vem do middleware de fuzz; sem ele, gera um `crypto.randomUUID()` |
| `preview({ card, now? })` | → `LazyIterable<{grade, card, revlog}>` | iterar com `for…of`/`Array.from`; **não** é um objeto indexado por nota |
| `review({ card, grade, now? })` | → `{ card, revlog }` | `grade ∈ {1,2,3,4}`; `Manual (0)` é rejeitado |
| `rollback({ card, revlog })` | → Card | exige o revlog **v6** gerado pela review |
| `forget({ card, now? })` | → Card | reset para New; **não** gera revlog (o app deve registrar o evento manual) |
| `nextInterval(memoryState, desiredRetention, { card, grade, elapsedDays })` | → dias | aplica as políticas de intervalo sem avançar o card |
| `forward({ history, initialCard? })` | → `ScheduleResult[]` | replay pela política completa; o histórico deve vir ordenado e sem Manual |
| `model.forgettingCurve(state, elapsedDays)` | → R ∈ (0,1) | retrievability numérica |
| `model.nextInterval(state, r)` | → dias (fracionários no FSRS-7) | intervalo base, sem políticas |
| `chrono.difference(from, to)` / `chrono.add(from, days)` | | com `fractionalDays:true`: (to−from)/86.400.000 |
| `config`, `model.config.weights`, `definition.model.name` (`'fsrs-7'`) | | o nome do modelo deve ser persistido junto com os pesos |

### 4.4 Formato do card e do revlog (DefaultScheduler FSRS-7 = `dateChrono` + 7 middlewares)

Card:

| Campo | Origem | Tipo |
|---|---|---|
| `stability`, `stabilityFast`, `difficulty` | modelo FSRS-7 | number (0 em card novo) |
| `state` | core | `0 New, 1 Learning, 2 Review, 3 Relearning` |
| `scheduleStatus` | core (+ middlewares) | `'new' \| 'learning' \| 'review'` (+ `'suspended'` com leech) |
| `dueAt`, `lastReviewAt` | dateChrono | `Date`, `Date \| null` |
| `cardId` | fuzzing | `string \| number` |
| `reps`, `lapses` | stats (+ fuzzing) | inteiros ≥ 0 |
| `scheduledDays` | scheduledDays | number ≥ 0 (fracionário com `fractionalDays`) |
| `learningStep` | learningSteps | índice do próximo passo (não é contagem de reviews) |

O revlog contém o estado de memória **pré-review**, `rating`, `state`/`scheduleStatus` **pré-review**, `dueAt` (pré-review), `lastReviewAt` (review anterior), `reviewTime` (agora), `cardId`, `scheduledDays` e `learningStep` anteriores. Esses campos bastam para fazer `rollback` exato. Ver `packages/fsrs/src/scheduler/default-scheduler.fsrs7.spec.ts`: o teste "replays fractional histories" faz rollback de toda a sequência até o card novo.

Saída real do snippet `docs/src/snippets/run-code/default-scheduler.ts` (card novo, Good, FSRS-7 default):
`state: 2 (Review), dueAt: +4,78 dias, stability: 3.9221, stabilityFast: 3.13768, difficulty: 3.53072398`.
Ou seja, **com `allowModelOverride: true` o primeiro Good já pula o passo de 10 min.**

Transições com `allowModelOverride: false` e passos `['1m','10m']`/`['10m']` (`docs/src/snippets/run-code/state-transitions.output.ts`):
```
New --Again--> Learning (1m) ; Learning --Good--> Learning (10m) ; Learning --Hard--> Learning (5.5m)
Learning --Good (último passo)--> Review (1 dia) ; New --Easy--> Review (~53,9 dias)
Review --Again--> Relearning (10m) ; Relearning --Good--> Review (1 dia)
```

### 4.5 Quickstart mínimo

```ts
import { DefaultScheduler, Rating } from 'ts-fsrs'
const scheduler = await DefaultScheduler()            // FSRS-7
const card = scheduler.newCard({ cardId: 'n42', now: new Date() })
for (const { grade, card: c } of scheduler.preview({ card, now: new Date() })) {
  console.log(grade, c.dueAt)                          // rótulos dos botões
}
const { card: next, revlog } = scheduler.review({ card, grade: Rating.Good, now: new Date() })
```

---

## 5. O algoritmo FSRS-7 (o que realmente roda)

Arquivo central: `packages/fsrs/src/models/fsrs-7/algorithm.ts` (304 linhas), "ported from fsrs-rs model_v7.rs". A paridade numérica é testada contra fsrs-rs `c9562d6` e srs-benchmark `b4b0254` em float32 (`model.spec.ts`, `default-scheduler.fsrs7.spec.ts`).

### 5.1 Estado, limites e pesos (`constants.ts`)

- Estado: `{ stability S_s, stabilityFast S_f, difficulty D }`. Card novo: `{0,0,0}`.
- Limites `FSRS7_MODEL_BOUNDS`: `S_s, S_f ∈ [0.0001, 36500]`, `D ∈ [1, 10]`.
- 34 pesos default (`FSRS7_DEFAULT_WEIGHTS`, origem "fsrs-rs c9562d6 inference_v7.rs"):
  ```
  0.1104, 2.2395, 3.9221, 11.7841, 6.1686, 0.6457, 3.6807, 1.9795, 0, 1.3826,
  0.7024, 0.5999, 0.8146, 0.6398, 1, 1.3207, 0.6707, 3.8668, 0.4416, 0.0934,
  1.8631, 0.6162, 1.0869, 0.1567, 0.0801, 0.2421, 0.9464, 0.1433, 0.7145, 0,
  0.5667, 0.3734, 0.5333, 0.3048
  ```
- `FSRS7ParameterBounds()` define as caixas por índice. `clipFSRS7Parameters` também impõe monotonicidade: `w0 ≤ w1 ≤ w2 ≤ w3` (estabilidades iniciais por nota) e `w26 ≥ w25`. `checkFSRS7Parameters` exige exatamente 34 pesos já dentro dos limites.

### 5.2 Inicialização (primeira review)

`S_s0 = clamp(w[G-1])`, `S_f0 = clamp(0.8·S_s0)`, `D0(G) = w4 − e^{w5·(G−1)} + 1`, com clamp em [1,10]. Tudo arredondado a 8 casas.

### 5.3 Curva de esquecimento de duplo traço

```ts
// prepare_fast (traço rápido)
const decay = -clamp(w[23] * Math.pow(s, w[33] - 0.3), 0.01, 0.95)
const factor = Math.exp(Math.min(Math.log(w[25]) / decay, 60)) - 1
// prepare_curve (traço lento + pesos de mistura)
const decay = -clamp(w[24], 0.01, 0.95)
const scale = ((Math.pow(w[26], 1 / decay) - 1) * Math.exp((d - 5) * (w[32] - 0.3))) / s
const weight1 = w[27] * Math.pow(sFast, -w[29])
const weight2 = w[28] * Math.pow(s, w[30]) * Math.exp((d - 5) * (w[31] - 0.5))
// compute_curve
retrievability = ((weight1 * fast + weight2 * slow) / total) * (1 - 2e-5) + 1e-5
```

Cada traço é uma lei de potência `R_x(t) = (1 + F_x·t/S_x)^{d_x}`, e R é a média ponderada dos dois. Os pesos de mistura dependem do **estado**, não do tempo. Consequências:

- O traço rápido domina logo após a review e o lento domina no longo prazo.
- `R(0) = 0,99999`.
- **Nenhuma das duas estabilidades é "o intervalo com R = 90%"**, ao contrário do FSRS-3–6. Para exibir "estabilidade" ao usuário, calcule `model.nextInterval(state, 0.9)`.
- `curve(weights, t, state)` (standalone) devolve `{retrievability, derivative, fast, slow, fastWeight, slowWeight, total}`. **`total` é a soma dos pesos de mistura, não uma probabilidade.**

### 5.4 Atualização após review (`next_state`)

```ts
// next_stability(s, d, r, grade, start)  -- start = 7 (lento) ou 15 (rápido)
const fail = w[start+3] * (Math.pow(s + 1, w[start+4]) - 1) * Math.exp((1 - r) * w[start+5])
const pls = Math.min(s, fail)                     // estabilidade pós-lapso
if (grade === Again) return pls
const increase = Math.exp(w[start] - 1.5) * (11 - d) * Math.pow(s, -w[start+1])
               * (Math.exp((1 - r) * w[start+2]) - 1) * hardPenalty * easyBonus + 1
return Math.max(pls, s * increase)
```

Detalhes da atualização:

- Lento: `T_7(S_s, R_mix, G)`. Rápido: `T_15(S_f, R_fast(t), G)`, ou seja, o traço rápido usa a recall **do próprio traço**.
- Em Again: `S_f ← min(S_f', 0.8·S_s')`.
- Dificuldade: `ΔD = −w6·(G−3)`, multiplicado por `(R+0.1)` em Again, depois `D' = 0.01·D0(4) + 0.99·(D + (10−D)·ΔD/9)`, com clamp em [1,10]. A reversão à média é **fixa em 0,01**; no FSRS-6 era `w7`.
- `rating === Manual (0)` não altera nada. `retrievability` passado explicitamente deve estar em (0,1).
- **Não há fórmula especial de "short-term"**: tempos fracionários, inclusive 0, entram na mesma equação.

### 5.5 Intervalo (`next_interval`)

Inverte `R(I) = r` numericamente. São até 7 passos de Newton em log-tempo, com passo limitado a ±4. Se o erro final for maior que 1e-3, cai para bisseção (50 iterações) num intervalo que dobra até `sMax`. `r` é validado em (0,1) e grampeado em [0.0001, 0.9999]; `r ≥ 0.9999` devolve 0. O resultado está em **dias fracionários** (pode ser menor que 1 minuto; ver o teste "keeps a repeated lapse under two minutes" em `model.spec.ts`).

### 5.6 Comparação com FSRS-6 (para quem lê o `scheduler.cjs` atual do plugin)

| | FSRS-6 | FSRS-7 |
|---|---|---|
| Pesos | 21 (`w20` = decay) | 34 (`w20` **não** é decay; teste "does not treat w20 as a forgetting-curve decay parameter") |
| Estado | S, D | S_s, S_f, D |
| Curva | uma lei de potência, `R(S)=0.9` | mistura de duas leis de potência |
| Mesmo dia | `next_short_term_stability` se `t=0 && enableShortTerm` | mesma equação com t fracionário |
| Intervalo | fechado, `round`, ≥ 1 dia | Newton+bisseção, fracionário |
| Tempo | dias inteiros (`fractionalDays:false`) | `fractionalDays:true` obrigatório na prática |

---

## 6. Middlewares embutidos (políticas)

Todos ficam em `packages/fsrs/src/middlewares/<nome>/{middleware.ts,core.ts,schema.ts}`, exceto stats, que está em `packages/srs-kit/src/middleware/stats/`.

| Middleware | Config | Campos | Comportamento-chave |
|---|---|---|---|
| desired-retention | `desiredRetention: number \| Record<Grade,number>` | — | preenche `candidate.desiredRetention[grade]` antes do core |
| fuzzing (`createSchedulerFuzzingMiddleware({fuzzingRange, rng})`) | `enableFuzz`, `maximumInterval`, `fractionalDays?` | `cardId`, `reps`; revlog `cardId` | só fuzza intervalos ≥ 2,5 dias; faixas 15%/10%/5% (`FUZZ_RANGES`); semente `${cardId}${reps}` → FNV-1a + Mulberry32 (`core.ts`) — **determinístico** |
| stats | `clearStatsOnForget` (default `true`) | `reps`, `lapses` | lapso = Again num card **Review** |
| scheduled-days | `fractionalDays` | `scheduledDays` (card e revlog) | com `fractionalDays:false` faz `floor` (passos sub-dia viram 0) |
| learning-steps | `enableShortTerm`, `learningSteps`, `relearningSteps`, `graduatingInterval=1`, `allowModelOverride=false` (o preset liga para FSRS-7) | `learningStep` | ver tabela abaixo; o **intervalo final** decide o estado: menor que `graduatingInterval` → Learning/Relearning |
| maximum-interval | `maximumInterval` | — | `min(scheduledDays, max)` no retorno |
| monotonic-interval | `maximumInterval` | — | garante `Again ≤ Hard ≤ Good ≤ Easy`; acima de 1 dia, cada nota tem pelo menos +1 dia em relação à anterior (`calculateScheduleDay`) |
| leech (opt-in) | `leechThreshold` (0 = off) | `lapses`; status `'suspended'` | suspende quando `lapses % threshold === 0`; o app filtra a fila |
| cost-adr (opt-in) | `costAdrPolicy` (15 coef.), `goalCostWeight ∈ [0,1024]` | — | **substitui** desired-retention: retenção por card em função de (S,D,custo); política vem de fsrs-rs `cost_adr.rs` |

Regras de `getLearningStepInterval` (`learning-steps/middleware.ts`), com passos `['1m','10m']`/`['10m']` e graduação em 1 dia:

| Card | Nota | Override | Passo | Modelo | Intervalo |
|---|---|---|---|---|---|
| New | Good | off | 10m | – | 10m |
| New | Again | on | 1m | 3s | 1m |
| New | Hard | on | 5,5m | 14h | 14h |
| Review | Again | on | 10m | 13d | 1d (limitado à graduação) |
| Learning, último passo | Good | on/off | – | 7m | 1d (gradua) |
| Review, steps vazios | Good | – | – | 2h | 2h (fica em Relearning) |

**A ordem importa.** Registre scheduled-days **antes** das políticas de intervalo, para que grave o valor final no retorno. Registre learning-steps **antes** de max/monotonic, para que os passos mantenham o atraso exato. Registre leech **antes** de learning-steps, para que a suspensão seja aplicada por último (`docs/src/en-US/guide/middleware/lifecycle.mdx`).

**Middleware próprio** (exemplo oficial "streak" em `docs/src/snippets/run-code/middleware.ts`): `defineMiddleware({ name: Symbol(...), schema: { config, card, revlog }, defaultValue: { card }, handlers: { review(ctx,next){ next(); ... }, rollback(ctx,next){ next(); ... } } })`.

- Os schemas podem ser **Zod** (Standard Schema) ou `defineSchema` do srs-kit.
- Os handlers devem ser **puros**: sem I/O, porque `preview` executa os mesmos handlers.
- Para que o rollback funcione, salve o valor antigo no revlog.

Isso é útil para anexar ao card campos nossos que precisem participar do undo, como `streak` ou `xpBucket`.

---

## 7. Chrono: tempo e "dias"

| Preset | Tempo | `difference` | `add` |
|---|---|---|---|
| `dateChrono` (padrão) | `Date` | `fractionalDays:false` (**default do schema**) → diferença de **datas UTC** (`dateDiffInDays`); `true` → `(to−from)/86.400.000` | sempre ms fixos (24h × dias, com frações) |
| `numericChrono` | número (dias) | `to − from` | `from + days` (útil em simulações) |
| `temporalInstantChrono` | `Temporal.Instant` | modos `fractional`, `utc` e `zoned` (data civil no fuso configurado) | `zoned` soma dias civis, corrigindo DST |

Pontos críticos:

- **Não existe "hora de virada do dia" (`nextDayStartsAt`) no agendador**, só no conversor CSV do binding. O plugin atual do learnharness usa `dayStart=4` e `dueDay` local. Com FSRS-7 e `fractionalDays:true` o `dueAt` é um instante exato. A regra "está vencido hoje?" (por exemplo, tudo que vence até o fim do dia de estudo local) é **política de fila do app**, não do scheduler.
- `dateSchema` aceita só `Date` válida e **rejeita `new Date(0)`** (`getTime() !== 0`, em `packages/srs-kit/src/schema/field.ts`). Strings ISO e números também são rejeitados. Desserialize antes de chamar.
- `temporalInstantChrono` precisa de `globalThis.Temporal`. A mensagem de erro do código sugere Node 26+ ou polyfill. Com Node 24 do Electron, **use `dateChrono`**.

---

## 8. `Reschedule`: replay de histórico e migração de modelo

`packages/fsrs/src/reschedule/reschedule.ts`:

- `new Reschedule(scheduler).replay({ history, initialState? }, { sortHistory = true })` → `{ memoryState, memoryStates[] }`.
  - Valida `rating` (filtra `Manual`) e o tempo (`chrono.schema.time`).
  - Ordena com `chrono.compare`. Tempos iguais mantêm a ordem gravada, porque `Array.prototype.sort` é estável.
  - Constrói `deltaT` com `chrono.difference`. O primeiro vale 0; tempos que voltam para trás **lançam erro**.
  - Chama `model.forward` uma única vez.
  - Histórico vazio ou só com Manual → `FSRSValidationError`.
- `reschedule({ history, initialCard? })` → `{ results, card }`. Passa pela **política completa** (`scheduler.forward`), então pode mudar `dueAt`, passos e contadores.

Guia oficial de migração (`docs/src/en-US/guide/migration.mdx`, snippets `docs/src/snippets/run-code/migration-v6.ts` e `migration-fsrs7.ts`):

1. Migrar primeiro a API (v5 → v6) **mantendo FSRS-6**, e só depois o modelo.
2. Mapeamento de campos: `due→dueAt`, `last_review→lastReviewAt` (`null` se New), `learning_steps→learningStep`, `scheduled_days→scheduledDays`. `scheduleStatus` vale `'new'` para New, `'learning'` para Learning/Relearning e `'review'` para Review. `{card, log}` vira `{card, revlog}`. Os campos `elapsed_days` saíram.
3. Para FSRS-7: rodar `replay` com o **histórico completo desde a criação ou desde o último reset**, aplicar **só** `memoryState` ao card atual e **não mexer em `dueAt`, contadores, `learningStep` nem nos revlogs antigos**.
4. **Nunca** inventar `stabilityFast = 0.8·S` para um card já aprendido. Cards sem histórico completo continuam em FSRS-6 (roteados pela versão de modelo persistida).
5. Revlogs antigos **não** servem para `rollback` FSRS-7. É preciso estabelecer uma "fronteira de undo".

---

## 9. `@open-spaced-repetition/binding` (otimizador)

### 9.1 API exportada (`packages/binding/src/*.rs`, `#[napi]`)

| Export JS | Origem | Uso |
|---|---|---|
| `convertCsvToFsrsItems(data, nextDayStartsAt, timezoneOrOffset, modelVersion?)` | `convert.rs` | `Uint8Array` → `FSRSBindingItem[]` (síncrono); `ReadableStream<Uint8Array>` → Promise |
| `convertCsvToFsrsItemsWithCardIds(...)` | `convert.rs` | `{ items, cardIds }`: IDs numéricos por card, para treino "windowed" |
| `computeParameters(items, options)` | `train.rs` | `Promise<number[]>` (34 pesos no FSRS-7, 21 no FSRS-6) |
| `evaluateWithTimeSeriesSplits(items, options)` | `evaluate.rs` | `Promise<{ logLoss, rmseBins }>` |
| `computeOptimalSteps(csv, retention, decay)` | `steps.rs` | recomenda passos de (re)aprendizado; **não serve para FSRS-7** (curva de mistura) |
| `new FSRSBinding(params?)` | `lib.rs` | `.nextStates(memory, dr, daysElapsed)`, `.evaluate(items, cardIds?)`, `.memoryStateFromSM2(ease, interval, r)`, `.universalMetrics(items, params?)`. Sem params = FSRS-7 default |
| `FSRSBindingItem([FSRSBindingReview(rating, deltaT)…])` | `model.rs` | o primeiro `deltaT` deve ser 0; ratings 1–4 |
| `BindingMemoryState(stability, difficulty, stabilityFast?)` | `model.rs` | `stabilityFast` default = `stability` (só compatibilidade) |

`ComputeParametersOptions` (`model.rs`):

| Campo | Significado |
|---|---|
| `modelVersion` | `'FSRS-7'` (default) ou `'FSRS-6'` |
| `enableShortTerm` | obrigatório no tipo; o default interno é `true` |
| `enableSchedPenalties?` | só FSRS-7; adiciona penalidades de crescimento de intervalo e de intervalos curtos à loss |
| `numRelearningSteps?` | |
| `cardIds?` | alinhado com `items`; ativa o treino "windowed" do upstream |
| `trainingConfig?` | `{ numEpochs, batchSize, seed, maxSeqLen, learningRate, gamma }` |
| `progress?(cur, total)` | retornar `false` cancela |
| `timeout?` | intervalo de polling do progresso em ms (default 500); **não é deadline** |

### 9.2 Formato CSV de revlog (`RevlogEntry` em `convert.rs`)

```
card_id,review_time,review_rating,review_state,review_duration
n42,1704067200000,3,0,1000
```

Colunas, conforme lidas pelo conversor:

- `review_time`: epoch em **ms**.
- `review_rating`: 1–4. Linhas com outros valores, inclusive Manual = 0, são descartadas.
- `review_state`: estado **pré-review**, de 0 a 3.
- `review_duration`: ms, inteiro sem sinal (`u32`). O conversor exige a coluna, mas não usa o valor.

Pré-processamento aplicado pelo conversor:

- Ordena por `(card_id, review_time)`.
- Por card, mantém só o **último bloco contíguo de estados 0/1** em diante. Isso detecta resets automaticamente. Também limita a 1024 reviews.
- No FSRS-7, `deltaT` é a posição fracionária dentro do "dia de estudo" local, definido por `nextDayStartsAt` (0–23h) e pelo fuso IANA (via `jiff`, com DST). No FSRS-6 usa dias inteiros.
- Emite um `FSRSItem` por review com `deltaT > 0`, contendo todo o prefixo de reviews.
- `prepare_items` aplica `filter_outlier` do fsrs-rs.

### 9.3 Runtimes

| Pacote | Quando | Observações |
|---|---|---|
| `@open-spaced-repetition/binding` + `binding-<plataforma>` (optionalDependencies) | Node, Electron main, servidor Next | `computeParameters` roda como AsyncTask no threadpool do libuv, sem bloquear o event loop. Pânicos viram rejeição da Promise (0.6.1) |
| `@open-spaced-repetition/binding-wasm32-wasip1` (threadless) | navegador (Web Worker), Cloudflare `/workerd` | **síncrono** na thread chamadora; rodar em Worker dedicado; não exige COOP/COEP; SIMD128 |
| `@open-spaced-repetition/binding-wasm32-wasi` (threads) | — | **deprecado**, remoção prevista na próxima versão; exige COOP/COEP |

Exemplo Next.js oficial:

- `examples/nextjs/next.config.ts` declara `serverExternalPackages: ['@open-spaced-repetition/binding']`. O comentário diz que o Turbopack não bundla o `.node`.
- A rota `examples/nextjs/src/app/api/train/route.ts` usa Hono com SSE de progresso.
- O worker `examples/nextjs/src/training.worker.ts` usa `import('@open-spaced-repetition/binding-wasm32-wasip1')`, com progresso limitado a uma mensagem a cada 500 ms.

---

## 10. Testes relevantes (leitura obrigatória para quem for implementar)

| Arquivo | O que garante |
|---|---|
| `packages/fsrs/src/models/fsrs-7/model.spec.ts` | paridade com fsrs-rs/benchmark; traços distintos; intervalos sub-minuto; `w20` ignorado; inversão da curva para r ∈ {0.1…0.9998} |
| `packages/fsrs/src/models/fsrs-7/algorithm.spec.ts` | fallback para bisseção; t negativo vira 0; `curve` standalone |
| `packages/fsrs/src/scheduler/default-scheduler.fsrs7.spec.ts` | `referenceHistories` (3 sequências com estados esperados); rollback exato da sequência inteira; `fractionalDays`; diferenças em DST (23/24 e 25/24 de dia); `Reschedule.replay == reschedule` no estado de memória |
| `packages/fsrs/src/scheduler/next-interval.spec.ts` | ordem de cebola, caches de candidato, `nextInterval` sem efeitos |
| `packages/fsrs/src/reschedule/reschedule.spec.ts` | validação, ordenação, filtro de Manual, tempos para trás |
| `packages/fsrs/src/middlewares/*/*.spec.ts` | semântica de cada política (learning-steps tem 653 linhas de casos) |
| `packages/srs-kit/src/scheduler/base.spec.ts` (2215 linhas), `rollback-due-at.spec.ts` | contrato do core e do rollback de `dueAt` |
| `packages/binding-test/src/{train,csv-parser,card-ids,threadless}.spec.ts` | treino FSRS-6/7 (21/34 pesos), penalidades, CSV, IDs |

Os `referenceHistories` de `default-scheduler.fsrs7.spec.ts` são ótimos como **golden tests** no nosso app, garantindo que a versão instalada não regrediu.

---

## 11. Licenças e compatibilidade com AGPL-3.0

| Componente | Licença | Arquivo |
|---|---|---|
| `ts-fsrs` | MIT (© 2026 Open Spaced Repetition) | `LICENSE`, `packages/fsrs/LICENSE` |
| `@open-spaced-repetition/srs-kit` | **BSD-3-Clause** (© 2026 Open Spaced Repetition contributors) | `packages/srs-kit/LICENSE` |
| `@open-spaced-repetition/binding` (+ pacotes de plataforma) | MIT | `packages/binding/LICENSE` |
| `fsrs-rs` (embutido no `.node`/`.wasm`) | BSD-3-Clause (pela minha memória do repo upstream; não reconfirmei nesta análise) | — |
| crates Rust (`napi`, `jiff`, `csv`, `serde`, `itertools`…) | MIT / Apache-2.0 / Unlicense (típico; conferir com `cargo about` se for redistribuir binários próprios) | — |

Avaliação: MIT e BSD-3-Clause são licenças permissivas, **compatíveis com incorporação num projeto AGPL-3.0**. Obrigações:

1. Manter os avisos de copyright e o texto das licenças na distribuição, inclusive no bundle e no instalador Electron. O plugin atual já faz isso com `plugins/flashcards/FSRS-LICENSE.txt`, que precisa ser atualizado para `ts-fsrs@6.0.0` e **acrescido do texto BSD-3 do srs-kit**.
2. Pela cláusula 3 da BSD, não usar o nome "Open Spaced Repetition" para endossar o produto.
3. O código vendorizado ou adaptado continua sob MIT/BSD dentro do nosso AGPL. Recomendo um cabeçalho de atribuição em cada arquivo portado.

---

## 12. Estado atual no learnharness (verificado neste repo)

- **Electron 44.9.3** (`devDependencies.electron: ^44.9.3`). Rodando `ELECTRON_RUN_AS_NODE` obtive `process.versions = { node: '24.22.0', napi: '10' }`. Portanto `engines >=24` está OK e o binding nativo (napi5) carrega.
- Next `^16.4.3`, React 19, TypeScript `^5.6` (os tipos do ts-fsrs são gerados com TS 7/tsgo; **validar com `tsc --noEmit`**), `zod ^4.4`, gerenciador **npm** (`package-lock.json`).
- `plugins/flashcards/` (Core plugin, AGPL-3.0-only):
  - `src/scheduler.cjs`: FSRS-6 "selectively adapted from ts-fsrs 5.2.3", com pesos default fixos, `dayStart=4`, `dueDay` local, passos em minutos numéricos, campos snake_case (`due`, `last_review`, `learning_steps`, `scheduled_days`, `elapsed_days`).
  - `src/backend.cjs` ~L555–570 (`register('rate-review', …)`): `p.schedule = scheduler.rate(before, rating, now, s.settings)` e `s.reviews.push({ id, requestId, ticketId, propositionId, cueId, rating, at: now, before, after: p.schedule, introduced, deckIds, settings })`.
  - A unidade de agendamento é a **proposição** (vários "cues" compartilham um schedule).
  - Restrição do README: "No runtime npm dependencies". O build (`scripts/build.mjs`) usa **esbuild com `bundle: true`** (`platform:'node'`, `target:'node22'`, cjs), então uma dependência npm **bundlada** atende a regra.

---

## 13. O que copiar ou adaptar

### 13.1 Opção A (recomendada): dependência npm

Adicionar `ts-fsrs@6.0.0`. Ele traz `@open-spaced-repetition/srs-kit@1.0.0`.

- **No plugin**: como `devDependency` do `plugins/flashcards/package.json`, bundlada pelo esbuild em `dist/backend.cjs`. Importe estaticamente `ts-fsrs/models/fsrs-7` e `ts-fsrs/middlewares` em vez de `DefaultScheduler`, para evitar o `import()` dinâmico e ter um scheduler síncrono.
- **No core** (se o SRS virar parte do app e não só do plugin): `dependencies` do root.
- Fixar versão exata (`"ts-fsrs": "6.0.0"`): a 6.x acabou de sair e o projeto muda rápido.
- Copiar como **material de referência** (não como código de produção):
  - `docs/src/snippets/run-code/migration-fsrs7.ts` (padrão de migração),
  - `docs/src/snippets/run-code/middleware.ts` (middleware com rollback),
  - `packages/fsrs/src/scheduler/default-scheduler.fsrs7.spec.ts` (`referenceHistories` como golden tests).

### 13.2 Opção B: vendorizar só o modelo FSRS-7 (se for preciso manter "zero deps" sem bundling)

Arquivos autocontidos (dependem só de `clamp/roundTo`, `FSRSValidationError` e `Rating`):

| Arquivo | Linhas | O que levar |
|---|---|---|
| `packages/fsrs/src/models/fsrs-7/algorithm.ts` | 304 | `FSRS7Algorithm`, `curve`, `prepare_*`, `compute_curve`, `next_interval`, `next_state` |
| `packages/fsrs/src/models/fsrs-7/constants.ts` | 70 | pesos default, limites, `MIN_T`, `DR_MIN/MAX` |
| `packages/fsrs/src/models/fsrs-7/parameters.ts` | 49 | `clip/check/migrateFSRS7Parameters` |
| `packages/fsrs/src/help.ts` | ~15 | `clamp`, `roundTo` (8 casas) |
| `packages/fsrs/src/error.ts` | ~30 | erros |
| `packages/fsrs/src/middlewares/learning-steps/core.ts` | 113 | `calculateLearningSteps`, `ConvertStepUnitToMinutes` |
| `packages/fsrs/src/middlewares/monotonic-interval/core.ts` | 94 | `calculateScheduleDay` |
| `packages/fsrs/src/middlewares/fuzzing/core.ts` | 88 | `getFuzzRange`, FNV-1a + Mulberry32 |

Nesse caso a orquestração (learning-steps com override e graduação, rollback, preview) precisa ser reescrita. A lógica a replicar está em `packages/fsrs/src/middlewares/learning-steps/middleware.ts` (`getLearningStepInterval`, `nextLearningState`) e em `packages/srs-kit/src/scheduler/base.ts` (`runReview`, `finalizeReview`, `applyReviewChronoDefaults`). **Custo alto e risco de divergência.** Só vale se a opção A for impossível.

### 13.3 Binding

Não vendorizar: o binding é Rust compilado. Usar `@open-spaced-repetition/binding@0.6.1` no processo Node do app (core), e `@open-spaced-repetition/binding-wasm32-wasip1@0.6.1` se quisermos treinar no renderer/Worker. **Referências de integração:**

- `examples/nextjs/src/training.worker.ts` (Worker + WASI p1 + progresso throttled),
- `examples/nextjs/src/app/api/train/route.ts` (nativo + SSE),
- `examples/nextjs/next.config.ts` (`serverExternalPackages`).

---

## 14. Plano de integração no nosso app

### 14.1 Módulo de agendamento (core: `lib/srs/scheduler.ts`, ou `plugins/flashcards/src/fsrs7.mjs`)

```ts
import { dateChrono, defineScheduler, Rating, State, type Grade } from 'ts-fsrs'
import {
  schedulerDesiredRetentionMiddleware, schedulerFuzzingMiddleware, schedulerStatsMiddleware,
  schedulerLeechMiddleware, schedulerScheduledDaysMiddleware, schedulerLearningStepsMiddleware,
  schedulerMaximumIntervalMiddleware, schedulerMonotonicIntervalMiddleware,
} from 'ts-fsrs/middlewares'
import { FSRS7Model, FSRS7_DEFAULT_WEIGHTS, clipFSRS7Parameters } from 'ts-fsrs/models/fsrs-7'

// Definição única (escopo de módulo). Ordem = preset oficial + leech antes de learning-steps.
export const srsDefinition = defineScheduler({ model: FSRS7Model, chrono: dateChrono }).use(
  schedulerDesiredRetentionMiddleware,
  schedulerFuzzingMiddleware,
  schedulerStatsMiddleware,
  schedulerLeechMiddleware,          // opcional: leechThreshold 0 = desligado
  schedulerScheduledDaysMiddleware,
  schedulerLearningStepsMiddleware,
  schedulerMaximumIntervalMiddleware,
  schedulerMonotonicIntervalMiddleware,
)

export type DomainSrsConfig = {
  weights?: readonly number[]   // pesos treinados do domínio (34) ou default
  desiredRetention?: number     // ex.: Inglês 0.90, Eletrônica 0.85 (decidir via simulação, §14.8)
  learningSteps?: `${number}${'m' | 'h' | 'd'}`[]
  relearningSteps?: `${number}${'m' | 'h' | 'd'}`[]
  allowModelOverride?: boolean  // false = respeita passos (didática mais previsível)
  leechThreshold?: number
}

const cache = new Map<string, ReturnType<typeof srsDefinition.create>>()
export function schedulerFor(domainId: string, cfg: DomainSrsConfig) {
  const key = domainId + JSON.stringify(cfg)
  let s = cache.get(key)
  if (!s) {
    s = srsDefinition.create({ config: {
      weights: cfg.weights ? clipFSRS7Parameters(cfg.weights) : FSRS7_DEFAULT_WEIGHTS,
      fractionalDays: true,                       // OBRIGATÓRIO p/ FSRS-7 em defineScheduler
      desiredRetention: cfg.desiredRetention ?? 0.9,
      enableShortTerm: true,
      learningSteps: cfg.learningSteps ?? ['1m', '10m'],
      relearningSteps: cfg.relearningSteps ?? ['10m'],
      allowModelOverride: cfg.allowModelOverride ?? true,
      graduatingInterval: 1,
      enableFuzz: true,                           // espalha carga; determinístico por cardId+reps
      maximumInterval: 36500,
      clearStatsOnForget: false,
      leechThreshold: cfg.leechThreshold ?? 0,
    } })
    cache.set(key, s)
  }
  return s
}
export type SrsCard = ReturnType<ReturnType<typeof schedulerFor>['newCard']>
export type SrsRevlog = ReturnType<ReturnType<typeof schedulerFor>['review']>['revlog']
```

O isolamento por domínio (meta 3) vem de uma instância por `domainId` com pesos, retenção e passos próprios. A definição é compartilhada.

### 14.2 Persistência (SQLite ou o store JSON do plugin)

Card do SRS (1:1 com a unidade agendável, hoje a "proposição"; no futuro um nó ou junção do grafo):

```
srs_card(card_id PK, domain_id, node_id, model TEXT='fsrs-7', weights_id,
         stability REAL, stability_fast REAL, difficulty REAL,
         state INT, schedule_status TEXT, due_at INTEGER(ms), last_review_at INTEGER(ms) NULL,
         scheduled_days REAL, learning_step INT, reps INT, lapses INT)
srs_revlog(id PK, card_id, domain_id, session_id, rating INT, review_time INTEGER(ms),
           -- snapshot pré-review exigido pelo rollback:
           state INT, schedule_status TEXT, due_at INTEGER, last_review_at INTEGER NULL,
           stability REAL, stability_fast REAL, difficulty REAL, scheduled_days REAL, learning_step INT,
           -- campos do app (não vão ao scheduler):
           duration_ms INT, r_pred REAL, model TEXT, weights_id, xp INT)
srs_weights(id PK, domain_id, model, weights JSON, trained_at, n_reviews, log_loss, rmse_bins)
```

Conversão de borda (o scheduler exige `Date` e descarta campos extras):

```ts
const toCard = (row: Row) => srsDefinition.schema.card.parse({
  cardId: row.card_id, stability: row.stability, stabilityFast: row.stability_fast,
  difficulty: row.difficulty, state: row.state, scheduleStatus: row.schedule_status,
  dueAt: new Date(row.due_at), lastReviewAt: row.last_review_at == null ? null : new Date(row.last_review_at),
  scheduledDays: row.scheduled_days, learningStep: row.learning_step, reps: row.reps, lapses: row.lapses,
})
```

### 14.3 Fluxo de review (fim de sessão, meta 4)

1. Montar a fila (política do app):
   - **Ordem:** Learning/Relearning com `dueAt ≤ now` primeiro, depois Review vencidos, depois novos até o limite diário por domínio.
   - **Regra de "vencido hoje":** usar a virada local (`dayStart`, como no plugin atual). Por exemplo, um Review com `dueAt < fimDoDiaDeEstudo` conta como vencido. Learning conta por instante exato.
   - **Excluir** `scheduleStatus === 'suspended'`.
2. Ao exibir o card: `Array.from(scheduler.preview({ card, now }))` para rotular os botões ("10 min", "4 d"…).
3. Ao responder:
   - `const { card, revlog } = scheduler.review({ card, grade, now })`.
   - Calcular `r_pred = scheduler.model.forgettingCurve(cardAntes, elapsed)` para métricas e XP.
   - Persistir **card + revlog numa transação**, com idempotência por `requestId`, como já existe no plugin.
4. Undo: `scheduler.rollback({ card: atual, revlog: último })` e apagar o revlog.
5. "Esquecer/resetar": `scheduler.forget({ card, now })` e registrar um revlog manual próprio (rating 0) para delimitar o histórico pós-reset.

### 14.4 Integração com o grafo e a memória de contexto (metas 1 e 2)

- **Retrievability por card agora:** `R = state===New ? null : model.forgettingCurve(card, chrono.difference(card.lastReviewAt, now))`.
- **Domínio de um nó:** agregar o R dos cards ligados ao nó. Sugestões:
  - média ponderada pela importância do card, ou
  - `min` para pré-requisitos críticos.
- **Ponto fraco:** combinar R baixo, `difficulty` alta (> 7), `lapses` crescentes e o leech.
- Esses sinais alimentam:
  - a memória de contexto, por exemplo um fato "aluno fraco em X (R=0.42, D=8.1, 3 lapsos)",
  - o expansor do grafo (decidir onde re-explicar ou gerar uma sub-aula).
- **Prontidão para avançar no grafo:** exigir R previsto ≥ limiar nos pré-requisitos daqui a N dias, usando `forgettingCurve(card, Δ+N)`. É uma regra determinística e testável, útil para a "lógica de evolução formalmente correta".
- `model.nextInterval(card, 0.9)` dá uma "estabilidade equivalente" legível em dias para a UI do perfil.

### 14.5 Otimização de pesos por domínio (binding)

- **Onde rodar:** no Electron main ou num `utilityProcess`/`worker_thread` com `@open-spaced-repetition/binding`. O nativo `win32-x64-msvc` existe; o `computeParameters` nativo já roda fora do event loop.
- **Exportar o CSV a partir de `srs_revlog`:**
  - colunas `card_id, review_time(ms), review_rating(1–4), review_state(pré-review 0–3), review_duration(ms)`,
  - sem linhas Manual,
  - chamar `convertCsvToFsrsItemsWithCardIds(bytes, dayStart, 'America/Sao_Paulo', 'FSRS-7')`.
- **Treinar:** `computeParameters(items, { modelVersion: 'FSRS-7', enableShortTerm: true, cardIds, progress })`.
- **Avaliar e aceitar:**
  - Comparar `new FSRSBinding(novosPesos).evaluate(items, cardIds)` com `new FSRSBinding(pesosAtuais).evaluate(...)`, ou usar `evaluateWithTimeSeriesSplits`.
  - Só aceitar se `logLoss` melhorar.
  - Gravar em `srs_weights` com métricas e `n_reviews`.
  - **Não** reprogramar cards antigos: os novos pesos valem a partir da próxima review. Opcionalmente, rodar `Reschedule.replay` para recalcular a memória (a mudança de `stabilityFast` só altera R e intervalos futuros).
- **Quando treinar:** periodicamente, por exemplo a cada X reviews novas por domínio. O fsrs-rs aceita conjuntos mínimos (o teste "compute_parameters with minimal data" passa com 1 item), mas o ganho só é real com muito histórico. **Limiar exato não verificado aqui**; usar o gate de avaliação acima.
- **Next.js:** se o treino rodar em route handler, incluir `@open-spaced-repetition/binding` em `serverExternalPackages`, conferir que o `.node` da plataforma entra no standalone (`scripts/build-server.mjs` / file tracing) e, no Electron, fazer `asarUnpack: ["**/*.node"]` no `electron-builder.yml`.

### 14.6 Migração do plugin `flashcards` (FSRS-6 → FSRS-7), sem perder agenda

Para cada proposição `p`:

1. Se `p.schedule.state === 0`: criar o card FSRS-7 novo (memória `{0,0,0}`) com `cardId = p.id`, preservando os contadores.
2. Se não: `history = s.reviews.filter(r => r.propositionId === p.id).map(r => ({ rating: r.rating, reviewTime: new Date(r.at) }))`, considerando só as reviews **após o último reset**, se houver.
3. Validar que o último `at` é igual a `p.schedule.last_review`. Se divergir ou o histórico estiver incompleto, **manter em FSRS-6** com `model='fsrs-6'` e rotear por versão.
4. `const { memoryState } = new Reschedule(schedulerFor(domain, cfg)).replay({ history })` e montar o card v6:
   - `dueAt = new Date(p.schedule.due)` (preservado),
   - `lastReviewAt = new Date(p.schedule.last_review)`,
   - `state`, `scheduleStatus` mapeado, `scheduledDays`, `learningStep = learning_steps`, `reps`, `lapses`,
   - `...memoryState`.
5. Gravar `model='fsrs-7'` e `weights_id`. Os revlogs antigos ficam como estão (fronteira de undo: o rollback só vale para revlogs FSRS-7).
6. Atualizar `FSRS-LICENSE.txt` (ts-fsrs 6.0.0 MIT + srs-kit BSD-3) e a descrição do manifest ("FSRS-7").

### 14.7 XP e níveis calibrados (meta 5, proposta)

O revlog oferece por review o `r_pred` (R antes de responder), a nota, `difficulty` e `stability`. Uma recompensa "justa" por nível: `XP = base · g(1 − r_pred) · h(D)` em acerto (mais XP por recordar algo prestes a ser esquecido ou difícil) e um XP pequeno de esforço em erro. Assim o ganho fica proporcional ao desafio real, não ao volume.

A calibração por Monte Carlo pode usar o próprio modelo:

```ts
// simulador mínimo: aluno sintético cuja memória "real" segue o mesmo FSRS-7
function simulateDay(s: Scheduler, cards: SrsCard[], now: Date, rng: () => number) {
  for (const c of cards.filter(c => c.dueAt <= now)) {
    const R = c.state === State.New ? 0 : s.model.forgettingCurve(c, s.chrono.difference(c.lastReviewAt!, now))
    const grade: Grade = rng() < R ? (rng() < 0.85 ? Rating.Good : Rating.Hard) : Rating.Again
    Object.assign(c, s.review({ card: c, grade, now }).card)
  }
}
```

Rodar N alunos × D dias com `numericChrono` ou `Date` sintética. Isso permite:

- estimar a carga diária e as horas por `desiredRetention` (para escolher a retenção por domínio),
- estimar a distribuição de XP/hora por nível, para ajustar `base`, g e h até que a mediana de XP/hora fique estável entre níveis.

Os rankings usam percentis dessa distribuição simulada. A política Cost-ADR (`schedulerCostAdrMiddleware`) é uma alternativa pronta à retenção fixa, quando quisermos otimizar custo × retenção por card.

### 14.8 Stats do perfil (meta 6)

O revlog **não** guarda duração; o app deve gravar `duration_ms`, que o CSV do otimizador também usa. Métricas diretas:

- reviews/dia,
- retenção real (`rating > 1` em Review) versus `r_pred` médio, o que mede a calibração,
- tempo/dia,
- cards por estado,
- previsão de carga dos próximos 7 dias (`dueAt`).

### 14.9 Testes que devemos escrever

- **Golden:** os 3 `referenceHistories` de `default-scheduler.fsrs7.spec.ts` (tolerância `max(1e-7, 1e-4·esperado)`).
- **Propriedades** (fast-check). São bons candidatos a provas formais ou Lean, se quisermos:
  - `rollback(review(c,g)) ≡ c`,
  - intervalos `Again ≤ Hard ≤ Good ≤ Easy`,
  - `0 < R ≤ 0.99999`,
  - limites de S e D,
  - `forget` preserva `cardId`,
  - `preview` não muta o card.
- **Datas:** elapsed negativo (relógio retrocedido), virada de dia local, fuso `America/Sao_Paulo`, serialização ms↔Date.
- **Migração:** proposições com histórico completo, incompleto e só Manual.

---

## 15. Armadilhas (checklist)

1. **`fractionalDays`**: `defineScheduler` + `dateChrono` usa `false` por padrão (diferença de **datas UTC** e `scheduledDays` truncado). Para FSRS-7, passe `fractionalDays: true`. O `DefaultScheduler` faz isso sozinho.
2. **Datas**: só objetos `Date` válidos; `new Date(0)` é rejeitado. Strings e números de JSON/SQLite precisam ser convertidos na borda.
3. **`now` < `lastReviewAt`** (relógio do PC retrocedido, sync entre dispositivos) gera `elapsedDays` negativo e **exceção**. Faça clamp no app (`now = max(now, lastReviewAt)`) antes de chamar.
4. **Campos extras somem**: `schema.card.parse` só devolve campos declarados. Guarde os metadados do app (nó, domínio, conteúdo) fora do objeto do scheduler, ou declare-os num middleware próprio.
5. **Pesos não se misturam**: FSRS-7 tem 34 e FSRS-6 tem 21. `migrateFSRS7Parameters` **não** converte layouts antigos. Persista `model` + `weights_id` junto com o estado.
6. **`stabilityFast`** precisa ser persistido. Nunca derive `0.8·S` para card já aprendido; use `Reschedule.replay`.
7. **`allowModelOverride: true`** (default do FSRS-7) faz o primeiro Good saltar direto para dias (exemplo: 4,78 d). Para uma didática com reforço no mesmo dia, considere `false` ou passos maiores.
8. **Sem `learningSteps`** ainda pode haver Learning/Relearning: o intervalo final abaixo de `graduatingInterval` define o estado. **Um scheduler "nu" (sem o middleware de learning-steps) marca tudo como Review**, mesmo com intervalo sub-dia.
9. **`preview` é iterável preguiçoso**: indexar `preview[3]` como no v5 é bug. Use `for…of`/`Array.from` e selecione por `.grade`.
10. **Rollback** só funciona com revlog v6 completo (snapshot pré-review). Não converta logs antigos para fazer undo.
11. **`clearStatsOnForget`** tem default `true` no v6; no v5 o equivalente era `false`.
12. **Ordem dos middlewares** muda resultados (scheduled-days antes, learning-steps antes de max/monotonic, leech antes de learning-steps, Cost-ADR **em vez de** desired-retention).
13. **Fuzz** depende de um `cardId` estável. Mudar o ID muda os intervalos fuzzados.
14. **Handlers puros**: `preview` executa os handlers de review. Nada de I/O ou XP dentro de middleware.
15. **Virada de dia local** não existe no scheduler. A fila "vencidos hoje" é responsabilidade do app. O `dateChrono` fracionário usa 24h fixas; não interfere no Brasil, que não tem DST desde 2019.
16. **`desiredRetention`** deve estar em (0,1) aberto: 1.0 é inválido. No plugin atual era `(0,1]`.
17. **TS dos tipos**: tipos muito genéricos e inferidos (`ReturnType<…>`). Derive `SrsCard`/`SrsRevlog` do scheduler em vez de usar os tipos legados `Card`/`ReviewLog` exportados na raiz, que estão **deprecados**. Validar com o `typescript ^5.6` do projeto.
18. **API legada** (`fsrs()`, `FSRS`, `createEmptyCard`, `generatorParameters`) ainda é exportada, mas usa FSRS-6 e está deprecada. Não usar.
19. **Binding beta**: a API pode mudar entre versões (aviso no README). O pacote WASI com threads está deprecado. `computeOptimalSteps` não aceita FSRS-7. Use o mesmo `modelVersion` em conversão, treino, avaliação e scheduler.
20. **WASI p1 é síncrono**: sempre num Worker dedicado. O nativo, no Electron, exige `asarUnpack` do `.node` e, no Next, `serverExternalPackages`. Com npm, só o pacote da plataforma atual é instalado: o build de distribuição mac precisa rodar no mac (o `desktop:dist` atual já roda).
21. **Arredondamento** a 8 casas (`roundTo`) é fixo no build publicado (`TS_FSRS_DISABLE_ROUNDING: false` em `packages/fsrs/tsdown.config.ts`). Comparações exatas em teste devem usar tolerância.
22. **Retrievability de card New** não tem significado. Trate como `null` na UI e nas métricas.

---

## 16. Perguntas em aberto

- O SRS fica no **plugin** `flashcards` (com restrição de deps, que o bundling resolve) ou vira **core**? O grafo, a memória de contexto e o XP precisam ler R por nó, o que sugere core.
- Qual a unidade agendável no grafo: nó, proposição ou "junção"? Hoje é a proposição.
- `allowModelOverride` on/off e passos por domínio (Inglês: vocabulário com passos curtos; Eletrônica: conceitos com mais espaçamento)? Decidir com a simulação do §14.7.
- Qual limiar de reviews por domínio para o primeiro treino de pesos? Não verificado; usar o gate de `logLoss`.
- A variante "FSRS-7 recency" (melhor no benchmark) chegará ao binding? Não encontrei a opção na 0.6.1.
- Exportar também para Anki (meta 4)? O Anki moderno usa o mesmo fsrs-rs. Exportar revlog/pesos é viável, mas não foi analisado aqui.
- Confirmar a licença do fsrs-rs (BSD-3-Clause pela minha memória) antes de redistribuir o `.node`.
