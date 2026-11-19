# Mathua (chuma-beep/mathua): motor estilo Math Academy para portar ao learnharness

> Relatório de pesquisa: `extra-chuma-beep__mathua`. Data: 2026-11-18.
> Fonte clonada (somente leitura, nada foi executado): `_refs/extra/chuma-beep__mathua`
> Commit analisado: `228dda9352a83ce749c64bafcc2e7195afec1be5` (2026-11-18 11:22 +0100), pushed_at 2026-11-18T13:17Z.
> GitHub: https://github.com/chuma-beep/mathua (427 stars, 44 forks, 0 issues abertas, criado em 2026-04-28, licença MIT).

---

## 0. Resumo e veredito

O Mathua é um backend Go (Go 1.26, SQLite ou Postgres) com frontend Next.js 16 e React 19. Ele implementa
de forma aberta e bem documentada as ideias do Math Academy:

- um **DAG de 3015 conceitos atômicos** em 24 domínios e 29 cursos, validado por Kahn sobre `prerequisites ∪ encompasses`, com pisos de densidade;
- **mastery gating por evidência**, com uma escada de 4 estados e uma janela de 6 tentativas que pondera acurácia recente, dificuldade, variedade e tempo;
- **FSRS-6** com os parâmetros padrão do `fsrs==6.3.2`, retenção 0,9 e decaimento lido na hora da consulta;
- **FIRe**: um livro-razão de repetição implícita em micro-unidades inteiras, com modos `off`, `shadow` e `active` que falham para o lado fechado;
- uma **economia de XP** com política de esforço por questão e accountability (esforço e performance) sobre um ledger idempotente;
- **ligas semanais** em 5 tiers, com coortes de 30 e promoção/rebaixamento determinístico e idempotente;
- um **diagnóstico CAT** (2PL IRT com estimação MAP, propagação bayesiana de crença pelo DAG e cobertura comprimida do grafo);
- **governança de expansão do grafo em "waves"**: ledger de candidatos, piloto de 10 antes de 40, gates automáticos, baseline aditivo congelado e métricas de defeito por wave.

**Veredito para o nosso app.** O Mathua é a melhor referência open-source que encontrei para o *núcleo determinístico* do
tutor: modelo do aluno, gating, revisão, XP, ligas e governança de expansão. Quase todo o núcleo está em pacotes Go
**puros** (sem I/O), com constantes medidas e testes de propriedade, o que torna o port para TypeScript direto.
Licença MIT, compatível com AGPL-3.0.

Ele **não** cobre:

- expansão do grafo por IA (as waves são autoria humana com scripts);
- domínios fora da matemática;
- Monte Carlo para ranks;
- flashcards ou Anki;
- multi-sessão por domínio.

Os conteúdos de lição importados (OpenStax e Algebrica) são **NonCommercial** e **não devem** ser copiados.

Recomendação:

1. Portar os pacotes puros para `src/core/mastery-engine/` (TS).
2. Usar `ts-fsrs@6.0.0` (MIT) em vez de portar `internal/fsrs`.
3. Reimplementar a camada de storage sobre os *ports* do learnharness.
4. Transformar o processo de waves num pipeline de expansão procedural por IA com o mesmo validador e as mesmas invariantes aditivas.

---

## 1. Licença e compatibilidade com AGPL-3.0

| Artefato | Licença | Pode entrar no nosso fork AGPL? |
|---|---|---|
| Código Go e TS (`internal/**`, `cmd/**`, `web/next-app/**`, `scripts/**`) | MIT, "Copyright (c) 2025 Wisdom Chukwuemeka" (`LICENSE`) | **Sim.** MIT é compatível com (A)GPL. Um port Go→TS é obra derivada, então mantenha o aviso de copyright e permissão MIT no cabeçalho dos arquivos portados e/ou num `THIRD_PARTY_NOTICES.md`. O conjunto passa a ser distribuído sob AGPL-3.0. |
| DAG de conceitos (`data/concepts/*.json`, `enrichment.json`, `courses.json`, `destinations.json`, `mastery_units.json`) | MIT (autoria do projeto) | Sim. Útil como "espinha matemática" pré-requisito de Eletrônica (cálculo, álgebra linear, complexos, EDOs). |
| Lições `data/lessons/teaching/**` (adaptadas do OpenStax) | **CC BY-NC-SA 4.0** | **Não.** NC é restrição adicional, incompatível com a AGPL §7/§10, e SA exige outra licença. |
| Lições `data/lessons/algebrica/**` | **CC BY-NC 4.0** | **Não**, pelo mesmo motivo. |
| `data/lessons/authored/**`, KP shards `data/lessons/kp/*.json` | MIT, na leitura do README ("adapted lesson content" fica fora) | Tecnicamente sim, mas são de matemática e em inglês. Os KP shards só têm títulos e subgoals curtos. Baixo valor para nós. |
| Avatares DiceBear e MathLive | Licenças próprias (MIT no MathLive) | Irrelevante. Não portar. |

> Conclusão: portar **código e estrutura de dados**. Nunca portar **lições** importadas.

---

## 2. Mapa do repositório e arquitetura

```
Web (Next.js 16 static export) ══ REST ══ Core Engine (internal/engine) ── Grader (Go + SymPy) ── Storage (SQLite/Postgres)
```

Pacotes relevantes e o que é **puro** (portável sem reescrita de I/O):

| Pacote | Linhas (sem testes) | Puro? | Papel |
|---|---:|---|---|
| `internal/concepts` (`concepts.go`, `loader.go`, `labels.go`, `mastery_units.go`; **`dag.go` está vazio**, só `package concepts`) | ~1380 | sim (o loader lê arquivos) | Schema do conceito, DAG, validação, depth/bandas, mastery units |
| `internal/mastery` (`machine.go`, `evidence.go`, `status.go`, `scaffold.go`) | ~680 | sim | Evidência, escada de estados, decaimento, máquina de Knowledge Points |
| `internal/fsrs` | ~430 | sim | FSRS-6 (substituir por `ts-fsrs`) |
| `internal/repetition` (`allocate.go`, `credit.go`, `advance.go`) | ~440 | sim | Aritmética do ledger FIRe |
| `internal/fire/mode.go` | 164 | sim | Modos off/shadow/active, fail-closed |
| `internal/scheduler` (`scheduler.go`, `eligibility.go`, `recommend.go`, `sm2.go`) | ~1230 | sim | Prioridade, elegibilidade, recomendação, interleaving |
| `internal/xp` (`policy.go`, `accountability.go`) | ~970 | sim | Preço de XP e accountability |
| `internal/leaderboard` (`leagues.go`, `compute.go`, `period.go`) | ~590 | lê o repo | Ligas e boards |
| `internal/storage/league.go` | ~330 | `planWeek`/`cutCohorts`/`moversFor` são puros | Regras de liga |
| `internal/levels/levels.go` | 28 | sim | Títulos por nº de conceitos dominados |
| `internal/diagnostic` (`cat.go`, `report.go`, `estimates.go`) | ~1560 | quase (usa `generator.Registry`) | CAT 2PL e relatório de colocação |
| `internal/planning` (`planner.go`, `estimate.go`) | ~540 | sim | Fecho de pré-requisitos de cursos, estimativa de carga |
| `internal/engine` (`engine.go` tem 4478 linhas) | ~8k | não | Orquestra tudo: `computeGradedAttempt`, `PropagateWeakness`, `allocateImplicitCredit`, `SatisfyImplicitReviews` |
| `internal/storage` | grande | não | SQLite/Postgres. Só referência de schema e idempotência |

Frontend reaproveitável (TS, MIT):

- `web/next-app/lib/progress.ts`: predicados únicos `countsAsMastered`, `masteryState` e `prereqMet`.
- `web/next-app/scripts/layoutDAG3D.ts`: layout 3D determinístico, quase linear, para DAG de 5k nós em ms (camadas de Kahn em anéis de latitude, setores angulares por domínio, sem força O(n²)). Útil para a visualização do "grafo-árvore massivo".
- `web/next-app/components/ConceptGraphFlow.tsx`: 1326 linhas, usa `@xyflow/react` (que já está no learnharness) e `dagre`.

---

## 3. Modelo de dados do grafo (`internal/concepts`)

### 3.1 Schema do conceito (`internal/concepts/concepts.go`)

```go
type Concept struct {
    ID, Label, Domain, Subdomain, GradingType string
    Prerequisites     []string          // arestas duras do DAG
    Encompasses       []string          // "praticar ESTE exercita AQUELES" (FIRe + layering)
    KeyPrerequisites  []string          // ⊆ Prerequisites (destaque pedagógico)
    InterferenceGroup string            // irmãos confundíveis (não intercalar seguidos)
    Variants          []Variant         // {Difficulty 0.1–1.0, TimeThresh, Label}
    MasteryThreshold  MasteryThreshold  // {Streak, AvgTimeSeconds ≤ 300}
    KnowledgePoints   []KnowledgePoint  // {Ordinal 1..n, Title, Section, Subgoals[], WorkedExample}
}
```

Dados reais no corpus:

- 3015 nós.
- `grading_type`: numeric 2790, symbolic 129, expression 39, tuple 26, complex 15, polynomial 8, multiple_choice 5, comparison 2, ordering 1.
- `streak` 10 em 2798 nós. Hoje é só contexto, **não** gate (ver §4).
- `enrichment.json` tem 1803 entradas, 1551 delas com `encompasses`.
- Cada conceito tem exatamente **3 KPs com 3 subgoals** (`data/lessons/kp/<id>.json`, 9045 KPs no total).

IDs são hierárquicos por ponto, com regex `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$` (`scripts/scaffold-wave.py`).
Exemplos: `abstract.group.def`, `calc.deriv.optimization`.

### 3.2 Construção e validação (`internal/concepts/loader.go`)

`LoadDir(dir)` faz quatro coisas:

