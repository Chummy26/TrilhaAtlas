# openskill.js (philihp): rating Weng-Lin em TypeScript para calibrar aluno × item e alimentar o Monte Carlo de níveis e ligas

> Pesquisa `extra-philihp__openskill.js` · data de referência: **2026-11-18**
> Fonte local: `C:\Users\nicoolas\Pictures\learnharness\_refs\extra\philihp__openskill.js` (clone `--depth 1`, commit `ffb530f9e5ff1e7aaf703687f48e91f68244aade`, de 2026-11-17)
> Upstream: https://github.com/philihp/openskill.js · Documentação: https://openskill.philihp.com/ · npm: https://www.npmjs.com/package/openskill
> Regra de segurança cumprida: **nenhum código do repo foi executado** (sem install, build, testes ou benchmark). Os números de verificação abaixo saíram de uma **reimplementação independente** escrita por mim fora do repo, que reproduz bit a bit os vetores de teste do repo.

---

## 0. TL;DR

- **O que é:** implementação JS/TS do método bayesiano de Weng & Lin (JMLR 12, 2011, "A Bayesian Approximation Method for Online Ranking"). Cada entidade tem um rating gaussiano `{ mu, sigma }`. `rate()` atualiza os ratings após uma "partida" entre times de qualquer tamanho e número. São 5 modelos: **Plackett-Luce** (default), **Bradley-Terry** full/part e **Thurstone-Mosteller** full/part.
- **Tamanho:** o núcleo tem **852 linhas** em 17 arquivos de `src/`. É puro e sem I/O. Depende de `ramda`, `sort-unwind` e de dois pacotes `@stdlib` (`erf` e quantil normal).
- **Licença:** **MIT** (`LICENSE`, © 2020 Philihp Busby). As dependências são MIT (`ramda`, `sort-unwind`) e Apache-2.0 (`@stdlib/*`). **Tudo é compatível com AGPL-3.0.** Basta manter o aviso de copyright MIT em cópias ou porções substanciais.
- **Estado atual (verificado em 2026-11-18):**
  - o **npm `latest` é `5.0.1`** (publicado em 2026-06-08);
  - o `main` tem `package.json` em `5.1.0` e `CHANGELOG.md` já com uma seção `v5.2.0`;
  - a tag git `v5.1.0` existe, mas **5.1.0 e 5.2.0 não estão no npm**;
  - portanto `weight` (jogo parcial), `windowSize` e o novo `margin` (paridade com openskill.py 6.2.0) **só existem no `main`**. Na 5.0.1, `weight` é **aceito e ignorado em silêncio**.
- **Velocidade:** o README diz até **20× mais rápido que TrueSkill** (62.643 ops/s no `bradleyTerryFull` contra 2.962 ops/s do TrueSkill, em partida 5v5, num Mac Pro 2013 com Node 13). Para o nosso caso 1v1 aluno × item, a fórmula fechada que escrevi roda a **~2,6×10⁷ updates/s** num thread (Node 24 nesta máquina).
- **Uso no nosso app:**
  1. **Cada resposta é uma partida 1v1**: o rating do aluno no nó contra o rating da família de itens (nó × nível). Acerto é vitória, erro é derrota e crédito parcial é empate.
  2. Para 1v1, **Plackett-Luce e Bradley-Terry Full são matematicamente idênticos**. Os vetores de teste coincidem: 2 jogadores novos dão `27.63523138347365 / 8.065506316323548` em ambos. Use `bradleyTerryFull` para respostas e `plackettLuce` para ligas com k=30.
  3. `ordinal()` = `target + alpha·(mu − z·sigma)` vira o "skill rating" exibível.
  4. O **Monte Carlo** usa uma versão em fórmula fechada do mesmo update, coberta por teste de paridade bit a bit contra `rate()`.
- **Principais armadilhas:**
  - `tau` é aplicado a **todos** os times (inclusive itens);
  - `predictWin` usa **Φ gaussiano**, inconsistente com a logística do BT/PL (gap 10, σ=2: 0,937 contra 0,822);
  - o μ do time é **soma**, então k-vs-1 infla a escala;
  - `weight < 1` com `weightBounds: null` **amplifica derrotas**;
  - num app de um único usuário, a habilidade do aluno e a dificuldade do item **não são identificáveis** sem âncoras;
  - o exemplo de `predictWin` no README está desatualizado.
- **Recomendação:**
  - dependência `openskill@5.0.1` **fixada exata** para a v1 do app (só usamos `rating`, `rate`, `ordinal`, `bradleyTerryFull` e `plackettLuce`, cujas saídas não mudaram de 5.0.1 para o `main` nos casos sem `weight`/`margin`);
  - mais um módulo nosso `src/core/rating/` com `rateAnswer()` (via `rate`) e `rateAnswerFast()` (fórmula fechada para Monte Carlo);
  - **plano B:** vendorizar 10 arquivos do commit `ffb530f`, com a lista exata na §10.

---

## 1. Identificação e estado do projeto

| Item | Valor |
|---|---|
| Repo | `philihp/openskill.js` (262★ segundo o relatório r8) |
| Último commit | `ffb530f` 2026-11-17 "docs: add custom models page and type the model option as Model (#1135)" |
| `package.json` (main) | `"version": "5.1.0"`, `"type": "module"`, `"engines": { "node": ">=22.0.0" }`, `"sideEffects": false` |
| npm `latest` | **5.0.1** (2026-06-08T12:27Z). Antes vieram 5.0.0 (2026-06-08) e 4.1.1 (2026-03-04). `engines.node >=20`. Deps: `ramda 0.32.0`, `sort-unwind 3.1.0`, `@stdlib/math-base-special-erf 0.2.6`, `@stdlib/stats-base-dists-normal-quantile 0.3.1` |
| Tags git | `v5.0.0`, `v5.0.1`, `v5.1.0`. O publish (`.github/workflows/publish.yml`) só roda em *GitHub Release published*, o que explica a tag 5.1.0 sem pacote no npm |
| Exports | `"."` → `rating, rate, ordinal, predictWin, predictDraw, predictRank` + tipos. `"./models"` → `plackettLuce, bradleyTerryFull, bradleyTerryPart, thurstoneMostellerFull, thurstoneMostellerPart`. Dual ESM (`dist/*.js`) e CJS (`dist/*.cjs`) com `.d.ts`/`.d.cts` |
| Build | `tsdown` (`tsdown.config.ts`: entries `src/index.ts`, `src/models/index.ts`; `format: ['cjs','esm']`; `dts: true`). TS 7.0.2 com `isolatedDeclarations` |
| Testes | `node --import tsx --test`, com um shim de `expect` em `src/__tests__/_helpers.ts` (mapeado como `#test-helpers` em `package.json#imports`) |
| Referência de paridade | **openskill.py 6.2.0** (PyPI `latest` = 6.2.0, MIT). Os arquivos `src/__tests__/parity-*.test.ts` citam linhas exatas do `tests/models/weng_lin/*.py` upstream |
| Ports | Python, Lua (Roblox), Kotlin, Elixir, Java, C#, Ruby, Google Apps Script (README) |
| Dados de benchmark | `benchmark/` (OverTrack 61.867 partidas 5v5; rr18xx 2.727 partidas FFA). São arquivos grandes (~69 MiB via LFS). **Não copiar** |

### 1.1 O que mudou entre 5.0.1 (npm) e o `main`

Comparei o `CHANGELOG.md` com o `dist/index.js` da 5.0.1 (lido via unpkg, sem executar):

| Recurso | 5.0.1 (npm) | `main` (5.1.0/5.2.0, não publicado) |
|---|---|---|
| `weight` / `weightBounds` | **ignorado** (nenhum código lê) | implementado em `rate.ts` + `util.updatePlayer`, com paridade bit a bit com openskill.py |
| `windowSize` | ausente | só nos modelos `*Part` (`util.windowPairs`) |
| `margin` | antigo: `rate` multiplica o Δμ por `marginFactor` **depois** do modelo; `margin: 0` é ignorado por checagem truthy | novo (5.2.0): **dentro** de cada modelo (`src/margin.ts`), com paridade com openskill.py 6.2.0 |
| `ModelTeams` readonly, tipo `Model` exportado | parcial | sim (`src/types.ts`) |
| `engines.node` | `>=20` | `>=22` |
| BT/PL/TM sem `weight`/`margin` | — | **mesmas saídas** (o changelog não lista outra mudança numérica) |

