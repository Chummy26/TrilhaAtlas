# Clew (miuuyy/Clew): análise para o fork learnharness

> Fonte: `https://github.com/miuuyy/Clew`, clone raso em `_refs/extra/miuuyy__Clew`, commit `56f224ffecb439552d2333a5c11015982f4f2c04` de 2026-11-16, versão 1.0.0.
> Licença: **MIT** (Copyright (c) 2026 Aleksandr Vechenkov).
> Método: só leitura. Nenhum install, build, script ou teste do repo foi executado. Todos os caminhos abaixo são relativos a `_refs/extra/miuuyy__Clew/`, exceto quando prefixados com `learnharness:`.
> Verificação web em 2026-11-18: li o cookbook oficial de Sign in with ChatGPT (`developers.openai.com/cookbook/articles/sign-in-with-chatgpt`), a página de produto (`learn.chatgpt.com/docs/sign-in-with-chatgpt`) e o README do DevKit (`github.com/openai/sign-in-with-chatgpt-devkit`). A cota de busca web desta rodada acabou, então não fiz buscas adicionais.

---

## 0. Resumo

O Clew é um workspace de estudo centrado num grafo. O modelo de IA nunca altera o grafo diretamente. Ele envia **propostas tipadas** (`upsert_topic`, `upsert_edge`, `upsert_zone`). O servidor valida cada proposta de forma determinística: DAG de pré-requisitos, conectividade, referências, URLs e estado inicial. Depois mostra um preview. Só o clique em **Apply** do usuário grava a mudança. O Apply é uma transação única que faz quatro coisas: confere a revisão, aplica, cria snapshot e grava um recibo idempotente. Rollback cria um novo snapshot, e as versões nunca regridem. A conclusão de um tópico ("closure") só acontece por quiz corrigido no servidor e com todos os pré-requisitos transitivos fechados.

O agente roda num loop próprio sobre a Responses API (`store:false`), autenticado por Sign in with ChatGPT (SIWC). As ferramentas `ask_question` e `present_quiz` **encerram o turno**. A resposta do aluno volta como dado estruturado num turno novo.

**Achado crítico para nós:** o learnharness **já tem** SIWC próprio (`learnharness:electron/chatgpt.cjs`, 542 linhas, mesmos scopes, `dynamic_agent_client`, `ext_agent_host_id`, `/v1/models` com `visibility:"list"`). Ele também já tem o padrão de pergunta que encerra o turno (`learnharness:src/agent/tool-execute.ts` `questionResult()` com `terminate: true`). Por isso o valor real do Clew para o nosso app está em quatro pontos:

1. **Protocolo de proposta e mutação do grafo de currículo**: contrato, validador, normalizador, transação apply/snapshot/recibo e rollback. Isso cobre o núcleo da meta 1.
2. **Quizzes de fechamento determinísticos e "fronteira" de tópicos prontos**: metas 1, 5 e 9.
3. **Montagem de contexto por turno com toggles de memória** e o prompt base com regras didáticas anti-"palestra": metas 2 e 9.
4. **Pequenos deltas de robustez no SIWC e na stream**: tabela de códigos de erro, quirks da rota plan-sharing, discovery OIDC validado, keyring. Isso cobre a meta 7.

**O que não portar:** o backend Python inteiro (vamos reescrever em TS), o canvas com física O(n²) (`GraphCanvas.tsx`) e o OAuth em si, porque o learnharness já o tem.

---

## 1. Licença e compatibilidade com AGPL-3.0

| Item | Licença | Compatível com o fork AGPL-3.0-only? |
|---|---|---|
| Código do Clew (`LICENSE`) | MIT | **Sim.** MIT é permissivo: pode ser incorporado a uma obra AGPL. É obrigatório manter o aviso de copyright e a permissão MIT nos arquivos portados ou num `THIRD_PARTY_NOTICES`. A obra combinada é distribuída sob AGPL. |
| Fontes `frontend/public/fonts/*` (Manrope, JetBrains Mono) | OFL 1.1 | Sim, com o arquivo OFL junto. Não é necessário para nós. |
| `desktop/licenses/remark-math-MIT.txt` | MIT | Sim. |
| `@phosphor-icons/react` (dep do frontend) | MIT | Sim, mas a meta 8 pede ícones desenhados à mão, então não usaremos. |
| **OpenAI SIWC DevKit** (`@siwc/local`, `@siwc/react`) | **"Sign-in with ChatGPT DevKit Noncommercial License v1.0"** | **Não vendorizar.** O ADR 0006 do Clew diz explicitamente que a implementação foi escrita do zero contra o protocolo documentado por esse motivo. O learnharness faz o mesmo ("Never import pi's bundled login"). |

Recomendação: ao portar trechos (validador, closure, layout), adicionar no topo `// Portions adapted from Clew (MIT) © 2026 Aleksandr Vechenkov` e registrar em `learnharness:THIRD_PARTY_NOTICES` (criar o arquivo se não existir).

---

## 2. Arquitetura do Clew

```
┌──────────── Electron 44 (desktop/main.cjs, protocol.cjs, preload.cjs) ────────────┐
│  renderer: React 19 + Vite, origem estável clew://app (ADR 0008)                  │
│     ├─ GraphCanvas.tsx (canvas 2D + física própria) / Graph3DCanvas.tsx (three)   │
│     ├─ useGraphChatController.ts ── NDJSON stream + replay por cursor             │
│     └─ AssistantThread / AgentInteraction (cards: proposta, pergunta, quiz)       │
│  main: encaminha /api/v1/* de clew://app → backend loopback (porta aleatória,     │
│        header x-clew-session = token por launch)                                  │
└──────────────────────────────────┬────────────────────────────────────────────────┘
                                   │ HTTP loopback
┌──────────────────────────────────▼──────────── backend Python (FastAPI) ──────────┐
│ app/main.py         middleware: token desktop + exige sign-in em /api/* (exceto  │
│                     /api/v1/chatgpt/*), CSP, no-store                             │
│ app/agent/          chatgpt_auth.py (OAuth PKCE + registro dinâmico + keyring)    │
│                     chatgpt_api.py  (Responses SSE, /v1/models)                    │
│                     runtime.py      (loop ≤24 passos, cards, interrupt, replay)   │
│                     tools.py / contracts.py / context.py / store.py               │
│ app/services/       proposal_service → proposal_normalizer → proposal_validator   │
│                     repository.py (snapshots, apply, rollback, quiz attempts)     │
│                     quiz_service.py (closure + correção), zone_style_service.py   │
│ app/mcp_server/     MCP read-only (list_graphs, get_current_learning_context,     │
│                     get_node, search_notes)                                       │
│ SQLite: graph_snapshots, graph_events, quiz_sessions, chat_sessions,             │
│         chat_messages, agent_sessions, agent_events, agent_transcripts,          │
│         agent_tool_results, proposal_applications                                 │
└───────────────────────────────────────────────────────────────────────────────────┘
          │ Bearer (token SIWC)                  ▲ OAuth callback http://127.0.0.1:<porta>/auth/callback
          ▼                                      │
   https://api.openai.com/v1/responses  ·  /v1/models  ·  https://auth.openai.com (OIDC)
```

Dependências do backend (`backend/pyproject.toml`): fastapi, uvicorn, pydantic 2, pydantic-settings, httpx, mcp, keyring, PyJWT[crypto].
Dependências do frontend (`frontend/package.json`): react 19, three 0.185, react-markdown, remark-gfm, remark-math, rehype-katex, katex, yaml, @phosphor-icons/react; vitest 4 e jsdom nos testes.
Electron: `electron 44.5.1`, `electron-builder 26.15.3`.

### 2.1 Endpoints HTTP relevantes (`backend/app/api/*.py`)

| Método e rota | Função |
|---|---|
| `POST /api/v1/graphs/{gid}/chat/stream` | inicia um turno e retorna NDJSON (`thread_state`, `message`, `turn_status`, `turn_completed`, `heartbeat`) |
| `GET /api/v1/graphs/{gid}/chat/events?session_id&after=` | replay e reconexão a partir do cursor `event_id` |
| `POST /api/v1/graphs/{gid}/chat/answer` | responde a um card (`interaction_id`, `answer` ou `choice_index`) e inicia um turno novo |
| `POST /api/v1/graphs/{gid}/chat/interrupt` | Stop; preserva cards não respondidos |
| `POST /api/v1/graphs/{gid}/normalize` | dry-run do validador sobre um `GraphProposalEnvelope` |
| `POST /api/v1/graphs/{gid}/apply` | Apply. Retorna 400 se inválido, 409 se a proposta estiver velha ou se o id for reusado com outro payload |
| `POST /api/v1/graph/rollback/{snapshot_id}` | interrompe runs ativos e cria um snapshot "rollback" |
| `GET /api/v1/graph/snapshots` | últimos 20 snapshots |
| `POST /api/v1/graphs/{gid}/topics/{tid}/quiz/start` | gera o quiz de fechamento: turno efêmero restrito a `read_graph`, `read_topic` e `create_closure_quiz` |
| `POST .../quiz/submit` | corrige no servidor e grava a tentativa e o snapshot na mesma transação |
| `POST .../mark-finished` | fechamento manual: marca o tópico **e todos os pré-requisitos transitivos** como `solid` |
| `GET/POST /api/v1/chatgpt/{account,login,login/cancel,logout}` e `GET /auth/callback` | SIWC |

---

## 3. Modelo de domínio (`backend/app/models/domain.py`)

- `TopicState = not_started | learning | shaky | solid | mastered | needs_review`. Um tópico conta como "fechado" quando está em `solid` ou `mastered`.
- `EdgeRelation = requires | supports | bridges | extends | reviews`. **Só `requires` é pré-requisito.** Para `requires`, `source` é o pré-requisito de `target`.
- `Topic {id, title, slug, description, difficulty: float, estimated_minutes: int, level: int, state, zones[], resources: ResourceLink[], artifacts: Artifact[], quiz_policy {question_count 6..12 (default 12), pass_threshold (0,1] default 0.75}, metadata}`
- `Edge {id, source_topic_id, target_topic_id, relation, rationale, weight=1.0}`
- `Zone {id, title, kind (texto livre: module/foundation/project), color '#rrggbb', intensity, topic_ids[]}`. A pertença é **bidirecional**, sincronizada entre `topic.zones` e `zone.topic_ids`.
- `StudyGraph {graph_id, subject, title, language en|uk|ru, version, topics, edges, zones, quiz_attempts, metadata}`
- `WorkspaceDocument {workspace_id, active_graph_id, config: WorkspaceConfig, graphs[]}`. **O snapshot guarda o workspace inteiro.**
- `WorkspaceConfig` tem `default_model` (null quer dizer o primeiro do catálogo do plano), `reasoning_effort`, `memory_mode` (`balanced` usa 32 mensagens, `max` usa 64, `custom`), `memory_include_{graph,progress,quiz,frontier,selected_topic}_context`, `quiz_question_count`, `pass_threshold`, `persona_rules` e `assistant_nickname`.
- `OperationType` no domínio inclui `remove_topic`, `remove_edge` e `set_mastery`, e o repositório sabe aplicá-los. Mas o **validador só aceita os três upserts** em propostas (`ALLOWED_PROPOSAL_OPERATIONS`). Ou seja, a IA não consegue apagar nada.

