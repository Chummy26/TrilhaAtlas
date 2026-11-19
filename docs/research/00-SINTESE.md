# 00 · SÍNTESE ARQUITETURAL: do learnharness a um tutor de domínios massivos

> **Papel:** arquiteto-líder. **Data:** 2026-11-18. **Base:** fork não modificado do learnharness 0.6.1 (AGPL-3.0) em `C:\Users\nicoolas\Pictures\learnharness`.
> **Fontes:** os 34 relatórios em `docs/research/`, lidos integralmente. Este documento consolida, resolve contradições e decide. Ele foi escrito para que um engenheiro implemente **sem reler** as fontes; as referências servem apenas para aprofundar.
> **Convenção de citação:**
>
> | Tag | Relatório |
> |---|---|
> | `[r1]` … `[r10]` | Relatórios temáticos |
> | `[lh-agent]` | `lh-agent-providers.md` |
> | `[lh-graph]` | `lh-graph-pedagogy.md` |
> | `[lh-plug]` | `lh-plugins-infra.md` |
> | `[lh-ui]` | `lh-ui-theme.md` |
> | `[om]` | `ref-open-mastery` |
> | `[bt]`, `[bt-ui]` | BloomTutor (core e UI) |
> | `[dt]`, `[dt-web]` | DeepTutor (core e web) |
> | `[maic]`, `[maic-ui]` | OpenMAIC (pipeline e UI) |
> | `[clew]`, `[tsfsrs]`, `[mathua]`, `[tmcp]` | Clew, ts-fsrs, mathua, tutor-mcp |
> | `[hind]`, `[genm]`, `[sigma]`, `[ytjs]` | hindsight, gen-mentor, sigma.js, YouTube.js |
> | `[rough]`, `[oskill]`, `[apkg]`, `[unpdf]` | react-rough-fiber, openskill.js, anki-apkg-export, unpdf |
>
> **Segurança:** nada em `_refs/` foi executado. Os ports propostos são **leituras de código MIT/Apache/CC0** reescritas em TS, com aviso de copyright preservado em `THIRD_PARTY_NOTICES.md`.

---

## 0. TL;DR: as 15 decisões que definem o produto

1. **O núcleo é determinístico e o LLM só propõe.** Estrutura do grafo, fronteira, estado do aluno, XP e agendamento são código puro em `src/core/**`. O LLM gera aulas, itens, rubricas e propostas de expansão, e cada proposta passa por um validador [r3][r10][clew][r2].
   - Evidência: no benchmark KST, LLMs acertam o próximo passo em **61,3%** só com descrições e em **96,3%** com a relação de pré-requisitos dada [r3][r10].
2. **A aula é uma máquina de estados (`LessonOrchestrator`), não um prompt** [r1 §0.4].
   - Checagem por *knowledge point*, não por frase.
   - No máximo 1 pergunta por mensagem e no máximo 3 perguntas conversacionais por nó.
   - Prática com alvo de **80–85% de acerto**.
   - Perguntas sempre como **cards de UI** que encerram o turno, nunca no meio da prosa [r1][clew][maic].
3. **Currículo:** hierarquia Domínio → Área → Unidade → Tópico → Átomo [r3].
   - Pré-requisitos em **CNF AND/OR** (`clauses: string[][]`, modo estrito, no máximo 2 alternativas) [r10].
   - Arestas suaves (`builds_towards`) e de englobamento (`encompasses`, FIRe) ficam à parte.
   - Ledger JSONL de *patches* por domínio, com certificado (ordem topológica + hash).
4. **Expansão procedural** por gatilhos determinísticos (fronteira próxima, ponto fraco, pedido, lacuna de cobertura) com orçamento lexicográfico.
   - Pipeline: k amostras → consenso → dedup → validação → `applyPatch` transacional [r3][r10].
   - Folhas de baixo risco entram com auto-apply, recibo e *undo*. Mudanças estruturais pedem revisão [clew ADR-0001].
5. **Learner model** [r2]:
   - **BKT × FSRS-7** por nó (`ts-fsrs@6.0.0`, MIT).
   - Estados KST (down-sets), propagação FIRe no grafo de englobamento e culpa estilo DINA.
   - O LLM é **sensor** (nota 0–3 por rubrica), nunca preditor.
   - "Aprendido" é **monotônico** [r10]: falhar uma revisão nunca re-bloqueia.
6. **"O que estudar agora"**, numa política gulosa de 4 camadas [r2 §9.9]:
   1. revisões vencidas por `I·(1−R)`;
   2. novos na **fronteira ∩ plano** [r10];
   3. remediação;
   4. sondas.

   O LLM só escolhe **dentro** desse conjunto. A UI mostra **uma** sugestão por vez [r6][bt].
7. **Memória SOTA = TS nativa, in-process, "raw-first"** [r4]:
   - SQLite (`node:sqlite`) **por domínio**, FTS5 + vetores locais (transformers.js) + tempo bitemporal + grafo ligado ao currículo, fundidos por RRF;
   - prefixo estável cacheável (mental models + observation log);
   - orçamento de no máximo ~12k tokens por turno.

   O sidecar Hindsight (Python + Postgres, 24–43k tokens por consulta) foi rejeitado; as ideias dele foram aproveitadas [r4][hind].
8. **Domínios isolados e alternáveis:**
   - `data/domains/<domainId>/{chats,curriculum,learner,memory,resources,progress,flashcards,…}`;
   - um perfil global mínimo;
   - uma biblioteca de livros compartilhada (`data/library/<sha256>`).

   Começa por `english` e `electronics`.
9. **Fim de sessão:** extração e consolidação da memória → candidatos a flashcard (2–6 por nó) → aprovação em lote de 60–90 s → **o app é a fonte de verdade** (FSRS) → espelho Obsidian (formato Spaced Repetition) e push opcional ao Anki via **AnkiConnect API v1** (`POST 127.0.0.1:8765/api/v1`) ou `.apkg` [r7][r1].
10. **Recursos legais apenas:**
    - YouTube Data API v3 com chave do usuário (BYOK), embed `youtube-nocookie` com `Referer` injetado e transcrição sincronizada **abaixo** do player;
    - livros abertos (OpenStax, LibreTexts, OTL, Kuphaldt ModEL/LIEC, NEETS, Wikibooks, VOA, arXiv, DOAB) ou o **PDF/EPUB do próprio usuário**;
    - **nunca** Anna's Archive, LibGen ou Z-Library [r6].
11. **IA por assinatura sem IDs fixos no código:**
    - **ChatGPT via SIWC**, já implementado, a corrigir;
    - **Anthropic só por chave de API do usuário** ou pelo CLI `claude` do próprio usuário (opt-in, desligado, nunca em jobs de fundo). O OAuth de terceiros é proibido desde 2026-04-04.
    - Registro dinâmico de modelos (`/v1/models` + models.dev) e papéis `RoleSpec` `pinned | auto` [r5].
12. **Stats leves:**
    - um único stream de eventos de uso por chamada (`{day, domain, connection, provider, model, billing, tokens…}`);
    - *heartbeat* de atividade para horas por dia;
    - US$ só quando `billing='api'`; em assinatura, "créditos estimados" [r5].
13. **Gamificação calibrada por Monte Carlo** [r7]:
    - 1 XP ≈ 1 minuto focado, com dificuldade Elo e *gain* de revisão;
    - nível `XP(L)=20,10·L^1,696` (L10 no dia 7 e L100 no dia 365 a 3 h/dia);
    - tiers Bronze → Doutor por retenção do núcleo canônico (Doutor mediano em 18,2 meses a 3 h/dia);
    - soft cap, sem XP negativo, ligas desligadas por padrão.
14. **UI cel-shading "Papel/Noite"** [r9]:
    - 7 leis (luz única, tinta 2/1,5/3/4 px, até 3 tons chapados, sombra dura);
    - acentos volt `#FFD23F` (Eletrônica) e coral `#FF7A59` (Inglês);
    - **compilador de ícones** determinístico (`scripts/icons/compile.ts`, perfect-freehand + polygon-clipping, 0,28–2,4 KB por ícone).
15. **Formalização em duas camadas** [r10]:
    - modelo em **Lean 4 (v4.36.0 + Mathlib)** rodando **só no CI** (`lh-check` + auditoria de axiomas);
    - no app, **invariantes em runtime + certificados** (Kahn + checker, Pearce–Kelly semeado), testados por **fast-check** e por teste diferencial TS × Lean.
    - `validate` completo leva 33 ms com 20k nós.

**MVP utilizável (Inglês + Eletrônica)** = M0–M3, cerca de 6–8 semanas: domínios, stats, currículo semeado, learner model, aula orquestrada e "o que estudar agora". Flashcards (M4) e memória (M5) vêm logo em seguida (§6).

---

## 1. Visão de produto e princípios didáticos

### 1.1 Visão

O app é um **tutor pessoal desktop (Electron + Next) de longo prazo**. Cada domínio é um mundo isolado com:

- um **grafo-árvore massivo**, do básico ao doutorado, com cerca de **1.000–1.500 h** de trilha;
- trilha de Eletrônica ≈ 2.200 átomos ≈ 1.480 h; trilha de Inglês ≈ 1.160 nós ≈ 1.480 h B1 → C1/C2 [r3 §5].

O grafo cresce **sob demanda**: só o que está perto da fronteira do aluno é materializado. Cada nó é ensinado por:

- uma **aula de IA curta e ativa**;
- um **vídeo** curado (PT, ou EN com legenda ou dublagem automática);
- uma **seção de livro aberto ou do próprio usuário**.

A retenção é garantida por SRS no nível do nó (FSRS-7 + FIRe) e por flashcards exportáveis. O progresso é mostrado com honestidade:

- XP ≈ minutos focados;
- tiers ≈ retenção real;
- horas por dia e tokens por modelo.

Tudo é local por padrão.

| Meta do usuário | Onde é resolvida | Marco |
|---|---|---|
| 1. Grafo massivo + aulas + livros + vídeos + expansão + evolução formal | §2.6, §2.8, §2.13, §2.4e | M2, M3, M6, M9 |
| 2. Memória SOTA | §2.5 | M5, M11 |
| 3. Sessões isoladas por domínio | §2.2 | M1 |
| 4. Flashcards → Anki/Obsidian | §2.4d | M4 |
| 5. XP, níveis, rankings (Monte Carlo) | §2.11 | M7 |
| 6. Stats de tokens e horas | §2.10 | M1 |
| 7. IA por assinatura, sem IDs fixos | §2.9 | M0, M10 |
| 8. UI cel-shading com ícones à mão | §2.12 | M8 |
| 9. Ensino que não cansa | §1.2–1.4 | M3 |

### 1.2 Princípios didáticos, com evidência

| # | Princípio | Regra operacional (implementada em código) | Evidência e fonte |
|---|---|---|---|
| P1 | **Estrutura imposta pela plataforma** | O `LessonOrchestrator` chama o LLM **por fase**. O prompt nunca precisa "lembrar" a sequência. | Kestin et al. 2025: "a system prompt could not reliably provide enough structure" [r1 §0.4] |
| P2 | **Não perguntar demais** | `TurnBudget`: no máximo 1 pergunta por mensagem; no máximo 2 turnos seguidos terminando em pergunta; no máximo 3 perguntas conversacionais por nó; socrático em no máximo 2 rodadas. Ficam proibidos "faz sentido?", "entendeu?" e "ótima pergunta". | RCT Eedi/Google 2026 (N=1.179): 29,5% pediram para sair cedo, e os supervisores intervinham para "deixar seguir" [r1 §0.2, §6.13] |
| P3 | **Checar por KP, não por frase** | Cada *knowledge point* tem exemplo resolvido, passos com lacunas (faded) e 2–5 problemas. A regra atual "one check per reasoning step" (`docs/teaching-methodology.md` §9, `src/agent/prompts/teacher/20-teaching.md`) **muda**. | VanLehn 2011: ITS por passo d=0,76; por subpasso d=0,40 [r1 §0.6] |
| P4 | **Perguntas de "fazer"** | A prática é resolução ativa. Não há perguntas meta nem **seção de reflexão obrigatória** (rejeitamos a do BloomTutor). | Math Academy: 95% passam de primeira [r1 §0.7][bt] |
| P5 | **Dificuldade-alvo de 80–85%** | O item é escolhido por Elo para `E≈0,8`. | Regra dos 85% (Wilson 2019); Math Academy ~80% [r1 §0.9][r7] |
| P6 | **Nunca reter informação de forma improdutiva** | Escada de dicas: pista → princípio → próximo passo → solução. A resposta é entregue após 2 tentativas ou a pedido. | Bastani PNAS 2025: GPT cru teve −17% na prova; "GPT Tutor" neutralizou [r1 §0.1, §0.10] |
| P7 | **Soluções verificadas** | Eletrônica usa solver ou simulador (`verifiedBy:'solver'\|'simulator'`). Inglês usa chave de referência. O gabarito fica congelado no servidor e é escondido do cliente quando o item vale XP. | Harvard/Eedi [r1 §0.5]; `prepare_assessment` [tmcp]; `correct_index` vazado [clew §12.8] |
| P8 | **"Por quê" antes de "o quê"; 1–2 conceitos por aula** | O gancho (puzzle, fenômeno, história, contraste) é uma lacuna que a aula resolve. A revisão de abertura tem no máximo 170 palavras. | [bt] regras anti-tédio aplicadas por código; narrativa relevante g=0,55 e detalhes sedutores prejudicam [r1 §0.12] |
| P9 | **Espaçar + recuperar + intercalar** | FSRS-7 por nó + FIRe (crédito implícito). Intercalação **sim** em procedimentos de Eletrônica e **não** em listas de palavras. | testing g≈0,61; interleaving g=0,42 em geral e **−0,39 em palavras** [r1 §0.11] |
| P10 | **Flashcards no fim, não no meio** | 2–6 cartões por nó, incluindo os de "erro capturado", com aprovação em lote de 60–90 s. | [r1 §0.13][r7] |
| P11 | **Blocos e fadiga** | Blocos de 25–50 min alternando domínios. `FatigueState` (latência / linha de base, erros fáceis nos últimos 5, pedidos de pular) dispara troca de formato ou pausa. Menos de 20 min desperdiça tempo. | [r1 §0.14] |
| P12 | **Modo contínuo > interação forçada** | No máximo 1 interação forçada a cada 3 min; nunca duas checagens consecutivas; cenas de no máximo 180 s e 220 palavras faladas. | Estudo OpenMAIC: alunos preferiram o contínuo [maic] `outline-constraints.json` |
| P13 | **Memória vira decisão, não texto no prompt** | O histórico alimenta a escolha de item, nó e remediação. O prompt recebe só um *snapshot* de ~300 tokens. | Eedi 2026: contexto personalizado ≈ contexto da questão [r1 §0.3][r4 §0.5] |
| P14 | **Nenhum gasto de modelo sem consentimento** | Chamada só após clique **ou** dentro de um orçamento de fundo explícito por domínio (§2.9). | [bt] "no model call without a click", com teste |
| P15 | **Inglês começa por input** | Vídeo ou texto com cobertura de vocabulário conhecida (`CoverageReport.band ∈ extensive\|intensive\|too_hard`). Dublagem é excluída; áudio EN original é exigido. | [r1 §8][r6] |
| P16 | **Uma sugestão por vez** | A tela "Hoje" mostra **um** próximo passo, com alternativas recolhidas. | [r6][bt-ui] |

