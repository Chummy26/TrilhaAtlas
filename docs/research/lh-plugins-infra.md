# lh-plugins-infra — plugins, flashcards, Windows, Electron e testes do learnharness

> Relatório de pesquisa (2026-11-18) sobre o fork do **learnharness 0.6.1** em
> `C:\Users\nicoolas\Pictures\learnharness` (Next.js 16.4.3, React 19.2, Electron 44.9.3,
> TypeScript 5.9.3, `@earendil-works/pi-agent-core`/`pi-ai` 1.4.0, AGPL-3.0-only).
> Escopo: `plugins/**`, `docs/plugin-*.md`, `docs/plugin-api/**`, `docs/flashcards-*.md`,
> `src/{core,server,agent,store}/plugin-*.ts`, `components/plugin-*.tsx`, `examples/plugins/**`,
> `electron/**`, `scripts/**`, configs (`next.config.ts`, `config.ts`, `proxy.ts`,
> `instrumentation.ts`, `electron-builder.yml`, `package.json`, `tsconfig.json`,
> `eslint.config.mjs`), `tests/**`, `.github/workflows/**`, `docs/development.md`,
> `docs/desktop-release.md`.
> Nada de `_refs/` foi executado. Os únicos comandos que rodaram código do repo foram testes
> (`node --test` / `node --import tsx --test`) em diretórios temporários, para medir o estado no Windows
> (seção 6.2).

---

## 0. Resumo executivo (respostas curtas)

