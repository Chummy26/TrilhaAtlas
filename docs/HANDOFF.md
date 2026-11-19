# Handoff — SOTA study app (branch `estudos-sota`)

Snapshot of 2026-11-19, written by the agent that planned, researched, built the modules and did the first integration. This file is self-contained. Read it first, then:

1. `AGENTS.md`: mandatory project rules.
2. `docs/research/00-SINTESE.md`: the architecture spec. Every decision cites its section.
3. `docs/impl/integration.md`: what is connected to the app and what is not yet.
4. `docs/impl/<module>.md`: the API of the module you are about to touch.

---

## 1. The user's original request (verbatim, pt-BR)

> Voce vai trabalhar na criacao da aplicacao para estudos SOTA utilizando AI recentes e tambem Livros Didaticos e Aulas de Youtube em paralelo com seu devido tema. Comece primeiro planejando como vai ser, depois busque por papers de alto nivel relacionados e tambem metodologia mais avancada para isso. Depois busque por repositorios bons relacionados e clone para extrair cada parte boa e utilizar. Utilize https://github.com/amosblomqvist/learnharness como base de UI e interface no qual utilizaremos e moldaremos a nosso favor tambem. Um grande grafo tipo uma arvore com muitos nos deve ser feito até atingir tal meastrias sobre dominio expecifico no qual está estudando ou seja se eu irei por exemplo fazer Eletronica, devo comecar pelos principios junto com o grande grafo incluindo TODOS os principais e ir avancando até chegar longe. O grafo deve ser imensamente com muito conteudo que deve durar +1 ano com em torno de 2-4hrs+ por dias de estudos. para cada nó e juncao deve ter suas aulas, seja livros, explicacaoes geradas por AI geradas didaticamentes boas na hora englobando os necessarios. Tambem quero um SOTA context memory, seja com base em referencias ou utilizando um escolhido para ajudar isso nos grafos e contextos de aonde está e onde vai ter, ajudar a identificar pontos fracos expecificos e os nos ir seguindo esse caminho para sempre ir englobando tudo até um bom doutarado. A parte dos nós deve ser complexa por tras do visual, monte essa busca pois a partir dela outros nós podem ir surgindo de forma procedural e contextual com dominios novos com base no que for necessario, meio que como um algorimtimo que as vezes quando necessario pede a uma AI para ampliar seus nos e informacoes. Sessoes devem ser separadas pelo que estou estudando e eu posso trocar isso, ou seja se estou em eletronica todos contextos, e historicos e etc sao ali daquela sessao, e irei ter no momento idiomas que irei escolher ingles e eletronica, serao esses 2. Integre anki ao fim de cada sessao/grafos ou se for mais high-tech  Obsidian com plugins para cartões. Quero tambem nivel e perfil e xp em varias partes, rode uma simulacao monte carlo para separar por rankings para evoluir e que seja compativel com ganhos com base no meu nivel atual.
>
> Além do learnharness tenho umas outras referencias de que deve ser analisada manualmente por completo todas e além dessa vale como dito no comeco a pesquisa extensa de varios outros repos: https://github.com/bxxd/open-mastery https://github.com/Li-Evan/BloomTutor https://github.com/THU-MAIC/OpenMAIC https://github.com/HKUDS/DeepTutor
>
> As mudancas de visual no learnharness deve ser clean e um visual cel shading. Sobre context memory SOTA lider em benchs atuais ou o melhor open-source verifique da melhor forma de ser feito para ser integrado a tudo em forma de otimizar e melhorar produditivdade, didaticas, tambem procure por referencias e veja se isso ja foi testado por outros. Construcao de estudos para toda jornada basicamente arvore deve ser feito como dito massivamente e claro com lógica bem definida, entao possivelmente verifique para evitar ficar sem lógica de evolucao correta veja uma forma correta se possivel formalizar com lean ou provas necessarias matematicas na hora de construir isso. IA que irei utilizar serao as de assinaturas ou seja login with ... exemplo OPENAI ou Anthorpic caso a anthorpic permita utilizar assinaturas em terceiros para isso. E tambem as escolhas de modelos deve ir junto sem hardcodar para evitar perder futuras atualizacoes. Nessa construcao de estudos, como dito livros e videos devem vir junto com base em regioes expeficicas de dominios de nós, ou seja ali junto em ordem videos em portugues ou ingles legendado/dublado automatico pelo yt caso tenha devem vir juntos, livros tambem fazem parte disso tudo porém como livro pode ser maior ele pode englobar uma regiao maior, livros devem tambem ter seus nomes e baixar-los para incluir contextos. Inclua um stats leve em um lugar expeficico tipo no perfil para mostrar quantos de TOKENS foram gastados em qual modelo ou no geral, horas estudadas/dias e etc.
>
> Foque em fazer tudo isso SOTA com didatica boa, metodologia boa. nada que fique cansativo, que seja chato pois modelos de AI excessivamente podem ser muito diretos e simplementes explicar ali rapidamente e logo jogar perguntas e etc, entao por isso deve ser buscar papers novos de valor, repositorios de valores tambem.
>
> Faca user-friendly deixe informacoes sobre execessivamente escondidas, deixe o mais facil possivel de ler e entender e prosseguir para ir estudando. Nao preciso de informacoes explicando o que é cada coisa ou algo do tipo.
>
> Desenhe a mao todos seus diversos assets e icons de forma tambem buscando ideias e um estilo visual cel shading