> O changelog anuncia que a **próxima major** fará de `windowSize: 4` o default dos modelos `*Part`. Isso não nos afeta se usarmos só `bradleyTerryFull` e `plackettLuce`, mas é mais um motivo para fixar a versão exata.

---

## 2. Licença e compatibilidade com AGPL-3.0

| Componente | Licença | Compatível com AGPL-3.0? | Obrigação |
|---|---|---|---|
| `openskill` (este repo) | MIT (`LICENSE`, "Copyright (c) 2020 Philihp Busby") | **Sim**. MIT é permissiva e compatível com GPL/AGPL | Incluir o aviso de copyright e a permissão em "all copies or substantial portions". Como dependência via npm, isso já vem no `node_modules`. Se vendorizarmos, colocar um cabeçalho em cada arquivo copiado e o texto em `THIRD_PARTY_NOTICES` |
| `ramda@0.32.0` | MIT | Sim | Idem |
| `sort-unwind@4.1.1` (`main`) / `3.1.0` (5.0.1) | MIT, zero dependências | Sim | Idem |
| `@stdlib/math-base-special-erf@0.2.6`, `@stdlib/stats-base-dists-normal-quantile@0.3.1` | **Apache-2.0** | **Sim** (Apache-2.0 → GPLv3/AGPLv3 é compatível num sentido) | Preservar `NOTICE`/LICENSE. **Sem scripts de install** e `"gypfile": false` (verificado no registry). Não há build nativo no Electron |
| Docs (`docs/`) | MIT (mesmo repo) | Sim | — |
| Datasets de `benchmark/` | sem licença explícita (dados OverTrack/rr18xx) | **Não redistribuir** | Não copiar |

**Conclusão:** uso como dependência ou vendorizado é seguro para o fork AGPL-3.0. TrueSkill (Microsoft) é patenteado e marca registrada. O README do benchmark destaca que Weng-Lin "is not encumbered by patents and licensing", o que é mais um argumento a favor.

---

## 3. Arquitetura

```
src/
  index.ts            7  re-exporta rating, rate, ordinal, predictWin, predictDraw, predictRank, tipos
  types.ts           57  Rating, Team, Teams, RateResult<T>, Gamma, ModelTeams, Model, Options
  constants.ts       50  builder(options) → Constants (defaults: mu 25, sigma 25/3, beta 25/6, tau 25/300, …)
  rating.ts           9  rating(init?, options?)
  ordinal.ts         19  target + alpha·(mu − z·sigma)
  rate.ts            65  orquestrador: tau → ordenar por rank → modelo → desordenar → limitSigma
  util.ts           215  score(), normalize(), updatePlayer(), rankings(), teamRating(), ladderPairs(),
                         windowPairs(), utilC, utilSumQ, utilA, gamma default
  statistics.ts      51  phiMajor (CDF via erf), phiMajorInverse (quantil), phiMinor (PDF), v, w, vt, wt
  margin.ts          60  marginDivisor, marginDivisors, marginAdjustedMus (5.2.0)
  predict-win.ts     46  P(vitória) por pares com Φ gaussiano
  predict-draw.ts    37  P(empate) relativa (qualidade de matchmaking)
  predict-rank.ts     9  [colocação, prob] derivado de predictWin
  models/
    index.ts          5
    plackett-luce.ts 43  default; escala para k ≥ 3
    bradley-terry-full.ts 34   todos os pares, logística
    bradley-terry-part.ts 48   vizinhos (ladder) ou janela
    thurstone-mosteller-full.ts 42  todos os pares, gaussiano (v, w, vt, wt)
    thurstone-mosteller-part.ts 55  vizinhos ou janela; c_iq = 2·sqrt(...)
  __tests__/ … (≈2.800 linhas: paridade com openskill.py, vetores, testes de tipo *.test-d.ts)
docs/                 site Next.js (MDX + explorers com sliders); docs/lib/scenarios.ts tem cenários puros
benchmark/            scripts JS antigos (Benchmark.js, ndjson) + datasets; ignorar
```

### 3.1 Fluxo de `rate(teams, options)` (`src/rate.ts`)

```
teams (ordem do chamador)
  │ 1. tau: σ ← sqrt(σ² + τ²) para TODO jogador de TODO time            (rate.ts:15-21)
  │ 2. rank = options.rank ?? options.score.map(−x) ?? [1..n]           (rate.ts:24)
  │ 3. weight → normalize(teamWeight, 1, 2) por time (se weightBounds)  (rate.ts:30-33)
  │ 4. unwind(rank, teams) → times ordenados por rank asc + permutação  (sort-unwind; sort estável)
  │ 5. model(orderedTeams, {...options, rank: sorted, score, weight})
  │      └─ teamRating → por time i: Ω_i, Δ_i → updatePlayer por jogador
  │ 6. unwind(tenet, newRatings) → volta à ordem do chamador
  │ 7. se TAU && LIMIT_SIGMA: σ_new ← min(σ_new, σ_original_sem_tau)    (rate.ts:51-58)
  ▼
RateResult<T> (mesma forma de tupla que a entrada)
```

Pontos de design relevantes:

- **Funções puras e imutáveis.** Modelos recebem `ModelTeams` (readonly) e devolvem objetos novos. O teste `custom-model.test-d.ts` garante isso no nível de tipos.
- **Tudo é reconfigurável por `options`** em cada chamada. `constants(options)` reconstrói as constantes a cada chamada, o que custa pouco mas aparece num loop de Monte Carlo.
- **Modelo plugável:** `Model = (teams: ModelTeams, options?: Options) => Team[]`. Dá para escrever um modelo próprio (a doc tem um exemplo de Elo) ou envolver um built-in com `gamma` fixo.
- `rankings()` converte ranks ordenados em índices de "grupo de empate": `[1,2,2]` vira `[0,1,1]`.

---

## 4. API pública

```ts
import { rating, rate, ordinal, predictWin, predictDraw, predictRank } from 'openskill'
import type { Rating, Team, Teams, Model, Gamma, Options, ModelTeams, RateResult } from 'openskill'
import { plackettLuce, bradleyTerryFull, bradleyTerryPart,
         thurstoneMostellerFull, thurstoneMostellerPart } from 'openskill/models'

type Rating = { mu: number; sigma: number }

rating(init?: { mu?: number; sigma?: number }, options?: Options): Rating
// init sobrescreve options: constants({ ...options, ...init })

rate<const T extends Teams>(teams: T, options?: Options): RateResult<T>
// com `as const` a saída é uma tupla tipada ([[Rating],[Rating]]); com arrays comuns é Rating[][]

ordinal(r: Rating, options?: { z?: number; alpha?: number; target?: number }): number
predictWin(teams: Team[], options?: Options): number[]          // soma 1
predictDraw(teams: Team[], options?: Options): number           // relativo
predictRank(teams: Team[], options?: Options): [number, number][] // [colocação, prob]
```

### 4.1 `Options` e defaults (`src/constants.ts`)