| Pergunta | Resposta curta |
| --- | --- |
| **(a) Plugin vs core** | Plugin quando a feature cabe nos contratos v1 existentes (view própria, store própria em `ctx.dataDirectory`, workers/agents/inference, tools/instruções aditivas para `prober`/`teacher`/`practice`, tipos de pergunta/problema, interceptação de submissão, renderers). **Core** quando precisa de algo que a API v1 declara como *non-goal*: escrever no grafo/chats do core, criar/iniciar sessões, injetar contexto **dinâmico por chat** no system prompt, namespaces por domínio, download/salvar arquivo, novos eventos. Para as metas do usuário: flashcards/export, XP/ranking, stats e o "currículo" podem ser plugins; **memória integrada**, **sessões por domínio** e **ligação currículo↔sessão de ensino** exigem mudanças no core (seção 3). |
| **Flashcards: algoritmo** | **FSRS-6** (21 pesos), porte sem dependências e *selecionado* de `ts-fsrs@5.2.3` (MIT) em `plugins/flashcards/src/scheduler.cjs`; parâmetros publicados padrão, **sem fuzz e sem otimizador**, learning steps 1m/10m, relearning 10m, retenção 90%, dia de estudo começando 04:00. Agendamento **por proposição** (não por cartão) + escolha ponderada de cue. Estado atual do ecossistema: `ts-fsrs@6.0.0` (2026-10-28) tornou **FSRS-7** (34 pesos) o padrão; Anki estável ainda usa FSRS-6. |
| **(b) Anki/Obsidian** | **Não existe** integração: é decisão explícita do v1 ("No Anki integration", `docs/flashcards-vision.md`). Mas o plugin tem os pontos certos para plugar: novos `ctx.handle(...)` no backend (`src/backend.cjs`), itens de menu/toolbar no frontend (`src/main.js`, `src/library-tree.js`), campos novos em `settings` (`src/store.cjs` + `validateSettings`). Recomendação: (1) **Obsidian** (Markdown nativo — os cartões já são Markdown + `$…$` + Mermaid, exportação quase sem perdas) gravando direto no vault pelo backend; (2) **AnkiConnect** pelo backend Node (`http://127.0.0.1:8765`, sem CORS); (3) `.apkg`/TSV como fallback de arquivo. Seção 5. |
| **(c) Windows** | `npm run dev`, `build`, `start`, `typecheck`, `lint`, `plugins:*` funcionam em `cmd`/PowerShell. **Quebram**: `test` (`NODE_ENV=test …`), `desktop:dev` (`LH_DEV_URL=… electron .`), `dev:fresh` (`bash` → no PATH resolve para `C:\WINDOWS\system32\bash.exe` = **WSL**), `desktop:dist` (só macOS). Medido (modo CI, sem chaves no ambiente): suíte completa no Windows = 5327 testes, **5288 ok / 32 falhas em 19 arquivos / 183 s**, concentradas em suposições POSIX (modos `0o600`, caminhos `/fixture/...`, `--import C:\...` sem `file://`, `os.tmpdir()` com env substituído) e **CRLF** (a working tree está em CRLF por `autocrlf=true`). Correções portáveis: scripts Node (`scripts/run-tests.mjs`, `desktop-dev.mjs`, `dev-fresh.mjs`, `desktop-dist.mjs`) ou `cross-env`; globs **entre aspas** para o `node --test` expandir; `.gitattributes` com `eol=lf`; job Windows no CI. Seção 6. |
| **(d) Electron/Windows** | Build: `npm ci` → `plugins:setup` → `build` → `smoke-provider-runtime` → `build-server` → `smoke-server --electron` → `npx electron-builder --win --x64 --publish never` (NSIS x64, **não assinado**). Dados: `app.setName("LearnHarness")` ⇒ `userData = %APPDATA%\LearnHarness` ⇒ dados em `%APPDATA%\LearnHarness\data\`, chaves em `%APPDATA%\LearnHarness\auth.json`, log em `%APPDATA%\LearnHarness\logs\main.log`; dev shell usa `%APPDATA%\LearnHarness-dev`, mas o servidor `next dev` usa `<repo>\data`. Auto-update: `electron-updater` 6.8.9, feed **GitHub Releases de `amosblomqvist/learnharness`**, checagem no boot + 24h, download automático, instala ao sair. **O fork precisa trocar `appId`/`productName`/`publish`**, senão compartilha dados e recebe updates do upstream. Seção 7. |
| **(e) Testes** | `node:test` + `tsx`, um arquivo `tests/<area>.test.ts(x)` por fronteira; DOM com `linkedom` + `react-dom/server`/`act`; providers falsos via `createFauxCore`/`fauxAssistantMessage` (pi-ai) ou `streamFn` roteirizado; dados em `mkdtemp` + `LH_DATA_DIR`/`LH_AUTH_FILE`; golden fixtures reais; plugins com testes próprios (`node --test tests/*.test.cjs`) **que o CI não roda** hoje. Seção 8. |
| **(f) Armadilhas** | Next 16 (Turbopack padrão, `proxy.ts` no lugar de `middleware`, APIs assíncronas, `.next/dev`, lockfile de dev), tracing do standalone (excludes "load-bearing"), código de plugin só recarrega com **restart**, um servidor por data-dir, `PATHS` fixados no load do módulo, instruções de plugin **estáticas**, `autocrlf=true` sem `.gitattributes`, `_refs/` não ignorado pelo ESLint, store do flashcards sem retry de rename no Windows e reescrevendo um JSON que cresce a cada review. AGENTS.md exige **não adivinhar decisões de design**. Seção 9. |

---

## 1. Mapa da infraestrutura de plugins (API v1)

### 1.1 Camadas e arquivos

| Fronteira | Implementação |
| --- | --- |
| Contratos públicos (browser-safe, type-only) | `src/core/plugins.ts` (manifest, `PluginBackendContext`, `PluginFrontendContext`), `plugin-ui.ts`, `plugin-agents.ts`, `plugin-workers.ts`, `plugin-questions.ts`, `plugin-problems.ts`, `plugin-submissions.ts`, `plugin-view-context.ts`, `plugin-tree.ts`, `plugin-shortcuts.ts`, `plugin-validation.ts` |
| Composição do servidor (singleton por processo) | `src/server/plugins.ts` (`globalThis.__lhPlugins`, `initializePlugins`, `getPluginHost`, `getPluginAgentContributions`) chamado por `instrumentation.ts` (`register()` com `NEXT_RUNTIME === "nodejs"`) |
| Host (descoberta, enable/disable, ativação, contribuições por turno) | `src/server/plugin-host.ts` (~37 KB) |
| Loader nativo de backend (fora do grafo do Next) | `scripts/plugin-loader.cjs` (`createRequire(filename)(filename)`; cache do Node mantido) |
| Loader de frontend | `public/plugin-loader.js`, `components/plugin-manager.ts`, `components/plugins.tsx` (`PluginsProvider`, 1 ciclo de vida por janela) |
| Rotas HTTP | `app/api/plugins/route.ts` (lista), `[id]/route.ts` (enable/disable), `[id]/call/route.ts` (ponte JSON `ctx.call`→`ctx.handle`), `[id]/assets/[...file]/route.ts` (só entradas declaradas + `assets/`), `[id]/documents/markdown/route.ts` (multipart limitado, isento do `proxy.ts`) |
| Caminhos de dados | `src/store/plugin-data-paths.ts` (`safePluginDataDirectory`, recusa symlink/escape) |
| Leitura de dados de aprendizagem | `src/server/plugin-learning.ts` (fachada **somente leitura**) |
| Inferência | `src/server/plugin-inference.ts` (catálogo, consentimento, uso em `data/usage.jsonl` do plugin) |
| Agentes gerenciados / workers | `src/agent/plugin-agents.ts`, `src/agent/plugin-workers.ts`; registros em `src/store/plugin-agent-records.ts`, `plugin-task-records.ts` |
| Background tools / atividade | `src/server/plugin-background-tools.ts`, `plugin-worker-activity.ts` (+ jobs/steers do host) |
| Perguntas/problemas canônicos | `src/server/plugin-questions.ts`, `plugin-problems.ts`; `src/agent/plugin-question-tools.ts`, `plugin-problem-tools.ts` |
| UI controlada | `components/plugin-ui-host.tsx`, `plugin-chrome.tsx`, `plugin-settings-rows.tsx`, `plugin-tree.tsx`, `plugin-knowledge-picker.tsx`, `plugin-model-picker.tsx`, `plugin-surfaces.tsx`, `plugin-surface-shell.tsx`, `plugin-surface-targets.ts`, `plugin-shortcuts.tsx` |
| Submissões | `components/plugin-submission-runner.ts`, `plugin-submission-adapters.ts` |
| Build/staging de core plugins | `core-plugins.json` = `["flashcards","coding-questions","drawing-pad","rich-code-blocks"]`; `scripts/build-core-plugins.mjs` → `core-plugins/<id>/` (gerado, gitignored) |
| SDK/Docs gerados | `scripts/build-plugin-types.mjs` (SDK type-only → `.sdk/` dos plugins TS ou `dist/plugin-sdk`), `scripts/build-plugin-api-reference.mjs` (gera `docs/plugin-api/*.md`), `scripts/build-plugin-authoring.mjs` (zip do "authoring skill" em `public/plugin-authoring/`) |

### 1.2 Pacotes, origem e onde ficam código/dados

- Manifest (`parsePluginManifest` em `src/core/plugins.ts`): `apiVersion: 1`, `id` (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, igual ao nome da pasta), `name`, `version`/`minAppVersion` numéricos `x.y.z`, opcionais `description`, `author`, `main` (ESM de browser), `backend` (CommonJS Node), `styles` (requer `main`). Entradas são arquivos na raiz de `dist/`, nunca caminhos para `data/`.
- **Core** (vem com o app): código em `<app>/core-plugins/<id>/` (somente leitura), dados em `<data>/core-plugin-data/<id>/`. IDs reservados mesmo se o pacote faltar.
- **Community**: `<data>/plugins/<id>/dist/` (código) + `<data>/plugins/<id>/data/` (dados; nunca servido).
- Estado de enable: `<data>/plugins-state.json` (`{version:1, enabled:{id:boolean}}`), **tudo nasce desabilitado**.
- `data/agents/`, `data/tasks/`, `data/usage.jsonl` dentro do diretório de dados do plugin são **reservados ao host**.
- **Sem hot reload**: "Refresh" só descobre pacotes; mudar código carregado exige **reiniciar o servidor** (cache de módulos do Node). `dev`/`build` rodam `plugins:build-core` antes do Next.

### 1.3 `PluginBackendContext` (backend, uma ativação por servidor)

| Membro | Uso |
| --- | --- |
| `manifest`, `directory`, `dataDirectory`, `signal`, `cleanup(fn)` | identidade, código, dados graváveis, cancelamento cooperativo |
| `learning` | **somente leitura**: `listSessions()`, `getSession(id)` (`ChatRecord` completo, inclui respostas/thinking do aluno), `graph()` (`GraphSnapshot`: `propositions`, `chains`, `sessions`, `fileSources`…), `readGraphFile("nodes.jsonl" \| "chains.jsonl" \| "sessions.jsonl" \| "coverage.jsonl" \| "sources.json" \| "positions.json" \| "render-settings.json" \| "format.json")`. Leituras não transacionais. |
| `inference` | `catalog()` (slots `strong`/`cheap`/`vision`, modelos e `supportedLevels`), `stream(req)`, `complete(req)`; `purpose: "user" \| "background"` obrigatório; uso gravado em `<dataDirectory>/usage.jsonl` |
| `agents` | conversas persistentes do plugin (`register`, `create`, `send`, `answer`, `get`, `list`, `subscribe`, `abort`, `run`) com tools `kind:"input"` |
| `workers` | tarefas limitadas com **um** resultado validado: `register({id, instructions, resultSchema, validateResult, tools})`, `start(id, {requestId, input, prompt, model, purpose, maxTurns, options, timeoutMs})`, `list/get/subscribe/wait/cancel`. Estados `queued/running/succeeded/failed/cancelled/interrupted`; `submit_result` com correção na mesma conversa; restart **interrompe** tarefas não terminadas (sem replay). Pool FIFO global de streams de modelo: `agent.workerRequestConcurrency` (padrão 8). |
| `createBackgroundTool(context, spec)` | tool nativa que devolve ack imediato e entrega o resultado depois pelo pipeline de jobs/steer (`prepare` puro, `format` → `{text,data}`) |
| `registerInstructions({agents, text})` | texto **estático** anexado ao system prompt de `prober`/`teacher`/`practice` |
| `registerTools({agents, create(context)})` | fábrica **síncrona** por turno; recebe `{chatId, agent}` congelado; nomes únicos 1–64 (`[A-Za-z_][A-Za-z0-9_-]*`); colisão ⇒ o pacote inteiro fica fora daquele turno |
| `registerQuestionType`, `registerProblemType` | tipos de pergunta (probe/teach) e de problema (practice) — ver §2 |
| `handle(name, handler)` | operações JSON chamadas por `ctx.call` do frontend do **mesmo** plugin |
| `events.on(listener)`, `events.emit(topic, data)` | eventos do app (`turn-started`, `turn-settled`, `jobs-changed`, `activity-changed`, `chats-changed`, `sources-changed`, `record-changed`, `compaction-changed`, `side-chats-changed`, `plugins-changed`, …) e notificações para o próprio frontend (ao vivo, sem replay) |

### 1.4 `PluginFrontendContext` (uma ativação por janela)

`registerView({id,name,mount(container,signal)})`, `registerAction({id,name,icon(SVG confiável),shortcut,disabled,run(context)})`, `placeAction({location:"sidebar"|"graph"} | {location:"top-bar", sessions?:["teaching","practice"], views?})`, `refreshActions()`, `registerSubmissionInterceptor`, `refreshSubmissions`, `registerSettings(mount | {rows})`, `ui` (abaixo), `registerCodeBlock`, `registerToolRenderer`, `registerQuestionRenderer`, `registerProblemRenderer`, `call(op,input)`, `documents.toMarkdown(file,{signal})` (PDF/UTF-8 → Markdown; 25 MiB/1000 páginas/2 MiB saída; sem OCR; 1 conversão global por vez), `onNotification`, `onAppEvent`, `onResync`, `app.{pathname,openSession,openHome,openView,openSettings}`.

`ctx.ui` (15 métodos, todos controlados, com `PluginWidgetHandle.update/dispose` e `{signal}`): `mountModelPicker`, `mountThinkingPicker`, `mountKnowledgePicker`, `mountComposer`, `mountDictation`, `mountStandardComposer`, `mountButton` (variants, `icon`, `iconOnly`, `variant:"custom"`+`colors`), `mountBadge`, `mountSettingsRows` (`toggle`/`text`/`dropdown`/`number`/`slider`), `mountMarkdown` (pipeline real do host: Markdown, KaTeX, Mermaid, código; sem controles auxiliares), `mountTree`, `mountWorkerResult`, `openMenu`, `openDialog`, `openSurface` (cobre o corpo da página; `background:"dimmed"|"opaque"`).

**Não existe** na API: salvar/baixar arquivo, file picker nativo, escrita no grafo/chats, criação/início de sessão, contexto dinâmico por chat no system prompt, acesso a outros plugins.

### 1.5 Ciclo de vida e garantias

- Backend ativa uma vez por servidor; frontend uma vez por janela; cada view tem seu próprio `signal` (use-o nos widgets).
- Disable: aborta `signal`, revoga registros, interrompe workers não terminados; dados preservados.
- Plugins são **código local confiável**: backend roda **dentro do processo do servidor Next** (sem sandbox); frontend roda na página (sem iframe). Isolamento só no Electron renderer (`contextIsolation`, `sandbox`) e no segredo HTTP do desktop (`x-learnharness-desktop`, `src/server/desktop-access.ts`, aplicado por `proxy.ts`).
- Non-goals explícitos (`docs/plugin-architecture.md`, `docs/plugin-authoring.md`): marketplace/updater de community, sandbox/processo por plugin, hot replacement, **escrita programável no core**, framework genérico de UI/forms/teclado, replay automático/exactly-once.

---

## 2. Contratos — o que cada um resolve

| Contrato | Arquivos | Use quando | Pontos que mordem |
| --- | --- | --- | --- |
| **Question** (`docs/plugin-question-contract.md`, `src/core/plugin-questions.ts`) | `registerQuestionType({id,label,contractVersion,showThinking,questionSchema,answerSchema,probe?:{toolName,description},teach?:{…},validateQuestion?,validateAnswer?,gradeAnswer?})` + `registerQuestionRenderer` (`mountQuestion`, `mountAnswerEditor`, `mountAnswered`) | Pergunta de ensino com editor próprio (ex.: exercício de circuito, pronúncia, desenho). O host gera as tools de *pose* (`{question,payload}` no probe; `{type:"predict"\|"check",nodeId,question,payload}` no teach). | Schemas TypeBox persistíveis (sem `$id`, RegExp, refs externas); validação **síncrona** e sem efeitos; `gradeAnswer` roda **antes de salvar** e devolve JSON livre (o host não interpreta nota); compatibilidade por `contractVersion`/`incompatibleContractVersions`; autoridade é o ledger do host, nunca nomes de tools crus. |
| **Problem** (`docs/plugin-problem-contract.md`, `src/core/plugin-problems.ts`) | `registerProblemType({id,label,contractVersion,tool:{toolName,description},problemSchema,submissionSchema,validateProblem?,validateSubmission?,processSubmission?})` + `registerProblemRenderer` | Problemas de **prática** (só agente `practice`): `statement`, `mode: recall\|discrimination\|composition`, `target[]`, `modelSolution` + payload. Várias submissões por problema; só o `conclude` nativo fecha. | `processSubmission` devolve **observações**, não veredito; problema fica ativo-mas-indisponível se o plugin some (sem fallback de texto). |
| **Tree** (`docs/plugin-tree-contract.md`, `src/core/plugin-tree.ts`) | `ctx.ui.mountTree(container, {label, rows, header?, columns?}, {signal})` | Hierarquias controladas (decks, currículo, árvore de domínio). | Totalmente controlado: o plugin dona de dados/seleção/expansão/persistência; chaves de linha **globalmente únicas**; colapsar desmonta descendentes; não é file manager nem tem cascata de seleção. Para um grafo-árvore "massivo" vai precisar de virtualização/paginação próprias. |
| **View context** (`docs/plugin-view-context.md`) | `context.view` em ação de top-bar/atalho numa sessão | Ler a sessão inteira (mensagens, transcript projetado, fase `probe/plan/teach/practice`, `contextTokens`, rascunho do composer, input atual com rascunhos) — ex.: "Gerar flashcards desta sessão", "Salvar fraqueza na memória". | Snapshot destacado/congelado; **somente leitura**; não dispara envio. |
| **Session extension / surfaces** (`docs/plugin-session-extension-contract.md`) | `registerSubmissionInterceptor({id,priority,hasPendingInput,intercept})`, `ctx.ui.openSurface` | Transformar a entrada do aluno antes do envio (anexar imagem nativa, normalizar texto), cobrir a página com uma superfície (ex.: revisão de cartões, quadro). | Falha fechada preservando rascunho; `onAccepted` é best-effort; imagens só como blocos base64 nativos; surface cobre só o corpo da página. |
| **UI** (`docs/plugin-api/plugin-ui.md`, `docs/dialog-overlay-contract.md`) | `ctx.ui.*` | Tudo que é widget/overlay do host (mantém a aparência do app). | Um dono de Escape; foco/inércia gerenciados pelo host; CSS do plugin não é sandboxed (use variáveis `--foreground`, `--background`, `--border`). |
| **Workers / agents / inference** (`docs/plugin-api/plugin-workers.md`, `plugin-agents.md`, `contracts-models.md`) | ver §1.3 | Geração assíncrona durável (cartões, resumos, expansão do grafo), conversas próprias. | Modelo **explícito** (slot ou override), sem fallback silencioso; `purpose` governa consentimento de assinatura; pool compartilhado de 8 streams. |

---

## 3. (a) Quando criar plugin vs mudar o core

### 3.1 Regra prática

1. **Cabe 100% nos contratos** (dados próprios + leitura do core + UI própria + tools/instruções aditivas)? → **plugin** (preferencialmente adicionado ao `core-plugins.json` do fork, para ser enviado com o app). Vantagem: mantém o diff com o upstream pequeno (rebase de updates AGPL do learnharness fica viável) e herda testes de fronteira do host.
2. **Precisa escrever no grafo/chats, criar sessões, mudar o prompt por chat, ou é cross-cutting (todas as sessões/agentes)?** → **core**, idealmente como **nova capacidade genérica da API de plugins** (ex.: `ctx.sessions.create`, `registerContextProvider`) e a feature continua num plugin. Isso segue a filosofia do upstream ("host fornece mecanismos, não produto") e mantém a feature substituível.
3. **Contrato existe mas é estreito demais** (ex.: Q/A só texto) → estender o plugin, não o host.
4. Antes de qualquer mudança: o `AGENTS.md` exige **plano aprovado pelo humano** — nada de decidir nomes, formatos, defaults ou UX por conta própria.

### 3.2 Mapeamento das metas do usuário

| Meta | Onde | Por quê / o que falta |
| --- | --- | --- |
| 1. Grafo-árvore de conhecimento por domínio (princípios → doutorado, ~1000–1500 h), aulas IA/livros/YouTube por nó, expansão procedural | **Plugin "currículo"** com store própria (DAG de pré-requisitos, recursos por nó/região, versão/hist. de expansão) + workers para expandir via IA (resultSchema + `validateResult` como "porteiro" das invariantes do grafo) + view com `mountTree` (ou canvas próprio bundlado) | O grafo do core (`graph/nodes.jsonl`, `chains.jsonl`) é **extraído do texto do professor** (proposições + cadeias de raciocínio), é read-only para plugins e não é um currículo. **Core necessário** para: (i) iniciar uma sessão de ensino a partir de um nó (`ctx.app.openSession` só navega; não cria nem roda sessão); (ii) injetar "nó atual/objetivo/recursos" no prompt do professor por chat. |
| 2. Memória de contexto SOTA integrada a tudo | **Core + plugin**: motor de memória pode ser plugin (lê `ctx.learning.getSession`/`graph`, mantém índice em `dataDirectory`), mas a **injeção** precisa de hook dinâmico | `registerInstructions` é **texto estático global por tipo de agente** (verificado em `plugin-host.ts`, `agentContributions`: `instructions.filter(...).map(item => item.text)`). Alternativas sem core: tool `recall_memory` (o modelo precisa chamar) ou gerar a `description` da tool por turno em `create({chatId})` (gambiarra, síncrono). Proposta de core: `registerContextProvider({agents, provide({chatId, agent}): string})` síncrono com cache, inserido **no fim** do prompt para não destruir o prompt caching. Dependências nativas (vetores) precisam ser WASM/JS puro ou N-API pré-compilado para o Node do Electron 44 — o host **não** roda `npm install` nem rebuild nativo. |
| 3. Sessões separadas por domínio, trocáveis | **Core** | `config.ts` fixa `PATHS` no **load do módulo** a partir de `LH_DATA_DIR`; "one server owner per data/auth profile". Opção barata: um *perfil* (data dir) por domínio e trocar = reiniciar o servidor com outro `LH_DATA_DIR` (no Electron: mudar `DATA_DIR()` em `electron/main.cjs` e relançar o filho). Opção profunda: campo `domain` em chats/grafo/memória + filtros em todas as leituras. Isolamento de plugins acompanha automaticamente o data dir (`core-plugin-data/<id>`). |
| 4. Flashcards integrados a Anki/Obsidian | **Plugin** (`plugins/flashcards`, já é core plugin do fork) | §5. |
| 5. Nível/XP/rankings calibrados por Monte Carlo | **Plugin** (view + store + cálculo no backend) | Lê `flashcards.json` (reviews) não é possível via API de outro plugin; ou unificar XP dentro de um plugin "perfil" que lê `ctx.learning` (sessões, problemas, conclusões) — ou expor eventos de XP via core. Simulação MC roda no backend (Node) com PRNG semeável para testes. |
| 6. Stats (tokens por modelo, horas/dia) | **Plugin** com ressalva | Uso das sessões está nos `ChatRecord` (legíveis); uso de workers de **cada plugin** fica em `<dataDirectory>/usage.jsonl` daquele plugin (não exposto a outros). Para um painel total: pequena API de core (`ctx.learning.usage()`), ou ler o JSONL diretamente (frágil). |
| 7. IA via assinaturas, sem hardcode de modelo | **Já é core** | Slots `strong/cheap/vision` sem defaults de fábrica (`config.ts`, "BYOK all the way down"); ChatGPT/Copilot/Grok por assinatura; plugins devem usar `ctx.inference.catalog()` + `mountModelPicker`/`mountThinkingPicker` (como o Flashcards faz: "Follow cheap slot"). |
| 8. UI cel-shading, ícones SVG à mão | **Core (tema)** + plugins | Temas importáveis em `<data>/themes/<id>.json` (`docs/themes.md`); ações de plugin aceitam `icon` SVG confiável; widgets `ctx.ui` herdam o tema. Cel-shading global (bordas grossas, sombras chapadas) é CSS do core (`app/globals.css`). |
| 9. Didática não cansativa | **Core (prompts)** + plugins aditivos | Prompts em `src/agent/prompts/` com overrides em `<data>/prompts/`; plugins só **adicionam** instruções. |

### 3.3 Capacidades de core que eu proporia (genéricas, para manter features em plugins)

1. `registerContextProvider` (contexto dinâmico por `{chatId, agent}`) — memória, currículo, pontos fracos.
2. `ctx.sessions.create({kind, title, openingPrompt, metadata})` + `metadata.domain`/`nodeId` gravado no chat — "estudar este nó".
3. `ctx.files.save({suggestedName, mime, bytes})` (diálogo nativo no Electron, download no browser) — exports `.apkg`/`.md`/`.csv`.
4. Evento `session-concluded`/`phase-changed` e `extraction-settled {chatId}` — gatilho de "fim de sessão" sem polling.
5. (Opcional) `ctx.learning.usage()` agregado para stats.

---

## 4. Plugin `flashcards` — análise completa

### 4.1 Arquivos

| Arquivo | Linhas/bytes | Papel |
| --- | --- | --- |
| `plugins/flashcards/manifest.json` | — | `id:"flashcards"`, `version:"0.1.0"`, `minAppVersion:"0.4.1"`, `main:"main.js"`, `backend:"backend.cjs"`, `styles:"styles.css"`; descrição: "review them with FSRS-6 … Native only; no Anki integration." |
| `package.json` | — | `@learnharness/flashcards`, AGPL-3.0-only, scripts `build` (`node scripts/build.mjs`), `test` (`node --test tests/*.test.cjs`), `test:native`; devDep única `esbuild@0.28.2`. **JavaScript puro** (sem `.sdk/`/TS). |
| `scripts/build.mjs` | 20 | esbuild: `src/main.js`→`dist/main.js` (ESM, browser, es2022) e `src/backend.cjs`→`dist/backend.cjs` (CJS, node22); copia manifest/LICENSE/FSRS-LICENSE/README/styles; recusa `dist` symlink e `dist/data`. |
| `src/scheduler.cjs` | 217 / 9,2 KB | FSRS-6 + passos de aprendizagem + dia de estudo + escolha de cue |
| `src/store.cjs` | 87 | snapshot JSON versionado, `atomicWrite`, migrações, fontes convertidas |
| `src/statistics.cjs` | 35 | contadores de estado, previsão de vencimentos (8 dias), atividade (14 dias), DST-safe |
| `src/backend.cjs` | 574 / 43,8 KB | operações (`ctx.handle`), workers, preflight/chunking, revisão com tickets, deleção com recibos |
| `src/file-generation.cjs` | 116 | schema/validação de fatos extraídos de arquivo, chunking de Markdown |
| `src/generation-prompts.cjs` | 144 | **todos os prompts** (`cardWriting`, `inputSafety`, `outputProtocol`, instruções por fonte, `graphPromptFor`, `filePromptFor`) |
| `src/main.js` | 430 / 31,9 KB | ativação do frontend, view `library`, diálogos, settings, geração por arquivo |
| `src/library-tree.js` | 211 | árvore deck→proposição→cue com `ctx.ui.mountTree` + `openMenu` |
| `src/review.js` | 253 | sessão de revisão/prática em `ctx.ui.openSurface`, teclado (Space revela/avança; nunca avalia) |
| `src/practice-queue.js` | 22 | snapshot de prática sem agendamento |
| `src/dashboard.js` | 103 | gráficos do dashboard |
| `tests/*.test.cjs` | ~4,7 mil linhas | store, backend, scheduler, statistics, review, frontend (linkedom), dashboard, file generation, prompts; `native.mjs` (harness com Chrome/Electron) |

### 4.2 Algoritmo de agendamento: **FSRS-6** (porte de `ts-fsrs@5.2.3`)

- Cabeçalho: `// Selectively adapted from ts-fsrs 5.2.3 (FSRS-6), MIT, Open Spaced Repetition.` Licença em `plugins/flashcards/FSRS-LICENSE.txt`.
- Pesos fixos (21, os padrões publicados do FSRS-6):
  `W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542]`.
- Curva de esquecimento com decaimento treinável: `DECAY = -w20`, `FACTOR = 0.9^(1/DECAY) - 1`, `R(t,S) = (1 + FACTOR·t/S)^DECAY`.
- Intervalo: `modifier = (r^(1/DECAY) - 1)/FACTOR` (r = retenção desejada), `interval = clamp(round(S·modifier), 1, 36500)` dias.
- Estabilidade inicial `S0 = max(w[G-1], 0.1)`; dificuldade inicial `D0(G) = w4 − e^{(G−1)·w5} + 1` (clamp 1–10); atualização `D' = w7·D0(4) + (1−w7)·(D + Δ)`, `Δ = −w6·(G−3)·(10−D)/9`.
- Estabilidade de curto prazo (learning/relearning): `S·e^{w17(G−3+w18)}·S^{−w19}` (≥ S quando G≥3). Revisão: fórmula de recall do FSRS-6 com penalidades `hard=w15`, `easy=w16`; lapso: `min(forget(D,S,R), S/e^{w17·w18})`.
- Ordem garantida dos intervalos `hard ≤ good−1`, `easy ≥ good+1` ("compute all passing intervals together to preserve the reference ordering").
- **Sem fuzz** (configuração `fuzz:false` existe em `defaults()` mas não é usada nem aceita por `validateSettings`), **sem otimizador** (personalização adiada).
- Learning steps estilo Anki (`BasicLearningStepsStrategy` em minutos): `learningSteps` padrão `[1,10]`, `relearningSteps` `[10]`; validação: inteiros crescentes, 1–1439 min.
- `elapsed` em **dias de estudo** inteiros (ordinais locais com `dayStart`, padrão 04:00), não frações; `dueDay` (`YYYY-MM-DD`) guardado para revisões, robusto a mudança de fuso/rollover. DST tratado.
- Estados: `0 new, 1 learning, 2 review, 3 relearning`. Schedule: `{due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, learning_steps, state, last_review, dueDay?}` (formato ts-fsrs ≤5).
- **Unidade de agendamento = proposição**, não cartão: uma proposição tem vários *cues* (Q/A) e **um** estado FSRS. Escolha do cue na revisão: aleatória ponderada pela última nota do cue — Again 4, Hard 3, Good 2, Easy 1, nunca avaliado 3 (`chooseCue`); durante learning/relearning o mesmo cue é mantido (`learningCueId`).
- Fila (`next-review`): primeiro learning/relearning prontos, depois revisões vencidas (ordenadas por `due`), depois novas até o limite diário **por deck** (padrão 20 proposições/deck/dia; a introdução conta em todos os decks que contêm a proposição; só o deck estudado controla a admissão). Revisões vencidas não têm limite.
- Fluxo com **tickets** idempotentes: `next-review` → `reveal-review` (devolve resposta + prévia dos 4 intervalos) → `rate-review({ticketId, rating, requestId})`. Ticket invalida se versão da proposição, configuração (retention/steps/dayStart/**timezone**) ou dia de estudo mudarem.
- Testes de fidelidade: `tests/scheduler.test.cjs` tem fixtures numéricas "independently evaluated with ts-fsrs@5.2.3's published parameters".

**Estado da arte (verificado em 2026-11-18):**
- `ts-fsrs@6.0.0` (publicado **2026-10-28**) introduziu **FSRS-7** como padrão do novo `DefaultScheduler` (34 pesos, campo `stabilityFast`, intervalos fracionários), renomeou campos (`due→dueAt`, `last_review→lastReviewAt`, `learning_steps→learningStep`, `{card,log}→{card,revlog}`), removeu `elapsed_days`, exige **Node ≥ 24**, e mantém FSRS-6 via `version: 'FSRS-6'` ou exports legados depreciados. A nota de migração alerta: não reutilizar pesos FSRS-6 no FSRS-7 nem inventar `stabilityFast`; cartões sem histórico completo devem ficar no FSRS-6 (fonte: GitHub releases `open-spaced-repetition/ts-fsrs`). `ts-fsrs@5.4.2` (2026-09-01) é a última da linha 5.
- Anki: FSRS nativo desde 23.10; FSRS-6 desde o ciclo 25.07; versões 26.x seguem nomeando "FSRS 6" (fóruns AnkiWeb). Ou seja, o plugin está **alinhado com o Anki atual**, um passo atrás do ts-fsrs 6.
- Implicação: como o plugin **guarda `before`/`after` e `rating`/`at` de toda revisão** (`reviews[]`), há histórico suficiente para (i) rodar o otimizador FSRS (ex.: `@open-spaced-repetition/binding`, Node ≥ 24) e personalizar os 21 pesos, e (ii) migrar para FSRS-7 por *replay* no futuro — mas atenção: o histórico é **por proposição**, não por cartão, então o otimizador vê "proposição revisada via cue X".

### 4.3 Armazenamento

- Um único arquivo `<dataDirectory>/flashcards.json` (dev: `<repo>\data\core-plugin-data\flashcards\flashcards.json`; app Windows: `%APPDATA%\LearnHarness\data\core-plugin-data\flashcards\flashcards.json`), **reescrito inteiro** a cada mutação (`store.change(update)` → `structuredClone` → `revision++` → `atomicWrite` = temp `wx 0600` + `fsync` + `rename`).
- Schema v1 (`openStore` recusa versão desconhecida — "No data was changed"):
  ```text
  { version: 1, revision, settings: {retention, learningSteps, relearningSteps, dayStart, fuzz, chunkBudget, modelOverride, thinkingOverride?},
    decks: [{id, name, sourceId?, newLimit, propositionIds[]}],
    propositions: { [id]: {id, origin:"graph"|"file"|"manual", name, statement, snapshot?, sourceId?,
                           cues:[{id, question, answer, latestRating, lastReviewedAt?}],
                           schedule, firstReviewedAt, learningCueId, version} },
    reviews: [{id, requestId, ticketId, propositionId, cueId, rating, at, before, after, introduced, deckIds, settings}],
    batches: [{id, kind:"graph"|"file", requestId, preflightId, status, cancelRequested, createdAt, sourceId?, deckId?, name?,
               chunks:[{id, requestId, targetIds? | start,end, status, taskId, added, error?}]}],
    fileSources?: {[id]: {id, name, fingerprint, deckId, deckName, newLimit}},
    pendingSourceRemovals?, creationReceipts?, deletionReceipts? }
  ```
  IDs de proposição: `n_…` (grafo do core), `file:<uuid>`, `manual:<uuid>`.
- Markdown convertido de arquivos: `<dataDirectory>/sources/<uuid>.md` (fora do snapshot).
- Host: `<dataDirectory>/tasks/` (workers), `usage.jsonl` (custos).
- Proposições cujo nó sumiu do grafo vão para **Archive** (não deletadas); o plugin **nunca escreve no grafo**.
- **Limitações para nosso uso (1000–1500 h):** `reviews[]` cresce sem limite e o JSON inteiro é reescrito com `fsync` a cada avaliação (100 mil revisões × ~0,6 KB ≈ 60 MB por gravação). O README admite: "measure that concrete case before introducing more storage machinery". Proposta: mover `reviews` para JSONL append-only (ou `node:sqlite`, embutido no Node 24 do Electron 44 — validar), manter o snapshot pequeno. No Windows, `store.cjs` **não** tem o retry de `rename` que o core tem em `src/store/atomic-write.ts` (antivírus/indexador seguram arquivos → `EPERM/EBUSY`).

### 4.4 Geração de cartões "pelo agente"

- **Não é o professor** que cria cartões: o plugin **não** registra tools/instruções nos agentes de ensino. A geração é **explícita** pelo usuário na view (sem gatilho automático ao fim da sessão — decisão de produto do v1).
- Dois workers (`ctx.workers.register`): `generate-cues-v1` (a partir de proposições do grafo + cadeias imediatas + cues existentes) e `generate-file-facts-v1` (extrai fatos atômicos + cues de um PDF/texto convertido).
- Pipeline: `preflight` (resolve modelo: override do plugin ou **slot cheap**; checa `supportedLevels` do thinking; empacota chunks por orçamento de **fonte** ~4000 tokens ≈ chars/4; estima custo total = bytes UTF-8/3 + 256; `maxTokens = min(8192, entry.maxTokens, contextWindow − tokens − 256)`, recusa se < 1024) → diálogo de confirmação → `start-generation` (cria batch durável, dispara chunks em `queueMicrotask`, `ctx.workers.start(..., {purpose:"user", maxTurns:4, options:{maxTokens, timeoutMs:120000, maxRetries:0}})`) → `watch`/`wait` → `applyOutcome` (aditivo: só perguntas novas; dedup por texto da pergunta) → `reconcile()` no restart (sem refazer chamadas de modelo).
- Um batch ativo por vez; chunks em paralelo via pool do host; cancelamento fecha a "porta de aplicação" antes de cancelar tarefas; recibos de `requestId` tornam retries idempotentes.
- `resultSchema` (grafo): `{propositions:[{propositionId, cards:[{question, answer}]}]}` com `validateResult` (alvo desconhecido/repetido/faltando, pergunta duplicada ⇒ erro devolvido ao modelo para correção na mesma conversa).
- Prompts (`generation-prompts.cjs`): framework "retrieval tasks" (alvo vs cue; focado, preciso, consistente, tratável, esforçado; checagens de falso positivo/negativo; sem cota). Formato: Markdown, `$…$`/`$$…$$`, ```` ```mermaid ````, **sem HTML cru**.

### 4.5 UI

- Frontend exige `ctx.ui.mountMarkdown`, `mountKnowledgePicker`, `mountTree`, `openSurface`, `openMenu` (lança erro amigável se ausentes) e `ctx.workers`/`ctx.learning.graph` no backend.
- Registros: view `library` ("Flashcards"), ação `open` com ícone SVG inline, `placeAction` na **sidebar**, `registerSettings(mount)`; observa `onNotification` (`changed`, `batch-changed`), `onResync`, `onAppEvent` (`sources-changed`, `activity-changed`, `chats-changed`).
- Library: toolbar (knowledge picker real do host → "Generate"; "Generate from file…"), painel de decks com `mountTree` (deck → proposição → cue; botões "+" e engrenagem com `openMenu`: "Deck settings", "Decks…", "Edit", "Delete", "Move up/down"), seleção → "Review"/"Practice selected/all", dashboard (New azul, Learning âmbar, Review verde, Relearning vermelho).
- Revisão em `openSurface`: pergunta → "Reveal answer" (Space) → Again/Hard/Good/Easy com intervalos previstos; prática sem agendamento.
- Settings: retenção (70–99%), learning/relearning steps (`1m 10m`), início do dia, orçamento de chunk, modelo/thinking ("Follow cheap slot").

### 4.6 Operações do backend (`ctx.handle`)

`get-state`, `get-catalog`, `save-settings`, `create-deck`, `create-card`, `create-cue`, `save-deck`, `delete-content`, `delete-deck`, `set-memberships`, `save-cue`, `delete-cue`, `reorder`, `preflight`, `preflight-file`, `open-file-deck`, `preflight-file-retry`, `start-generation`, `cancel-generation`, `resume-results`, `next-review`, `reveal-review`, `rate-review`. Todas passam por `register()` que valida `input` como objeto e checa `alive()`.

### 4.7 Lacunas para as metas do usuário

- Sem export/import (Anki/Obsidian) — §5.
- Sem gatilho "fim de sessão" — sugerido em §5.6.
- Só Q/A textual: sem cloze, sem cartão reverso, sem áudio/TTS (relevante para **Inglês**), sem imagens Markdown (URLs de imagem recusadas pelo pipeline do host).
- Sem otimizador FSRS e sem FSRS-7.
- Revisões não alimentam nenhuma "memória de pontos fracos" do professor (o plugin não fala com os agentes).

---

## 5. (b) Exportar para Anki ou Obsidian — viabilidade e onde plugar

### 5.1 Ponto de partida

- `docs/flashcards-vision.md` ("Deferred Anki integration") e `docs/flashcards-implementation-plan.md` removem toda integração Anki do v1 ("no export/import UI, packaging library, SQLite WASM asset…"). Como o fork é nosso, isso é uma **decisão a ser revista com o humano**, não uma limitação técnica.
- A arquitetura diz que dependências de terceiros de uma feature vão **no `package.json`/lockfile do plugin** e são **bundladas pelo esbuild**, nunca na raiz do app.

### 5.2 Mapeamento de modelo

| learnharness | Anki | Obsidian (plugin Spaced Repetition) |
| --- | --- | --- |
| Deck (referência, proposição pode estar em vários) | Deck (cartão pertence a **um** deck) ⇒ escolher deck "primário" ou duplicar notas | Tag `#flashcards/<deck>` (aceita várias tags) ou pasta |
| Proposição (unidade de agendamento) | — (Anki agenda **por cartão**) | — (agenda por cartão) |
| Cue `{question, answer}` (Markdown) | Nota "Basic" (campos Front/Back em **HTML**) + campo `LH_ID` para idempotência | Bloco multi-linha `pergunta` / `?` / `resposta` |
| Schedule FSRS por proposição | Não mapeável 1:1 (seria preciso `setDueDate`/`setSpecificValueOfCard` por cartão) | SR comment `<!--SR:!AAAA-MM-DD,intervalo,ease-->` (SM-2), não FSRS |

**Recomendação de política (precisa de aprovação):** exportação **unidirecional de conteúdo**, sem tentar migrar o estado FSRS; deixar o app de destino agendar do zero, **ou** manter o learnharness como fonte de verdade e usar o destino só como "espelho de leitura". Agendar nos dois lados gera dupla revisão.

### 5.3 Opção A — AnkiConnect (sincronização ao vivo)

- AnkiConnect = add-on `2055492159` (FooSoft; repo hoje em `git.foosoft.net/alex/anki-connect`; última tag vista **24.11.5.1**, 2024-11 — verificar se ainda é mantido). Servidor HTTP em `127.0.0.1:8765`, requisições `POST {"action", "version": 6, "params"}`.
- Ações úteis: `version`, `deckNames`, `createDeck`, `modelNames`, `createModel` (criar nota "LearnHarness Basic" com campos `Front`, `Back`, `LH_ID`, `LH_Proposition`), `canAddNotes`, `addNotes` (retorna IDs ou `null` por nota), `findNotes` (`"LH_ID:<cueId>"`), `updateNoteFields`, `addTags`, `storeMediaFile` (para PNG/SVG de Mermaid), `changeDeck`; para trazer evidência de volta: `findCards` + `cardsInfo`/`getReviewsOfCards` (alimentar "pontos fracos").
- **Onde rodar: backend do plugin** (Node 24 no processo do servidor). `fetch("http://127.0.0.1:8765")` do Node não tem CORS nem `Origin` ⇒ não precisa de `requestPermission`/`webCorsOriginList`. No frontend daria CORS e esbarraria no modelo de segurança.
- Conversão Markdown→HTML: bundlar `markdown-it`/`micromark` no plugin; matemática `$…$`→`\(…\)` e `$$…$$`→`\[…\]` (MathJax do Anki); Mermaid: manter como bloco de código ou rasterizar (o host não expõe renderização de Mermaid para SVG ao plugin; `@resvg/resvg-js` existe no core, mas não na API).
- Prós: idempotente (atualiza notas por `LH_ID`), incremental, pode ler histórico de revisão do Anki. Contras: exige Anki aberto + add-on; API de terceiro com manutenção incerta; um cartão Anki por cue (o modelo "proposição" se perde).

### 5.4 Opção B — arquivo `.apkg` (ou texto importável)

- `.apkg` = ZIP com SQLite (`collection.anki2` legado; `collection.anki21b` zstd no formato atual) + `media`. Bibliotecas JS:
  - `ankipack` (MIT, TypeScript, ESM; esquema V18, verificado contra Anki 26.08.1; deps `fflate`, `fzstd`, `@bufbuild/protobuf`; `sql.js` como peer opcional — WASM; ~63 KB gz; **projeto pequeno: ~5 estrelas**) — github.com/ImGajeed76/ankipack.
  - `anki-writer` (gera `collection.anki2` estilo genanki) e o antigo `anki-apkg-export` (sql.js, legado).
  - Carregar o WASM do `sql.js` a partir de `ctx.directory` (ex.: `dist/assets/sql-wasm.wasm`); o build do plugin copia o asset.
- **Alternativa zero-dependência (recomendada como primeiro passo):** arquivo de texto importável pelo Anki ("Import File") com cabeçalhos `#separator:tab`, `#html:true`, `#deck:…`, `#notetype:Basic`, `#guid column:N` (usar o `cueId` como GUID garante reimportação idempotente) e `#tags column:N`.
- Entrega do arquivo: a API **não** tem "salvar arquivo". Caminhos possíveis: (1) frontend cria `Blob` + `<a download>` — no Electron, sem handler `will-download` em `electron/main.cjs`, o comportamento padrão do Electron é abrir o diálogo de salvar (validar no app empacotado; o `setPermissionRequestHandler` deny-by-default não afeta downloads, mas afetaria `showSaveFilePicker`); (2) backend grava em `<dataDirectory>/exports/…` e mostra o caminho; (3) capacidade de core `ctx.files.save` (§3.3).

### 5.5 Opção C — Obsidian (Markdown no vault)

- Os cartões **já são** Markdown com `$…$`, `$$…$$` e ```` ```mermaid ```` — o Obsidian renderiza tudo isso nativamente. Exportação quase sem perdas e sem dependências.
- Plugin "Spaced Repetition" (st3v3nmw, `manifest.json` 1.15.4): sintaxe `Pergunta::Resposta`, `:::` (reverso), multi-linha com linha `?` (ou `??` reverso), cloze `==…==`/`**…**`/`{{…}}`; deck por tag `#flashcards/<subdeck>` ou por pasta; agendamento salvo **no próprio arquivo** como `<!--SR:!2024-08-16,51,230-->` (data, intervalo, ease — SM-2-OSR). Docs do repo dizem "only SM-2-OSR implemented, FSRS planned", enquanto a listagem da comunidade menciona FSRS — **conflito, verificar**. Plugins Obsidian com FSRS: "True Recall" (FSRS v6), "fsrs" (FSRS-5 via rs-fsrs), "Retain" (`Q::A` + FSRS) — imaturidade variável.
- Cuidados de formato: `::` em código (C++ `std::`) quebra cartões de uma linha ⇒ usar **sempre** o formato multi-linha com `?`; respostas com linhas em branco (código, display math) podem encerrar o cartão multi-linha ⇒ checar a opção de marcador de fim de cartão multi-linha nas versões recentes ou normalizar; não escrever `<!--SR:…-->` (deixa o plugin agendar).
- Escrita: backend do plugin grava `.md` (um arquivo por deck, ou por proposição com frontmatter `lh_id`, `lh_proposition`, `tags`) num caminho de vault configurado nas settings; usar escrita atômica com retry (Windows) e **nunca** apagar arquivos editados pelo usuário (merge por `lh_id`).
- Prós: formato aberto, versionável, combina com "memória"/notas. Contras: agendamento FSRS no Obsidian é menos maduro que Anki; mobile depende de sync do vault.

### 5.6 Onde plugar no código (plano concreto, sujeito a aprovação)

1. **Settings** (`src/store.cjs` `defaults()` + `src/backend.cjs` `validateSettings` — hoje a lista `allowed` é fechada: `retention, learningSteps, relearningSteps, dayStart, chunkBudget, modelOverride, thinkingOverride`): adicionar `export: { obsidianVaultPath, obsidianFolder, ankiConnectUrl (padrão http://127.0.0.1:8765), ankiDeckPrefix, ankiNoteType, includeArchived }`. Validar caminho absoluto, existência, não-symlink.
2. **Módulo novo** `src/export.cjs` (puro, testável): `toAnkiHtml(markdown)`, `toAnkiText(state, scope)`, `toObsidianMarkdown(state, scope)`, `ankiConnect(url, action, params, signal)`. Importado por `backend.cjs` e bundlado pelo esbuild (já faz `bundle: true`).
3. **Operações** em `activate()` (`register(name, handler)`): `export-preview` (contagens/escopo), `export-obsidian` (`{deckIds?, requestId}`), `export-anki-connect` (`{deckIds?, requestId}` com recibo idempotente como `creationReceipts`), `export-anki-file` (retorna texto/bytes base64 para o frontend baixar). Bloquear durante batch ativo (mesmo padrão de `delete-content`).
4. **Frontend**: item "Export…" no `menuItems(record)` de deck (`src/library-tree.js`) e botão na `deckToolbar`/`scopeActions` (`src/main.js`), abrindo `dialog(...)` com destino; nova seção de settings via `ctx.ui.mountSettingsRows` dentro do `mountSettings` existente.
5. **Fim de sessão**: ação de top-bar `registerAction({id:"session-cards", run(ctx){ ctx.surface==="session" && … ctx.sessionId }})` + `placeAction({location:"top-bar", sessions:["teaching","practice"]})`; backend `preflight-session({chatId})` seleciona `graph().propositions` com `provenance[].chatId === chatId` e reusa `pack()`/`start-generation`; depois, export automático opcional. Atenção: a extração do grafo é **assíncrona** (`turn-settled` ≠ extração concluída) — esperar `activity-changed` e checar `coverage.jsonl`/`sessions.jsonl` para o chat.
6. **Testes**: `tests/export.test.cjs` (snapshots de Markdown→HTML/MathJax, GUID estável, escaping de tab/newline, `::` em código), fake HTTP server em loopback para AnkiConnect (como os testes do core fazem com endpoints falsos), diretório temporário como vault.

---

## 6. (c) Rodar dev/build/test/typecheck no Windows

### 6.1 Ambiente encontrado

- Node **v24.12.0** local (CI usa **Node 26**; `.mjs` dos scripts importam `.ts` diretamente — requer type stripping nativo, OK no 24+), npm 11.6.2, **`script-shell` = padrão (`cmd.exe`)**.
- `bash` no PATH resolve para `C:\WINDOWS\system32\bash.exe` (**WSL**), não Git Bash (`C:\Program Files\Git\bin\bash.exe`).
- Git com `core.autocrlf=true` (config de sistema) e **sem `.gitattributes`** no repo. Resultado (verificado com `git ls-files --eol`): o índice está em LF, mas a **working tree foi materializada em CRLF** (1244 arquivos `i/lf w/crlf`, ex.: `app/globals.css`). Isso derruba testes que leem fontes e comparam texto (`themes`, `code-ligatures`, `plugin-authoring-bundle`) e quebraria `bash scripts/dev-fresh.sh` (`$'\r': command not found`).
- Developer Mode do Windows **ligado** (`AllowDevelopmentWithoutDevLicense=1`) ⇒ `fs.symlinkSync` funciona sem admin (vários testes criam symlinks).
- `plugins:setup` já foi executado (há `node_modules/` e `.sdk/` nos plugins); `core-plugins/` ainda não foi gerado.

### 6.2 Situação de cada script (verificado)

| Script | Windows (cmd/PowerShell) | Motivo |
| --- | --- | --- |
| `dev` (`plugins:build-core && plugins:build-authoring && next dev -H localhost`) | OK | `&&` funciona no cmd; os helpers usam `process.execPath` + `npm_execpath` |
| `build`, `start`, `typecheck` (`tsc --noEmit`), `lint`, `plugins:setup`, `plugins:build-core`, `plugins:build-authoring` | OK | Node puro |
| `test` (`NODE_ENV=test tsx --test tests/*.test.ts tests/*.test.tsx`) | **Falha** | sintaxe `VAR=valor` não existe no cmd. E se o shell expandir o glob (Git Bash) a linha de comando passa de 8191 chars ao passar por `.cmd` (observado: "Linha de comando muito longa") |
| `desktop:dev` (`concurrently -k "npm run dev" "LH_DEV_URL=http://localhost:3000 electron ."`) | **Falha** (2º comando) | mesma sintaxe de env |
| `dev:fresh` (`bash scripts/dev-fresh.sh`) | **Falha/perigoso** | `bash` → WSL; script usa `rm -rf`, `exec npm` |
| `desktop:dist` | **Só macOS** | `rm -rf`, `DEVELOPER_DIR`, notarização, `--mac --arm64` |
| Testes dos plugins (`node --test tests/*.test.cjs`, `tsx --test tests/*.test.ts`) | OK (Node expande o glob) | Flashcards: **28/29** passam em `scheduler`+`store`+`statistics`; a falha é `fs.statSync(...).mode & 0o777 === 0o600` (Windows dá `0o666`) |

**Suíte raiz completa no Windows** (comando portátil abaixo, com `LH_DATA_DIR`/`LH_AUTH_FILE` temporários):
- Execução 1 (com `LH_IGNORE_ENV_KEYS=1`, que **não** é o modo do CI e esconde chaves que os próprios testes injetam): **5327 testes, 5169 ok, 150 falhas, 1 cancelado, 7 pulados, ~197 s**.
- Execução 2 (modo CI: sem chaves de API no ambiente, sem `LH_IGNORE_ENV_KEYS`): ver §6.2.1.

Classes de falha observadas (com exemplos reais):

| Classe | Exemplo | Correção |
| --- | --- | --- |
| Bits de permissão POSIX | `tests/auth-store.test.ts:44` (`438 !== 384`), `plugins/flashcards/tests/store.test.cjs:44`, "private JSON file … owner-only" | `if (process.platform !== "win32")` no assert (ou checar ACL) |
| Caminhos POSIX literais | `appearance-chrome.test.ts` (`'\\fixture\\repo\\data'` vs `'/fixture/repo/data'`), `desktop-platform.test.ts` | construir o esperado com `path.join`/`path.resolve` |
| `--import`/`import()` com caminho absoluto | `data-dir-seam.test.ts`, `verify-release.test.ts` (`ERR_UNSUPPORTED_ESM_URL_SCHEME … Received protocol 'c:'`) | `pathToFileURL(p).href` |
| CRLF na geração | `plugin-api-reference.test.ts` ("Regenerate stale reference: contracts-chat.md", gerado com `\r\n`) — o printer do TypeScript usa a quebra de linha do SO | `newLine: ts.NewLineKind.LineFeed` no gerador + `.gitattributes` |
| Pressupõe rodar via npm | `plugin-install-local.test.ts` ("test must run under npm" — falta `npm_execpath`) | rodar pelo script npm ou injetar `npm_execpath` |
| Grupos de processo/sinais POSIX | `claude-code-*` ("escalates termination when the child ignores SIGTERM"), `scripts/smoke-learner-images.mjs` recusa win32 explicitamente | pular no win32 ou usar `taskkill /T /F` (padrão já usado em `plugins/coding-questions/src/runner.ts`) |
| Ambiente/chaves | `chat-flow`, `jobs`, `side-chat-delivery`… com "No OpenRouter key is set" quando `LH_IGNORE_ENV_KEYS=1` | não usar essa flag em testes; remover chaves reais do ambiente |
| `HOME` vs `USERPROFILE` | vários testes trocam `process.env` só com `HOME`; no Windows `os.homedir()` lê `USERPROFILE` ⇒ podem enxergar o perfil real | definir também `USERPROFILE` (como `custom-provider-restart.test.ts` já faz) |
| Env substituído sem `TEMP`/`SystemRoot` | `session-identity.test.ts` (`mkdtemp 'undefined\temp\…'`) | ao montar env mínimo, herdar `TEMP`, `TMP`, `SystemRoot`, `Path`, `PATHEXT` no win32 |

> Efeito colateral observado: a suíte criou um diretório **`data/` vazio na raiz do repo** (algum teste roda um processo filho sem `LH_DATA_DIR`, ex.: o caso "unset" de `data-dir-seam`). É gitignored; foi removido após a medição. Para não poluir use sempre `LH_DATA_DIR` temporário e verifique `git status --ignored` depois.

#### 6.2.1 Execução 2 (modo CI) — o número que vale

Comando (Git Bash, com as variáveis `*_API_KEY`/tokens reais removidas do ambiente via `env -u`, `NODE_ENV=test`, `LH_DATA_DIR`/`LH_AUTH_FILE` temporários, sem `LH_IGNORE_ENV_KEYS`):
`node --import tsx --test "tests/*.test.ts" "tests/*.test.tsx"`

Resultado: **5327 testes / 701 suites — 5288 ok, 32 falhas, 0 cancelados, 7 pulados, 183,6 s.** As ~120 falhas extras da execução 1 eram artefato do `LH_IGNORE_ENV_KEYS=1`. Falhas por arquivo e causa:

| Arquivo | # | Causa (Windows) |
| --- | --- | --- |
| `verify-release.test.ts` | 6 | `import()` de caminho absoluto `C:\…` → `ERR_UNSUPPORTED_ESM_URL_SCHEME` (precisa `pathToFileURL`) |
| `session-identity.test.ts` | 4 | teste substitui `process.env` sem `TEMP`/`TMP`/`SystemRoot` ⇒ `os.tmpdir()` vira `undefined\temp` (`mkdtemp 'undefined\temp\lh-plugin-worker-session-…'`) |
| `subscription-auth.test.ts` | 3 | `ERR_PACKAGE_PATH_NOT_EXPORTED` ao resolver `@earendil-works/pi-ai` pelo caminho CJS do tsx (a investigar; pode depender da resolução no Windows) |
| `safe-fetch-connector.test.ts` | 2 | "refusing to connect to a private or local address (research.invalid)" — DNS/peer simulado se comporta diferente no Windows (a investigar) |
| `model-catalog.test.ts` | 2 | detecção do CLI `claude`: a máquina tem o Claude Code instalado e o teste não consegue escondê-lo (PATH no Windows é `Path`/`PATHEXT`) |
| `claude-code-stream.test.ts` | 2 | modo `0o600` esperado (`438 !== 384`) |
| `chatgpt-auth.test.ts`, `auth-store.test.ts` | 1+1 | modos `0o700`/`0o600` |
| `themes.test.ts`, `code-ligatures.test.tsx`, `plugin-authoring-bundle.test.ts` | 1+1+1 | **CRLF na working tree** (`'…,\r\n'` vs `'…,\n'`; "missing :root,\n.dark") |
| `plugin-api-reference.test.ts` | 1 | referência gerada com CRLF vs docs commitadas |
| `appearance-chrome`, `automatic-updates`, `desktop-platform` | 1+1+1 | caminhos POSIX literais (`'\\fixture\\custom-user-data-dev\\data\\settings.json'` vs `'/fixture/…'`) |
| `data-dir-seam.test.ts` | 1 | `--import C:\…\tsx\dist\loader.mjs` sem `file://` |
| `plugin-install-local.test.ts` | 1 | "test must run under npm" (sem `npm_execpath`) |
| `plugin-document-proxy.test.ts` | 1 | controle "forced-clone" do upload multipart diverge (a investigar; possivelmente CRLF em fixture) |
| `learner-image-snapshots.test.ts` | 1 | guard de caminho sensível via symlink/alias resolve diferente (`no such file` em vez de `Access denied`) |

Conclusão: **nenhuma falha aponta bug de produto exclusivo do Windows confirmado**; a maioria é suposição POSIX dos testes ou CRLF. As 4 "a investigar" (`subscription-auth`, `safe-fetch-connector`, `plugin-document-proxy`, `learner-image-snapshots`) merecem triagem antes de declarar o app "Windows-clean", porque tocam autenticação, SSRF guard, upload e guarda de caminhos sensíveis.

### 6.3 Contornos imediatos (sem mudar o repo)

PowerShell:
```powershell
# testes (globs entre aspas: quem expande é o node --test; evita o limite de 8191 chars do cmd)
$env:NODE_ENV = "test"; node --import tsx --test "tests/*.test.ts" "tests/*.test.tsx"; Remove-Item Env:NODE_ENV
# um arquivo só
$env:NODE_ENV = "test"; node --import tsx --test tests/plugin-workers.test.ts
# desktop dev (dois terminais)
npm run dev
$env:LH_DEV_URL = "http://localhost:3000"; npx electron .
# perfil descartável (equivalente ao dev:fresh)
$env:LH_DATA_DIR = "$PWD\.fresh-data"; $env:LH_AUTH_FILE = "$PWD\.fresh-data\auth.json"; $env:LH_IGNORE_ENV_KEYS = "1"; npm run dev -- --port 3005
```
Ou, para todos os scripts Unix de uma vez, na sessão: `$env:npm_config_script_shell = "C:\Program Files\Git\bin\bash.exe"` (não use o `bash` do PATH: é WSL). Mesmo assim `npm test` expande o glob no bash — prefira o comando acima.

**Chaves de API reais no ambiente**: há várias variáveis `*_API_KEY` definidas no perfil do usuário. Variáveis de ambiente **vencem** `auth.json` (`src/server/keys.ts`). Para testes/fixtures, rode com elas removidas (`Remove-Item Env:OPENAI_API_KEY` etc.) ou `LH_IGNORE_ENV_KEYS=1` **só** para o servidor de dev descartável.

### 6.4 Correções portáveis propostas (para aprovação)

**Opção 1 — zero dependências (recomendada)**: pequenos scripts Node.

`scripts/run-tests.mjs`
```js
import { spawnSync } from "node:child_process";
const patterns = process.argv.slice(2);
const args = ["--import", "tsx", "--test", ...(patterns.length ? patterns : ["tests/*.test.ts", "tests/*.test.tsx"])];
const r = spawnSync(process.execPath, args, { stdio: "inherit", env: { ...process.env, NODE_ENV: "test" } });
process.exit(r.status ?? 1);
```

`scripts/desktop-dev.mjs` (2º processo do `concurrently`)
```js
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const electron = createRequire(import.meta.url)("electron"); // caminho do binário
const child = spawn(electron, ["."], { stdio: "inherit", env: { ...process.env, LH_DEV_URL: process.env.LH_DEV_URL ?? "http://localhost:3000" } });
child.on("exit", code => process.exit(code ?? 0));
```

`scripts/dev-fresh.mjs`: porte 1:1 de `dev-fresh.sh` (`fs.rmSync(dir, {recursive:true, force:true})`, mesmas portas proibidas 3000–3004, `LH_DATA_DIR`, `LH_AUTH_FILE`, `LH_IGNORE_ENV_KEYS=1`, e `spawnSync(process.execPath, [process.env.npm_execpath, "run", "dev"], …)` como já faz `scripts/setup-plugins.mjs`).

`scripts/desktop-dist.mjs --win|--linux|--mac`: `rmSync("dist")`, `rmSync(".next/standalone")`, `npm run build`, `node scripts/smoke-provider-runtime.mjs`, `node scripts/build-server.mjs`, `node scripts/smoke-server.mjs --electron`, `electron-builder --win --x64 --publish never` (via `process.execPath node_modules/electron-builder/cli.js`). Mantém o `desktop:dist` do macOS intacto.

`package.json` (diff sugerido):
```json
"test": "node scripts/run-tests.mjs",
"desktop:dev": "concurrently -k \"npm run dev\" \"node scripts/desktop-dev.mjs\"",
"dev:fresh": "node scripts/dev-fresh.mjs",
"desktop:dist:win": "node scripts/desktop-dist.mjs --win",
"test:native": "node scripts/run-tests.mjs --electron tests/pdf-native-render.test.ts tests/pdf-ops.test.ts tests/svg-native-render.test.ts tests/browser-service.test.ts"
```
(o `--electron` faria o runner usar `require("electron")` com `ELECTRON_RUN_AS_NODE=1`, replicando o passo 2 do pipeline de release).

**Opção 2 — `cross-env`** (devDependency; v10 é ESM-only, Node ≥ 20): `"test": "cross-env NODE_ENV=test node --import tsx --test \"tests/*.test.ts\" \"tests/*.test.tsx\""`, `"desktop:dev": "concurrently -k \"npm run dev\" \"cross-env LH_DEV_URL=http://localhost:3000 electron .\""`. Mais curto, mas não resolve `dev:fresh`/`desktop:dist` (que precisam de `rm -rf` → `rimraf`/`fs.rmSync`).

**Outros ajustes**:
- `.gitattributes`: `* text=auto eol=lf`, `*.sh text eol=lf`, `*.png binary`, `*.pdf binary`, `*.ico binary`, `*.icns binary` (evita CRLF quebrar `bash`, testes de bytes e a referência gerada). Alternativa local: `git config core.autocrlf false` **no repo**. Em ambos os casos a working tree atual (CRLF) só volta a LF depois de re-materializar os arquivos (ex.: com a árvore limpa, `git rm --cached -r -q . && git reset -q --hard` — destrutivo para mudanças não commitadas; faça commit/stash antes) e verificar com `git ls-files --eol`.
- `eslint.config.mjs`: adicionar `"_refs/**"` (e `core-plugins/**`, `public/plugin-authoring/**`) em `globalIgnores` — hoje o `tsconfig.json` exclui `_refs`, mas o ESLint **não** lê `.gitignore` e vai lintar os repos de referência.
- `plugins/flashcards/src/store.cjs`: retry de `renameSync` em `EPERM/EBUSY/EACCES` como `src/store/atomic-write.ts`.
- Gerador da referência da API: forçar LF.
- CI: job `quality-windows` (`windows-2025`, `shell: pwsh`) rodando `npm test` + testes dos plugins; hoje `npm test` só roda em `ubuntu-24.04`, e os testes `plugins/*/tests` **não rodam em CI nenhum** (ci.yml faz `plugins:setup`, `typecheck`, `test`, `lint`).

### 6.5 Sequência recomendada no Windows (dev do dia a dia)

```powershell
npm ci
npm run plugins:setup        # gera .sdk/ e npm ci em cada plugins/<id>
npm run typecheck            # tsc --noEmit (inclui plugins TS; _refs excluído)
npm run lint
node scripts/run-tests.mjs   # (após a correção) ou o comando PowerShell da §6.3
npm run dev                  # http://localhost:3000 (dados em .\data, chaves em .\auth.json)
```
Mudou código de plugin? `npm run plugins:build-core` e **reinicie** o `next dev` (sem hot reload de plugin). Se o `next dev` estiver segurando arquivos em `core-plugins/`, o `renameSync` do staging pode dar `EPERM` no Windows — pare o servidor antes de rebuildar.

---

## 7. (d) Electron no Windows

### 7.1 Como o app desktop funciona

- `electron/main.cjs` é só launcher + guarda: escolhe porta livre, gera `LH_DESKTOP_API_SECRET` (32 bytes hex), e faz `spawn(process.execPath, [server.js], {env:{ELECTRON_RUN_AS_NODE:"1", NODE_ENV:"production", PORT, HOSTNAME:"127.0.0.1", LH_DATA_DIR, LH_AUTH_FILE, LH_DESKTOP_SERVER:"1", LH_DESKTOP_API_SECRET}, stdio:[…,"ipc"]})`. O servidor é o **standalone do Next** em `resources/server/standalone/server.js` (fora do asar via `extraResources`).
- Janela: `contextIsolation`, `sandbox`, sem `nodeIntegration`, `preload.cjs` expõe `window.lh` (attachments, ChatGPT/assinaturas, zoom, update, appearance). No Windows: `titleBarStyle:"hidden"` + `titleBarOverlay` (Window Controls Overlay à direita), `autoHideMenuBar` (Alt mostra menu).
- Permissões deny-by-default: só `media`, `clipboard-sanitized-write`, `local-fonts` para a própria origem; `will-navigate` preso à origem; `window.open` negado e links http/https/mailto vão para o navegador.
- Credenciais de assinatura (ChatGPT etc.) ficam no **processo main** (`chatgpt-credentials.json` em `userData`), repassadas ao filho por IPC.
- `--browser-service`: a própria binária vira helper Chromium (CDP) para demos.

### 7.2 Onde ficam os dados no Windows

`app.setName("LearnHarness")` antes de tudo ⇒ `app.getPath("userData")` = **`%APPDATA%\LearnHarness`** (Roaming).

| Item | Caminho |
| --- | --- |
| Dados de aprendizagem (`LH_DATA_DIR`) | `%APPDATA%\LearnHarness\data\` → `chats\`, `jobs\`, `graph\` (`nodes.jsonl`, `chains.jsonl`, `sessions.jsonl`, `coverage.jsonl`, `sources.json`, `positions.json`, `render-settings.json`, `format.json`, `source-organization.json`), `settings.json`, `prompts\`, `themes\`, `plugins-state.json`, `core-plugin-data\<id>\`, `plugins\<id>\{dist,data}\`, `debug\` |
| Chaves BYOK (`LH_AUTH_FILE`) | `%APPDATA%\LearnHarness\auth.json` (texto puro; "0600" não se aplica no Windows — protegido só pela ACL do perfil) |
| Credenciais de assinatura | `%APPDATA%\LearnHarness\chatgpt-credentials.json` e arquivos de `subscriptions` no mesmo diretório |
| Log | `%APPDATA%\LearnHarness\logs\main.log` (inclui stdout/stderr do servidor e do updater) |
| Dev shell (`LH_DEV_URL`) | `%APPDATA%\LearnHarness-dev\` (localStorage/logs do Electron), **mas** o servidor `next dev` grava em `<repo>\data\` e `<repo>\auth.json` (a menos que você defina `LH_DATA_DIR`/`LH_AUTH_FILE`) |
| Instalação (NSIS `oneClick`, `perMachine:false`) | por usuário, tipicamente `%LOCALAPPDATA%\Programs\LearnHarness\` (código; somente leitura na prática) |
| Cache do updater | tipicamente `%LOCALAPPDATA%\learnharness-updater\` (nome do `package.json`) |

Instância única: `app.requestSingleInstanceLock()`. **Um servidor por perfil de dados** — não rode `npm run dev` e o app instalado contra o mesmo `LH_DATA_DIR`.

### 7.3 Build no Windows (`docs/desktop-release.md`)

Precisa ser feito **no próprio Windows** (o trace do Next copia binários nativos da máquina: `@napi-rs/canvas-win32-x64-msvc`, `@resvg/resvg-js-win32-x64-msvc`, Photon WASM).

1. `npm ci` e `npm run plugins:setup`
2. Testes nativos no Node do Electron: `$env:ELECTRON_RUN_AS_NODE="1"; $env:NODE_ENV="test"; npx electron --import tsx --test tests/pdf-native-render.test.ts tests/pdf-ops.test.ts tests/svg-native-render.test.ts tests/browser-service.test.ts`
3. `npm run build` (inclui `plugins:build-core`)
4. `node scripts/smoke-provider-runtime.mjs` (trace fresco)
5. `node scripts/build-server.mjs` (copia estáticos, valida prompts, **recusa** `auth.json`/credenciais/dados no payload, copia `core-plugins`)
6. `node scripts/smoke-server.mjs --electron`
7. `npx electron-builder --win --x64 --publish never` ⇒ `dist\LearnHarness-<v>-x64-setup.exe` + `.blockmap` + `latest.yml`; `dist\win-unpacked\` para testes.

Notas: instalador **não assinado** (`signExecutable:false`, `verifyUpdateCodeSignature:false`) ⇒ SmartScreen avisa; o electron-builder pode baixar `winCodeSign`/`rcedit` e extrair symlinks (Developer Mode ligado resolve); o CI de release usa `shell: bash` no `windows-2025` (Git Bash do runner), por isso os passos com `VAR=…` funcionam lá.

### 7.4 Auto-update

- `electron-updater` ^6.8.9 (incluído explicitamente no asar via lista de `files`), só em `app.isPackaged`.
- Feed: `publish: github, owner: amosblomqvist, repo: learnharness, releaseType: draft` ⇒ o app lê `latest.yml` das Releases **públicas** desse repo. `LH_UPDATE_FEED` sobrescreve com feed genérico (teste).
- Checa no boot e a cada 24 h se `settings.general.autoUpdate !== false` (lido de `<DATA_DIR>\settings.json`), `autoDownload=true`, `autoInstallOnAppQuit=true`; banner "Restart" chama `installUpdateNow()` (mata o servidor antes do `quitAndInstall`). Windows usa NSIS diferencial (blockmap).
- **Para o fork (obrigatório antes de distribuir qualquer build):**
  1. `electron-builder.yml`: `appId` (ex.: `com.<voce>.<App>`), `productName`, `publish.owner/repo` do fork (ou remover `publish` até ter releases próprias).
  2. `electron/main.cjs`: `PRODUCT_NAME`/`app.setName(...)` — senão o fork usa **o mesmo `%APPDATA%\LearnHarness`** do app oficial (dados, chaves e lock de instância compartilhados).
  3. `package.json`: `name`, `homepage`, `author`, `desktopName`; `next.config.ts` expõe `LH_HOMEPAGE`.
  4. `.github/workflows/notify-website.yml` e `scripts/verify-release.ts` (11 assets esperados) conforme o novo fluxo.
  Sem isso, um build do fork pode se **auto-atualizar para o learnharness oficial** e perder as mudanças.

---

## 8. (e) Estratégia de testes para código novo

### 8.1 O que o repo já usa

- Runner: `node:test` (`describe/it/test`, `t.after`, `mock`) com `tsx` (`--import tsx`); asserts `node:assert/strict`.
- Um arquivo por **fronteira real** (`tests/plugin-workers.test.ts`, `plugin-host.test.ts`, `core-plugins.test.ts`, `plugin-question-*.test.ts`…); a doc pede testes "at each actual boundary" (`docs/plugin-architecture.md#testing`).
- Isolamento: `fs.mkdtempSync(path.join(os.tmpdir(), "lh-…"))`, `LH_DATA_DIR`/`LH_AUTH_FILE` apontando para o temp, `process.env` substituído (às vezes com `HOME`, `USERPROFILE`, `LH_IGNORE_ENV_KEYS`) e restaurado; processos filhos via `spawnSync(process.execPath, ["--import", "tsx", "tests/helpers/…"])` para testes de crash/restart (`tests/helpers/chat-save-crash.ts`, `custom-provider-crash.ts`).
- Providers falsos: `createFauxCore`, `fauxAssistantMessage`, `fauxText`, `fauxToolCall` de `@earendil-works/pi-ai` (ex.: `tests/agent-image-paths.test.ts`, `api-key-hook.test.ts`), ou `engineFor` com `streamFn` roteirizado emitindo `AssistantMessageEventStream` (ex.: `tests/plugin-workers.test.ts`: `submit_result`, correção, timeouts). Nunca chama modelo real.
- UI: `linkedom` (`parseHTML`) + `react-dom/server` (`renderToStaticMarkup`) e `act` do React; helpers `tests/modal-dom.ts`, `tests/interaction-layer-render.tsx`, `tests/helpers/plugin-chrome.tsx`.
- Dados reais: `tests/fixtures/golden-data/` (chats, grafo com 282 nós/160 cadeias, jobs, settings) lidos pelos caminhos de produção em `golden-fixtures.test.ts` — **nunca editar à mão**; mudança intencional de formato atualiza a fixture no mesmo commit.
- Contratos gerados: `plugin-api-reference.test.ts` compara `docs/plugin-api` com geração fresca; `plugin-types.test.ts` compila um consumidor do SDK.
- Smoke/gates (fora do `npm test`): `scripts/smoke-*.mjs` (servidor standalone, providers, plugin runtime/browser com Chrome, demo runtime) — exigem build.
- Plugins: testes próprios (`plugins/flashcards/tests/*.test.cjs` com `linkedom` e `ui-fixture.cjs`; `coding-questions`, `drawing-pad`, `rich-code-blocks` com `tsx --test`), mais harnesses `native.mjs`/`browser.mjs` (Puppeteer + Chrome local).