### 1.3 Protocolo de aula por nó (fases de `src/core/lesson/protocol.ts`)

`prepare → orient → (predict) → warmup → explain(1–3 segmentos) → worked → faded → practice → (variation) → recap → cards → exit`, com desvio `remediate` [r1 §6.13].

- **prepare.** Um `LessonPlan` é gerado uma vez por `(nodeId, version)` pelo papel `tutor` e validado por zod. Ele traz:
  - `goal`, `hook`;
  - `segments[1..3]` de 120–250 palavras;
  - `knowledgePoints[2..4]` com `passRule {lastNCorrect:2, window:3, minInWindow:2, maxItems:5}`;
  - `misconceptions`, `flashcardCandidates`, `encompasses`, `sources`.
- **Orçamento de palavras por fase:** orient 90, explain 250, feedback 50, dica 35, recap 60 [r1].
- **Validação de cadência.** `violatesBudget()` é determinístico. Se houver violação, faz-se **uma** reescrita pelo papel `cheap`. A revisão independente com edições exatas do BloomTutor é opcional e cara.
- **Inglês:**
  - arestas majoritariamente suaves;
  - proficiência estilo IRT na escala GSE;
  - itens `speak`, `dictation`, `minimal_pair_discrimination`;
  - TTS kokoro e ASR whisper.cpp opcionais [r8][r3 §11.4].
- **Eletrônica:**
  - `NumericTemplate` com tolerância;
  - `CircuitApi` com simulador (EEcircuit/ngspice WASM, MIT; circuitjs1 GPL-2.0-or-later é compatível via GPLv3);
  - wavedrom e netlistsvg para figuras [r1 §9][r8].

### 1.4 Anti-padrões proibidos

- Estes padrões ficam proibidos:
  - pergunta embutida no meio da explicação;
  - "quiz surpresa" após cada parágrafo;
  - elogio performático;
  - reter a resposta mais de 2 tentativas;
  - reflexão obrigatória;
  - colegas virtuais por padrão (OpenMAIC "classmates" só como opção pós-MVP);
  - celebração detectada por diff no cliente (emitir eventos `node.attained` e `xp.awarded` no servidor) [dt-web];
  - ligas competitivas reais por padrão;
  - XP negativo;
  - XP que depende da autoavaliação Again/Hard/Good/Easy [r7].
- Em jogos de recompensa, recompensas contingentes reduzem a motivação intrínseca (Deci/Koestner/Ryan d=−0,40/−0,36/−0,28), enquanto o feedback **informativo** tem efeito de +0,33 [r7].

---

## 2. Arquitetura-alvo sobre o learnharness

### 2.0 Ponto de partida (verificado no repositório)

**Stack:**

- Next 16.4.3, React 19.2.8, Tailwind 4.3.3, shadcn, lucide-react 1.33.0;
- Electron 44.9.3 (Node 24.22.0, Chromium 152);
- `pi-ai` / `pi-agent-core` 1.4.0 (a última é 1.5.2);
- zod 4, `@xyflow/react` 12, motion 13.1.1, `pdfjs-dist` ^6.3.289 [lh-*].

**Camadas impostas por `eslint.config.mjs`:**

- `src/core/**` é puro e nunca importa agent, server ou store;
- adapters implementam `src/core/ports.ts`;
- a composição acontece em `src/server/stores.ts`;
- `components/**` importa **só** `@/src/core`;
- `app/**` importa só `@/src/core` e `@/src/server`.

**O que já existe e reaproveitamos:**

| Peça | Arquivo(s) |
|---|---|
| Grafo de proposições L3 (JSONL) | `src/core/contracts/graph.ts`, `src/store/graph.ts`, `src/store/graph-format.ts` |
| Escrita atômica | `src/store/atomic-write.ts` |
| Plano de sessão em árvore | `src/core/plan-tree.ts` (`createsCycle` O(E·(V+E)), padrão `PlanTreeError`), `src/agent/tools/plan.ts` |
| Agentes prober / teacher / practice | `src/agent/teacher-agent.ts`, `src/agent/tools/practice.ts`, `src/core/practice-problems.ts` |
| Pergunta que encerra o turno | `src/agent/tool-execute.ts` (`questionResult()` com `terminate:true`) |
| Jobs em background | `src/server/jobs.ts`, `src/store/jobs.ts` |
| Plugins API v1 | `src/server/plugin-host.ts`, `src/store/plugin-data-paths.ts`, `plugins/flashcards/` (FSRS-6 vendorizado de ts-fsrs 5.2.3 em `plugins/flashcards/src/scheduler.cjs`, histórico em `state.reviews`) |
| Documentos e PDF | `src/server/plugin-documents.ts` (limite 25 MiB), `src/agent/subagents/pdf-markdown.ts` |
| Compactação | `src/core/compaction.ts`, `src/server/compaction.ts` |
| SIWC (ChatGPT) | `electron/chatgpt.cjs`, `src/agent/chatgpt-bridge.ts`, `chatgpt-stream.ts`, `chatgpt-request-cycle.ts` |
| Claude via CLI | `src/agent/claude-code/provider.ts`, `src/server/claude-code.ts` |
| Assinaturas | `electron/subscription-store.cjs`, `src/agent/subscription-*.ts`, `src/server/web-subscriptions.ts` |
| Catálogo e preços | `src/server/model-catalog.ts`, `src/core/prices.ts`, `src/core/cost-summary.ts`, `src/server/pricing.ts` |
| Uso por turno | `TurnUsage` / `CallUsage` (não há horas de estudo) |
| Temas | `src/store/themes.ts`, `src/server/theme-boot.ts` |
| Diretório de dados | `LH_DATA_DIR` (`config.ts`, `electron/main.cjs`, `src/store/settings.ts`) |

**Lacunas encontradas e corrigidas em M0** [r5][lh-agent]:

- `refreshChatGPTModels` (`src/agent/chatgpt-bridge.ts`) **descarta** slugs desconhecidos pelo pi-ai.
- `CLAUDE_CODE_MODELS` está fixo em `src/agent/claude-code/provider.ts`.
- `chatGPTStreamError` mapeia erros por regex em vez de `error.code`.
- As credenciais são JSON em claro (`fileStore` em `electron/chatgpt.cjs` e `electron/subscription-store.cjs`), sem ACL no Windows.
- `agent_name_hint: "LearnHarness"` (~l.339 de `electron/chatgpt.cjs`).
- O texto "5–15 nodes" em `src/agent/tools/plan.ts:71`.

### 2.1 Módulos novos e alterados (caminhos concretos)

> **Mapeamento de nomes:** o pedido cita `src/curriculum/**`, `src/memory/**`, `src/learner/**`, `src/resources/**` e `src/gamification/**`. Para **não violar as fronteiras de lint existentes**, cada um vira uma fatia vertical por camada:
>
> - `src/core/<x>/**` (puro, testável, browser-safe);
> - `src/store/<x>/**` (I/O);
> - `src/server/<x>.ts` (serviço e composição);
> - `src/agent/tools/<x>.ts` (ferramentas do agente).
>
> "gamification" se chama `progress`, como em [r7].

```
src/core/
  domains/        types.ts paths.ts manifest-schema.ts                      [NOVO] DomainManifest, DomainId, layout
  curriculum/     types.ts schema.ts invariants.ts rank.ts frontier.ts      [NOVO] r3+r10
                  patch.ts (applyPatch) certificate.ts (Kahn+checker+PK) hours.ts
                  transitive.ts granularity.ts errors.ts (CurriculumError) triggers.ts budget.ts
  learner/        types.ts params.ts emission.ts bkt-fsrs.ts kst.ts          [NOVO] r2
                  propagate.ts (FIRe) dina.ts misconceptions.ts planner.ts fold.ts
                  snapshot.ts calibration.ts signals.ts (Estimated/Retained/Demonstrated)
  lesson/         protocol.ts (Phase, LessonPlan, KnowledgePoint, PracticeItem) [NOVO] r1
                  budget.ts (TurnBudget, violatesBudget) orchestrator.ts (máquina de estados pura)
                  fatigue.ts grading.ts (numérico/mcq determinístico)
  memory/         types.ts rrf.ts mmr.ts decay.ts supersede.ts assemble.ts ops.ts  [NOVO] r4 (+MemoryOp do DeepTutor)
  resources/      types.ts (=r6 src/core/resources.ts) score.ts mmr.ts language-fit.ts   [NOVO] r6
                  setcover.ts (livro-espinha) segments.ts (20–90 s)
  progress/       types.ts xp.ts levels.ts elo.ts tiers.ts streak.ts rules.ts  [NOVO] r7 (glicko2.ts só se ligas)
  stats/          types.ts aggregate.ts                                       [NOVO] r5 UsageEvent + ActivityEvent
  models/         registry-types.ts role-spec.ts resolve.ts                   [NOVO] r5 (puro)
  plan-tree.ts                                                                [ALTERADO] PlanNode.id = id do currículo
src/store/
  domains.ts curriculum.ts (ledger JSONL + snapshot) learner-store.ts          [NOVO]
  memory/ sql-driver.ts (node:sqlite → fallback better-sqlite3) schema.sql memory-db.ts   [NOVO]
  progress-store.ts stats-store.ts credential-store.ts (safeStorage)           [NOVO]
  plugin-data-paths.ts settings.ts                                            [ALTERADO] caminhos por domínio
src/server/
  domains.ts (registro + domínio ativo + quiesce)  curriculum.ts  learner.ts  lesson.ts   [NOVO]
  memory-worker.ts embed-worker.ts (utilityProcess/worker_threads)            [NOVO]
  resources/ youtube-data.ts youtube-enriched.ts openstax.ts libretexts.ts otl.ts      [NOVO]
             openlibrary.ts crossref.ts arxiv.ts doab.ts wikibooks.ts user-library.ts safe-fetch.ts
  model-registry/ index.ts sources/{chatgpt,anthropic-api,claude-code,openrouter}.ts   [NOVO, absorve model-catalog.ts]
             metadata/{models-dev,litellm,openrouter,pi,estimated}.ts cache.ts
  stats.ts progress.ts                                                        [NOVO]
  jobs.ts                                                                     [ALTERADO] novos tipos de job + orçamento
  chat-handler.ts turn-preparation.ts                                         [ALTERADO] ContextAssembler, domínio ativo
src/agent/
  json-call.ts (extractJSON/runJSON com re-pergunta corretiva; port CC0 de gen-mentor)  [NOVO]
  tools/curriculum.ts tools/memory.ts tools/learner.ts tools/resources.ts      [NOVO]
  subagents/curriculum-{seeder,expander,critic,judge}.ts lesson-planner.ts grader.ts
            flashcard-writer.ts memory-{extractor,consolidator}.ts video-rubric.ts book-mapper.ts   [NOVO]
  chatgpt-bridge.ts chatgpt-stream.ts claude-code/provider.ts                  [ALTERADO] M0
  prompts/teacher/*.md                                                         [ALTERADO] P2–P4
electron/
  main.cjs (Referer no onBeforeSendHeaders único; app.setName)  chatgpt.cjs  subscription-store.cjs  [ALTERADO]
plugins/flashcards/
  src/scheduler.cjs → dependência ts-fsrs@6 (replay)   src/sync-types.ts anki-connect.ts
  obsidian-export.ts apkg-export.ts                                            [ALTERADO/NOVO] r7
components/
  domain-switcher.tsx today/ (card "Hoje") lesson/ (fases, cards de pergunta) stats/ (StatStrip, MiniHeatmap)
  progress/ (XP, insígnias) graph/ (galaxy sigma, região ELK, vizinhança React Flow) icons/ (gerados)   [NOVO]
app/api/
  domains/** stats/** curriculum/** learner/** lesson/** resources/** progress/** models/**   [NOVO]
scripts/
  calibrate-progression.ts icons/compile.ts migrate-data-layout.ts run-tests.mjs   [NOVO]
config/progression.json  resources/model-metadata.snapshot.json                 [NOVO, gerados]
content/curricula/{english,electronics}/** + LICENSE (CC BY-SA 4.0) + NOTICE   [NOVO: DADOS, separados do código AGPL]
formal/  lakefile.lean lean-toolchain LHFormal/*.lean LHFormal/Check.lean (lh-check)   [NOVO] r10
.github/workflows/formal.yml   THIRD_PARTY_NOTICES.md   .gitattributes          [NOVO]
```

### 2.2 Persistência: workspace e domínios

**Workspace** = a raiz `LH_DATA_DIR`, cujo padrão é `userData/data`. **Domínio** = espaço isolado dentro dela. A pasta e os nomes foram unificados a partir de r3 (`data/curriculum/<id>`), r4 (`<userData>/memory/<id>/memory.db`), r6, r7 e [dt]. Esses relatórios divergiam; este é o layout canônico:

```
<LH_DATA_DIR>/
  profile/
    settings.json                      (existente)
    credentials.enc                    (Electron safeStorage → DPAPI no Windows; substitui JSON em claro)
    profile.db                         (memória global: idioma, horários, tom; ≤300 tok injetados read-only) [r4 §7.3]
    stats/usage-YYYY-MM.jsonl          (UsageEvent por chamada) [r5]
    stats/activity-YYYY-MM.jsonl       (heartbeats → horas/dia)
    model-cache/{entitlements.json, metadata.json}   [r5]
  library/<sha256>/                    (PDF/EPUB do usuário + meta.json, toc.json, chunks.jsonl; compartilhado) [r6]
  domains/<domainId>/                  (english | electronics | …)
    domain.json                        (DomainManifest)
    chats/  jobs/  graph/              (estruturas existentes, agora por domínio)
    curriculum/ snapshot.json patches.jsonl rejected.jsonl receipts.jsonl
                embeddings.f32 embeddings.ids.json
    learner/    snapshot.json evidence.jsonl profile.json
    memory/     memory.db (WAL)        [r4]
    resources/  catalog.jsonl coverage.jsonl transcripts/<videoId>.<lang>.json (TTL 30 d) books/<bookId>/…
    progress/   xp-ledger.jsonl streak.json standing.json
    plugins/flashcards/…               (via plugin-data-paths por domínio) + sync-cursor.json
    prompts/                           (overrides por domínio)
```

**Regras:**

- **Isolamento.** Nenhuma consulta cruza arquivos de domínios diferentes.
  - Um pré-requisito de outro domínio (por exemplo, Eletrônica → frações) é uma `external_ref` que lê **só** o snapshot numérico do nó [r4 §7.3].
  - Subdomínios gerados pela expansão ficam no domínio-pai, com prefixo de id (`ee.analog.opamp.*`).
