# DeepTutor (HKUDS): análise do núcleo para o nosso app de estudo

> **Escopo lido.** Repositório clonado em `_refs/DeepTutor` (commit `4c1e000d`, "release: v1.7.3", 2026-11-16). Lidos: `README.md`, `AGENTS.md`, `SKILL.md`, `CITATION.cff`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `pyproject.toml`, `requirements/`, `compose.codex-oauth.yaml`, `docs-for-dev/` (ARCHITECTURE, RUNTIME_DESIGN, DATA_STORAGE, CLAUDE_MODEL_SYNC, CONTAINERIZATION, workspaces, PRACTICE), `deeptutor/services/memory/**`, `deeptutor/learning/**`, `deeptutor/capabilities/mastery/**`, `deeptutor/agents/{question,research,notebook}`, `deeptutor/capabilities/{solve,obsidian}`, `deeptutor/services/{rag,codex_auth,llm,session,practice,learning_journal,provider_registry}`, `deeptutor/notes/anki_export.py`, `deeptutor_cli/provider_cmd.py`, `packages/chat-engine/**` e a estrutura de `tests/`.
>
> **Fontes externas.** Paper arXiv:2604.26962 v3 (lido por inteiro). Branch `eval` do GitHub, em `src/personalization/*`, que contém a implementação do *Trace Forest* descrito no paper. Metadados via `gh api`. Docs oficiais da OpenAI sobre "Sign in with ChatGPT" e a página de compliance do Claude Code.
>
> **Segurança.** Nenhum código do repositório foi executado. Só houve leitura.

---

## 0. Resumo executivo

O DeepTutor é a referência open-source mais madura (2026) de "tutor agêntico personalizado". Os dados de identidade estão na seção 1. As cinco respostas, em uma linha cada:

| Pergunta | Resposta curta |
|---|---|
| **(a) Memória** | Há **dois designs diferentes**. O *paper* descreve um **Trace Forest**: árvores de 3 níveis por sessão, todos os nós embedados e 3 agentes de memória (summary, weakness, reflection) escrevendo `memory.md`, `weakness.md` e `reflection.md`. Esse design só existe na branch `eval`. O **produto v1.7.3** usa uma memória **em markdown inspecionável, sem vector store**, em três camadas: L1 é trace JSONL e snapshot; L2 é um doc por superfície; L3 tem `recent`, `profile`, `scope` e `preferences`. A consolidação por LLM é **disparada pelo usuário** e cada bullet aponta para a evidência via footnotes. Os pontos fracos de verdade ficam no **Mastery Path**: gates, `error_records`, `forgetting_risk` e um agendador de repetição espaçada. |
| **(b) RAG** | O motor padrão é **LlamaIndex**: `SentenceSplitter` com 512/50, FAISS flat ou HNSW, híbrido **vetor + BM25 por RRF**, cross-encoder opcional e captions de imagem por VLM. Alternativas: **LightRAG** nativo (`lightrag-hku==1.5.7`, modo `hybrid`), LightRAG Server via HTTP, GraphRAG, PageIndex (citação por página) e outros. O **RAG-Anything** (MinerU + LightRAG) foi usado até a v0.6 e saiu na reescrita v1.0. O paper ainda o descreve. |
| **(c) Guided learning e questões** | O **Mastery Path** monta um outline de módulos com objetivos tipados (`memory`, `concept`, `procedure`, `design`). Cada objetivo tem um **gate duro**: 90% quantitativo para memory/procedure e explicação estilo Feynman para concept/design. A política escolhe o próximo objetivo, há probe-first ou teach-first e o agendador é inspirado em FSRS. O prompt pedagógico ataca diretamente o "explica rápido e despeja perguntas". A **geração de questões** roda em 3 fases: Explore (loop agêntico), Plan (templates) e Quiz (um loop por template com validação estrita). |
| **(d) Codex OAuth e providers** | Faz PKCE em loopback (portas 1455/1457) com o **client_id do Codex CLI**, troca o código em `auth.openai.com/oauth/token` e chama `chatgpt.com/backend-api/codex/responses` com `chatgpt-account-id`. O catálogo vem de `.../codex/models?client_version=` (ETag, filtro `visibility=="list"`). Isso **não é** o fluxo oficial "Sign in with ChatGPT" para apps open-source, que usa client dinâmico, escopo `chatgpt.tokens.use.direct` e `api.openai.com/v1/responses`. O LearnHarness já usa o fluxo oficial. O **Claude** entra via `claude-agent-sdk` usando o login do CLI `claude` instalado, e os modelos são descobertos com `get_server_info()`. |
| **(e) Reuso** | **Apache-2.0**, compatível com o nosso AGPL-3.0 (cópia de mão única, mantendo LICENSE e atribuição). Vale portar para TS: memória L2/L3 com ops e footnotes; os prompts de consolidação; `compute_mastery`, o scheduler e a política de gates; o prompt pedagógico do mastery loop; o pipeline de questões; o export Anki; o ledger de uso; os padrões de cache de catálogo. Como sidecar opcional: **LightRAG Server** (MIT, HTTP). Não vale portar o Codex OAuth via `backend-api` nem o stack Python inteiro. |

---

## 1. Identidade, licença e estado do projeto

**Repositório:** https://github.com/HKUDS/DeepTutor

- Descrição: "DeepTutor: Lifelong Personalized Tutoring".
- Números em 2026-11-18: **60.269 estrelas**, **7.301 forks** e 341 issues abertas.
- Último push: 2026-11-18. Release `v1.7.3` publicada em 2026-11-15.
- Branches de interesse: `main`, `dev`, `eval` (código do paper e do benchmark), `ts-exp` (motor TS experimental), `multi-user`, `guide2.0` e `Deeptutor-v0.6.0-archive`.

**Licença:** Apache-2.0 (`LICENSE`; `pyproject.toml` declara `license = {text = "Apache-2.0"}`).

`THIRD_PARTY_NOTICES.md` credita:

- **SuperJJ007/CSSwitch** (MIT, commit `4e0af6ba`). Daí vêm os conceitos do Codex OAuth: login PKCE em loopback, "auth generations", atualização atômica de credenciais, invalidação do cache de catálogo e estados de operação redigidos.
- **Hermes Agent** (MIT), pelos fluxos Feishu/WeCom.

**Paper:** "DeepTutor: Towards Agentic Personalized Tutoring" (Zhao, Zhang, Ren, Guo, Chu, Ma, Huang, HKU), arXiv:2604.26962 v3, 9 jul 2026. Link: https://arxiv.org/abs/2604.26962. Site: https://deeptutor.info.

**Tamanho:**

- Cerca de 122 mil linhas de Python em `deeptutor/` (1.179 arquivos `.py`) e 4.672 arquivos no total.
- 1.040 arquivos de teste. Existe cobertura dedicada para `services/memory`, `services/codex_auth`, mastery e learning journal.
- Python de 3.11 a 3.14.
- Frontend em Next.js App Router (`web/`), desktop em Electron (`apps/desktop`).

**Stack de dependências relevantes:** LlamaIndex, FAISS, `lightrag-hku==1.5.7`, graphrag 3.x, sentence-transformers (rerank), MinerU, Docling, PyMuPDF4LLM, markitdown, `claude-agent-sdk` e Typer (CLI). Os wheels são modulares (`deeptutor[full]`, `deeptutor-memory`, `deeptutor-mastery`, `deeptutor[rag-lightrag]` etc.).

---

## 2. Arquitetura geral

```
CLI (Typer) / WebSocket /ws / SDK Python
          │
   TurnApplicationService  (turnos duráveis, replay)
          │
      TurnEngine ── StreamBus por turno (eventos tipados)
          │
   ChatOrchestrator ── UnifiedContext ──► Capability (Level 2)
                                           │  usa Tools (Level 1)
                                           ▼
                          emit_capability_result()  (agents/_shared/capability_result.py)
                          + cost_summary do UsageTracker
```

**Modelo de plugins em dois níveis** (AGENTS.md, `docs-for-dev/ARCHITECTURE.md`):

- **Tools (Level 1).** O usuário pode ligar e desligar estas: `brainstorm`, `web_search`, `paper_search`, `zotero_search`, `reason`, `geogebra_analysis`, `imagegen` e `videogen`.
- **Tools condicionadas ao contexto.** Entram automaticamente quando faz sentido: `rag`, `read_memory`, `write_memory`, `read_source`, as tools de notebook, `exec`, `ask_user` e as tools de mastery.
- **Capabilities (Level 2):** `chat`, `ask_questions`, `deep_solve`, `deep_question`, `deep_research`, `visualize`, `math_animator`, `mastery_path` (Guided Learning), `immersive_reading` e `video_lesson`.

**Loop agêntico** (`deeptutor/runtime/agentic`: `run_agentic_loop`, `run_labeled_step`, `LabelProtocol`):

- Usa um protocolo de rótulos em texto (`THINK` / `TOOL` / `FINISH`) **e também** tool_calls nativos. Isso o torna robusto a modelos sem function calling.
- Os prompts ficam em YAML, em en e zh.

**Armazenamento:**

- SQLite mais arquivos sob uma *runtime home*.
- Arquivos principais: `data/user/chat_history.db`, `data/knowledge_bases/`, `data/system/user-secrets/<owner>/...`, `usage.sqlite3`.
- Settings ficam em `data/user/settings/*.json`; o `.env` é ignorado em produção.

**Workspaces** (`docs-for-dev/workspaces.md`):