---

## 4. Contratos: `contracts/graph_patch.schema.json` e `contracts/clew_tools.schema.json` em Zod

### 4.1 Observações sobre os JSON Schemas originais

- `graph_patch.schema.json` ($id `https://clew.local/contracts/graph_patch.schema.json`, draft 2020-12) é o `GraphProposalEnvelope`. Campos obrigatórios: `base_graph_version` (int ≥ 1), `graph_id`, `mode` (`ingest_topics | expand_goal`), `operations`, `proposal_id` (minLength 1). `protocol_version` tem default `"2.0"`.
- `clew_tools.schema.json` é o array de 7 function tools da Responses API, todos com `strict:false`: `propose_ingest`, `propose_expand`, `ask_question`, `present_quiz`, `create_closure_quiz`, `read_graph` e `read_topic`. Os drafts usam `additionalProperties:false`.
- **O JSON exportado está desatualizado em relação ao código.** No JSON, a descrição de `ask_question` diz "Waits for their answer". No código (`backend/app/agent/contracts.py::tool_specs`) ela diz "Ends this reply; the learner's answer arrives from Clew in a new turn". **A fonte da verdade é `contracts.py`**, e o JSON é gerado por `backend/scripts/export_agent_contracts.py`.
- O que o JSON Schema não expressa e vive em `model_validator` do Pydantic:
  - Em `GraphOperationDraft`, `op`, `entity_kind` e o payload devem coincidir, e deve haver exatamente um payload.
  - `InlineQuizDraft` e `QuizQuestionDraft` exigem 4 escolhas distintas e índice correto em 0..3.
  - `str_strip_whitespace=True`: todas as strings recebem trim.
- No draft da ferramenta, `ProposalTopicDraft.state` é `string` livre. Já `ProposalTopic` do envelope usa o enum `TopicState`. Tópicos **novos** com estado diferente de `not_started` são rejeitados no validador. Para tópicos **existentes**, o estado é ignorado no apply, porque o upsert nunca altera `state`.

### 4.2 Zod 4 (o learnharness já tem `zod ^4.4.3` e `typebox ^1.3.27`)

Armadilhas do Zod 4 aplicadas aqui:

- **`.default(obj)` não re-parseia o objeto.** Para objetos aninhados que dependem dos defaults internos, use `.prefault({})`.
- Para detectar campo omitido (a semântica de edição parcial do Clew), o draft usa `.optional()` **sem** default.
- O equivalente a `str_strip_whitespace` é `z.string().trim()`.
- Para gerar o JSON Schema da tool, use `z.toJSONSchema(schema, { io: "input" })`, para que os campos com default saiam como opcionais.

```ts
// learnharness: src/core/curriculum/contracts.ts
// Portions adapted from Clew (MIT) © 2026 Aleksandr Vechenkov — contracts/*.schema.json + backend/app/agent/contracts.py
import { z } from "zod";

const s = () => z.string().trim();

export const TopicState = z.enum(["not_started", "learning", "shaky", "solid", "mastered", "needs_review"]);
export const EdgeRelation = z.enum(["requires", "supports", "bridges", "extends", "reviews"]);
export const ProposalMode = z.enum(["ingest_topics", "expand_goal"]);
export const ProtocolKind = z.enum(["graph_proposal", "apply_plan", "quiz_closure", "rollback"]);
export const ProposalOp = z.enum(["upsert_topic", "upsert_edge", "upsert_zone"]);            // contrato público
export const DomainOp = z.enum([...ProposalOp.options, "remove_topic", "remove_edge", "set_mastery"]); // só repositório
export const EntityKind = z.enum(["topic", "edge", "zone", "mastery"]);
export const ProposalStatus = z.enum(["proposed", "reviewed", "rejected", "applied"]);
export const ImpactLevel = z.enum(["low", "medium", "high"]);

// ---------- graph_patch.schema.json ($defs) ----------
export const ResourceLink = z.object({ id: s(), label: s(), url: s(), kind: s().default("reference") });
export const SourceLink = z.object({ label: s(), url: s() });
export const SourceTopicSeed = z.object({
  title: s().min(1).max(240),
  description: s().max(4000).default(""),
  estimated_minutes: z.number().int().nullable().default(null),
  testing_notes: s().max(4000).default(""),
  links: z.array(SourceLink).default([]),
});
export const ProposalTopic = z.object({
  id: s(), title: s(), slug: s(),
  description: s().default(""),
  difficulty: z.number().default(0),
  estimated_minutes: z.number().int().default(0),
  level: z.number().int().default(0),
  state: TopicState.default("not_started"),
  zones: z.array(s()).default([]),
  resources: z.array(ResourceLink).default([]),
});
export const ProposalEdge = z.object({
  id: s(), source_topic_id: s(), target_topic_id: s(),
  relation: EdgeRelation.default("requires"),
  rationale: s().default(""),
  weight: z.number().default(1),
});
export const ProposalZone = z.object({
  id: s(), title: s(), kind: s(),
  color: s().default(""), intensity: z.number().default(0.5),
  topic_ids: z.array(s()).default([]),
});
export const ProposalIntent = z.object({ user_prompt: s().default(""), target_goal: s().default(""), instructions: s().default("") });
export const ProposalSourceBundle = z.object({
  raw_text: z.string().default(""),
  source_items: z.array(SourceTopicSeed).default([]),
  grounding_enabled: z.boolean().default(true),
});
export const ProposalOpenQuestion = z.object({
  id: s(), kind: s(), message: s(),
  impact: ImpactLevel.default("medium"),
  suggested_resolution: s().default(""),
});
export const ProposalProvenance = z.object({
  model: s().default(""),
  grounding_used: z.boolean().default(false),
  generated_at: z.iso.datetime({ offset: true }).default(() => new Date().toISOString()),
  search_queries: z.array(s()).default([]),
  source_urls: z.array(s()).default([]),
});
export const GraphOperation = z.object({
  op_id: s(),
  op: ProposalOp,                     // use DomainOp no tipo interno PatchOperation
  entity_kind: EntityKind,
  status: ProposalStatus.default("proposed"),
  depends_on: z.array(s()).default([]),
  rationale: s().default(""),
  topic_id: s().nullable().default(null),
  edge_id: s().nullable().default(null),
  zone_id: s().nullable().default(null),
  state: TopicState.nullable().default(null),
  topic: ProposalTopic.nullable().default(null),
  edge: ProposalEdge.nullable().default(null),
  zone: ProposalZone.nullable().default(null),
});
export const GraphProposalEnvelope = z.object({
  protocol_version: s().default("2.0"),
  kind: ProtocolKind.default("graph_proposal"),
  workspace_id: s().default("default"),
  graph_id: s(),
  proposal_id: s().min(1),
  base_graph_version: z.number().int().min(1),
  mode: ProposalMode,
  intent: ProposalIntent.prefault({}),
  source_bundle: ProposalSourceBundle.prefault({}),
  summary: z.string().default(""),
  assistant_message: z.string().default(""),
  assumptions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  open_questions: z.array(ProposalOpenQuestion).default([]),
  operations: z.array(GraphOperation),
  provenance: ProposalProvenance.prefault({}),
});
export type GraphProposalEnvelope = z.infer<typeof GraphProposalEnvelope>;

// ---------- clew_tools.schema.json (drafts da IA; strict = extra:"forbid") ----------
const INLINE_CHOICES = 4;
const fourDistinct = (choices: string[]) =>
  choices.length === INLINE_CHOICES && new Set(choices.map((c) => c.trim().toLowerCase())).size === INLINE_CHOICES;

export const ProposalResourceDraft = z.strictObject({
  id: s().nullable().optional(), label: s(), url: s(), kind: s().default("reference"),
});
export const ProposalTopicDraft = z.strictObject({
  id: s().describe("Stable topic ID. Reuse an existing ID for an edit; choose a new ID for a new topic."),
  title: s(),
  slug: s().describe("Short URL-style topic name, for example linear-algebra."),
  // optional SEM default: omissão = "preservar valor existente" (ProposalService.prepare)
  description: s().optional(),
  difficulty: z.number().optional(),
  estimated_minutes: z.number().int().optional(),
  level: z.number().int().optional(),
  state: s().default("not_started"),
  zones: z.array(s()).default([]),
  resources: z.array(ProposalResourceDraft).default([]),
});
export const ProposalEdgeDraft = z.strictObject({
  id: s(),
  source_topic_id: s().describe("For requires, the prerequisite topic ID."),
  target_topic_id: s().describe("For requires, the topic that needs the prerequisite."),
  relation: EdgeRelation.default("requires"),
  rationale: s().default(""),
  weight: z.number().default(1),
});
export const ProposalZoneDraft = z.strictObject({
  id: s(), title: s(),
  kind: s().describe("A descriptive region type such as module, foundation or project. Free text, not an enum."),
  topic_ids: z.array(s()).default([]),
});
export const GraphOperationDraft = z.strictObject({
  op_id: s().min(1),
  op: ProposalOp,
  entity_kind: z.enum(["topic", "edge", "zone"]),
  rationale: s().default(""),
  topic: ProposalTopicDraft.nullable().optional(),
  edge: ProposalEdgeDraft.nullable().optional(),
  zone: ProposalZoneDraft.nullable().optional(),
}).superRefine((op, ctx) => {
  const entity = op.op.replace("upsert_", "") as "topic" | "edge" | "zone";
  const present = (["topic", "edge", "zone"] as const).filter((k) => op[k] != null);
  if (op.entity_kind !== entity || op[entity] == null)
    ctx.addIssue({ code: "custom", message: "Operation, entity_kind and payload must describe the same entity." });
  if (present.length !== 1)
    ctx.addIssue({ code: "custom", message: "An operation must contain exactly one entity payload." });
});
export const ProposalDraft = z.strictObject({
  base_graph_version: z.number().int().min(1),
  summary: s().min(1).describe("A concise description of the proposed graph change for user review."),
  assistant_message: z.string().default("")
    .describe("A message explaining the proposal. Format with standard single unescaped newlines. DO NOT output literal double-escaped '\\n' strings."),
  assumptions: z.array(s()).default([]),
  warnings: z.array(s()).default([]),
  open_questions: z.array(ProposalOpenQuestion).default([]),
  operations: z.array(GraphOperationDraft).default([])
    .describe("Graph edits. Each operation has one matching payload: upsert_topic/topic/topic, upsert_edge/edge/edge, or upsert_zone/zone/zone."),
});
export const QuestionDraft = z.strictObject({
  question: s().min(1).max(4000),
  choices: z.array(s()).max(6).default([]),
});
export const InlineQuizDraft = z.strictObject({
  question: s().min(1),
  choices: z.array(s()),
  correct_index: z.number().int(),
}).refine((q) => fourDistinct(q.choices), "inline quiz must contain exactly 4 distinct choices")
  .refine((q) => q.correct_index >= 0 && q.correct_index < INLINE_CHOICES, "inline quiz correct_index is out of range");
export const QuizQuestionDraft = z.strictObject({
  prompt: s().min(1),
  choices: z.array(s()),
  correct_choice_index: z.number().int(),
  explanation: z.string().default(""),
}).refine((q) => fourDistinct(q.choices), "quiz question must contain exactly 4 distinct choices")
  .refine((q) => q.correct_choice_index >= 0 && q.correct_choice_index < INLINE_CHOICES, "correct_choice_index out of range");
export const ClosureQuizDraft = z.strictObject({ topic_id: s(), questions: z.array(QuizQuestionDraft).default([]) });
export const ReadTopicArgs = z.strictObject({ topic_id: s() });
export const ReadGraphArgs = z.strictObject({});

export const TOOL_SCHEMAS = {
  propose_ingest: ProposalDraft, propose_expand: ProposalDraft,
  ask_question: QuestionDraft, present_quiz: InlineQuizDraft,
  create_closure_quiz: ClosureQuizDraft, read_graph: ReadGraphArgs, read_topic: ReadTopicArgs,
} as const;
export const CLOSURE_QUIZ_TOOLS = new Set(["read_graph", "read_topic", "create_closure_quiz"]);
/** JSON Schema para Responses function tools (strict:false, como o Clew). */
export const toolParameters = (name: keyof typeof TOOL_SCHEMAS) =>
  z.toJSONSchema(TOOL_SCHEMAS[name], { io: "input", unrepresentable: "any" });
```