### 8.2 Recomendações para o nosso código

1. **TDD por fronteira**: módulos puros (`scheduler`, `export`, expansão do grafo, XP/MC) com testes unitários determinísticos; backends de plugin testados chamando `activate(fakeCtx)` com `ctx.handle` capturado (padrão de `plugins/flashcards/tests/backend.test.cjs`), `ctx.workers` falso e `dataDirectory` temporário.
2. **Invariantes formais como property tests**: para o grafo-currículo (aciclicidade, pré-requisitos transitivos, monotonicidade de nível, idempotência de expansão) usar `fast-check` (devDependency do plugin) — complementa uma eventual prova em Lean 4 do núcleo do algoritmo; manter o validador do worker (`validateResult`) como a mesma função testada.
3. **Monte Carlo reprodutível**: PRNG semeável (ex.: Mulberry32) injetado; testes de calibração com tolerâncias estatísticas e seeds fixas; nunca `Math.random` direto em lógica testada (o `chooseCue` já aceita `random` injetável — siga o padrão).
4. **IA**: sempre provider falso/roteirizado; um teste de "conversa de correção" (resultado inválido → feedback → válido) por worker; nenhum teste depende de chave (rode com as variáveis `*_API_KEY` removidas).
5. **Persistência**: testar migração de versão (recusar versões futuras, como `openStore`), idempotência por `requestId`, crash entre escrita e rename (padrão `atomic-write.test.ts`), e o caso Windows (rename com arquivo aberto).
6. **UI**: `linkedom` para estrutura/estado; Puppeteer (`scripts/smoke-plugin-browser.mjs` como modelo) só para fluxos críticos.
7. **Portabilidade**: `path.join` nos esperados, `pathToFileURL` para imports dinâmicos, sem asserts de `mode` no win32, `USERPROFILE` junto com `HOME`, globs entre aspas.
8. **CI**: adicionar matriz Windows para `npm test` e um passo que rode `npm test` em cada `plugins/<id>`; manter o job Linux como referência.
9. Se mudar formato de dados do core: atualizar `tests/fixtures/golden-data` **no mesmo commit** e o `format.json`/stamps.