1. Lê `*.json` (exceto `enrichment.json`).
2. `mergeEnrichment` acrescenta prereqs, encompasses e key_prereqs com `appendUnique`. Também atribui grupos de interferência por `members` e falha se dois grupos conflitam.
3. `mergeKnowledgePoints` lê os shards KP.
4. `Build(raw)` chama `validate()` e depois `build()`.

`validate()` impõe estas regras. Elas formam as invariantes que o nosso pipeline de expansão por IA deve reutilizar:

- ID não vazio e único. Label e domain não vazios.
- Todo `prerequisite`, `encompasses` e `key_prerequisite` existe. `encompasses` nunca contém a si mesmo.
- `key_prerequisites ⊆ prerequisites`.
- Variant: `difficulty ∈ [0.1, 1.0]`, `time_thresh > 0`, label não vazio.
- KP: `ordinal == índice+1`. Os key_prereqs do KP existem.
- `grading_type ∈ {multiple_choice, numeric, symbolic, complex, expression, ordering, tuple, polynomial, comparison}`.
- `streak > 0`, `0 < avg_time_seconds ≤ 300`.
- Grupo de interferência com 1 membro é erro.
- **Aciclicidade por Kahn sobre `prerequisites ∪ encompasses`** (`processed != len(raw)` significa ciclo).
- **Pisos de densidade**, só se o corpus tiver ≥ 1000 nós:
  - in-degree médio (prereq + encompasses) ≥ 2,20;
  - cobertura de `key_prerequisites` ≥ 80%;
  - cobertura de `encompasses` ≥ 50%.

`build()` faz o seguinte:

- monta `prereqsOf`, `dependentsOf`, `encompassedBy`, `encompassesOf` e `interferersOf` (o produto cartesiano do grupo);
- calcula a ordem topológica por Kahn (com encompasses como aresta);
- ordena os domínios.

Consultas do DAG: `PrereqsOf`, `KeyPrereqsOf`, `DependentsOf`, `EncompassedBy`, `EncompassesOf`, `InterferersOf`,
e `Available(mastered)`, que devolve os não dominados com todos os prereqs dominados.

Duplicatas semânticas ficam em `labels.go`:

- `NormalizeLabel` faz lowercase, troca não-alfanuméricos por espaço e colapsa espaços.
- `CheckDuplicateLabels` falha em qualquer colisão de label normalizado que não esteja na allowlist revisada `ReviewedDuplicateLabels()`. Exemplo de par permitido: `ra.deriv.lhopital` e `calc.limit.lhopital`.
- `CheckReviewedDuplicateLabelsExist` detecta allowlist obsoleta.

> Para a expansão por IA: normalização + allowlist revisada é o primeiro filtro anti-duplicata, barato e determinístico.
> Na nossa versão ele roda antes de um filtro semântico por embeddings.

`scripts/validate_graph.go` (27 linhas) só chama `LoadDir` e as checagens de label.

### 3.3 Profundidade e "mastery units" (`internal/concepts/mastery_units.go`, ADR-050)

- `ConceptDepths(dag)` dá a profundidade de cada nó: `1 + max(depth(prereq))`, numa passada pela ordem topológica. Resolve todos os 3015 nós, com máximo de 49.
- `SubdomainDepths` existe só como contraprova. A condensação por subdomínio **tem ciclos**: 9 ciclos cobrindo 26 de 125 subdomínios. A função devolve `unresolved` para que ninguém leia "0" como resposta. Esta é a lição principal: **agrupar nós destrói a aciclicidade**.
- `BuildMasteryUnitDraft(dag, bandWidth)` gera as unidades com `unit = (domain, floor(conceptDepth / bandWidth))`, `UnitID = "<domain>.b<band>"` e título `"<Domain> · Stage N"`. Arquivo atual: band 3, 165 unidades, 20 unidades singleton (o próprio ADR diz que precisam ser mescladas manualmente).
- `DerivedUnitPrereqs` deriva arestas unidade→unidade das arestas de conceito. **Nunca são armazenadas.** Isso evita uma "segunda hierarquia" que poderia contradizer o DAG.
- `ValidateMasteryUnits` separa dois tipos de achado:
  - **erros**: `duplicate_unit_id`, `dangling_concept`, `duplicate_membership`, `stale_count`, `uncovered_concept`, `boundary_drift` (a membership difere do que a regra declarada produz, ou seja, alguém editou à mão);
  - **anomalias**: `backward_band_edges` (zero por construção com depth por conceito) e `singleton_units`.

Para nós: **unidade = região do grafo**. É a granularidade natural para:

- ligar livros, que cobrem regiões maiores, e playlists a regiões do grafo;
- rodar "mastery checks" por região sem testar a cada conceito.

### 3.4 Cursos e destinos

- `data/courses.json`: 29 cursos `{id, name, grade, description, targets[]}`. O conteúdo do curso é o **fecho transitivo de prereqs dos targets** (`internal/planning/planner.go:64`, `collectChain`).
- `data/destinations.json`: pacotes de cursos, por exemplo `math-for-ml = calc1 + linalg + probstat`.

Para nós: "para onde o aluno vai" é um conjunto de *targets* e o caminho é o fecho. Isso alimenta a memória ("onde está e para onde vai").

---

## 4. Modelo de domínio (mastery) (`internal/mastery`)

### 4.1 Estados

```
UNSEEN → LEARNING → PRACTICING → MASTERED  (+ DECAYING, derivado na leitura, nunca armazenado)
```

ADR-037: **mastery é uma saída, não uma posição.** O status só avança. Um erro reduz a evidência, mas não "desaprende".
Decaimento é questão de retenção (revisão), nunca volta à aula.

### 4.2 Evidência (`evidence.go`, `BuildEvidence`)

Entradas por tentativa:

```go
Attempt{Correct bool; Elapsed float64; Difficulty *float64 /* 0.3–1.0, nil = desconhecida */; Instance string}
```

Algoritmo, com janela das **6** últimas tentativas (`EvidenceWindow = 6`) em ordem cronológica, a mais nova por último:

```text
w_i  = 0.5 + 0.5 · i/(n-1)          # recência: a última pesa 2× a primeira
RWA  = Σ w_i·correct_i / Σ w_i
dTerm = 0.6 + 0.4 · clamp(avgDifficulty(corretas) ?? NeutralDifficulty(0.55), 0.3, 1.0)   # ∈ [0.72, 1.0]
variety = min(0.15, 0.05 · max(0, distinctInstances(corretas) - 1))
timeFactor = (threshold > 0 && median(elapsed das corretas) > threshold) ? 0.8 : 1.0     # mediana superior: times[len/2]
Score = clamp01((RWA · dTerm + variety) · timeFactor)
```

Constantes e predicados:

| Constante | Valor |
|---|---|
| `MasteryThreshold` | 0,6 |
| `MasteryEvidenceFloor` | 6 |
| `NeutralDifficulty` | 0,55, acoplado a `engine.difficultyFromWeakness` com weakness 0,5: `0.3 + (1-0.5)·0.5` |

- `FirstEvidence`: `Correct ≥ 1`, rung **Started**.
- `EnoughForPracticing`: `Score ≥ 0.6 && Attempts ≥ 2`, rung **Consistent**.
- `EnoughForMastery`: `Score ≥ 0.6 && Attempts ≥ 6`, rung **Demonstrated**. A variedade **pontua mas não veta**. Um gate de `Instances ≥ 2` já tornou conceitos impossíveis de dominar.
- `EvidenceBand` é só apresentação: `early` (< 6 tentativas), `strong` (≥ 0,85), `consistent` (≥ 0,6), `building` (≥ 0,3), `starting`.

Medição registrada (`mastery/measure_test.go`, ADR-038) com acurácia distribuída uniformemente (**não em blocos**):

- 100%, 80% e 60% atingem MASTERED em **exatamente 6** respostas;
- 50%, 40%, 20% e 0% **nunca** atingem.

### 4.3 Máquina de estados (`machine.go`)

```go
func (m *Machine) Next(current Status, ctx TransitionCtx) Status {
    if KP definido && !KP.Completed {            // KPs pacejam a escada, não a substituem
        UNSEEN → LEARNING se KP.CurrentStreak>0 || KP.CurrentOrdinal>1
        LEARNING → PRACTICING se KP.CurrentOrdinal>1
        senão mantém
    }
    UNSEEN/LEARNING/PRACTICING: avança UM degrau se HighestRung(ev) ≥ requiredRung(current)
    MASTERED: fica
}
```

`requiredRung`: UNSEEN→Started, LEARNING→Consistent, PRACTICING→Demonstrated. **Um degrau por decisão.**

`MasteryPct(status, streak, required)` vale `min(1, (tier + min(1, streak/required)) / 3)`. Tem tier 1, 2 ou 3 para
LEARNING, PRACTICING e MASTERED/DECAYING. É monotônico na transição de tier, já que o streak volta a 1 a cada avanço.
DECAYING mantém a barra cheia: decaimento aparece **só por cor**.

### 4.4 Scaffold de Knowledge Points (`scaffold.go`)

- `RequiredKPStreak = 2`. Cita "The Math Academy Way", cap. 4 e 14.
- `Transition(correct)`:
  - um erro zera o streak do KP e, se já estava completo, **reabre o último KP**;
  - 2 corretas seguidas avançam ao próximo KP;
  - no último KP, as 2 corretas marcam `Completed`.
- `NewKPStateMachineAt(total, ordinal)` retoma a posição persistida.

> Para a nossa didática (meta 9), isto é ouro. Cada conceito é ensinado em **3 KPs com subgoals rotulados e exemplo resolvido**.
> O aluno faz 2 acertos por KP antes do próximo. Isso intercala "explica um pedaço, pratica um pouco" em vez de "explica tudo e despeja perguntas".

### 4.5 Decaimento (`status.go`)

