# Módulo `learner`: modelo do aluno event-sourced (puro, browser-safe)

Implementa a SÍNTESE §2.6 (estados monotônicos, política "não re-bloqueia") e o r2 §9 (BKT × FSRS-7, DINA, FIRe, KST, planejador), com detalhes do r10 §3 (interior/fringes, crédito implícito) e o ledger inteiro do mathua §7.1. Tudo vive em `src/core/learner/`: sem I/O, sem rede e sem imports de `src/agent|server|store`. A única dependência externa é `ts-fsrs@6` (FSRS-7). O LLM é só **sensor** (nota 0–3, confiança, atribuições) e nunca prevê nada.

## API pública (`src/core/learner/index.ts`)

| Arquivo | O que exporta |
|---|---|
| `graph-view.ts` | `LearnerGraphView` (ids em ordem topológica; por nó `clauses` OR-de-ANDs **efetivas**, `encompasses`, `hoursMid`, `goalWeight`, `isLeaf`…), `buildGraphView` (valida via `assertGraphView`: ids duplicados/pendentes, ciclos, peso de `encompasses` fora de (0,1], campos numéricos NaN), `graphIndex`, `dependentsOf`, `prereqsOf`, `expandedClauses` (cláusulas com containers substituídos pelas suas; teto `MAX_EXPANDED_ALTERNATIVES = 64`). A integração monta a view a partir do snapshot do currículo. |
| `fold.ts` | `foldEvents(snapshot \| null, events, graph, params)`: replay puro e determinístico. `ingestEvent` / `ingestEvents` dobram um evento NOVO e devolvem os `implicit-credit` derivados (FIRe), que a store grava logo depois dele. Também `emptySnapshot`, `freshNodeState`, `withMonotoneFlags`, `evidenceWeight`, `primaryIdOf`, `effectiveMinutesSinceExposure` e `LearnerFoldError`. |
| `signals.ts` | `computeSignals(snapshot, graph, params, at)`: status por nó e eixos separados `attained / mastered / estimated / retained / demonstrated / unlocked`, mais `pKnowsNow = pL·R`, `readiness`, `retention`, `reviewDue`, `weakScore` e a estrutura (A, fronteira, K*). |
| `planner.ts` | `planDay(snapshot, graph, params, { at, budgetMin, goalPlan?, seed? })` → `StudyPlan`. Também `goalPlanOf`, `projectedDailyLoad`, `routeTo` (a cláusula expandida pela qual o nó novo é de fato alcançado) e `PlannerError`. |
| `snapshot.ts` | `buildPromptSnapshot` + `renderPromptSnapshot`: cerca de 300 tokens em pt-BR para o prompt do tutor. |
| `kst.ts` | `interior`, `outerFringe`, `innerFringe`, `topLeaves`, `impliedClosure`, `structuralState`, `crispState`, `masteredTop`, `desiredRetentionFor` e o diagnóstico por partículas: `startDiagnostic`, `nextDiagnosticQuestion`, `recordDiagnosticAnswer`, `diagnosticEstimates`, `diagnosticEvent`. |
| `bkt-fsrs.ts`, `emission.ts`, `dina.ts` | Atualização local (`localUpdate`), tabelas de emissão com confusão do corretor κ, mapeamento nota→rating e DINA mean-field com o fator de atribuição (1 + λc). |
| `fsrs.ts` | Wrapper do FSRS-7: `reviewMemory`, `previewMemory`, `retrievability`, `interpolateCredit` (FIRe) e `shortenDue`. O `cardId` é `nó@vN`. |
| `propagate.ts` | Projeção de consistência p_b ≤ p_a + ε (`projectConsistency`), pesos w* (`encompassWeights`), `allocateCredit` (maior resto), ledger e penalidades para cima. |
| `elo.ts`, `misconceptions.ts`, `calibration.ts` | Escolha de nível (alvo 0,75; sondas 0,5), crenças Beta(1,4) de misconceptions, log loss/AUC/RMSE(bins) por janela com baselines AVG e média móvel. |
| `params.ts` | `DEFAULT_LEARNER_PARAMS` (valores do r2 §9.11), `LEARNER_CONSTANTS`, `validateLearnerParams`, `parseFireMode`. |

### Adições ao contrato `types.ts` (todas opcionais)

`NodeState.placedAt`, `NodeState.fire` (`FireLedger { epoch, units }`), `NodeState.latency`, `Evidence.options` (k da MCQ), `Evidence.diagnoses` (refutação de misconception), `LearnerParams.fireMode` (`FireMode = "off" | "shadow" | "active"`) e `NodeState.lastExposureAt` (instante da última `exposure` dobrada). `LEARNER_CONSTANTS` ganhou `flashcardWeight = 0,3` e `initialNodeVersion = 1`.

## Decisões

- **Monotonicidade.** `attainedAt`, `masteredAt`, `placedAt` e `demonstratedAt` nunca são limpos por falhas. Só um evento `node-version` com versão maior reseta o nó. A estrutura A é o fecho implícito de {attained ∪ placed} pelos membros obrigatórios (∩ das cláusulas), mais os containers concluídos. A fronteira é a fringe externa de A, só folhas.
- **Maestria.** Exige pL ≥ 0,95, ≥ 2 famílias de item e ≥ 1 recuperação adiada (≥ 24 h, sem dica). Uma dica limita a nota a 2. Atribuições do LLM só contam em falhas.
- **FIRe** só é derivado em `ingestEvent`, e o log persistido é a fonte da verdade (o replay não re-deriva). Usa micro-unidades inteiras (1e6), teto de 3 repetições por tentativa e MaxBank = 3 por época (época = `reps` reais). Alvo fora do vencimento não recebe crédito (fail-closed, sem banco diferido). Flashcards não disparam revisão FSRS do nó nem FIRe. Modo desconhecido vira `shadow`.
- **Planejador.**
  - Ordem dos itens: obrigatórias → aquecimentos → novos → compressão → fracos/sondas.
  - Veículos são simulados com a interpolação FSRS real.
  - O controle de carga é uma simulação FSRS de 30 dias com semente fixa.
  - Um pré-requisito fraco de um nó novo vira remediação, e ela passa a ser o `next`.
  - Nó maior que o orçamento restante ganha sessão parcial (≥ 10 min). Há pelo menos 1 nó novo quando sobram ≥ 10 min.