---

## 9. (f) Riscos e armadilhas

### 9.1 Next 16 ("This is NOT the Next.js you know", `AGENTS.md`)

- Ler `node_modules/next/dist/docs/` antes de mexer em framework (ex.: `01-app/02-guides/upgrading/version-16.md`). O bloco do `AGENTS.md` é **reescrito pelo `next dev`** (`node_modules/next/dist/server/lib/generate-agent-files.js`).
- **Turbopack é o padrão** em `next dev` e `next build` (sem `--turbopack`). Comentários `/* turbopackIgnore: true */` em `config.ts`, `src/server/plugins.ts`, `plugin-data-paths.ts` impedem o tracer de varrer `data/` — mantenha-os em todo `path.join` de caminho mutável.
- `middleware.ts` → **`proxy.ts`** (runtime Node fixo, sem edge). Aqui `proxy.ts` aplica `apiRequestRefusal` a `/api/**` exceto `/api/plugins/<id>/documents/markdown` (que valida dentro da rota). Matcher precisa ser literal estático.
- APIs de request **somente assíncronas** (`cookies()`, `headers()`, `params`, `searchParams`).
- `next dev` grava em `.next/dev` e tem **lockfile** (não rode dois `next dev` no mesmo projeto; `dev` e `build` podem rodar juntos).
- `experimental.proxyClientMaxBodySize` controla o buffer do proxy (uploads de 25 MiB).
- `output: "standalone"` + `outputFileTracingExcludes/Includes` são **"load-bearing"**: excluir `dist/**` quebrou pi-ai; `**/data/**/*` poda `gcp-metadata` no tracer nativo (por isso o include explícito); JSON importado com `with {type:"json"}` some do trace. Qualquer dependência nova com assets dinâmicos/nativos precisa de include e de smoke (`smoke-provider-runtime`, `smoke-server --electron`).
- `serverExternalPackages`: pi-ai, pi-agent-core, pdfjs-dist, @napi-rs/canvas, photon, resvg — dependências desse tipo **não** podem ser bundladas.
- `instrumentation.ts` inicializa plugins; falha de plugin não pode derrubar o app.