- `EffectiveStatusFSRS(status, daysSince, stability, decayDays)`: se MASTERED e `S > 0`, vira DECAYING quando `R(t,S) < 0.9`. Sem estabilidade, usa `DecayDays = 14` (dono único da constante, ver ADR-037).
- `ReviewElapsedDays(fsrsLastReview, lastReviewed, masteredAt, lastAttempted, now)` usa o primeiro timestamp não nulo, em ordem de autoridade. O relógio de decaimento começa no momento da maestria.

### 4.6 Onde a decisão acontece (`internal/engine/engine.go:4046`, `computeGradedAttempt`)

Um único autor de mastery, chamado por todos os hosts (study, review, quiz):

1. Atualiza contadores, `AvgResponseTime` (inclui erros) e streak.
2. Atualiza **weakness**. Acerto faz `w *= 0.5`, e mais `*= 0.3` se dentro do threshold. Erro faz `w = min(1, w + 0.2)`.
3. `buildEvidenceWindow` usa as últimas tentativas **mais a atual**. Sem isso, a 1ª resposta seria julgada em janela vazia.
4. Aplica o KP state numa **cópia**. Só publica em memória depois de persistir a resposta.
5. `Machine.Next`. Se avançou e a resposta foi correta, `Streak = 1`.
6. Atualiza SM-2 e `learningSpeed` (legado; nós ignoramos).
7. Atualiza **FSRS só em revisão ou na primeira maestria**, com rating `Good` se correto e `Again` se errado. Prática não move o relógio de revisão. Um lapso põe `NextReviewDue = agora`.
8. Na maestria: `MasteredAt`, `WeaknessScore = 0`. Limpa `placement_seeded` e `is_provisional` **só** se `EnoughForMastery`.

`PropagateWeakness` (`engine.go:3653`):

- se `w > 0.3`, os dependentes recebem `max(atual, 0.3w)`;
- se `w > 0.4`, os prereqs imediatos recebem `max(atual, 0.5w)`;
- grava em lote.

`difficultyFromWeakness` dá a dificuldade servida: `d = clamp(0.3 + (1-w)·0.5, 0.3, 1.0)`. Com menos de 6 tentativas, usa 0,55.

---

## 5. Scheduler, elegibilidade e recomendação (`internal/scheduler`)

### 5.1 Elegibilidade (`eligibility.go`, `EligibilityOf`)

Estados derivados, nunca armazenados: `mastered`, `due_for_review`, `in_progress`, `unlocked`, `upcoming` (prereqs começados
mas não dominados) e `locked`.

`prereqsMet` aceita MASTERED ou DECAYING. Também aceita **placement-seeded** como alcançabilidade, sem contar como maestria.
Recusa um pré-requisito *provisional* que foi rebaixado a LEARNING.

ADR-050/051: existe uma única função de gate no servidor (`Engine.ProgressionGate` / `EligibilityOf`). A UI nunca reimplementa
a regra. Isso já foi fonte de bug: houve cinco cópias do predicado no front, e uma delas esqueceu DECAYING e re-trancou todo o
grafo a jusante.

### 5.2 Prioridade (`scheduler.go`, `computePriority` e `ComputePriorityWithContext`)

```text
p = 0.5·diasDesdeÚltimaTentativa + 0.2·(1 − min(1, streak/required)) + 0.3·weakness
  + 5                     se é revisão (DECAYING ou NextReviewDue ≤ agora)
  + 5·(1 − R(t,S))        se revisão com estabilidade FSRS
  + 4                     se MASTERED e weakness ≥ 0.35 (weaknessPracticeFloor)
  + 2                     layering: encompassa um prereq com weakness ≥ 0.6
  − 3                     compartilha InterferenceGroup com as 2 últimas tarefas
```

`buildCandidates`:

- **revisões ignoram o gate de prereq**, porque o corpus ganha arestas novas com o tempo;
- conceitos novos exigem `prereqsMet`;
- MASTERED só entra se fraco.

`buildCandidatesAdvanced` aplica interleaving: exclui o mesmo subdomínio das 2 últimas tarefas. Se isso esvaziar a lista, volta atrás.

`selectWithBalance` mantém **~30% revisão / 70% novo**. Se a razão de revisões cai abaixo de 0,3 e o topo não é revisão, pega a melhor revisão.

`NextSmart` devolve até 3 candidatos de subdomínios distintos.

Em `internal/engine/recommend.go`:

- `servedPerDayCap = 2`: um conceito é servido no máximo 2× por dia. Simulação de 30 dias com 4 perfis × 25 rodadas, medindo recall 7 dias após cada revisão: estável 0,710 vs 0,644; com dificuldade 0,493 vs 0,368.
- `Recommend` limita: `MaxRecommendations 5`, `MaxConceptNew 2`, `MaxConceptWeakness 1`, `MaxConceptResume 1`. A ordem é revisões, fraqueza, novos e retomada. Diversidade **não é forçada**.

---

## 6. FSRS-6 (`internal/fsrs`): usar `ts-fsrs` em vez de portar

Escolhas do Mathua:

- Parâmetros padrão do FSRS-6 (21 pesos): `0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542`.
- `DefaultRetention = 0.9`, `R(t,S) = (1 + F·t/S)^(−w20)` com `F = 0.9^(1/decay) − 1`. O comentário avisa que o port de referência esquecia o `−1`, o que cortava os intervalos pela metade.
- Intervalo arredondado com **RoundToEven** (o `round` do Python) e clamp em [1, 36500].
- Mean reversion de D usa `D0(Easy)` **sem clamp** (≈ −4,77).
- **Sem learning steps e sem atualização same-day.** Prática no mesmo dia não é revisão.
- Só dois ratings: `NativeRating(correct)` dá `Good` ou `Again`. Hard e Easy exigem sinal calibrado que o app não tem.
- `SeedFromInterval`: `S = intervalo SM-2` (migração).
- Vetores de referência gerados pelo `fsrs==6.3.2`, com tolerância relativa 1e-12, em `internal/fsrs/vectors_test.go` e `tools/fsrs-reference/vectors.json`.

**Para nós:** usar `ts-fsrs@6.0.0` (npm, MIT, export `./models/fsrs-6`), com `request_retention 0.9`, `enable_short_term false` e
fuzz desligado para paridade. Portar os vetores do `vectors_test.go` como teste de paridade. Bônus para a meta 4: Anki usa
o mesmo FSRS-6, então os cartões exportados podem levar `S` e `D`. Cuidado: o Mathua escolhe `max(intervaloFSRS, intervaloSM2)`
em revisões (híbrido legado). Nós devemos usar **FSRS puro**.

---

## 7. FIRe (repetição implícita) (`internal/repetition` + `internal/fire` + engine/storage)

### 7.1 Modelo contábil (`repetition/credit.go`, `allocate.go`)

- Crédito em **micro-unidades inteiras**: `Micro = 1_000_000` equivale a 1 repetição. Nunca float, para que o saldo seja reconstruível bit a bit.
- Por (aluno, conceito-alvo, **epoch**):
  - `E = RetainedUnits`, a soma dos eventos não anulados;
  - `A_b = Banked + Projected + Stale`, os ordinais criados;
  - `C = E − A_b·Micro`, o saldo fracionário.
- **Invariante: `0 ≤ C < Micro` e `A_b ≤ MaxBank (3)`.** `MaxBank` é cap **vitalício por epoch**. Projetar ou "stale" não devolve capacidade.
- `Admit(scaled)`:
  - `retained = min(scaled, capacity)`, o resto é `discarded` (não é erro);
  - banking é **derivado**: `wantBanked = floor(E/Micro)`, o que deixa um retry idempotente;
  - valida antes e depois.
- `Project()` move de banked para projected (vira data contrafactual). `Stale()` move de banked para stale (reset de epoch).
- `Allocate(candidates, capUnits)` é o cap por tentativa-fonte. Uma tentativa vale no máximo `capUnits` (= `Micro`) somando todos os alvos:
  - se `Σraw ≤ cap`, repassa;
  - senão, faz **rateio proporcional com maiores restos**, desempate por `ConceptID`, independente da ordem de entrada;
  - rejeita negativos, `raw > Micro`, duplicatas e mais de 1024 candidatos.

### 7.2 De onde vem o crédito (`internal/engine/engine.go:4313`, `allocateImplicitCreditErr`)

- Só tentativa **correta** e de fonte **`practice`**. Quiz, diagnóstico, timed quiz e retry não geram crédito.
- Alvos são os `Encompasses` **diretos** (1 salto), cada um com `RawUnits = Micro`, depois limitados a 1 repetição total pelo `Allocate`. Com 4 alvos, cada um recebe 250 000.
- Chave idempotente `attemptKey`. Um replay devolve as linhas comprometidas sem banking novo.

### 7.3 Modos (`internal/fire/mode.go`)

- `Parse(raw)` é total e fail-closed: vazio, desconhecido ou malformado vira `shadow`.
- `ParseConfig(raw, ack, cohort, allowlist)`: `active` só sai se três condições valerem juntas:
  - ack **exatamente** igual a `"I acknowledge that FIRe may apply schedule changes"`;
  - cohort não vazio;
  - escopo `all`/`*` **ou** ≥ 1 ID. Misturar `all` com IDs degrada.
- Qualquer falha resulta em `shadow` com `Degraded` explicando o motivo.
- `ActiveFor(id)`: ID vazio nunca é ativo.
- `CollectsLedger()` é true em shadow e active.
- Ativação exige **duas chaves**: env e linha durável `fire_activations` com o mesmo cohort (`docs/fire-activation.md`).
- `mathua fire report` é dry-run com checksum SHA-256 das linhas (`engine/fire.go`, `FIReDryRun`).

### 7.4 Aplicação ativa (`internal/storage/credit_apply.go`, `ApplyCredit`; `internal/engine/recommend.go`, `SatisfyImplicitReviews`)

