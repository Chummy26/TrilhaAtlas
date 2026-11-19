# Módulo `curriculum`: grafo de currículo E/OU certificado (puro, browser-safe)

Implementa a SÍNTESE §2.3, §2.4(e), §2.7 e §2.13 com a formalização do r10 (§3 sistema de cláusulas com rank e Teorema LS-rank, §3.4 reparo de estado, §3.6 cotas de horas, §4 operadores e refinamento-marco, §6 certificados, §11 modo estrito), as regras de geração do r3 (§4 invariantes I1–I10, §7 gatilhos), as regras de aresta do open-mastery e o validador de propostas do Clew (§5–6). Tudo vive em `src/core/curriculum/`, sem I/O, sem rede e sem imports de `src/agent|server|store`. As dependências são só `zod` e, nos testes, `fast-check`. O hash é FNV-1a 64 próprio, sem `node:crypto`.

## API pública (`src/core/curriculum/index.ts`)

| Arquivo | O que exporta |
|---|---|
| `types.ts` | Contratos compartilhados (**sem alterações**). |
| `schema.ts` | Schemas zod 4 de `CurriculumItem`, `SeedItem`, `CurriculumSeedFile`, `PatchEnvelope`, `ExpansionOp` e snapshot; `parseWith`, `zodIssuesToErrors`, JSON Schema do envelope/op para tools. **Guardas rápidas** `isCurriculumItemShape`, `isCurriculumEdgeShape`, `isCurriculumSnapshotShape` e `ITEM_SHAPE_KEYS`. `ItemPayloadSchema` (payload estrito de `itemPayloads`). `updateItem.fields` e os payloads são **estritos**: chave desconhecida é erro `schema`, não descarte silencioso. |
| `effective.ts` | `buildEffectiveSystem(items)` → `EffectiveSystem`: ids densos dos itens vivos, `keys` (todas as chaves ordenadas), `clauses` efetivas (DNF densa), `entry`, `prereqs`, `soft`, árvore e horas. Também `effectiveClausesOf`, `entryRequirementsOf`, `normalizeClauses`, `sameClauses`, `absorb`, `andDnf`, `toContractClauses`, helpers de árvore (`childrenOf`, `ancestorsOf`, `pathTo`, `descendantsOf`, `leavesOf`, `allLeaves`, `rootOf`, `isLeaf`), `KIND_RANK` e `NEXT_KIND`. |
| `rank.ts` | `kahnOrder` (heap mínimo, determinístico, testemunha `[x,…,x]`), `forwardChain` (CSR, O(n + Σ\|C\|)), `effectiveKahn`, `prerequisiteDepth`, `curriculumIndex(snapshot)` (cache por objeto; lança `CurriculumError` se houver ciclo) e `asIndex`. |
| `certificate.ts` | `canonicalJson`, `fnv1a64Hex`, `itemHash`, `hashSnapshot(snapshot, { cache? })`, `computeCertificate` e os checadores independentes O(V+E): `checkTopoCertificate`, `checkRankCertificate` (R1–R3), `checkCycleWitness`, `checkSnapshotCertificate`, `effectiveClauseMap`. |
| `invariants.ts` | `validate(snapshot, opts) → ValidationError[]` e `validateReport` (erros + avisos de lint + sistema efetivo + ordem + estatísticas). Opções: `edgeMode`, `strictMaxAlternatives`, `schema` (`"all"`, `"none"` ou um conjunto de ids), `limits` e `lint`. |
| `patch.ts` | `applyPatch(snapshot, envelope: unknown, opts) → ApplyPatchResult`, `classifyRisk`, `REFINE_EPSILON` e `DEFINITION_FIELDS`. |
| `seed.ts`, `ledger.ts` | `normalizeSeedItem`, `parseSeedFile`, `domainRootProblems` (raiz válida: sem pai, `kind` domain, sem cláusulas, viva), `seedFilesToPatch`, `initialSnapshot`, `rootFromSeedEnvelope`, `applySeedFiles` (com `reduceTransitive` opcional) e `replayLedger`. |
| `frontier.ts`, `hours.ts` | `attainedClosure`, `closureIds`, `isFeasibleState`, `outerFringe`, `innerFringe`, `unlockedBy`, `mandatory`, `goalPlan` (LB/UB do r10 §3.6), `goalFrontier`, e os reparos de estado `interiorState` (conservador, padrão) e `inferredRepair` (otimista, para sonda). Em `hours.ts`: `hoursMid`, `sumHours`, `rollupHours`, `totalHours`, `remainingHoursDense`, `lowerBoundHmax`, `upperBoundAdditive`. |
| `incremental.ts` | `DynamicTopoOrder` (Pearce–Kelly semeado por Kahn: `seed`, `fromSnapshot`, `addEdge`, `wouldCreateCycle`, `removeEdge`, `order`, `clone`) e `checkPrereqCandidate` (pré-checagem para o agente). |
| `granularity.ts`, `transitive.ts` | Faixas do átomo (alvo 10–45 min, erro fora de 8–60 min), `leafGranularityFinding`, `granularityFindings`, `refineCandidates`, `findRedundantPrereqs`, `redundantPrereqsOf`, `reduceStoredClauses`. |
| `triggers.ts`, `budget.ts` | `computeTriggers` (frontier-lookahead, granularity, weakness, request, coverage-gap; chaves de idempotência) e o orçamento lexicográfico `selectExpansions`, `compareCandidates`, `budgetForDay`, `chargeExpansion`, `terminationMeasure`, `measureDecreases`. |
| `query.ts` | `normalizeForSearch`, `searchItems` (sem acento: título pt/en, aliases, último segmento do id), `neighborhood` (k saltos, teto 200), `dependencyPath`, `regionSubgraph`, `itemContext`, `studyPath`. |