**Integração com pi-agent-core:** as tools do learnharness são `AgentTool` com parâmetros **TypeBox** (`learnharness:src/agent/tool-execute.ts`), e o loop do pi valida os argumentos com TypeBox antes de chamar `execute`. Há duas opções:

- (a) Espelhar os drafts em TypeBox só para o shape estrutural e rodar o Zod (`superRefine` e `refine`) no topo do `execute`, lançando o `ToolInputError` já existente. O efeito é o mesmo de "retornar erro real ao modelo" no Clew.
- (b) Testar `Type.Unsafe(z.toJSONSchema(...))`. Não verifiquei se o validador do pi-ai aceita JSON Schema cru.

**Recomendo (a).**

---

## 5. Pipeline de propostas: regras exatas

Fluxo: `tools.execute_tool` → `ProposalService.prepare` → `ProposalNormalizer.normalize` → `ProposalValidator.validate` → card de preview com `status:"awaiting_review"` → usuário clica Apply → `POST /apply` → `normalize` de novo → `repository.apply_proposal`.

### 5.1 `backend/app/services/proposal_service.py::ProposalService.prepare` (57 linhas, não chama modelo)

1. **Checagem de revisão no momento da ferramenta:** se `draft.base_graph_version != graph.version`, lança `ValueError("Graph revision conflict: read_graph again. Current version is N.")`. O erro volta ao modelo como `function_call_output` `{"error": ...}`, e o modelo chama `read_graph` e refaz a proposta.
2. **Edição parcial:** para tópicos **existentes**, os campos `description`, `difficulty`, `estimated_minutes` e `level` omitidos (fora de `model_fields_set`) recebem o valor atual. Assim a omissão não apaga dados de estudo. `title` e `slug` continuam obrigatórios.
3. Resources sem `id` recebem `"{topic_id}_resource_{i+1}"`.
4. Proposta sem nenhuma operação gera o erro "A proposal needs at least one graph operation. Reply normally if no change is needed."
5. O envelope é montado com `proposal_id = "prop-{call_id}"`, `mode` (`ingest_topics` para `propose_ingest`, `expand_goal` para `propose_expand`), `provenance.grounding_used` (indica se houve `web_search_call` naquele turno) e `highlights` (os 5 primeiros títulos, ou `src → tgt` para arestas).
6. Se `plan.validation.ok` for falso, lança `"; ".join(errors)`, que também volta ao modelo.

### 5.2 `proposal_normalizer.py::ProposalNormalizer.normalize`

- Erros do validador, mais o **`op_id` duplicado**, que gera `"duplicate op_id X"`.
- Agrupa as operações para a UI em `"Topic changes"`, `"Dependency changes"`, `"Zone changes"` e `"Mastery changes"`.
- Preview: `topic_add_count` e `edge_add_count` só contam ids **novos**; `zone_add_count` e `zone_update_count` são separados; `mastery_update_count` existe para `set_mastery`, que na prática está morto.
- Produz `ApplyPlanEnvelope {validation, normalized_proposal: GraphProposal(ops→PatchOperation), patch_groups, preview}`.

### 5.3 `proposal_validator.py::ProposalValidator.validate`, regra por regra

| # | Regra | Mensagem |
|---|---|---|
| R1 | `envelope.graph_id == graph.graph_id` | "proposal references for the wrong graph" |
| R2 | `op ∈ {upsert_topic, upsert_edge, upsert_zone}` | "operation X is not allowed in proposal envelopes" |
| R3 | `entity_kind == op sem "upsert_"`, payload correspondente presente e **exatamente 1** payload não-nulo | "operation, entity_kind and exactly one payload must match" |
| R4 | Tópico **novo** deve ter `state == not_started` | "new topics must start as not_started; completion is awarded by the study workflow" |
| R5 | Todo resource precisa de `label` e URL com esquema `http/https` e `netloc` não vazio. Não há sanitização silenciosa: `javascript:` é rejeitado | "resources require a label and a valid HTTP(S) URL" |
| R6 | `topic.zones ⊆ (zonas existentes ∪ zonas da proposta)` | "references unknown zones: …" |
| R7 | Origem e destino da aresta ∈ (tópicos existentes ∪ tópicos da proposta) | "edge source/target topic X is unknown" |
| R8 | `zone.topic_ids ⊆` tópicos conhecidos | "zone Z references unknown topics: …" |
| R9 | Só se não houver erros: arestas finais = existentes sobrescritas por id pelas da proposta. O subgrafo `requires` deve ser **acíclico** pelo algoritmo de Kahn. Autolaço também conta como ciclo | "prerequisite relations must not contain self-dependencies or directed cycles" |
| R10 | Só se não houver erros: o grafo final, tratado como **não-dirigido** e considerando **qualquer relação**, deve ter **≤ 1 componente** | "proposal would create disconnected graph islands; link new topics through meaningful prerequisites" |
| R11 | Os warnings do modelo são deduplicados preservando a ordem | — |
| R12 | No apply (`repository.apply_proposal`), a aciclicidade é **revalidada** depois de aplicar, como defesa em profundidade. `_synchronize_zone_memberships` lança erro para referência a zona ou tópico inexistente | "topic X references unknown zone Y" |

Notas:

- Em R10 a conectividade é **global**. Se o grafo existente já tiver duas ilhas, toda proposta falha. Ver as armadilhas na §12.
- Substituir uma aresta pelo mesmo `id` revalida a topologia final. Por exemplo, trocar `a→b` por `b→c` desconecta `a` e é rejeitado (teste `test_edge_replacement_validates_the_final_topology`).
- Arestas `supports` e `bridges` **podem** formar ciclos com `requires` (teste `test_supports_bridges_and_final_edge_replacements_do_not_create_prerequisite_cycles`).

Porte TS do núcleo (puro, sem I/O):

```ts
// src/core/curriculum/validate.ts — adaptado de proposal_validator.py (MIT)
type E = { id: string; source_topic_id: string; target_topic_id: string; relation: string };

export function prerequisitesAreAcyclic(edges: Iterable<E>): boolean {     // Kahn
  const kids = new Map<string, Set<string>>(), indeg = new Map<string, number>();
  for (const e of edges) {
    if (e.relation !== "requires") continue;
    const a = e.source_topic_id, b = e.target_topic_id;
    if (!kids.has(a)) kids.set(a, new Set());
    indeg.set(a, indeg.get(a) ?? 0); indeg.set(b, indeg.get(b) ?? 0);
    if (!kids.get(a)!.has(b)) { kids.get(a)!.add(b); indeg.set(b, indeg.get(b)! + 1); }
  }
  const ready = [...indeg].filter(([, c]) => c === 0).map(([id]) => id);
  for (let i = 0; i < ready.length; i++)
    for (const t of kids.get(ready[i]) ?? []) { const c = indeg.get(t)! - 1; indeg.set(t, c); if (c === 0) ready.push(t); }
  return ready.length === indeg.size;                       // autolaço nunca chega a indeg 0
}

export function weakComponents(topicIds: Set<string>, edges: Iterable<E>): string[][] {  // union-find
  const parent = new Map([...topicIds].map((id) => [id, id]));
  const find = (x: string): string => { while (parent.get(x)! !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  for (const e of edges) if (parent.has(e.source_topic_id) && parent.has(e.target_topic_id))
    parent.set(find(e.source_topic_id), find(e.target_topic_id));
  const groups = new Map<string, string[]>();
  for (const id of topicIds) (groups.get(find(id)) ?? groups.set(find(id), []).get(find(id))!).push(id);
  return [...groups.values()];
}

export function validateProposal(env: GraphProposalEnvelope, g: StudyGraph): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  if (env.graph_id !== g.graph_id) errors.push("proposal references for the wrong graph");
  const known = new Set([...g.topics.map((t) => t.id), ...env.operations.flatMap((o) => (o.topic ? [o.topic.id] : []))]);
  const knownZones = new Set([...g.zones.map((z) => z.id), ...env.operations.flatMap((o) => (o.zone ? [o.zone.id] : []))]);
  const existing = new Set(g.topics.map((t) => t.id));
  for (const o of env.operations) {
    const ent = o.op.replace("upsert_", "") as "topic" | "edge" | "zone";
    const payloads = [o.topic, o.edge, o.zone].filter((p) => p != null).length;
    if (o.entity_kind !== ent || o[ent] == null || payloads !== 1) { errors.push(`${o.op_id}: operation, entity_kind and exactly one payload must match`); continue; }
    if (o.topic) {
      if (!existing.has(o.topic.id) && o.topic.state !== "not_started") errors.push(`${o.op_id}: new topics must start as not_started`);
      if (o.topic.resources.some((r) => !r.label || !isHttpUrl(r.url))) errors.push(`${o.op_id}: resources require a label and a valid HTTP(S) URL`);
      const bad = o.topic.zones.filter((z) => !knownZones.has(z));
      if (bad.length) errors.push(`${o.op_id}: topic ${o.topic.id} references unknown zones: ${bad.sort().join(", ")}`);
    }
    if (o.edge) for (const side of ["source_topic_id", "target_topic_id"] as const)
      if (!known.has(o.edge[side])) errors.push(`${o.op_id}: edge ${side.split("_")[0]} topic ${o.edge[side]} is unknown`);
    if (o.zone) { const bad = o.zone.topic_ids.filter((t) => !known.has(t)); if (bad.length) errors.push(`${o.op_id}: zone ${o.zone.id} references unknown topics: ${bad.sort().join(", ")}`); }
  }
  if (!errors.length) {
    const edges = new Map(g.edges.map((e) => [e.id, e as E]));
    for (const o of env.operations) if (o.edge) edges.set(o.edge.id, o.edge);
    if (!prerequisitesAreAcyclic(edges.values())) errors.push("prerequisite relations must not contain self-dependencies or directed cycles");
    else if (weakComponents(known, edges.values()).length > 1) errors.push("proposal would create disconnected graph islands; link new topics through meaningful prerequisites");
  }
  return { ok: errors.length === 0, errors, warnings: [...new Set(env.warnings)] };
}
const isHttpUrl = (v: string) => { try { const u = new URL(v.trim()); return (u.protocol === "http:" || u.protocol === "https:") && !!u.host; } catch { return false; } };
```