- Ao servir questões, aplica **no máximo 1 ordinal por alvo**, com teto de 32 aplicações por chamada.
- Elegibilidade:
  - alvo MASTERED ou DECAYING;
  - não placement e não provisional;
  - tem data de revisão e ela **já venceu** (`not_due` em caso contrário);
  - ordinal banked existe;
  - baseline da data igual à atual (`stale_baseline`).
- Efeito: aplica uma revisão FSRS **Good** implícita (novo S e D, `next = max(due, now, lastReviewed) + Interval(S')`, cap 36500 dias), marca o ordinal `projected` e grava `implicit_credit_applications`. Tudo numa transação serializada, com `UPDATE ... WHERE next_review_due IS ?` (CAS).
- **Nunca** concede XP nem altera evidência, mastery, streak ou placement.

### 7.5 Diferenças em relação ao FIRe "verdadeiro" do Math Academy (armadilha conceitual)

O Mathua é "FIRe-inspired":

- crédito uniforme, sem peso fracionário por aresta de encompassing;
- **1 salto**, sem transitividade com decaimento;
- **sem penalidade** que flua para pré-requisitos quando a tarefa avançada falha;
- teto de 3 por epoch;
- produção roda em **shadow**.

No nosso port, estender `Candidate.rawUnits = round(Micro · w_edge · decay^hop)`, mantendo o `Allocate` e as invariantes inteiras.

---

## 8. Economia de XP (`internal/xp/policy.go`)

- Definição: **XP ≈ 1 por minuto esperado de trabalho focado**.
- `EffortBase(thresholdSec, difficulty) = clamp(round(thresholdSec/60 · (0.5 + difficulty)), 1, 5)`. `BaseDifficulty` é sempre 0,5, então em geral é `round(threshold/60)` limitado a [1, 5].
- `PerformanceMultiplier`: 1,1 se `elapsed ≤ threshold`, senão 1,0. **Documentado como inócuo no inteiro**: `int(base·1.1) == base` para base 1–5.
- `Award(correct, …)`: erro vale 0. Acerto vale `int(base·mult)`. Sem bônus de streak e sem bônus de velocidade (ADR-020 e o comentário do pacote).
- Rush: `RushPenalty = −5` quando há `RushAfter = 2` respostas erradas em menos de `RushSeconds = 2.0` s.
- Metas: `DefaultDailyGoal 30`, faixa [10, 100]. `QuizGateXP 50` (mastery check a cada 50 XP). Timed quiz a cada 150 XP.
- `ExpectedXP(p, …) = Award(true, …)·p`. O estimador nunca usa o valor de face.
- Medição do próprio repo: 490 de 666 conceitos valiam 1 XP, então o corpus pagava ~1,65 XP por minuto real. Conceitos de 6 s ficavam 10× sobreprecificados. Para nós (aulas longas, vídeos, capítulos), **o clamp 1–5 não serve**. Precificar por minuto esperado com teto maior e dar XP também para consumo ativo de aula, que o Mathua não faz.

### 8.1 Accountability (`internal/xp/accountability.go` e `docs/architecture/xp-accountability.md`)

Dois eixos independentes. Ambos escrevem **só** no ledger `xp_events (student_id, amount, reason, event_key UNIQUE(student_id, event_key), created_at)`.
Nunca tocam mastery, FSRS ou evidência.

**Esforço** (`Evaluate`) pode agir antes de a tarefa terminar. Defaults (`DefaultConfig`):

| Parâmetro | Default |
|---|---|
| `FastAnswerSeconds` | 1,5 |
| `MinTaskAttempts` | 4 |
| `MinFastWrong` | 3 |
| `MinSameWrong` | 3 (em < `SameWrongSeconds` 5 s) |
| `FarmingWindow` | 20 min |
| `FarmingMinCorrect` | 40 acertos em < 1,0 s em material já dominado |
| `EscalationWindow` | 14 dias |
| Penalidade por nível 0, 1, 2+ | 1, 2, 3 XP |
| Bônus | desligado (`EnableBonus` false) |

Ordem de avaliação:

1. Diagnóstico isento.
2. Penalidade legada de rush já aplicada: não empilha.
3. Farming.
4. Fast-wrong.
5. Churn de mesma resposta errada sem nenhum acerto.
6. Dificuldade genuína (0 acertos e `maxDiff ≥ 0.7`): sem penalidade.
7. Bônus opcional.

"Não sei" (`DontKnow`) nunca conta como chute.

**Performance** (`EvaluatePerformance`) só atua com `TaskComplete`. Calcula `ratio = acertos / Σ prior(difficulty)`.
O prior é calibrado em dados de produção do Mathua (de 2026-11-06): `<0.35 → 0.83`, `<0.50 → 0.89`, `<0.575 → 0.944`, `<0.70 → 0.85`, demais `0.872`, desconhecida `0.50`.

| Condição | Resultado |
|---|---|
| `ratio ≥ 0.8` | XP integral |
| `[0.5, 0.8)` com `expected ≥ 2` | remove 25% do XP ganho (mínimo 1) |
| `< 0.5` com `expected ≥ 2` | remove todo o XP da tarefa |
| `< 0.2` com ≥ 6 tentativas e `expected ≥ 2.5` | remove o XP mais 2 extras (pode ficar **negativo**) |
| Tarefa difícil (`maxDiff ≥ 0.7`) | nunca recebe a penalidade extra (proteção) |

`Combine(effort, performance)` nunca cobra duas vezes. A dedução de esforço tem prioridade. Rush legado e dificuldade genuína suprimem a performance.

Invariantes do ledger:

- `Net = Gross + ajuste real`;
- o XP vitalício **pode ficar negativo**;
- replay aplica 0 (o `event_key` já existe);
- a explicação ao aluno usa o valor **aplicado**, nunca o calculado.

> Para um app single-user de autoestudo, recomendo **manter o ledger e a idempotência, mas desligar as deduções negativas
> por padrão** (`Config.Disabled` ou `PenaltyFirst/Repeated/Persistent = 0`). O incentivo a "explorar" só existe contra
> ranking, e para a meta 9 uma penalidade pública é ruído. O prior por dificuldade precisa ser **recalibrado com os nossos
> dados**, porque o do Mathua mede o gerador de matemática dele.

---

## 9. Ligas, leaderboard e níveis

### 9.1 Ligas (`internal/storage/league.go`, `league_sqlite.go`; `internal/leaderboard/leagues.go`)

| Constante | Valor |
|---|---|
| Tiers | `bronze, silver, gold, platinum, diamond`. Diamond é o teto e o topo fica. |
| `LeagueSize` | 30. As ligas enchem até 30 antes de abrir outra, e a última pode ser curta. |
| `moversFor(n)` | `n < 6 ? 0 : min(5, floor(n/3))`. Promoção e rebaixamento são disjuntos sem caso especial. |
| Semana | segunda 00:00 **UTC** (`WeekStart`). |

**O README diz "top 2", mas o código promove até 5. Vale o código.**

Algoritmo:

- `planWeek(cohorts)` é puro e determinístico. Ordena por XP desc, nome asc e id asc. Os `i < k` sobem, os `i ≥ n−k` descem, e a movimentação é registrada como `up`, `down`, `stay` ou `new`.
- `cutCohorts(tier, members)` ordena e fatia em ligas de 30, com `LeagueNo` reiniciando por tier.
- `ResolveLeagueWeek(week, prevFrom, prevTo)` é **idempotente por marcador**. A primeira instrução é `INSERT INTO league_weeks ... ON CONFLICT DO NOTHING`: se já existia, retorna. Depois disso, numa transação:
  1. lê as coortes da semana anterior com o XP somado do ledger na janela;
  2. finaliza `xp`/`rank` históricos;
  3. aplica `planWeek`, reagrupa por tier e insere as novas cadeiras.
- Na primeira semana, `bootstrapLeagues` semeia por XP vitalício, todos em bronze.
- Gatilho: roda **na leitura** (o primeiro leitor da semana fecha a anterior). Não há cron.
- `EnsureLeagueMembership` entra o aluno em bronze quando ele passa a ter XP.
- `rankInCohort`: empates compartilham rank (1, 1, 3).

Privacidade em `leaderboard/compute.go`:

- modos `named`, `anonymous` e `hidden`;
- `anonymousIdentity` faz SHA-256 de `"mathua-anon-v1:"+id` para gerar adjetivo, substantivo e número;
- `PublicID` é o username ou `learner-<sha256[:4]>`;
- boards `weekly`, `monthly` e `all_time` com páginas de 25.

### 9.2 Níveis (`internal/levels/levels.go`)

São 9 títulos por **número de conceitos dominados**, em degraus de 32: Novice 0, Apprentice 32, Student 64, Scholar 96, Adept 128, Expert 160,
Master 192, Grandmaster 224, Math Architect 256. É trivial e insuficiente para 1000–1500 h.

### 9.3 O que falta para a meta 5 (Monte Carlo)

O Mathua **não usa Monte Carlo** para ranks. Ele usa simulação só para calibrar `servedPerDayCap` e o custo de mastery.
Proposta para nós, aproveitando as peças dele:

1. **Kernel de simulação**: um aluno sintético com acurácia por conceito `p ~ Beta`, tempo `~ LogNormal(threshold)` e minutos por dia. Ele roda nosso scheduler (§5), `BuildEvidence` (§4) e `Award` com accountability (§8) por N dias sobre o DAG real do domínio.
2. Com M = 10⁴ trajetórias, gerar a distribuição de XP/semana e de conceitos dominados por semana **condicionada ao nível atual**, isto é, à profundidade da fronteira ou à unidade (§3.3).
3. **Níveis** passam a ser quantis da curva de XP acumulado esperada para 1000–1500 h. Por exemplo, o nível L é atingido quando o XP passa o quantil 50 de L·Δt horas. Assim "ganhos compatíveis com o nível" saem por construção.
4. **Ligas single-user**: para cada tier, amostrar 29 "fantasmas" do quantil correspondente da distribuição MC (bronze p0–20, prata p20–40 …), condicionados ao nível do aluno. Depois aplicar exatamente `planWeek`/`moversFor`. É determinístico com seed por semana e reproduzível.