## Decisões

- **Sistema efetivo.** Um container é um **marco**: sua cláusula efetiva é `[[todos os filhos vivos]]`. As cláusulas guardadas num container são **requisitos de entrada**, herdados **por alternativa**. Uma alternativa de `x` que cita algo dentro da subárvore do pai é *interna* e fica como está. Uma alternativa externa recebe um AND com a entrada do pai. Itens aposentados saem do sistema efetivo e do certificado. O resultado é absorvido (forma mínima), com teto de 64 alternativas efetivas.
- **Modo das arestas.** `relaxed` só levanta o limite de 2 alternativas. Ciclos são proibidos nos dois modos, porque o certificado e a `graph-view` do learner precisam de ordem topológica. Arestas suaves (`softPrereqs`) entram no teste de aciclicidade (r3 I3).
- **Etapa de schema rápida.** As guardas de `schema.ts` espelham os schemas campo a campo e são **sólidas** (guarda verdadeira ⇒ zod aceita). `validate` roda a guarda em todo item e chama o zod só no que ela recusa, para devolver as mensagens do zod. Os testes fixam a lista de campos no `shape` do schema e conferem guarda ⇔ zod com fast-check (mutações aleatórias de item, aresta e snapshot).
- **Códigos de erro.**
  - Horas do átomo fora da faixa dura 8–60 min usam o código `budget`. A faixa 10–45 min só gera aviso, e átomos de regime (`practice_regime`, `lab`, …) ficam isentos.
  - Stub com `hi` > 4 h é **aviso** (candidato a `refine`), nunca erro.
  - Conflito de versão, domínio trocado e payload órfão usam o código `schema`, com mensagem explícita ("conflito de versão…").
  - `no-route` só aparece quando não há ciclo, porque um ciclo já explica os itens mortos.
- **`applyPatch`.** Segue a ordem zod → clone copy-on-write (a entrada **nunca** é mutada, e itens não tocados são compartilhados por referência) → ops → tetos → invariantes (schema só nos itens tocados) → certificado reconferido pelo checador independente → recibo.
  - Erros de op saem com prefixo `ops[i] <op> <id>:`. Ids nunca são reutilizados, renomeados nem re-parentados.
  - `addItem` sob uma folha existente é recusado ("use refine"). Pode sob a raiz, sob container ou sob item criado no mesmo patch.
  - `addAlternative` num item de entrada é recusado, porque não teria efeito.
  - `retire` exige `reroute` para todo dependente e reescreve cada alternativa C como `(C ∖ aposentados) ∪ R`.
  - `updateItem` exige `fields` não vazio e aplica só os campos que mudam. A `version` é acertada **uma vez por patch**, comparando com o item base pelo JSON canônico (ordem de chaves não conta): +1 se algum campo de definição mudou, nada se o item foi criado no patch. Uma edição que volta ao valor original devolve o objeto compartilhado e não entra em `changedIds`.
  - `addAlternative` exige ao menos um pré-requisito (a rota vazia viraria TRUE e apagaria os pré-requisitos). `addSubdomain` exige ao menos um item. `addEdge` só liga itens vivos (`anchored_to` aponta para fora).
  - No seed (`baseVersion` 0) o payload da raiz tem de ser idêntico à raiz do snapshot; senão o replay divergiria.
  - `updatedAt` e `appliedAt` usam `envelope.createdAt`, a menos que `opts.now` seja passado. Assim o replay é determinístico.