### 5.4 Aplicação: `repository.py::_apply_operation` e `_synchronize_zone_memberships`

- `upsert_topic` num tópico **existente**: atualiza `title`, `slug`, `description`, `difficulty`, `estimated_minutes` e `level`. **Não mexe em `state`**, e o comentário no código diz "Topic state is controlled by quizzes and explicit mastery updates". `zones` e `resources` são **mesclados como união**: resources deduplicados por `(id, label, url)`. Por isso uma proposta não consegue remover um resource nem tirar um tópico de uma zona. `artifacts`, `quiz_policy` e `metadata` são preservados.
- `upsert_topic` **novo**: cria `Topic` com o estado vindo do payload, que já é forçosamente `not_started` por R4.
- `upsert_edge`: substitui por id.
- `upsert_zone`: a cor e a intensidade são **ignoradas do modelo** e decididas por `zone_style_service.resolve_zone_style`. Se a zona já tem cor `#rrggbb`, a cor é mantida. Senão, o serviço calcula `sha1(f"{graph_id}:{zone_id}")[:2] % 16` sobre uma paleta de 16 pares (cor, intensidade) e pula pares já ocupados. Resultado determinístico.
- Depois de todas as operações, `_synchronize_zone_memberships` faz a união bidirecional `topic.zones ↔ zone.topic_ids`.

---

## 6. Snapshot, recibo, revisão e rollback (`backend/app/services/repository.py` e `repository_storage.py`)

**Algoritmo de `apply_proposal(proposal)`**, numa única conexão SQLite com `BEGIN IMMEDIATE`:

1. Se faltar `proposal_id` ou `base_graph_version` (proposta legada), lança `ProposalConflictError`, que vira 409.
2. `canonical = proposal.model_dump_json()`.
3. Procura em `proposal_applications` pelo `proposal_id`:
   - se existir com o **mesmo** payload, é **idempotente**: retorna o workspace *atual*, sem novo snapshot (vale mesmo depois de outras edições);
   - se existir com payload diferente, 409 "This proposal id was already used for different changes."
4. Carrega o snapshot atual e faz deep copy. Se `graph.version != base_graph_version`, 409 "The graph changed after this proposal was prepared…".
5. Aplica as operações e sincroniza as zonas. **Revalida a aciclicidade.** Faz `graph.version += 1`.
6. `_insert_snapshot(conn, workspace, source="proposal.apply", reason=summary, parent_snapshot_id=current.id)`. O snapshot faz *optimistic concurrency* sobre o workspace inteiro: se o último snapshot não for `parent_snapshot_id`, lança `RepositoryConflictError`. Para todo grafo alterado, faz `version = max(version, current_snapshot_id + 1)`, então as versões **nunca regridem**, nem depois de rollback ou de recriar um grafo.
7. `INSERT INTO proposal_applications(proposal_id, graph_id, payload_json, snapshot_id)`. Este é o recibo.
8. Na **mesma transação**, marca `proposal_applied=true` na mensagem de chat que contém aquela proposta.

**Rollback** (`rollback_to(id)`): copia o snapshot alvo, faz `version += 1` em **todos** os grafos e insere um snapshot `source="rollback"`. Não reescreve o histórico do chat nem apaga recibos. O recibo registra a aceitação histórica, e o prompt instrui o modelo de que "a later rollback may undo that change. Fresh graph data is always the current truth". A rota interrompe todos os runs ativos antes.

Quiz e fechamento também criam snapshot (`source="quiz.submit"` e `"topic.mark_finished"`), então são reversíveis.

**Tabelas** (`repository_storage.py::init_repository_storage`): `graph_snapshots(id AUTOINC, created_at, source, reason, parent_snapshot_id, payload_json)`, `graph_events`, `quiz_sessions`, `chat_sessions(session_id, graph_id, topic_id, title, …)`, `chat_messages(ordinal, message_id UNIQUE, session_id, graph_id, role, payload_json)` e a legada `workspace_secrets`. O `AgentStore` adiciona `agent_sessions`, `agent_events`, `agent_transcripts` e `agent_tool_results`. `proposal_applications` é criada de forma preguiçosa dentro do próprio `apply_proposal`.

**Adaptação para o learnharness:** o learnharness hoje usa ledgers JSONL e `writeFileAtomicSync` (`learnharness:src/store/graph.ts` e `atomic-write.ts`), sem lock entre escritores. Há duas opções:

- **(A) `node:sqlite` (`DatabaseSync`).** O Electron 44.9.3 embute Node 24, e o dev local roda Node v24.12.0, então dá para ter `BEGIN IMMEDIATE` e as mesmas garantias do Clew sem dependência nativa. **Recomendado** para o grafo de currículo.
- (B) Um arquivo por domínio: `curriculum/<domainId>/graph.json`, `snapshots.jsonl` com patches inversos em vez de workspace completo, e `receipts.json`, com um mutex em processo. É mais simples, mas perde a atomicidade entre o recibo e a mensagem de chat.

Em qualquer das opções, **o snapshot deve ser por domínio/grafo, não por workspace**. Ver a §12.

---

## 7. Quizzes de fechamento determinísticos (`backend/app/services/quiz_service.py`)

- **`build_closure_status(graph, topic_id)`**: faz DFS pelos pais `requires` e coleta os pré-requisitos **transitivos**. `blocked` são os que não estão em `{solid, mastered}`. `can_award_completion = not blocked`. `latest_attempt` é a última tentativa daquele tópico.
- **Geração** (`AgentRuntime.generate_closure_quiz`):
  1. Recusa se houver pré-requisito aberto.
  2. Cria um `AgentRun` **efêmero** (sem sessão, sem `web_search`), com as tools restritas a `CLOSURE_QUIZ_TOOLS` e o prompt "Prepare a closure quiz for topic X: exactly N questions. Call create_closure_quiz…".
  3. Se o modelo terminar sem chamar a tool, retorna o erro "The model finished without creating the requested quiz". **Não há quiz fabricado como fallback.**
- **`start_session` / `_validate_ai_questions`**: `question_count` em 6..12, quantidade **exata**, prompts distintos (casefold), ids distintos, 4 escolhas distintas não vazias e índice em 0..3. Não trunca nem conserta nada.
- **Público vs privado:** `TopicQuizSessionPublic` / `QuizQuestionPublic` **omitem `correct_choice_index`**. A resposta certa fica no servidor (`quiz_sessions`).
- **`grade_session`**:
  - Valida que os ids de pergunta pertencem à sessão e que os índices são `int` (o tipo `bool` é rejeitado, porque `QuizAnswer.choice_index` usa `strict=True`) e estão no intervalo.
  - `score = acertos/total`. Passa se `score ≥ pass_threshold` (o da config tem prioridade sobre o do tópico; padrão 0.75, então 9/12 = 0.75 passa).
  - `closure_awarded = passed ∧ can_award_completion`.
  - `awarded_state` é `"solid"` se fechou, `"needs_review"` se reprovou, e `None` se passou mas há bloqueio. Nesse caso `record_quiz_attempt` promove `not_started` para `learning`.
  - `missed_questions` guarda os prompts errados. `fail_count` é acumulado mesmo quando a última tentativa é substituída. Só a **última** tentativa por tópico fica em `graph.quiz_attempts`.
- **`record_quiz_attempt`**: numa transação, faz `DELETE FROM quiz_sessions WHERE session_id…` (consumo único: `rowcount != 1` gera 409 "already submitted") e insere o snapshot. Também confere `base_graph_version`: se os pré-requisitos mudaram durante a correção, retorna 409 (teste `test_prerequisite_change_during_grading_cannot_award_completion`).
- **Checkpoint inline (`present_quiz`)**: é formativo, **não** concede estado nem grava `quiz_attempts`. A correção é feita no servidor em `runtime.answer`. Observação: o `InlineChatQuiz.correct_index` vai na mensagem de chat para a UI, então o cliente pode ver a resposta. Isso é aceitável para um checkpoint formativo; para algo que vale XP, esconder o índice.
- **Fronteira** (`context.turn_context`): `ready_topic_ids` são os tópicos não fechados cujo nenhum pai `requires` está aberto. Na UI (`frontend/src/lib/graph.ts::computeFocusData`), `frontierEdgeIds` são as arestas de pai fechado para filho aberto cujos pais estão todos fechados.

---

## 8. Runtime do agente (`backend/app/agent/runtime.py`, `tools.py`, `context.py`, `store.py`)

### 8.1 Loop