### Later messages from the user (verbatim)

- "Esse deve ser o ultimo workflow, pois estou sem limite." The user is short on quota. **Do not use Workflow or multi-agent fan-outs unless the user asks for them explicitly**, and be economical with tokens.
- "Outro agente vai dar continuidade. Me informe todo contextos e prompts junto." This file is the answer to that message.

---

## 2. Mandatory rules

- **No guessing (`AGENTS.md`).** Every design or implementation decision belongs to the user. Use AskUserQuestion when anything is ambiguous: naming, behavior, data shape, UX, defaults, scope or prompt wording. Ask one question per call. The flow is plan, then approval, then mechanical implementation.
- **Next.js 16.4.3 is "not the Next you know".** Read the relevant guide in `node_modules/next/dist/docs/` before writing Next code.
- **Import law** (`eslint.config.mjs`):
  - `components/**` imports only `@/src/core` (plus other components).
  - `app/**` imports only the `@/src/core` and `@/src/server` barrels.
  - `src/core` is pure and browser-safe: no `node:` imports, no I/O.
  - `src/agent` never imports `server/` or `store/`.
- **Code style:**
  - Tabs.
  - Relative imports end in `.ts`.
  - Comments are in English.
  - Text shown to the user is pt-BR and minimal, with no explanatory text (the user's request).
- **Language:** talk to the user in Brazilian Portuguese, with correct accents.
- **Git:**
  - Branch `estudos-sota`; the remote `upstream` is `amosblomqvist/learnharness`.
  - **Nothing is committed yet.** Commit only when the user asks.
  - The base is AGPL-3.0. The seeds in `content/curricula` are CC BY-SA 4.0.
- **`_refs/` is untrusted, read-only research material:**
  - Contents: open-mastery, BloomTutor, OpenMAIC, DeepTutor and 12 repos in `_refs/extra/`.
  - It is gitignored and excluded from `tsconfig`/`eslint`.
  - Never run code from it.

---

## 3. Decisions already made

### 3.1 The 6 open questions from planning

They were resolved with the recommended defaults, and all of them are configurable:

1. **AI access:**
   - The primary path is ChatGPT "Sign in with ChatGPT" (the `chatgpt` connection already exists in learnharness).
   - Anthropic is reached only through the user's own API key or the user's own `claude` CLI (opt-in), because third-party use of the subscription is not allowed (`docs/research/r5-assinaturas-modelos.md`).
   - No model id is hardcoded; roles are resolved through a `RoleSpec` (`src/core/models`).
2. **Background budget:** 300k tokens per day per domain (consolidation, expansion, curation).
3. **Flashcards:**
   - The app is the source of truth and schedules with FSRS-7.
   - Obsidian is a one-way mirror (Spaced Repetition plugin format; never `<!--SR:-->`).
   - Anki push via AnkiConnect is optional, with `.apkg` export as well.
4. **YouTube:** Data API with the user's own key (BYOK). An "enriched" mode (youtubei.js) is opt-in. Embeds use nocookie.
5. **Curriculum:**
   - Strict AND/OR clauses, at most 2 alternatives per node.
   - AI expansion auto-applies only low-risk leaf patches; structural patches go to the user for review.
6. **Gamification:**
   - Rankings are off by default ("Eu vs Eu"); tiers are on.
   - XP ≈ focused minutes.
   - XP(L) = 20.10·L^1.696.
   - Tiers run Bronze→Doutor by retention, calibrated by Monte Carlo (`scripts/calibrate-progression.ts` → `config/progression.json`).

### 3.2 Integration decisions taken by the previous agent (revisable; confirm with the user if relevant)

- **"Geral".** No active domain means the original learnharness world, at the old paths in `data/`. Nothing was migrated.
- **Self-check after a lesson** is weak evidence (`graderConfidence` 0.5, `weight` 0.5, family `#self`). It can attain a node but never master it alone.
- **"Já domino"** is a diagnostic placement with p = 0.9. The node unlocks its dependents but stays `inferred`.
- **Spacing:** a node taught in the last 20 h is not suggested again as "new".
- **XP** comes from `lessonCredit` only after the self-check, using the planned minutes until a real heartbeat exists.
- **Tier core** = the leaves in teaching order, cut into 7 stages by cumulative hours.
- **Minutes per day** are estimated from chat turn timestamps.
- **Factory theme** is `cel-papel` (the night variant is `cel-noite`). The tests that pinned "default" were updated.

### 3.3 Architecture in one paragraph (details in `00-SINTESE.md`)

- **Domains.** Each domain (English, Electronics) is an isolated world in `<LH_DATA_DIR>/domains/<id>/`: chats, graph, jobs, curriculum, learner, memory, resources, progress and flashcards.
- **Curriculum.** A forest Domain→Area→Unit→Topic→Atom with CNF clauses. A container is a milestone (`[[children]]`). Invariants R1/R2/R3 are checked on the *effective* system, with a rank certificate (Kahn + Pearce–Kelly). Patches go through a ledger.
- **Learner.** A pure fold over an append-only event log: BKT (pL) × FSRS-7 (R), monotonic `attainedAt`, FIRe implicit credit, DINA blame, KST fringes.
- **Planner.** A greedy planner (reviews → fringe∩plan → remediation → probes) that shows **one** suggestion ("Hoje").
- **Lesson.** A pure state machine (`LessonOrchestrator`) with a `TurnBudget`.
- **Memory.** In-process TypeScript, SQLite per domain (FTS5 + local e5-small embeddings), RRF/MMR, bitemporal facts, ≤12k tokens per turn.
- **Resources.** YouTube BYOK plus open books only (OpenStax, LibreTexts, Kuphaldt, etc.); protected books are stored as metadata only, or as the user's own PDF.

---

## 4. Code map (what exists and its status)

| Path | Contents | Status |
|---|---|---|
| `src/core/curriculum/**` | schema, effective, rank, certificate, invariants, patch, seed, ledger, frontier, hours, triggers, budget, query | pure, tested; used for seed + projection |
| `src/core/learner/**` | graph-view, fold, planner, fsrs, bkt-fsrs, dina, propagate, kst, elo, signals, snapshot, params | pure, tested; **integrated** (Hoje) |
| `src/core/study/**` | `learnerViewOf`, `nodeBrief`, API types (`StudyToday`, `StudyProfile`, `StudyDomainList`) | **new in the integration** |
| `src/core/lesson/**` + `src/agent/prompts/lesson/*.md` | orchestrator, budget, grading, hints, fatigue | pure, tested; **not integrated** into turns |
| `src/core/progress/**` + `scripts/calibrate-progression.ts` | XP, levels, tiers, Monte Carlo | used by the profile; calibration exits 1 (see §7) |
| `src/core/memory/**`, `src/store/memory/**`, `src/server/memory/**` | SQLite memory, embedder, extractor | tested; **not integrated** |
| `src/core/resources/**`, `src/server/resources/**`, `content/resources/*.json` | YouTube, open books, scoring, playlist | tested; **no UI** |
| `src/core/{domains,models,stats}/**`, `src/store/{domains-store,stats-store,credential-store}.ts` | domains, RoleSpec/registry, usage/activity events | domains integrated; models and stats **not integrated** |
| `plugins/flashcards/src/**` | FSRS-7, AnkiConnect, Obsidian, `.apkg`, export-service | tested; **no end-of-session trigger** |
| `scripts/icons/**`, `components/icons/**`, `public/icons/sprite.svg` | deterministic hand-drawn icon compiler (perfect-freehand) | in use (`<Icon name=…>`) |
| `app/globals.css` (`[data-theme-family="cel"]`), `src/core/themes.ts` | cel tokens, `.cel-card/.cel-button/.cel-chip/.cel-display` utilities | active |
| `content/curricula/{english,electronics}/*.json` | seeds: Electronics 809 leaves (~1,916 h), English 771 leaves (~1,510 h) | loaded on first open |
| `config.ts` | `PATHS.chats/graph/jobs`, `LEDGER_FILES`, `GRAPH_FILES` are **getters** for the active domain; `activeDomainId()`, `setActiveDomainId()` | integrated |
| `src/server/study.ts` | domains, `loadCurriculum`, learner events, `studyToday`, `recordStudyEvent`, `studyProfile` | integrated |
| `app/api/domains`, `app/api/study/{today,events}`, `app/profile` | API and profile page | integrated |
| `components/study/{domain-switcher,today-card,profile-view}.tsx`, `components/home.tsx` | domain pill, "Hoje" card, profile, lesson start with `graphContext` | integrated |
| `src/agent/prompts/teacher/22-cadence.md` (+ edit to `20-teaching.md`) | checks per arc, ≤1 question per message, ≤3 per node, no filler | active |
| `docs/research/*.md` | r1–r10 (pedagogy, KT/SRS/KST, curriculum, memory, subscriptions, videos/books, gamification, repos, cel visual, Lean), `ref-*` (the 4 references), `extra-*` | reference |

---

## 5. Verified current state (2026-11-19)

- **HTTP smoke on real `next dev`** (temporary data dir):
  - `GET /api/domains` lists both domains.
  - `POST /api/domains {"active":"electronics"}` switches the world.
  - `GET /api/study/today` returns "Potências de dez e notação científica" (path "Ferramentas matemáticas › Álgebra e funções › …").
  - `/profile` returns 200 and `/` returns 200.
- **Screenshots:**
  - Home in cel paper: "Eletrônica" pill, "Hoje" card with "Começar aula" (volt) and "Já domino".
  - Profile with level, XP, a Novato tier per domain, and time.
- **Learner loop** (scratchpad script): exposure → self-check → "Hoje" moves on; "Já domino" unlocks the next node (attained 1).
- **`tsc --noEmit`:** 0 errors. **eslint** on the new files: clean.
- **Full suite:** only the baseline Windows failures (Appendix A), plus 3 flaky files under parallel load that pass on their own: `chat-store-events`, `browser-service-readiness`, `plugin-contributions`.
- **Git:** about 148 modified or untracked paths, **not committed**.
- **Known layout fix:** the profile icon was moved next to the domain pill, because at the far right the graph's floating controls covered it. The change is in `components/home.tsx`. It was not re-checked visually after the move.

---

## 6. How to run and verify

```bash
node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit -p .
```

```bash
npx eslint components/study app/profile app/api/domains app/api/study src/server/study.ts src/core/study config.ts components/home.tsx
```

```bash
node scripts/run-tests.mjs
```

```bash
node scripts/run-tests.mjs "tests/curriculum-*.test.ts"
```

```bash
npm run dev
```

**Gotchas:**

- **Use a temporary data dir for smoke tests.** Without one, the server writes to the user's real `data/`. Set `LH_DATA_DIR` to a temporary folder and run `npx next dev -H localhost -p 3123`.
- **`next dev` may exit once.** The first run can exit right after "Ready" while printing a notice; running it again works.
- **tsc needs more memory.** Use `--max-old-space-size=8192`. `_refs` is excluded in `tsconfig.json`; without the exclusion tsc runs out of memory.
- **Bash heredocs with backticks fail to parse.** In this environment (Git Bash through the tool), a heredoc containing a backtick (`` ` ``) breaks parsing. Write scripts with the Write tool and run them from a file.
- **On Windows, `npm test` goes through `scripts/run-tests.mjs`.** It is portable: it calls tsx and sets `NODE_ENV=test`.
- **Seeds are validated by `tests/curriculum-seeds.test.ts`.** Editing `content/curricula/**` requires re-running it. After a seed change, delete `data/domains/<id>/curriculum/` so `loadCurriculum` re-seeds.

---

## 7. Prioritized next steps (starting point → done when)

1. **Quiz answers → learner Evidence** (most important for the model to learn from real data).
   - *Starting point:* find where `quiz` / question tools record the outcome (`src/agent/**`, `src/server/**`, `tests/question-tools.test.ts`, `src/core/plugin-questions.ts`). The chat→node link is the session's `graphContext` marker (`message[0]`, created in `app/api/chats/route.ts`; `lesson.context.id` = the node id).
   - *Done when:* answering a check in a lesson appends an `evidence` event (q-vector to the node, grade 0–3, hints, latency, `minutesSinceExposure`) to `learner/events.jsonl`, and "Hoje" stops depending on the self-check.
2. **Real stats.**
   - *Starting point:* `src/store/stats-store.ts` and `src/core/stats/events.ts`.
   - *Done when:* the renderer sends an `ActivityEvent` heartbeat (focused window, 60 s), the provider records a `UsageEvent` per model call (`src/server/pi/*`), and `studyProfile` reads them instead of estimating.
3. **Context memory in turns.**
   - *Starting point:* `src/server/memory/index.ts` and `src/agent/prompts/memory/*.md`.
   - *Done when:* each tutor turn receives the domain memory block (≤12k tokens) plus the learner snapshot (`buildPromptSnapshot` in `src/core/learner/snapshot.ts`), and the `extractor` consolidates at the end of the turn.
4. **Region materials — integrated.** Open the skill tree from Hoje or “Materiais da aula” from a curriculum chat. Each unit is a region. Chapters and video segments may cover multiple regions of the same domain. YouTube discovery uses the key in Settings → Providers → Materiais de estudo. Curated material works offline, and discovered matches are marked as suggestions.
5. **End-of-session flashcards.**
   - *Starting point:* `plugins/flashcards/src/export-service.ts` and `docs/impl/flashcards-export.md`.
   - *Done when:* the trigger runs at the end of a lesson, decks are per domain, and the Obsidian/Anki options live in Settings.
6. **Procedural expansion of the graph.**
   - *Starting point:* `src/core/curriculum/{triggers,patch,budget,granularity}.ts`.
   - *Done when:* a background job calls the `curriculum` role, a low-risk patch is applied with `applyPatch`, the ledger gets a new line and `snapshot.json` is rewritten, and structural patches are shown for review.
7. **Model registry by role.**
   - *Starting point:* `src/core/models` (`RoleSpec`, `resolve`) and the existing engines, which still use the strong/cheap/vision slots (`config.ts ModelRole`, settings).
   - *Note:* this is a large change; ask the user design questions first.
8. **Per-domain onboarding.** Set `DomainProfile` (daily budget, goal, starting level) and run the diagnostic placement. There is no UI yet; the default is 180 min per day.
9. **Curriculum map — integrated.** `/mapa` opens with every node of the active domain on a zoomable Canvas. Overview links summarize actual prerequisites. Zoom reveals regions and individual skills. The learner's recorded progress drives the amber and green markers. The electronics curriculum and its upgrade for existing installations are described in [the individual review](impl/auditoria-eletronica/README.md).
10. **Plugin data per domain.** `src/server/plugins.ts` (`pluginDirectory`, `core-plugin-data`) is still global.
11. **Lean.** The `formal/` folder is planned, with CI only (`docs/research/r10-formalizacao-lean.md`); Lean is not installed locally.
12. **Progress calibration.** The script exits 1: the skimmer farmer reaches 0.71× (limit 0.7). This needs a rules v2 decision from the user.
13. **Open question for the user:** the original learnharness UI strings are still in English ("What do you want to learn?", "Teach/Practice", "Chains"). Ask before translating.
14. **Smaller known gaps:**
    - `components/icons/generated.ts` is about 177 KB.
    - Memory MMR does not seed per kind.
    - Learner `speed` is fixed at 1.

---

## 8. Continuation prompt (paste into the next agent)

```
Você vai continuar o desenvolvimento do app de estudos SOTA neste repositório (C:\Users\nicoolas\Pictures\learnharness, branch estudos-sota, base learnharness + Next.js 16).

Antes de qualquer coisa leia, nesta ordem: docs/HANDOFF.md (contexto completo, pedido original do usuário, decisões, estado, gotchas), AGENTS.md (regras obrigatórias: não adivinhar decisões de design — pergunte com AskUserQuestion, uma pergunta por vez; plano → aprovação → implementação; leia node_modules/next/dist/docs antes de mexer em Next), docs/research/00-SINTESE.md (spec) e docs/impl/integration.md (o que está ligado e o que falta).

Regras: responda em português do Brasil; respeite a lei de imports do eslint (components → só @/src/core; app → só barrels core/server; src/core puro); tabs; imports relativos com .ts; não faça commit sem pedir; não use Workflow nem fan-out de muitos agentes (o usuário está com cota limitada) — trabalhe direto e econômico; teste smoke com LH_DATA_DIR temporário, nunca com a pasta data/ real.

Estado: tudo funciona ponta a ponta (domínios Inglês/Eletrônica isolados, currículo validado, card "Hoje", aula com contexto do nó, perfil, tema cel). Nada commitado ainda — pergunte ao usuário se deve commitar antes de seguir.

Próximo passo sugerido (§7 item 1 do HANDOFF): fazer as respostas de quiz dentro da aula virarem Evidence no learner/events.jsonl do domínio ativo. Comece investigando onde o resultado do quiz é persistido e proponha o plano ao usuário antes de implementar.
```

---

## Appendix A — Baseline test failures on Windows (existed before any change)

These fail in the original learnharness on Windows (0600 file modes, SIGTERM, missing claude CLI, CRLF, release verify, etc.). A failure **outside** this list is a regression.

```
AuthStore adapter
HTTPS preserves certificate/SNI validation and refuses a private peer before HTTP dispatch
LH_DATA_DIR seam
automatic-update preference gate
catalogProviders() marks claude-code absent and modelCatalog() hides it when the CLI is missing
checks a hostname's actual peer again when DNS changes on a new connection
constructs light native chrome before renderer reporting and accepts appearance only from its exact main-frame origin
cwd is an empty temp dir; prompt and mcp config live in a separate private dir
desktop appearance boot and IPC
explicit OFF skips automatic checks, but manual checks still run without reading the preference
external desktop development reads the server's directory rather than the shell's -dev profile
github-copilot: independent default-ON file, restart, explicit OAuth lease and local disconnect
installed Next forced-clone control demonstrates the previous oversized-epilogue acceptance
learner image source safety
main loader resolves Pi's import-only PUBLIC package exports and native OAuth without a CLI or network
managed openai requests preserve native session affinity and caching
managed openrouter requests preserve native session affinity and caching
native app and conversation identity
normal completion escalates termination when the child ignores SIGTERM
plugin workers keep isolated deepseek-v4.1-flash sessions across tool rounds (cache none)
plugin workers keep isolated glm-5.3 sessions across tool rounds (cache default)
private JSON file round-trips global state; creation and atomic replacement are owner-only
produces the complete rooted skill, matching versions, current example layout and no repository-only files
providerKeyPresent("claude-code") requires both explicit opt-in and executable presence
release gate — CLI (offline, repo config)
select emits machine JSON for the workflow's download step
select warns loudly for the legacy unprefixed draft tag
serves the keyed providers' catalogs with the picker's DTO shape
the claude-code provider (native CLI authentication, no LearnHarness key)
the committed reference covers every real SDK public type/member and exactly matches fresh generation
the documented npm command builds and installs without a checkout, and build failure prevents installation
the file is mode 0600 (secrets), also after rewrites
the model catalog projection
unset = the repo data/ exactly as before (fresh child process, no env)
uses the shared sensitive-path guard for displays and annotation dispatch
verify fails a draft with a missing blockmap and a stale asset
verify fails closed when the tag disagrees with package.json
verify passes the complete draft and exits 0
verify works after a package version bump without changing the tests
xai: independent default-ON file, restart, explicit OAuth lease and local disconnect
```

(The baseline also listed 3 items that now pass after the cel changes: "Default reproduces app/globals.css's literals exactly", "native inline/fenced code and both CodeMirror modes…" and "themeVars — the adapter".)