- **Troca de domínio:**
  - **MVP (M1):** trocar o domínio grava `activeDomain` e reinicia o servidor interno, padrão `LH_DATA_DIR` + restart. É simples e seguro.
  - **M3+:** usar *path getters* em vez de constantes + **quiesce-and-switch** via `POST /api/workspaces/active`. A rota responde **409** se houver turno ou job ativo; senão fecha os handles (memória com LRU de 2) e reabre.
  - Rejeitamos o padrão de remontar o workspace por `key` do React [dt-web].
- **Concorrência.** Há **escritor único** por arquivo:
  - o currículo usa a fila de jobs + mutex em processo;
  - a memória usa o `MemoryWorker` com conexão de escrita e leitores read-only em WAL [r4 §7.10][clew §12.12].
- **Migração.** `scripts/migrate-data-layout.ts` é idempotente e move o layout atual para `domains/default/`.
- **XP.** O ledger fica **por domínio**. O **nível** é global (soma de todos os domínios). O **tier** é por domínio. Essa é a minha resolução: o r7 define as camadas sem fixar onde o nível vive.

### 2.3 Schemas TypeScript por domínio (contratos canônicos)

```ts
// src/core/domains/types.ts
export type DomainId = "english" | "electronics" | (string & {});
export interface DomainManifest {
  schemaVersion: 1; id: DomainId; nodePrefix: string;          // "en" | "ee"
  title: { pt: string; en: string }; accent: "coral" | "volt" | string;
  levelScheme: "cefr" | "ee"; targetHours: { lo: number; hi: number };   // 1000–1500
  edgeMode: "strict" | "relaxed";                                // r10; default strict
  reviewClient: "app" | "anki";                                  // r7
  roles?: Partial<Record<ModelRole, RoleSpec>>;                  // override por domínio (r5)
  backgroundBudget: { tokensPerDay: number; enabled: boolean };  // P14
  resourcePolicy: DomainResourcePolicy;                          // r6
}
```

```ts
// src/core/curriculum/types.ts — funde r3 (CurriculumNode) e r10 (clauses/hours/rank)
export type Hours = { lo: number; hi: number };
export type NodeKind = "domain" | "area" | "unit" | "topic" | "atom";
export type AtomType = "concept" | "procedure" | "lexical_set" | "phoneme_contrast" | "can_do"
  | "practice_regime" | "lab" | "design_project" | "checkpoint";
export type NodeStatus = "stub" | "proposed" | "provisional" | "stable" | "deprecated";
export interface AnchorRef { source: string; ref: string; span?: string; embeddable: boolean; evidence?: string }
export interface CurriculumItem {
  id: string;                        // imutável: "ee.an.amp.ce-small-signal-gain.7f3a"
  domainId: DomainId; kind: NodeKind; atomType?: AtomType; parentId: string | null; // part_of (floresta)
  title: { pt: string; en: string }; aliases: string[];
  scope: string;                     // contrato de escopo: dentro/fora
  summary: string; objectives: string[]; bloom?: string; assess: string[]; misconceptions?: string[];
  level: { scheme: "ee"; band: 0|1|2|3|4 } | { scheme: "cefr"; cefr: string; gse?: number };
  clauses: string[][];               // CNF: AND de cláusulas OR; [] = item de entrada (r10)
  rank: number;                      // toda cláusula aponta para rank menor (R2)
  hours: Hours;                      // folha: hi ≤ 4 h; átomo: 10–45 min (granularidade r3)
  softPrereqs: string[];             // builds_towards (ordena, não bloqueia)
  encompasses: { id: string; w: number }[];  // FIRe 0..1
  anchors: AnchorRef[]; status: NodeStatus; version: number;
  estMinutesObserved?: { mean: number; n: number };
  lexicalItems?: { lemma: string; pos?: string; cefr?: string; ngslRank?: number }[];
  practice?: { targetHours: number; exitCriterion: string };
  provenance: { createdBy: "seed"|"expansion"|"user"|"import"; trigger?: string; model?: string;
                promptVersion?: string; createdAt: string;
                validation?: { dedupMaxSim: number; consensus: number; critic?: string; anchorCoverage: number } };
  aliasOf?: string; supersededBy?: string[];
}
export type EdgeKind = "also_in" | "related" | "confusable_with" | "anchored_to" | "covered_by"; // sem gating
// requires e requiresAnyOf do r3 = VISÕES DERIVADAS de clauses (requires = cláusulas unitárias)

// src/core/curriculum/patch.ts — r10, inalterado
export type ExpansionOp =
 | { op: "addItem"; id: string; title: string; region: string; hours: Hours; clauses: string[][] }
 | { op: "addAlternative"; item: string; clause: string[] }
 | { op: "addPrereq"; item: string; clauseIndex: number; prereq: string }
 | { op: "refine"; item: string; sub: { id: string; title: string; hours: Hours; clauses: string[][] | "entry" }[] }
 | { op: "addSubdomain"; id: string; title: string; items: Extract<ExpansionOp, { op: "addItem" }>[] }
 | { op: "retire"; item: string; reroute: { item: string; clause: string[] }[] }
 | { op: "setHours"; item: string; hours: Hours };
export type ValidationError = { code: "schema"|"cycle"|"unknown-id"|"no-route"|"budget"|"hours-conservation"|"hierarchy";
  message: string; witness?: string[] };
export interface PatchEnvelope {                    // forma de proposta estilo Clew
  patchId: string; domainId: DomainId; baseVersion: number; trigger: TriggerRef;
  ops: ExpansionOp[]; itemPayloads: Record<string, Partial<CurriculumItem>>;  // campos ricos dos addItem
  risk: "low" | "structural"; provenance: { model: string; promptVersion: string; samples: number };
}
// applyPatch(domain, env, learners, budget)
//   → { ok: true; next; certificate: { order: string[]; hash: string }; stateDiffs }
//   | { ok: false; errors: ValidationError[] }
```

```ts
// src/core/learner/types.ts — r2 §9.2 (+ campos de r10 e tmcp)
export type Grade = 0 | 1 | 2 | 3;
export interface FsrsMemory { cardId: string; state: 0|1|2|3; stability: number; stabilityFast: number;
  difficulty: number; lastReviewAt?: string; dueAt: string; reps: number; lapses: number; scheduleStatus: string }
export interface NodeState {
  nodeId: string; pL: number; nEff: number; verified: boolean; fsrs?: FsrsMemory;
  desiredRetention: number;                 // 0,85–0,93
  levelElo: number[]; blame: number; blameAt?: string;
  misconceptions: Record<string, { a: number; b: number; lastSeenAt: string; text: string }>;
  delayedSuccesses: number; lastEvidenceAt?: string;
  attainedAt?: string;                      // MONOTÔNICO (r10): 1ª vez pL ≥ 0,85 com evidência direta
  masteredAt?: string;                      // pL ≥ 0,95 ∧ ≥2 itens distintos ∧ ≥1 recuperação ≥24 h sem dica
}
export interface Evidence {
  id: string; seq: number; at: string; domainId: string; sessionId: string;
  itemId: string; itemFamily: string; nodes: { nodeId: string; q: number; primary?: boolean }[];
  format: "mcq"|"numeric"|"short"|"derivation"|"explain"|"flashcard"|"dialogue"; level: 1|2|3|4|5;
  grade: Grade; graderConfidence: number; hints: number; latencyMs?: number;
  minutesSinceExposure: number; attributions?: { nodeId: string; blame: number; misconceptionId?: string }[];
  predicted?: number; weight?: number;      // flashcard = 0,3
}
```

```ts
// src/core/memory/types.ts — r4 §7.5 (resumo) + ops de mental model do DeepTutor
export type FactKind = "world"|"experience"|"learner"|"preference"|"misconception"|"goal"|"affect"|"plan";
export interface RecallContext { domainId: string; sessionId: string; query: string; focusNodes: string[];
  now: number; budgetTokens?: number; mode?: "auto"|"skip"|"deep"|"historical"; sessionOnly?: boolean }
export interface MemoryService {
  open(domainId: string): Promise<void>;
  ingestTurn(t: { sessionId: string; role: "user"|"assistant"|"tool"; text: string; ts: number; nodeIds: string[] }): void;
  recall(ctx: RecallContext): Promise<{ items: MemoryItem[]; rendered: string; tokens: number; ms: number }>;
  stablePrefix(domainId: string, sessionId: string): Promise<{ text: string; tokens: number }>;
  endSession(sessionId: string): Promise<void>;   // extração final + consolidação + candidatos a flashcard
  consolidate(opts?: { budgetTokens?: number }): Promise<void>;
  forget(sel: ForgetSelector, mode: "soft"|"hard"): Promise<{ affected: number }>;
  exportMarkdown(dir: string): Promise<void>;      // mental models → vault Obsidian
}
export type MentalModelOp =   // [dt]: entradas ≤240 chars, id m_ULID, refs em nota de rodapé
  | { op: "add"; section: string; text: string; refs: string[] }
  | { op: "edit"; targetId: string; newText: string; newRefs: string[] }
  | { op: "delete"; targetId: string; reason: "contradicted"|"superseded"|"stale"|"low-signal" };
```

```ts
// src/core/resources/types.ts — r6 (nomes canônicos); campos essenciais
export type ResourceKind = "video" | "book_section" | "article" | "ai_lesson";
export type TosClass = "official_api" | "embed_only" | "open_license" | "user_owned" | "metadata_only" | "opt_in_gray";
export interface Resource { id: string; provider: ProviderId; kind: ResourceKind; title: string; lang: string;
  audioLang?: string; captions?: { lang: string; kind: "manual"|"asr"|"auto-dub" }[]; durationSec?: number;
  license: License; access: ResourceAccess; tos: TosClass; locator: Locator; channelId?: string; fetchedAt: string; ttlDays?: number }
export interface CoverageLink { resourceId: string; nodeId: string; span?: { startSec?: number; endSec?: number; pages?: string };
  score: number; method: "embed+bm25+rrf+llm" | "toc" | "manual"; provisional: boolean }
export interface ResourceProvider { id: ProviderId; status(): Promise<ProviderStatus>;
  search(q: ResourceQuery): Promise<Resource[]>; resolve(id: string): Promise<Resource>;
  toc?(id: string): Promise<TocEntry[]>; content?(id: string, span?: Span): Promise<ContentChunk[]> }
```

```ts
// src/core/progress/types.ts — r7
export type ProgressEvent =
  | { kind: "lesson"; nodeId: string; focusedMin: number } | { kind: "media"; resourceId: string; focusedMin: number }
  | { kind: "item"; itemId: string; theta: number; b: number; correct: boolean; focusedMin: number }
  | { kind: "review"; nodeId: string; R: number; focusedMin: number } | { kind: "diagnostic"; items: number };
export interface XpLedgerEntry { id: string; eventId: string; at: string; domainId: string; raw: number;
  capped: number; rulesVersion: "2026-11-r1"; reason: string }   // idempotente por eventId (padrão mathua)
```

```ts
// plugins/flashcards/src/sync-types.ts — r7
export interface ExternalLink { cueId: string; propositionId: string; domainId: string;
  anki?: { noteId: number; cardIds: number[]; noteType: string; deck: string; contentHash: string; pushedAt: string; mtime: number };
  obsidian?: { path: string; anchor: string; contentHash: string; writtenAt: string } }
export interface RevlogEntry { id: `app:${string}` | `anki:${number}`; propositionId: string; cueId: string;
  at: string; rating: 1|2|3|4; durationMs: number; origin: "app" | "anki" }
export interface SyncCursor { ankiLatestRevlogId: number; ankiProfile: string; apiFlavor: "v1" | "v6" }
```

```ts
// src/core/stats/types.ts — r5 + heartbeat
export type BillingKind = "subscription" | "api" | "local";
export interface UsageEvent { day: string; at: string; domain: string; op: string;   // op: "tutor"|"grader"|"extractor"|…
  connection: string; provider: string; model: string; billing: BillingKind;
  inputTokens: number; cachedTokens: number; outputTokens: number; reasoningTokens: number; durationMs: number }
export interface ActivityEvent { at: string; domain: string; kind: "lesson"|"practice"|"review"|"media"|"reading"; activeSec: number }

// src/core/models/role-spec.ts — r5
export type ModelRole = "tutor"|"grader"|"planner"|"curriculum"|"critic"|"extractor"|"judge"|"observer"
  |"consolidator"|"flashcards"|"vision"|"rubric";
export type RoleSpec =
  | { kind: "pinned"; provider: string; id: string; thinkingLevel?: string }
  | { kind: "auto"; prefer: "strongest"|"cheapest"|"fastest"; connection?: string;
      require?: { reasoning?: true; input?: string[]; minContext?: number; billing?: BillingKind[] } };
```

### 2.4 Fluxos

#### (a) Início de sessão

1. O usuário escolhe o domínio no `DomainSwitcher`. `POST /api/domains/active` abre o currículo (snapshot + cauda do ledger), o learner store, o `MemoryService.open(domainId)` e o perfil de progresso.
2. O **planner** (`src/core/learner/planner.ts`) é **determinístico e sem LLM**. Ele monta o plano da sessão a partir do orçamento diário (`DomainProfile.dailyBudgetMin`):
   1. revisões vencidas ordenadas por `I_k·(1−R_k)`, comprimidas por nós-veículo FIRe;
   2. nós novos ∈ **fronteira estrutural ∩ plano rumo à meta**, ponderados por prontidão × valor de desbloqueio `U` (γ=0,6), com importância `I_k = 1 + α·goal + β·log(1+|desc|)`;
   3. remediação;
   4. sondas de nós inferidos.

   Um controlador limita os nós novos por dia pela carga de revisão projetada [r2 §9.9].
3. O **card "Hoje"** (≤170 palavras, [bt]) mostra:
   - "retomada" vinda do diário: *Mission / Last session / next_focus* [dt];
   - **uma** sugestão (nó + formato: aula IA, vídeo ou seção de livro);
   - minutos previstos;
   - revisões pendentes.

   Montar o card não chama modelo. O conteúdo vem de snapshot e cache.
4. Clique em "Começar" → aquecimento de revisões (3–5 min) → aula do nó.

#### (b) Aula por nó (`LessonOrchestrator`)

```
[clique] → prepare: LessonPlan (cache por nodeId@version; papel tutor; zod via runJSON com 1 re-pergunta)
         → orient (gancho + objetivo, ≤90 palavras) → predict? (card) → warmup (itens FIRe)
         → explain[1..3] (≤250 palavras; visual SVG/circuito/tabela/áudio; analogia com "onde quebra")
         → worked → faded (lacunas) → practice (KP.passRule) → variation? → recap (≤60) → cards → exit
         ↘ remediate (misconception detectada ou 2 falhas no KP) → segmento curto + item-ponte → volta
```

- Cada fase gera **uma** chamada (ou nenhuma, se o conteúdo já está no `LessonPlan`). O turno passa por `violatesBudget()`; se houver violação, faz-se 1 reescrita barata.
- Contexto do turno, na ordem estável → dinâmico, para *prompt caching* [r4 §7.7]:
  1. system do tutor;
  2. perfil global (≤300);
  3. mental models (≤1.000);
  4. snapshot do learner dos nós em foco (≤300);
  5. observation log da sessão (≤8.000);
  6. **fronteira de cache**;
  7. memória recuperada (≤2.000);
  8. cauda crua;
  9. fala atual.