### 9.2 Plugins

- **Restart obrigatório** após mudar código de plugin (cache de módulos; sem hot reload). Rebuild de core plugins via `plugins:build-core` (`dev`/`build` já fazem).
- Backend roda **no processo do servidor**: um loop síncrono pesado (ex.: Monte Carlo, otimizador FSRS) **trava todas as rotas**; use `worker_threads`/chunks com `await`.
- Instruções aditivas são **estáticas** e globais por tipo de agente; mudar o texto invalida prompt caching de todas as sessões.
- `registerTools.create` é **síncrono**; colisão de nome de tool remove o pacote inteiro do turno.
- Plugin não escreve no grafo/chats; não cria sessões; não salva arquivo pelo diálogo do host.
- Dependências nativas: host não instala nem recompila; usar JS/WASM ou N-API compatível com o Node do Electron 44.
- Core IDs reservados (`flashcards`, `coding-questions`, `drawing-pad`, `rich-code-blocks`): no fork, editar **in-place** em `plugins/<id>` (é o "core" do fork); um plugin novo enviado com o app entra em `core-plugins.json` (e passa por `safeTree`: nada de `.ts`, `src/`, `data/`, `package.json` no `dist`).
- Prompts de geração do Flashcards estão em inglês; para Inglês/Eletrônica em PT-BR será preciso decidir idioma dos cartões (decisão de produto).