```text
_execute(run):
  model = _select_model(requested or config.default_model)   # catálogo /v1/models; sem substituição
  tools = tool_specs() (+ {"type":"web_search"} só em chat)    # quiz efêmero: só CLOSURE_QUIZ_TOOLS
  items = transcript salvo (ou [])  +  _first_input(run)
  payload = {model, instructions: BASE_INSTRUCTIONS + developer_instructions(config), tools,
             parallel_tool_calls: false, include: ["reasoning.encrypted_content"], reasoning?: {effort}}
  repeat ≤ MAX_STEPS (24):
     response = stream({...payload, input: items})            # store:false, stream:true forçados
     items += response.output                                 # inclui reasoning criptografado
     calls = function_call items
     if none: save_transcript; finish("completed"); return
     for call in calls (sequencial, lock por call_id):
         out = execute_tool(...)  -> function_call_output {call_id, output: JSON string}
     save_transcript(items)        # só em pontos consistentes: toda call tem output
     if run.awaiting_answer: finish("completed"); return       # card encerra o turno
     if cancel_requested: finish("interrupted"); return
  raise "did not finish within 24 steps"
```

- **`_first_input`** monta uma mensagem `role:"user"`, ou `role:"developer"` quando é resposta de card, com `input_text`s nesta ordem:
  1. `turn_context(...)`: JSON "Current Clew context (application data)";
  2. só na primeira vez sem transcript, o histórico antigo rotulado "Earlier conversation from Clew (historical data)", limitado a `memory_history_message_limit`;
  3. o prompt do usuário **ou** "Learner's answer from a Clew card (application data): {json}".
- **`turn_context`** contém `graph_id`, `graph_version`, `language`, `selected_topic_id`, `confirmed_proposal_receipts` (lista de `proposal_id` aplicados) e `closure_question_count`. Com os toggles ligados, acrescenta: `graph` (todos os tópicos resumidos, todas as arestas e zonas), `selected_topic` (o tópico completo), `progress` (pares id/estado), `recent_quiz_attempts` (últimas 15) e `ready_topic_ids`.
- **Idempotência de tool** (`store.tool_result` e `save_tool_result`): a chave é `call_id`. É armazenado `canonical = json({tool, arguments})` junto com `thread_key`. Um replay devolve a saída gravada. O mesmo `call_id` com outros argumentos gera "Conflicting tool call id".
- **Erro de tool não é exceção do turno.** Ele vira `{"error": "..."}` como `function_call_output`, a atividade é marcada `failed` e os cards pendentes ficam `interrupted`. O modelo lê o erro e corrige; o prompt diz "Validation errors are real tool results: read their details, correct your operations, and retry".
- **Stream durável para a UI:** cada evento vai para `agent_events` (autoincrement, que serve de cursor). `events()` pagina de 256 em 256, acorda por `asyncio.Event` e emite `heartbeat` a cada 10 s. Os deltas de texto atualizam **uma linha** de `chat_messages` (`put_message` com upsert por `message_id`). O `client_message_id` é idempotente: o mesmo id com o mesmo conteúdo retoma o run; com outro conteúdo, 409.
- **Recuperação após restart** (`store.recover_interrupted`): sessões `starting`, `running` ou `waiting` passam a `interrupted`; mensagens `streaming` também viram `interrupted`; atividades `running` viram `failed`. Os cards pendentes continuam respondíveis.

### 8.2 Padrão `ask_question` / `present_quiz` que encerra o turno

```text
modelo → function_call ask_question {question, choices≤6}   (ou present_quiz {question, 4 choices, correct_index})
Clew   → persiste ChatMessage com AgentQuestion|InlineChatQuiz {interaction_id: "question-<call_id>", status: "pending"}
       → function_call_output: {"status":"awaiting_answer","interaction_id":…,
                                "message":"The card is ready. Clew will send the learner's answer in a separate turn."}
       → save_transcript (a call já tem output, então o transcript fica consistente)
       → run.awaiting_answer=True → finish("completed")   # nenhuma geração fica "pendurada"
UI     → card com botões e textarea (free-text sempre permitido em ask_question)
aluno  → POST /chat/answer {interaction_id, answer | choice_index}
Clew   → valida: o card existe, não foi respondido e não há turno ativo (store.begin com BEGIN IMMEDIATE)
       → present_quiz: corrige no servidor {question, selected_answer, correct, correct_answer}
       → novo AgentRun com input role:"developer":
         "Learner's answer from a Clew card (application data): {interaction_id, …}"
         (NÃO cria mensagem de usuário no chat; o card fica na resposta original, reply_id antigo)
```

Propriedades testadas em `backend/tests/test_agent_runtime.py`:

- o card encerra a geração;
- a resposta abre um run separado com `reply_id` diferente;
- responder duas vezes gera `ValueError`;
- Stop e restart preservam o card respondível;
- não é possível responder enquanto outro turno está ativo;
- o modelo usado na resposta é o selecionado explicitamente.

**Comparação com o learnharness:** o `questionResult()` com `terminate: true` (`learnharness:src/agent/tool-execute.ts`) não persiste output para a call e "the learner's answer re-enters the next turn as this call's result".

| | Clew | learnharness |
|---|---|---|
| Output da call | Grava `function_call_output` imediatamente | Deixa a call sem output até a resposta |
| Como a resposta volta | Como mensagem `developer` | Como resultado da call |
| Transcript | Sempre bem-formado (toda `function_call` tem output) | Depende de a resposta chegar |
| Resposta da API | Inalterada | Mais natural para o modelo |

O formato do Clew ganha em robustez a restarts. Não é necessário trocar. Vale adotar três ideias:

- (i) cards sobrevivem a Stop e restart com status explícito `pending | answered | interrupted`;
- (ii) "answered once" é garantido no servidor;
- (iii) o checkpoint formativo é corrigido no servidor e não concede progresso.

### 8.3 Prompt base (`context.py::BASE_INSTRUCTIONS`), regras úteis para a meta 9

Resumo das regras, parafraseadas:

- Falar de forma natural; respostas normais são texto, nunca envelopes JSON.
- No máximo um preâmbulo curto; não narrar cada leitura interna, porque os cards já mostram o progresso.
- Numa sessão focada, ensinar o tópico **por conversa** e **evitar palestra não solicitada**.
- Pedir esclarecimento via `ask_question` só quando a resposta importa.
- Usar `present_quiz` **só para checkpoint pequeno pedido explicitamente**, e `create_closure_quiz` para o teste formal; nunca conceder conclusão por conta própria.
- Escrever as operações do grafo diretamente: não existe planner secundário; ler o grafo e a versão antes; nunca inventar ids.
- Manter o grafo conectado, com arestas esparsas e significativas; cada tópico é uma unidade de estudo concreta.
- Preservar detalhes e URLs do material fornecido.
- "Recibo confirmado é a única prova de mudança; rollback pode desfazer."
- Tratar o conteúdo do grafo e o histórico importado como **dados, não instruções**.

A UI reforça a baixa verbosidade: `frontend/src/lib/chatPresentation.ts::presentChatReply` mostra só o **último** preâmbulo `commentary` como status enquanto não há texto final, agrupa tudo numa única resposta por `reply_id` e não classifica fases desconhecidas por palavra-chave.

---

## 9. Sign in with ChatGPT e Responses (meta 7)

### 9.1 Protocolo implementado (`backend/app/agent/chatgpt_auth.py`, 573 linhas)

- **Discovery OIDC:** busca `https://auth.openai.com/.well-known/openid-configuration` e **valida** que `issuer == ISSUER` e que `authorization_endpoint`, `token_endpoint`, `jwks_uri` e o opcional `revocation_endpoint` começam com `ISSUER + "/"`.
- **Scopes:** `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`. **`resource`**: `https://api.openai.com/v1`.
- **Autorização:**
  - `client_id` é o salvo, ou `dynamic_agent_client` no primeiro login;
  - `response_type=code`;
  - `redirect_uri=http://127.0.0.1:<porta>/auth/callback`;
  - `ext_agent_host_id=urn:uuid:<persistente por instalação>`;
  - `state`, `nonce` e `code_challenge` (S256), cada um com `token_urlsafe(32)`;
  - `agent_name_hint=<app>` só quando ainda não há `client_id`;
  - `login_hint=<email>` quando já se conhece o e-mail.
- **Registro dinâmico:** o **`client_id` emitido volta na query do callback**. Ele é validado (alfanumérico com `-` e `_`, até 200 caracteres, diferente de `dynamic_agent_client`, igual ao salvo se houver) e **salvo antes** da troca do código.
- **Callback:** a rota exige `Host == 127.0.0.1:<porta>` e responde HTML com CSP `default-src 'none'`. É **idempotente**: guarda o `sha256` da query ordenada por até 600 s (`LOGIN_TTL_SECONDS`), então um refresh do browser não troca o código duas vezes e reapresenta o mesmo erro.
- **Troca do código:** `grant_type=authorization_code`, `client_id`, `code`, `code_verifier`, `redirect_uri`, `resource`.
- **ID token:**
  - o header deve ter `alg == RS256` e `kid`;
  - a chave vem do JWKS (recarregado 1 vez se o `kid` não for encontrado), com `kty == RSA`, `use == sig`;
  - `aud == client_id`, `iss`, `exp`, `iat`, `sub` obrigatórios, `leeway = 5 s`;
  - `nonce`; `azp == client_id` quando presente ou quando há audiência múltipla.
- **Credenciais:** exige `access_token`, `refresh_token`, `token_type = bearer` e `expires_in > 0`. Os scopes vêm da resposta ou herdam os anteriores. **Sem `chatgpt.tokens.use.direct`**, o login fica `sharing:false`: a conta é tratada como "identidade só", e o workspace fica bloqueado.
- **Armazenamento:** tokens só no **keyring do SO**, **sem fallback em texto puro**. A conta keyring do desktop é `desktop-<sha256(db_path)[:32]>`. O registro não secreto (`client_id`, `subject`, `email`, `name`, `ext_agent_host_id`) vai em `chatgpt-registration.json` (escrita atômica, chmod 600).
- **Refresh:** 60 s antes de expirar, sob `asyncio.Lock` com double-check. Um `id_token` renovado precisa ter o **mesmo `sub`**. Rejeição (401 ou códigos em `REJECTED_CREDENTIALS`) apaga as credenciais. Contadores de geração (`_generation` e `_login_generation`) impedem que um refresh, login ou logout antigo sobrescreva o estado novo.
- **`reject_token(token, err)`:** só desloga se o token rejeitado for o **atual**, o que protege contra rejeição atrasada de um bearer antigo.
- **Logout:** apaga local primeiro, limpa o registro **mantendo `ext_agent_host_id`**, depois revoga o `refresh_token` em `revocation_endpoint` e retorna um aviso se a revogação não for confirmada.

### 9.2 Responses (`backend/app/agent/chatgpt_api.py`, 141 linhas)