| Opção | Default | Onde age | Observação para nós |
|---|---|---|---|
| `mu` | 25 | `rating()` | Escala arbitrária. Só diferenças importam |
| `sigma` | 25/3 ≈ 8,333 | `rating()` | Incerteza inicial. **Desde 5.0 não é derivado de `mu`** |
| `beta` | 25/6 ≈ 4,167 | todos os modelos | Ruído de desempenho por time (β² **por time**, não por jogador). Em educação, slips e chutes pedem β maior. **Calibrar** |
| `tau` | 25/300 ≈ 0,0833 | `rate` (antes do modelo) | Aplicado **incondicionalmente** a todos. `tau: 0` desliga |
| `limitSigma` | false | `rate` (depois) | σ nunca sobe. Só tem efeito com `tau > 0` |
| `epsilon` | 0,1 | só TM | Margem de empate |
| `kappa` | 1e-4 | `updatePlayer` | Piso do fator de encolhimento de σ (σ cai no máximo a 1% num update) |
| `z`, `alpha`, `target` | 3, 1, 0 | `ordinal`, `balance` | — |
| `balance` | false | `teamRating` | Pondera jogadores fracos. **Divide pelo melhor ordinal**: explode com ordinal ≈ 0 (novatos). Não usar |
| `gamma` | `sqrt(σ²_time)/c` | todos os modelos | Velocidade de encolhimento de σ. Só multiplica Δ |
| `rank` | `[1..n]` | `rate` | Menor é melhor. Iguais significam empate |
| `score` | — | `rate` | Maior é melhor. Vira `rank = −score` |
| `weight` | — | `updatePlayer` (**só main**) | Forma de `teams`. Normalizado por time em `[1,2]` |
| `weightBounds` | `[1, 2]` | `rate` (**só main**) | `null` usa os pesos crus |
| `margin` | — | modelos (**5.2.0 main**) | Exige `score` com um valor por time |
| `windowSize` | `undefined` | só `*Part` (**só main**) | `4` = openskill.py |
| `model` | `plackettLuce` | `rate` | — |

---

## 5. Algoritmos-chave (com trechos curtos)

Notação: time *i* com μ_i = Σ μ_j e σ²_i = Σ σ²_j dos jogadores (sem `balance`); β² por time.

### 5.1 Agregação do time (`util.ts`, `teamRating`)

```ts
const { mu: muSum, sigSq } = team.reduce((a, { mu, sigma }) => {
  a.mu += mu; a.sigSq += sigma * sigma; return a }, { mu: 0, sigSq: 0 })
return [muSum, sigSq, team, rank[i]]   // TeamRating = [μ, σ², jogadores, grupoDeRank]
```

> **Consequência:** um time de 2 jogadores com μ=25 tem μ=50. Num confronto k-vs-1, o lado com mais membros parece muito mais forte. Veja §8.4.

### 5.2 Atualização de cada jogador (`util.ts`, `updatePlayer`), compartilhada por todos os modelos

```ts
const sigmaSq = sigma * sigma
const w = iOmega >= 0 ? weight : 1 / weight          // assimétrico!
return {
  mu:    mu + (sigmaSq / iSigmaSq) * iOmega * w,
  sigma: sigma * Math.sqrt(Math.max(1 - (sigmaSq / iSigmaSq) * iDelta * w, kappa)),
}
```

A fração σ²_j/σ²_i distribui o update do time proporcionalmente à incerteza de cada jogador. Para um time de um único jogador, a fração vale exatamente 1.

### 5.3 Bradley-Terry Full (`models/bradley-terry-full.ts`)

Para cada par (i, q≠i):

```
c_iq  = sqrt(σ²_i + σ²_q + 2β²)
p_iq  = 1 / (1 + exp((μ_q − μ_i) / d_iq / c_iq))     // d_iq = divisor de margin (1 sem margin)
η     = σ²_i / c_iq
γ_i   = gamma(c_iq, k, …) = σ_i / c_iq  (default)
Ω_i  += η · (s_iq − p_iq)                            // s = 1 vitória, 0,5 empate, 0 derrota (util.score)
Δ_i  += (γ_i · η / c_iq) · p_iq · (1 − p_iq)
```

```ts
const ciq = Math.sqrt(iSigmaSq + qSigmaSq + TWOBETASQ)
const piq = 1 / (1 + Math.exp((qMu - iMu) / divisor(i, q) / ciq))
const qEta = iSigmaSq / ciq
acc.omega += qEta * (score(qRank, iRank) - piq)
acc.delta += ((iGamma * qEta) / ciq) * piq * (1 - piq)
```

Custo O(k²) em pares. Para 1v1 é o caminho mais barato.

### 5.4 Plackett-Luce (`models/plackett-luce.ts`), o default

```
c        = sqrt( Σ_q (σ²_q + β²) )                         // incerteza total da partida (utilC)
sumQ[q]  = Σ_{i: rank_i ≥ rank_q} exp(μ_i / c)             // utilSumQ
A[q]     = |{i : rank_i = rank_q}|                         // tamanho do grupo de empate (utilA)
para q com rank_q ≤ rank_i:
  quot   = exp(μ_i/c) / sumQ[q]
  Ω_sum += (i==q ? 1 − quot : −quot) / A[q]
  Δ_sum += quot·(1 − quot) / A[q]
Ω_i = Ω_sum · σ²_i / c ;   Δ_i = Δ_sum · σ²_i / c² · γ_i
```

**Para k = 2, PL = BT Full.** Fiz a conta à mão e conferi nos vetores: `plackett-luce.test.ts` e `bradley-terry-full.test.ts` dão o mesmo "2p FFA" `27.63523138347365 / 8.065506316323548`. Empate também coincide: PL dá Ω = (1−2p)/2 = 0,5 − p, igual ao `score = 0,5` do BT. PL escala bem para k grande (ligas com 30 "jogadores").

### 5.5 Thurstone-Mosteller (`models/thurstone-mosteller-*.ts` + `statistics.ts`)

Mesmo esqueleto do BT, mas troca a logística pelas funções de TrueSkill: `v`, `w` (vitória/derrota) e `vt`, `wt` (empate), com margem `ε/c_iq`. `phiMajor(x) = 0.5·(1 + erf(x/√2))` via `@stdlib`, determinístico e igual ao `statistics.NormalDist` do Python. **Peculiaridade:** no `*Part`, `c_iq = 2·sqrt(σ²_i + σ²_q + 2β²)` (fator 2 que o `*Full` não tem). Não vamos usar TM: é Φ mais caro, e o benchmark do próprio repo mostra acurácia igual ou pior.

### 5.6 `tau` e `limitSigma` (`rate.ts`)

```ts
const processedTeams = teams.map((team) => team.map((p) => ({
  ...p, sigma: Math.sqrt(p.sigma * p.sigma + tauSquared) })))
...
if (TAU && LIMIT_SIGMA) reorderedTeams = reorderedTeams.map((team, i) =>
  team.map((p, j) => ({ ...p, sigma: Math.min(p.sigma, teams[i][j].sigma) })))
```

`tau` define um **piso dinâmico de σ**: o encolhimento por partida equilibra a inflação τ². Na minha simulação, um aluno contra um item com σ=2 e resultados alternados por 5.000 respostas termina com **σ ≈ 1,48** quando τ=25/300 e **σ ≈ 3,18** quando τ=0,5.

### 5.7 `ordinal` (`ordinal.ts`)

```ts
return TARGET + ALPHA * (mu - Z * sigma)   // default: mu − 3σ (limite inferior de ~99,7%)
```

Um novato tem ordinal **0**. O ordinal sobe à medida que σ cai, **mesmo com derrotas** (bom para motivação no início). Com `tau`, o ordinal pode **cair após uma vitória** se σ subir, e `limitSigma` evita isso. Teste: `ordinal({mu:24, sigma:6}, {alpha:24, target:1500}) === 1644`.

### 5.8 Predições (`predict-*.ts`)

```ts
// predictWin: para cada par i<j, n = número de TIMES
const p = phiMajor((muA - muB) / Math.sqrt(n * BETASQ + sigmaSqA + sigmaSqB))
acc[i] += p; acc[j] += 1 - p   // depois divide por n(n−1)/2
```

- `predictWin` usa a **CDF gaussiana**, não a logística que BT e PL usam para atualizar. Para o mesmo gap, ela é **bem mais íngreme** (§12, armadilha 3). Com 1 time, divide por 0 e devolve `NaN`; o Python lança `ValueError`.
- `predictDraw`: `drawProbability = 1/totalPlayerCount`, `drawMargin = sqrt(total)·β·Φ⁻¹((1+1/total)/2)` e média de `Φ((m−μA+μB)/d) − Φ((μB−μA−m)/d)` sobre os pares. Serve como "qualidade" de matchmaking. Não precisamos.
- `predictRank`: colocação = 1 + nº de times com prob **estritamente** maior. "prob" é a própria P(vitória), **não** a probabilidade da colocação.

### 5.9 `margin` (5.2.0, `margin.ts`)