- O grafo **nunca** entra inteiro. Entram só a vizinhança (nó, ancestrais, fronteira, região) e a busca sob demanda (`curriculum_search`) [clew §12.1].
- Recursos aparecem como "trilho" ao lado: vídeo ≤12 min de intuição, depois seção do livro-espinha. Nunca mais de uma sugestão por vez [r6].

#### (c) Prática

1. O item vem do `pool` do KP. O alvo de dificuldade é `E = 1/(1+10^((b−θ)/400)) ≈ 0,8` [r7].
2. A correção depende do tipo:
   - **determinística** para `mcq` e `numeric` (tolerância rel/abs, unidade);
   - **simulador** para `sim` (Eletrônica);
   - **rubrica LLM** (papel `grader`, zod) para `short`, `free`, `explain`, `speak`. Ela devolve `{grade 0–3, confidence, nodes Q, attributions, misconception?}`.
3. O resultado vira `Evidence` (append em `learner/evidence.jsonl`) e passa por `fold`: atualização BKT×FSRS, projeção de Fréchet `P(L_b) ≤ P(L_a)+ε` e propagação FIRe/culpa (h ≤ 3).
4. O `ProgressEvent{kind:"item"}` gera XP pelo ledger.
5. Dicas seguem a escada de 3 níveis. A solução é revelada após 2 tentativas, e o item revelado gera evidência com `hints`.
6. O gabarito congelado fica no servidor [tmcp]. O cliente só recebe `correct_index` em itens formativos sem XP [clew].
7. Gates por tipo de nó [dt]:
   - memória/procedimento: ≥0,9 nos itens quantitativos;
   - conceito/projeto: uma **explicação estilo Feynman** avaliada por rubrica.

#### (d) Fim de sessão → flashcards → Anki/Obsidian

1. **Gatilhos:** "Encerrar", fim de bloco (25–50 min) ou inatividade de 20 min. Os passos 2–3 rodam **dentro do orçamento de fundo consentido** (P14).
2. `MemoryService.endSession` faz extração final (papel `extractor`, `quote` verificado na fonte), juiz de supersessão, Observer/Reflector e consolidação (observations + 4 mental models: *Estado atual, Pontos fracos, Próximos passos, Preferências*). O diário recebe `next_focus` [r4][dt][hind].
3. Candidatos a cartão:
   - `LessonPlan.flashcardCandidates` + erros capturados + itens errados;
   - `flashcard-writer` (papel `flashcards`): 2–6 por nó;
   - dedup por embedding contra os cartões existentes;
   - tipos Basic, Cloze, Reverse, Type e EN Audio (`{{tts en_US:…}}`) [r7].
4. **Aprovação em lote** (60–90 s): aceitar, editar ou descartar. Os aceitos vão para o plugin flashcards (proposição + cues, FSRS-7 via `ts-fsrs@6`).
5. **Export:**
   - **Obsidian** (espelho de mão única):
     - nota por região `LearnHarness/<Domínio>/<Região>.md`;
     - formato do plugin *Spaced Repetition* (pergunta multilinha com `?`, `==cloze==`);
     - comentário-âncora `<!--lh:id=…-->`;
     - **nunca** escrever `<!--SR:-->`;
     - escrita atômica com staging + rename no-replace [clew ADR-0008].
   - **Anki** (se `reviewClient='anki'` ou push habilitado):
     - AnkiConnect 26.11.15.0 **API v1** (`POST http://127.0.0.1:8765/api/v1`, JSON-RPC, ≤100 itens por lote), com fallback para v6 em `/`;
     - chamado **do backend Node**;
     - 1º campo `LH_ID` (a API v1 não tem GUID);
     - deck `LearnHarness::<Domínio>::<Região>` e tags `lh::dom::<id>`.
     - Se o Anki estiver fechado: `.apkg` via `anki-apkg-export@5.0.0` (MIT, sql.js, `noteId` estável).
   - **Revlog do Anki:** importado pelo `SyncCursor`, vira `Evidence{format:"flashcard", weight:0.3}` no learner.
6. **Card de resumo** (≤4 linhas, [r7]): minutos focados, XP, nós aprendidos, `next_focus`. Eventos `node.attained` e `xp.awarded` são emitidos pelo servidor.

#### (e) Expansão procedural do grafo

```
gatilho determinístico (src/core/curriculum/triggers.ts)
  · fronteira próxima: |fronteira ∩ plano| < k ou distância ≤ 2 de um stub
  · ponto fraco: blame/misconception recorrente sem nó-ponte
  · pedido explícito do aluno (curriculum_request_expansion)
  · lacuna de cobertura: seção de livro órfã (r6 map-book) ou âncora sem nó
→ orçamento lexicográfico (budget.ts) [r10]: (prioridade do gatilho, profundidade, custo estimado) + teto diário de tokens do domínio
→ job curriculum-expand (src/server/jobs.ts):
    1 contexto (escopo do pai, irmãos, vizinhos, âncoras, seções de livro)
    2 geração estruturada com k amostras (papel curriculum)
    3 consenso → 4 dedup (embedding cos + juiz) → 5 validação de arestas bidirecional com prob. float (papel critic, de preferência outro provedor)
    6 PatchEnvelope (ExpansionOp[]) → applyPatch: zod → clone → invariantes → migração de estados → certificado → append patches.jsonl
       (rejeição → rejected.jsonl com ValidationError[] e witness; 1 re-pergunta corretiva ao modelo)
    7 risco: "low" (addItem/refine de folha dentro de região existente, sem tocar em nó stable) → auto-apply com recibo + undo visível
             "structural" (addSubdomain, retire, addAlternative em nó stable, setHours > 25%) → card de prévia para o usuário
→ pós-apply: relink_nodes (memória), relink-resources, curate-node lazy (só quando o nó entra na fronteira)
→ "ondas" [mathua]: novas regras de expansão rodam primeiro em modo piloto (shadow) numa região antes de valer no domínio todo
```

- **Seed (fase 1).** O seed integral custaria ~15–20 M tokens por domínio [r3 §11.2]. Por isso o seed tem 2 etapas:
  1. **esqueleto barato a partir de âncoras**: áreas, unidades e tópicos como `stub` com título e escopo. Em Eletrônica: ModEL (~225 módulos), lista NCEES FE (17 áreas), OpenStax Física. Em Inglês: CEFR-J VP 7.799 + GP ~500, NGSL 2.809, Octanove C1/C2 2.136;
  2. **átomos materializados só nas 2 primeiras áreas** de cada domínio.

  O usuário revê o diff da fase 1 e depois uma amostra semanal de 20 arestas [r3 §11.1].

### 2.5 Memória SOTA escolhida

**Decisão:** implementação **TypeScript nativa, in-process, raw-first**, conforme [r4], com ideias do Hindsight [hind]:

- bank = domínio;
- retain / recall / reflect;
- observations com `proof_count`;
- mental models por delta.

**Por quê:**

- Em harness neutro, o "SOTA" auto-reportado desaba. No OmniMemEval, LME-S: Mem0 56,0%, Hindsight 72,2%, Letta 77,7%, MemOS 89,2%.
- O piso "SQLite + FTS + vetor + tempo" chega a **87–90% em LME-S com 4–5k tokens** (CPersona, cachly, LCM-X) [r4 §0.3].
- O Hindsight self-reporta 94,6% em LME-S, mas exige Python + Postgres e injeta 24–43k tokens por consulta.

**Camadas:**

| Camada | Conteúdo |
|---|---|
| L0 | `messages` crus (escrita síncrona <5 ms) |
| L1 | `episodes` |
| L2 | `facts` **bitemporais** (`world, experience, learner, preference, misconception, goal, affect, plan`) + `entities` + `edges` com `about → nodeId` |
| L3 | `observations` + `mental_models` |
| WM | `observation_log` por sessão (Mastra OM) |
| Ponte | `evidence` → learner model do r2 |

**Recall (≤200 ms p50):** 4–5 canais (`vec`, `fts`, `graph` usando arestas do currículo com 1 hop e µ=1,0, `time` via `chrono-node`, `learner`) → RRF k=60, ou RSF configurável → MMR → orçamento → renderização **cronológica**.

**Stack:**

- `node:sqlite` (`DatabaseSync`; SQLite 3.53.4 no Electron 44.9.3) atrás do adapter `SqlDriver`, com fallback `better-sqlite3@13.2.0`;
- FTS5 `unicode61 remove_diacritics 2` ("tensao" casa com "tensão");
- vetores BLOB float32 com cosseno em JS até ~100k por domínio, `sqlite-vec@0.1.9` depois;
- embeddings locais com `@huggingface/transformers@4.3.2` (e5-small q8 por padrão; `hs-embed-1` 384-d MIT a validar) num `utilityProcess`.

> Assinaturas ChatGPT/Claude não dão endpoint de embeddings; por isso os embeddings são locais [r4][hind].

**Cold start:** com até 40k tokens de L0 no domínio, usa-se contexto cheio cacheado, o que dura ~1 dia de estudo (ConvoMem).

**Aterramento:** todo fato extraído tem `quote` verificado contra a fala-fonte. Meta: `% grounded ≥ 90%` (HaluMem).

**Ferramentas do tutor** (*progressive disclosure*, padrão claude-mem):

- `memory_search` (índice compacto de ~50–100 tokens por linha);
- `memory_timeline`;
- `memory_get`;
- `memory_note`;
- `learner_snapshot`.

**Custo estimado** (3 h/dia):

- memória de fundo ~210k tokens de entrada e ~31k de saída por dia em modelo pequeno/médio;
- injeção no tutor ~120k dinâmicos + prefixo cacheado;
- disco ~60–90 MB de texto e ~60–225 MB de vetores em 1 ano [r4 §7.12].

**Privacidade:**

- *Memory Viewer* para inspecionar, editar e apagar tudo;
- preferências didáticas viram `preference` de alta confiança **só após confirmação** de um toque [r4 §8.7–8.8].

**Metas de avaliação:**

| Fase | Metas |
|---|---|
| F1 | LME-S cleaned ≥ 74% (esticada 85%) |
| F2 | HaluMem Dynamic Update ≥ 70; TutorMem-lite estado atual ≥ 0,8; vazamento entre domínios = 0 |
| F4 | BEAM-1M sem colapso |

### 2.6 Learner model (FSRS + maestria + propagação) e a política "o que estudar agora"

**Por nó** [r2 §9]:

- **BKT acoplado ao FSRS-7.** O latente é "sabe agora" = `L ∧ M`, com `M|L ~ Bernoulli(R_FSRS(t))`.
- **Emissões ordinais** (nota 0–3 do avaliador) incluem uma matriz de confusão do avaliador.
- **FSRS-7** via `ts-fsrs@6.0.0`:
  - `defineScheduler({model: FSRS-7, chrono: dateChrono({fractionalDays:true})})` + os 7 middlewares padrão;
  - 34 pesos, traços `stability` e `stabilityFast`;
  - intervalos fracionários permitem checagem no mesmo dia [tsfsrs].
- **Pesos por domínio:** otimizados depois por `@open-spaced-repetition/binding@0.6.1` (napi-rs; `win32-x64-msvc` disponível), só no processo Node e quando houver histórico.

**Estrutura KST** (antimatroide / *learning space*):

- os estados viáveis são fechados para baixo (AND) ou deriváveis por cláusulas (AND/OR) [r10 teorema LS-rank];
- a fronteira externa nunca é vazia enquanto houver itens não aprendidos;
- no ALEKS, a taxa de sucesso a partir da fronteira externa é ≈0,93 [r2].

**Propagação:**

- **FIRe** no grafo `encompasses`: sucesso em nó avançado dá crédito fracionário via interpolação do estado FSRS, aplicado só quando o nó está vencido [mathua].
  - Ledger em micro-unidades inteiras: `Micro=1_000_000`, `MaxBank=3`, alocação por maior resto, modos `off|shadow|active` fail-closed.
- Falha → **penalidade para cima** e **culpa para baixo** (DINA *mean-field*, meia-vida 14 d).
- Catálogo de misconceptions por nó com posterior Beta.

**Definições de estado (resolução de limiares conflitantes):**

| Conceito | Definição | Uso | Fonte |
|---|---|---|---|
| **Aprendido** (`attainedAt`) | 1ª vez com `pL ≥ 0,85` **e** evidência direta. **Monotônico**; só é zerado se a **definição** do nó mudar (evidência resetada), não por mudança só de arestas. | Desbloqueio estrutural (fronteira) | [r10 fringe_persist][tmcp "Estimated" e reconciliação] |
| **Prontidão operacional** | Todo pré-requisito com `p·R ≥ 0,85` | Se falhar, **agenda aquecimento** antes do nó novo. **Nunca re-bloqueia na UI.** | [r2 §9.7] |
| **Dominado** (`masteredAt`) | `pL ≥ 0,95` ∧ ≥2 itens distintos corretos ∧ ≥1 recuperação atrasada ≥24 h sem dica | Insígnias de região, FIRe, núcleo K* | [r2][tmcp "Retained"] |
| **Demonstrado** | Checkpoint somativo aprovado | Eixo de UI e tier | [tmcp] |
| **Retido agora** | `R ≥ 0,7` | Tiers (PM) | [r7] |

A UI mostra os três sinais (Estimado / Retido / Demonstrado) como eixos [tmcp]. O estado é governado pelos números do r2.

**Testes obrigatórios:**

- monotonicidade de `attainedAt`;
- projeção de Fréchet idempotente;
- **regressão do bug de histerese** do tutor-mcp (1 falha derrubando `P(L)` de 0,9385 para 0,675 não pode re-bloquear nem zerar `masteredAt`).

**Diagnóstico inicial:**

- CAT com IRT 2PL [mathua] ou partículas KST [r2], com 10–15 itens por domínio;
- "pular com teste" fica separado de "marcar como sabido" [clew §12.11].

**Política "o que estudar agora"** (`planner.ts`, guloso com orçamento):

1. revisões vencidas `I_k(1−R_k)` com compressão por nós-veículo;
2. nós novos ∈ **fringe ∩ plan**;
3. remediação de fracos (blame alto);
4. sondas de "inferidos não verificados".

- Um **bandit** (Thompson/ZPDES) entra **só** na escolha do *formato* (aula IA, vídeo, livro) e da dificuldade [r2 §0.7].
- O LLM pode reordenar com justificativa **dentro** do conjunto candidato. Nunca inventa nó [r10][r3].

**Snapshot para o prompt** (~300 tokens): fronteira top-5, topo dominado top-5, 3 fracos com misconception, revisões vencidas, plano de hoje [r2 §9.14].

### 2.7 Currículo: estrutura, dimensões e licenças

- **Hierarquia:** Domínio → Área → Unidade → Tópico → Átomo. O átomo tem 10–45 min e 1–3 objetivos avaliáveis [r3].
- **Arestas:**
  - `part_of` é floresta (`parentId`);
  - pré-requisitos duros são **cláusulas** e só ligam nós que **não** são ancestral/descendente;
  - `builds_towards` predomina em Inglês;
  - `encompasses` tem peso 0–1;
  - `confusable_with` alimenta a intercalação de discriminação;
  - `covered_by` liga a recursos.