- `GET /v1/models` retorna `{"models":[{slug, display_name, description?, visibility}]}`. Só entram os que têm `visibility == "list"`. **O primeiro listado é o default do plano.** Um modelo explícito indisponível gera erro, **sem substituição** (`runtime._select_model`).
- `POST /v1/responses` com `{...payload, store:false, stream:true}`. **Quirks da rota plan-sharing** documentados no código:
  - (a) pode **omitir `Content-Type`** num SSE válido; só um content-type diferente de `text/event-stream` é erro;
  - (b) os itens de saída chegam **somente** como `response.output_item.done`, e `response.completed` vem com `output: []`. O Clew reconstrói `output` ordenando por `output_index`;
  - (c) `response.failed` e `error` viram `api_error`; `response.incomplete` vira `response_incomplete` com `incomplete_details.reason`;
  - (d) eventos SSE acima de 4 MiB são rejeitados;
  - (e) se o stream acabar sem `response.completed`, o erro é `stream_interrupted`.
- **Tabela de erros** (`API_ERRORS`): `subscription_sharing_user_not_eligible`, `_usage_limit_exceeded`, `_usage_unavailable` (retryable), `_unsupported_capability`, `_route_not_supported`, `_invalid_user`, `_user_unavailable` (retryable), além de `invalid_grant`, `invalid_refresh_token`, `refresh_token_expired`, `refresh_token_invalidated`, `refresh_token_reused`, `token_expired`, `invalid_token`, `access_denied` e `model_not_found`. O prefixo legado `subscription_sharing_v2_` é normalizado para `subscription_sharing_`. Status ≥ 500 é retryable.
- **Web search:** chats sempre oferecem a tool hospedada `{"type":"web_search"}`; o quiz de fechamento não. O Clew 1.0.0 envia isso pela rota plan-sharing. Não confirmei de forma independente que a rota aceita, mas o Clew distribui assim.

### 9.3 Estado atual verificado (fontes oficiais, 2026-11-18)

- **Cookbook:**
  - a disponibilidade inicial de uso do plano é para "open-source projects, personal projects that run locally, and selected private apps";
  - apps **pagos ou hospedados** precisam entrar na waitlist;
  - `chatgpt.tokens.use.direct` com `resource.invoke` dá acesso à API pelo plano; `sharing` só é verdadeiro com esse scope;
  - registro dinâmico com `dynamic_agent_client`, `agent_name_hint` e `ext_agent_host_id` (`urn:uuid`), sem client secret.
- **Página de produto:**
  - uso do plano para assinantes **Go, Plus, Pro e Business** (o Clew diz só Plus e Pro);
  - no Business, o admin habilita por app;
  - limite semanal por app configurável como percentual;
  - a lista de integrações open-source inclui **"Pi"**, que é a família pi-mono/pi-ai usada pelo learnharness.
- **DevKit:** licença **noncommercial**, então não vendorizar.
- **Anthropic:** o Clew não trata desse provedor; nada a extrair.

### 9.4 Delta contra o learnharness atual (`learnharness:electron/chatgpt.cjs`, `src/agent/chatgpt-stream.ts`, `chatgpt-bridge.ts`)

O learnharness já tem SIWC multi-conta, com toggle de uso em background, lease de token por IPC e no-fallback para API key. Diferenças em que vale considerar o Clew:

| Aspecto | learnharness hoje | Clew | Ação sugerida |
|---|---|---|---|
| Endpoints OAuth | **hardcoded** `/api/accounts/authorize`, `/api/accounts/oauth/token`, `/.well-known/jwks.json` | discovery OIDC com validação de prefixo | Adotar discovery validado (menos frágil se a OpenAI mover rotas) |
| Armazenamento de tokens | `fileStore` JSON **não criptografado** (0600) | keyring do SO, sem fallback | Usar `electron.safeStorage` para cifrar o JSON (mesmo arquivo, conteúdo cifrado); manter o fileStore só para testes |
| Mapeamento de erros | regex sobre a mensagem (`chatGPTStreamError`) | tabela por **código**, normalização `v2_`, retryable | Portar `API_ERRORS`, `RETRYABLE` e `REJECTED_CREDENTIALS` para TS |
| Tools hospedadas | `chatGPTPayload` **rejeita** tool que não seja `function`/`custom`; embrulha em `namespace` | `web_search` hospedado ao lado das functions | Se quisermos busca nativa (meta 1: achar livros e vídeos), permitir `{type:"web_search"}`, testar e marcar `grounding_used` |
| `output_item.done` e `completed` vazio | delega ao `streamSimple` do pi-ai | reconstrói explicitamente | **Testar** se o pi-ai monta a mensagem quando `response.completed.output == []` (fake de teste: `backend/tests/fake_chatgpt.py::_complete`) |
| Callback idempotente | não verificado | digest da query com TTL | Verificar e adotar se faltar |

---

## 10. Frontend: `frontend/src/components/graphCanvasCore.ts` (733 linhas) e vizinhos

**Funções puras reaproveitáveis** (sem React; testadas em `graphCanvasCore.test.ts` com vitest):

- `hashString` é FNV-1a de 32 bits. É a base de toda a determinismo visual (jitter, fase, paleta).
- **`buildAnchorMap(nodes, edges, w, h)`** é um layout **radial por nível** e determinístico:
  1. Raízes (sem pais) ordenadas por título, distribuídas num anel de raio `clamp(min(w,h)·0.064, 22, 58)` com ângulo `-π/2 + i/n·2π + jitter(hash)`.
  2. Os filhos diretos de cada raiz são abertos num setor de largura `1.6π` (uma raiz) ou `max(0.8, 2π/n·0.88)`.
  3. Nós mais profundos: o raio vale `ringR + level·radialStep`, com `radialStep = (0.72·minDim − ringR)/(maxLevel+0.35)`. O ângulo é a média circular dos pais, mais `0.68·(ângulo do ramo primário − média)`, mais o offset entre irmãos (`spread = max(0.15, 0.85/size)`), mais jitter.
  4. `resolvePrimaryRootId` e `resolvePrimaryBranchId` escolhem a raiz ou ramo mais frequente entre os pais. Há proteção contra recursão em ciclos (teste "does not recurse forever on cyclic graphs").
- **`buildZoneContour(points, intensity)`**: para 1 ponto, gera um hexágono elíptico; para 2, uma "cápsula" retangular; para 3 ou mais, expande cada ponto radialmente a partir do centróide (`42 + 10·intensity + clamp(0.18·d, 10, 28)`) e calcula o **convex hull** por Andrew monotone chain. É o contorno visual das "regiões" (zonas).
- `zoneIdByTopicId` / `primaryZoneIdForTopic`: um tópico em várias zonas pertence visualmente à **menor** zona, com desempate por maior `intensity`.
- `computeLabelBoxes`: posiciona rótulos tentando 6 ângulos candidatos em torno do nó (ordem `[0,4,2,3,1,5]`) e evita sobreposição por AABB.
- `nextIdleMotionState`, `idleRenderOffset` e `edgeRenderMotion`: congelam a animação quando a física assenta (velocidade máxima < 0.35 ou mais de 180 frames sem atividade, por 4 frames) e aplicam deriva ociosa senoidal determinística com amplitude de cerca de 1.5 px.
- `graphCanvasPalette(theme)`: paletas "Midnight" (escura) e "Paper" (clara).

**Física** (`GraphCanvas.tsx::advanceActivePhysicsFrame`):

- repulsão `8500/d²` **par a par, O(n²)**, com distância mínima de colisão baseada no tamanho do rótulo;
- mola `0.0046·(dist − rest)` com `rest = 260 + 48·|Δlevel|`; arestas entre zonas usam escala 0.35 e rest igual à distância entre âncoras;
- "leque" entre irmãos;
- repulsão entre centróides de zonas, também O(z²), mais coesão;
- puxão para a âncora (`0.004`) e para o centro;
- amortecimento 0.91;
- posições guardadas em `localStorage` (`knowledge_graph_pos_v21`).

**Para o grafo massivo, não portar essa física.** O learnharness já tem `d3-force` (Barnes–Hut, O(n log n)), `@xyflow/react` e `dagre-d3-es`. Recomendo usar as âncoras de `buildAnchorMap` como `forceX`/`forceY` alvo, `buildZoneContour` para desenhar regiões e LOD/virtualização por zona.

**`frontend/src/lib/graph.ts` (342 linhas, puro):**

- `computeFocusData(graph, selected)` retorna `rootIds`, `ancestorIds` (DFS sobre `requires`), `pathNodeIds`, `pathEdgeIds`, `frontierEdgeIds` e **`pathLayers`**: camadas por *longest path* topológico, com Kahn restrito ao caminho, que funciona com "diamantes". É excelente para o painel "o que preciso antes disto", em ordem de estudo.
- `computeClosureStatus` é o espelho TS do `build_closure_status`.
- `summarizePreviewCounts` e `summarizeTopOperations` alimentam a UI do preview da proposta.

**Chat e eventos:**

- `frontend/src/lib/agentEvents.ts`: parser estrito de NDJSON, reducer idempotente por `event_id` e `upsertChatMessage` por id.
- `hooks/useGraphChatController.ts`: estado por chave `${graphId}:${sessionId}` (isolamento por grafo/sessão, útil para a meta 3), reconexão via `/chat/events?after=` e geração por grafo para descartar respostas atrasadas.
- `components/assistant/AgentInteraction.tsx`: card de pergunta/quiz com textarea livre.
- `hooks/useChatModelSelection.ts`: modelo por grafo em `localStorage`; um explícito indisponível continua visível e o servidor o rejeita.

---

## 11. ADRs 0001–0008 e o que adotar

| ADR | Decisão | Adotar? |
|---|---|---|
| 0001 | Mutação do grafo só por proposta revisável, com snapshot e rollback | **Sim, como padrão.** Para a "expansão procedural" da meta 1, permitir um modo **auto-apply de baixo risco** (folhas novas dentro de zona existente), sempre com recibo e undo. O ADR rejeita a mutação silenciosa; com recibo e rollback visível, não é silenciosa. |
| 0002 | UI centrada no grafo, não em dashboard | Sim (combina com a meta 8). |
| 0003 | Edição local e produto hospedado separados | Relevante: SIWC hospedado exige aprovação da OpenAI. Manter a edição desktop/local. |
| 0004 | Obsidian como ponte de import/export portável; MCP **somente leitura** como ponte de contexto | Sim para a meta 4 (ver §13) e para a meta 2 (contexto para assistentes externos). |
| 0005 | (substituído) Codex CLI app-server como runtime | Histórico: a desvantagem era exigir CLI instalado e um protocolo experimental. |
| 0006 | Loop próprio sobre Responses + SIWC, `store:false`, transcript local, card encerra o turno, limite de passos, sem fallback | Já alinhado com o learnharness. Atenção ao crescimento do transcript (§12). |
| 0007 | Electron, backend em loopback com porta aleatória, token por launch, renderer sandboxed, sign-in obrigatório | O learnharness tem um modelo equivalente (`LH_DESKTOP_API_SECRET`). |
| 0008 | Esquema `clew://app` estável (preserva o `localStorage`), proxy de `/api/v1/` para o loopback, export Obsidian atômico (staging e rename no-replace) | Útil se o learnharness tiver problema de origem variável; o export atômico é útil na meta 4. |