- **Hash.** É um Merkle simples: FNV-1a 64 do JSON canônico de cada item (com cache em `WeakMap`), depois o manifesto. Exclui `certificate` e `updatedAt`. `checkSnapshotCertificate` recalcula sem o cache (`{ cache: false }`), porque o cache por objeto não vê mutação in-place.
- **Estado do aluno.** Um id de container recebido como "atingido" é levantado para as folhas **atuais** (`refine_lift`); quem persiste o estado deve guardar ids de folha. Containers são atingidos por rollup. Só folhas são estudáveis. `mand(t)` usa bitsets locais ao cone, liberados após o último uso; é exato nas folhas (containers só de rollup não aparecem). `goalPlan` usa `mand_K`: itens de K não são expandidos no cone, então LB ≤ UB vale também num K inviável (logo após um aperto, antes do reparo).
- **Reparo de estado (r10 §3.4).** `interiorState` devolve o maior estado viável dentro do fecho (encadeamento para frente restrito) e lista as folhas `dropped`; é o padrão da SÍNTESE. `inferredRepair` mantém tudo e infere as folhas de pré-requisito mais baratas (`inferred`, para sonda). Nenhum dos dois mexe em `attainedAt`: só calculam conjuntos.
- **Gatilhos.** O raio de materialização (R = 2) anda por `requires ∪ builds_towards` (r3 §7.1), o que importa para o Inglês, onde quase tudo é suave. O gatilho "estender a região" não dispara quando tudo o que ele poderia estender (as metas ou, sem metas, o domínio inteiro) já foi atingido: crescer um domínio concluído é pedido do aluno ou lacuna de cobertura.
- **Redução transitiva.** É correta mas incompleta: a busca segue só elos de alternativa única e é podada pela ordem topológica. Como não existe op `removePrereq`, ela aparece como aviso de lint e como opção `reduceTransitive` no seed.

## Revisão adversarial (bugs corrigidos, cada um com teste em `tests/curriculum-review.test.ts`)

1. `seedFilesToPatch`/`applySeedFiles` **lançavam** exceção com raiz inválida (cláusulas ou aposentada) em vez de devolver erros; agora devolvem `hierarchy`.
2. `replayLedger` lançava com payload de raiz inválido no envelope 0; agora devolve `failedAt: 0`.
3. `updateItem` comparava com `JSON.stringify` (sensível à ordem das chaves) e incrementava `version` a cada op: bump espúrio, bumps múltiplos por patch e bump em item recém-criado.
4. `addAlternative` com `[]` apagava todos os pré-requisitos e era classificado como risco "low".
5. Campos com erro de digitação em `updateItem.fields`/`itemPayloads` eram descartados pelo zod e o patch "aplicava" um no-op.
6. `checkSnapshotCertificate` confiava no cache de hash por objeto e não pegava mutação in-place.
7. `addSubdomain` sem itens criava um stub de 0 h.
8. `addEdge` aceitava origem/destino aposentados ou ausentes no nível da op.
9. Updates sem efeito entravam em `receipt.changedIds`.
10. `classifyRisk` não via mudança de horas > 25 % feita por `updateItem` (só por `setHours`).
11. `goalPlan` dava LB > UB e `mandatory` errado com K inviável (mand calculado sem K).
12. O payload da raiz no envelope de seed não era conferido; o replay podia gerar outra raiz.
13. `validate` quebrava com `items: null` no caminho de escopo por conjunto.

O mesmo arquivo traz um **oráculo independente** do sistema efetivo (definição recursiva sobre strings, sem código compartilhado) comparado com `buildEffectiveSystem` em árvores com referências arbitrárias, e a propriedade "toda rota para dentro de uma subárvore passa pela entrada da raiz dela". O oráculo `leafFamily` das fixtures lê as cláusulas efetivas da própria implementação e não pegaria um erro do construtor.