- **Regras de aresta** do open-mastery: "necessário, não suficiente" e "direta, não transitiva", aplicadas com redução transitiva [om].
- **Inglês:** `requires` só em gramática e consciência fonêmica; o resto é suave. Nós `practice_regime` (horas-alvo + critério de saída) para fluência. Pós-C1 vira frentes de leitura [r3 §11.4–5].
- **Eletrônica:** a especialização (RF, analógico IC, potência, embarcados) é perguntada no onboarding e muda o orçamento das camadas de pós-graduação [r3 §11.7].
- **Âncoras embutíveis:** CEFR-J VP/GP, NGSL (CC BY-SA), Octanove (CC BY-SA), Kuphaldt ModEL/LIEC (CC BY 4.0), NEETS (domínio público), lista NCEES FE.
- **Só por referência** (IDs/títulos): MIT OCW (CC BY-NC-SA), EGP, EVP, GSE e CEFR CV [r3 §0.8].
- **Dados de terceiros** ficam em `content/curricula/**` com LICENSE/NOTICE próprios, **separados do código AGPL**. Os dados de grafo do open-mastery são CC BY-SA 4.0 e podem servir de âncora nessas condições [om].
- **Embeddings de nós:** `title.en — summary | objectives`, em `embeddings.f32`, por força bruta. 5–10k nós × 1024 dims ≈ 20–40 MB [r3].

### 2.8 Recursos: YouTube + livros (só fontes legais)

**YouTube** [r6][ytjs]:

- **Modo padrão: Data API v3 BYOK.**
  - Desde 2026-06-01, `search.list` tem balde próprio de 100 chamadas/dia; o resto divide 10.000 unidades/dia.
  - `captions.download` só funciona para o editor do vídeo, então não serve.
  - Proibido gerar métricas derivadas dos dados da API.
  - Dados da API guardados por no máximo 30 dias.
- **Modo enriquecido (opt-in, desligado):** `youtubei.js@18.3.0` (MIT) para lista de legendas, `is_auto_dubbed` e transcrição.
  - O `get_transcript` do InnerTube dá 400 desde dez/2025. Usar `captionTracks[].baseUrl&fmt=json3`, com PO token via BgUtils se necessário.
  - `yt-dlp` é opcional (exige deno + yt-dlp-ejs). **Invidious/Piped não são dependências.**
- **Embed:** `https://www.youtube-nocookie.com/embed/<id>?enablejsapi=1&origin=…&hl=pt-BR&cc_lang_pref=pt&cc_load_policy=1`.
  - O `Referer` é **obrigatório**, senão dá erro 153. Ele é injetado no **único** listener `onBeforeSendHeaders` de `electron/main.cjs`.
  - Nada sobrepõe o player. A transcrição sincronizada fica **abaixo**, em segmentos de 20–90 s (port de `build_segments` do [dt]).
- **Ranking:**
  - score `0,35·rel + 0,25·qual + 0,15·lang + 0,10·lvl + 0,07·dur + 0,08·pref`, com gates `rel ≥ 0,35` e `lang > 0`, seguido de MMR λ=0,7.
  - A **qualidade não vem de views**. Vem da rubrica LLM sobre a transcrição (papel `rubric`, top-5 vídeos por nó, ~20k tokens por nó, **só quando o nó entra na fronteira**), da confiança no canal (`Beta(4,1)` para curados, meia-vida 90 d) e do feedback do aluno.
- **Ajuste de idioma:**
  - Eletrônica prefere PT original (1,0) e aceita EN com legenda PT ou dublagem automática;
  - Inglês **exclui dublagem** e exige áudio EN original.
- **Duração-alvo T\*:** átomo 6–12 min, tópico 10–20, universitário em segmentos de 8–25, revisão 2–5.
- **Playlist por nó:** explicação IA → vídeo de intuição ≤12 min → seção primária do livro → aprofundamento.
- **Canais-semente:**
  - EN Eletrônica: Engineering Mindset, Afrotechmods, ALL ABOUT ELECTRONICS, w2aew, Ben Eater, EEVblog, Phil's Lab, MIT OCW;
  - PT: Brincando com Ideias, Mundo da Elétrica, UNIVESP, Clovis Petry;
  - Inglês: BBC Learning English, engVid, Rachel's English, Mairo Vergara, Carina Fragozo.

**Livros:**

- **Abertos:**
  - OpenStax: JSON `tree` via `rex/release.json`; 70 títulos CC BY-NC-SA e 4 CC BY;
  - LibreTexts: catálogo de 4.145 títulos;
  - Open Textbook Library: API, matéria EE 54;
  - Kuphaldt LIEC/ModEL (CC BY 4.0), NEETS (domínio público), Wikibooks (CC BY-SA), MIT OCW (CC BY-NC-SA, só por link/leitura), arXiv (1 req/3 s), DOAB/OAPEN (OAI-PMH/CSV), VOA Learning English (domínio público), eduCAPES, SciELO.
  - Conteúdo **NC** é buscado em runtime e não empacotado.
- **Protegidos:**
  - só metadados: Open Library (1 req/s), Crossref book-chapter, Google Books com chave;
  - ou **o arquivo do próprio usuário**, importado para `data/library/<sha256>`;
  - empréstimo do Internet Archive = **só link** (Hachette v. IA confirmado em 2024-09-04);
  - **nunca** Anna's Archive, LibGen ou Z-Library. Uma allowlist de hosts em `safe-fetch.ts` é testada.
- **Sumário em cascata:** outline do PDF → Crossref → Open Library toc → foto do sumário via `vision` → LLM (marcado provisório).
- **Ingestão em camadas:**
  - **T0:** pdf.js + `getOutline` / `getPageLabels`, adicionados a `src/agent/subagents/pdf-markdown.ts`;
  - **T1:** EPUB (port de `document_import.py` do BloomTutor com fflate + linkedom + turndown);
  - **T2:** OCR opcional com PaddleOCR-VL-1.6 (Apache; 96,34 no OmniDocBench) ou o slot `vision`.
  - Recuperação de capítulos por LLM quando não há outline (prompt OpenMAIC).
  - Chunks de 300–800 tokens com breadcrumb e cabeçalho de contexto.
  - Mapeamento seção ↔ nó: embeddings + BM25 + RRF + checagem LLM, com roll-up para regiões. Kendall τ entre a ordem do livro e a topológica serve de sinal de pré-requisito.
  - **Seções órfãs = gatilho de expansão.**
- **Job `ingest-book`** contorna o limite de 25 MiB do `plugin-documents.ts`. Um livro de 600 páginas custa ~0,7M tokens de entrada.
- **Livro-espinha por região:** escolhido por *set cover* ponderado.
- **Jobs:** `curate-node`, `ingest-book`, `map-book`, `relink-resources`, `refresh-youtube`, `ocr-pages`.
- Todos os adapters passam por `safeFetch` com User-Agent genérico.

### 2.9 Auth por assinatura e catálogo dinâmico de modelos

**ChatGPT (SIWC, já existe em `electron/chatgpt.cjs`)** [r5][clew]:

- `client_id=dynamic_agent_client` (emite `oaiapp_…`).
- Scopes: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, com `resource=https://api.openai.com/v1`.
- Inferência: `POST https://api.openai.com/v1/responses` com `store:false` e `stream:true` obrigatórios.
  - Histórico completo em `input`; `system` vira `developer`.
  - Proibidos: `temperature`, `max_output_tokens`, `metadata` etc.
  - **Só `response.completed` conta como sucesso.**
- Modelos: `GET /v1/models` devolve `models[]` com `slug, display_name, visibility, supported_in_api, context_window, input_modalities, supported_reasoning_levels, priority, upgrade`.
- Erros mapeados **por `error.code`**, sem fallback silencioso para chave de API:

  | Código | HTTP | Ação |
  |---|---|---|
  | `subscription_sharing_user_not_eligible` | 403 | — |
  | `…usage_limit_exceeded` | 429 | Modal com ação primária "Manage usage" → `chatgpt.com/settings/usage` |
  | `…usage_unavailable` | 503 | — |
  | `…unsupported_capability` | 400 | Ler `error.param` |
  | `…route_not_supported` | 403 | — |
  | `…invalid_user` | 401 | — |
  | `chatpass_v2_*` | 403 | — |
  | `…user_unavailable` | 503 | — |

- **UI obrigatória:** botão "Continue with ChatGPT", modal de 1º uso, selo "Using ChatGPT plan · Manage usage", modal de limite.
- **Elegibilidade:** Go, Plus, Pro, Business. O Clew dizia "só Plus/Pro", o que está desatualizado. App OSS/local se qualifica; app pago ou hospedado exige formulário.
- **Limites:** o Plus tem janela de 5 h **compartilhada** entre apps; o usuário define limites semanais por app.
- **Nunca usar:** o client do Codex CLI (`app_EMoamEEZ73f0CkXaXp7hrann`) nem `chatgpt.com/backend-api`.
- **Créditos estimados por 1M tokens** (in / cache / out), só para exibição "equivalente":

  | Modelo | In | Cache | Out |
  |---|---|---|---|
  | GPT-6.2 Sol | 50 | 2,5 | 250 |
  | GPT-6.1 Terra | 25 | 1,25 | 125 |
  | GPT-6 Luna | 2,5 | 0,25 | 12,5 |
  | GPT-6.2 Astra | 200 | 10 | 1000 |

**Anthropic:**

- **OAuth de terceiros é proibido.** Desde 2026-04-04 a assinatura não cobre harnesses de terceiros.
- **Permitido:**
  - (a) **chave de API do usuário**. Desde 2026-10-07 o Max inclui US$100/mês de créditos de API, o Ultra US$200 e o Team até US$500;
  - (b) executar o **`claude` CLI do próprio usuário, sem modificação**, opt-in e desligado por padrão.
- O `initialize` do CLI devolve `models` (com `resolvedModel`) e `account` (`subscriptionType`, `tokenSource`, `apiKeySource`). Isso substitui `CLAUDE_CODE_MODELS`.
- **Nunca:**
  - `models.login("anthropic","oauth")`;
  - ler `~/.claude/*`;
  - `setup-token`;
  - empacotar o CLI;
  - **jobs de fundo via Claude Code**.

**Outros provedores:**

- Google: só chave de API (OAuth do Gemini CLI / Antigravity = vermelho).
- Copilot via client VS Code do pi-ai: amarelo (o caminho oficial é o Copilot SDK).
- xAI: amarelo, experimental.
- **OpenRouter:** OAuth PKCE que gera chave do usuário = verde (P2).

**Registro de modelos** (`src/server/model-registry/`, absorvendo `src/server/model-catalog.ts`):

- **Tipos:**
  - `EntitlementEntry{connection, provider, id, displayName, order, hidden, native{contextWindow, maxOutput, input, reasoningLevels, lifecycle, retiresAt, shutdownDate, upgradeTo, line, resolvedModel, supportedInApi}}`;
  - `ModelMetadata{source: native|models.dev|litellm|openrouter|pi|estimated}`;
  - `EntitlementSource.list(signal, prev{etag})`.
- **Cascata de metadados campo a campo:** nativo → models.dev (MIT, `https://models.dev/api.json`, 6,7 MB, 324 provedores) → LiteLLM → OpenRouter → pi → estimado (contexto 128k, saída 8.192).
- **Cache:**
  - entitlements: fresco 5 min / *stale* 24 h;
  - metadados: 24 h / 30 d;
  - snapshot de build `resources/model-metadata.snapshot.json`, só com metadados.
- **Refresh:** boot, login ou troca de conta, abertura do seletor, erro de modelo, botão manual e a cada 60 min.
- **Papéis** (`RoleSpec`) substituem os slots `strong/cheap/vision`, que viram presets:

  | Papel | Preset |
  |---|---|
  | `tutor`, `curriculum`, `planner` | `auto strongest` |
  | `grader`, `extractor`, `judge`, `observer`, `rubric` | `auto cheapest` |
  | `consolidator`, `flashcards` | médio |
  | `critic` | `auto strongest` com `connection` diferente quando houver |
  | `vision` | `require.input:['image']` |

  Override por domínio em `DomainManifest.roles`.
- **Lint de teste:** nenhum hit de `gpt-|claude-|gemini-` fora de `tests/`.

**Gasto de fundo:**

- só com `backgroundBudget.enabled` e dentro de `tokensPerDay` por domínio;
- só em conexões não-CLI;
- pausa automática no limite ou ao receber `usage_limit_exceeded`.

### 2.10 Stats: tokens e horas

**Tokens:**

- Um hook único na camada de provider converte `TurnUsage` / `CallUsage` em `UsageEvent`.
- O `llm_usage` da memória do r4 vira apenas `op` no mesmo stream. **Um só stream, não dois.**
- Grava em `profile/stats/usage-YYYY-MM.jsonl`.
- Agregações por dia × modelo × domínio × `op`.
- US$ só quando `billing='api'`, reaproveitando `src/core/prices.ts` / `cost-summary.ts`. Em assinatura mostra "créditos estimados" e cache hit.

**Horas:**

- O renderer envia *heartbeat* a cada 30 s via `POST /api/stats/activity`, só com janela focada e interação nos últimos 120 s. Isso gera `ActivityEvent{activeSec}` em `activity-YYYY-MM.jsonl`.
- Vídeo tocando conta como `media`.
- "Horas por dia" = soma dos `activeSec` ativos. É **a mesma base do XP** (minutos focados), evitando dois relógios.

**API e UI:**

- `GET /api/stats?from&to&domain`;
- componentes `StatStrip` e `MiniHeatmap` portados do [bt-ui] (MIT) + `WorkingBar` para job ativo.

### 2.11 XP, níveis e ranks calibrados por Monte Carlo

**Evidência que fixa os limites:**

- gamificação tem efeito cognitivo g=0,49, mas só g=0,26 na motivação intrínseca, e nenhum estudo passa de 6 meses (Sailer & Homner 2020);
- badges + leaderboard + moedas reduziram a motivação (Hanus & Fox 2015) [r7].

**Quatro camadas:**

1. **XP** — 1 XP ≈ 1 minuto focado.
2. **Nível** — global.
3. **Insígnias de região** — estados Explorada, Familiar, Proficiente, Dominada (com "chefão") e Enferrujada.
4. **Tier por domínio** — Bronze, Prata, Ouro, Platina, Diamante, Mestre, Doutor (estágios 1–7, divisões III/II/I).

Há ainda um indicador de "forma".

**Funções** (`src/core/progress/xp.ts`, `levels.ts`, `elo.ts`):