- **Containers.** São marcos (sem estado do aluno). Toda regra numérica que lê membros de cláusula (projeção de consistência, readiness, prior de Fréchet, aquecimentos) usa `expandedClauses`. As regras estruturais (fringes do KST) continuam vendo o container como marco.
- **Versões.** Todo estado nasce na versão 1 e só um evento `node-version` o leva adiante. **A integração precisa gravar um `node-version` a cada bump da definição**, inclusive de nós nunca tocados. Assim o replay do log inteiro com o grafo atual dá o mesmo snapshot que o fold incremental.
- **Evidência.** O peso padrão é 0,3 para flashcard e 1 nos outros casos; `weight` explícito precisa ser finito e > 0. Se o primário declarado não está no grafo, nenhum co-nó herda a revisão FSRS, as famílias, o Elo ou o FIRe. Uma `exposure` dobrada reinicia o relógio da recuperação adiada e o regime "imediato" da emissão.
- **Outros.**
  - ρ = 1, porque a view não traz força de aresta.
  - `speed` fica fixo em 1.
  - θ e b do Elo ficam na escala logit (`toElo400` converte).
  - "Domina (topo)" usa `topLeaves`: a fringe interna enxergando através dos containers.

## Lacunas conhecidas

- A velocidade de aprendizado não é aprendida.
- O "modo remediação após 2 falhas seguidas" fica com o LessonOrchestrator.
- A deduplicação semântica de misconceptions fica com a integração: aqui só existe dedup por texto normalizado.
- O rating Easy usa a média de ln(latência) como proxy da mediana.
- O teto de FIRe por tentativa é de 3 repetições; o mathua usa 1.
- Cada revisão real recalcula `structuralState` para o papel de retenção. Com 3.000 nós isso custa cerca de 1 ms por evento (fold de 2.000 eventos em cerca de 2,2 s).
- Não há passe global "noturno" da projeção sobre o snapshot: o fold só faz varreduras locais. `projectConsistency` fica exportado para a integração.

## Correções da revisão adversarial

Cada item tem um teste em `tests/learner-regressions.test.ts`.

1. Um container entrava na projeção de consistência como nó fantasma com prior 0,15: puxava para baixo o nó que dependia dele e ganhava estado próprio. Agora a projeção usa `expandedClauses` e nunca usa container como alvo.
2. A readiness de um nó atrás de um container era cerca de 0,15. Agora usa `expandedClauses`.
3. O fold escolhia a retenção desejada do cartão só com attained/placed, sem fecho implícito nem marcos, e divergia de `computeSignals` (0,90 contra 0,93). Agora usa `structuralState`.
4. `stateOf` pegava a versão do grafo atual, então o replay pulava o reset de `node-version`. Agora os estados nascem na versão 1.
5. Primário declarado desconhecido caía para o co-nó de maior q. Agora `primaryIdOf` devolve null.
6. Flashcard sem `weight` contava como evidência completa. Agora o padrão é 0,3, e `weight` 0 é rejeitado.
7. Uma lição dobrada não reiniciava o relógio adiado. Agora existe `lastExposureAt`, e o fold usa o menor dos dois relógios.
8. Os aquecimentos usavam a união de todas as alternativas OR e não enxergavam através de containers. Agora usam `routeTo`.
9. A compressão parava quando o melhor candidato (veículo de 6 min) não cabia, mesmo se uma revisão de 5 min ainda cabia. Agora só competem candidatos que cabem.
10. `assertGraphView`/`buildGraphView` aceitavam ids duplicados, `encompasses` pendente ou com peso inválido e campos NaN. Agora rejeitam.

## Como testar

```bash
node scripts/run-tests.mjs tests/learner-bkt.test.ts tests/learner-fsrs.test.ts tests/learner-propagate.test.ts \
  tests/learner-fold.test.ts tests/learner-kst.test.ts tests/learner-planner.test.ts tests/learner-misc.test.ts \
  tests/learner-regressions.test.ts
npx tsc --noEmit --allowImportingTsExtensions --strict --target es2022 --module esnext --moduleResolution bundler \
  --verbatimModuleSyntax --noUncheckedIndexedAccess --skipLibCheck --types node src/core/learner/*.ts \
  tests/learner-fixtures.ts tests/learner-{bkt,fsrs,propagate,fold,kst,planner,misc,regressions}.test.ts
```

O glob `tests/learner-*.test.ts` também pega os testes `learner-image*` (de `src/agent/tools`), que não são deste módulo. A cobertura inclui:

- o exemplo numérico do §9.4;
- a monotonicidade sob falhas (fast-check);
- a regressão de histerese a partir de pL 0,9385;
- a projeção idempotente;
- G + S ≤ 1;
- replay determinístico, embaralhado e incremental;
- FIRe com w* = 0 (identidade) e w* = 1 (S, S_f e t_last do Good; dueAt a até 1 dia do preview);
- o planejador dentro do orçamento e só com nós da fronteira;
- o diagnóstico convergindo numa cadeia.

`tests/learner-fixtures.ts` tem os construtores compartilhados.