```ts
const scoreDiff = Math.abs(iScore - qScore)
return margin > 0 && scoreDiff > margin ? Math.log1p(scoreDiff / margin) : 1
```

BT e TM dividem (μ_i − μ_q) pelo divisor. PL desloca cada μ pela média de `(μ_q − μ_i)·(divisor − 1)`. Não tem efeito quando os μ são iguais. Para diferenças entre `margin` e ~1,72·`margin`, o divisor fica < 1 e o efeito é o **inverso** do esperado. Não usar em educação.

### 5.10 `weight` (main, `rate.ts` + `util.ts`)

- `normalize(vector, 1, 2)` por time: o mínimo vira 1 e o máximo vira 2. **Com 2 jogadores o resultado é sempre `[1,2]` ou `[2,1]`.** Pesos todos iguais colapsam para 1, um no-op (teste "normalizes uniform within-team weights to a no-op").
- `updatePlayer` usa `w = Ω ≥ 0 ? weight : 1/weight`. Num time que **perdeu**, peso maior significa **perda menor**, e **peso < 1 significa perda maior** (§12, armadilha 6).

---

## 6. Vetores de referência para testes de paridade

Todos copiados dos testes do repo e **reproduzidos bit a bit** pela minha reimplementação independente do 1v1, script em `C:\Users\nicoolas\AppData\Local\Temp\claude\93f77aa8a8fded61\ce8a727e-bf7b-4ba7-a17e-a44935702d32\scratchpad\osk\check.mjs`:

| Caso | Entrada | Saída esperada | Fonte |
|---|---|---|---|
| 1v1 novatos via `rate` (com τ default) | `rate([[rating()],[rating()]], {rank:[2,1]})` | vencedor `{mu: 27.635389493140497, sigma: 8.06590141354368}`, perdedor `{mu: 22.364610506859503, sigma: 8.06590141354368}` | `src/__tests__/rate.test.ts` "reverses rank" |
| 1v1 novatos chamando o modelo direto (sem τ) | `bradleyTerryFull([[r],[r]])` | `27.63523138347365 / 8.065506316323548` (PL dá o mesmo) | `models/__tests__/bradley-terry-full.test.ts`, `plackett-luce.test.ts` |
| τ = 0,3, σ = 3 | `rate([[{25,3}],[{25,3}]], {tau:0.3})` | `25.624880438870754 / 2.9879993738476953` e `24.375119561129246 / 2.9879993738476953` | `rate.test.ts` "accepts a tau term" |
| `limitSigma` | `{40,3}` vence `{-20,3}`, `{tau:0.3, limitSigma:true}` | `{40.00032667136128, 3}`, `{-20.000326671361275, 3}` | `rate.test.ts` "prevents sigma from rising" |
| Empate 1v1 | `rank:[0,0]` ou `score:[0,0]` | `{25, 8.06590141354368}` ×2 | `rate.test.ts` |
| PL 4 FFA default | `rate([[a1],[b1],[c1],[d1]])` com a1 `{29.182,4.782}`, b1 `{27.174,4.922}`, c1 `{16.672,6.217}`, d1 default | `30.210227447000438/4.765617924939384`, `27.644725221915632/4.883479590134575`, `17.4036218889969/6.101259408259549`, `19.21460876538932/7.854669920480409` | `rate.test.ts` |
| PL série 3 partidas FFA | ver arquivo | `p03.mu ≈ 26.353761103`, … (toBeCloseTo) | `models/__tests__/plackett-luce-series.test.ts` |
| `ordinal` | `{mu:5, sigma:2}` | `-1` | `ordinal.test.ts` |
| `predictWin` | `[[rating()], [{33.564, 1.123}]]` | `[0.2021…, 0.7978…]` (docs/app/api). **O README diz `[0.4511…, 0.5489…]`, valor desatualizado** | `docs/app/api/page.mdx`; conferido à mão: Φ(−8.564/√105.42) ≈ 0,202 |

---

## 7. Desempenho

| Medida | Valor | Fonte |
|---|---|---|
| `rate` 5v5, `bradleyTerryFull` | 62.643 ops/s | README / `benchmark/results4.md` (Mac Pro 2013, Node 13, antigo) |
| `rate` 5v5, `plackettLuce` | 23.492 ops/s | idem |
| TrueSkill 5v5 | 2.962 ops/s | idem |
| FFA 5 jogadores, PL | 12.296 ops/s | `benchmark/README.md` |
| **Fórmula fechada 1v1 (minha, inline)** | **≈ 2,6 × 10⁷ updates/s** | `scratchpad/osk/bench.mjs`, Node 24.12, 1 thread, nesta máquina |
| `rate()` 1v1 da biblioteca | **não medido**, porque não executamos código do repo. Espere 1–2 ordens de grandeza abaixo da fórmula fechada (ramda, `sort-unwind`, `constants()` reconstruído, alocações) | — |

**Orçamento do Monte Carlo:** M = 10⁴ trajetórias × 1.500 h × ~30 respostas/h dá 4,5×10⁸ updates, ou **~17 s** só de rating com a fórmula fechada num thread. Com `rate()` seriam minutos. Por isso, no Monte Carlo use `rateAnswerFast` num `worker_thread`. No app interativo (1 resposta por vez), `rate()` é irrelevante em custo.

Acurácia publicada (`benchmark/README.md`, antiga): em 2 times (OverTrack), BT/PL acertam 54,34% contra 54,19% do TrueSkill. Em FFA (rr18xx), "acertar o vencedor" dá PL 44,92%, BT-Part 45,14% e TrueSkill 45,14%. Ou seja, **equivalente ao TrueSkill** e bem mais rápido.

---

## 8. Mapeamento para o nosso app: aluno × item como partida

### 8.1 Entidades e granularidade

Tudo é **isolado por domínio** (meta 3): cada sessão de domínio (Inglês, Eletrônica…) tem o próprio store de ratings.

| Entidade | Chave | Rating inicial | Atualiza quando |
|---|---|---|---|
| Aluno × nó | `student:{domainId}:{nodeId}` | **prior hierárquico:** μ do rating da região ou pré-requisitos, σ = sqrt(σ²_região + 3²); sem informação, `rating()` = {25, 8,33} | cada resposta a item do nó |
| Aluno × região/subdomínio | `student:{domainId}:region:{regionId}` | `rating()` | cada resposta de qualquer nó da região, como partida separada contra o mesmo item. Opcionalmente com evidência reduzida, ver §8.3 |
| Aluno × domínio (θ global) | `student:{domainId}:*` | `rating()` | toda resposta. É a base do "skill rating" exibido e do Monte Carlo |
| Família de itens (nó × nível 1–5) | `item:{domainId}:{nodeId}:L{1..5}` | μ = âncora do nível (§8.5), σ_item0 ≈ 3–4 (menor que o do aluno) | cada resposta a item dessa família |

> Por que **família** e não item individual? Exercícios gerados por LLM são quase de uso único, então rating por item nunca acumula dados. O relatório r2 (§3.3) já recomenda calibrar por **família (nó × nível)** com a dificuldade do LLM como prior fraco (r ≈ 0,38 no BEA 2024). OpenSkill faz isso com σ explícito no lugar do `U(n) = 1/(1+0,05n)` do Elo de Pelánek.

### 8.2 `rateAnswer()` com a biblioteca