### 9.3 Dados e operação

- `PATHS` (`config.ts`) é resolvido **no load do módulo**: trocar de domínio/perfil exige reiniciar o servidor.
- **Um servidor por data-dir/auth** (sem lock entre processos); não rode o app instalado e o dev contra o mesmo perfil.
- `auth.json` é texto puro; variáveis de ambiente vencem o arquivo — há `*_API_KEY` reais no ambiente deste usuário.
- Store do Flashcards: JSON único reescrito por revisão (escala) e sem retry de rename no Windows.
- Scripts que **mutam dados reais**: `scripts/import-notes.ts`, `scripts/backfill-graph.ts` ("wipe the legacy ledgers"), `dev-fresh.sh` (`rm -rf .fresh-data`). Ler antes de rodar; usar perfil descartável.
- `git` com `autocrlf=true` e sem `.gitattributes`: a working tree **já está em CRLF** (1244 arquivos); afeta `.sh`, testes que comparam fontes e docs gerados.
- `_refs/` está em `.gitignore` e `tsconfig.json` (modificados localmente), mas **não** no ESLint.

### 9.4 Distribuição/licença

- AGPL-3.0-only: o fork distribuído precisa oferecer o código-fonte (inclusive mudanças); o FSRS adaptado é MIT (manter `FSRS-LICENSE.txt`); bibliotecas novas (ankipack MIT, markdown-it MIT, fast-check MIT, sql.js MIT) são compatíveis.
- Fork sem trocar `appId`/`productName`/`publish` = colisão de dados com o app oficial e auto-update para o upstream (§7.4).
- Windows não assinado: SmartScreen; antivírus pode bloquear o helper `--browser-service`.