---

## 10. Diagnóstico CAT (`internal/diagnostic/cat.go`, 1339 linhas, mais `report.go`)

Para colocação inicial por domínio, por exemplo "já sei inglês B1" ou "já sei Ohm/Kirchhoff".

Constantes:

| Constante | Valor |
|---|---|
| `minTotalQuestions` | 25 (ponto em que a convergência é considerada, não piso) |
| `maxTotalQuestions` | 45 |
| `coverSize` | 30 |
| `beliefThreshold` | 0,6 ("conhecido") |
| `confidenceThreshold` | 0,7 |
| `evidenceCorrectWeight` / `evidenceIncorrectWeight` | 0,3 / 0,3 |
| `conflictDiscount` | 0,5 |
| `conditionalStripFactor` | 0,8 |
| `maxSupplementalProbes` | 1 |

**Cobertura comprimida** (`graphCover(order, 30)`), sobre o fecho de pré-requisitos do escopo:

1. Todas as raízes.
2. Todas as folhas.
3. Para 3 tiers de profundidade (`maxDepth·t/4`), o nó mais próximo do tier **por subdomínio**.
4. Completa com amostragem uniforme por passo.
5. Se passar de 30, mantém as raízes e reamostra o resto uniformemente.
6. Ordena pela ordem topológica.

**Parâmetros 2PL heurísticos** (não calibrados, derivados do DAG) em `ItemParameters`:

```text
a = clamp(1 + 0.15·min(6, #prereqs + #dependents) + 0.25·[tem key_prereq] + 0.25·[tem encompasses], 0.8, 2.5)
b = (depth(c) − depthDaFronteira)/3 + clamp((avgTimeSeconds − 25)/50, −0.4, 0.4) + 0.25·(probes−1)   → clamp ±3
P = 1/(1+e^(−a(θ−b)));  I = a²P(1−P)
```

**Escolha da próxima questão**:

- `prerequisiteGapLocked`: depois de um erro já "assentado", desce **uma aresta** para o prereq não assentado de maior ganho;
- senão, `pickByInfoGain` com `ganho = H(belief) · influence · (1 + 0.2·I(θ))`, onde `influence = 1 + 0.25·(#vizinhos no cover) + 2.5 se o conceito está no foco escolhido pelo aluno`;
- sem cover restante, `supplementalDiagnostic` (re-sonda a fronteira com confiança < 0,7, uma vez);
- dificuldade do item por sonda: 0,3, depois 0,6, depois 0,8.

**Atualização** (`recordTimed`):

```text
slow = elapsed > 4·thr ? 0.25 : elapsed > 2·thr ? 0.5 : 1
correto: b += 0.35·slow·(1−b); se rápido (elapsed < thr): b += 0.1·(1−b)
errado:  b *= 0.55                                  ; clamp [0.05, 0.95]
propagação correto  → ancestrais à distância d: b += 0.3·slow·0.8^(d−1)·(1−b)·0.5 (cap .95); conf = max(conf, min(.65, conf + .15·0.8^(d−1)·slow))
propagação errado   → descendentes: b *= 1 − 0.3·0.5·0.8^(d−1) (piso .05); ancestrais com b∈[0.6,0.75): b *= 0.8 ("conditionally completed" cai)
θ: MAP Newton-Raphson (5 iter, prior N(0,1)), f' = −θ + Σa(u−P), f'' = −1 − Σa²P(1−P), u = 1 (ou .75/.6 se lento), clamp ±3.5; SE = 1/√(ΣI+1)
confiança = min(1, probes·0.5); assentado após 2 sondagens; parar: ≥45 perguntas ou (cover assentado e ≥25)
```

Extras:

- "Erro bobo": `RetryServe` permite uma vez. A tentativa é elegível se a crença anterior era ≥ 0,7, se a próxima questão é mais rasa, ou se era a 1ª sonda. Restaura o snapshot de crenças.
- "Não sei" é evidência negativa limpa, nunca "rápido".
- `SettleCurrent` pula questão quebrada.

**Relatório** (`report.go`):

- `FrontierIdx` e `FrontierLabel`: maior índice com `b ≥ 0.6`;
- `GapsByDomain`: `b < 0.6` e `conf ≥ 0.7`;
- `InsufficientEvidenceByDomain`;
- `UnassessedByDomain`;
- `ConditionallyCompleted`: `b ∈ [0.6, 0.75)`;
- θ e SE.

**Aplicação da colocação** (ADR-008 e ADR-051):

- semeia **só linhas UNSEEN**, como PRACTICING/LEARNING com `placement_seeded = true`;
- é **alcançabilidade**, nunca MASTERED, e não gera XP nem entra no gate de quiz;
- o pré-requisito "provisional" que o aluno não sustenta volta a LEARNING e bloqueia.

---

## 11. Governança: ADRs pedidas e expansão em waves

### 11.1 ADRs (resumo do que importa)

- **ADR-008: "Placement never destroys mastery".** A colocação só semeia conceitos UNSEEN.
- **ADR-037: "Mastery is an exit, and decay is not a return to class".**
  - Decaído vai para revisão (`/review`), nunca para a aula.
  - Um único predicado `countsAsMastered` (MASTERED ∪ DECAYING).
  - `DecayDays` tem um único dono.
  - A barra de progresso mede o tier, não o streak.
  - Decaimento aparece só por cor.
  - Fica pendente `tier_attained_at`, para espaçamento dentro da aquisição.
- **ADR-038: "Mastery is decided by evidence".**
  - Substituiu o gate de 30 acertos seguidos (4,2% de chance com 90% de acurácia) pela escada de evidência.
  - Piso de 6 tentativas. Variedade é peso, não veto.
  - `attempts.difficulty` passou a ser persistido.
  - Um único `applyGradedAttempt`.
  - Lição registrada: "o período de uma sonda não é o modelo" (a sonda em blocos fabricou um achado).
- **ADR-046: "A mastery assessment verifies evidence; it does not write mastery".**
  - O "gate de 50 XP" não tinha PASS/FAIL. O ADR o tornou agendamento obrigatório (409), não avaliação.
  - A seleção do quiz exclui MASTERED/DECAYING: aquisição ≠ retenção.
  - O relógio do servidor é autoritativo e usa `max(servidor, cliente)`.
  - `retake_available` é computado.
- **ADR-050: "A mastery unit is a named partition of the existing DAG, and a pass adds evidence without setting mastery".**
  - Unidade é partição, não segunda hierarquia.
  - Pré-requisitos de unidade são derivados.
  - Armazenam-se só `assessment_required` e `remediation_required`. Os outros 5 estados são derivados.
  - `ProgressionGate` é a autoridade única.
  - Ficam em aberto o limiar de aprovação, a heurística de prontidão e a quantidade de remediação.
- Relacionadas:
  - **ADR-020**: economia de prêmios pequenos.
  - **ADR-051**: diagnóstico é alcançabilidade.
  - **ADR-055**: IA como *registro de políticas declaradas*. Cada provedor declara `DataClass`, permissão de produção, `Retention`, `Source` e dev-only. `Select` filtra por política. `RetentionUnknown` é tratado como o pior caso. As regras anti-"resolver o exercício" vão **depois** do histórico. Saída em texto puro e KaTeX com `trust:false`. As URLs só saem de tabela do servidor (`[[id]]`). Isto é relevante para a nossa meta 7: **escolha de modelos sem hardcode = registry por política**.

### 11.2 Processo de waves (`docs/content-expansion.md` §2, §5.5, §6; `docs/expansion-waves/wave-1…11-*.md`)

Pipeline de 9 estágios, cada um com dono e guarda:

1. nó (`validate_graph`);
2. enrichment;
3. gerador (self-check: aceita a própria resposta e rejeita vazio; fuzz; ratchet de variedade do pool);
4. lição (`audit_lessons.py`);
5. KP shard (a `section` precisa existir na lição);
6. solution schema (domínios escolares);
7. diagrama;
8. curso (`TestAllCoursesResolve`);
9. contagens documentadas (`counts.py --check`).

Cada wave tem 50 conceitos e 3 documentos.

**`wave-N-candidates.md`**:

- tabela de alocação por domínio (Now, Target, Add);
- candidatos `id | label | família`;
- ids e labels normalizados checados contra o corpus;
- prereqs **deliberadamente deixados para a autoria**, porque "uma aresta chutada é pior que uma ausente";
- ordem de revisão: os **10 primeiros** primeiro.

**`wave-N-proposal.md`** traz o porquê, o curso alvo, os gates e as alternativas rejeitadas. Exemplo da wave 11, domínio Optimization: aprofundar domínios existentes, ou outro domínio novo, ou 100 de uma vez (que "não seria piloto").

**Contrato por conceito**:

- 3 famílias de questão alinhadas às 3 seções;
- ≥ 5 questões distintas por ordinal em 12 sorteios (meta de projeto: 20 em 200);
- **recomputação independente** da resposta a partir dos `Facts`;
- inspeção manual das 150 famílias;
- lição > 1 KB com 1 H1 e exatamente 3 H2;
- shard com 3 entradas × 3 subgoals;
- target de curso deliberado (alcançabilidade);
- `key_prerequisites` (para não derrubar o piso de 80%);
- band 3 mantido.

**Baseline aditivo congelado** (`scripts/check_additive.py` e `data/expansion-baseline.json`):

- uma wave não pode remover conceito, mudar domínio, **remover aresta de prereq** ou remapear lição;
- baselines de qualidade só encolhem;
- "um baseline nunca é alargado para esconder falha nova".

**`wave-N-review.md`** registra métricas de defeito:

- Wave 1: 5 defeitos matemáticos e 12 de apresentação em 50 conceitos.
- Wave 11: 9 famílias com resposta errada que o teste aceitava, porque só parseava o número, e uma retratação explícita de "todas recomputadas".
- Singletons de unidade antes e depois.
- Decisão de autorizar a próxima wave.

`scripts/scaffold-wave.py` valida o manifesto (id, label, 3 seções, 3 KPs, grading type, prereqs existentes ou anteriores na mesma wave, limite pela tabela de targets). **Nunca edita o corpus**: só gera rascunhos.

---

## 12. Mapeamento para as metas do nosso app

| Meta | O que o Mathua entrega | O que temos de criar |
|---|---|---|
| 1. Grafo massivo, aulas por nó, expansão procedural com lógica formal | Schema rico do nó (prereq, encompasses, key_prereq, interferência, 3 KPs com subgoals). Validador com invariantes. Depth e bandas (unidades = regiões, onde ancorar livros). Fecho por targets. Governança aditiva de waves. Layout 3D determinístico de 5k nós. | Gatilhos de expansão e o **proponente LLM**: candidatos em JSON → validador determinístico → piloto parcial → juiz LLM + verificador → métricas. Mídia por nó/região (YouTube PT/EN, capítulos). Domínios não-matemáticos. Especificação formal (§15). |
| 2. Memória de contexto | O modelo do aluno estruturado é a "memória dura": status, evidência, weakness propagada, FSRS S/D, KP ordinal, placement/provisional, fronteira, gaps do diagnóstico, cursos-alvo. | Um "digest" compacto injetado no agente (fronteira, top-k fraquezas, revisões vencidas, condicionalmente completos, próximo target), combinado com a memória LLM SOTA de outro relatório. |
| 3. Sessões por domínio | Nada. É um corpus e um aluno. | A chave de todo estado vira `(learnerId, domainId)`. Prereqs cross-domain (Eletrônica → Matemática do Mathua) contam como alcançabilidade, lidos do estado do outro domínio. |
| 4. Flashcards | FSRS-6 de referência, só Again/Good por acerto. | `ts-fsrs` mais export para Anki (FSRS-6 nativo no Anki) ou Obsidian. Os cartões nascem dos KPs e subgoals do nó ao fim da sessão. |
| 5. Nível, XP e ranks MC | Política de XP, accountability, ledger idempotente, ligas determinísticas. | Kernel de Monte Carlo, níveis por quantis, fantasmas calibrados (§9.3). |
| 6. Stats | Padrão de ledger com `event_key` único e "calculado vs aplicado". | Ledger de tokens por modelo e de horas por dia com o mesmo padrão. |
| 7. IA via assinatura, sem hardcode | ADR-055 (registry por política declarada, failover, cotas). | Já existe no learnharness (`src/agent/models.ts`, `subscription-*`). Só adotar o padrão "policy registry". |
| 9. Didática | 3 KPs × 2 acertos. Primeiro acerto já sai de UNSEEN. Sem "purgatório de tutorial" para dominados. `servedPerDayCap 2`. Interleaving por subdomínio e interferência. 70/30 novo/revisão. | Usar o ritmo KP no prompt do `teacher-agent`: uma explicação curta por KP, depois 1–2 itens, depois o próximo KP. |

---

## 13. Arquivos exatos a copiar/adaptar

Caminhos de origem relativos a `_refs/extra/chuma-beep__mathua/`. Destino proposto no learnharness, que segue o padrão
*pure core + ports* de `src/core/*.ts` e `src/core/ports.ts`.

| # | Origem | Ação | Destino sugerido |
|---|---|---|---|
| 1 | `internal/concepts/concepts.go` | portar (tipos + DAG + `Available`) | `src/core/mastery-engine/dag.ts`, tipos em `src/core/contracts/mastery.ts` |
| 2 | `internal/concepts/loader.go` (`validate`, `build`, `mergeEnrichment`) | portar validação e Kahn. Trocar `os.ReadFile` por ports. **Generalizar** `GradingType` para enum por domínio e tornar os pisos de densidade configuráveis por domínio. | `src/core/mastery-engine/dag-validate.ts` |
| 3 | `internal/concepts/labels.go` | portar inteiro | `src/core/mastery-engine/labels.ts` |
| 4 | `internal/concepts/mastery_units.go` | portar `ConceptDepths`, `BuildMasteryUnitDraft`, `DerivedUnitPrereqs`, `ValidateMasteryUnits`, `BackwardBandEdges`. `SubdomainDepths` é opcional (diagnóstico). | `src/core/mastery-engine/units.ts` |
| 5 | `internal/mastery/evidence.go` | portar inteiro | `src/core/mastery-engine/evidence.ts` |
| 6 | `internal/mastery/machine.go` | portar `Next`, `HighestRung`, `MasteryPct`. **Não** portar `SM2Quality`. | `src/core/mastery-engine/ladder.ts` |
| 7 | `internal/mastery/scaffold.go` | portar inteiro | `src/core/mastery-engine/kp-scaffold.ts` |
| 8 | `internal/mastery/status.go` | portar com `ts-fsrs` para a retrievability | `src/core/mastery-engine/decay.ts` |
| 9 | `internal/fsrs/*` | **não portar**. Usar `ts-fsrs@6.0.0`. Portar só os vetores de `internal/fsrs/vectors_test.go` e `reference_vectors_test.go` como teste de paridade. | `tests/mastery-fsrs-parity.test.ts` |
| 10 | `internal/repetition/allocate.go`, `credit.go` | portar inteiro, com `number` inteiro e asserts `Number.isSafeInteger` | `src/core/mastery-engine/fire-ledger.ts` |
| 11 | `internal/repetition/advance.go` | **pular** (é SM-2) | n/a |
| 12 | `internal/fire/mode.go` | portar (modos + fail-closed). As settings vêm do nosso config, não de env. | `src/core/mastery-engine/fire-mode.ts` |
| 13 | `internal/engine/engine.go:4313-4372` (`allocateImplicitCreditErr`), `internal/storage/credit_apply.go:113-186` (`creditReasonEligible`, `creditNextState`), `internal/engine/recommend.go:44-130` (`SatisfyImplicitReviews`) | **adaptar** a lógica, reescrevendo o storage | `src/core/mastery-engine/fire-apply.ts` |
| 14 | `internal/scheduler/eligibility.go` | portar inteiro | `src/core/mastery-engine/eligibility.ts` |
| 15 | `internal/scheduler/scheduler.go` (`buildCandidates`, `buildCandidatesAdvanced`, `computePriority`, `ComputePriorityWithContext`, `layeringBonus`, `effectiveState`, `prereqsMet`, `selectWithBalance`, `NextSmart`, `NextReview`, `DueReviewCount`) | portar. Remover `AdvanceSnapshotInterval` (SM-2). Injetar RNG com seed. | `src/core/mastery-engine/scheduler.ts` |
| 16 | `internal/scheduler/recommend.go` | portar `Recommend` e os caps | `src/core/mastery-engine/recommend.ts` |
| 17 | `internal/engine/engine.go:4046-4276` (`computeGradedAttempt`), `:3653-3700` (`propagateWeakness`), `:666` (`difficultyFromWeakness`), `:3510` (`weaknessMapFromProgress`) | **adaptar**: é o coração da integração | `src/core/mastery-engine/grade.ts` |
| 18 | `internal/xp/policy.go` | portar, **recalibrando** `EffortBase` (teto e itens de aula) | `src/core/mastery-engine/xp-policy.ts` |
| 19 | `internal/xp/accountability.go` | portar inteiro. Defaults com deduções negativas desligadas. | `src/core/mastery-engine/xp-accountability.ts` |
| 20 | `internal/storage/league.go` (`LeagueTiers`, `moversFor`, `planWeek`, `cutCohorts`, `leagueOrder`, `rankInCohort`, `nextTier`) | portar as partes puras | `src/core/mastery-engine/leagues.ts` |
| 21 | `internal/storage/league_sqlite.go` (`ResolveLeagueWeek`, `bootstrapLeagues`, `EnsureLeagueMembership`) | **adaptar** a semântica (marcador idempotente) para o nosso store | `src/store/leagues.ts` |
| 22 | `internal/leaderboard/compute.go`, `period.go` | portar `WeekStart` e `ResolvePeriod` com **timezone local**. `anonymousIdentity` é opcional. | `src/core/mastery-engine/periods.ts` |
| 23 | `internal/levels/levels.go` | substituir por níveis calibrados via MC | `src/core/mastery-engine/levels.ts` |
| 24 | `internal/diagnostic/cat.go`, `report.go`, `estimates.go` | portar. Trocar `generator.Registry` por um provedor de itens (LLM + verificador). Determinizar `graphCover`. | `src/core/mastery-engine/diagnostic.ts` |
| 25 | `internal/planning/planner.go` (`collectChain`), `estimate.go` (`EstimateWorkload`) | portar fecho e estimativa | `src/core/mastery-engine/planning.ts` |
| 26 | `web/next-app/lib/progress.ts` | copiar quase literal | `lib/mastery-progress.ts` |
| 27 | `web/next-app/scripts/layoutDAG3D.ts` | copiar e adaptar (215 linhas, sem deps) | `lib/graph-layout-3d.ts` |
| 28 | `scripts/scaffold-wave.py`, `scripts/check_additive.py` | **reimplementar em TS** como validador do pipeline de expansão. Ler, nunca executar. | `src/core/mastery-engine/expansion-validate.ts` |
| 29 | `docs/expansion-waves/*`, `docs/content-expansion.md`, ADRs 037/038/046/050/051/055 | referência de processo | `docs/` (citar) |

---

## 14. Esboços TS dos núcleos (para implementar sem reler a fonte)

### 14.1 Evidência e escada