```ts
// src/core/rating/rate-answer.ts
import { rate, type Rating } from 'openskill'
import { bradleyTerryFull } from 'openskill/models'

export type Outcome = 0 | 0.5 | 1            // erro | parcial | acerto
export interface RatingCfg {
  beta: number                               // calibrado (§9.4); default 25/6
  studentTauPerDay: number                   // inflação por dia sem praticar (esquecimento/aprendizado)
  studentTauPerAnswer: number                // ex.: 25/300
  itemTau: number                            // normalmente 0 (itens não "aprendem")
  limitSigma: boolean                        // true: ordinal nunca cai após acerto
}

const inflate = (r: Rating, tau: number): Rating =>
  tau > 0 ? { mu: r.mu, sigma: Math.sqrt(r.sigma * r.sigma + tau * tau) } : r

export function rateAnswer(student: Rating, item: Rating, outcome: Outcome,
                           daysIdle: number, cfg: RatingCfg) {
  // tau POR ENTIDADE: a lib só tem um tau global, então aplicamos à mão e chamamos com tau: 0
  const tauS = Math.hypot(cfg.studentTauPerAnswer, cfg.studentTauPerDay * Math.sqrt(daysIdle))
  const s = inflate(student, tauS)
  const i = inflate(item, cfg.itemTau)
  const rank = outcome === 1 ? [1, 2] : outcome === 0 ? [2, 1] : [1, 1]
  const [[s2], [i2]] = rate([[s], [i]], { model: bradleyTerryFull, rank, tau: 0, beta: cfg.beta })
  return {
    student: cfg.limitSigma ? { mu: s2.mu, sigma: Math.min(s2.sigma, student.sigma) } : s2,
    item: i2,
    pBefore: pCorrect(s, i, cfg),            // P(acerto) com os mesmos σ inflados do update; registrar no ledger (§8.6)
  }
}
```

> `Math.sqrt(daysIdle)` faz a variância crescer linearmente no tempo (passeio aleatório), como no Glicko. Calibre `studentTauPerDay` pelo log-loss (§9.4).

### 8.3 `rateAnswerFast()`, fórmula fechada (Monte Carlo e crédito graduado)

É o mesmo cálculo de `bradley-terry-full.ts` + `updatePlayer` para 1v1, na **mesma ordem de operações**. Com isso, `s ∈ {0, 0.5, 1}` e `e = 1` reproduzem `rate()` bit a bit, como conferi com os vetores da §6.

```ts
// src/core/rating/rate-answer-fast.ts — derivado de openskill.js (MIT), ver THIRD_PARTY_NOTICES
export function rateAnswerFast(
  sMu: number, sSig: number, iMu: number, iSig: number,
  s: number,            // resultado do aluno em [0,1] (graduado permitido)
  e = 1,                // força da evidência em (0,1]; NOSSA extensão simétrica
  beta = 25 / 6, kappa = 1e-4,
): [number, number, number, number, number] {
  const sS2 = sSig * sSig, iS2 = iSig * iSig
  const c = Math.sqrt(sS2 + iS2 + 2 * beta * beta)
  const p = 1 / (1 + Math.exp((iMu - sMu) / c))           // P(aluno acerta)
  // aluno
  const sEta = sS2 / c, sGam = Math.sqrt(sS2) / c
  const sOm = sEta * (s - p), sDe = ((sGam * sEta) / c) * p * (1 - p)
  // item (resultado complementar, prob complementar)
  const q = 1 - p
  const iEta = iS2 / c, iGam = Math.sqrt(iS2) / c
  const iOm = iEta * ((1 - s) - q), iDe = ((iGam * iEta) / c) * q * (1 - q)
  return [
    sMu + sOm * e, sSig * Math.sqrt(Math.max(1 - sDe * e, kappa)),
    iMu + iOm * e, iSig * Math.sqrt(Math.max(1 - iDe * e, kappa)),
    p,
  ]
}
```

Notas:

- **Paridade de bits:** em `bradley-terry-full.ts` o item usa `1/(1+exp((sMu−iMu)/c))`, não `1 − p`. Para paridade estrita, calcule `q` como a lib faz. Com `1 − p` a diferença é ≤ 1 ulp e irrelevante no Monte Carlo, mas o teste de paridade deve usar a forma da lib.
- **`e` (evidência) é simétrico de propósito.** O `weight` da lib é assimétrico (`1/weight` em derrota) e, com valor < 1, **amplifica a perda**. Use `e` para:
  - múltipla escolha com chute (ex.: `e = 0.6` para 4 alternativas);
  - acerto com dica (`e = 0.5`);
  - atualizar a região ou o domínio a partir de uma resposta de nó (`e = 0.5`).
- **Crédito graduado:** com rubrica 0–1 do LLM corretor, passe `s` contínuo. Para `s ∉ {0, ½, 1}` a lib não tem equivalente (ela só expressa vitória, empate e derrota via `rank`). É uma extensão nossa, documentada como tal.

### 8.4 Itens multi-habilidade

Um item pode exercitar vários nós (ex.: "Thevenin + divisor de tensão"). **Não faça k-vs-1.** O μ do time é soma (§5.1), então um aluno com 2 nós de μ=25 vira μ=50 contra um item de μ=25, e o aluno "ganha" quase sempre. Opções, em ordem de preferência:

1. **Habilidade primária apenas** (v1, funciona na 5.0.1): o item tem um `primaryNodeId`. Os secundários recebem uma partida extra cada com `e = 0.3–0.5` via `rateAnswerFast`, ou ficam só a cargo do BKT/FIRe.
2. **k-vs-k simétrico:** o item tem um componente de dificuldade por habilidade (`item:{node}:L{n}` de cada nó). Chame `rate([[sA, sB], [iA, iB]], {model: bradleyTerryFull})`. A escala fica consistente porque as somas se cancelam. `weight` (só no `main`) permite dar peso 2 à primária e 1 à secundária.

### 8.5 Âncoras, priors do LLM e identificabilidade (app de um usuário)

Com um único aluno, só a **diferença** μ_aluno − μ_item é identificável. Cada resposta empurra aluno e item em sentidos opostos, e o "nível 3" passa a significar "difícil para *este* aluno". Mitigações combinadas:

- **Escada de âncoras por nível:** `μ_L = 25 + Δ·(L − 3)`, com Δ ≈ 6–8 pontos (≈ 1 c com σ baixos, §8.6). A família começa com `μ = μ_L + ajuste_LLM` (o LLM estima a dificuldade relativa, −1..+1 nível) e `σ_item0 ≈ 3,5`.
- **σ do item menor que o do aluno:** o update é proporcional a σ², então o item se move bem menos.
- **Re-centragem periódica** (job semanal por domínio): para cada nível L, aplique `μ ← μ + (μ_L − média(μ das famílias do nível L))` a todas as famílias e ao aluno. É uma transformação afim, então preserva todas as probabilidades.
- **Prior hierárquico do aluno:** um nó novo herda μ da região ou dos pré-requisitos com σ inflado, em vez de começar em 25 com 8,33. Isso se conecta à "propagação bayesiana pelo DAG" do diagnóstico CAT do Mathua.

### 8.6 Seleção de item e P(acerto)

Use a **mesma logística do modelo**, nunca `predictWin`:

```ts
export function pCorrect(s: Rating, i: Rating, { beta }: { beta: number }) {
  const c = Math.sqrt(s.sigma ** 2 + i.sigma ** 2 + 2 * beta ** 2)
  return 1 / (1 + Math.exp((i.mu - s.mu) / c))
}
// nível alvo: gap = μ_aluno − μ_item = c · ln(p/(1−p))
```

Tabela calculada (β = 25/6):

| σ_aluno / σ_item | c | gap para p = 0,75 | gap para p = 0,85 | p com gap 10 |
|---|---|---|---|---|
| 8,33 / 8,33 (tudo novo) | 13,18 | 14,5 | 22,9 | 0,681 |
| 4 / 3 | 7,73 | 8,5 | 13,4 | 0,785 |
| 2 / 2 (estabilizado) | 6,54 | 7,2 | 11,3 | 0,822 |
| 1,5 / 1,5 | 6,26 | 6,9 | 10,9 | 0,832 |

Política proposta, alinhada ao r2:

- prática normal: escolher a família com p mais perto de **0,75** (faixa 0,70–0,85);
- **sondas** diagnósticas: p ≈ **0,5**, onde a informação `p(1−p)/c²` é máxima;
- revisão FSRS: o card manda, e o rating só registra o resultado.

### 8.7 Pontos fracos e memória de contexto (meta 2)

Por nó, o par (μ, σ, n, lastAt) é um resumo compacto e interpretável. Métricas para o bloco "pontos fracos" do prompt:

- `pFailTarget(node) = 1 − pCorrect(student_node, anchor(nível_alvo_do_nó))`, a chance de errar no nível em que o aluno deveria estar;
- `lcb = μ − 2σ` relativo ao μ esperado pela profundidade no grafo;
- `σ` alto com `n` baixo significa "desconhecido", o que pede sonda e não reforço.