### 9.5 Processo (AGENTS.md "No guessing")

Toda decisão de nome, formato, UX, default ou escopo deve ser **perguntada ao humano** antes de implementar; o plano precisa ser aprovado. Itens deste relatório marcados como "proposta"/"recomendação" (formato de export, política de sincronização, capacidades novas de core, mudanças de scripts) são insumos para essa conversa, não decisões.

---

## 10. Apêndice

### 10.1 Referências internas mais úteis

- `docs/plugin-authoring.md` (guia), `docs/plugin-architecture.md` (mapa do host), `docs/plugin-api/README.md` (referência gerada), `docs/plugin-examples.md` (rotas de leitura), contratos `docs/plugin-*-contract.md`, `docs/plugin-view-context.md`, `docs/dialog-overlay-contract.md`.
- Exemplos: `examples/plugins/hello-plugin` (mínimo, sem build), `examples/plugins/managed-agent` (agentes com input), `examples/plugins/teaching-extension` (instruções + tool + **background tool** com worker; coberto por `tests/plugin-teaching-integration.test.ts`), `plugins/ui-showcase` (15 métodos de UI), `plugins/coding-questions` (question/problem types; runner que mata árvore de processos com `taskkill` no Windows), `plugins/drawing-pad` (ações de sessão, atalhos, surfaces, interceptor com imagens), `plugins/rich-code-blocks` (code fences + instruções).
- Ferramentas: `scripts/install-plugin-local.mjs` (instala `dist` de um plugin community de forma atômica), `scripts/build-plugin-types.mjs` (SDK), `scripts/build-plugin-api-reference.mjs`.