- Cada "matéria" tem seu `.deeptutor/data/`, com banco de sessões, materiais, progresso e prática separados.
- Um **prompt de workspace** de até 10.000 caracteres é injetado em chat, solve, ask, guided learning, reading e visualize.
- **Ponto crítico:** a doc diz que a **memória continua compartilhada por conta e não é isolada por workspace** ("记忆 | 仍由账号共享，本次不按工作区隔离"). Para o nosso objetivo 3 (sessões isoladas por domínio), isso é uma lacuna que não devemos copiar.

---

## 3. (a) Memória para tutoria personalizada "lifelong"

### 3.1 Dois designs: o do paper e o do produto

| | **Paper / branch `eval`** (`src/personalization/*`) | **Produto v1.7.3** (`deeptutor/services/memory/*`) |
|---|---|---|
| Unidade | `TraceTree` por interação, com 3 níveis | Evento L1 (JSONL) e entidades de snapshot |
| Índice | `traces/index.json` (lean) mais `embeddings.json` (um vetor por nó) | **Sem vetores**, por decisão explícita ("deliberately not a hidden vector store") |
| Perfil | `memory.md` (D_s), `weakness.md` (D_w), `reflection.md` (D_r) | `L2/<surface>.md` e `L3/{recent,profile,scope,preferences}.md` |
| Quem escreve | 3 agentes ReAct em paralelo após **cada** sessão (auto) | Consolidador LLM em lotes, **disparado pelo usuário** no "Memory workbench" |
| Recuperação | `SearchTrace` (ANN por cosseno), `ListTraces`, `ReadNodes` | `read_memory` (concat do L3), injeção quando há `memory_references` e `recall.recent()` |
| Avaliação | TutorBench (seção 3.6) | Harness de dev (`evaluation.py`), **não é benchmark** |

**Conclusão de engenharia:** os resultados do paper, inclusive a ablação de "DPM", medem o Trace Forest. O produto atual trocou esse desenho por documentos markdown auditáveis e com proveniência. Os dois são úteis e podem ser combinados (seção 8).

### 3.2 Memória do produto (v1.7.3), em detalhe

**Layout** (`paths.py`), sob `memory_root()`, ou seja, `PathService.get_memory_dir()`:

```
trace/<surface>/<YYYY-MM-DD>.jsonl   # L1, append-only
L2/<surface>.md                      # 1 doc por superfície (+ <surface>.meta.json com ids "vistos")
L3/recent.md  L3/profile.md  L3/scope.md  L3/preferences.md
backup/                              # checkpoints de undo por execução
snapshot/state.json, changes.jsonl   # espelho do workspace (fingerprints)
```

**Superfícies:** `chat`, `notebook`, `quiz`, `kb`, `book`, `partner` e `cowriter`.

**L1 (trace e snapshot):**

- `TraceEvent{id, ts, surface, kind, payload, session_id, turn_id}`, com ids no formato `<surface>:<ULID>`.
- Todo turno principal de chat emite `TraceEvent("chat","query",{query[:2000], capability})` (em `session/turns/executor.py`, perto da linha 950). O serviço de RAG emite traces `kb/query`.
- O **snapshot** (`snapshot/adapters.py`) lê entidades do próprio app: sessões de chat com transcript completo (SQLite), tentativas de quiz (`notebook_entries`), notebooks, livros, KBs, partner e cowriter.
- O diff é feito por fingerprint (`state.json` e `changes.jsonl`). A memória não duplica dados; ela **aponta** para eles.

**Formato do documento** (`document.py`, parse e serialize puros):

```markdown
## Misconceptions
- Confunde corrente de malha com corrente de ramo em circuitos com fonte dependente [^1], [^3] <!--m_01JD...-->
## Struggling topics
- Errou 3 de 4 itens sobre polarização de BJT [^2] <!--m_01JE...-->

[^1]: chat:01JC...
[^2]: quiz:01JD...
[^3]: notebook:abc
```

**Ops validadas** (`ops.py`):

- `AddOp(section, text, refs)`
- `EditOp(target_id, new_text, new_refs)`
- `DeleteOp(target_id, reason ∈ {contradicted, superseded, stale, low-signal})`

Regras de validação:

- Os lotes são **atômicos**.
- `text` tem no máximo 240 caracteres e uma linha só.
- `section` tem no máximo 80 caracteres.
- `refs` não pode ser vazio e cada ref precisa ser válida.

**Consolidador** (`consolidator/modes/*`; LLM com temperature 0.2, max_tokens 1500, streaming com fallback para chamada completa):

- **`run_update`** faz extração incremental:
  1. Faz o diff dos ids "vistos" em `*.meta.json`.
  2. Concatena as entidades novas.
  3. Quebra em chunks com `chunk_with_boundary`. O budget é o número de chunks: `l2_budget=20`, `l3_budget=10`. Overlap 0.10, fronteira de parágrafo, chunks de 1.000 a 64.000 caracteres.
  4. Faz **uma chamada LLM por chunk**, que retorna `{"facts":[{text, section, refs}]}`.
  5. Valida as refs contra o pool de refs **local ao chunk**, o que evita citações inventadas.
  6. Roda auto-dedup (3 iterações) e auto-merge (colapsa footnotes, sem LLM).
- **`run_audit`** aplica replace, delete e insert por linha contra a evidência bruta completa.
- **`run_dedup`** só faz replace e delete.
- **`run_merge`** é determinístico.
- Cada execução cria um checkpoint de undo (`write_doc_checkpoint`).

**Prompts** (`consolidator/prompts/en/{update_l2,update_l3,audit_l2,dedup,_meta}.yaml`):

- **L2** cita `<surface>:<id>`. Proíbe palavras absolutistas: *deeply, truly, mastered, expert, passionate, loves, hates, always, never, fully understands*. Prefere frases verbais ("stuck on Z").
- **L3** usa como refs nomes de superfície sem id e **força um template de hedge**: "Across N <surface> interactions, the user X".

**Seções por superfície** (`_meta.yaml`):

| Superfície | Seções |
|---|---|
| chat | Misconceptions / Mastery / Topics |
| quiz | Error patterns / Strong topics / Struggling topics |
| kb | Interests / Frequent queries / Library gaps |
| book | Pacing / Sticking points / Annotation themes |
| notebook | Themes / Formats / Open questions |
| cowriter | Style / Recurring revisions / Topics |
| partner | Themes / Channels |

**Slots L3:**

- `recent`: This week / Earlier.
- `profile`: Identity / Learning style / Knowledge level.
- `scope`: Familiar / Practicing / Unsure.
- `preferences`: escrito **só** pela tool `write_memory`. Nunca é auto-consolidado e é deduplicado por texto normalizado.

**Recuperação e injeção:**

- A tool `read_memory` retorna a concatenação dos 4 docs L3. Ela só é montada se o L3 não estiver vazio (`agents/_shared/tool_composition.py::user_has_memory`).
- O executor de turnos injeta `read_l3_concat()` quando o cliente envia `memory_references` (em `_turn_runtime_shared._extract_memory_references`).
- `recall.recent()` e `recall.recent_queries()` alimentam as sugestões da home. A primeira usa os stamps do snapshot dos últimos 7 dias, até 20 itens, com `days_ago`. A segunda usa os traces de query de chat e kb.
- API: `api/routers/memory.py` com `/runs/start` (`mode ∈ update|audit|dedup|merge`). Os budgets vêm do subtree `memory:` em `main.yaml`.

**Prós:**

- Inspecionável e editável pelo aluno.
- Tem proveniência por bullet e undo.
- Nenhum embedding é necessário.
- O formato "fato curto com fonte" é ótimo para prompts.

**Contras:**

- Não é automático: depende de o usuário rodar o update.
- Compartilha a memória entre workspaces.
- Não tem busca semântica sobre o histórico.
- O L3 é um blob pequeno e não diz qual episódio exato gerou a fraqueza além das refs.

### 3.3 Trace Forest (paper e branch `eval`)

**Estrutura** (`trace_tree.py`, `trace_forest.py`):

- **Nível 1:** o nó raiz da sessão. É `question` no solve e `topic` na geração de questões, e guarda o input e um resumo global.
- **Nível 2:** as unidades de plano. É `step` no solve e `template` na geração.
- **Nível 3:** os registros finos. São `round` (tool output, evidência, validação) e `answer` (resposta do aluno com correto ou errado).
- Persistência:
  - `traces/<trace_id>.json`, a árvore completa.
  - `traces/index.json`, com linhas de trace (`trace_type`, timestamp, `root_text`, `tools_used`, stats) e linhas de nó com **snippet de 80 caracteres**.
  - `traces/embeddings.json`, no formato `{full_id: vetor}`, cobrindo **todos** os nós com texto.
- **Busca:** cosseno entre a query e o vetor do nó (`max(0, sim)`). O fallback lexical é substring ou interseção de tokens sobre o snippet. Pode filtrar por `level` e `trace_type`.

**TraceToolkit** (`trace_tools.py`). Os agentes de memória o usam por meio de ações JSON:

- `search_traces{query, trace_type?, level?, top_k?}` (padrão `top_k=5`)
- `list_traces{n?, trace_type?}`
- `get_trace_detail{trace_id[, short_id]}`, com truncamento em 6.000 caracteres
- `read_document`
- `write_document{filename, content, mode: overwrite|append}`

**Três agentes**, rodando em `asyncio.gather` após cada trace (`service.py::_run_memory_agents`). São ReAct com no máximo 6 rodadas e temperature 0.5:

1. **Summary agent** → `memory.md` (append, sem duplicar `trace_id`).
   - Entradas de 3 a 6 linhas: pergunta, caminho de solução (S1→S2, tools), achados.
   - Para quizzes, é **obrigatório** registrar acertos, erros e pulos e listar os tópicos errados.
2. **Weakness agent** → `weakness.md` (overwrite preservando tudo). As heurísticas são o ponto mais valioso:
   - **Sinal 1:** o que o usuário pergunta ou pede marca a fronteira do conhecimento dele. Tópicos recorrentes viram gap.
   - **Sinal 2 (cross-session):** se o sistema já explicou X e o usuário volta a perguntar X ou um subaspecto, existe uma "knowledge dead zone". Se o usuário errou Y em um quiz (nós nível 3) e volta a Y, existe um "persistent blind spot".
   - **Sinal 3:** localizar o gap na estrutura do KB (capítulo, pré-requisito faltando).
   - **Regra explícita:** **nunca** inferir fraqueza de internals do sistema, como número de rodadas, replans ou uso de tools.
   - **Formato do documento:** a seção `### Active` lista cada tópico com first seen, número de sessões, quiz stats (X questões, Y certas, Z erradas, P%), comportamento, cross evidence, localização no conhecimento e sessões relacionadas. A seção `### Resolved` traz a data e a evidência de resolução.
   - **Transição para Resolved:** acontece quando o aluno acerta o tópico em sessões recentes **e** para de perguntar sobre ele. É evidence-gated, sem limiar numérico (paper, D.6). O perfil move o conceito para `known_well`.
3. **Reflection agent** → `reflection.md`.
   - Cada entrada tem 3 a 5 linhas: Intent, Satisfaction (met, partially met, not met), Reason e Action.
   - Avalia a aderência a intenção, preferência e formato, e a repetição de perguntas.

**Injeção por papel** (`memory_reader.py`, *role-specific excerpting*):

| Papel | Recebe |
|---|---|
| planner | busca nos traces (top_k) e resumo do `weakness.md` |
| solver | linhas relevantes do `weakness.md` e notas de traces relacionados ao objetivo do passo |
| writer | últimas 15 linhas do `reflection.md` e resumo de weakness |
| idea / evaluator (questões) | busca **nível 1** (raízes de sessão) e weakness |
| generator (questões) | busca **nível 3** (padrões de resposta errada) |

**Parâmetros reportados:**

- `top_k=3` por papel e `SearchTrace` com padrão 5.
- Scratchpad de 6k tokens para o solver e 12k para o writer.
- Embedding compartilhado com o RAG: text-embedding-3-large (3072), Cohere embed-v4.0 (1024) ou jina-embeddings-v3 (1024).
- O orçamento total de tokens é particionado dinamicamente entre `C_rag` e `C_mem`.

### 3.4 Outras memórias no produto

1. **Learning journal** (`services/learning_journal`):
   - `LearningMission{topic, why, level}`
   - `LearningSessionNote{summary, next_focus}`, uma passagem de bastão entre sessões.
   - `LearningRecord{id, title, insight}`, no estilo ADR.
   - `injection_markdown()` coloca **Mission e Last session no system prompt de todo turno**. Os records não entram.
   - É atualizado pela tool `learning_update`.
   - Esse padrão de "onde estou e para onde vou" é barato e eficaz para o nosso objetivo 2.
2. **Memória do Mastery** (`capabilities/mastery/memory.py::MasteryContextBuilder`):
   - Histórico de até 20k tokens e resumo de até 4.096 tokens.
   - O resumo é um JSON com as seções `learner_state`, `preferences`, `open_items`, `teaching_history` e `source_anchors`.
   - As trocas antigas são arquivadas com id `hs-tutor-<msgid>` e podem ser recuperadas exatamente via `read_source`.
   - Uma busca binária escolhe quantas trocas antigas dobrar no resumo, e há backoff por truncamento.
3. **ContextBuilder geral** (`services/session/context_builder.py`):
   - Resumo rolante com `history_budget_ratio=0.35` da janela e `summary_target_ratio=0.40`.
   - Tetos `MAX_HISTORY_PLAN_TOKENS=131072` e `MAX_SUMMARY_OUTPUT_TOKENS=16384`.
   - Cada imagem é estimada em 4.096 tokens.
4. **`LearnerProfile` do Mastery** (`learning/models.py`):
   - Campos `prior_knowledge`, `target_level`, `time_budget`, `preferences`, `teaching_strategy` (`probe_first|teach_first`), `notes`, `teaching_preferences` e `teaching_observations`.
   - Cada `TeachingObservation` tem `basis` (`learner_report|tentative`) e `outcome` (`unknown|helped|not_helped`).
   - Regra do prompt: dificuldades inferidas ficam `tentative`, e "teaching, silence and unanswered cards do not prove understanding".

### 3.5 Como o sistema identifica pontos fracos: síntese

| Sinal | Onde | Natureza |
|---|---|---|
| Erros em quiz por objetivo; `ErrorRecord{status active→retrying→review→graduated}`, `ErrorType ∈ {structural, deviation, application, metacognitive}` | `learning/models.py`, `policy.py` | Determinístico |
| `compute_mastery` abaixo do gate; `learning_stage` (`practiced_with_help`, `partially_explained`…) | `learning/mastery.py`, `policy.py` | Determinístico |
| `forgetting_risk` alto (R baixo, atraso, erro ativo, lapsos) | `learning/scheduler.py` | Determinístico |
| L2 `quiz`: Error patterns / Struggling topics; L2 `chat`: Misconceptions; L3 `scope`: Unsure | `services/memory` | LLM com refs verificadas |
| Repetição de perguntas sobre o mesmo tópico e erro em nível 3 seguido de nova pergunta | `weakness_agent.yaml` (branch eval) | LLM com busca semântica |
| Capítulos fracos do livro (`supplement_for_weakness`) | `book/engine.py` | Progresso do livro |

### 3.6 Benchmarks

**Memória.** Não existe benchmark de memória publicado. `services/memory/evaluation.py` e `evaluation_rag.py`, junto com `examples/memory_evaluation`, compõem um harness de desenvolvimento:

- Compara os adapters `raw_recent`, `lexical_top2` e `native_l3_snapshot`.
- As métricas são exact-match e token-F1, com orçamento de 512 tokens (cl100k). Há baseline opcional dense + cross-encoder.
- O README do harness diz literalmente que são "development fixtures, not an independent benchmark".
- Nenhuma menção a LoCoMo, LongMemEval, mem0 ou letta.

**TutorBench (paper, seção 4 e apêndices C e D).**

Construção:

- 30 KBs universitários em 5 disciplinas, com 3 perfis cada (beginner, intermediate, advanced), totalizando 90 perfis.
- Cada perfil tem 3 tarefas, totalizando 270 tarefas.
- Cada tarefa tem 3 gaps ancorados em páginas. Os tipos de gap são misconception, incomplete understanding e missing knowledge.
- Tudo passou por revisão humana.

Protocolo:

- Um simulador de aluno em **primeira pessoa** (Gemini-3-Flash) conversa com o tutor.
- O juiz é Claude Sonnet 4.6, com temperature 0 e 3 notas por transcript.
- São 10 métricas de 1 a 5:
  - Lado do tutor: SF (fidelidade à fonte), PER (personalização), APP (aplicabilidade), VID (vivacidade) e LD (profundidade lógica).
  - Lado da prática: FIT, GND, DIV, ANS e CC.

| Sistema | SF | PER | APP | VID | LD | FIT | GND | DIV | ANS | CC | **OQ** | Δ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Naive Tutor | 3.22 | 4.24 | 4.44 | 3.89 | 3.99 | 3.20 | 2.46 | 2.83 | 3.87 | 3.12 | 3.53 | – |
| Self-Refine | 3.28 | 4.28 | 4.61 | 3.94 | 4.14 | 3.17 | 2.49 | 2.88 | 3.88 | 2.97 | 3.57 | +1.1% |
| ReAct Tutor | 3.35 | 4.37 | 4.40 | 3.70 | 3.96 | 3.16 | 2.47 | 2.75 | 3.94 | 3.07 | 3.52 | −0.3% |
| **DeepTutor** | 3.36 | 4.59 | 4.56 | 4.81 | 4.61 | 3.35 | 2.96 | 3.44 | 3.98 | 3.38 | **3.91** | **+10.8%** |

**Outros resultados:**

- **Ablação** (figura 9, só qualitativa no texto): sem SKG (RAG) cai sobretudo GND, SF e CC; sem DPM (memória) caem sobretudo **PER e FIT**; sem os dois, a queda é maior.
- **Alinhamento humano:** 45 sessões, Pearson r=0.82 (p=0.0038) entre as taxas de vitória de humanos e do juiz LLM.
- **Solver sem personalização** (investigate, solve, write) em HLE, GPQA-D, LiveBench, GAIA e AA-LCR: +29.4% relativo em média nos 5 backbones.
- **Limitações declaradas:** simulador LLM em vez de alunos reais, nenhum estudo longitudinal, e Book e Partners não avaliados.
- **Leitura crítica:** os ganhos vêm de um juiz LLM com rubricas. A métrica GND continua baixa (2.96 de 5), ou seja, as questões ainda são fracamente rastreáveis à fonte.

---

## 4. (b) RAG sobre livros e PDFs