Injete só o top-5 por domínio (orçamento de tokens), com rótulos em linguagem natural ("fraco em Thevenin nível 3, P(erro) ≈ 45%").

### 8.8 Exibição (meta 5, eixo "habilidade")

- `ordinal(r, { alpha: 40, target: 1000 })`: novato **1000**; μ=35 e σ=1,5 dão 1000 + 40·30,5 = **2220**. É um "SR" familiar.
- Mostre o ordinal do **domínio** (não de cada nó) no perfil, e por região nas telas do grafo.
- **Separe dois eixos:** **XP/nível** (esforço, monotônico, ver §9) e **Skill rating** (ordinal, pode oscilar). Nunca derive XP de Δordinal: os ganhos encolhem à medida que σ cai e isso desmotiva.

---

## 9. Monte Carlo de níveis e ligas (combinação com o simulador do fsrs-rs e o ledger do Mathua)

### 9.1 Peças

| Peça | Origem | Papel |
|---|---|---|
| Atualização de habilidade e P(acerto) | **openskill.js** (`rateAnswerFast`, paridade com `rate`) | Calibra θ e as famílias. Dá P(acerto) do aluno sintético visto pelo app |
| Memória e revisões | **ts-fsrs / simulador do fsrs-rs** (ver `extra-open-spaced-repetition__ts-fsrs.md` §simulador; fsrs-rs simula 1.825 dias × 10k cartas por default, segundo o r8) | Carga diária de revisões, retenção, tempo gasto em revisão |
| Economia de XP | **Mathua** `internal/xp/policy.go` + accountability, ledger `xp_events` idempotente (ver `extra-chuma-beep__mathua.md` §8) | "XP ≈ 1 por minuto esperado de trabalho focado". Deduções desligadas para o app de um usuário |
| Ligas | **Mathua** `planWeek`/`cutCohorts`/`moversFor` (puro e determinístico; tiers; coortes de 30) | Promoção e rebaixamento semanal |

### 9.2 Aluno sintético

- horas/dia ~ LogNormal (moda 2–4 h), aderência ~ Beta;
- habilidade verdadeira por nó θ*_n(h) segue uma curva de prática: `θ*(h) = θ0 + A·(1 − (1 + h/h0)^(−α))`, com h = horas acumuladas no nó;
- resposta verdadeira: `P = g + (1 − g − slip)·logistic((θ* − d*)/s_true)`, com d* a dificuldade "real" do nível;
- o app simulado vê só os acertos e roda **o nosso pipeline real**: seleção de item (§8.6), `rateAnswerFast`, scheduler FSRS e `Award()` do XP.

### 9.3 Saídas e calibração

- **Níveis (eixo esforço):** escolha uma grade de horas `h_L = H_max·(L/L_max)^κ` (ex.: L_max = 100, H_max = 1.500 h, κ ≈ 1,6, de modo que os primeiros níveis venham rápido). O threshold é `XP_L = Q_0,5(XP acumulado em h_L)` sobre as M trajetórias. Assim "ganhos compatíveis com o nível" vêm por construção, como propõe o relatório do Mathua §9.3.
- **Tiers de skill (eixo habilidade):** bandas de quantis do **ordinal do domínio** condicionadas às horas (ex.: Bronze < Q20, Prata Q20–40 …). O aluno é comparado com sintéticos de **mesma exposição**, não com o topo absoluto.
- **Ligas semanais (um usuário):** para o tier do aluno, amostre 29 "fantasmas" do XP semanal simulado na banda de quantis correspondente, condicionados ao nível atual. A seed é `hash(domainId, isoWeek)`, então a liga é reproduzível. Aplique o `planWeek` do Mathua.
- **"MMR de liga" opcional com Plackett-Luce:** no fim da semana, rode `rate(teams30, { model: plackettLuce, score: xpSemana })`, com o aluno e 29 fantasmas de rating fixo (μ do fantasma mapeado do seu quantil). Persista **só** o rating do aluno. PL é o modelo da lib feito para k grande. O resultado é um rating de "competitividade semanal" que regula de qual banda os fantasmas são amostrados na próxima semana, como um matchmaking justo.
- **Recalibração:** depois de ~4 semanas de dados reais, substitua as distribuições a priori (horas/dia, acurácia) pelas observadas (bootstrap) e recompute os thresholds. **Congele** os thresholds já atingidos (nunca rebaixe nível).

### 9.4 Ajuste de hiperparâmetros (β, τ, σ_item0, Δ da escada)

Faça um replay do log de eventos (`rating-events.jsonl`) com uma grade de hiperparâmetros. Minimize **log-loss / Brier de `pBefore`** contra o resultado observado, sempre **prequencial** (prever antes de atualizar). Comece com o default da lib. Em educação, espere β maior que 25/6, porque há mais ruído por slip e chute. Os explorers da doc (`docs/components/explorers/*.tsx`, MIT) servem de modelo para uma tela de "tuning" interna.

### 9.5 Esqueleto TS do Monte Carlo

```ts
// src/core/sim/cohort.ts (rodar em worker_thread; RNG com seed, ex. xorshift/PCG)
export interface SimCfg { M: number; days: number; seed: number; hoursPerDay: Dist; adherence: Dist;
  answersPerHour: number; ratingCfg: RatingCfg; xpPolicy: XpPolicy; fsrs: FsrsParams }
export interface SimOut { hoursGrid: Float64Array; xp: Float64Array[]; ordinal: Float64Array[]; weeklyXp: Float64Array[] }
export function simulateCohort(graph: DomainGraph, cfg: SimCfg): SimOut { /* loop sem alocação; rateAnswerFast */ }
export const thresholdsFromQuantiles = (samples: Float64Array[], grid: number[], q = 0.5): number[] => { /* … */ }
```

Velocidade alvo: M = 2.000 para recalibração interativa (segundos) e M = 10⁴ offline ou noturno.

---

## 10. Arquivos exatos a copiar ou adaptar

Caminhos relativos a `C:\Users\nicoolas\Pictures\learnharness\_refs\extra\philihp__openskill.js\`.

### 10.1 Opção A (recomendada para a v1): dependência npm

```jsonc
// package.json do app
"openskill": "5.0.1"   // exato, sem ^ (o próprio CLAUDE.md do repo pede pin exato)
```

Nada a copiar do código da lib. Copiar ou adaptar **testes e vetores**:

| Origem | Destino no nosso app | O que fazer |
|---|---|---|
| `src/__tests__/rate.test.ts` (397 linhas) | `tests/rating-openskill-parity.test.ts` | Levar os casos 1v1, tau, limitSigma, empate e 4-FFA como vetores fixos (§6). Pular os casos de `weight` na 5.0.1 |
| `src/models/__tests__/bradley-terry-full.test.ts`, `plackett-luce.test.ts`, `plackett-luce-series.test.ts` | idem | Vetores do modelo puro (sem tau) |
| `src/__tests__/parity-plackett-luce.test.ts`, `parity-bradley-terry-full.test.ts` | idem | Vetores do openskill.py 6.2.0. Os casos com `margin`/`weight` só valem após upgrade |
| `src/__tests__/_helpers.ts` (129 linhas) | `tests/helpers/expect-shim.ts` | Shim de `expect` sobre `node:test`, compatível com o nosso `tsx --test` |
| `docs/lib/scenarios.ts` (192 linhas) | `src/core/rating/scenarios.ts` | `duel`, `playSeries`, `streak`, `alternating`, `improvement`: cenários puros para a tela de tuning e para testes de convergência |
| `src/models/bradley-terry-full.ts` + `src/util.ts#updatePlayer` | `src/core/rating/rate-answer-fast.ts` | **Adaptar** para a fórmula fechada 1v1 (§8.3), com cabeçalho MIT |

### 10.2 Opção B: vendorizar o `main` (`ffb530f`)

Para ter `weight`/`windowSize`/`margin` antes de o npm publicar, ou para remover ramda.