### 10.2 Fontes externas (verificadas em 2026-11-18)

- ts-fsrs releases (6.0.0 em 2026-10-28; FSRS-7 padrão; Node ≥ 24): https://github.com/open-spaced-repetition/ts-fsrs/releases e https://api.github.com/repos/open-spaced-repetition/ts-fsrs/releases
- Anki releases/FSRS-6 (25.07) e linha 26.x: https://github.com/ankitects/anki/releases, https://forums.ankiweb.net/t/anki-26-05-beta-1/69707
- AnkiConnect (add-on 2055492159; tag 24.11.5.1): https://git.foosoft.net/alex/anki-connect , https://ankiweb.net/shared/info/2055492159
- ankipack (MIT, esquema V18): https://github.com/ImGajeed76/ankipack
- Formato `.apkg`/`collection.anki21b`: https://forums.ankiweb.net/t/is-there-any-way-to-open-the-collection-anki21b-file-through-python/31788 , https://docs.ankiweb.net/manual/exporting
- Obsidian Spaced Repetition (1.15.4; sintaxe; `<!--SR:…-->`): https://github.com/st3v3nmw/obsidian-spaced-repetition , `docs/docs/en/data-storage.md`, `docs/docs/en/algorithms.md`
- Plugins Obsidian com FSRS: https://community.obsidian.md/plugins/true-recall , https://community.obsidian.md/plugins/fsrs , https://community.obsidian.md/plugins/retain
- Next.js 16 (docs locais): `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`