```ts
export const expectedScore = (theta: number, b: number) => 1 / (1 + 10 ** ((b - theta) / 400));
export const mDif = (E: number) => clamp((1 - E) / (1 - 0.80), 0.3, 1.5);        // item
export const gReview = (R: number, dr = 0.90) => clamp((1 - R) / (1 - dr), 0.1, 1.5); // revisão
export const levelFromXp = (xp: number, c = { a: 20.10, p: 1.696 }) =>
  Math.max(1, Math.floor((Math.max(0, xp) / c.a) ** (1 / c.p)));
// softCapped: ×0,5 após 240 min/dia; ×0,25 após 360 min/dia. Sem XP negativo.
// XP NUNCA depende do rating Again/Hard/Good/Easy.
```

**Tiers:**

- núcleo canônico **congelado** por estágio;
- retido = `R ≥ 0,7`, com fração `q = 0,8`;
- avaliação semanal;
- exame qualificatório opcional.
- Critério contínuo: `PM = Σ_s s·|retidos(core[s])|/|core[s]|` (máximo 28), com limiares calibrados 1,71 / 3,71 / 6,32 / 9,69 / 13,37 / 17,69 / 23,49.

**Monte Carlo** (`scripts/calibrate-progression.ts` → `config/progression.json`, `RULES.version='2026-11-r1'`):

- núcleo de 1.110 nós, DR 0,9;
- Doutor mediano em **12,6 / 18,2 / 27,1 meses** a 4 / 3 / 2 h/dia, ≈1.260–1.350 h;
- revisões ocupam 32–35% do tempo;
- **farmers ganham 30–40% menos XP/h** com as regras propostas, enquanto a regra ingênua lhes pagaria 33–48% a mais [r7].
- O script importa as **mesmas** funções puras de `src/core/progress` e `src/core/learner` (FSRS `simulate`), para que calibração e runtime não divirjam.

**Streak:**

- meta semanal (padrão 5/7);
- dia válido = 10 min ou fila de revisão zerada;
- até 2 *freezes*, reparo em 48 h e modo viagem.

**Rankings:**

- **Desligados por padrão.** "Eu vs Eu" (recordes pessoais, percentis contra a própria curva simulada).
- Opt-in: **coorte simulada explicitamente rotulada**, com 29 "fantasmas" amostrados dos quantis do MC.
  - Usa `planWeek` determinístico e `moversFor(n) = n<6 ? 0 : min(5, floor(n/3))` do [mathua].
- Rating Elo simples no MVP; Glicko-2 ou openskill.js (MIT) só se as ligas forem ligadas [r8][oskill].

**Invariantes I1–I7 do r7 em teste:**

- idempotência por `eventId`;
- XP ≥ 0;
- soft cap monotônico;
- nível monotônico em XP;
- tier depende só de retenção;
- `rulesVersion` gravado;
- **recalibrar nunca reduz XP já concedido**.

### 2.12 UI cel-shading e ícones desenhados à mão

**Sete leis** [r9]:

1. Luz única vinda do canto superior esquerdo.
2. Tinta em hierarquia 2 / 1,5 / 3 / 4 px.
3. No máximo 3 tons chapados por superfície, sem gradiente nem blur.
4. Sombra dura com offset 2 / 3 / 4 / 6 / 8 por camada.
5. Rim light e especular com parcimônia.
6. Forma antes de cor.
7. Limpo > rabiscado: o *wobble* fica só em ícones e ilustrações.

**Paleta:**

| Elemento | Cor |
|---|---|
| Papel (fundo) | `#FBF7EE` |
| Tinta | `#1E1B2E` |
| Noite (fundo) | `#16161F` |
| Giz | `#E9E4D6` |
| Borda | `#8C88A6` |
| Volt (Eletrônica) | `#FFD23F` |
| Coral (Inglês) | `#FF7A59` (o `#ff7a45` do lh-ui foi descartado) |
| XP | uva |

**Texto sobre cor é sempre tinta.**

**Tema:** tokens em CSS vars como tema `cel` em `src/store/themes.ts` + `app/globals.css`, com claro (Papel) e escuro (Noite), aproveitando o boot de tema existente (`src/server/theme-boot.ts`) [lh-ui].

**Fontes** (self-hosted via `next/font`):

- Fredoka para display (sem `tnum`);
- Nunito para UI (dígitos tabulares);
- Shantell Sans para notas "à mão";
- JetBrains Mono.

**Movimento:** funcional suave; decorativo em `steps(3)`; `MotionConfig reducedMotion="user"`.

**Compilador de ícones** `scripts/icons/compile.ts` (build-time, determinístico):

- esqueleto em grade de 24 px;
- wobble 0,22 px;
- perfect-freehand (size 2,1, thinning 0,32);
- `polygon-clipping.union` e depois RDP com ε=0,04;
- camadas `fill / shade (terminador 45°) / ink / hl`;
- seed = FNV-1a(nome); quadros de "boil" em seed + k·7919, pré-gerados;
- 0,28–2,4 KB por ícone.
- **Saídas:** `components/icons/{generated.ts, icon.tsx, lucide-compat.ts}` + `public/icons/sprite.svg`.
- **Escopo:** 73 ícones (P0 33, P1 25, P2 15) e insígnias com 7 formas × 3 *pips*.
- Os **estados de nó no canvas são formas** (não só cor): dominado, fronteira, stub (névoa), provisório (traço descontínuo), enferrujado [r3 §10][r9].
- O compilador de [r9] substitui as "camadas de artista com chaves magenta/ciano" do [lh-ui]; os caminhos de saída continuam os mesmos.
- `react-rough-fiber` / `svg2roughjs` / `rough.js` [r8][rough] ficam, no máximo, para ilustrações pontuais, **não** para ícones nem para UI (custo de runtime e wobble em tudo viola a lei 7).

**Testes:**

- `tests/cel-contrast.test.ts`: AA para todas as combinações de token;
- `tests/icons.test.ts`: tamanho, determinismo e paridade com lucide-compat.

### 2.13 Formalização: Lean + invariantes em runtime

**Modelo** [r10]:

- sistema de cláusulas AND/OR com *rank*;
- **R1:** todo item tem rota (alcançável a partir dos itens de entrada);
- **R2:** cláusulas apontam para rank menor (aciclicidade construtiva);
- **R3:** sem referência pendente.

**Teorema LS-rank:** os estados viáveis formam antimatroide / *learning space*, e a fronteira nunca fica vazia enquanto houver item não aprendido.

**Princípios adicionais:**

- "Aprendido" é monotônico; retenção é **camada separada**.
- Crédito implícito como menor ponto fixo.
- Segurança BKT: `G + S ≤ 1`.
- Horas `mand / LB / UB`. O plano ótimo é NP-difícil, então usa-se heurística gulosa. Folhas `hi ≤ 4 h`. `refine` conserva horas dentro de ε=0,25.
- `refine` mantém o id do item refinado (marco). Fórmula de rank: `r'(v) = (N+2)·r(v) + N+1`.
- Reparo **interior conservador** (não infere aprendizado) vs **inferência com sonda**. O padrão é o conservador.

**Invariantes de runtime** (`src/core/curriculum/invariants.ts`, códigos de `ValidationError`):

- `schema`;
- `unknown-id` (R3);
- `cycle` (R2 via rank e Kahn);
- `no-route` (R1);
- `hierarchy` (`part_of` é floresta; `requires` não liga ancestral/descendente);
- `hours-conservation`;
- `budget`;
- alvos **não-cobertos por lint** também: ids imutáveis, `retire` exige `reroute`, migração de estados fecha para baixo e preserva `attainedAt`.

**Pipeline `applyPatch`:**

```
zod → clone → invariantes → migração de estados → certificado {order, hash} → append em patches.jsonl
```

- Replay do ledger ⇒ mesmo hash.
- Erros de domínio seguem o padrão `PlanTreeError`, como `CurriculumError`.
- **Não** reaproveitar `createsCycle` de `plan-tree.ts` (O(E·(V+E))).

**Desempenho medido:**

- `validate` completo: 33 ms com 20k nós;
- Pearce–Kelly ingênuo é patológico (9,6 s), mas **semeado com a ordem de Kahn** cai para 8,4 ms;
- inserções incrementais: 2–3 µs.

**Lean:**

- Lean **v4.36.0**, elan v4.4.0, Mathlib tag v4.36.0.
- `formal/LHFormal/*` contém o modelo e os teoremas P0. O executável **`lh-check`** lê JSON de patches e estados.
- **CI:** `.github/workflows/formal.yml` com `leanprover/lean-action@v1` (v1.7.1, ubuntu) + auditoria `#print axioms` (só `propext`, `Classical.choice`, `Quot.sound`) + `leanchecker`.
- `lake comparator` roda só em Linux. **Lean nunca roda no app.**
- **Reaproveitar:** a TopologicalSort verificada do cslib-frontier e a formalização de Antimatroid do linglib. **Não copiar** atlas-lean.
- P0 ≈ 1–2 semanas de Lean.

**Ponte TS ↔ Lean:**

- `fast-check@4.10.2` com `arbSystem` gera sistemas e patches aleatórios;
- **teste diferencial (DRT)**: TS `applyPatch` × `lh-check` no CI;
- certificados em runtime: ordem + checker O(V+E) a cada apply.

**Modo estrito** (padrão) vs relaxado [r10 rev. 2]: no estrito, `Reachable` é definido por "palavras de aprendizagem" e há no máximo 2 alternativas por item.

### 2.14 Grafo massivo: visualização e desempenho

**Três zooms:**

1. **Galaxy** — sigma.js **4.0.6** + graphology (MIT, WebGL2, labels SDF, picking na GPU, render sob demanda):
   - zonas por Louvain;
   - contornos e regiões **no mesmo contexto GL** via `@sigma/layer-webgl` / `createContoursProgram`;
   - nós cel via fragment layer + `layerBorder` (tinta) + `layerImage` (ícone).
2. **Região** — ELK/dagre num Worker.
3. **Vizinhança** — React Flow (`@xyflow/react` 12, já existe), com no máximo 200 nós [r8][sigma].

**Contexto histórico:** o learnharness abandonou o sigma em 2026-09-13 por causa de regiões desenhadas em canvas externo (hull atrasado, corrida de dimensionamento, picos de GPU). No v4 isso é resolvido por camadas in-GL. Splats de densidade só são ligados sob demanda. **Evitar `@cosmograph/cosmos` (CC-BY-NC-4.0).**

**Regras de escala:**

- layout calculado fora da main thread e cacheado em `curriculum/layout.json` por versão; nada de posições globais em `localStorage` [clew §12.7];
- nada de física O(n²);
- SVG só abaixo de ~2.000 nós [dt-web];
- LOD de labels via `LabelGrid`.

---

## 3. Tabela de decisões

