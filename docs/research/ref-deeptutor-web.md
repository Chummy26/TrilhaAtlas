# DeepTutor: camada web/app (UX, desktop, componentes portáveis)

> Referência analisada: `_refs/DeepTutor` (HKUDS), release **v1.7.3, de 2026-11-16** (commit `4c1e000d`).
> Escopo: `web/**`, `apps/**`, `deeptutor_web/**`, `packaging/**`, `assets/**` (figuras vistas), `examples/**`, `scripts/**`, `Dockerfile*`, `docker-compose*.yml`/`compose*.yaml`.
> Método: só leitura. Nenhum código, script, build ou install do repositório foi executado.
> Data da análise: 2026-11-18. Todos os caminhos abaixo são relativos a `_refs/DeepTutor/`, salvo indicação contrária.

---

## 0. Resumo

- **O que é.** O DeepTutor é um tutor com IA "full-stack":
  - backend Python (FastAPI e uvicorn);
  - frontend Next.js 16 standalone (`web/`, pacote `opentutor-web`, React 19, Tailwind 3.4, i18next com 13 locales, inclusive `pt`);
  - app desktop Electron 45 (`apps/desktop`, "Open DeepTutor").

  O Electron sobe o Python e o servidor Next em loopback, sob um *supervisor*. **Não usa Tauri.**
- **Licença.** Apache-2.0 (`LICENSE`). Pode ser incorporada num projeto AGPL-3.0, porque a compatibilidade é de mão única (Apache-2.0 → GPLv3/AGPLv3). É preciso manter o aviso de copyright e licença e marcar os arquivos modificados.
  - Partes vendorizadas e conceitos de terceiros são MIT: thinking-orbs (`web/vendor/thinking-orbs/`), CSSwitch (conceito do OAuth do Codex) e hermes-agent. A lista está em `THIRD_PARTY_NOTICES.md`.
- **UX mais relevante para nós:**
  1. **Memória em 3 camadas com grafo radial navegável** (`web/lib/memory-graph.ts` e `web/components/memory/MemoryGraph.tsx`).
  2. **Mastery Path:** grafo de pré-requisitos, *gate* de domínio, *next step* tipado, revisão estilo FSRS e plano de revisão por tipo de conhecimento (`web/lib/learning-api.ts` e `web/components/space/learning/*`).
  3. **Workspaces isolados**, com remontagem via `key`, o que equivale às nossas "sessões por domínio" (`web/lib/workspace-scope.ts` e `web/components/workspaces/WorkspaceRuntimeBoundary.tsx`).
  4. **Estatísticas de uso** por modelo (tokens in/out, cache hit, TTFT, TPS) com heatmap anual estilo GitHub (`web/features/settings/*Usage*`).
  5. **Login com ChatGPT (Codex OAuth, PKCE loopback)**, com catálogo de modelos dinâmico e sem modelo hardcoded (`web/lib/codex-oauth.ts` e `web/lib/llm-options.ts`).
  6. **Widgets HTML gerados por IA** em iframe sandbox, com ponte `postMessage` (`web/lib/iframe-html.ts`).
  7. **Comentários de design no próprio código** que registram erros que eles corrigiram, como a skin "mapa do tesouro" removida e o anel de progresso "tinta, não cor de ação". Isso dá ouro para o nosso cel-shading.
- **O que não tem (e nós queremos):**
  - XP, nível ou ranking: só confete ao "dominar" e anéis de progresso.
  - Integração real com Anki: o Anki é só export `.txt`. Não há AnkiConnect nem `.apkg`.
  - Obsidian só como *fonte* de base de conhecimento, sem export de cards.
  - Grafo de conhecimento em escala de milhares de nós: o grafo de memória é SVG e o mapa de aprendizagem é lista ou kanban.
- **Riscos de copiar:**
  - superfície gigantesca (1.747 arquivos em `web/`, 1.578 `.ts/.tsx`);
  - dependência de backend Python;
  - várias features "parceiros/IM/MCP/sandbox" fora do nosso escopo.

---

## 1. Mapa da camada web/app