---

## 12. Armadilhas e limitações (importantes para "grafo massivo")

1. **Contexto injeta o grafo inteiro em todo turno** (`turn_context` com `memory_include_graph_context`). Com 1–2 mil tópicos e as arestas, isso consome dezenas de milhares de tokens por turno. Substituir por **vizinhança escopada**: tópico atual, ancestrais via `pathLayers`, fronteira, zona atual, contagem por zona e busca sob demanda (`read_topic` e uma nova `search_topics`).
2. **O transcript cresce sem compactação.** É re-enviado inteiro a cada passo (`store:false`), incluindo reasoning criptografado. Não há sumarização. O learnharness já tem `src/core/compaction.ts`; usar.
3. **Snapshot do workspace inteiro em JSON a cada mudança.** Armazenamento O(tamanho × nº de mudanças), e o rollback é **global**: reverter Inglês reverteria Eletrônica. Para a meta 3, usar snapshot **por domínio** e patches inversos ou deltas com checkpoint periódico.
4. **A conectividade (R10) é global e inclui ilhas pré-existentes.** Um grafo que nasça com duas componentes (por exemplo, import do Obsidian) nunca mais aceita propostas. Mudar para "nenhuma componente **nova** sem tópico existente", usando `island_components` (já calculado e não usado), ou permitir múltiplas raízes por subdomínio.
5. **Sem remoção, merge ou depreciação via proposta.** `remove_topic`, `remove_edge` e `set_mastery` existem no repositório, mas não no contrato. Resources e zonas só crescem (união). Um currículo que evolui por um ano precisa de `deprecate_topic`, `merge_topics`, `remove_resource` e `reorder_resources`, e cada operação nova precisa de regra de validação.
6. **Zonas são planas.** Não há hierarquia domínio → subdomínio → região, nem resources no nível da zona. A meta 1 pede livros cobrindo regiões grandes e ordem das aulas. Estender `Zone` com `parent_zone_id` e `resources` ordenados (`kind: book_chapter | video | ai_lesson`), e `Topic.resources` com `order` e `lang`.
7. **Física O(n²) do canvas** e posições em `localStorage` global (`knowledge_graph_pos_v21`) não escalam. Ver a §10.
8. **O `correct_index` do quiz inline vai para o cliente.** Aceitável para checkpoint formativo; esconder se valer XP (meta 5).
9. **Uso de tokens descartado:** `ProposalTrace.usage_metadata = {}` e o `usage` de `response.completed` não é registrado. A meta 6 precisa capturar o usage por modelo. O pi-ai já entrega `usage` no `AssistantMessage`.
10. **O contrato JSON exportado está desatualizado** (descrição de `ask_question`). Gerar os schemas a partir do código (Zod e `toJSONSchema`) e testar em snapshot.
11. **`mark_topic_finished` fecha todos os ancestrais** como `solid`. É conveniente, mas é um "atalho" que infla progresso e XP. No nosso app, separar "pular com teste diagnóstico" de "marcar como sabido".
12. **Concorrência:** o `_connect` do Clew abre uma conexão nova por operação e serializa com `BEGIN IMMEDIATE` e `busy_timeout` de 30 s. O learnharness não tem lock nos stores JSON ("two writers of one file still race"). Se o Next server e workers escreverem no currículo, use SQLite ou mutex.
13. **Edge sem `requires` não entra na aciclicidade**, mas entra na conectividade. Arestas duplicadas (mesmo par com ids diferentes) são aceitas: deduplicar por `(source, target, relation)`.
14. **SIWC:** o Clew afirma "só Plus/Pro"; a doc atual diz Go, Plus, Pro e Business. Apps pagos ou hospedados exigem waitlist. O DevKit é noncommercial. Há **limite semanal por app** configurado pelo usuário: tratar `subscription_sharing_usage_limit_exceeded` com ação primária "Manage usage" (recomendação do cookbook).
15. **Segurança de conteúdo:** o prompt trata o conteúdo do grafo e o histórico importado como dados. Manter isso quando livros, legendas do YouTube e páginas web entrarem no contexto (meta 1).

---

## 13. Outras pontes úteis

- **Obsidian** (`frontend/src/lib/obsidianImport.ts`, 623 linhas; `backend/app/services/obsidian_export.py`, 335 linhas; `docs/OBSIDIAN.md`):
  - O import transforma arquivos em tópicos, pastas em zonas e wikilinks em arestas, com dica de relação `[[X]]::requires` inline ou em frontmatter `mapmind_relations: ["[[X]]::requires"]` (strings YAML entre aspas). Placeholders para links ausentes são opcionais. YAML malformado ou chave duplicada é rejeitado.
  - O export gera um README e uma nota por tópico, com frontmatter `mapmind_relations` (`relation`, alvo), pasta pela zona primária, resources, artifacts e progresso opcional. A escrita é **atômica** no desktop (ADR 0008).
  - **Para a meta 4:** acrescentar ao exporter um bloco de cartões no formato do plugin *Spaced Repetition* do Obsidian (`pergunta::resposta` ou `?`) ao fim da sessão. O Clew não tem flashcards.
- **MCP read-only** (`backend/app/mcp_server/server.py` e `tools.py`): `list_graphs`, `get_current_learning_context`, `get_node` (vizinhos e bloqueadores) e `search_notes` (score por título, slug e descrição, com snippet). É um bom molde para expor a "memória de onde o aluno está" a outros agentes, sem escrita (ADR 0004).
- **Prompt de ingestão** (`docs/prompts/topic-ingest.md`): formato Markdown "um tópico por bloco" com `Estimated time`, `Resource: Nome - URL` e `Testing:`. É um formato de semente para o `propose_ingest`, útil para importar sumários de livros.

---

## 14. Arquivos exatos a copiar ou adaptar

| Origem (`_refs/extra/miuuyy__Clew/…`) | Destino sugerido (`learnharness:…`) | Ação |
|---|---|---|
| `contracts/graph_patch.schema.json`, `contracts/clew_tools.schema.json`, `backend/app/agent/contracts.py` | `src/core/curriculum/contracts.ts` | Converter para Zod (§4.2), TypeBox espelhado para `AgentTool` |
| `backend/app/models/domain.py` (`Topic`, `Edge`, `Zone`, `StudyGraph`, `QuizAttempt`, `TopicClosureStatus`, `TopicQuizSession`, `ApplyPlanEnvelope`…) | `src/core/curriculum/types.ts` | Porte de tipos, estendido (hierarquia de zona, resources ordenados, `domainId`) |
| `backend/app/services/proposal_validator.py` | `src/core/curriculum/validate.ts` | Porte (§5.3) e correção da conectividade global |
| `backend/app/services/proposal_normalizer.py` | `src/core/curriculum/normalize.ts` | Porte (preview, grupos, `op_id` duplicado) |
| `backend/app/services/proposal_service.py` | `src/core/curriculum/prepare.ts` | Porte (revisão, edição parcial, ids de resource) |
| `backend/app/services/repository.py` (`apply_proposal`, `_apply_operation`, `_merge_*`, `_synchronize_zone_memberships`, `rollback_to`, `record_quiz_attempt`, `mark_topic_finished`, `_insert_snapshot`) | `src/core/curriculum/apply.ts` (puro) e `src/store/curriculum.ts` (`node:sqlite`) | Separar a função pura `applyOperations(graph, ops)` do armazenamento transacional |
| `backend/app/services/repository_storage.py` | `src/store/curriculum.ts` | DDL de referência (snapshots, recibos, quiz_sessions) |
| `backend/app/services/zone_style_service.py` | `src/core/curriculum/zone-style.ts` | Porte (paleta determinística; trocar a paleta pela cel shading) |
| `backend/app/services/quiz_service.py` | `src/core/curriculum/closure.ts` | Porte integral (closure, validação, correção) |
| `backend/app/agent/tools.py` | `src/agent/tools/curriculum.ts` | Reescrever como `AgentTool` (`serverExecute`), mantendo a idempotência por `call_id` |
| `backend/app/agent/context.py` (`turn_context`, `graph_context`, `BASE_INSTRUCTIONS`) | `src/agent/prompts/curriculum.md` e `src/core/curriculum/context.ts` | Adaptar: contexto **escopado** em vez do grafo inteiro |
| `backend/app/agent/runtime.py` (`answer`, `generate_closure_quiz`, `_select_model`) | `src/agent/teacher-agent.ts` (já existe) | Só as ideias: run efêmero de quiz com tools restritas, sem substituição de modelo |
| `backend/app/agent/chatgpt_auth.py` (`API_ERRORS`, `RETRYABLE`, `REJECTED_CREDENTIALS`, `api_error`, `discovery`) | `electron/chatgpt.cjs` e `src/agent/chatgpt-stream.ts` | Portar só a tabela de erros e o discovery validado |
| `backend/app/agent/chatgpt_api.py` (`_completed`, `_events`) | testes de `src/agent/chatgpt-stream.ts` | Usar como especificação de quirks em testes |
| `frontend/src/components/graphCanvasCore.ts` | `src/core/curriculum/layout.ts` | Copiar `hashString`, `buildAnchorMap`, `buildZoneContour`, `convexHull`, `zoneIdByTopicId`, `computeLabelBoxes`, `averageAngles`, `normalizeAngle` e seus testes |
| `frontend/src/lib/graph.ts` | `src/core/curriculum/focus.ts` | Copiar `computeFocusData`, `computeClosureStatus`, `computeRootTopicIds` |
| `frontend/src/lib/agentEvents.ts`, `frontend/src/lib/chatPresentation.ts` | referência | O learnharness tem seu próprio stream; usar só as ideias (agrupamento por reply, um único status de commentary) |
| `backend/tests/test_proposal_tools.py`, `test_quiz_service.py`, `test_quiz_routes.py`, `test_repository_graphs.py`, `frontend/src/components/graphCanvasCore.test.ts`, `frontend/src/lib/graph.test.ts` | `tests/curriculum-*.test.ts` | Reescrever os casos como critérios de aceitação (lista na §15.3) |
| `backend/tests/fake_chatgpt.py` | `tests/fixtures/fake-chatgpt.ts` | Peer falso de OAuth e Responses (SSE com `completed` vazio) |
| `docs/adr/0001…0008` | `docs/adr/` | Usar como modelo de ADR para as nossas decisões |