### 4.1 Contrato e motores

**Protocolo:** `RAGPipeline` (`services/rag/pipelines/base.py`) com `initialize / add_documents / search / delete`. Cada KB fica presa a um motor.

| Motor | Essência |
|---|---|
| **LlamaIndex** (padrão) | Chunking, FAISS e híbrido BM25+vetor (seção 4.2) |
| **LightRAG nativo** (`lightrag-hku==1.5.7`) | KG mais vetores. Modos `naive/local/global/hybrid/mix`, padrão `hybrid`. Modelos por papel: `extract`, `keyword`, `query`, `vlm` (`lightrag/roles.py`). A política de blocos do MinerU descarta header, footer e page_number (`block_policy.py`) |
| **LightRAG Server** | Retrieval delegado via HTTP a uma instância externa |
| **GraphRAG** | microsoft graphrag 3.x |
| **PageIndex** | Retrieval por raciocínio dentro do loop agêntico, com **citações por página** (cloud ou OSS) |
| WeKnora, Tencent IMA, MarginNote 4, Kiwix ZIM, KB linkada, **Obsidian** | Conectores. O Obsidian lê e escreve no vault, só de forma aditiva (`capabilities/obsidian/vault.py`) |

**Histórico:** o **RAG-Anything** (MinerU + LightRAG, https://github.com/HKUDS/RAG-Anything, MIT) foi o motor da v0.4 à v0.6 e saiu na reescrita v1.0.0-beta.1 (2026-04-04). O paper ainda descreve o dual index KG+denso com RRF via RAG-Anything (seção 2.1.1 e D.6).

### 4.2 LlamaIndex (o que copiar de parâmetros)

**Chunking:** `SentenceSplitter(chunk_size=512, chunk_overlap=50)` dentro de `IngestionPipeline`, configurável (`llamaindex/config.py`, `ingestion.py`).

**Índice:** FAISS **flat** (exato, padrão) ou **HNSW** (`M=32`, `efConstruction=200`, `efSearch=64`).

**Busca híbrida padrão** (`retrievers.py`):

- `QueryFusionRetriever` com `mode=RECIPROCAL_RANK` sobre o retriever vetorial e o BM25.
- `_MatchedOnlyRetriever` descarta hits BM25 com score 0, ou seja, sem nenhum termo em comum.
- Cada retriever busca `2 × top_k` candidatos, com `top_k=5` como padrão.

**Rerank opcional:** `CrossEncoder` do sentence-transformers sobre até `rerank_top_k=50`.

**Multimodal:** cada imagem vira um `ImageNode` com legenda gerada por VLM de até 180 palavras.

**Antes do retrieval:**

- `exercise_lookup.py` tenta casar exatamente exercícios ("Exercício 3.2").
- Há filtro por escopo de documento.

**Query rewrite:**

- `query_rewrite.py` transforma a query em "standalone" e é fail-open.
- `smart_retriever.py` faz multi-query com agregação.

**Versionamento** (`index_versioning.py`):

- Os diretórios são `version-N`, cada um com `meta.json` e `EmbeddingSignature{binding, model, dimension, base_url, api_version}`.
- Um rebuild nunca destrói o índice em uso.
- Se o embedding mudar, a query é recusada até restaurar a configuração ou reindexar.

**Parsing** (`services/parsing`):

- Opções: text_only, MinerU (local ou cloud), Docling (local ou remote), markitdown, PyMuPDF4LLM, LiteParse (com fallback OCR) e Tika.
- Há cache em `data/parse_cache`.
- `lesson_evidence.py` prepara "pacotes de lição" de PDF ancorados na fonte e **falha fechado** se não houver evidência.

**Embeddings:** adapters `openai_compatible`, `openai_sdk`, `cohere`, `jina`, `gemini`, `dashscope`, `nvidia_nim` e `ollama`.

**Avaliação:** `deeptutor kb eval` calcula Recall@k, Precision@k, nDCG, MRR, MAP e Hit@k com casamento lexical. Há também `eval-diff` para comparar versões.

**Sync de fontes:** repositórios GitHub e sites de documentação com crawl limitado e re-sync a cada 24 h, por diff de hash.

---

## 5. (c) Guided Learning (Mastery Path) e geração de questões

### 5.1 Modelo de dados (`deeptutor/learning/models.py`, storage SQLite transacional em `learning/storage.py`)

```text
KnowledgeType  = memory | concept | procedure | design
ErrorType      = structural | deviation | application | metacognitive
LearningStage  = diagnostic → explain → feynman_check → practice → error_diagnosis → review → completed
KnowledgePoint { id, name, type, module_id, prerequisite_ids[], topic_source_ids[], required_visual_tasks[] }
LearningModule { id, name, order, pass_threshold=0.7, objective (frase de habilidade), knowledge_points[] }
QuizAttempt    { result: correct|partial|incorrect, voided, independent, ... }
ErrorRecord    { status: active|retrying|review|graduated, error_type, ... }
LearningEvidence { quality 0..1, hints_used, attempt_count, assessment_type: quiz|qualitative|review, source }
RepetitionState  { difficulty, stability, retrievability, desired_retention=0.9, review_count, lapse_count,
                   consecutive_correct/wrong, last_review_at, scheduled_after_failure, ... }
ReviewTask     { kp_id, due_at, forgetting_risk, reason }
ReviewStrategyTemplate { intervalos por tipo; ≤16 rodadas; ≤365 dias }
LearningProgress { modules, mastery_levels, qualitative_mastery, quiz_attempts, error_records,
                   learning_evidence, repetition_states, review_queue, learner_mastery_overrides,
                   deferred_objectives, explained_objectives, pending_question, version }
MasteryEvent (log de eventos com revision), MasteryPathLease (lock de escrita), TopicMetadata{goal}
```

### 5.2 Geração do outline (`learning/prompts/en.yaml`, `topic_generation.py`)

- O outline tem de 3 a N módulos e de 2 a 7 objetivos por módulo.
- Cada módulo traz uma frase de **objetivo em forma de habilidade**, e cada KP é tipado.
- **Todo documento selecionado tem de ser coberto.**
- O prompt do loop proíbe transcrever o sumário de um livro como módulos ("they are mastering a subject, not finishing a book").
- Revisões do outline são feitas por `mastery_revise` em duas etapas, preview e commit. Cada revisão é um **diff exato de JSON pointer** contra `path_revision`.
- `objective_relations.py` guarda pré-requisitos, mas **só como metadado estrutural**: eles ainda não bloqueiam o avanço.

### 5.3 Pontuação e gates

**`compute_mastery`** (`learning/mastery.py`). É a única fonte da matemática de mastery e foi feita para ser trocada por IRT ou BKT:

```python
_RECENCY_WEIGHTS = (0.5, 0.7, 0.85, 0.95, 1.0)   # últimas ≤5 tentativas, antiga→recente
_CONFIDENCE_CAP  = {1: 0.5, 2: 0.8}               # 1 tentativa ≤0.5; 2 tentativas ≤0.8
score = Σ w_i·clip(c_i,0,1) / Σ w_i ;  return min(score, cap[n])
```

**Política** (`learning/policy.py`):

- **Gates por tipo:**
  - `QUANTITATIVE_GATE[memory|procedure] = 0.9` (comentário no código: "Alpha School 90%").
  - concept e design passam por um gate **qualitativo**: explicação estilo Feynman julgada via `mastery_assess` (`passed: true`).
  - `required_visual_tasks` precisam ser demonstradas de forma **independente**.
- **`next_objective`**, em ordem de precedência:
  1. Pergunta pendente aguardando resposta.
  2. Revisão vencida.
  3. Primeiro KP não dominado na ordem do módulo, como probe ou teach conforme `teaching_strategy`.
  4. Completo.
- O aluno pode fazer override e deferral, e a proveniência fica exposta ("system" ou "learner").
- **Rótulos honestos de estágio:** `independently_demonstrated`, `practiced_with_help`, `practiced_not_demonstrated`, `partially_explained` e `not_yet_covered`.

**Correção** (`learning/grading.py`):

- Múltipla escolha: igualdade exata.
- Resposta curta de até 30 caracteres: `SequenceMatcher ≥ 0.85`.
- Resposta aberta: pelo menos 60% das palavras-chave.
- `semantic_assessment.py` julga contra **contratos imutáveis de questão** e verifica citações da fonte.

### 5.4 Agendador (`learning/scheduler.py::SpacedRepetitionScheduler`)

O docstring avisa que é "inspirado em FSRS, **não** um fit calibrado de FSRS". O replay determinístico de evidências é suportado (`rebuild_from_evidence`, `replay`).

**Constantes:**

- Intervalos padrão em dias: MEMORY `[0,1,3,7,14,30,60]`, CONCEPT `[3,7,14,30]`, PROCEDURE `[3,7,14]`, DESIGN `[14,28]`.
- Dificuldade inicial por tipo: memory 0.3, concept 0.4, procedure 0.5, design 0.6.
- `desired_retention` padrão 0.9, limitada entre 0.7 e 0.99.

**Fórmulas:**

```text
R(t) = exp(-Δt_dias / S)
S_from_interval(I, r) = max(0.5, I / -ln r);   I_from_S(S, r) = S · (-ln r)

qualidade q (se não explícita): correct 1.0 | partial 0.4 | incorrect 0
            q -= min(0.25, 0.08·hints) ; q -= min(0.20, 0.05·(tentativas-1))

D ← clip( D + 0.12·((1-q) - D) + 0.08·(R_prev - q), 0.05, 0.95 )

falha (q < 0.5):  S ← max(0.05, S_prev · (0.55 - 0.25·R_prev) · (1 - 0.25·D)) ; lapse++
sucesso:          qs = (q-0.5)/0.5
                  growth = 1 + qs·(1.35-0.6D)·(1 + 1.5(1-R_prev))·(1 + 0.15·min(Δt/S_prev, 4))
                  growth ×= 1.15 se q≥0.8 e 2 acertos seguidos
                  S ← max(0.5, S_prev·growth)
mesma sessão (Δt < 0.25 dia): não multiplica estabilidade
após falha: próximo intervalo = min(I, max(I·0.5, 0.1))

forgetting_risk = clip( (1-R) + min(atraso_dias/7, 0.25) + 0.2·[erro ativo] + min(0.1·lapses, 0.2), 0, 1 )
```

**Banco de questões / prática** (`services/practice/scheduler.py`, `docs-for-dev/PRACTICE.md`):

- Agendador estilo **SM-2** com as notas Again, Hard, Good e Easy.
- Ease inicial 2.5.
- Again agenda para 10 min, Hard multiplica por 1.2, Good dá 3 d e depois multiplica pelo ease, Easy multiplica por 1.3. O máximo é 365 d.
- Os eventos ficam guardados para um futuro FSRS.
- Importa xlsx, csv e json.

### 5.5 Pedagogia do loop (`capabilities/mastery/prompts/en/mastery_loop.yaml`): o mais relevante para o objetivo 9

Regras que atacam o padrão "explica rápido e despeja perguntas":

- **O gate é decidido pelo motor, não pela impressão do LLM.** Proibido dizer "última pergunta" antes de `mastered: true`.
- **"Not every round poses a question."** Quando o aluno pergunta ou comenta, o tutor responde e encerra o round. O que decide que chegou a hora de avaliar é o gate do objetivo, "nunca a sensação de que uma pergunta está devida".
- **Regra dos dois-pontos.** Se o texto do round termina em ":", o round precisa chamar `mastery_quiz`. Nunca terminar em "vamos tentar esta questão" sem a questão.
- **Concise but explanatory.**
  - Não substituir ensino por listas de nomes ou definições comprimidas.
  - Explicar o significado necessário mais **uma conexão ou exemplo concreto** antes de avaliar.
  - Não há cota de palavras nem pergunta obrigatória após cada passo.
  - Se o aluno disser que ficou curto demais, fornecer o elo que faltava em vez de outra versão igualmente comprimida.
- **Intake antes de desenhar.** Uma única mensagem via `ask_user` pergunta só o que os materiais não respondem: o que o aluno já sabe fazer, o que é "terminar", quanto tempo tem e como quer aprender. O tutor aceita respostas parciais e não insiste.
- **Probe-first vs teach-first.** O probe precisa registrar o resultado pelo gate (não é skip silencioso). O teach-first explica antes do check.
- **Mudar de abordagem em confusão repetida.** Trocar para outro exemplo, um pré-requisito, uma explicação espacial ou uma figura, em vez de só prometer simplificar. Nunca rotular o aluno globalmente a partir de uma dificuldade isolada.
- **Questões que discriminam:**
  - Cada distrator codifica uma misconception plausível.
  - Os distratores têm o mesmo comprimento e especificidade da alternativa correta.
  - As opções são embaralhadas, e o tutor nunca referencia uma letra.
  - `explanation` é obrigatória e aparece só após a correção, indo junto para o banco de questões.
  - "Design each question once": não reescrever infinitamente.
- **Grupos de 2 a 4 questões só a pedido do aluno**, cada uma com seu contrato de resposta.
- **`learner_profile` é contexto permanente.** Começar onde o conhecimento prévio do aluno indica, dimensionar a sessão ao tempo disponível e parar no nível pedido. Nunca ler o perfil de volta para o aluno.
- **Higiene de saída.** Proibido narrar internals ("Let me...", "I should first...").

**Tools do Mastery** (`capabilities/mastery/tools.py`, 4.012 linhas):

- Leitura e estado: `mastery_status` (working brief), `mastery_mode` (outline, study ou review), `mastery_paths`.
- Avaliação: `mastery_quiz`, `mastery_grade`, `mastery_assess`.
- Ensino registrado: `mastery_note_explained` (exige `explanation_quote` exata do que foi entregue), `mastery_prepare_lesson`.
- Controle de pergunta e objetivo: `mastery_skip_question`, `mastery_repair_question`, `mastery_defer_objective`.
- Outline e perfil: `mastery_build`, `mastery_revise`, `mastery_profile`.
- Navegação entre caminhos: `mastery_switch`, `mastery_leave`.

### 5.6 Geração de questões (`agents/question/pipeline.py`, 2.340 linhas)

**Fluxo:**

1. **Explore.** Loop agêntico `THINK/TOOL/FINISH` com as tools do chat (RAG, web etc.). Recebe o **histórico de quizzes anteriores** para cobrir pontos fracos.
2. **Plan.** Um passo PLAN que retorna templates JSON no formato `[{question_id, topic, question_type, difficulty}]`.
3. **Quiz.** Um loop por template. O FINISH tem de ser JSON estrito. Há um único reparo (one-shot repair) e cada questão aceita emite o evento `quiz_question_emitted`.

**Detalhes:**

- **`QuestionType`:**
  - `choice`: opções A–D, e a resposta é a chave.
  - `concept`: verdadeiro ou falso.
  - `fill_in_blank`: precisa conter o token `____`.
  - `short_answer`, `written` e `coding`.
- Dificuldade: easy, medium ou hard.
- A validação fica em `_collect_quiz_issues`.
- `mimic_source.py` imita provas existentes.
- Um tool-summarizer substitui os resultados brutos de tools para economizar contexto.

**Variante do paper:**

- Um **idea agent** gera ideias com base em C_rag, C_mem e erros passados: 5 ideias por rodada, até 3 rodadas.
- Um evaluator filtra e ranqueia por clareza, relevância e diversidade.
- O **generator** produz a tripla (q, a, e).
- Um **validator estruturalmente separado**, que não compartilha a cadeia de raciocínio, verifica alinhamento, fatos e pedagogia. Itens computacionais rodam em sandbox.
- Há até 2 regenerações com feedback estruturado.

### 5.7 Deep Solve e Deep Research (resumo)

**Deep Solve** (`capabilities/solve`):

- É o loop do chat mais um esqueleto determinístico de tools: `solve_plan`, `solve_finish_step` e `solve_replan`, com replans limitados.
- No paper: investigate → plan → solve passo a passo → escrita iterativa. Self-notes por passo, compressão hierárquica dos passos concluídos e no máximo 2 replans.
- O tom do writer se ajusta à ZPD: passo a passo para iniciantes, conciso para quem é proficiente.

**Deep Research** (`agents/research/pipeline.py`):

- Rephrase (com `ask_user`, até 3 rodadas).
- Decompose (OUTLINE com preview e confirmação).
- Blocos de pesquisa sobre uma fila dinâmica de tópicos.
- Relatório (OUTLINE, INTRO, SECTION, CONCLUSION) com `CitationManager`.
- Modos: `notes`, `report`, `comparison` e `learning_path`.
- Profundidade: quick, standard e deep geram 2, 4 e 6 subtópicos.

### 5.8 Flashcards e exportação (objetivo 4)

**`deeptutor/notes/anki_export.py`** gera um TSV com cabeçalhos do Anki 2.1.55+:

```
#separator:tab
#html:true
#notetype:Basic
#deck column:3
#tags column:4
#guid column:5
```

- O deck se chama `DeepTutor::<title>`.
- **GUID = card_id estável**, de modo que reimportar atualiza os cards em vez de duplicar.
- O Markdown é convertido para HTML, e `$..$` vira `\(..\)` (MathJax do Anki).

**Outras fontes de cards e notas:**

- Prompt de flashcards do livro (`book/prompts/en/flash_cards.yaml`): `{"cards":[{front, back, hint}]}`.
- Obsidian: tools `obsidian_search`, `obsidian_read`, `obsidian_list` e outras. O vault segue as convenções de frontmatter YAML, `[[wikilinks]]` e `#tags`. A escrita só acrescenta (criar, anexar, setar propriedade).

---

## 6. (d) Providers, OAuth do ChatGPT/Codex e listagem de modelos

### 6.1 Registro de providers

**`services/provider_registry.py`** (993 linhas) define `ProviderSpec` com:

- `backend ∈ {openai_compat, anthropic, azure_openai, openai_codex, github_copilot, codebuddy}`
- `is_oauth`

Os gateways incluem openrouter, deepseek, gemini, xai, anthropic, openai e `claude_code` ("Claude Code (subscription)"), entre outros.

**Listagem para provedores com API key** (`services/llm/cloud_provider.py::fetch_models`):

- Faz `GET {base_url}/models`, passa por `collect_model_names` e ordena com `prioritize_model_names`.
- A rota é `api/routers/settings.py::fetch_models_from_provider`.
- **Nenhum modelo é fixado no código.** O usuário escolhe por perfil, e há um "task model" para trabalho de fundo.

### 6.2 Codex OAuth como o DeepTutor implementa (`services/codex_auth/*`, 2.802 linhas)

**Constantes** (`constants.py`):

```text
issuer           https://auth.openai.com
authorize        https://auth.openai.com/oauth/authorize
token            https://auth.openai.com/oauth/token
revoke           https://auth.openai.com/oauth/revoke
client_id        app_EMoamEEZ73f0CkXaXp7hrann        (o client do Codex CLI)
scope            "openid profile email offline_access api.connectors.read api.connectors.invoke"
originator       codex_cli_rs
redirect         http://localhost:<1455|1457>/auth/callback
login timeout    300 s
models           https://chatgpt.com/backend-api/codex/models
responses        https://chatgpt.com/backend-api/codex/responses
CODEX_CLIENT_VERSION "0.153.4"   (+ descoberta da última versão em
                 https://registry.npmjs.org/@openai%2Fcodex/latest, timeout 3 s, cap 64 KiB,
                 só em sign-in/refresh)
catálogo         fresh 300 s, stale 86400 s, ≤512 modelos, ≤8 MiB; fallback "gpt-5.6-sol"
```

**Fluxo de login** (`oauth.py`, `service.py`):

1. `generate_pkce()`: o verifier é `secrets.token_urlsafe(64)` e o challenge é S256 (base64url sem padding).
2. `build_authorize_url()` monta os parâmetros:
   - `response_type=code`, `client_id`, `redirect_uri`, `scope`, `code_challenge`, `code_challenge_method=S256` e `state`.
   - `originator=codex_cli_rs`, `id_token_add_organizations=true` e `codex_cli_simplified_flow=true`.
3. `LoopbackCallback` escuta em **127.0.0.1 e ::1**, tentando as portas 1455 e depois 1457. O `state` é comparado em **tempo constante**.
4. Troca do código: `POST` form-encoded com `{client_id, grant_type=authorization_code, code, redirect_uri, code_verifier}`.
5. `decode_codex_jwt()` extrai `exp` e `https://api.openai.com/auth`.`chatgpt_account_id`.
6. Grava `CodexCredentials{schema_version=1, access_token, refresh_token, id_token, account_id, expires_at, generation}`:
   - A escrita é atômica, com lock e checagem de symlink e reparse point.
   - O caminho é `data/system/user-secrets/<owner>/private/openai-codex/`.
   - O código **nunca lê `~/.codex`**.
7. **Refresh:** acontece quando faltam menos de 300 s para expirar. É um `POST` JSON com `{client_id, grant_type=refresh_token, refresh_token}`. Um 400 ou 401 com `invalid_grant` exige novo login. O contador `generation` é incrementado para invalidar o catálogo e as leases antigas.

**Catálogo** (`catalog.py`):

- Requisição: `GET .../codex/models?client_version=<v>` com os headers `Authorization: Bearer`, `chatgpt-account-id` e `If-None-Match` (ETag).
- Mantém só os modelos com `visibility=="list"`, ordenados por prioridade.
- Campos usados: `slug`, `display_name`, `default_reasoning_level`, `supported_reasoning_levels`, `supports_reasoning_summary`, `supports_parallel_tool_calls`, `use_responses_lite` e `context_window`.
- Se a versão for rejeitada, há um único retry com a versão descoberta.
- O perfil gerado é somente leitura e preso ao dono: binding `openai_codex`, base `https://chatgpt.com/backend-api` e ids `llm-model-openai-codex-<sha16>`.

**Inferência** (`services/llm/provider_core/openai_codex_provider.py`):

```http
POST https://chatgpt.com/backend-api/codex/responses
Authorization: Bearer <access>
OpenAI-Beta: responses=experimental
originator: DeepTutor
User-Agent: DeepTutor (python)
accept: text/event-stream
chatgpt-account-id: <account_id>
session-id: <id da sessão>

{ "model": "<slug>", "store": false, "stream": true,
  "instructions": "<system>", "input": [...],
  "text": {"verbosity": "medium"},
  "include": ["reasoning.encrypted_content"],
  "prompt_cache_key": "<sha256(sessão)>",
  "tool_choice": "auto", "parallel_tool_calls": true,
  "reasoning": {"effort": "<nível>"},
  "tools": [{..., "strict": false}] }
```

- O SSE é lido por `openai_responses.consume_sse`.
- Um 401 dispara `recover_after_unauthorized` (refresh e uma nova tentativa).
- `max_tokens` e `temperature` são ignorados.
- `inference_guard` bloqueia o logout enquanto há inferência em curso.
- **Erros de cota nunca caem para um provider pago.**
- Os estados de operação expostos ao cliente são redigidos (sem tokens).

**Superfícies:**

- API: `/providers/openai-codex/oauth/{start,status,complete,cancel,logout}`.
- CLI: `deeptutor provider login openai-codex`. Ele imprime `redirect_uri`, `authorize_url` e `ssh_forward_command`, abre o navegador e faz polling de `public_status` até `completed`, `failed`, `expired` ou `cancelled`.
- Colar a URL manualmente funciona via `complete_login_with_callback_url`.
- No **Docker**, `compose.codex-oauth.yaml` publica temporariamente `127.0.0.1:1455` e `127.0.0.1:1457` para a porta do frontend.
  - O Next.js reescreve `/auth/callback` para um broker (`deliver_codex_oauth_callback`), que encontra o login pelo **state** (não há sessão no callback).
  - Em uso remoto o túnel é `ssh -N -L 1455:127.0.0.1:3782 user@host`.
- O status oficial no próprio README é **experimental**.

### 6.3 O fluxo oficial da OpenAI, e por que não copiar o do DeepTutor

A OpenAI documenta o **"Sign in with ChatGPT": token sharing para apps open-source** (https://developers.openai.com/siwc/token-sharing-open-source). Segundo o quickstart, o uso do plano está "aberto a todos os parceiros open-source", para usuários Plus e Pro.

**Diferenças em relação ao DeepTutor:**

- **Registro dinâmico de client.**
  - No primeiro login vão `client_id=dynamic_agent_client`, `agent_name_hint`, `ext_agent_host_id` (estável, por exemplo `urn:uuid:` UUIDv4) e `nonce`.
  - O callback devolve o `client_id` emitido (`oaiapp_...`), que é reutilizado depois.
- **Endpoints e escopos.**
  - Authorize: `https://auth.openai.com/api/accounts/authorize`. Token: `https://auth.openai.com/api/accounts/oauth/token`.
  - `resource=https://api.openai.com/v1`.
  - Escopos `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`. É preciso **verificar se `chatgpt.tokens.use.direct` foi concedido** antes de inferir.
- **Redirect.** Usa `http://127.0.0.1:<porta>/auth/callback` (127.0.0.1, não `localhost`).
- **Tokens.**
  - O access token vale 3600 s. O refresh token vale 30 dias e rotaciona a cada refresh.
  - A resposta inclui `earliest_refresh_at`.
- **Inferência.**
  - `POST https://api.openai.com/v1/responses` com `store:false` e `stream:true`.
  - **"Don't point this flow at ChatGPT's backend-api endpoints".**
  - Não aceita `temperature`, `top_p`, `metadata`, `user`, `truncation` nem `previous_response_id` via HTTP.
  - Não aceita mensagem com papel system: o system vai em `instructions`.
  - Não há tools hospedadas (image gen, file search, code interpreter, MCP hospedado).
- **Erros de cota.** Podem chegar como `response.failed`, com os códigos `subscription_sharing_usage_limit_exceeded` ou `subscription_sharing_usage_unavailable`.
- **Modelos.**
  - `GET https://api.openai.com/v1/models` com o mesmo bearer devolve um array `models`.
  - Filtrar `visibility=="list"`, exibir `display_name` e enviar `slug`. A ordem do servidor deve ser preservada.

**Para nós:** o LearnHarness já implementa esse fluxo oficial (ver `docs/research/lh-agent-providers.md`, com client dinâmico e `chatgpt.tokens.use.direct`). O caminho do DeepTutor reusa o client_id do Codex CLI e o `backend-api`, o que o deixa **frágil** (precisa de `client_version` e `originator` e quebra com mudanças da OpenAI) e **fora do contrato documentado**. O que vale aproveitar são os **padrões de engenharia** listados na seção 7, não os endpoints.

### 6.4 Claude (Anthropic)

**Como o DeepTutor faz** (`services/llm/provider_core/claude_code_provider.py`):

- Usa `claude-agent-sdk` dirigindo o **CLI `claude` instalado localmente**, com o login Pro ou Max do próprio usuário.
- `CLAUDE_CODE_MODELS` são os aliases `default`, `sonnet`, `opus` e `haiku`.
- A descoberta de modelos (`services/llm/claude_sdk.py::discover_models`, `docs-for-dev/CLAUDE_MODEL_SYNC.md`) abre um `ClaudeSDKClient` num diretório temporário, sem tools, e lê `get_server_info()["models"]`. **Não há inferência nem lista fixa.**

**Política da Anthropic** (https://code.claude.com/docs/en/legal-and-compliance, lido em 2026-11-18):

- O OAuth de assinatura serve ao uso "ordinário" do Claude Code e dos apps nativos.
- Desenvolvedores que constroem produtos, inclusive com o Agent SDK, devem usar **API key**.
- A Anthropic **não permite** que terceiros ofereçam login Claude.ai nem roteiem requisições por credenciais Free, Pro, Max ou Ultra em nome dos usuários.
- A página também diz que isso **não impede** o usuário final de fazer login no **binário Claude Code não modificado** com a própria assinatura.
- Há aplicação ativa da regra desde jan e fev de 2026; cobertura secundária: https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access.

**Para nós:** a abordagem atual do LearnHarness (`docs/claude-code.md`) é a mais defensável. O CLI é um provider externo opt-in, o usuário faz login fora do app, o app nunca vê credenciais e há um aviso explícito de que o uso exclusivo da assinatura não é garantido. A descoberta via `get_server_info()` serve como ideia para listar modelos sem hardcode, desde que o SDK TS exponha algo equivalente (questão em aberto).

### 6.5 Outros providers

- **GitHub Copilot:** device flow seguido de troca de token para `api.githubcopilot.com`, com headers `Editor-Version`.
- **CodeBuddy:** login pelo SDK.

### 6.6 Contabilidade de uso (objetivo 6)

**`services/llm/usage_ledger.py`** grava em SQLite `usage.sqlite3`, na tabela `llm_calls`:

- Identificação: model e provider.
- Tokens: prompt, completion, total, cache e reasoning.
- Desempenho: ttft, tokens/s e duração.
- **Nunca grava os prompts.**

**`services/session/usage_statistics.py`** faz os rollups `UsageTotals`, `ModelUsage` e `DailyUsage`. Todo `emit_capability_result()` carrega `cost_summary`.

O desenho cabe direto no que queremos: tokens por modelo e horas por dia, juntando com as durações de sessão.

---

## 7. Motor TypeScript (`packages/chat-engine`) e relação com o Pi

**O pacote:**

- `@deeptutor/chat-engine` 0.1.0, privado, Node 22 ou mais, **zero dependências de produção**, cerca de 3.400 linhas.
- É ativado pelo perfil experimental `DEEPTUTOR_CHAT_ENGINE=typescript-native`.
- Roda como processo filho do Python, falando por **IPC stdio**.
- Cuida do loop agêntico, das chamadas Chat Completions, do SSE, dos budgets de histórico e resumo rolante e dos lotes de tools.
- **A admissão nativa cobre só endpoints OpenAI-compatible Chat Completions.** Responses e OAuth (Codex) continuam no Python.

**Módulos:**

- Núcleo e sessão: `src/core/run-loop.ts`, `native/session.ts`.
- Contexto: `context/{conversation,history}.ts`.
- Providers: `providers/{chat-completions,sse,think-filter}.ts`.
- Tools: `tools/{dispatcher,read-memory,ask-user,workspace}.ts`.
- Transporte: `transport/stdio.ts`.

**Relação com o Pi.** O README documenta uma revisão do **Pi** (`earendil-works/pi@482c1381`, MIT), a mesma família do `@earendil-works/pi-agent-core` que o LearnHarness usa. Três regras foram adotadas:

1. Rejeitar o lote inteiro de tools quando a saída veio truncada.
2. Publicar resultados de tool logo, mantendo a ordem do transcript.
3. Só aceitar resumos "limpos" antes de mover o watermark de compactação.

Essas regras valem como checklist para o nosso loop.

---

## 8. (e) O que reutilizar no nosso app (TS/Electron, AGPL-3.0)

### 8.1 Licença

- **Apache-2.0 → AGPL-3.0:** a compatibilidade é de mão única (a FSF considera a Apache-2.0 compatível com GPLv3 e AGPLv3).
- **Ao portar código ou prompts:**
  - Manter o aviso de copyright e uma cópia da Apache-2.0 (por exemplo `third_party/deeptutor/LICENSE`).
  - Marcar os arquivos modificados.
  - Listar o que foi portado num `THIRD_PARTY_NOTICES` nosso.
- **Os prompts YAML também são Apache-2.0.** Traduzir ou adaptar conta como obra derivada, então a atribuição é obrigatória.
- **Dependências citadas:** LightRAG e RAG-Anything (MIT), CSSwitch (MIT), Pi (MIT) e ts-fsrs (MIT, https://github.com/open-spaced-repetition/ts-fsrs).

### 8.2 Tabela de reuso

| O quê | Onde (DeepTutor) | Como no nosso app | Esforço |
|---|---|---|---|
| Formato de memória markdown com ops, footnotes e ids `<!--m_ULID-->` | `services/memory/{document,ops,ids,store}.py` | Port TS puro (`lib/memory/doc.ts`, `ops.ts`). Validação com zod, mantendo os limites de 240 e 80 caracteres e refs obrigatórias | Baixo |
| Consolidador (update por chunk, ref pool local, dedup, audit, undo) | `services/memory/consolidator/**`, `prompts/en/*.yaml` | Port TS rodando **automaticamente no fim da sessão**, por domínio. Prompts traduzidos com atribuição | Médio |
| Seções por superfície e slots L3 | `consolidator/prompts/en/_meta.yaml` | Adaptar as superfícies para `lesson`, `quiz`, `flashcards`, `graph-node`, `chat` e `reading` | Baixo |
| Heurísticas do Weakness agent e formato de `weakness.md` | branch `eval`, `src/personalization/prompts/en/weakness_agent.yaml` | Virar o prompt do nosso "weak-points consolidator", com sinais ancorados nos **nós do grafo** em vez de capítulos | Baixo |
| Injeção por papel (planner, solver, writer, gerador) | branch `eval`, `memory_reader.py` | Montar `C_mem` por papel no prompt do agente de aula vs. do gerador de questões | Baixo |
| Learning journal (Mission + Last session no system prompt) | `services/learning_journal/{models,store}.py` | Implementar por domínio: "onde estou / para onde vou / next_focus" | Baixo |
| `compute_mastery` | `learning/mastery.py` | Copiar a fórmula (10 linhas). Depois trocar por BKT ou IRT calibrado, que também alimenta o Monte Carlo do objetivo 5 | Trivial |
| Política de gates e `next_objective` | `learning/policy.py` | Port para o motor de progresso por nó do grafo: memory/procedure ≥0.9 e concept/design via Feynman. Ligar o bloqueio por pré-requisito, que o DeepTutor ainda não faz | Médio |
| Scheduler de objetivos | `learning/scheduler.py` | Usar **ts-fsrs** para flashcards e as fórmulas do DeepTutor (ou FSRS) para `forgetting_risk` dos nós | Baixo |
| Prompt pedagógico do mastery loop | `capabilities/mastery/prompts/en/mastery_loop.yaml` | Adotar as regras da seção 5.5 no nosso system prompt de ensino (objetivo 9) | Baixo |
| Contrato de questão (opções `{label, body}`, `expected_answer` = corpo, `explanation` obrigatória, shuffle, distratores = misconceptions) | `mastery_loop.yaml`, `agents/question/pipeline.py::_collect_quiz_issues` | Schema zod da questão mais validador determinístico | Baixo |
| Pipeline de questões Explore → Plan → Quiz, com validator separado (paper) | `agents/question/pipeline.py`, paper seção 2.3 | Job TS com 3 etapas. O validator roda em outro modelo ou contexto | Médio |
| Grading determinístico | `learning/grading.py` | Port direto (SequenceMatcher pode virar Levenshtein ou ratio) | Trivial |
| Export Anki TSV com GUID estável | `notes/anki_export.py` | Port direto. Converter `$..$` em `\(..\)`; deck `<App>::<Domínio>::<Nó>` | Trivial |
| Convenções do Obsidian (frontmatter, wikilinks, só aditivo) | `capabilities/obsidian/vault.py` | Export de sessão como nota `.md` com `[[nó]]` e tags | Baixo |
| Ledger de uso | `services/llm/usage_ledger.py`, `session/usage_statistics.py` | Tabela SQLite `llm_calls` mais rollups diários (objetivo 6) | Baixo |
| Padrões do catálogo Codex (ETag, fresh/stale, filtro `visibility`, `generation`, inference guard, "quota não cai para pago", estado redigido) | `services/codex_auth/{catalog,service,contracts}.py` | Aplicar no nosso fluxo **oficial** SIWC já existente | Baixo |
| Parâmetros do RAG híbrido (512/50, BM25+vetor por RRF, `MatchedOnly`, rerank, `EmbeddingSignature` e versões) | `services/rag/pipelines/llamaindex/*`, `index_versioning.py` | RAG TS com SQLite FTS5 + sqlite-vec (ou LanceDB), RRF k=60 e assinatura de embedding por índice | Médio |
| LightRAG Server (grafo) | https://github.com/HKUDS/LightRAG (MIT) | **Sidecar opcional** via HTTP para modo grafo de livros grandes. Não é obrigatório | Médio (infra) |
| Regras do loop vindas do Pi | `packages/chat-engine/README.md` | Checklist de revisão para o nosso uso do pi-agent-core | Trivial |

### 8.3 O que NÃO reutilizar

- **Codex via `backend-api` com client_id do Codex CLI.** Fica fora do contrato oficial, e já temos o SIWC oficial.
- **O stack Python inteiro como sidecar.** São cerca de 122k linhas, mais FAISS, LlamaIndex e MinerU. O custo de empacotar com Electron é alto para pouco ganho.
- **Memória compartilhada entre workspaces.** Contraria o nosso objetivo 3.
- **Consolidação só manual.** Precisamos que seja automática no fim da sessão, com revisão opcional.

### 8.4 Desenho proposto (síntese para implementação)

```ts
// Memória por domínio (isolada) + perfil global mínimo
type Surface = "lesson" | "quiz" | "flashcards" | "chat" | "reading" | "graph";
interface MemoryEntry { id: string /*m_ULID*/; section: string; text: string /*≤240, 1 linha*/; refs: string[] /*"quiz:01J..."*/ }
interface MemoryDoc { surface: Surface | L3Slot; sections: Record<string, MemoryEntry[]> }
type L3Slot = "recent" | "profile" | "scope" | "preferences";
type MemoryOp =
  | { op: "add"; section: string; text: string; refs: string[] }
  | { op: "edit"; targetId: string; newText: string; newRefs?: string[] }
  | { op: "delete"; targetId: string; reason: "contradicted" | "superseded" | "stale" | "low-signal" };
// Layout: <userData>/domains/<domainId>/memory/{trace/*.jsonl, L2/*.md, L3/*.md, weakness.md, journal.json, backup/}
//         <userData>/global/memory/L3/{profile,preferences}.md

// Progresso por nó do grafo (reaproveita DeepTutor learning/*)
interface NodeProgress {
  nodeId: string; kind: "memory" | "concept" | "procedure" | "design";
  attempts: Array<{ ts: number; quality: number; hints: number; independent: boolean }>;
  mastery: number;            // compute_mastery
  gate: "quant90" | "feynman";
  rep: { D: number; S: number; R: number; lapses: number; lastReview: number; desiredRetention: number };
  errors: Array<{ type: "structural" | "deviation" | "application" | "metacognitive"; status: "active" | "retrying" | "review" | "graduated"; evidenceRef: string }>;
  stage: "not_yet_covered" | "partially_explained" | "practiced_with_help" | "practiced_not_demonstrated" | "independently_demonstrated";
}
```

**Fluxo de fim de sessão, assíncrono:**

1. Gravar a trace L1 da sessão.
2. Rodar o consolidador L2 da superfície (budget ≤ N chunks, refs locais).
3. Rodar o weakness pass, que lê os erros da sessão, os nós do grafo e o `weakness.md` anterior.
4. Atualizar L3 `recent` e `scope`.
5. Gravar `LearningSessionNote{summary, next_focus}`.
6. Gerar cards Anki e Obsidian a partir dos KPs ensinados.
7. Registrar o ledger de tokens e a duração.

**Injeção por papel:**

| Papel | Recebe |
|---|---|
| Tutor (aula) | L3 `profile` + `scope` + Mission/Last session + fraquezas ativas do nó atual (até 5) |
| Gerador de questões | `weakness.md` do nó e dos vizinhos + `ErrorRecord`s ativos + histórico de questões do nó |
| Planner do grafo | `scope` + `forgetting_risk` dos nós + `next_focus` |

---

## 9. Mapeamento aos objetivos do app

| # | Objetivo | Contribuição do DeepTutor |
|---|---|---|
| 1 | Grafo massivo por domínio, expandido por IA | `topic_generation` (módulos de 3 a N, objetivos de 2 a 7, KPs tipados), `objective_relations` (pré-requisitos como metadado), "spine + concept graph" do Book Engine e `lesson_evidence` (aulas ancoradas em PDF, que falham fechado). **Não há** grafo de 1000–1500 h nem verificação formal com Lean 4: isso é terreno nosso |
| 2 | Memória SOTA (onde estou, para onde vou, fraquezas) | Seções 3.2 a 3.5: L2/L3 com proveniência, journal com Mission e next_focus, weakness agent, error records e forgetting risk |
| 3 | Sessões isoladas por domínio | Workspaces (DB, materiais e progresso separados e prompt de workspace). **Evitar** a memória compartilhada |
| 4 | Flashcards Anki/Obsidian | `anki_export.py` (GUID estável) e as convenções do vault Obsidian |
| 5 | Níveis, XP e rankings por Monte Carlo | Fora do escopo do DeepTutor. Os insumos úteis são `compute_mastery`, R(t) e a log de evidências (replay), que podem alimentar simulações |
| 6 | Estatísticas leves | `usage_ledger` (tokens por modelo, ttft, tok/s) e `DailyUsage` |
| 7 | IA por assinatura, modelo não fixado | Catálogo dinâmico (`/models`, Codex catalog, `get_server_info()`). Usar o **SIWC oficial** para ChatGPT e API key ou CLI externo para Claude (seção 6.4) |
| 8 | UI cel-shaded | Nada a reaproveitar |
| 9 | Ensino não cansativo | Seção 5.5 é o achado mais valioso: o gate decide quando avaliar, nem todo round tem pergunta, regra dos dois-pontos, explicação mais exemplo, intake curto, mudar de abordagem, e sem cota de perguntas |

---

## 10. Riscos, lacunas e questões em aberto

1. **Paper ≠ produto.** Os números de memória (DPM) vêm do Trace Forest da branch `eval`, não da memória markdown da v1.7.3. Não há avaliação publicada do design atual.
2. **Benchmark sintético.** O aluno é simulado por LLM e o juiz é LLM. A correlação com humanos é boa (r=0.82), mas não há dado longitudinal de aprendizagem real.
3. **Pré-requisitos não bloqueiam** o avanço no Mastery Path. Para um grafo de 1500 h, precisamos de gating por pré-requisito, com override do aluno.
4. **O scheduler não é calibrado.** Para flashcards, ts-fsrs (FSRS-6 com parâmetros padrão e otimizável) é melhor.
5. **Política de assinaturas muda.**
   - OpenAI: o SIWC está em *preview* e há modelos descontinuados para sign-in.
   - Anthropic: a proibição de OAuth em terceiros está em vigor. Há relatos não oficiais de "Agent SDK credits" em 2026 que não foram confirmados nas páginas da Anthropic.
6. **Questões abertas:**
   - O SDK TS do Claude Agent expõe algo equivalente a `get_server_info()["models"]` para descobrir modelos sem inferência?
   - Qual é o desempenho do RAG TS (FTS5 + sqlite-vec) em comparação com LlamaIndex/FAISS nos nossos livros de eletrônica? Vale medir com as mesmas métricas de `deeptutor kb eval`.
   - Vale embedar os nós de trace, como no Trace Forest, ou basta ancorar a memória aos nós do grafo e usar a busca do próprio grafo?

---

## 11. Fontes

**Código** (leitura local, `_refs/DeepTutor`, commit `4c1e000d`):

- Memória: `deeptutor/services/memory/{paths,document,ops,store,trace,recall,settings,evaluation}.py`, `consolidator/modes/{_runtime,update}.py`, `consolidator/prompts/en/*.yaml`, `snapshot/adapters.py`.
- Aprendizagem: `deeptutor/learning/{models,mastery,policy,scheduler,grading,storage}.py`, `learning/prompts/en.yaml`.
- Mastery: `deeptutor/capabilities/mastery/{tools,memory}.py`, `prompts/en/mastery_loop.yaml`.
- Agentes: `deeptutor/agents/question/pipeline.py`, `agents/research/pipeline.py`, `capabilities/solve/*`, `capabilities/obsidian/vault.py`.
- RAG: `deeptutor/services/rag/pipelines/{base.py, llamaindex/*, lightrag/*, pageindex/*, graphrag/*}`, `services/rag/{query_rewrite,smart_retriever,index_versioning}.py`.
- Auth e providers: `deeptutor/services/codex_auth/{constants,oauth,contracts,catalog,client_version,service,storage}.py`, `services/llm/provider_core/{openai_codex_provider,claude_code_provider,github_copilot_provider}.py`, `services/llm/{cloud_provider,claude_sdk,usage_ledger}.py`, `services/provider_registry.py`.
- Sessão e jornal: `services/session/{context_builder,usage_statistics}.py`, `services/learning_journal/*`.
- Prática e notas: `services/practice/scheduler.py`, `notes/anki_export.py`.
- CLI e motor TS: `deeptutor_cli/provider_cmd.py`, `packages/chat-engine/README.md`.
- Docs: `docs-for-dev/{ARCHITECTURE,RUNTIME_DESIGN,DATA_STORAGE,CLAUDE_MODEL_SYNC,CONTAINERIZATION,workspaces,PRACTICE}.md`.
- Raiz: `compose.codex-oauth.yaml`, `THIRD_PARTY_NOTICES.md`, `LICENSE`.

**Externas:**

- DeepTutor: https://github.com/HKUDS/DeepTutor (gh api: Apache-2.0, 60.269 estrelas, release v1.7.3 de 2026-11-15) e https://deeptutor.info
- Branch `eval` (Trace Forest): https://github.com/HKUDS/DeepTutor/tree/eval/src/personalization (`trace_forest.py`, `trace_tree.py`, `trace_tools.py`, `memory_reader.py`, `service.py`, `prompts/en/{weakness,reflection,summary}_agent.yaml`)
- Paper: https://arxiv.org/abs/2604.26962 (v3, 2026-07-09)
- LightRAG: https://github.com/HKUDS/LightRAG (MIT; release v1.5.8rc1 de 2026-11-15)
- RAG-Anything: https://github.com/HKUDS/RAG-Anything (MIT) e https://arxiv.org/abs/2510.12323
- CSSwitch: https://github.com/SuperJJ007/CSSwitch (MIT)
- Pi: https://github.com/earendil-works/pi (MIT)
- ts-fsrs: https://github.com/open-spaced-repetition/ts-fsrs (MIT)
- OpenAI SIWC:
  - https://developers.openai.com/siwc/quickstart
  - https://developers.openai.com/siwc/token-sharing-open-source
  - https://developers.openai.com/siwc/token-sharing-open-source/sign-in
  - https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
  - https://developers.openai.com/siwc/token-sharing-open-source/token-reference
  - https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- Anthropic: https://code.claude.com/docs/en/legal-and-compliance e, como cobertura secundária, https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access