| Arquivo | Linhas | Necessário? | Adaptação |
|---|---|---|---|
| `src/types.ts` | 57 | sim | nenhuma |
| `src/constants.ts` | 50 | sim | nenhuma |
| `src/rating.ts` | 9 | sim | nenhuma |
| `src/ordinal.ts` | 19 | sim | nenhuma |
| `src/rate.ts` | 65 | sim | trocar `ramda` (`sortBy, identity, range`) e `sort-unwind` por ~10 linhas: `const order = [...teams.keys()].sort((a,b)=>rank[a]-rank[b])` (sort estável, igual ao `unwind`) e reverter com o inverso da permutação |
| `src/util.ts` | 215 | sim | trocar o `zip` do ramda por um loop |
| `src/margin.ts` | 60 | só se usar `margin` | trocar `addIndex/map/always/range/sum` do ramda |
| `src/models/bradley-terry-full.ts` | 34 | sim | nenhuma |
| `src/models/plackett-luce.ts` | 43 | sim | nenhuma |
| `src/models/index.ts` | 5 | sim | exportar só os 2 modelos |
| `src/statistics.ts` | 51 | só para `predictWin`/TM | mantém as deps `@stdlib` (Apache-2.0). **Dispensável** se não usarmos `predictWin` (não devemos, §12) |
| `src/predict-*.ts` | 92 | não | — |
| `src/models/thurstone-*.ts`, `bradley-terry-part.ts` | 145 | não | — |
| `LICENSE` | — | sim | copiar para `THIRD_PARTY_NOTICES/openskill.js-LICENSE` |

O resultado é ~550 linhas, **zero dependências** (sem ramda e sem @stdlib), em `src/core/rating/openskill/`, com um cabeçalho em cada arquivo: `// Derived from openskill.js (MIT) © 2020 Philihp Busby — commit ffb530f`.

---

## 11. Dependências

| Pacote | Versão (5.0.1) | Licença | Peso/risco |
|---|---|---|---|
| `ramda` | 0.32.0 | MIT | Grande, mas `sideEffects: false` permite tree-shaking. Só ~10 funções usadas |
| `@types/ramda` | 0.31.1 (5.0.1) / 0.32.0 (main) | MIT | **Está em `dependencies`, não em devDependencies.** Vem junto no install, inofensivo |
| `sort-unwind` | 3.1.0 (5.0.1) / 4.1.1 (main) | MIT | Minúsculo, zero deps. O mesmo autor |
| `@stdlib/math-base-special-erf` | 0.2.6 | Apache-2.0 | ~106 KB descompactado e ~7 subdeps `@stdlib`. `gypfile: false`, sem scripts |
| `@stdlib/stats-base-dists-normal-quantile` | 0.3.1 | Apache-2.0 | idem |

Compatibilidade com o host (`learnharness`, `package.json`): ESM (`"type": "module"`), TypeScript ^5.6, Next ^16.4, Electron ^44, Node 24 local. O pacote tem exports dual ESM/CJS e `.d.ts`. Os tipos usam `const` type parameters (TS ≥ 5.0), então funcionam. A lógica de rating deve viver no lado servidor Next (`src/core`, `src/server`), não no `electron/main.cjs`.

---

## 12. Armadilhas

1. **npm ≠ main.** A 5.0.1 ignora `weight` em silêncio, não tem `windowSize` e tem o `margin` antigo (pós-modelo, `margin: 0` ignorado). Fixe a versão exata e rode os vetores de paridade no CI do app. Ao subir para ≥ 5.1, reexecute o replay de calibração (§9.4).
2. **`tau` é global e se aplica a itens também.** Chame `rate(..., { tau: 0 })` e aplique τ por entidade antes, como em `rateAnswer`. Se usar `limitSigma` com `tau: 0`, a lib **não** aplica nada (a condição é `TAU && LIMIT_SIGMA`), então aplique o `min(σ_novo, σ_antigo)` à mão.
3. **`predictWin` é gaussiano** (Φ com `sqrt(n·β² + σA² + σB²)`, n = nº de times), enquanto BT e PL atualizam com a **logística** `1/(1+exp(−Δμ/c))`. Com gap 10 e σ=2, Φ dá **0,937** e a logística **0,822**. Para seleção de item e log-loss use `pCorrect` (§8.6). `predictWin` com 1 time devolve `NaN`.
4. **O μ do time é soma** e há um β² por time, não por jogador. k-vs-1 distorce a escala (§8.4).
5. **Chamar o modelo direto pula o `rate`:** sem τ, sem ordenação por rank, sem normalização de `weight` e sem `limitSigma`. O modelo assume que os times chegam **ordenados por rank**. Use sempre `rate()` ou a nossa fórmula fechada testada.
6. **`weight` é assimétrico:** `w = Ω ≥ 0 ? weight : 1/weight`. Com `weightBounds: null` e peso 0,5, uma **derrota dobra**. E com a normalização default `[1,2]`, dois jogadores viram sempre `[1,2]`, seja qual for a razão original. Para "força de evidência" use o `e` simétrico da §8.3.
7. **`ordinal` não é habilidade.** Começa em 0, sobe com σ caindo mesmo em derrotas, e pode cair após vitória com τ > 0. Bom para exibição, ruim como base de XP.
8. **`balance: true` divide pelo melhor ordinal do time.** Com novatos (ordinal 0) o fator explode ou fica negativo. Mantenha `false`.
9. **Identificabilidade de um único usuário:** sem âncoras e re-centragem, as dificuldades derivam junto com o aluno (§8.5).
10. **Determinismo:** BT e PL usam `Math.exp`, que o ECMAScript define só de forma aproximada (o próprio CHANGELOG 5.0.0 cita isso ao trocar o TM para `@stdlib`). O último ulp pode diferir entre versões do V8/Electron. **Persista `before`/`after` no ledger** em vez de recomputar a história. O Monte Carlo com seed é reprodutível dentro do mesmo runtime.
11. **`rank` menor é melhor; `score` maior é melhor** (`rank = −score`). Empate se expressa com ranks ou scores iguais. Não existe "meia vitória" nativa, por isso o crédito graduado é extensão nossa.
12. **Os docs têm inconsistências.**
    - O exemplo de `predictWin`/`predictDraw` no README (`0.4511`/`0.0902`) está desatualizado. Os docs do site (`0.2021`/`0.2164`) batem com o código.
    - `docs/app/models/custom/page.mdx` diz que o `rate` aplica `margin` depois do modelo, mas desde 5.2.0 cada modelo aplica dentro.
13. **Tipos de `Options` são fechados.** Passar campos próprios para `rate` dá erro de TS. Para parametrizar um modelo custom, use closure (`const m: Model = (t, o) => bradleyTerryFull(t, { ...o, gamma })`).
14. **Próxima major** mudará o default de `windowSize` (só nos modelos `*Part`). Mais um motivo para o pin exato.
15. **Custo de `constants()` por chamada** e alocações de ramda: irrelevante no app, relevante no Monte Carlo. Use a fórmula fechada lá.

---

## 13. Plano de integração

**Fase 0: contrato e testes (½ dia)**

- `npm i openskill@5.0.1 --save-exact`.
- `tests/rating-openskill-parity.test.ts` com os vetores da §6 e o shim `_helpers.ts`. Para confirmar que BT/PL/τ/limitSigma da 5.0.1 batem com o `main`, rode-os contra a 5.0.1 (é a expectativa pelo changelog; ainda não foi verificado executando).
- Teste de paridade `rateAnswerFast` ≡ `rate()` para s ∈ {0, ½, 1}, `e = 1` e 10⁴ pares aleatórios (igualdade estrita ou ≤ 1 ulp).
- Testes de propriedade:
  - acerto nunca reduz μ_aluno;
  - erro nunca aumenta μ_aluno;
  - com τ = 0, σ nunca sobe;
  - simetria: com σ iguais, o ganho do aluno é igual à perda do item;
  - permutar a ordem dos times com `rank` correspondente não muda o resultado.

**Fase 1: núcleo puro `src/core/rating/` (1–2 dias)**