```ts
// src/core/mastery-engine/evidence.ts  (port de internal/mastery/evidence.go — MIT © 2025 Wisdom Chukwuemeka)
export const EVIDENCE_WINDOW = 6, MASTERY_THRESHOLD = 0.6, MASTERY_EVIDENCE_FLOOR = 6, NEUTRAL_DIFFICULTY = 0.55;
export interface Attempt { correct: boolean; elapsed: number; difficulty?: number | null; instance: string }
export interface Evidence { score: number; attempts: number; correct: number; instances: number;
  avgDifficulty: number; medianSeconds: number; recentWeightedAccuracy: number }
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export function buildEvidence(all: Attempt[], timeThreshold: number): Evidence {
  const w = all.slice(-EVIDENCE_WINDOW), n = w.length;
  const ev: Evidence = { score: 0, attempts: n, correct: 0, instances: 0, avgDifficulty: 0, medianSeconds: 0, recentWeightedAccuracy: 0 };
  if (n === 0) return ev;
  let num = 0, den = 0;
  w.forEach((a, i) => { const wt = 0.5 + (i / Math.max(1, n - 1)) * 0.5; den += wt; if (a.correct) num += wt; });
  ev.recentWeightedAccuracy = num / den;
  const ok = w.filter(a => a.correct); ev.correct = ok.length;
  const diffs = ok.map(a => a.difficulty).filter((d): d is number => d != null);
  if (diffs.length) ev.avgDifficulty = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  ev.instances = new Set(ok.map(a => a.instance).filter(Boolean)).size;
  const t = ok.map(a => a.elapsed).sort((a, b) => a - b);
  if (t.length) ev.medianSeconds = t[Math.floor(t.length / 2)];           // mediana "superior", igual ao Go
  const dTerm = 0.6 + 0.4 * clamp(diffs.length ? ev.avgDifficulty : NEUTRAL_DIFFICULTY, 0.3, 1);
  const variety = Math.min(0.15, 0.05 * Math.max(0, ev.instances - 1));
  const timeFactor = timeThreshold > 0 && ev.medianSeconds > timeThreshold ? 0.8 : 1;
  ev.score = clamp((ev.recentWeightedAccuracy * dTerm + variety) * timeFactor, 0, 1);
  return ev;
}
export const enum Rung { None, Started, Consistent, Demonstrated }
export const highestRung = (e: Evidence): Rung =>
  e.score >= MASTERY_THRESHOLD && e.attempts >= MASTERY_EVIDENCE_FLOOR ? Rung.Demonstrated
  : e.score >= MASTERY_THRESHOLD && e.attempts >= 2 ? Rung.Consistent
  : e.correct >= 1 ? Rung.Started : Rung.None;
```

### 14.2 Ledger FIRe

Números são seguros: `raw·cap ≤ 10¹²` e `Σraw ≤ 1,024·10⁹`, ambos abaixo de 2⁵³. Não precisa de `bigint`.

```ts
export const MICRO = 1_000_000, MAX_BANK = 3, MAX_CANDIDATES = 1024;
export interface Counts { banked: number; projected: number; stale: number }
export interface Account { retainedUnits: number; ordinals: Counts }
const total = (c: Counts) => c.banked + c.projected + c.stale;
export const balance = (a: Account) => a.retainedUnits - total(a.ordinals) * MICRO;
export function validate(a: Account) {
  if (a.retainedUnits < 0) throw new Error("negative credit");
  if (total(a.ordinals) > MAX_BANK) throw new Error("bank limit");
  const c = balance(a); if (c < 0 || c >= MICRO) throw new Error(`balance out of range: ${c}`);
}
export function admit(a: Account, scaled: number) {
  if (!Number.isSafeInteger(scaled) || scaled < 0 || scaled > MICRO) throw new Error("bad credit");
  validate(a);
  const retained = Math.min(scaled, Math.max(0, MAX_BANK * MICRO - a.retainedUnits));
  const next: Account = { retainedUnits: a.retainedUnits + retained, ordinals: { ...a.ordinals } };
  const want = Math.floor(next.retainedUnits / MICRO);                 // banking DERIVADO ⇒ idempotente
  if (want > total(a.ordinals)) next.ordinals.banked += want - total(a.ordinals);
  validate(next);
  return { next, retained, discarded: scaled - retained };
}
export function allocate(cands: { conceptId: string; rawUnits: number }[], cap: number) {
  // validações: ≤1024, raw∈[0,MICRO], ids únicos, cap∈[0,MICRO]
  const totalRaw = cands.reduce((s, c) => s + c.rawUnits, 0);
  if (cap === 0 || totalRaw === 0) return [];
  const byId = [...cands].sort((x, y) => (x.conceptId < y.conceptId ? -1 : x.conceptId > y.conceptId ? 1 : 0)); // NÃO localeCompare
  if (totalRaw <= cap) return byId.filter(c => c.rawUnits > 0).map(c => ({ conceptId: c.conceptId, units: c.rawUnits }));
  const shares = byId.map(c => { const p = c.rawUnits * cap; return { conceptId: c.conceptId, units: Math.floor(p / totalRaw), rem: p % totalRaw }; });
  let left = cap - shares.reduce((s, x) => s + x.units, 0);
  shares.sort((x, y) => y.rem - x.rem);                                // sort estável (ES2019) = SliceStable
  for (let i = 0; i < shares.length && left > 0; i++, left--) shares[i].units++;
  return shares.filter(s => s.units > 0).map(({ conceptId, units }) => ({ conceptId, units }))
    .sort((x, y) => (x.conceptId < y.conceptId ? -1 : 1));
}
```

Extensão sugerida para crédito transitivo ponderado:

```text
rawUnits(alvo) = round(MICRO · Π w_aresta · 0.5^(hop−1))
```

Somar por alvo antes do `allocate`, com cap de 1 repetição por tentativa.

### 14.3 Ligas

```ts
export const TIERS = ["bronze", "silver", "gold", "platinum", "diamond"] as const;
export const LEAGUE_SIZE = 30;
export const movers = (n: number) => (n < 6 ? 0 : Math.min(5, Math.floor(n / 3)));
const order = <T extends { xp: number; name: string; id: string }>(m: T[]) =>
  m.sort((a, b) => b.xp - a.xp || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
export function planWeek(cohorts: { tier: Tier; members: Member[] }[]) {
  const tierOf = new Map<string, Tier>(), moveOf = new Map<string, "up" | "down" | "stay">();
  for (const c of cohorts) { const ms = order([...c.members]); const k = movers(ms.length);
    ms.forEach((m, i) => { const d = k > 0 && i < k ? 1 : k > 0 && i >= ms.length - k ? -1 : 0;
      const to = TIERS[clampIdx(TIERS.indexOf(c.tier) + d)]; tierOf.set(m.id, to);
      moveOf.set(m.id, to === c.tier ? "stay" : TIERS.indexOf(to) > TIERS.indexOf(c.tier) ? "up" : "down"); }); }
  return { tierOf, moveOf };
}
// cutCohorts(tier, members): order(members) e fatia de 30 em 30, leagueNo = 1..; rankInCohort: empates → 1,1,3.
```

### 14.4 Accountability

Port literal de `Evaluate`, `EvaluatePerformance`, `Combine`, `penalize` e `difficultyCorrectPrior`. Todas as decisões
viram linhas `xpEvents {learnerId, domainId, amount, reason: "accountability:<code>", eventKey: "<taskId>", createdAt}` com
unicidade `(learnerId, eventKey)`.

---

## 15. Lógica de evolução formalmente correta (Lean 4 / propriedades)

As invariantes do Mathua são simples e se prestam a **testes de propriedade** (`fast-check`) e, se quisermos, a uma especificação Lean 4
pequena. Sugestão de "contrato formal" do grafo e do aluno:

1. **Aciclicidade:** o Kahn sobre `prereq ∪ encompasses` processa todos os nós.
2. **Expansão aditiva**, com `G_old ⊆ G_new`:
   - `V_old ⊆ V_new`;
   - as arestas de prereq antigas são preservadas;
   - domínio e lição dos antigos ficam inalterados;
   - todo nó novo tem prereqs em `V_old ∪ (novos anteriores na wave)`.
   - Ver `scripts/check_additive.py` e `scaffold-wave.py`.
3. **Fecho alcançável:** todo nó pertence ao fecho de algum target de curso (a cobertura que §4.1 de `content-expansion.md` exige).
4. **Partição de unidades:**
   - cada nó está em exatamente uma unidade;
   - `band(prereq) ≤ band(nó)`, garantido por construção ao usar depth por conceito.
5. **Monotonicidade do aluno:**
   - `status` nunca regride (a ordem UNSEEN < LEARNING < PRACTICING < MASTERED);
   - `MasteryPct` não decresce;
   - placement nunca sobrescreve não-UNSEEN.
6. **Estabilidade sob expansão** (novo, não coberto pelo Mathua): se uma expansão adiciona um prereq novo `p` a um nó `c` que o aluno já dominou ou iniciou, `p` deve ser tratado como **placement-seeded** para esse aluno. Sem isso, a expansão re-tranca o aluno. O Mathua contorna apenas para revisões ("revisões ignoram o gate").
7. **Ledger FIRe:**
   - `0 ≤ C < Micro`;
   - `A_b ≤ MaxBank`;
   - `Σ allocate ≤ cap`;
   - `allocate` independe da ordem;
   - `admit` é idempotente sob replay (banking derivado).
8. **Ligas:**
   - `2·movers(n) ≤ n` (promoção e rebaixamento disjuntos);
   - `planWeek` é determinístico;
   - `ResolveLeagueWeek` é idempotente.
9. **XP:**
   - replay aplica 0;
   - `Combine` nunca produz duas deduções;
   - o XP de um acerto é ≥ 0.

---

## 16. Dependências