Nenhuma dependência nova é obrigatória: `zod`, `typebox`, `d3-force` e `@xyflow/react` já existem, e `node:sqlite` vem embutido. Dependência opcional: `fast-check` (devDep) para testes de propriedade.

---

## 15. Plano de integração

### 15.1 Fases

**Fase 0: decisões (ADR próprio)**

- O "grafo de currículo" (DAG de tópicos e pré-requisitos por domínio) é uma estrutura **nova**, ao lado do grafo de proposições do learnharness (`src/store/graph.ts`, que registra o que o aluno aprendeu, por sessão). Elas se ligam por `topicId` na proposição ou na sessão.
- Domínio = `StudyGraph` (Inglês, Eletrônica…). Cada domínio tem snapshots, recibos, chats e memória isolados (meta 3).

**Fase 1: núcleo puro (sem IA), cerca de 3–5 dias**

- `src/core/curriculum/{contracts,types,validate,normalize,prepare,apply,closure,focus,layout,zone-style}.ts` portados (§14).
- Invariantes formais como testes de propriedade (fast-check). Para todo grafo válido G e toda proposta P aceita:
  - **I1**: o subgrafo `requires` de `apply(G,P)` é um DAG;
  - **I2**: nenhuma componente nova sem tópico pré-existente;
  - **I3**: integridade referencial tópico↔zona e aresta↔tópico;
  - **I4**: `version` cresce estritamente;
  - **I5**: tópicos novos chegam em `not_started`, e os estados existentes ficam inalterados;
  - **I6**: `closure_awarded ⇒` todo pré-requisito transitivo está em `solid` ou `mastered`;
  - **I7**: Apply é idempotente por `proposal_id` e payload canônico;
  - **I8**: `rollback(k)` restaura os tópicos, arestas e zonas do snapshot k com `version` maior.
- Opcional: especificar I1, I5 e I6 em Lean 4 sobre um modelo finito (`Finset` de arestas) e provar que `applyOperations`, seguido da checagem de Kahn, preserva o DAG. É a referência para "lógica de evolução formalmente correta" (meta 1). O código TS segue validado por propriedade.

**Fase 2: persistência, cerca de 2–3 dias**

- `src/store/curriculum.ts` com `node:sqlite`:
  - tabelas `domains`, `curriculum_snapshots(domain_id, id, parent_id, source, reason, payload | inverse_patch)`, `proposal_receipts(proposal_id PK, domain_id, payload_json, snapshot_id)`, `quiz_sessions` e `closure_events`;
  - `applyProposal()` em `BEGIN IMMEDIATE` com as checagens da §6, e rollback **por domínio**.
- Hooks de evento (`src/core/events.ts`): `curriculum.applied`, `curriculum.closure_awarded` e `curriculum.quiz_failed`. São a fonte determinística para XP/níveis (meta 5), stats (meta 6) e flashcards (meta 4).

**Fase 3: tools do agente, cerca de 3 dias**

- `src/agent/tools/curriculum.ts` com `read_curriculum` (escopado: região, fronteira, ancestrais), `read_topic`, `search_topics` (nova), `propose_ingest`, `propose_expand`, `create_closure_quiz` e `present_checkpoint` (formativo).
- Usar `serverExecute`, TypeBox, Zod no `execute`, idempotência por `toolCallId` e erros como `isError` (o modelo corrige).
- Reaproveitar o `questionResult()` existente para os cards.
- Quiz de fechamento como subagente efêmero com tools restritas (o learnharness já tem `src/agent/subagents`).
- Incluir no prompt as regras de §8.3, combinadas com `docs/teaching-methodology.md` do learnharness.

**Fase 4: expansão procedural (meta 1), cerca de 4–6 dias**

- Gatilho determinístico (sem IA): quando `|ready_topic_ids ∩ zona_atual| < k`, ou quando o aluno fecha um tópico a ≤ d saltos de uma folha sem sucessores, ou quando a cobertura de horas estimadas de uma região fica abaixo da meta semanal. Então o sistema enfileira um job (`src/store/jobs.ts`) "expandir região R".
- O job chama o modelo com contexto da região e `propose_expand`. O validador garante I1–I5.
- Política:
  - ops de baixo risco (folhas novas dentro de uma zona existente, recursos novos): **auto-apply** com recibo e toast "desfazer";
  - ops estruturais (novas zonas ou subdomínios, novas arestas `requires` entre tópicos existentes): card de revisão.
- Estender o contrato: `upsert_zone.parent_zone_id`, `zone.resources[]` (capítulos de livro cobrindo a região), `topic.resources[].{order, lang, kind}`, além de `deprecate_topic` e `merge_topics` com regras novas no validador.

**Fase 5: UI, cerca de 4–6 dias**

- Canvas sobre `@xyflow/react` e `d3-force`, com âncoras de `buildAnchorMap` e contornos de `buildZoneContour` em estilo cel shading (traço grosso, 2–3 tons). LOD por zona: nível de zoom baixo mostra só os hulls e a contagem.
- Painel "antes disto": `pathLayers`. Card de proposta com contagens do preview, erros e warnings, e o botão Apply. Lista de snapshots com rollback por domínio.

**Fase 6: SIWC hardening (meta 7), cerca de 1–2 dias**

- Discovery validado, tabela de erros por código, `safeStorage` e teste de stream com `completed.output = []`.
- Opcional: `web_search` hospedado para curadoria de livros e vídeos, com `grounding_used` na proveniência.

### 15.2 Mapeamento às metas

| Meta | O que o Clew dá | O que falta construir |
|---|---|---|
| 1. Grafo massivo e expansão | contrato de proposta, validador DAG e conectividade, apply com recibo e rollback, fronteira, closure, layout radial e hull | escalabilidade (contexto escopado, LOD), hierarquia de zonas, recursos ordenados (livro, vídeo, aula IA), gatilho procedural, ops de remoção e merge, invariantes formais |
| 2. Memória | `turn_context` com toggles; `missed_questions`, `fail_count` e `recent_quiz_attempts` como sinais de ponto fraco; MCP read-only | memória SOTA (ver `docs/research/r4-memoria-contexto-sota.md`); compactação |
| 3. Sessões por domínio | grafo por assunto; chats por grafo e por tópico; estado de UI chaveado por `graph:session` | snapshot e rollback **por domínio** (o Clew é global) |
| 4. Flashcards | ponte Obsidian (import/export atômico, frontmatter de relações) | geração de cartões ao fim da sessão (Anki ou Obsidian SR) |
| 5. XP e níveis | eventos determinísticos de closure e tentativa (score, `fail_count`, nível e dificuldade do tópico) | cálculo de XP e calibração Monte Carlo |
| 6. Stats | — (descarta usage) | capturar `usage` por modelo e horas por dia |
| 7. Assinaturas | já no learnharness; o Clew confirma o protocolo e os quirks e oferece a tabela de erros | hardening (§9.4) |
| 8. UI | paletas Midnight e Paper, hull de zonas, deriva ociosa determinística | cel shading, SVGs à mão |
| 9. Didática | regras do prompt base, quiz só quando pedido ou formal, um único status de preâmbulo | integrar à metodologia do learnharness |

### 15.3 Casos de teste a portar (critérios de aceitação)

De `backend/tests/test_proposal_tools.py`:

- Apply atômico com recibo de chat e idempotente (o mesmo snapshot id).
- Proposta velha retorna 409 sem sobrescrever edições.
- Proposta sem revisão retorna 409.
- `proposal_id` reutilizado com outras ops retorna 409.
- Rollback nunca reusa revisão.
- Retry depois de outra edição retorna o workspace atual.
- Edição parcial preserva os campos omitidos.
- URL `javascript:` é rejeitada sem sanitização.
- Ids de resource são estáveis (`{topic}_resource_1`).
- Zona desconhecida falha sem ser fabricada.
- Zona de um só tópico é válida sem warning.
- A IA não concede `mastered` a tópico novo.
- Versão velha no momento da tool gera "read_graph again".
- Escrita velha do workspace inteiro gera conflito.
- Substituição de aresta valida a topologia final.
- Ciclos próprios e transitivos são rejeitados antes da revisão e no apply, inclusive ciclo entre tópicos novos.
- `supports` e `bridges` não contam como ciclo.
- Repositório rejeita ciclo sem gravar snapshot nem recibo.
- Payload extra é rejeitado ("exactly one payload").

De `test_quiz_service.py` e `test_quiz_routes.py`:

- Closure bloqueia pré-requisitos abertos.
- Concede estado só com pré-requisitos fechados.
- Reprovação gera `needs_review`.
- Quantidade inválida falha sem truncar.
- Perguntas duplicadas são rejeitadas.
- `fail_count` sobrevive à substituição da tentativa.
- Consumo do quiz e snapshot acontecem na mesma transação.
- Quiz consumido não gera segundo snapshot.
- Resposta pública esconde o gabarito.
- 9 de 12 com limiar 0.75 é tratado conforme a config.
- Mudança de pré-requisito durante a correção não concede conclusão.
- Respostas duplicadas, fora do intervalo ou booleanas são rejeitadas.

De `test_agent_runtime.py`:

- Card encerra a geração e a resposta abre um turno separado com role `developer`.
- Card não pode ser respondido duas vezes.
- Stop e restart deixam o card respondível.
- Tool de proposta não altera o grafo.
- Operações inválidas voltam como erro real ao modelo.
- Modelo explícito indisponível falha sem substituição.
- Loop é limitado.
- Quiz de fechamento usa só as tools de quiz e falha se o modelo não criar o quiz.

De `graphCanvasCore.test.ts` e `graph.test.ts`:

- Escolha da menor zona.
- Não há recursão infinita em ciclo.
- Hull contém os pontos.
- Movimento ocioso determinístico e limitado.

---

## 16. Questões em aberto

- A rota plan-sharing aceita de fato `{"type":"web_search"}` e o tipo `namespace` que o learnharness usa? O Clew usa o primeiro; o learnharness usa o segundo. Validar com uma conta real.
- O `streamSimple` do pi-ai lida com `response.completed.output == []` quando os itens vêm só em `output_item.done`?
- Os endpoints hardcoded do learnharness (`/api/accounts/*`) coincidem com o que o discovery OIDC publica hoje?
- Política de auto-apply para a expansão procedural: qual o limite de "baixo risco" aceitável para o usuário?
- Lean 4: vale o custo de provar a preservação do DAG, ou bastam testes de propriedade e o validador de Kahn (que é a checagem executável)?