- `types.ts`: `SkillRating { mu; sigma; n; lastAt }`, `RatingKey`, `RatingCfg`, `RatingEvent`.
- `rate-answer.ts`: `rateAnswer` (§8.2) e `pCorrect` (§8.6).
- `rate-answer-fast.ts`: fórmula fechada (§8.3), cabeçalho MIT.
- `anchors.ts`: escada μ_L, prior do LLM, prior hierárquico de nó novo e `recenter()` (§8.5).
- `select.ts`: escolha de família por p alvo (0,75 para prática, 0,5 para sonda).
- `display.ts`: `skillRating(r) = ordinal(r, { alpha: 40, target: 1000 })`.
- `weakness.ts`: `pFailTarget`, `lcb` e top-k para o prompt (§8.7).

**Fase 2: persistência por domínio `src/store/ratings.ts` (1 dia)**

- `…/domains/{domainId}/ratings.json`, snapshot `{ version, cfg, students, items, domain }` gravado com `writeFileAtomicSync` (`src/store/atomic-write.ts` do host).
- `…/domains/{domainId}/rating-events.jsonl`, append-only: `{ eventId (=answerId, idempotente), at, nodeId, familyKey, outcome, evidence, pBefore, before:{s,i}, after:{s,i}, lib:"openskill@5.0.1", cfgHash }`.
- Reconstruir o snapshot a partir do log (replay) é possível, mas **use o `after` gravado** (armadilha 10).

**Fase 3: ganchos (1–2 dias)**

- No corretor de quiz e exercício (`src/server/plugin-questions.ts` / `plugin-problems.ts` ou equivalente), depois de cada resposta avaliada:
  1. `rateAnswer` no nó (e = 1);
  2. `rateAnswerFast` na região e no domínio (e = 0,5);
  3. secundários (e = 0,3);
  4. gravar o evento.
- No seletor de próximo exercício: `select.ts` sobre as famílias do nó da fronteira.
- No montador de prompt (`src/agent/prompt-segments.ts`): bloco curto "pontos fracos" de `weakness.ts`.

**Fase 4: Monte Carlo e gamificação (3–5 dias, depende de FSRS e do XP do Mathua)**

- `src/core/sim/cohort.ts` em `worker_thread`, com RNG seedado, `rateAnswerFast`, ts-fsrs e `Award()`.
- `thresholds.ts`: níveis por quantis de XP e tiers por quantis de ordinal (§9.3).
- `league.ts`: fantasmas seedados, `planWeek`, e MMR de liga via `rate(..., { model: plackettLuce })`.
- Job de recalibração mensal por domínio, com thresholds congelados após atingidos.

**Fase 5: tuning (contínuo)**

- Replay prequencial por domínio com grade de (β, τ_dia, σ_item0, Δ). Escolha pelo menor log-loss. Exponha uma tela interna inspirada em `docs/components/explorers/*`.
- Avaliar o upgrade para ≥ 5.1 quando publicado, para usar `weight` no k-vs-k (§8.4 opção 2).

---

## 14. Alternativas consideradas

| Alternativa | Licença | Prós | Contras para nós |
|---|---|---|---|
| **Elo educacional (Pelánek 2016)**, usado no r2 | — (fórmula) | Trivial. `U(n) = 1/(1+0,05n)` | Incerteza ad hoc, sem σ por entidade, sem times, sem PL para ligas |
| **Glicko-2** (`mmai/glicko2js`, MIT) | MIT | RD com crescimento por inatividade embutido | Só 1v1. Atualização em "períodos de rating" (lote), menos natural por resposta |
| **IRT 2PL MAP / CAT** (Mathua `internal/diagnostic/cat.go`) | ver relatório | Discriminação `a` por item. Ótimo para o diagnóstico inicial | Estimação offline e mais pesada. Usar **no placement**; OpenSkill no online |
| **TrueSkill** (ts-trueskill etc.) | patente e marca da Microsoft | Clássico | ~20× mais lento, iterativo, risco de propriedade intelectual |
| **openskill.py 6.2.0** | MIT | Referência de paridade | Python. Não cabe no Electron |
| **KT profundo (pyKT, AKT, simpleKT)** | MIT | Mais preditivo com muitos dados | Exige dataset e PyTorch. Use offline para validar, não em runtime |

**Veredito:** OpenSkill (BT Full para respostas e PL para ligas) é a melhor relação simplicidade × incerteza explícita × velocidade × licença para o runtime TS. Ele complementa, e não substitui:

- o **FSRS** (memória por card);
- o **BKT/FIRe** (mastery e gating, r2);
- o **IRT/CAT** (placement inicial).

---

## 15. Referências

- Repo: https://github.com/philihp/openskill.js (commit `ffb530f`, 2026-11-17). Arquivos lidos: `src/*.ts`, `src/models/*.ts`, `src/__tests__/{rate,ordinal,predict-win,predict-draw,predict-rank,parity-plackett-luce,custom-model.test-d,util/team-rating}.ts`, `src/models/__tests__/{bradley-terry-full,plackett-luce,plackett-luce-series}.test.ts`, `README.md`, `CHANGELOG.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `LICENSE`, `package.json`, `tsdown.config.ts`, `tsconfig.json`, `docs/app/**/page.mdx` (api, models, models/custom, tuning/*, predictions, ranking, getting-started), `docs/lib/{openskill,scenarios}.ts`, `benchmark/README.md`, `benchmark/results4.md`, `.github/workflows/publish.yml`.
- Docs: https://openskill.philihp.com/ (API, Models, Custom models, Tuning).
- npm: https://registry.npmjs.org/openskill (latest 5.0.1, 2026-06-08; modified 2026-07-08). Dist 5.0.1 inspecionado em https://unpkg.com/openskill@5.0.1/dist/index.js.
- `sort-unwind@4.1.1` (MIT, sort estável de índices): https://unpkg.com/sort-unwind@4.1.1/dist/index.js.
- `@stdlib/math-base-special-erf@0.2.6` (Apache-2.0, `gypfile: false`, sem scripts).
- openskill.py 6.2.0 (PyPI, MIT): https://github.com/vivekjoshy/openskill.py.
- Weng, R. C. & Lin, C.-J. (2011). *A Bayesian Approximation Method for Online Ranking*. JMLR 12, 267–300. https://www.csie.ntu.edu.tw/~cjlin/papers/online_ranking/online_journal.pdf.
- Pelánek, R. (2016). *Applications of the Elo rating system in adaptive educational systems*. Computers & Education. https://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf.
- Relatórios internos relacionados: `docs/research/r2-knowledge-tracing-srs-kst.md` (§3.3 IRT/Elo, famílias de itens), `docs/research/extra-chuma-beep__mathua.md` (§8 XP, §9 ligas e níveis, §9.3 proposta de Monte Carlo), `docs/research/extra-open-spaced-repetition__ts-fsrs.md` (simulador), `docs/research/r8-descoberta-repos.md` (§9.1 esboço de Monte Carlo).
- Scripts de verificação (meus, fora do repo): `C:\Users\nicoolas\AppData\Local\Temp\claude\93f77aa8a8fded61\ce8a727e-bf7b-4ba7-a17e-a44935702d32\scratchpad\osk\check.mjs` (paridade e convergência) e `…\scratchpad\osk\bench.mjs` (velocidade, gaps alvo e logística vs Φ).

### Apêndice A: convergência observada (reimplementação, β = 25/6, τ = 25/300, 40 famílias com σ0 = 8,33, aluno com θ* acima da média)

| Respostas | μ | σ | ordinal (μ − 3σ) |
|---|---|---|---|
| 10 | 33,79 | 6,53 | 14,2 |
| 25 | 34,85 | 5,38 | 18,7 |
| 50 | 33,92 | 4,36 | 20,8 |
| 100 | 29,97 | 3,41 | 19,8 |
| 200 | 30,67 | 2,62 | 22,8 |
| 500 | 31,19 | 1,95 | 25,3 |

Passo de μ num acerto com p = 0,5:

- aluno estabilizado (σ = 2) contra item com σ = 2: **+0,31**;
- aluno novo (σ = 8,33) contra item estabilizado (σ = 2): **+3,34**.

Isso mostra por que **τ por dia** (aprendizado e esquecimento reais) é necessário em estudo de mais de 1 ano. Com o τ default, um aluno estabilizado se move devagar demais para acompanhar o próprio progresso.