| Diretório | Conteúdo | Observação |
|---|---|---|
| `web/` | App Next.js 16 (`opentutor-web`) | `output: "standalone"`; `web/proxy.ts` (o "proxy", ex-middleware no Next 16) reescreve `/api/*` e `/ws/*` para o backend |
| `web/app/(workspace)/…` | Rotas principais: chat, learning (books, mastery, practice), notes, reading, knowledge, memory | Layout com stack de providers em `web/app/(workspace)/layout.tsx` |
| `web/app/(utility)/…` | settings, profile, progress | `settings/progress/page.tsx` e `profile/page.tsx` (este só cuida de conta: avatar e senha) |
| `web/lib/` | Clientes de API tipados e algoritmos puros | `memory-graph.ts`, `learning-api.ts`, `mastery-ws.ts`, `iframe-html.ts`, `workspace-scope.ts`, `usage-statistics.ts`, `codex-oauth.ts`, `llm-options.ts` |
| `web/components/` | Componentes React por domínio | `memory/`, `space/learning/`, `chat/home/`, `reading/`, `watching/`, `workspaces/`, `layout/`, `settings/`, `video-lesson/` |
| `web/features/` | Fatias por feature (chat transport, settings, notes, knowledge, ui-layout) | `features/chat/transport/*`, `features/ui-layout/types.ts` |
| `web/contracts/` | Tipos gerados do JSON Schema/OpenAPI do backend | `contracts/generated/turn-protocol.ts`, gerado por `scripts/export_frontend_contracts.py` |
| `web/vendor/thinking-orbs/` | Orbe animado em canvas para o estado "pensando" (MIT) | Um único clock compartilhado; pausa fora da tela; respeita reduced-motion |
| `web/locales/{de,en,fr,hu,it,ja,ko,pl,pt,tr,uk,vi,zh}/app.json` | i18n | `pt` é genérico, sem variante pt-BR dedicada (`web/i18n/languages.ts`) |
| `apps/desktop/` | Shell Electron 45.1.0 e supervisor (51 arquivos) | Ver §5 |
| `deeptutor_web/` | `__init__.py` placeholder | Pacote Python que carrega os assets standalone do Next dentro do wheel (montado por `scripts/prepare_web_package.py`) |
| `packaging/deeptutor-cli/` | Alias de compatibilidade só-CLI | Irrelevante para nós |
| `assets/figs/web-dev/` | 60 screenshots (v1.6.15-dev, 2026-10-28, 1470×900@2x) com `manifest.json` | Base da análise de UX em §4 |
| `assets/releases/` | Notas de release | `ver1-7-3.md` é a atual; `past_releases/ver1-7-0.md` traz layouts Modern/Classic, notebook com Dito e Video Lesson |
| `examples/memory_evaluation/` | Harness de avaliação de memória (RFC #2057) | Casos sintéticos; não declara números de benchmark |
| `scripts/` | Launchers e utilidades | `start_web.py`, `export_frontend_contracts.py`, `check_architecture.py`, `docker_compose.py`, `pb_setup.py`, `start_*.bat` |
| raiz | `Dockerfile`, `Dockerfile.runner`, `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.ghcr.yml`, `compose.yaml` (Podman rootless) e `compose.codex-oauth.yaml` | Ver §5.5 |

**Dependências notáveis do `web/package.json`:**

| Uso | Pacotes |
|---|---|
| Notebook (editor de blocos) | `@blocknote/*` 0.56 |
| Grafos e diagramas | `cytoscape`, `mermaid` |
| Matemática | `katex` |
| Leitura de PDF e ePub | `pdfjs-dist`, `epubjs` |
| Animação | `framer-motion` |
| Gráficos | `chart.js` |
| Ícones | `lucide-react` |
| Anotação de texto | `@recogito/text-annotator` |
| Testes | Vitest, Playwright |
| Fronteiras de arquitetura | `dependency-cruiser` |

---

## 2. Arquitetura e conexão frontend↔backend

### 2.1 Proxy e URL do backend

- `web/proxy.ts` reescreve `/api/*` e `/ws/*` em tempo de request para `DEEPTUTOR_API_BASE_URL`. A mesma imagem serve qualquer backend.
- O cliente HTTP é `web/shared/api/client.ts` (`apiFetch`). Ele envia com `credentials` e redireciona para login em 401 quando a autenticação multiusuário está ligada.
- Em `web/next.config.js`:
  - `output: "standalone"`;
  - `distDir` configurável por env;
  - `proxyTimeout` de 30 min (para turnos longos);
  - `proxyClientMaxBodySize` de 210 MB (uploads);
  - `allowedDevOrigins` com IPs da LAN.
- As configurações do usuário vivem em **`data/user/settings/*.json`**, e o `.env` é ignorado em runtime. O Electron observa `interface.json` para tema e idioma (§5).

### 2.2 Protocolo de turno (WebSocket v2.0)

Os contratos são gerados do backend (`web/contracts/generated/turn-protocol.ts`).

- **Comandos:**
  - `start_turn`, `subscribe_turn`, `subscribe_session`, `resume_from` (com `seq`);
  - `cancel_turn`, `regenerate`;
  - `submit_user_reply` e `user_input` (human-in-the-loop);
  - `check_active_turn`, `ping`.
  - Alguns exigem *ack*.
- **Eventos:**
  - `stage_start`/`stage_end`, `thinking`, `content`;
  - `tool_call`/`tool_result`, `progress`, `sources`;
  - `result`, `error`, `session`;
  - `wait_for_input`, `done`.
  - Todos levam número de sequência, o que permite retomar de onde parou.
- **Cliente:** `web/features/chat/transport/UnifiedTurnClient.ts` e `TurnRuntimeClient.ts`.
- **Política de reconexão** (`web/features/chat/transport/reconnect-policy.ts`, 25 linhas, pura e testável):

```ts
const BASE_DELAY_MS = 250, MAX_DELAY_MS = 8_000, IDLE_ATTEMPT_LIMIT = 5;
reconnectDelay(attempt) = round(min(MAX, BASE * 2**attempt) * (0.8 + rand*0.4))
shouldReconnect({attempt, activeTurnId, pageVisible}) =
  (!pageVisible && !activeTurnId) ? false : (!!activeTurnId || attempt < 5)
```

Com turno ativo, a reconexão tenta indefinidamente. Ocioso, desiste após 5 tentativas. Com a aba oculta e sem turno, não reconecta.

### 2.3 Feed de eventos com revisão (Mastery Path)

- O WebSocket `/ws/mastery-paths` (`web/lib/mastery-ws.ts`) aceita `masterySubscribePayload(pathId, afterRevision)` e responde com as mensagens `subscribed`, `topic_event` e `error`.
- O fallback REST é `GET /api/mastery-paths/progress/{id}/events?after_revision=`.
- `web/hooks/useMasteryPathActivity.ts` → `mergeEventBatch` deduplica por `id` e ordena por `revision`.
- Esse é um padrão de **event log monotônico**: serve para sincronizar a nossa árvore de conhecimento e a memória entre janelas, o processo main do Electron e o agente.

### 2.4 Escopo por workspace

O workspace é o isolamento por domínio.

- `web/lib/workspace-scope.ts`:
  - `activeWorkspaceId()`;
  - `scopedUrl(url)`, que acrescenta `?dt_workspace=<id>` a **toda** URL same-origin;
  - `selectWorkspace(id)`, que dispara o evento `deeptutor:before-workspace-switch` para que editores salvem rascunhos **antes** da troca.
- `web/components/workspaces/WorkspaceRuntimeBoundary.tsx` envolve os runtimes em `<Fragment key={workspaceId}>`. Na troca, todo estado de React (stores, sockets, caches locais) é desmontado e remontado. É simples e à prova de vazamento entre domínios.
- `web/lib/workspaces-api.ts` → `ChatWorkspaceRegistration{workspace_id, kind, display_name, path, resources, instructions}` em `/api/settings/workspace/registrations`.
  - `resources` são skills, MCP e KBs; `instructions` é o prompt do domínio; `path` é a pasta no disco.
  - Equivale a um "domínio" com recursos e persona próprios.

---

## 3. Inventário visual (screenshots em `assets/figs/web-dev/`)

| Arquivo | O que mostra | Interesse |
|---|---|---|
| `chat.png` | Home com saudação ("Good evening."), composer (Mode, skills, MCP, Partners, Preferences), chips Explain/Solve/Practice/Plan/Research e "Ideas for you" (uma linha) | Composer rico, sem poluição |
| `memory-graph.png` | Grafo radial: L3 no centro, L2 no anel médio, L1 no anel externo, rótulos de cluster com contagem, toggles de camada, zoom de 54% e legenda "L3 176 · L2 502 · L1 1302" | **Alto**: visualização de memória |
| `memory.png` | Hub de memória com cards L1/L2/L3 e painel de execução de consolidação | Alto |
| `mastery.png`, `mastery-detail.png` | Banner "Next up" com CTA "Begin first waypoint", toggle Outline/Board, módulos com x/2, plano de revisão com recall target de 90%, card "About you" e painel de sessões | **Alto**: árvore e progresso |
| `learning.png`, `learning-new.png` | Atlas de tópicos com banner de revisões devidas; wizard com 2 campos (objetivo e materiais) | Alto |
| `practice.png` | "Today's review": revisados, agendados para depois, banco de questões | Médio-alto |
| `books.png`, `book-detail.png`, `book-quiz.png`, `book-widget.png` | Livro gerado com sidebar de capítulos, callout "key takeaway", quick check MCQ com "Reveal answer", widget HTML interativo com slider, "← / → to turn pages" e barra de progresso | **Alto**: aulas geradas |
| `notebook-detail.png`, `notebook-dito.png` | Notebook BlockNote com painel "Dito" (continue writing, explain, check facts, summarize) e chips "Make something here" (Diagram, Timeline, Concept map, Quiz me, Flash Cards, Generate image) | Alto |
| `journal.png` | Diário de aprendizagem: missão atual, handoff da última sessão, registros confirmados | **Alto**: memória "onde estou e para onde vou" |
| `personalization.png` | Perfil do aprendiz no nível da conta | Médio |
| `reading-detail.png` | Leitor de PDF/ePub com anotações | Médio |
| `workspace-switcher.png` | Dropdown de troca de workspace | **Alto**: sessões por domínio |
| `providers.png`, `settings-video.png`, `appearance.png` | Providers, vídeo, temas | Médio |
| `task-board.png`, `calendar.png` | Tarefas e calendário | Baixo |

---

## 4. (a) UX: análise por área

### 4.1 Perfil do aluno: dois níveis, editado pela conversa

1. **Nível conta** (`web/features/settings/sections/LearnerProfileSettingsSection.tsx`). O formulário tem idade, `grade_level`, `curriculum`, `language`, `reading_level` e `explanation_style`. É o "perfil global" injetado em todos os domínios.
2. **Nível tópico** (`LearnerProfile` em `web/lib/learning-api.ts` e `web/components/space/learning/LearnerProfileCard.tsx`):
   - campos `prior_knowledge`, `target_level`, `time_budget`, `preferences`, `notes`;
   - `teaching_strategy: "probe_first" | "teach_first"`.
   - **O card é somente leitura.** Correções passam pelo tutor, que chama a ferramenta `mastery_profile`.
   - Bom princípio: o perfil é uma *crença do tutor* auditável, não um formulário que o aluno precisa manter.
3. **Journal** (`web/lib/learning-journal-api.ts`, `GET /api/learning-journal`) tem a forma `LearningJournal{ mission{topic, why, level}, last_session{summary, next_focus}, records[], injected_context }`.
   - O `injected_context` é **exatamente o texto que vai para o prompt**, e a UI mostra isso ao aluno. É transparência da memória.
   - Responde a "onde estou (last_session), para onde vou (mission e next_focus)".
4. **Página `/profile`** (`web/app/(utility)/profile/page.tsx`): só conta (avatar e senha), no modo multiusuário. **Não há** "perfil gamificado".

### 4.2 Memória: 3 camadas, citada, consolidável e visível

**Modelo de dados**, deduzido de `web/lib/memory-graph.ts`, `MemoryHub.tsx` e `useMemoryRun.ts`:

- **L1, traços brutos por superfície:** `Surface` ∈ {chat, notebook, quiz, kb, book, partner, cowriter}. Endpoint `GET /api/memory/snapshot/{surface}`.
- **L2, fatos por superfície.** São documentos *markdown* com uma entrada por bullet: `- texto [^1] <!--m_ULID-->`, com notas de rodapé `[^1]: surface:entityId` que apontam para a evidência L1.
  - Parser: `parseDoc()`, com as regexes `ENTRY_ID = "m_[0-9A-HJKMNP-TV-Z]{26}"` (ULID), `NEW_BULLET_RE`, `NEW_FOOTNOTE_RE = /^\[\^([^\]]+)\]:\s*(.*?)\s*$/` e `MARKER_RE`.
  - Endpoint `GET /api/memory/doc/L2/{surface}`.
- **L3, síntese:** slots `profile`, `recent` e `scope` (`L3_SLOTS`). Endpoint `GET /api/memory/doc/L3/{slot}`.
- **Consolidação** (`web/components/memory/useMemoryRun.ts`):
  - `RunMode = "update" | "audit" | "dedup"`;
  - endpoints `POST /api/memory/runs/start`, `GET /api/memory/runs/{id}`, `GET /api/memory/runs/{id}/events?since=`, `POST …/cancel` e **`POST …/undo`**;
  - o run id fica em `localStorage`, então sobrevive a reload.
  - A UI (`MemoryRunPanel.tsx`) mostra o progresso e permite desfazer a consolidação inteira.
- **Workbench** (`MemoryWorkbench.tsx`, `MemorySection.tsx` com 1.547 linhas): edição e inspeção das entradas.

**Por que importa para o nosso objetivo 2:** memória em *markdown legível com IDs estáveis e citações* é auditável, versionável (git) e editável pelo aluno. Fatos sem evidência são visíveis (sem footnote). Consolidar com *undo* resolve o medo de "a IA apagou o que eu sabia".

**Visualização** (`web/components/memory/MemoryGraph.tsx` com 992 linhas e `web/lib/memory-graph.ts` com 762):

- **Layout radial concêntrico:**
  - `DEFAULT_LAYOUT = { width: 1200, l3: 70–190, l2: 240–360, l1: 400–570, clusterGap: .05, l3ClusterGap: .22 }`;
  - cada superfície recebe uma *fatia angular* proporcional à contagem, com piso mínimo (L3 0.12, superfícies 0.025).
- **Posicionamento:**
  - `placeNodesInSlice()` monta uma treliça quase hexagonal dentro do setor anular;
  - o número de linhas radiais é a espessura dividida por `sqrt(área/contagem)`;
  - a capacidade por linha é proporcional ao raio;
  - o jitter é determinístico, com hash `(n+1)*2654435761`, para o cluster parecer uma "galáxia", não uma estrela.
  - É estável entre renders, então não "pula".
- **Arestas:**
  - `strong`: de L2 para o nó L1 específico citado;
  - `soft`: de L3 para âncoras sintéticas no centróide do cluster da superfície, invisíveis mas presentes na adjacência para iluminar a superfície inteira no hover.
- **Interação:**
  - pan com pointer capture;
  - zoom ancorado no cursor, limitado a 0,35–4;
  - highlight por BFS de 2 saltos;
  - toggles por camada;
  - halos com `radialGradient` e anéis guia tracejados;
  - HoverCard com preview, clique para travar e "trace references";
  - legenda com contagens.
- **Limite:** é SVG puro, com uns 2.000 nós na figura. Para 10⁴–10⁵ nós (a nossa árvore de 1.000–1.500 h) precisa de canvas/WebGL e zoom semântico (§7).

### 4.3 Grafo de conhecimento e progresso: Mastery Path

**Tipos centrais** (`web/lib/learning-api.ts`):

```ts
MapKnowledgePoint { id, name, type: "memory"|"concept"|"procedure"|"design",
  prerequisite_ids: string[], topic_source_ids: string[],
  status: "new"|"learning"|"mastered", mastery: number /*0..1*/,
  mastery_source, override_note, deferred }
MapModule { objective, mastered, total, points: MapKnowledgePoint[] }
MasteryMap { counts, due_reviews, complete, modules: MapModule[] }
NextStep { action: "probe"|"teach"|"practice"|"assess"|"review"|"answer_pending"|"complete",
  knowledge_point_id, gate /*quantitative|qualitative*/, mastery, threshold,
  reason, forgetting_risk, pending_prompt, session_id }
BoardCard { position: { column, row }, next_review_at, … }
MasteryEvent { id, revision, event_type, payload, session_id, turn_id }
ObjectiveReport { attempts, evidence: LearningEvidence[], review: ObjectiveReview, errors }
LearningEvidence { assessment_type: "quiz"|"qualitative"|"review", result, quality,
  hints_used, confidence, response_time }
TopicSourceKind = goal|book|notebook|knowledge_base|file|chat|question_bank|cowriter|partner_group
ReviewStrategy { intervals: Record<"memory"|"concept"|"procedure"|"design", number[]> }
TopicReview { stability, retrievability, desired_retention, lapse_count, forgetting_risk, … }
```

**Endpoints**, todos sob `/api/mastery-paths/progress/{id}`:

| Endpoint | Função |
|---|---|
| `/map` e `/board` | Visões outline e kanban |
| `/events?after_revision=` | Feed de eventos |
| `/objectives/{oid}` | Relatório do objetivo, com evidências |
| `/init-modules` | Inicializa módulos |
| `/import-from-book` | Importa a trilha a partir de um livro |
| `/generate-from-notebook` | Gera a trilha a partir do notebook |
| `/skip-question` | Pula uma questão |
| `/redo` | Refaz |

**Lógica pedagógica visível na UI:**

- **Gate de domínio:** cada ponto tem `mastery` e `threshold`, e o gate pode ser quantitativo (quiz) ou qualitativo ("explique com suas palavras").
- **NextStep tipado:** o tutor decide entre *probe* (sondar se o aluno já sabe e pular), *teach*, *practice*, *assess*, *review* ou *complete*. A copy está em `web/components/space/learning/next-step-copy.ts`, por exemplo:
  - probe: "Start with a probe and test out if you already know it";
  - assess: "Explain this clearly in your own words".

  **É o antídoto ao "explicação rápida e enxurrada de perguntas"** (objetivo 9): primeiro sonda, ensina só o que falta, e a avaliação pode ser qualitativa.
- **Revisão estilo FSRS** (`ReviewTrail.tsx`):
  - alvos de retenção `RETENTION_TARGETS = [0.7, 0.8, 0.85, 0.9, 0.95, 0.97, 0.99]`, com default de 90% na figura;
  - intervalos-base por tipo `BASELINE_INTERVALS`:
    - memory `[0,1,3,7,14,30,60]`;
    - concept `[3,7,14,30]`;
    - procedure `[3,7,14]`;
    - design `[14,28]`.
  - **Conceito portável:** o tipo de conhecimento define a cadência. Vocabulário de inglês é "memory", e projeto de circuito é "design".
- **Modos de sessão:** `outline`, `study` e `review` (`MODE_PRESENTATION` em `MasteryStudy.tsx`, 929 linhas).
- **Wizard mínimo** (`CreateTopicWizard.tsx`): só "objetivo" e "materiais". **O outline é desenhado na primeira sessão com o tutor**, não num passo estático do wizard. O código registra isso como decisão de produto.

**Componentes de visualização:**

| Componente | Função |
|---|---|
| `TopicAtlas.tsx` | Lista de tópicos, com banner de revisões devidas que leva à sessão de revisão |
| `ModuleOutline.tsx` | Outline de módulos. **Substituiu um mapa ilustrado** |
| `StudyOutline.tsx` | Trilho com pontos **preenchido** (dominado), **anel** (em progresso) e **vazado** (novo) |
| `LearningBoard.tsx` | Kanban em que módulos são colunas e objetivos são cards; borda e ícone de status; `ObjectiveDetail` expansível com evidências; botão "Start tutoring" |
| `ProgressRing.tsx` | Anel hairline (1,75 px) com cor de tinta (`--foreground`), que **só vira `--primary` a 100%**. O `%` vai em corpo menor. O comentário no topo é uma aula de design |
| `LevelUpCelebration.tsx` | Confete em canvas via portal no `body`, `DURATION = 3200ms`, três materiais (papel, lantejoula, serpentina) com física de tumbling, flutter e arrasto. Respeita `prefers-reduced-motion` |
| `SessionCamp.tsx` | Painel das sessões do tópico |
| `mastery-theme.css` | Comentário: a skin pergaminho foi **removida** ("cartoon"); o estado é codificado por *forma*, não só por matiz |

O backend **não emite** evento "mastered". `MasteryStudy.tsx` detecta a transição de status por diff entre snapshots e dispara a celebração. Para nós, é melhor emitir o evento explicitamente.

### 4.4 Sessões

- **Por workspace:** isolamento total via `key` e `?dt_workspace` (§2.4). O dropdown aparece em `workspace-switcher.png`.
- **Por tópico:** `TopicSession` e `SessionCamp`; o handoff da última sessão aparece no journal.
- **Por turno:** `subscribe_session` e `resume_from` permitem reabrir uma sessão em andamento noutra janela.
- **Importação de histórico** (`web/lib/chat-import/`): importa sessões do **Claude Code** (`.claude`), do **Codex** (`.codex`) e do **export do ChatGPT**, tudo no navegador via File System Access API. É útil para semear a memória de um domínio.

### 4.5 Notebook ("Dito")

- Editor **BlockNote 0.56**; o painel do assistente se chama "Dito".
  - Ações: continue writing, explain, check facts, summarize.
  - Chips "Make something here" para inserir artefatos.
- Tipos de artefato (`web/features/notes/model/learning-kinds.ts`): `mermaid`, `timeline`, `concept_map`, `quiz`, `flashcards`, `image`, `animation`, `geogebra`, `audio`, `research`, `task`.
- Export (`web/features/notes/components/NoteWorkspace.tsx`): md, docx e **anki**.
  - O "anki" é um `.txt` vindo de `GET /api/documents/{id}/flashcards/export`, para importação manual no Anki.
  - **Não há** AnkiConnect nem `.apkg`.
- Obsidian: `connectObsidianVault` → `POST /api/knowledge-bases/connect-obsidian` (`web/features/knowledge/api/client.ts`). O vault é só **fonte de KB** (leitura); não há export de cards para plugins do Obsidian.

### 4.6 Books: aulas geradas por IA

- **Modelo** (`web/lib/book-types.ts`): `Spine` (capítulos e `concept_graph`) → `Page` → `Block`.
- **Tipos de bloco:** `text`, `callout`, `quiz`, `user_note`, `figure`, `interactive`, `animation`, `code`, `timeline`, `flash_cards`, `deep_dive`, `section`, `concept_graph`.
- **Profundidade:** `brief`, `standard` ou `deep`.
- **Concept graph:** arestas `depends_on`, `extends` e `related`, renderizadas em Mermaid por `renderConceptGraphMermaid()` (`web/lib/concept-graph.ts`).
- **Blocos** em `web/app/(workspace)/learning/books/components/blocks/`:
  - `FlashCardsBlock`: flip, anterior/próximo, dica;
  - `QuizBlock`: MCQ com "Reveal answer";
  - `InteractiveBlock`: HTML gerado (`VisualizeResult.html`) via `VisualizationViewer`.
- **UX:** navegação por teclado (←/→), barra de progresso por capítulo, callout de "key takeaway".
- **Perguntas pontuais e esparsas** ("quick check") no meio do texto, nunca em lote no final.

### 4.7 Widgets HTML gerados por IA (sandbox)

`web/lib/iframe-html.ts`:

| Função | O que faz |
|---|---|
| `sanitizeIframeHtml()` | Remove `javascript:` e `target=_top/_parent` |
| `injectKaTeX()` | Injeta o KaTeX |
| `injectColorScheme()` | Injeta a meta `color-scheme` (widget legível no tema escuro) |
| `BRIDGE_SCRIPT` | Injetado antes de `</body>` |

O bridge script expõe `window.sendPrompt(text)` → `parent.postMessage({type: "dt:visualize-prompt", …})`. O widget pode "perguntar ao tutor", por exemplo um slider de circuito que dispara "por que a corrente caiu?". Ele também reporta a altura (`dt:visualize-height`) para auto-resize.

O iframe usa `sandbox="allow-scripts"`, **sem `allow-same-origin`**. O mesmo vale para a aula em vídeo (`web/components/video-lesson/VideoLessonViewer.tsx`), cujo comentário diz: "The page runs model-written code: scripts yes, same-origin access no."

### 4.8 Vídeo

- **Fontes** (`web/lib/reading-video-sources.ts`): `youtubeVideoId()` e parser do Bilibili.
- **Player** (`web/components/reading/workspace/YouTubeReadingPlayer.tsx`):
  - `YT.Player` via **youtube-nocookie.com**, com opção de Invidious;
  - polling do tempo a cada 250 ms;
  - transcrição opcional pelo backend (`youtube-transcript-api`).
- **Citações com timestamp** (`web/lib/reading-media-citations.ts`): `linkifyMediaTimestamps()` transforma `[MM:SS]` no texto da IA em links `#dt-media-time-N` que fazem *seek* no player.
- **Marcações** (`web/components/watching/WatchingMarksPanel.tsx`): `key_point`, `question` ou `review`, com sugestões automáticas.
- **Video Lesson** (v1.7.0): vídeo gerado com Remotion e Edge TTS, exibido em iframe sandbox.
- **Dublagem/legenda PT:** não encontrei pipeline de dublagem. Há TTS e transcript, mas não tradução de legenda para PT.

### 4.9 Prática e SRS

- `web/lib/practice-api.ts` e `web/components/learning/practice/PracticeSession.tsx`:
  - `PracticeRating = again | hard | good | easy` ("good" aparece como "Mastered");
  - copy "Recall first, then check": o aluno lembra primeiro e depois revela a resposta;
  - **"again" reenfileira o card na mesma rodada.**
- Import de banco de questões em CSV/XLSX.
- Contadores de "Today's review" (revisados, agendados, banco).

### 4.10 Estatísticas de uso (tokens e tempo)

- `web/lib/usage-statistics.ts`:
  - `fetchUsageStatistics(year)` → `GET /api/settings/usage?year=&timezone=`;
  - `activityCalendar()` monta as semanas do heatmap.
- `web/features/settings/sections/UsageSettingsSection.tsx`:
  - totais (tokens in/out, chamadas, cache hit rate);
  - **tabela por modelo** com TTFT e TPS.
- `web/features/settings/components/UsageActivity.tsx`: heatmap anual estilo GitHub, paleta esmeralda em 5 níveis, **navegação por teclado**.
- `web/components/chat/home/ContextBudgetChip.tsx`: barra empilhada da janela de contexto, segmentada em messages, system_prompt, tools, memory, learning_journal, skills, sources… Mostra **quanto da memória entra no prompt**.
- **Horas estudadas por dia:** o heatmap é de *atividade de uso*. Não encontrei métrica explícita de "tempo de estudo".

### 4.11 Gamificação

- **Ausente:** não há XP, nível, ranking, streak de pontos ou badges.
- Elementos de recompensa existentes: `LevelUpCelebration` (confete), `ProgressRing`, copy de "território iluminado" ("The whole territory is illuminated" no estado *complete*), contadores de revisão.
- Para o nosso objetivo 5 (XP e ranking calibrado por Monte Carlo) **não há nada a aproveitar além do confete e do anel**.

### 4.12 Providers, modelos e OAuth (objetivo 7)

- **Sem modelo hardcoded** (`web/lib/llm-options.ts`):
  - `LLMOption{profile_id, model_id, provider, context_window, reasoning_effort, supported_reasoning_efforts, supports_vision}` vem dos perfis do backend;
  - há "task models", isto é, modelo por tarefa, e reasoning effort por conversa (v1.7.3).
- **Login com ChatGPT (Codex OAuth):**
  - Cliente: `web/lib/codex-oauth.ts`, base `/api/settings/providers/openai-codex/oauth/{status,start,cancel,complete}`, mais refresh de modelos.
  - Status: `CodexOAuthStatus{connection, operation_state, catalog_source, models}`.
  - Fluxo **PKCE com callback em loopback** nas portas **1455/1457** (`compose.codex-oauth.yaml` as mapeia no Docker). Há helper que gera o comando de *SSH port-forward* para servidor remoto.
  - UI: `web/components/settings/CodexOAuthCard.tsx` (548 linhas).
  - O catálogo de modelos vem **ao vivo** da assinatura.
  - Conceito adaptado do CSSwitch (MIT).
- **Anthropic:** não há OAuth de assinatura Claude na camada web. A integração é por **subagente local**: settings "Partners & agents" → `agent-claude-code` e `agent-codex` (`web/features/settings/navigation/settings-nav.ts`, persistidos em `data/user/settings/subagent.json`). O DeepTutor delega a uma instalação local do Claude Code ou do Codex CLI, que usa a assinatura do próprio usuário (subagente ACP, v1.7.3).

### 4.13 Shell, navegação e tema

- **AppShell** (`web/components/layout/AppShell.tsx`):
  - abaixo de 768 px, a sidebar vira drawer com `inert` quando fechada;
  - altura `h-dvh`;
  - `PRIMARY_NAV` reordenável pelo usuário (`web/components/sidebar/nav-entries.ts`).
- **Layouts Modern e Classic** (`web/features/ui-layout/types.ts`): padrão *Slots, Tokens e variantes CSS*. A estrutura (slots) é separada da aparência (tokens), o que permite trocar o "layout" sem duplicar componentes.
- **Temas** (`web/app/globals.css`), 4 conjuntos de tokens CSS:

  | Tema | Primária |
  |---|---|
  | Default/snow | azul |
  | Cream | terracota `#b0501e` |
  | Dark | `#d4734b` |
  | Glass | roxo `#a855f7` |

- **Tailwind com alpha sobre variáveis** (`web/tailwind.config.js`):

  ```js
  const alpha = name => `color-mix(in srgb, var(${name}) calc(<alpha-value> * 100%), transparent)`
  // colors: { border: alpha('--border'), primary: { DEFAULT: alpha('--primary'), ... }, ... }
  ```

  Assim `bg-primary/10` funciona com tokens CSS.
- **Fontes:** Geist (UI) e Lora (leitura/serif), em `web/app/layout.tsx`.
- **Ícones desenhados à mão** (`web/components/chat/home/StarterIcons.ts`):
  - fábrica `mark(name, shapes)` que gera SVGs **num grid de 16 px em 1:1**;
  - `strokeWidth 1.2`, `round` caps e joins, `currentColor`;
  - poucas formas por ícone.
  - O comentário explica que um set de 24 px escalado para 16 px deixa traços entre dois pixels e "amolece" a linha.
  - **É o template exato para o nosso set cel-shading.**
- **Orbe "pensando"** (`web/vendor/thinking-orbs/`, MIT): canvas com clock único, pausa offscreen e reduced-motion.
- **Lições de design registradas no código** (aplicam-se diretamente ao objetivo 8):
  1. A skin "mapa do tesouro em pergaminho" foi removida por parecer "cartoon". O estado é codificado por **forma** (preenchido → anel → contorno), não só por cor. Isso também é acessível para daltônicos.
  2. O mapa de rota ilustrado foi trocado por outline em lista, porque ilustração sem affordance atrapalha a navegação.
  3. O progresso usa cor de **tinta**; `--primary` só aparece no momento que significa algo (100%).
  4. Emoji escolhido pelo modelo foi substituído por um anel: "carried no information and read as clip art".
  5. O card de questão graduada (`web/components/chat/home/MasteryQuestionCard.tsx`) usa só um **fio na margem esquerda**, que vira primary ou destructive após a correção. Nada de banners coloridos.
  6. "Ideas for you" é **uma** linha gerada pelo backend, servida stale-while-revalidate (`StarterSuggestions.tsx`, `RESETTLE_MS 3500 × 10`), e não um feed.

---

## 5. (b) Empacotamento desktop e conexão com o backend

### 5.1 Visão geral

```
Electron main (apps/desktop/src/main.mjs)
 ├─ BrowserWindow 1360×920 (macOS: titleBarStyle hiddenInset)
 │   ├─ página "shell" local (src/index.html + renderer.js, CSP, splash/status)  ← única com preload/IPC
 │   └─ WebContentsView (partition "persist:deeptutor", sandbox, SEM preload)   ← carrega http://127.0.0.1:18802
 └─ fork → supervisor.mjs (rodando no Node 22.23.4 empacotado)
       └─ runtime.mjs (SourceRuntime)
            1. python -m deeptutor_cli.main init --non-interactive --home <data>
            2. availablePort(18801) → backend ; availablePort(18802) → frontend
            3. stageBundledWeb(): substitui __NEXT_PUBLIC_API_BASE_PLACEHOLDER__ no bundle Next
            4. spawn python -m deeptutor_cli.main serve --host 127.0.0.1 --port 18801
            5. waitReady(GET /health/ready)
            6. spawn node web/server.js (Next standalone) na 18802
            7. monitor de saúde a cada 10 s; 3 falhas seguidas → estado "failed"
```

### 5.2 Detalhes do shell (`apps/desktop/src/main.mjs`)

- **Segurança:**
  - a WebContentsView do app é **sandboxed e sem preload**, e a navegação fica travada na origem loopback;
  - links externos abrem via `shell.openExternal`;
  - o permission handler libera clipboard, e mídia passa por prompt.
- **Só a página shell tem IPC** (`src/preload.cjs`): `window.desktop = { status, restart, logs, onStatus }`.
- **User-Agent** marcado como `OpenDeepTutor/<versão> (macOS; arm64)`, para o frontend detectar que está no desktop.
- **Tema e idioma nativos:** o main observa `data/user/settings/interface.json` e sincroniza `nativeTheme` e o menu.
- **Menu "Core":** Restart, Install Core Update, Open Data e Logs.
- **Single-instance lock**, e upgrade transacional com *backup* e *rollback* do core.

### 5.3 Processos (`apps/desktop/src/processes.mjs`, `config.mjs`)

- `ProcessGroup`: em POSIX usa *process group* (`detached` com kill do grupo); no Windows usa `taskkill /T /F` para matar a árvore.
- Utilitários: `availablePort`, `probe` e `waitReady`.
- **Modos** (`config.mjs`):
  - `attach`: conecta a um backend já rodando;
  - `source`: roda do checkout;
  - `bundled`: runtime empacotado.
- Validação de que as URLs são **somente loopback**.

### 5.4 Runtime empacotado e updates (`apps/desktop/src/bundles.mjs`, `scripts/build-runtime.mjs`)

- **Build do runtime:**
  1. `git archive HEAD`;
  2. `uv python install` para obter o Python 3.12.13 standalone (python-build-standalone);
  3. `uv pip install -r requirements/full.txt`;
  4. `npm ci && npm run build` (Next standalone);
  5. cópia do standalone e "selagem".
- **Bundles de core assinados com Ed25519:**
  - `verifyManifest()` confere a assinatura do `runtime.json`;
  - `newerRuntime()` compara versões;
  - `installBundle()` instala.
  - O core (Python, backend e web) é atualizado **sem reinstalar o Electron**.
- **Empacotador:** `@electron/packager` 20.3.0, sem electron-builder.
- **Windows** (`apps/desktop/platforms/windows-x64/{target.mjs, installer.nsi}`):
  - NSIS **per-user** em `%LOCALAPPDATA%\Programs`, sem admin;
  - os dados ficam em `%LOCALAPPDATA%\Open DeepTutor` e **sobrevivem à desinstalação**;
  - não vi assinatura Authenticode configurada, então o build provavelmente sai sem assinatura (aviso SmartScreen).

### 5.5 Docker / Compose / Podman

- **`Dockerfile` multi-stage:**
  1. `frontend-builder` (node:22.23.4-slim em `BUILDPLATFORM`, cross-build);
  2. `python-base` (python 3.11-slim, com Rust para wheels nativas);
  3. `production` com **supervisord**, que roda backend e frontend como usuário não-root.
  - O uvicorn sobe `deeptutor.api.main:app` com `ws-max-size` derivado das settings e keep-alive de 300 s; o frontend roda `node /app/web/server.js`.
- **`docker-compose.yml`:**
  - `redis` 7.4;
  - `pocketbase` (auth e multiusuário);
  - `deeptutor`;
  - `sandbox-runner` endurecido: `cap_drop: ALL`, `read_only`, `pids_limit: 256`, memória de 1 GB. Executa o código gerado pelo modelo (`Dockerfile.runner`).
- **Outros arquivos de compose:**
  - `compose.yaml`: Podman rootless;
  - `docker-compose.dev.yml`: monta o fonte como somente leitura;
  - `docker-compose.ghcr.yml`: imagem publicada;
  - `compose.codex-oauth.yaml`: publica 1455/1457 para o callback OAuth.

### 5.6 Implicações para o learnharness (Next 16 + Electron + TS, sem Python)

- **Não precisamos do supervisor Python.** Mas o padrão "Electron main → supervisor → servidor Next standalone em porta loopback livre → health check → WebContentsView sandbox sem preload" é bom se o learnharness rodar o Next como servidor. Isso precisa ser confirmado no código do learnharness.
- **Vale copiar:**
  - `availablePort`/`waitReady`/`ProcessGroup`, incluindo o `taskkill /T /F` no Windows;
  - a separação entre página shell com IPC e app sem IPC;
  - a validação loopback-only;
  - o single-instance lock;
  - os dados em `%LOCALAPPDATA%` fora da pasta do app.
- **Opcional:** update de "conteúdo/core" assinado com Ed25519, separado do binário Electron. Útil para distribuir **pacotes de árvore de conhecimento** (domínios) assinados.

---

## 6. (c) Componentes e padrões portáveis

Todos são Apache-2.0, exceto onde indicado. "Esforço" é relativo à nossa stack (Next 16, React, TS, Electron e pi-agent-core).

| # | O quê | Onde | Como reaproveitar | Esforço |
|---|---|---|---|---|
| 1 | Layout radial em anéis com fatias proporcionais e treliça hex com jitter determinístico | `web/lib/memory-graph.ts` (`buildGraph`, `placeNodesInSlice`, `DEFAULT_LAYOUT`) | Reusar para a **visão de memória** (onde estou, fatos e evidências). Para a árvore de conhecimento grande, portar a matemática para canvas ou WebGL (PixiJS, Sigma.js) | M |
| 2 | Interação de grafo: pan com pointer capture, zoom no cursor (0,35–4), highlight por BFS de 2 saltos, travar no clique, toggles de camada | `web/components/memory/MemoryGraph.tsx` | Extrair a lógica de interação (hooks) e trocar o renderer | M |
| 3 | Memória em markdown com IDs ULID e footnotes de evidência | `web/lib/memory-graph.ts` (`parseDoc`, regexes) | Formato de persistência da nossa memória por domínio: legível, diffável e editável. Adotar `- fato [^n] <!--m_ULID-->` com `[^n]: fonte:id` | P |
| 4 | Runs de consolidação com modos update/audit/dedup, eventos incrementais `?since=`, cancel e **undo** | `web/components/memory/useMemoryRun.ts`, `MemoryRunPanel.tsx` | Job de consolidação no fim de cada sessão, com undo. A UI de progresso é portável | M |
| 5 | Journal: missão, handoff da última sessão, registros e `injected_context` visível | `web/lib/learning-journal-api.ts` | Card "Onde estou / Próximo foco" por domínio, mostrando o que entra no prompt | P |
| 6 | NextStep tipado (probe/teach/practice/assess/review/complete) e gate de domínio | `web/lib/learning-api.ts`, `web/components/space/learning/next-step-copy.ts` | Máquina de estados pedagógica por nó da árvore. Responde ao objetivo 9: sondar antes de ensinar e avaliar de forma qualitativa | M |
| 7 | Plano de revisão por tipo de conhecimento e retenção-alvo | `web/components/space/learning/ReviewTrail.tsx` | UI de "recall target" e intervalos-base. O agendamento real deve usar `ts-fsrs` | P |
| 8 | Sessão de prática "Recall first, then check" (again reenfileira) | `web/components/learning/practice/PracticeSession.tsx`, `web/lib/practice-api.ts` | Revisão de flashcards in-app antes de sincronizar com o Anki | P |
| 9 | ProgressRing hairline, cor de tinta, primary só a 100% | `web/components/space/learning/ProgressRing.tsx` | Copiar quase literal e ajustar o traço ao cel-shading | P |
| 10 | Confete em canvas com física (papel, lantejoula, serpentina) e reduced-motion | `web/components/space/learning/LevelUpCelebration.tsx` | Evento de *level-up*/XP e nó dominado. Disparar por **evento explícito**, não por diff | P |
| 11 | Fábrica de ícones SVG `mark(name, shapes)` em grid de 16 px | `web/components/chat/home/StarterIcons.ts` | Base do nosso set desenhado à mão (cel-shading): grid nativo, `currentColor`, stroke consistente, mais uma camada de "sombra chapada" | P |
| 12 | Heatmap anual com teclado e tabela por modelo (TTFT/TPS/cache) | `web/features/settings/components/UsageActivity.tsx`, `UsageSettingsSection.tsx`, `web/lib/usage-statistics.ts` (`activityCalendar`) | Tela de estatísticas leves (objetivo 6). Somar uma série de "minutos estudados/dia" | P |
| 13 | ContextBudgetChip (barra empilhada do contexto) | `web/components/chat/home/ContextBudgetChip.tsx` | Mostrar quanto da memória, da árvore e do perfil entra no prompt. Transparência da memória | P |
| 14 | Sandbox de HTML gerado com bridge `sendPrompt` e auto-altura | `web/lib/iframe-html.ts`, `web/components/video-lesson/VideoLessonViewer.tsx` | Widgets interativos das aulas (simuladores de eletrônica). Manter `sandbox="allow-scripts"` **sem** same-origin. Em Electron, somar CSP e `will-navigate` | P |
| 15 | Linkify de timestamps `[MM:SS]` → seek | `web/lib/reading-media-citations.ts` | Aulas que citam trechos de vídeo do YouTube | P |
| 16 | Player YouTube nocookie com polling do tempo | `web/components/reading/workspace/YouTubeReadingPlayer.tsx`, `web/lib/reading-video-sources.ts` | Player de vídeo do nó | P |
| 17 | Marcações de vídeo (key_point/question/review) | `web/components/watching/WatchingMarksPanel.tsx` | Gerar flashcards a partir de marcas | P |
| 18 | Kanban de objetivos com detalhe de evidências | `web/components/space/learning/LearningBoard.tsx`, `ObjectiveDetail.tsx` | Visão "board" de um ramo da árvore | M |
| 19 | Outline com trilho preenchido/anel/vazado | `web/components/space/learning/StudyOutline.tsx`, `ModuleOutline.tsx` | Visão lista de um ramo, complementar ao grafo | P |
| 20 | Feed de eventos por revisão via WS, com dedup e ordenação | `web/lib/mastery-ws.ts`, `web/hooks/useMasteryPathActivity.ts` (`mergeEventBatch`) | Sincronizar a árvore e o progresso entre renderer, main e agente | P |
| 21 | Política de reconexão pura | `web/features/chat/transport/reconnect-policy.ts` | Copiar literal para o transporte do agente | P |
| 22 | Escopo de workspace: `scopedUrl`, evento de troca e remount por `key` | `web/lib/workspace-scope.ts`, `web/components/workspaces/WorkspaceRuntimeBoundary.tsx` | **Sessões por domínio** (Inglês ↔ Eletrônica) com isolamento total de estado | P |
| 23 | Contratos tipados gerados do schema do servidor | `web/contracts/`, `scripts/export_frontend_contracts.py` | Gerar tipos dos eventos do pi-agent-core em vez de manter à mão | P |
| 24 | Codex OAuth (PKCE loopback 1455/1457, catálogo ao vivo) | `web/lib/codex-oauth.ts`, `web/components/settings/CodexOAuthCard.tsx` | UI e máquina de estados do "Login com ChatGPT". No Electron, o callback loopback roda no main process. Conceito do CSSwitch (MIT) | M |
| 25 | Opções de LLM vindas do backend (sem hardcode) | `web/lib/llm-options.ts` | Seletor de modelo por tarefa e reasoning effort | P |
| 26 | Subagentes locais Claude Code/Codex | `web/features/settings/navigation/settings-nav.ts` (`agent-claude-code`, `agent-codex`) | Rota legítima para usar a assinatura Anthropic: delegar à CLI oficial local em vez de reaproveitar o OAuth | M |
| 27 | Import de histórico (Claude Code, Codex, ChatGPT) via File System Access | `web/lib/chat-import/` | Semear a memória de um domínio com conversas antigas | M |
| 28 | Tokens de tema e alpha via `color-mix` | `web/app/globals.css`, `web/tailwind.config.js` | Base dos temas cel-shading (claro/escuro) com `bg-primary/10` funcionando | P |
| 29 | Slots, tokens e variantes de layout | `web/features/ui-layout/types.ts` | Separar estrutura de skin | P |
| 30 | AppShell responsivo (drawer com `inert`, `h-dvh`, nav reordenável) | `web/components/layout/AppShell.tsx`, `web/components/sidebar/nav-entries.ts` | Shell do app | P |
| 31 | Thinking orb em canvas | `web/vendor/thinking-orbs/` (**MIT**, Jakub Antalik) | Indicador "pensando" leve | P |
| 32 | Card de questão com fio na margem | `web/components/chat/home/MasteryQuestionCard.tsx`, `web/lib/mastery-question.ts` | Pergunta pontual inline, sem "prova" | P |
| 33 | Supervisor de processos e portas loopback no Electron | `apps/desktop/src/{processes,runtime,config}.mjs` | Se o learnharness precisar de servidor Next ou worker, copiar `availablePort`/`waitReady`/`ProcessGroup` | P |
| 34 | Bundles assinados com Ed25519 | `apps/desktop/src/bundles.mjs` | Distribuição assinada de **pacotes de domínio** (árvores e aulas) | M |
| 35 | Blocos de livro (flashcards, quiz, interactive, timeline, concept_graph) | `web/lib/book-types.ts`, `web/app/(workspace)/learning/books/components/blocks/*` | Schema de "lição" por nó. A lista de tipos de bloco já é um bom vocabulário | M |

### 6.1 Notas de implementação dos itens-chave

**Grafo de memória** (adaptar para "onde o aluno está"):

1. Os anéis viram camadas semânticas. Exemplo: centro = perfil e foco atual; anel médio = fatos e fraquezas por domínio; anel externo = evidências (tentativas, sessões, cards).
2. Fatia angular por cluster: `share = max(minFloor, count/total)`, normalizada, com `clusterGap` entre fatias.
3. Nós dentro do setor:
   - `densityCell = sqrt(sliceArea / count)`;
   - `rows = round(thickness / densityCell)`;
   - colunas por linha proporcionais a `rowMidR`;
   - jitter por hash multiplicativo de Knuth (`2654435761`).
4. Arestas fortes ligam fato → evidência específica. Arestas suaves ligam síntese → âncora sintética no centróide. A âncora é invisível mas fica na adjacência.
5. Hover faz BFS até 2 saltos e esmaece o resto. Clique trava. Os toggles por camada filtram.

**Árvore de conhecimento** (nosso objetivo 1; o DeepTutor **não** tem isso em escala):

- Usar o *modelo de dados* deles como ponto de partida: `MapKnowledgePoint` com `type`, `prerequisite_ids`, `status`, `mastery`, `threshold`, `gate`, `deferred` e `override_note`.
- Somar o que falta: `level` (fundamentos → PhD), `estimated_hours`, `resources[]` (aula IA, capítulo de livro, vídeo YT com idioma e legenda) e proveniência da expansão procedural.
- Renderizar com zoom semântico: domínio → área → módulo → nó. Reaproveitar o ProgressRing por cluster e o rail preenchido/anel/vazado por estado.

**Flashcards → Anki/Obsidian** (objetivo 4): o DeepTutor só exporta `.txt`. O nosso deve:

- usar **AnkiConnect** (`addNotes` e `findNotes` por GUID estável = ULID do card);
- e/ou gerar `.apkg` com genanki ou um equivalente TS;
- e/ou escrever markdown no formato do plugin *Obsidian Spaced Repetition* ou *Obsidian_to_Anki*.

O DeepTutor serve de referência só para a *UI* de revisão (item 8) e para os blocos de flashcard (item 35).

---

## 7. (d) O que evitar

1. **Clonar a superfície inteira.** O DeepTutor tem chat, deep solve, deep research, co-writer/notebook, books, mastery, practice, reading, watching, video lessons, partners/IM, MCP, task board, calendar, multiusuário (PocketBase) e sandbox runner. São 1.747 arquivos só no `web/`.
   - É o oposto de "app de estudo limpo".
   - Pegar **padrões e componentes**, não a arquitetura de produto.
2. **Backend Python e supervisor duplo.**
   - Para nós (TS e pi-agent-core), um segundo runtime (Python 3.12 com venv e uv) multiplica tamanho, superfície de update e falhas de boot. O monitor de saúde deles existe justamente por isso: 10 s de intervalo e falha após 3 perdas.
   - Manter tudo no processo Node/Electron.
3. **Grafo em SVG para escala grande.**
   - Funciona com uns 2.000 nós.
   - Com 10⁴ nós ou mais, e animação, o DOM SVG trava.
   - Usar canvas/WebGL com *level-of-detail* e virtualização.
4. **Celebração detectada por diff no cliente.** Em `MasteryStudy.tsx` o "mastered" é inferido comparando snapshots. Isso é frágil (pode duplicar ou perder o evento). Emitir eventos de domínio explícitos (`node.mastered`, `xp.awarded`).
5. **Polling.** O player do YouTube faz polling de 250 ms, e os runs de memória fazem polling de `/events?since=`. Preferir eventos (`onStateChange` e IPC push) quando possível.
6. **Anki como `.txt`.** Export manual quebra o objetivo de "integrado". Ver §6.1.
7. **Skin ilustrada sem affordance.** Eles mesmos removeram o "mapa do tesouro" e o mapa de rota ilustrado.
   - Cel-shading deve ficar nos **ícones, ilustrações pontuais e tokens**, não em metáforas visuais que escondem a estrutura.
   - Estado por forma e não só por cor.
8. **Muitas configurações expostas.** O menu de Settings tem 17 seções: General, Workspace, Data migration, Appearance, Usage, Providers, LLMs, Task models, Embedding, Search, Voice, Multimodal, Conversation, Attachments, Video, Progress e Memory. Para nós, a configuração avançada deve ficar escondida.
9. **Profile "global" e "por tópico" sem fonte única da verdade.** São dois perfis (conta e tópico), com risco de divergência. No nosso caso, uma camada global mais deltas por domínio.
10. **Avaliação de memória só sintética.** `examples/memory_evaluation/` compara histórico recente bruto, ablação léxica top-2 e snapshots L3.
    - Parâmetros: budget de 512 tokens (cl100k), EM/F1 e `source_id_recall`.
    - Usa **casos sintéticos** e não declara resultado de benchmark.
    - Não citar como "SOTA". Se quisermos avaliar, usar o harness como esqueleto de metodologia (budget fixo, recall de fonte) com dados reais anonimizados.
11. **Build Windows sem assinatura e Electron 45 com `@electron/packager`.** Avaliar electron-builder ou Forge com assinatura e auto-update se formos distribuir.
12. **`allow-same-origin` em iframes de conteúdo gerado.** Eles acertam ao **não** usar. Não regredir.
13. **Interpolar `?dt_workspace` em toda URL.** Funciona na web, mas no Electron é mais limpo resolver o domínio ativo no main/IPC ou em partições por domínio, e não espalhar query params.

---

## 8. Mapeamento aos 9 objetivos do nosso app

| Objetivo | O que o DeepTutor oferece | Gap e recomendação |
|---|---|---|
| 1. Árvore massiva por domínio, fundamentos → PhD, com aulas, livros e vídeos | Modelo `MapKnowledgePoint` (pré-requisitos, tipo, gate), livros com Spine e concept_graph, blocos ricos, vídeo YT | Sem escala nem expansão procedural nem verificação formal. Usar o modelo de dados e construir renderer WebGL e pipeline de expansão próprio. Lean 4 fica fora do escopo deles |
| 2. Memória SOTA "onde está, para onde vai, fraquezas" | Memória L1/L2/L3 com citações, consolidação com undo, journal (missão, handoff, `injected_context`), ContextBudgetChip, grafo radial | **Melhor referência do conjunto para UX de memória.** Somar "fraquezas" explícitas (erros recorrentes por nó, a partir de `LearningEvidence`) |
| 3. Sessões isoladas por domínio | Workspaces com `scopedUrl`, remount por `key` e evento pré-troca | Copiar o padrão. No Electron, considerar uma partição de sessão por domínio |
| 4. Flashcards → Anki/Obsidian no fim da sessão | Blocos de flashcard, prática SRS, export `.txt` do Anki, Obsidian só como fonte | Implementar AnkiConnect, `.apkg` e markdown para o Obsidian. Reusar a UI de prática |
| 5. Nível, XP e ranking por Monte Carlo | Só confete e anéis | Nada a portar além do confete e do anel |
| 6. Estatísticas leves (tokens por modelo, horas/dia) | Tabela por modelo (tokens, cache, TTFT, TPS) e heatmap anual | Copiar. Somar "tempo de estudo ativo" (foco e visibilidade) |
| 7. IA por assinatura, sem modelo hardcoded | Codex OAuth (PKCE 1455/1457) com catálogo ao vivo; `llm-options`; subagentes Claude Code e Codex locais | Copiar o fluxo e a UI. Para Anthropic, preferir delegar à CLI e Agent SDK oficial local |
| 8. UI cel-shading limpa e SVGs à mão | `mark()` em grid de 16 px, tokens com color-mix, 4 temas, lições "forma > cor" e "tinta > primary" | Usar como disciplina de design. O estilo cel-shading em si é nosso |
| 9. Didática sem "enxurrada de perguntas" | `probe_first`/`teach_first`, NextStep, gate qualitativo, quick checks esparsos, "Recall first, then check", outline feito na 1ª sessão | Adotar NextStep e gate. Limitar perguntas por bloco (uma "quick check" por página) |

---

## 9. Licença e conformidade

- **DeepTutor: Apache-2.0** (`LICENSE`). Para incorporar código no learnharness (AGPL-3.0):
  - Apache-2.0 é compatível com GPLv3/AGPLv3 só no sentido Apache → AGPL. O resultado combinado é distribuído sob AGPL-3.0.
  - Manter os avisos de copyright e uma cópia da Apache-2.0 (por exemplo em `THIRD_PARTY_NOTICES` do nosso repo).
  - Marcar os arquivos modificados (Apache §4(b)). Não há arquivo `NOTICE` na raiz; o que existe é `THIRD_PARTY_NOTICES.md`.
  - Apache-2.0 inclui concessão e retaliação de patentes, o que não conflita com a AGPL-3.0.
- **Componentes MIT** citados em `THIRD_PARTY_NOTICES.md`:
  - thinking-orbs (Jakub Antalik), vendorizado em `web/vendor/thinking-orbs/LICENSE`;
  - CSSwitch (conceitos de PKCE loopback e cache de catálogo);
  - hermes-agent.
  - MIT → AGPL é compatível; basta preservar o aviso.
- **Screenshots** de `assets/figs/` não devem ser reutilizados como assets nossos; servem só de referência.
- **Dependências de terceiros:**
  - BlockNote: o DeepTutor usa só `@blocknote/core` e `@blocknote/react` 0.56.0, que são MPL-2.0. Os pacotes `xl-*` (GPL/licença comercial) não são usados. Checar antes de adotar.
  - Mermaid, KaTeX, Cytoscape: MIT.
  - pdfjs: Apache-2.0.
  - epubjs: BSD.
- **Termos de serviço:**
  - O "Login com ChatGPT" para apps de terceiros é zona cinzenta nos termos da OpenAI. O DeepTutor faz isso adaptando o fluxo do Codex CLI.
  - Para Anthropic, a rota segura é **delegar à CLI e Agent SDK oficiais** instalados pelo usuário, como no subagente `agent-claude-code` do DeepTutor, e não reutilizar tokens OAuth de assinatura.

---

## 10. Apêndice A: endpoints REST e WS vistos no frontend

| Área | Endpoint |
|---|---|
| Memória | `GET /api/memory/overview` · `GET /api/memory/snapshot/{surface}` · `GET /api/memory/doc/L2/{surface}` · `GET /api/memory/doc/L3/{slot}` · `POST /api/memory/runs/start` · `GET /api/memory/runs/{id}` · `GET /api/memory/runs/{id}/events?since=` · `POST /api/memory/runs/{id}/cancel` · `POST /api/memory/runs/{id}/undo` |
| Mastery | `/api/mastery-paths/progress/{id}/{map,board,events?after_revision=,objectives/{oid},init-modules,import-from-book,generate-from-notebook,skip-question,redo}` · WS `/ws/mastery-paths` |
| Journal | `GET /api/learning-journal` |
| Prática | queue, check e review em `web/lib/practice-api.ts`, mais import CSV/XLSX |
| Notas | `GET /api/documents/{id}/flashcards/export` (Anki `.txt`) |
| KB | `POST /api/knowledge-bases/connect-obsidian` |
| Workspaces | `/api/settings/workspace/registrations` |
| Uso | `GET /api/settings/usage?year=&timezone=` |
| OAuth Codex | `/api/settings/providers/openai-codex/oauth/{status,start,cancel,complete}` mais refresh de modelos |
| Turnos | WS do protocolo v2.0 (`web/contracts/generated/turn-protocol.ts`) |
| Saúde | `GET /health/ready` (usado pelo supervisor desktop) |

## 11. Apêndice B: arquivos mais valiosos para abrir primeiro

1. `web/lib/memory-graph.ts` e `web/components/memory/MemoryGraph.tsx`
2. `web/lib/learning-api.ts` e `web/components/space/learning/{next-step-copy.ts, ReviewTrail.tsx, ProgressRing.tsx, LevelUpCelebration.tsx, StudyOutline.tsx, LearningBoard.tsx}`
3. `web/lib/workspace-scope.ts` e `web/components/workspaces/WorkspaceRuntimeBoundary.tsx`
4. `web/lib/iframe-html.ts`
5. `web/components/chat/home/{StarterIcons.ts, ContextBudgetChip.tsx, MasteryQuestionCard.tsx}`
6. `web/features/settings/components/UsageActivity.tsx` e `web/lib/usage-statistics.ts`
7. `web/lib/codex-oauth.ts` e `web/components/settings/CodexOAuthCard.tsx`
8. `apps/desktop/src/{main.mjs, runtime.mjs, processes.mjs, bundles.mjs}`
9. `web/tailwind.config.js` e `web/app/globals.css`
10. `web/features/chat/transport/reconnect-policy.ts`

---

## 12. Questões em aberto

1. O learnharness já roda o Next como servidor standalone dentro do Electron, ou usa export estático ou IPC? Isso decide se o padrão supervisor/porta loopback (§5) se aplica.
2. Se a memória do nosso app viver no pi-agent-core (TS), queremos o formato markdown com ULID e footnotes (diffável e editável) ou um store estruturado (SQLite) com export markdown?
3. Política de termos: o "Login com ChatGPT" em app de terceiros (fluxo do Codex) é aceitável para nós? Para Anthropic, delegar ao Claude Code ou Agent SDK local é suficiente?
4. Que lib de grafo para 10⁴–10⁵ nós com zoom semântico e estilo cel-shading: Sigma.js (WebGL), PixiJS custom ou Cytoscape com canvas (o DeepTutor já depende de cytoscape)?
5. BlockNote (MPL-2.0, com pacotes xl-* sob licença dual) é aceitável no nosso AGPL, ou usamos outro editor (TipTap/ProseMirror MIT)?
6. A legenda e dublagem PT de vídeos YT não existe no DeepTutor. Precisamos de pipeline próprio (transcript → tradução → TTS) ou basta legenda auto do YouTube?