- **Adicionar:** `ts-fsrs@6.0.0` (MIT). Para testes, `fast-check` (MIT), opcional.
- **Já existem no learnharness:** `@xyflow/react` (grafo 2D). `d3-*` e `dagre-d3-es` estão disponíveis.
- **Storage:** o learnharness usa JSONL e ports (`src/store/*`, `src/core/ports.ts`). Os ledgers do Mathua (`xp_events`, `implicit_credit_*`, `league_members`, `attempts`) dependem de **unicidade por chave** e de **transação**. No JSONL isso sai como *append-only* com índice em memória e dedupe por `eventKey` (o padrão do merger de `src/core/graph.ts` já faz isso). Se as consultas por janela de tempo ficarem pesadas (ligas, stats), considerar SQLite embutido no processo servidor do Electron.
- **Nada do Go/Python** do repo entra em runtime. Não há SymPy: o nosso grading é LLM + verificadores por domínio.

---

## 17. Armadilhas e inconsistências encontradas

1. **`internal/concepts/dag.go` está vazio.** O DAG está em `concepts.go` e `loader.go`.
2. **README vs código nas ligas:** o README fala em "top 2". O código promove `min(5, floor(n/3))` com n ≥ 6.
3. **Não determinismo em `graphCover`** (`diagnostic/cat.go`, passo 3): itera `map[string]*Concept` (`bySub`) com `break` ao atingir 30. A ordem de mapa em Go é aleatória, então **o cover pode diferir entre chamadas** (`pickByInfoGain`, `shouldStop`, `Progress`). No TS, iterar chaves **ordenadas** e cachear o cover por sessão.
4. `graphCover` passo 5: se o número de raízes passar de 30, o resultado continua com mais de 30 nós.
5. `updateThetaLocked` usa `thresh = 10.0` fixo para "lento", ignorando o threshold do conceito, que `recordTimed` usa. Inconsistente.
6. Os parâmetros 2PL são **heurísticos e não estacionários**: `b` depende da fronteira atual e o MAP reestima θ com os `b` atuais para tentativas antigas. Não chamar isso de IRT calibrado. Para nós, calibrar `a` e `b` com dados ou com o MC.
7. **Variedade por texto da questão** (`Instance = questionText`). Com questões geradas por LLM, todo texto é distinto, então o bônus de variedade fica sempre no máximo (0,15) e o score infla. Use a chave de instância `templateId + hash(params canônicos)`.
8. `NeutralDifficulty = 0.55` é acoplado a `difficultyFromWeakness` (weakness 0,5). Se mudar um, mude o outro (há teste de acoplamento no Go).
9. `EffortBase` com clamp de 1 a 5 e `PerformanceMultiplier` 1,1 não altera o inteiro. A própria documentação admite a sobreprecificação de itens curtos. Recalibrar.
10. `difficultyCorrectPrior` foi medido nos dados de produção do Mathua. **Não transferível.**
11. XP vitalício **pode ser negativo** por design. Para single-user, desligar as deduções ou ao menos não exibir saldo negativo.
12. Semana de liga em **UTC segunda 00:00**. No Brasil (UTC−3) isso é domingo 21:00. Usar o fuso do usuário.
13. `servedPerDayCap 2`, `RecommendCaps` e `minTotalQuestions` são decisões "escolhidas, não tunadas" para matemática. Revalidar em Inglês (vocabulário tolera mais repetição) e em Eletrônica.
14. O FIRe em produção roda em **shadow**. O modo ativo nunca foi o caminho padrão. Comece em shadow e meça com o dry-run (checksum) antes de ativar.
15. A propagação de crédito é só por **1 salto e sem penalidade**. Não confundir com o FIRe completo do Math Academy.
16. FSRS híbrido em `computeGradedAttempt` (`max(fsrsInterval, sm2Interval)`). Remover o SM-2 no port.
17. A **prática não move o relógio FSRS**. Só revisão e a primeira maestria movem. Respeitar isso, ou a prática diária encurta intervalos artificialmente.
18. O KP state do Mathua fica em memória (`e.kpStates`) com publicação pós-commit. No nosso app, **persistir** por `(learner, domain, concept)`.
19. Pisos de densidade (in-degree médio ≥ 2,2, key_prereq ≥ 80%, encompasses ≥ 50%) só valem com ≥ 1000 nós. Um domínio novo gerado por IA pode violá-los no meio do crescimento. Torne o piso por domínio e progressivo.
20. **Agrupar por subdomínio cria ciclos.** Nunca derive ordem de "regiões" agregando nós. Use depth por conceito (ADR-050).
21. Docs com números desatualizados: o próprio repo registra contagens que um "sweep" reescreveu (ADR-050, emenda de 2026-11-09). Confie no código e em `data/`, não em números de prosa.
22. As lições `teaching` e `algebrica` são **NC**. Um import acidental contamina a licença.

---

## 18. Plano de integração (incremental)

**Fase 0: infra (1–2 dias)**

- Criar `src/core/contracts/mastery.ts` com os tipos: `Concept` generalizado com `domainId` e `gradingKind` por domínio, `Progress`, `AttemptRecord`, `XpEvent`, `CreditEvent`, `LeagueSeat` e `ExpansionProposal`.
- Adicionar `ts-fsrs@6.0.0`.
- Criar o diretório `src/core/mastery-engine/`.
- Adicionar `THIRD_PARTY_NOTICES` com a MIT do Mathua.

**Fase 1: núcleo puro + testes de paridade (3–5 dias)**

- Portar os itens 1–8, 10, 12, 14–16, 18–20 e 22–25 da §13.
- Portar os testes Go como tabelas em `tests/mastery-*.test.ts` (runner `tsx --test`), em especial:
  - `mastery/measure_test.go` (60/80/100% dominam em 6; ≤ 50% nunca);
  - `mastery/mastery_test.go` (`TestLadder_*`, `TestMasteryPct_*`, `TestEffectiveStatusFSRS_*`);
  - `repetition/repetition_test.go` (todas as `TestAllocate_*`, `TestAdmit_*`, `TestValidate_*`);
  - `fire/mode_test.go`;
  - `xp/accountability_test.go` e `fairness_test.go`;
  - `leaderboard/leagues_test.go` e `board_test.go`;
  - `diagnostic/irt_test.go` e `simulation_test.go`;
  - `concepts/mastery_units_test.go`;
  - os vetores FSRS.
- Adicionar as propriedades da §15 com `fast-check`.

**Fase 2: storage por domínio (2–3 dias)**

- Implementar ports e adapters: `ProgressStore`, `AttemptLog`, `XpLedger` (dedupe por `eventKey`), `CreditLedger`, `LeagueStore` (marcador `league_weeks` idempotente) e `DiagnosticSessionStore` (snapshot como em `Session.Encode`/`Decode`).
- Tudo chaveado por `(learnerId, domainId)`.

**Fase 3: loop de sessão com o teacher-agent (3–5 dias)**

- Expor tools ao agente:
  - `mastery.next()` (recomendação e elegibilidade);
  - `mastery.grade(attempt)` (`computeGradedAttempt`);
  - `mastery.state()`, o digest para a memória: fronteira, fraquezas, revisões vencidas, KP atual e target.
- O agente segue o ritmo dos KPs: explicação curta por KP, depois itens, depois o próximo KP. Ele **não decide** mastery. Só o motor decide (o princípio "single authority" do ADR-038 e ADR-050).

**Fase 4: grafo + expansão procedural (1–2 semanas)**

- Seed de Eletrônica e Inglês com a mesma estrutura (3 KPs × 3 subgoals, encompasses e interferência).
- Opcional: importar o DAG matemático MIT do Mathua como domínio de apoio para Eletrônica.
- Pipeline de expansão:
  1. **gatilho**: fronteira a ≤ 2 arestas de um sink do domínio, weakness persistente que pede subdivisão do nó, pedido do aluno ou subdomínio novo;
  2. **proponente LLM** gera um `ExpansionProposal` (o equivalente a `wave-N-candidates`);
  3. **validador determinístico**: §3.2, labels normalizados, cheque aditivo, alcançabilidade, regeneração de unidades;
  4. **piloto**: aceitar os k primeiros e só então o resto;
  5. **juiz LLM + verificação independente** das respostas (o equivalente a `TestRepairedFamiliesRecompute`);
  6. registro de métricas de defeito por wave para dimensionar a próxima.
- Aplicar a regra de estabilidade 15.6.
- Ligar mídia (vídeos, capítulos) a **unidades** (bandas) e não só a nós.

**Fase 5: diagnóstico por domínio (3–4 dias)**

- Portar o CAT com cover determinístico e itens gerados e verificados.
- A colocação só semeia UNSEEN como placement.

**Fase 6: XP, níveis, ligas e stats (1 semana)**

- Política de XP recalibrada (inclui aula ativa e vídeo), accountability com deduções desligadas.
- Kernel Monte Carlo (§9.3), níveis por quantis e ligas com fantasmas.
- Ledger de tokens e horas no mesmo padrão `eventKey`.

**Fase 7: FIRe (contínuo)**

- Rodar em `shadow` por semanas com relatório dry-run.
- Ativar com o mesmo duplo gate (config + registro durável), ou mais simples: um toggle local explícito.
- Estender a propagação ponderada e transitiva.

---

## 19. Referências

- Repo: https://github.com/chuma-beep/mathua (commit `228dda9`)
- ts-fsrs: https://www.npmjs.com/package/ts-fsrs (v6.0.0, MIT, export `models/fsrs-6`)
- Docs internas mais úteis:
  - `docs/mastery-semantics.md`
  - `docs/mastery-invariants.md`
  - `docs/mastery-assessments.md`
  - `docs/architecture/xp-accountability.md`
  - `docs/fire-activation.md`
  - `docs/content-expansion.md`
  - `docs/expansion-waves/wave-{1,11}-{candidates,proposal,review}.md`
  - `docs/adr/ADR-{008,020,037,038,046,050,051,055}-*.md`