| # | Decisão | Alternativa rejeitada | Por quê | Fonte |
|---|---|---|---|---|
| D1 | Núcleo determinístico; LLM só propõe (grafo, estado, XP, agenda em código puro) | LLM como planejador e "lembrador" do currículo | KST: 61,3% → 96,3% com a relação dada; reconstrução de estrutura por LLM tem Jaccard 0,028 | [r3 §0.1–2][r10] |
| D2 | `LessonOrchestrator` (máquina de estados por fase) | Prompt único de "professor" | Prompt não estrutura problemas multipartes (Kestin) | [r1 §0.4, §6.13] |
| D3 | Checagem por KP; ≤1 pergunta por mensagem; perguntas como cards de UI que encerram o turno | "One check per reasoning step" atual; perguntas na prosa | VanLehn (subpasso d=0,40); Eedi (29,5% saem cedo); `questionResult terminate:true` já existe | [r1][clew][maic] |
| D4 | Pré-requisitos em CNF AND/OR, estrito, no máximo 2 alternativas; `requires` / `requiresAnyOf` como visões derivadas | DAG só-AND (r3) | AND/OR preserva o *learning space* (LS-rank) e modela rotas alternativas (Laplace via EDO **ou** circuitos) sem explosão | [r10][r3 §4.3] |
| D5 | Ledger JSONL de patches + snapshot + certificado por domínio | SQLite `BEGIN IMMEDIATE` para o currículo (Clew opção A) | Taxa de mutação baixa (dezenas/dia); replay auditável e diffável; segue `graph-format.ts`; escritor único via fila de jobs basta | [r10][r3 §10] vs [clew §6] |
| D6 | Expansão lazy por 4 gatilhos + orçamento lexicográfico + k amostras/consenso/dedup/validação | Gerar o grafo inteiro de uma vez | Seed integral custa ~15–20M tokens por domínio; multi-hop LLM cai para 54,2% | [r3 §0.5, §11.2][r10] |
| D7 | Auto-apply só de folhas de baixo risco (recibo + undo); estrutural pede revisão; "ondas" piloto | Toda proposta revisada (ADR Clew) ou tudo automático | Equilíbrio entre fluidez e controle; rollback visível ≠ mutação silenciosa | [clew ADR-0001][mathua] |
| D8 | Learner BKT × FSRS-7 (`ts-fsrs@6`), KST, FIRe, DINA; LLM só como sensor | LLM como *knowledge tracer*; DKT | LLMs abaixo do baseline trivial (58,6–66,5% vs DKT ~72%), 600–12.000× mais caros | [r2 §0.6] |
| D9 | "Aprendido" monotônico + "prontidão" como aquecimento (não bloqueio) | Fronteira dependente de R (re-bloqueio) | Falhar revisão não deve re-trancar conteúdo (frustração; invariante `fringe_persist`) | [r10] vs [r2 §9.7] |
| D10 | Próximo passo = fringe ∩ plano, ranqueado pelo planner do r2; LLM só reordena dentro | Recomendação livre por LLM | Corretude e previsibilidade; benchmark KST | [r2 §9.9][r10] |
| D11 | Memória TS in-process raw-first (SQLite por domínio, FTS5 + vetor local + tempo + grafo, RRF) | Sidecar Hindsight / Mem0 / Letta | Neutro: Hindsight 72,2% LME-S, 24–43k tokens por consulta; piso híbrido local 87–90% com 4–5k tokens; sem Python/Postgres | [r4 §0][hind] |
| D12 | Embeddings locais (transformers.js) | Endpoint de embeddings do provedor | Assinaturas não dão endpoint de embeddings; privacidade; custo zero | [r4 §7.2] |
| D13 | Layout `data/domains/<id>/…` + `profile/` + `library/` | Pastas por recurso (`data/curriculum/<id>`, `<userData>/memory/<id>`) | Isolamento natural (meta 3), backup e export por domínio | [r3][r4][r6][r7][dt] (unificação) |
| D14 | Troca de domínio: restart no MVP, depois quiesce-and-switch (409 se ocupado) | Remontar por `key` do React | Corridas com jobs e handles abertos | [lh-plug][dt-web] |
| D15 | ChatGPT SIWC primário; Anthropic só por chave de API ou CLI próprio opt-in; nada de OAuth de terceiros | OAuth Anthropic / tokens do Claude Code | ToS (2026-04-04); risco de banimento da conta do usuário | [r5] |
| D16 | Registro dinâmico (entitlements + cascata models.dev…) + `RoleSpec` + lint anti-ID | Lista de modelos fixa no código | Slugs mudam sem release; pedido explícito do usuário | [r5] |
| D17 | Credenciais com `safeStorage` (DPAPI) | JSON em claro | Segurança mínima no Windows | [r5][lh-agent] |
| D18 | YouTube: Data API BYOK + embed nocookie; InnerTube enriquecido opt-in | Scraping/InnerTube por padrão; yt-dlp obrigatório | ToS; estabilidade (`get_transcript` 400 desde dez/2025); quota previsível | [r6][ytjs] |
| D19 | Livros: só fontes abertas ou o arquivo do usuário; protegidos só metadados | Bibliotecas-sombra | Legalidade; Hachette v. IA | [r6] |
| D20 | O app é a fonte de verdade do SRS (replay do revlog); Obsidian espelho de mão única; Anki opcional | Anki como fonte de verdade; sync bidirecional Obsidian | Um único agendador por domínio; o SR do Obsidian sobrescreveria `<!--SR:-->` | [r7] |
| D21 | AnkiConnect API v1 (fallback v6) do backend + `LH_ID` + `.apkg` | yanki-connect (só v6); `anki.importing` (removido no 26.09) | Estado em 2026-11; ausência de GUID na v1 | [r7][apkg] |
| D22 | Nós usam FSRS-7; cartões no app usam FSRS-7 (`ts-fsrs@6` via `Reschedule.replay` de `state.reviews`); com `reviewClient='anki'` o Anki agenda (FSRS-6) e o app só lê evidência | Manter FSRS-6 vendorizado no plugin (r2) | FSRS-7 com reviews no mesmo dia: log loss 0,3206 vs 0,3842 do FSRS-6; com defaults já supera o FSRS-6 treinado | [tsfsrs][r8] vs [r2 §9.14] |
| D23 | XP = minutos focados × dificuldade/ganho; ledger idempotente; sem penalidade | Clamp 1–5 do mathua; XP por rating; XP negativo | Anti-farm (farmers −30–40% XP/h); motivação | [r7][mathua] |
| D24 | Ligas desligadas; "Eu vs Eu"; coorte simulada rotulada opt-in | Ligas reais de 30 | Hanus & Fox; app single-user; honestidade | [r7][mathua] |
| D25 | Compilador de ícones build-time (perfect-freehand) | react-rough-fiber em runtime; camadas de artista com chave de cor | Determinismo, 0,28–2,4 KB, sem custo de runtime; lei 7 | [r9] vs [rough][lh-ui] |
| D26 | sigma v4 só na galaxy; React Flow na vizinhança | Só React Flow/SVG; cosmos | SVG quebra acima de ~2k nós; v4 resolve o motivo do abandono; licença do cosmos | [sigma][r8][dt-web] |
| D27 | Lean só no CI + invariantes, certificados e PBT no runtime | Lean no app; nenhuma prova | Peso do toolchain; garantias reais via DRT | [r10] |
| D28 | Dados CC BY-SA em `content/curricula/**` separados do código AGPL; `THIRD_PARTY_NOTICES.md` | Misturar dados com o código | Compatibilidade de licenças e clareza de atribuição | [om][r3][r8] |
| D29 | Chamadas JSON com `runJSON` (zod + 1 re-pergunta mostrando as *issues*); "reparar" só campos cosméticos | "Reparar, não rejeitar" em tudo (gen-mentor) / rejeitar sem retry | Gabaritos e ops de grafo nunca são consertados silenciosamente (Clew); conteúdo pedagógico tolera *trim*/clamp | [genm] vs [clew §7] |
| D30 | Um único stream `UsageEvent` (r5) com `op` | `llm_usage` separado na memória (r4) | Uma fonte para stats, orçamento e custo | [r5] vs [r4 §7.9] |
| D31 | Fundo só com orçamento consentido por domínio; nunca via Claude Code | "Nenhuma chamada sem clique" absoluto (BloomTutor) / consolidação automática irrestrita (DeepTutor) | Memória e expansão precisam de fundo; o usuário controla o gasto | [bt] vs [dt][r5] |
| D32 | Questões só em cards; sem colegas virtuais por padrão | Cenas narradas com colegas (OpenMAIC) | Preferência medida por modo contínuo; menos tokens | [maic] |
| D33 | Seed em 2 etapas (esqueleto de âncoras + átomos de 2 áreas) | Seed completo (~1.000–1.150 nós materializados) | Custo de assinatura (dias de janela) e qualidade | [r3 §6, §11.2] |
| D34 | IDs de domínio legíveis (`english`, `electronics`) + prefixo de nó (`en.`, `ee.`) | `"en"`/`"ee"` como domainId (r3) | Pastas e URLs legíveis; o prefixo curto continua nos ids de nó | [r3][r4][r1] |
| D35 | Pastas por camada (`src/core/<x>`, `src/store/<x>`, `src/server/<x>`) | `src/curriculum/**` etc. literais | Respeitar `import/no-restricted-paths` do `eslint.config.mjs` | repo |

### 3.1 Contradições entre relatórios e como foram resolvidas

1. **FSRS-6 vs FSRS-7 nos flashcards.**
   - [r2 §9.14] mantém FSRS-6 por coerência com o Anki. [tsfsrs] e [r7] propõem `ts-fsrs@6` + replay.
   - **Resolução D22:** um único agendador ativo por domínio elimina a necessidade de coerência. FSRS-7 no app; FSRS-6 só quando o Anki é o revisor.
2. **Números de benchmark FSRS divergentes.**
   - FSRS-7 default: 0,3620 [r2], 0,3399 [tsfsrs] e 0,3401 [r8].
   - **Resolução:** são configurações diferentes (com ou sem reviews no mesmo dia, pesos default ou treinados). A conclusão é a mesma nos três: FSRS-7 ≥ FSRS-6, com bom *cold start*.
3. **Fronteira dependente de R [r2] vs aprendizado monotônico [r10].** Resolução D9.
4. **SQLite [clew] vs JSONL [r3][r10] para o currículo.** Resolução D5. A memória continua em SQLite [r4].
5. **Caminhos de dados divergentes** entre r3, r4, r6 e r7. Resolução D13/§2.2.
6. **Hindsight sidecar [r8 top-14] vs TS nativo [r4][hind].** Resolução D11; o próprio [hind] recomenda a "opção C, porta TS".
7. **Elegibilidade SIWC:** "Plus/Pro" [clew] vs "Go, Plus, Pro, Business" [r5]. Vale o r5, que segue a doc atual.
8. **Coral `#ff7a45` [lh-ui] vs `#FF7A59` [r9].** Vale o r9, que testou contraste com tinta.
9. **Ícones:** camadas de artista [lh-ui] vs compilador [r9] vs rough em runtime [r8]. Resolução D25.
10. **Reparar vs rejeitar saídas do LLM** [genm] vs [clew]. Resolução D29.
11. **Sem chamadas sem clique [bt] vs consolidação automática [dt].** Resolução D31.
12. **Limiares de maestria:** 0,85 [tmcp], 0,95 [r2], 0,9 [dt], 0,75 [clew], R≥0,7 [r7]. Resolvidos pela tabela de estados em §2.6: cada número tem **um** papel.
13. **XP:** clamp 1–5 [mathua] vs multiplicadores contínuos [r7]. Resolução D23.
14. **Ligas reais [mathua] vs desligadas [r7].** Resolução D24.
15. **Átomo de 10–45 min [r3] vs folha `hi ≤ 4 h` [r10].** Não é conflito:
    - o limite de 4 h vale para *stubs* ainda não refinados;
    - átomos materializados obedecem à banda de 10–45 min do teste de granularidade.
16. **Conectividade global do validador do Clew (R10)** rejeitaria grafos com ilhas pré-existentes [clew §12.4].
    - No nosso modelo, R1 ("toda rota parte de itens de entrada") substitui a regra.
    - Subdomínios podem ter várias raízes de entrada, desde que alcançáveis.
17. **"Personalização no prompt"** [dt: memória melhora OQ 3,80 → 3,91] vs [r1: Eedi ≈ sem ganho].
    - **Resolução P13:** memória alimenta decisões; o texto injetado é curto e estável.
18. **`binding` FSRS "WASM" [r2] vs "napi-rs nativo + WASI" [tsfsrs].** Vale o [tsfsrs], verificado no npm.
    - No Windows usar `win32-x64-msvc`; WASI é fallback.
19. **Sigma "abandonado" pelo learnharness [lh-ui] vs recomendado [r8][sigma].** Resolução D26: o motivo do abandono não existe no v4.

---

## 4. Riscos e mitigações

| # | Risco | Prob. / impacto | Mitigação | Onde |
|---|---|---|---|---|
| R1 | **ToS de assinatura (OpenAI).** Mudança de política do SIWC, uso tido como "hospedado/pago", limite semanal por app, janela de 5 h compartilhada no Plus. | M / A | Uso local/OSS; formulário de interesse se virar pago; mapeamento por `error.code` + modal "Manage usage"; **sem fallback silencioso** para chave; orçamento de fundo pausa no 429; nunca usar o client id do Codex nem `backend-api`. | §2.9, M0 |
| R2 | **ToS Anthropic.** OAuth de terceiros proibido; risco de banimento. | A se violado / A | Só chave de API do usuário ou CLI próprio opt-in; jamais ler `~/.claude/*`; jobs de fundo nunca via Claude Code; teste que falha se `models.login("anthropic","oauth")` aparecer no código. | §2.9, M0/M10 |
| R3 | **Pirataria de livros.** | B (por design) / A | Allowlist de hosts em `safe-fetch.ts` com teste que bloqueia domínios de bibliotecas-sombra; protegidos só como metadados; PDF do usuário fica local (`data/library`) e nunca é redistribuído; IA = link; conteúdo NC buscado em runtime, não empacotado. | §2.8, M6 |
| R4 | **ToS do YouTube** (InnerTube, retenção, overlays). | M / M | BYOK Data API por padrão; enriquecido opt-in com aviso; TTL 30 d para dados da API; sem métricas derivadas; nada sobre o player; `Referer` correto. | §2.8, M6 |
| R5 | **Custo de tokens:** seed ~15–20M por domínio; livro ~0,7M; rubrica de vídeo ~20k por nó (×1.000 nós = 20M); memória ~240k/dia. | A / A | Seed em 2 etapas; curadoria **lazy** só na fronteira; top-5 → top-3 quando o orçamento apertar; papéis baratos para extração e rubrica; prefixo estável cacheado; `tokensPerDay` por domínio; painel de créditos estimados; cache por `(nodeId@version)`. | §2.4e, §2.9, §2.10 |
| R6 | **Qualidade do grafo gerado** (pré-requisitos multi-hop errados, duplicatas). | A / A | Âncoras reais; k amostras + consenso; crítico de 2º modelo/provedor; dedup por embedding; redução transitiva; revisão da fase 1 + amostra semanal; `estMinutesObserved` recalibra horas; ondas piloto. | §2.4e, §2.7 |
| R7 | **Desempenho com milhares de nós:** validação, layout, render, contexto. | M / A | `validate` 33 ms @20k; PK semeado por Kahn (8,4 ms) e inserções de 2–3 µs; snapshot + cauda do ledger (checkpoint a cada N=200 patches); layout em Worker cacheado por versão; sigma v4 WebGL com render sob demanda; **nunca** o grafo inteiro no prompt; embeddings de nós por força bruta (20–40 MB). | §2.13, §2.14 |
| R8 | **Windows**: caminhos longos, travas de arquivo, CRLF, nativos, ferramentas Linux-only. | M / M | Ids curtos com hash e sem caracteres reservados nos nomes de arquivo; retry com backoff em `EPERM/EBUSY` no rename atômico (antivírus); `.gitattributes eol=lf`; `node:sqlite` embutido (sem rebuild), `better-sqlite3` só como fallback; binding FSRS `win32-x64-msvc`; Lean e `lake comparator` só no CI Linux; yt-dlp/deno opcionais; `safeStorage` = DPAPI; `scripts/run-tests.mjs` portátil. | M0, §2.5 |
| R9 | **`node:sqlite` experimental** (warning no Node 24). | M / B | Adapter `SqlDriver` com fallback testado para `better-sqlite3@13.2.0`. | §2.5 |
| R10 | **Tutor que cansa** (perguntas demais, verbosidade). | A / A | `TurnBudget` validado em código; alvo de 80–85%; escada de dicas; `FatigueState`; avaliação "fadiga" no harness (como os evals do OpenMAIC); métrica de pedidos de pular. | §1.2–1.3, M3 |
| R11 | **Gamificação que corrói motivação ou que se farma.** | M / M | Regras r7 validadas por MC (farmers −30–40%); sem XP por rating; soft cap; ligas off; `rulesVersion` e recalibração sem reduzir XP concedido. | §2.11, M7 |
| R12 | **Alucinação na memória** (extração e atualização). | M / A | `quote` verificado na fonte; supersessão bitemporal (nunca sobrescrever); juiz de supersessão; viewer/edição; meta HaluMem DU ≥ 70. | §2.5 |
| R13 | **Divergência Lean × TS.** | B / M | DRT no CI com `arbSystem`; auditoria de axiomas; certificados em runtime. | §2.13, M9 |
| R14 | **Licenças** (AGPL + MIT/Apache/BSD/CC0 OK; GPL-2.0+ OK via GPLv3; LGPL do `mathml2omml` evitado; CC-BY-NC do cosmos e NC do mathua proibidos; repos sem licença não copiáveis). | M / A | `THIRD_PARTY_NOTICES.md`; checklist por port; lista "não copiar": Mr. Ranedeer, srs-benchmark (código), kg-gen, MathTutorBench, AML leaderboard, roadmap.sh, SIWC DevKit, tldraw, atlas-lean. | M0 |
| R15 | **Privacidade** (dados afetivos e pessoais na memória). | M / M | Tudo local; forget soft/hard; export; preferências confirmadas por toque; nada de PII em URLs; User-Agent genérico. | §2.5 |
| R16 | **Escala do learner** (tutor-mcp desenhado para 10–50 conceitos). | M / M | Atualização local O(grau^h), h ≤ 3; planner O(N log N) em ≤10⁴ nós; orquestração por região. | §2.6 |

---

## 5. Questões em aberto (só o usuário pode decidir)

1. **Provedores de IA.**
   - Opções:
     - (a) ChatGPT SIWC como principal + chave de API Anthropic opcional + Claude Code CLI próprio opt-in **desligado**;
     - (b) só ChatGPT SIWC;
     - (c) chave de API (OpenAI/Anthropic/OpenRouter) como principal.
   - **Recomendado: (a).**
2. **Gasto de tokens em background** (consolidação de memória, expansão, curadoria de vídeos).
   - Opções:
     - (a) ligado com teto diário por domínio (sugestão: 300k tokens/dia) e pausa automática no limite;
     - (b) só por clique;
     - (c) sem teto.
   - **Recomendado: (a).**
3. **Quem agenda os flashcards.**
   - Opções:
     - (a) o app, com FSRS-7, espelho no Obsidian e push opcional ao Anki;
     - (b) o Anki é o revisor principal e o app só lê o revlog;
     - (c) só o app, sem export.
   - **Recomendado: (a).**