## Lacunas conhecidas

- `applyPatch` não confere `envelope.autoApplied` contra `classifyRisk`: quem decide aplicar sem revisão deve chamar `classifyRisk`, não confiar em `envelope.risk`.
- `updateItem` pode editar `provenance` (fica no recibo, mas não há política de quem pode).
- Arestas já existentes que apontam para um item aposentado depois não são sinalizadas.
- `retire` aceita `reroute` com cláusula vazia (o dependente só perde o membro aposentado). É intencional, e `retire` já sai com risco "structural".

- Não há modo relaxado com ciclos entre alternativas OU (r10 §11.1 "palavra plena", `checkWordCertificate`). Ciclos são sempre erro, e o certificado de rank cobre o modo estrito.
- `applyPatch` revalida o domínio inteiro (~70–80 ms com 20k nós). O PK serve só para pré-checagens interativas (`checkPrereqCandidate`).
- A persistência (`patches.jsonl`, `rejected.jsonl`) e a aplicação dos reparos de estado ao learner ficam com a integração: o envelope do seed deve ser a entrada 0 do ledger, e o replay depende disso.

## Desempenho (domínio sintético de 20 000 nós, Node 24, mediana de 5 rodadas aquecidas, máquina com outros agentes rodando)

| Operação | Tempo |
|---|---|
| `validate` completo (guarda de schema em todos os itens + todas as invariantes) | **~55–65 ms** (meta < 200 ms); 1ª chamada a frio ~85–100 ms; ~80 ms com as 9 suítes em paralelo |
| `validate` com `schema: "none"` | ~33 ms |
| guarda rápida vs zod no snapshot inteiro | ~14 ms vs ~110–140 ms |
| `validateReport` com lint | ~70–85 ms |
| `checkSnapshotCertificate` | ~40–45 ms |
| `applyPatch` (`addItem`) | ~70–80 ms |
| `goalPlan` / `computeTriggers` | ~75–85 ms |
| `outerFringe` | ~1 ms |
| PK `fromSnapshot` | ~15 ms |
| 5 000 inserções PK aleatórias (metade recusada por ciclo) | ~260 ms |

## Como testar

```bash
node scripts/run-tests.mjs "tests/curriculum-*.test.ts"
npx tsc --noEmit --allowImportingTsExtensions --strict --target es2022 --module esnext --moduleResolution bundler \
  --verbatimModuleSyntax --noUncheckedIndexedAccess --skipLibCheck --types node src/core/curriculum/*.ts tests/curriculum-*.ts
npx eslint src/core/curriculum tests/curriculum-*.ts
```

`tests/curriculum-fixtures.ts` não é teste: guarda os construtores, o domínio de exemplo, os geradores `arbFlat`/`arbHier` (o arbSystem do r10, com rank oculto) e o oráculo de força bruta `leafFamily`. As suítes (154 testes) cobrem:

- **`core`:** vetores FNV, JSON canônico, checadores e adulteração, sistema efetivo, Kahn/testemunhas, horas, granularidade e arestas transitivas.
- **`schema`:** guardas rápidas ⇔ zod (fast-check), campos fixados no `shape`, mensagens do zod preservadas.
- **`invariants`:** cada código de erro e cada aviso.
- **`patch`:** cada op com caminho feliz e erros, envelope, atomicidade, entrada congelada, tetos, recibo e risco.
- **`seed`:** seed, ledger e replay.
- **`seeds`:** os seeds reais de `content/curricula/{electronics,english}` (só leitura; pulados se ausentes) carregam sem erros no modo estrito, o replay dá o mesmo hash e um aluno percorre todas as folhas pela fronteira.
- **`frontier`:** fronteiras, mand, plano, gatilhos, orçamento, consultas e PK baseado em modelo, mais `checkPrereqCandidate` ≡ `applyPatch`.
- **`properties`:** LS-rank (a)–(h) por enumeração com n ≤ 9, mand/LB ≤ OPT ≤ UB, reparos (interior maximal, inferência viável), `refine_lift`/`refine_project`, relaxa/aperta, patches válidos sempre aceitos + replay com o mesmo hash, e patches caóticos que nunca produzem snapshot inválido.
- **`review`:** regressões da revisão adversarial e o oráculo independente do sistema efetivo.
- **`perf`:** os tempos acima, impressos como diagnóstico.