4. **YouTube.**
   - Opções:
     - (a) Data API com chave própria + embed; modo enriquecido (InnerTube) **desligado** e ativável;
     - (b) modo enriquecido ligado por padrão;
     - (c) sem chave: só canais curados e links.
   - **Recomendado: (a).**
5. **Governança do currículo.**
   - Opções:
     - (a) AND/OR estrito (no máximo 2 alternativas), auto-apply só de folhas de baixo risco, revisão do seed fase 1 + amostra semanal de 20 arestas, trilha-alvo de ~1.480 h por domínio;
     - (b) só AND e tudo revisado manualmente;
     - (c) auto-apply total sem revisão.
   - **Recomendado: (a).**
6. **Rankings.**
   - Opções:
     - (a) desligados; só "Eu vs Eu" + coorte simulada **rotulada** opt-in;
     - (b) coorte simulada ligada por padrão;
     - (c) nenhum ranking.
   - **Recomendado: (a).**

*(No onboarding, sem bloquear a arquitetura, o app pergunta a especialização de Eletrônica e as horas por dia, com padrão de 3 h.)*

---

## 6. Marcos M0..M11 (entregáveis verificáveis + arquivos)

> MVP utilizável para **Inglês + Eletrônica** ao fim do **M3** (≈6–8 semanas). Cada marco termina com `npm test` verde e o app abrindo no Windows.

### M0 · Higiene do fork, segurança e provedores mínimos (≈1 sem.)

- **Identidade:**
  - `electron-builder.yml` (appId, productName, publish);
  - `electron/main.cjs` (`app.setName`);
  - `package.json` (name);
  - `agent_name_hint` em `electron/chatgpt.cjs` (~l.339).
- **Credenciais:** `src/store/credential-store.ts` com `safeStorage`; migração do JSON em claro em `electron/chatgpt.cjs` e `electron/subscription-store.cjs`. Teste: o arquivo no disco não contém o token.
- **ChatGPT:**
  - `refreshChatGPTModels` mantém slugs desconhecidos com template (`src/agent/chatgpt-bridge.ts`);
  - `chatGPTStreamError` por `error.code` (`src/agent/chatgpt-stream.ts`);
  - modal de limite e selo "Using ChatGPT plan".
- **Claude Code:**
  - `CLAUDE_CODE_MODELS` substituído pelos `models` do `initialize` (`src/agent/claude-code/provider.ts`);
  - opt-in desligado por padrão.
- **Correções e infra:**
  - `src/agent/tools/plan.ts:71` ("5–15 nodes");
  - `.gitattributes` (`eol=lf`), `eslint.config.mjs` ignora `_refs/**`, `scripts/run-tests.mjs`;
  - `THIRD_PARTY_NOTICES.md`, `content/curricula/LICENSE` (CC BY-SA 4.0).
- **Testes:**
  - `tests/no-hardcoded-model-ids.test.ts` (regex `gpt-|claude-|gemini-` fora de `tests/`);
  - `tests/no-anthropic-oauth.test.ts`.

### M1 · Domínios isolados + stats leves (≈1–1,5 sem.)

- **Domínios:**
  - `src/core/domains/{types,paths,manifest-schema}.ts`, `src/store/domains.ts`, `src/server/domains.ts`;
  - `app/api/domains/**`, `components/domain-switcher.tsx`.
- **Layout `data/domains/<id>/…`:**
  - `src/store/plugin-data-paths.ts` e `src/store/settings.ts` por domínio;
  - `scripts/migrate-data-layout.ts`, idempotente.
  - Troca de domínio por restart no MVP.
- **Stats:**
  - `src/core/stats/{types,aggregate}.ts`, `src/store/stats-store.ts`, `src/server/stats.ts`;
  - hook `UsageEvent` no provider;
  - `POST /api/stats/activity` (heartbeat 30 s / idle 120 s) e `GET /api/stats`;
  - `components/stats/{StatStrip,MiniHeatmap}.tsx`.
- **Critérios:**
  - `english` e `electronics` criados;
  - teste de isolamento (chat, memória e plugin de um domínio invisíveis no outro);
  - painel com horas/dia e tokens por modelo e por domínio.

### M2 · Núcleo do currículo + seed fase 1 (≈2–3 sem.)

- **Núcleo:**
  - `src/core/curriculum/{types,schema,invariants,rank,frontier,patch,certificate,hours,transitive,granularity,errors}.ts`;
  - `src/store/curriculum.ts` (patches/rejected/receipts JSONL + snapshot), `src/server/curriculum.ts`.
- **Testes:**
  - `tests/curriculum-*.test.ts` com `fast-check@4.10.2` `arbSystem` (≥10k casos);
  - replay do ledger ⇒ mesmo hash;
  - `validate` < 50 ms com 20k nós sintéticos.
- **Agente:**
  - `src/agent/json-call.ts` (runJSON/extractJSON);
  - `src/agent/tools/curriculum.ts` (`curriculum_frontier`, `curriculum_node`, `curriculum_search`, `curriculum_request_expansion`);
  - `src/agent/subagents/curriculum-seeder.ts`.
- **Âncoras:** `content/curricula/english/**` (CEFR-J VP/GP, NGSL, Octanove) e `content/curricula/electronics/**` (ModEL, NCEES FE).
- **Seed:** job `curriculum-seed` em 2 etapas com prévia e aprovação.
- **Critério:** EN e EE com o esqueleto completo de stubs + ≥300 nós materializados nas 2 primeiras áreas, 0 violações de invariante.

### M3 · Learner model + LessonOrchestrator + "o que estudar agora" (MVP) (≈2–3 sem.)

- **Learner:**
  - `src/core/learner/{types,params,emission,bkt-fsrs,kst,propagate,dina,misconceptions,planner,fold,snapshot,signals}.ts`;
  - `src/server/learner-store.ts`;
  - dependência `ts-fsrs@6.0.0`.
- **Aula:**
  - `src/core/lesson/{protocol,budget,orchestrator,fatigue,grading}.ts`, `src/server/lesson.ts`;
  - `src/agent/subagents/{lesson-planner,grader}.ts`;
  - prompts `src/agent/prompts/teacher/*` reescritos (P2–P4); `docs/teaching-methodology.md` §9 atualizado.
- **Integração:**
  - `src/agent/tools/practice.ts` `conclude` → `Evidence`;
  - card "Hoje" (`components/today/`), cards de pergunta (`components/lesson/`);
  - diagnóstico CAT curto;
  - `PlanNode.id` = id do currículo (`src/core/plan-tree.ts`).
- **Específico por domínio:**
  - EE: `NumericTemplate` + solver;
  - EN: `CoverageReport`, minimal pairs, dictation.
- **Critérios:**
  - aluno simulado completa 5 nós por domínio;
  - acerto médio em 75–90%;
  - 0 violações de `TurnBudget` em 50 turnos gravados;
  - testes de monotonicidade, Fréchet e histerese.

### M4 · Fim de sessão → flashcards → Obsidian/Anki (≈1–2 sem.)

- **Plugin:**
  - `plugins/flashcards` migra para `ts-fsrs@6` com `Reschedule.replay` de `state.reviews`, sem perda;
  - `plugins/flashcards/src/{sync-types,anki-connect,obsidian-export,apkg-export}.ts`;
  - `src/agent/subagents/flashcard-writer.ts`.
- **UI:** aprovação em lote e card de resumo ≤4 linhas.
- **Critérios:**
  - 2–6 cartões por nó;
  - re-export idempotente (0 duplicatas por `LH_ID`; Obsidian sem `<!--SR:-->`);
  - revlog do Anki vira `Evidence` com peso 0,3;
  - `.apkg` abre no Anki 26.09.4.

### M5 · Memória F1–F2 (≈2–3 sem.)

- **Código:**
  - `src/core/memory/{types,rrf,mmr,decay,supersede,assemble,ops}.ts`;
  - `src/store/memory/{sql-driver,schema.sql,memory-db}.ts`;
  - `src/server/{memory-worker,embed-worker}.ts`;
  - `src/agent/tools/memory.ts`, `src/agent/subagents/memory-extractor.ts`;
  - `ContextAssembler` em `src/server/turn-preparation.ts`.
- **Dependências:** `@huggingface/transformers@4.3.2`, `chrono-node@2.10.3`.
- **Funcionalidades:** diário (Mission / Last session / next_focus); 4 mental models.
- **Critérios:**
  - LME-S cleaned ≥ 74% (meta 85%);
  - recall p50 ≤ 200 ms;
  - vazamento entre domínios = 0;
  - memória ≤ 12k tokens por turno.

### M6 · Recursos: YouTube + livros legais (≈2–3 sem.)

- **Código:**
  - `src/core/resources/{types,score,mmr,language-fit,setcover,segments}.ts`;
  - `src/server/resources/*.ts` com `safe-fetch.ts` + allowlist;
  - jobs `curate-node`, `ingest-book`, `map-book`, `relink-resources`, `refresh-youtube`, `ocr-pages`;
  - `Referer` em `electron/main.cjs`;
  - outline em `src/agent/subagents/pdf-markdown.ts`;
  - importação para `data/library/<sha256>`;
  - painel de transcrição sincronizada.
- **Critérios:**
  - 20 nós por domínio com ≥1 vídeo aprovado nos gates;
  - 1 livro aberto (OpenStax ou ModEL) mapeado com `coverage.jsonl`;
  - teste da allowlist bloqueia hosts proibidos.

### M7 · XP, níveis, tiers e Monte Carlo (≈1–2 sem.)

- **Código:**
  - `src/core/progress/{types,xp,levels,elo,tiers,streak,rules}.ts`;
  - `src/store/progress-store.ts`, `src/server/progress.ts`;
  - `ctx.progress.record` na API de plugins;
  - `scripts/calibrate-progression.ts` → `config/progression.json`;
  - `components/progress/`.
- **Critérios:**
  - o MC reproduz L10 ≈ dia 7 e L100 ≈ dia 365 a 3 h/dia;
  - Doutor mediano em 18,2 ± 1 meses;
  - farmers ≤ 0,7× XP/h;
  - invariantes I1–I7 em teste.

### M8 · UI cel-shading + ícones (≈2 sem.)

- **Código:**
  - tema `cel` (`src/store/themes.ts`, `app/globals.css`);
  - fontes via `next/font`;
  - `scripts/icons/compile.ts` → `components/icons/{generated.ts,icon.tsx,lucide-compat.ts}` + `public/icons/sprite.svg`;
  - 33 ícones P0 + insígnias.
- **Critérios:** `tests/cel-contrast.test.ts` (AA), `tests/icons.test.ts` (≤2,4 KB, determinismo), reduced-motion respeitado.

### M9 · Expansão procedural + formalização (≈3 sem.)

- **Expansão:**
  - `src/core/curriculum/{triggers,budget}.ts`;
  - jobs `curriculum-expand-scan` e `curriculum-expand`;
  - `src/agent/subagents/curriculum-{expander,critic,judge}.ts`;
  - cards de proposta + undo; ondas em modo *shadow*.
- **Formalização:**
  - `formal/` (Lean v4.36.0, Mathlib v4.36.0, `LHFormal/*`, `lh-check`);
  - `.github/workflows/formal.yml` (lean-action v1.7.1 + auditoria de axiomas);
  - DRT `tests/curriculum-drt.test.ts`.
- **Critérios:**
  - CI verde;
  - 1.000 patches aleatórios com 100% de concordância TS × `lh-check`;
  - expansão real adiciona ≥20 nós sem violação.

### M10 · Catálogo dinâmico completo + provedores extras (≈1–2 sem.)

- **Código:**
  - `src/core/models/{registry-types,role-spec,resolve}.ts`;
  - `src/server/model-registry/**` (absorve `src/server/model-catalog.ts`), com cascata models.dev → LiteLLM → OpenRouter → pi → estimado;
  - `resources/model-metadata.snapshot.json`;
  - UI Configurações → Modelos/Papéis por domínio;
  - chave Anthropic, OpenRouter PKCE;
  - upgrade avaliado de `pi-ai` 1.4.0 → 1.5.2.
- **Critérios:**
  - um slug novo em `/v1/models` aparece sem release;
  - `RoleSpec auto` resolve com `require`;
  - lint anti-ID verde.

### M11 · Grafo massivo + memória F3–F4 (≈3 sem.)

- **Grafo:**
  - `components/graph/` com sigma 4.0.6 + graphology (galaxy, Louvain, contornos in-GL), ELK/dagre em Worker, React Flow ≤200 nós;
  - `curriculum/layout.json` por versão.
- **Memória:** Observer/Reflector, consolidação, rerank, sqlite-vec acima de 100k vetores.
- **Critérios:**
  - 10k nós a ≥50 fps em pan/zoom numa GPU integrada;
  - primeira imagem < 1,5 s;
  - 0 frames com o app ocioso;
  - BEAM-1M sem colapso.

---

## 7. Apêndice: dependências novas (versões verificadas nas fontes)

| Pacote | Versão | Licença | Uso |
|---|---|---|---|
| `ts-fsrs` (+ `@open-spaced-repetition/srs-kit`) | 6.0.0 (srs-kit 1.0.0) | MIT (srs-kit BSD-3) | FSRS-7 [tsfsrs] |
| `@open-spaced-repetition/binding` | 0.6.1 (beta) | MIT | Otimização de pesos por domínio |
| `@huggingface/transformers` | 4.3.2 | Apache-2.0 | Embeddings e rerank locais [r4] |
| `chrono-node` | 2.10.3 | MIT | Normalização temporal |
| `sqlite-vec` (opcional) | 0.1.9 | Apache/MIT | Acima de 100k vetores |
| `better-sqlite3` (fallback) | 13.2.0 | MIT | Se `node:sqlite` falhar |
| `fast-check` | 4.10.2 | MIT | PBT / DRT |
| `youtubei.js` (opt-in) | 18.3.0 | MIT | Modo enriquecido |
| `anki-apkg-export` | 5.0.0 | MIT | `.apkg` |
| `sigma` + graphology | 4.0.6 | MIT | Galaxy view |
| `perfect-freehand`, `polygon-clipping` | — | MIT | Compilador de ícones |
| fflate, linkedom, turndown | — | MIT | EPUB (T1) |
| Lean / Mathlib (só CI) | v4.36.0 | Apache-2.0 | `formal/` |

**Ports de ideias e código** (com aviso preservado):

| Origem | Licença | O que portar |
|---|---|---|
| Clew | MIT | Validador, envelope, recibos |
| BloomTutor | MIT | Regras anti-tédio, StatStrip, MiniHeatmap, `bubble.ts`, `highlight.ts`, import de EPUB |
| DeepTutor | Apache-2.0 | Memory ops, `build_segments`, gates |
| OpenMAIC | MIT | `outline-constraints`, `cue_user` (evitar o `mathml2omml` LGPL) |
| tutor-mcp | MIT | Sinais, `prepare_assessment` |
| mathua | MIT | Ledger FIRe em micro-unidades, `planWeek` (sem o conteúdo NC) |
| gen-mentor | CC0 | `runJSON`, `extractJSON`, simulador de aluno |
| Hindsight | MIT | Prompts de extração e consolidação, matemática do recall |
