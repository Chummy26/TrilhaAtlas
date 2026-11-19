# extra-GeminiLight__gen-mentor: análise completa e plano de port

> Escopo: `C:\Users\nicoolas\Pictures\learnharness\_refs\extra\GeminiLight__gen-mentor`, clone raso de `https://github.com/GeminiLight/gen-mentor`, somente leitura.
> Nenhum código do repositório foi executado, instalado ou compilado. Não rodei `pnpm`, `make`, `vitest` nem scripts `.sh`/`.py` dele. As únicas operações git foram leitura: `fetch --depth 1` da tag `prompts-baseline` e do branch `v0.1-demo`, depois `git show`/`git diff`.
> Data da análise: 2026-11-18. Autor: subagente de pesquisa (extra-GeminiLight__gen-mentor).
> Lido por inteiro:
> - Documentação: `README.md`, `AGENTS.md`, `LICENSE`, `Makefile`, `app/package.json`, `app/.env.example`, `.github/workflows/gate.yml`.
> - Código: `app/src/lib/agents/*` (9 arquivos), `app/src/lib/llm/*` (8), `app/src/lib/prompts/*` (16), `app/src/lib/schemas/*` (10), `app/src/lib/store/*` (9), `app/src/lib/{pipeline,api,client,search,quiz,quiz-review,configuration}.ts`, as 13 rotas `app/src/app/api/*/route.ts`, `features/onboarding/use-onboarding.ts`, `features/settings/use-model-catalog.ts`, `features/path/reschedule-dialog.tsx`, `features/progress/skill-tree.tsx`.
> - Testes: `agents/__tests__/*.test.ts`, `fake-llm.ts`, `llm/core.test.ts`, `llm/model-catalog.test.ts`, `store/completion.test.ts`, `learning-evidence.test.ts`.
> - Avaliação: `scripts/eval-prompts.sh`, `scripts/eval-report.py`, `app/scripts/eval-prompts.eval.ts`, `app/vitest.eval.config.mts`, `e2e/fixtures/eval/cases.json`, `e2e/specs/agents.spec.ts`.
> - Wiki: `wiki/02-system-architecture.md`, `wiki/04-api-reference.md`, `wiki/80-known-pitfalls.md`, `wiki/85-backlog.md`, `wiki/00-product-proposal.md`, `wiki/reviews/review-2026-09-09-prompt-eval.md`, `wiki/reviews/review-2026-09-19-product-audit.md`, `docs/rebuild/GO.md` (partes relevantes).
> - Branch Python `v0.1-demo` (via `git show`): `backend/modules/learner_simulation/*`, os agentes de path scheduler, feedback simulator e skill mapper, `backend/config/default.yaml`.
> - Paper: arXiv 2501.15749, versão HTML, para os números de avaliação.

---

## 0. TL;DR

- **O que é:** implementação oficial em TypeScript/Next.js 16 do paper **GenMentor** (WWW 2025, Industry Track, oral).
  - O pipeline tem nove agentes: objetivo → *skill gap* → perfil do aprendiz → trilha de ≤10 sessões → conteúdo (explorar → rascunhar → integrar) → quiz → atualização do perfil. Há também um tutor de chat.
  - Cada agente é um prompt mais um schema zod mais uma chamada JSON com uma re-pergunta corretiva.
  - A aplicação é um monólito Next.js sem banco. O "arquivo do aluno" fica em `localStorage` (zustand + persist) e pode ser exportado.
- **Licença:** **CC0 1.0** (domínio público), no `main` e no branch `v0.1-demo`. É totalmente compatível com AGPL-3.0: podemos copiar, modificar e relicenciar sob AGPL sem obrigação de atribuição. Recomendo citar o paper mesmo assim. CC0 §4a **não** cede marca: não use o nome nem o logo "GenMentor" no produto.
- **Estado atual (2026-11-18):**
  - Upstream: 137 stars, 23 forks, 92 commits no `main`, 1 issue aberta.
  - HEAD `79fc182`, de 2026-10-23 (só docs). O código de agentes estabilizou em setembro de 2026.
  - Projeto vivo, com app público em `genmentor.aurax.live`.
- **O que vale ouro para nós (TS puro, sem dependências pesadas):**
  1. `app/src/lib/llm/core.ts` + `partial-json.ts`: `extractJSON` tolerante (cercas, prosa, vírgula final, `\n` cru, aspas sem escape, cauda truncada) e `parsePartialJSON` para **renderizar JSON em streaming**.
  2. `app/src/lib/agents/run.ts`: `runJSON`/`streamJSON`, que validam com zod e, se falhar, **re-perguntam uma vez mostrando ao modelo as *issues* exatas**.
  3. Os **14 prompts** em `app/src/lib/prompts/` (12 do paper + 2 de "hands-on"), mais a tag `prompts-baseline` com o texto verbatim do paper.
  4. Os **schemas zod com a política "reparar, não rejeitar"**:
     - `is_gap` é derivado no código.
     - `reason` é cortado em 20 palavras.
     - Há dedupe por nome com limite de 10.
     - `overall_progress` é limitado a 0..100.
     - A trilha é cortada em 10 sessões.
  5. `store/reconcile-path.ts`: reconciliação de uma trilha regenerada por **fingerprint de conteúdo**. É exatamente o que precisamos quando o grafo se expande proceduralmente sem perder progresso.
  6. `store/completion.ts`: **a conclusão local é um fato, a estimativa do modelo é assíncrona**. Usa uma fila serial por objetivo com retry.
  7. `quiz.ts`/`quiz-review.ts`/`configuration.ts`: correção local, fila de revisão e uma métrica de acurácia honesta (só itens objetivos no denominador).
  8. `agents/hands-on-review.ts`: um **gate de qualidade real em dois estágios**. O modelo rápido gera e o modelo forte audita; só passam itens aprovados e nunca se inventa gabarito.
  9. O harness de **avaliação A/B de prompts** (`scripts/eval-prompts.sh` + `vitest.eval.config.mts`), que troca o diretório de prompts por alias, mais o **record/replay** de chamadas LLM por hash (`llm/replay.ts`).
- **Alertas importantes, verificados no código:**
  1. **O "Learner Feedback Simulator" existe, mas não está ligado a nada.**
     - A rota `/api/simulate-feedback` e o agente existem, mas há **zero chamadas na UI** (a própria auditoria do repo admite isso, item A07).
     - O laço simulador → refinar (`schedulePath` task `refine`) também nunca é orquestrado.
     - Nem o código Python do paper o orquestra: só expõe as peças.
     - O módulo Python `learner_simulation/` (perfil *ground-truth* + simulador de comportamento por sessão) **não foi portado** para TS. Ele está no branch `v0.1-demo` e é o melhor ponto de partida para o "aluno sintético".
  2. **O modelo fine-tuned de goal→skill do paper não foi publicado.** Isso inclui o GPT-4o/Llama 3.2 3B treinados em 10 mil vagas do LinkedIn, com recall 0,67 contra 0,48 do CoT. O "Skill Mapper" do repo é só um prompt (≤10 skills) enviado a qualquer modelo.
  3. **O integrador de documento gera um `content` sintetizado que é descartado.**
     - `renderMarkdown` em `agents/knowledge.ts` concatena os *drafts* crus e só usa `title`/`overview`/`summary` do integrador.
     - Isso custa cerca de 134 s em média em tokens jogados fora.
  4. Prompts **só em inglês, sem controle de idioma de saída** (auditoria A05). O tutor tem um estilo "encorajador + quizzes rápidos", o oposto do que o usuário pediu (meta 9).
  5. Os limites são de escala "curso curto": 10 skills por objetivo e 10 sessões por trilha. Não serve sozinho para um grafo de 1000–1500 h. Deve ser usado **por região do grafo**.
  6. O `overall_progress` e o perfil reescrito inteiro pelo LLM são **instáveis**: o mesmo caso dá 20 % ou 60 % entre execuções (review de prompts). O próprio repo passou a derivar o progresso de dados (`learning-evidence.ts`).
- **Para o learnharness:**
  - **Não** portar a camada de SDK: `llm/index.ts`, `config.ts` e `context.ts` usam `openai`/`@anthropic-ai/sdk` com BYOK em localStorage. Nosso app já tem pi-ai com slots Strong/Cheap, assinatura ChatGPT e catálogo federado em `src/server/model-catalog.ts`.
  - **Portar**:
    - os prompts (traduzidos e adaptados);
    - os schemas;
    - `extractJSON`/`parsePartialJSON`;
    - o padrão de re-pergunta corretiva (ou usar nosso `runSubmitAgent` com TypeBox);
    - `reconcilePath`, `completion`, `quiz`/`judge`, `sessionMinutes`;
    - o harness de avaliação.
  - **Implementar nós mesmos** o laço do simulador como gate (com rubrica numérica) e o aluno sintético, usado para avaliação offline e para calibrar XP por Monte Carlo.

---

## 1. Identificação e inventário

| Item | Valor |
|---|---|
| Upstream | `https://github.com/GeminiLight/gen-mentor`: 137 stars, 23 forks, 92 commits em `main`, 1 issue aberta (consultado em 2026-11-18) |
| HEAD local | `79fc182c5d8027297f5233f9a6e790081da616f2`, 2026-10-23, "docs: refresh canonical website links after domain migration (#37)" |
| Tag `prompts-baseline` | commit `88c95754d6bf…`, 2026-09-09, "feat(agents): port the nine GenMentor agents to TypeScript with verbatim prompts and replayable routes" |
| Tags `v0.1.0` = `paper-python-v1` = branch `v0.1-demo` | `7a22a545…`. É a implementação Python do paper: FastAPI + Streamlit + LangChain |
| Outros branches | `codex/domain-migration`, `codex/issue-31-hands-on`, `feat/live-demo-link`, `feat/product-audit-fixes`, `gh-pages`, `polish/ui-seo-geo-friendlink` |
| Licença | CC0 1.0 Universal (`LICENSE`), igual em `v0.1-demo` |
| Stack | Node 24, pnpm 11.25, Next.js **16.3.4** (App Router), React 19.2.8, TS strict, Tailwind v4, shadcn, `motion`, **zod ^4.5.4**, zustand ^5.0.15, `openai` ^7.10.0, `@anthropic-ai/sdk` ^0.124.0, `unpdf` ^1.8.1, `react-markdown` + `remark-gfm` + `shiki`, Recharts, vitest ^5, Playwright + axe |
| Arquivos | 378 no total (sem `.git`), dos quais 34 fixtures LLM gravadas em `e2e/fixtures/llm/*.json` |
| LOC do núcleo (`app/src/lib`) | agents 404, llm 664 (com testes), prompts 852, schemas 371, store 441, utilidades (`pipeline`, `api`, `client`, `search`, `quiz`, `quiz-review`, `configuration`) 530. Rotas: 247 |
| Documentação | `wiki/` em chinês (arquitetura, API, armadilhas, backlog, reviews datadas), `docs/rebuild/GO.md` (plano da reescrita) |

Mapa do repositório:

```
gen-mentor/
├── app/                         # único app Next.js
│   ├── src/app/api/*/route.ts   # 13 rotas, único ponto que chama LLM (≤120 linhas cada)
│   ├── src/lib/llm/             # core portátil (sem SDK), index (SDK + roteamento fast/smart), replay, partial-json, model-catalog
│   ├── src/lib/prompts/         # ÚNICA fonte de texto de prompt (14 arquivos + format.ts)
│   ├── src/lib/schemas/         # zod = único contrato de dados (requests e respostas do modelo)
│   ├── src/lib/agents/          # orquestração dos 9 agentes (+ hands-on-review)
│   ├── src/lib/store/           # zustand + persist (arquivo do aluno), derivações puras
│   ├── src/lib/{pipeline,quiz,quiz-review,configuration,search,client,api}.ts
│   ├── src/features/<domínio>/  # UI por domínio
│   └── scripts/eval-prompts.eval.ts
├── e2e/                         # Playwright; fixtures LLM (record/replay); casos de avaliação
├── scripts/                     # gate.sh, verify-ui.sh, eval-prompts.sh, eval-report.py
└── wiki/                        # docs numeradas (00–04, 80, 85, 90, reviews/)
```

---

## 2. Licença e compatibilidade com AGPL-3.0

- O **CC0 1.0** renuncia a todos os direitos autorais (§2). Onde a renúncia não valer, entra uma licença pública **irrevogável, sem condições, para qualquer finalidade** (§3).
- Isso não impõe atribuição, *copyleft* nem *notice*. Consequência: **qualquer arquivo do repo pode ser incorporado ao nosso código AGPL-3.0**. O trecho passa a ser distribuído sob AGPL como parte da nossa obra, e não há conflito.
- Ressalvas:
  - **§4a:** marcas e patentes **não** são renunciadas. Não use "GenMentor", o logo (`resources/logo.svg`, `app/public/logo*.svg`) nem o domínio.
  - **§4c:** o autor não garante que terceiros não tenham direitos. Os prompts são do paper; o texto publicado pela ACM é outra obra, mas os prompts foram liberados no repo sob CC0. As fixtures em `e2e/fixtures/llm/` contêm saídas de modelo (GLM), sem relevância autoral.
- Boa prática, sem obrigação: cabeçalho nos arquivos portados.

```ts
// Adapted from GeminiLight/gen-mentor (CC0-1.0), https://github.com/GeminiLight/gen-mentor
// Wang et al., "LLM-powered Multi-agent Framework for Goal-oriented Learning in ITS", WWW'25 Companion.
```

---

## 3. Arquitetura

### 3.1 Visão geral

```mermaid
flowchart LR
  subgraph Browser
    UI[features/*] --> CLIENT[lib/client.ts api.*]
    PIPE[lib/pipeline.ts runPipeline] --> CLIENT
    STORE[(zustand persist<br/>localStorage genmentor.archive.v1)]
    UI <--> STORE
    PIPE -- checkpoints --> STORE
  end
  CLIENT -- "POST JSON + header x-genmentor-llm (BYOK)" --> ROUTES
  subgraph "Next.js API routes (server)"
    ROUTES[app/api/*/route.ts<br/>parseBody(zod)] --> WITH[withRequestLLM<br/>AsyncLocalStorage]
    WITH --> AGENTS[lib/agents/*]
    AGENTS --> RUN[agents/run.ts runJSON / streamJSON / streamText]
    RUN --> PROMPTS[lib/prompts/* + fill()]
    RUN --> LLM[lib/llm/index.ts createLLM<br/>tier fast/smart → modelo]
    LLM --> MODE{GENMENTOR_LLM_MODE}
    MODE -- live --> SDK[openai / @anthropic-ai/sdk]
    MODE -- record --> SDK
    MODE -- replay --> FIX[(e2e/fixtures/llm/hash.json)]
    AGENTS --> SEARCH[lib/search.ts Tavily opcional]
  end
  ROUTES -- "JSON ou text/plain stream + @@final/@@error" --> CLIENT
```

Princípios explícitos em `AGENTS.md`:

- LLM só é chamado dentro de API routes, nunca no browser.
- Prompt só existe em `lib/prompts/`.
- Todo request é validado com zod via `parseBody`.
- Não há banco nem conta.
- Saída estruturada é feita **pedindo JSON no prompt e parseando de forma tolerante**. Não se usa *structured output* do SDK, porque o gateway GLM usado não suporta.

### 3.2 Camadas e responsabilidades

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Core LLM portátil | `app/src/lib/llm/core.ts` | Tipos (`Tier`, `ChatOpts`, `LLM`, `TextRun`), formato de request por provider (`anthropicArgs`, `openaiArgs`), `extractJSON`, `jsonCall`. **Não importa SDK nem lê `process.env`** |
| JSON parcial | `app/src/lib/llm/partial-json.ts` | `fixUnescapedQuotes`, `escapeControlCharsInStrings`, `parsePartialJSON` |
| LLM do servidor | `app/src/lib/llm/index.ts` | `createLLM(cfg)` instancia o SDK sob demanda; `withTierDefaults` (no tier fast, thinking=false); `toHttpError` mapeia para 401/429/503/422/502 |
| Config | `app/src/lib/llm/config.ts` | `serverConfig()` lê do env; `ByokHeaders` (zod) e `byokFromRequest` leem o header `x-genmentor-llm` |
| Contexto | `app/src/lib/llm/context.ts` | `AsyncLocalStorage<LLM>`: `withLLM`/`currentLLM` (seleção por request sem passar parâmetro) |
| Replay | `app/src/lib/llm/replay.ts` | live/record/replay; `fixtureHash` sha256(24 hex) de {model, tier, system, messages, maxTokens, effort, thinking} |
| Catálogo | `app/src/lib/llm/model-catalog.ts` | `listModels(connection)`: GET `/models` (OpenAI-compat) ou `/v1/models` (Anthropic, paginado) |
| Execução de agente | `app/src/lib/agents/run.ts` | `runJSON`, `streamJSON`, `streamText` |
| Prompts | `app/src/lib/prompts/*.ts` + `format.ts#fill` | Textos e placeholders `{snake_case}` |
| Schemas | `app/src/lib/schemas/*.ts` | Contrato com transformações de reparo |
| Rotas | `app/src/app/api/*/route.ts` | `parseBody` → `withRequestLLM` → agente → JSON ou `taskStream` |
| Cliente | `app/src/lib/client.ts` | `post`, `postStream` (protocolo `@@final`/`@@error`), `api.*` tipados com `z.input` dos schemas |
| Pipeline | `app/src/lib/pipeline.ts` | explore → draft (paralelo) → integrate → quiz, com checkpoint por estágio |
| Estado | `app/src/lib/store/*` | Arquivo do aluno, conclusão, derivações (minutos, progresso), reconciliação de trilha |

---

## 4. Camada LLM: APIs e algoritmos

### 4.1 Tipos centrais (`llm/core.ts`)

```ts
export type Provider = "anthropic" | "openai";
export type Tier = "fast" | "smart";
export interface ChatOpts { tier: Tier; system: string; messages: ChatMessage[]; maxTokens: number;
  effort?: "low" | "medium" | "high"; thinking?: boolean }
export interface TextRun { deltas: AsyncIterable<string>; text: () => string }
export interface LLM { chatText(o: ChatOpts): Promise<string>; chatStream(o: ChatOpts): TextRun }
export class LLMError extends Error { constructor(message: string, public status = 502, public retryable = false) }
```

- `anthropicArgs(o, model)`:
  - coloca o system como bloco com `cache_control: {type:"ephemeral"}` (prompt caching grátis no system);
  - envia `thinking:{type:"disabled"}` se `o.thinking === false`;
  - envia `output_config:{effort}` se houver `effort`.
- `openaiArgs(o, model, tokenParam, disableThinking)`:
  - usa `max_tokens` ou `max_completion_tokens`, configurável;
  - envia `thinking` só se `disableThinking`, porque gateways GLM aceitam e a OpenAI oficial rejeita;
  - envia `reasoning_effort`.

### 4.2 `extractJSON`, o parser tolerante

Algoritmo:

1. `stripLeadingFence`: só remove a cerca `` ``` `` se ela vier **antes** do primeiro `{`/`[`. Cercas `` ```python `` dentro de strings são preservadas.
2. `isolateJSON`: acha o primeiro `{`/`[` e varre contando profundidade, respeitando strings e escapes. Corta no primeiro fechamento balanceado, o que descarta prosa e uma chave extra no final.
3. Tenta `JSON.parse` em cadeia de reparos crescentes:

```ts
const attempts = [
  () => s,
  () => s.replace(/,\s*([}\]])/g, "$1"),                                   // vírgula final
  () => escapeControlCharsInStrings(s.replace(/,\s*([}\]])/g, "$1")),       // \n cru em string
  () => fixUnescapedQuotes(escapeControlCharsInStrings(/*…*/)),             // aspas internas sem escape
];
// por fim: parsePartialJSON(s) (fecha estruturas truncadas); vazio → LLMError("not valid JSON", 502, retryable=true)
```

- `fixUnescapedQuotes` usa uma heurística: uma `"` dentro de string só fecha a string se o próximo caractere não-branco for `, } ] :` ou fim de texto. Senão vira `\"`. Isso cobre o caso de prosa em chinês (被"事实"接住) e funciona igual para PT-BR com aspas.
- `jsonCall(opts, llm)`: se a primeira resposta não tem JSON (erro *retryable*), repete com o sufixo "Return ONLY the JSON. No prose.".

### 4.3 `parsePartialJSON`, JSON em streaming

- Fecha strings, arrays e objetos abertos usando uma pilha.
- Aplica reparos progressivos no ponto de corte:
  - chave pendurada `"key":`;
  - `"key` sem dois-pontos;
  - número incompleto `0.`;
  - literal incompleto (`tru`, `fals`, `nu`, …);
  - objeto meio escrito no fim de um array.
- Retorna `null` antes do primeiro `{`.
- O teste em `core.test.ts` mostra a progressão:

```ts
// '{"path": [{"id": "S1", "title": "In'  → { path: [{ id: "S1", title: "In" }] }
// … '{"id": "S2", "ti'                     → { path: [{…"Intro"}, { id: "S2" }] }
```

- O cliente usa isso para mostrar títulos de sessões e o texto do rascunho **enquanto** o modelo gera.

### 4.4 Execução de agente (`agents/run.ts`)

```ts
export interface AgentCall { tier: Tier; system: string; task: string; vars: Record<string, PromptValue>; maxTokens?: number }
const DEFAULT_JSON_TOKENS = 8000;            // reasoning models gastam parte pensando

export async function runJSON<S extends z.ZodType>(call: AgentCall, schema: S): Promise<z.output<S>> {
  const user = fill(call.task, call.vars);
  const first = await jsonCall<unknown>({ tier, system, maxTokens, user });
  const parsed = schema.safeParse(first);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
  const retry = await currentLLM().chatText({ …, messages: [
    { role: "user", content: user },
    { role: "assistant", content: JSON.stringify(first) },
    { role: "user", content: `Your previous answer violated the output contract:\n${issues}\n\nReturn the corrected JSON only, conforming exactly to the specified format.` },
  ]});
  const second = schema.safeParse(extractJSON(retry));
  if (second.success) return second.data;
  throw new LLMError(`Model output failed validation twice: ${issues}`, 502);
}
```

- `streamJSON(call, schema, onDelta)` faz o mesmo em streaming.
  - Repassa cada delta; no fim, faz `extractJSON` + `safeParse`.
  - Se falhar, faz uma re-pergunta **não-streamed** cujo resultado vira o `@@final`.
  - A UI vê o primeiro stream e depois recebe a versão corrigida.
- `streamText(call)` é texto livre (tutor), com `maxTokens` padrão 4000.
- No pior caso há até **4 chamadas LLM por agente**: nudge de JSON mais re-pergunta corretiva, cada uma podendo repetir.

### 4.5 `fill()` (`prompts/format.ts`)

```ts
export function fill(template: string, vars: Record<string, PromptValue>): string {
  return template.replace(/(?<!\{)\{([a-z_]+)\}(?!\})/g, (_, key) => {
    if (!(key in vars)) throw new Error(`Prompt placeholder {${key}} was not provided`);
    return stringify(vars[key]);           // objetos → JSON.stringify(v, null, 2)
  });
}
```

- Só aceita placeholders `{snake_case}` minúsculos.
- Exemplos JSON nos prompts não colidem, porque têm `{` seguido de quebra de linha ou aspas.
- Um placeholder faltando **lança erro** em vez de vazar `{x}` para o modelo.
- Substitui numa única passada, então valores do usuário com `{foo}` não são reinterpretados.

### 4.6 Roteamento por tier e BYOK (`llm/index.ts`, `config.ts`)

- `serverConfig()` lê `LLM_PROVIDER`, `LLM_API_KEY` (com *fallback* para `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`), `LLM_BASE_URL`, `LLM_FAST_MODEL`, `LLM_SMART_MODEL`, `LLM_OPENAI_TOKEN_PARAM` e `LLM_OPENAI_THINKING`.
- **Defaults hardcoded** em `DEFAULT_MODELS`: `anthropic: {fast:"claude-sonnet-5", smart:"claude-opus-5"}`, `openai: {fast/smart:"glm-5.3-flash"}`. É um anti-padrão para nossa meta 7.
- `withTierDefaults`: no tier `fast` o thinking vem desligado por padrão. Num gateway GLM, isso reduziu a latência de 30 s para 18 s.
- BYOK:
  - O browser guarda `{provider, apiKey, baseUrl?, fastModel?, smartModel?, disableThinking?}` em `localStorage["genmentor.llm.v1"]`, **em texto puro** (auditoria A14).
  - Envia isso no header `x-genmentor-llm`.
  - A rota cria um `LLM` só para aquele request e o põe no `AsyncLocalStorage`.
- Clientes SDK: `maxRetries: 2`, `timeout: 180_000`.
- `toHttpError` prefere a mensagem do próprio provider, `e.error.message`.

### 4.7 Record/replay (`llm/replay.ts`)

- `GENMENTOR_LLM_MODE=live|record|replay`.
  - Em `replay`, uma fixture ausente é **erro**, nunca uma chamada live silenciosa.
  - O hash cobre tudo que molda a resposta, então editar um prompt invalida as fixtures. A armadilha documentada: regravar leva cerca de 25 min.
- `chunked(text, 24)` simula o stream no replay, exercitando o JSON parcial.
- BYOK é sempre live.
- No replay, a busca Tavily é desligada, porque o texto da busca entra no hash.

### 4.8 Protocolo de streaming (`lib/api.ts` + `lib/client.ts`)

- Resposta `text/plain` com os deltas crus do modelo.
- No fim vem `\n@@final\n<json validado>`, ou `\n@@error\n<msg>`, porque o status HTTP já foi enviado.
- Headers: `Cache-Control: no-store`, `X-Accel-Buffering: no`.
- `postStream` no cliente:
  - acumula o texto;
  - chama `onDelta` com o prefixo até `\n@@`;
  - no fim, lança erro em `@@error` ou faz parse do `@@final`.
- Esse protocolo é simples e funciona em Vercel/Electron sem SSE. Para nós, o learnharness já tem streaming nativo de eventos pi (`src/server/pi/ui-stream.ts`), então o protocolo é útil só como referência.

---

## 5. Os agentes: prompts e fluxos

### 5.1 Tabela-resumo

| Agente (paper) | Arquivo / função | Prompt (`lib/prompts/`) | Tier | Schema de saída | Stream | maxTokens |
|---|---|---|---|---|---|---|
| Goal Refiner | `agents/goal.ts#refineGoal` | `goal-refiner.ts` | fast | `RefinedGoal {refined_goal}` | não | 8000 |
| Skill Mapper | `goal.ts#mapSkills` | `skill-mapper.ts` | smart | `SkillRequirements {skill_requirements[≤10]}` | não | 8000 |
| Skill Gap Identifier | `goal.ts#identifySkillGaps` (chama o mapper se faltarem requisitos) | `skill-gap-identifier.ts` | smart | `SkillGaps` + requisitos | não | 8000 |
| Adaptive Learner Profiler | `agents/profile.ts#initializeProfile` (Task A) / `#updateProfile` (Task B) | `learner-profiler.ts` | fast | `LearnerProfile` | não | 8000 |
| Learning Path Scheduler | `agents/path.ts#schedulePath` (create/refine/reschedule) | `path-scheduler.ts` | smart | `LearningPath {learning_path[≤10]}` | **sim** | 8000 |
| Knowledge Explorer | `agents/knowledge.ts#exploreKnowledge` | `knowledge-explorer.ts` | smart | `KnowledgePoints` | não | 8000 |
| Knowledge Drafter | `knowledge.ts#draftKnowledge` (+ Tavily) | `knowledge-drafter.ts` | smart | `KnowledgeDraft {title, content, sources}` | **sim** | 12 000 |
| Document Integrator | `knowledge.ts#integrateDocument` + `renderMarkdown` | `document-integrator.ts` | smart | `DocumentStructure` | **sim** | 12 000 |
| Quiz Generator | `agents/quiz.ts#generateQuiz` | `quiz-generator.ts` (+ `hands-on-quiz.ts`) | fast | `DocumentQuiz` | não | 8000 |
| (hands-on reviewer) | `agents/hands-on-review.ts#reviewHandsOn` | `hands-on-review.ts` | smart | `{ordering_approved, configuration_approved, reason}` | não | 8000 |
| Learner Feedback Simulator | `agents/feedback.ts#simulateFeedback` (path/content) | `feedback-simulator.ts` | fast | `LearnerFeedback` | não | 8000 |
| AI Chatbot Tutor | `agents/tutor.ts#tutorReply` (+ Tavily opcional) | `tutor.ts` | fast | texto | **sim** | 4000 |
| (Content Creator, Task A/B/C) | **nenhum, código morto** | `content-creator.ts` | — | `ContentOutline`/`LearningContent` existem nos schemas | — | — |

O paper fala de um "Performance Evaluator", que **não existe** aqui (`wiki/04-api-reference.md`). A avaliação entra pelo `quiz_performance` passado ao profiler na Task B.

### 5.2 `goal.ts`: objetivo → skills → gaps

```ts
export function refineGoal(input: { learning_goal: string; learner_information?: string })    // fast
export function mapSkills(input: { learning_goal: string })                                   // smart
export async function identifySkillGaps(input: { learning_goal; learner_information; skill_requirements?: SkillRequirements | null }) {
  const skill_requirements = input.skill_requirements ?? (await mapSkills({ learning_goal }));
  const gaps = await runJSON({ tier: "smart", system: skillGapIdentifierSystem, task: skillGapIdentifierTask,
                               vars: { learning_goal, learner_information, skill_requirements } }, SkillGaps);
  return { ...gaps, ...skill_requirements };   // { skill_gaps, skill_requirements }
}
```

Diretivas-chave dos prompts:

- **Goal Refiner:**
  - Usar `learner_information` para dar especificidade.
  - "Subtly enhance", sem mudar a intenção.
  - Não adicionar skills, trilha nem prazos.
  - Uma única frase de saída.
- **Skill Mapper:**
  - No máximo **10** skills, "less is more".
  - Competências específicas e acionáveis, não tópicos amplos.
  - `required_level ∈ {beginner, intermediate, advanced}`.
- **Skill Gap Identifier:**
  - Para cada requisito, inferir `current_level ∈ {unlearned, beginner, intermediate, advanced}` a partir do currículo.
  - "Don't assume unlearned": inferir por projetos e cargos relacionados.
  - `reason` com no máximo 20 palavras.
  - `level_confidence ∈ {low, medium, high}`.
- Placeholders:
  - refiner: `{learning_goal}`, `{learner_information}`;
  - mapper: `{learning_goal}`;
  - gap: `{learning_goal}`, `{learner_information}`, `{skill_requirements}`.

### 5.3 `profile.ts`: perfil do aprendiz (Task A init, Task B update)

- O system prompt (`learnerProfilerSystem`) define três componentes:
  - **Cognitive Status**: skills dominadas e em progresso, mais `overall_progress`.
  - **Learning Preferences**: `content_style`, `activity_type`.
  - **Behavioral Patterns**: frequência, duração, gatilhos motivacionais.
- Tem CoT explícito para A e B.
- Regra: se o nível atual for maior ou igual ao requerido, a skill vai para *mastered*.
- **Task A** (`learnerProfilerInitTask`): placeholders `{learning_goal}`, `{learner_information}`, `{skill_gaps}`. Inclui um exemplo JSON completo do perfil.
- **Task B** (`learnerProfilerUpdateTask`): placeholders `{learner_profile}`, `{learner_interactions}`, `{learner_information}`, `{session_information}`. A parte mais importante para nós é o bloco de **evidência medida**:
  - `learner_interactions.quiz_performance = {session_title, total_answered, total_correct, accuracy, wrong_questions[{question, expected_answer}]}`;
  - `accuracy ≥ 0,8` sustenta registrar progresso;
  - skills ligadas a `wrong_questions` mantêm ou baixam o nível e **nunca** vão para *mastered*;
  - se `if_learned` e o nível de outcome for maior ou igual ao requerido, a skill vai para *mastered*.
- Quem chama (`store/completion.ts#refreshProfiles`) envia:

```ts
api.profile({ mode: "update", learner_profile: goal.learner_profile,
  learner_interactions: { quiz_performance: quizPerformance(task.evidence, session.title) },
  session_information: { ...session, if_learned: true } })
```

- Problema conhecido: o LLM **reescreve o perfil inteiro** a cada update.
  - `behavioral_patterns` é **inventado** no init ("4 logins por semana", "responde a badges"), segundo o backlog e o item A11.
  - Há variância alta: `overall_progress` deu 20 contra 60 no mesmo caso.

### 5.4 `path.ts`: agendador de trilha (3 tarefas)

```ts
export type PathRequest =
  | { task: "create"; learner_profile; session_count?: number }                // Task A
  | { task: "refine"; learning_path; feedback }                                // Task B (reflexão)
  | { task: "reschedule"; learner_profile; learning_path; session_count?; other_feedback? }; // Task C
export function schedulePath(req: PathRequest, onDelta?) // sempre streamJSON(..., LearningPath)
```

- **Diretivas universais:**
  - orientada ao objetivo (rota mais eficiente para fechar o gap);
  - personalizada (`learning_preferences`, `behavioral_patterns`);
  - progressiva (do fundamental ao avançado);
  - "quality over quantity", com **1 a 10** sessões.
- **Task A:** todas as sessões com `if_learned:false`. `pathSchedulerCount(0|undefined)` vira o texto "Adaptive: choose 1-10 sessions…".
- **Task B:** **não** altera sessões com `if_learned:true`. Ajusta as não aprendidas segundo o feedback (Progression/Engagement/Personalization), que é o formato de saída do simulador.
- **Task C:**
  - Preserva as sessões aprendidas **exatamente** e no início.
  - Gera novas sessões para o gap restante.
  - O total deve bater com `desired_session_count`; `-1` significa razoável (1–10).
  - Incorpora `other_feedback`.
- **Formato da sessão:** `{id:"Session N", title, abstract(≤200 palavras), if_learned, associated_skills[], desired_outcome_when_completed[{name, level}]}`.
- **Na UI:**
  - `create` é usado no onboarding (`features/onboarding/use-onboarding.ts`);
  - `reschedule` é usado no diálogo (`features/path/reschedule-dialog.tsx`), recebendo **apenas texto livre** do usuário, sem evidência de quiz;
  - `refine` **nunca** é chamado (só nos testes).

### 5.5 `knowledge.ts`: explorar → rascunhar → integrar

- **Explorer:**
  - Lista os *knowledge points* da sessão, cada um do tipo `foundational | practical | strategic`.
  - Devem ser distintos das outras sessões da trilha; "be concise".
  - Na avaliação deu 5–8 pontos.
- **Drafter** (`draftKnowledge`):
  1. Se `use_search` estiver ligado (padrão `true`, mas só com `TAVILY_API_KEY`), busca `"${session.title} ${kp.name}"` no Tavily (5 resultados, `search_depth: basic`).
  2. `formatResources` numera os resultados como `[0]`, `[1]`, … e gera `sources[{index, title, source}]`.
  3. Prompt: "Use RAG (crucial)"; cite `[N]` inline e só fontes usadas; sem `#`/`##` (use `**negrito**` como subtítulo); sem bibliografia no fim.
  4. Faz streaming e devolve `{...draft, sources}`. As fontes são proveniência de máquina, o modelo não as emite.
- **Integrator:**
  - Pede `{title, overview, content, summary}`, onde `content` é a síntese de todos os drafts.
  - **Mas** `renderMarkdown(structure, points, drafts)` monta o documento final assim:
    - `# title` + `overview`;
    - drafts **crus**, agrupados por tipo sob títulos fixos em inglês `## Foundational Concepts` / `## Practical Applications` / `## Strategic Insights`;
    - fontes por draft;
    - `## Summary`.
  - **`structure.content` nunca é renderizado.** Um grep confirma que a UI usa só `structure.title`/`overview`.
  - É o mesmo comportamento do `prepare_markdown_document` do Python.
  - Conclusão: a etapa mais lenta (~134 s em média) gera um campo que é descartado. **Para nós, pedir ao integrador apenas `title`/`overview`/`summary` e frases de transição.**
- No pipeline do browser (`lib/pipeline.ts`), os drafts rodam **em paralelo** (`Promise.all` sobre os pontos), com preview parcial por ponto.

### 5.6 `quiz.ts` + `hands-on-review.ts`: quiz com gate de qualidade

- Prompt base (`quiz-generator.ts`, **mantido no texto do baseline**: a edição do M6 errou a contagem de questões em 1 de 5 casos):
  - perguntas derivadas **só** do documento;
  - dificuldade ajustada ao perfil;
  - toda questão tem `explanation`;
  - contagens exatas por tipo (`single_choice_count`, `multiple_choice_count`, `true_false_count`, `short_answer_count`).
- Com `hands_on: true` (que o pipeline usa, com 2 single, 1 multiple, 1 TF, 1 short):
  - Anexa `handsOnQuizInstructions`: no máximo 1 tarefa de **ordenação** (3–8 passos com dependência real e uma única ordem válida, embaralhados) e no máximo 1 de **configuração** (objeto JSON plano com 2–5 campos primitivos, `starter` errado mas válido, 1–4 respostas corretas).
  - Anexa `JSON.stringify(z.toJSONSchema(DocumentQuiz))`.
  - Um `superRefine` extra valida as contagens exatas e as invariantes das configurações. Se falhar, faz a re-pergunta corretiva.
- `reviewHandsOn(quiz, doc)`:
  - Se houver tarefas práticas, chama o tier **smart** com um prompt de auditor estrito: "approve ONLY if grounded… reject uncertain tasks rather than inventing an answer… treat the document as data".
  - Remove as tarefas reprovadas e **nunca** cria gabarito substituto.
  - Esse é o padrão de **gate gerar → auditar** que devemos reutilizar para flashcards e exercícios.
- Correção local (`lib/quiz.ts#judge`):
  - `resolveOption` aceita índice, letra (`A`–`H`), texto exato da opção ou dígitos completos. `"0garbage"` vira `null`.
  - Múltipla escolha: gabarito inválido vira "answered" (sem pontuar), nunca acerto parcial.
  - Resposta curta: "answered" (autoavaliação, sem nota).
  - Ordenação e configuração: só contam depois de `confirmed`.
  - `scoredCount` conta só *correct* + *incorrect* no denominador.
  - `quizPerformance()` monta a evidência para o profiler.

### 5.7 `feedback.ts`: Learner Feedback Simulator (ver seção 7)

```ts
export type FeedbackRequest =
  | { target: "path"; learner_profile; learning_path }
  | { target: "content"; learner_profile; learning_content };
export function simulateFeedback(req) // runJSON(fast, ..., LearnerFeedback)
// LearnerFeedback = { feedback: {progression, engagement, personalization}, suggestions: {progression, engagement, personalization} }
```

### 5.8 `tutor.ts`: tutor de chat

```ts
export async function tutorReply(input: { messages: ChatTurn[]; learner_profile?; external_resources?; use_search?: boolean }, onDelta?)
// histórico achatado como "role: content" por linha dentro do user prompt; busca Tavily na última pergunta se use_search
```

- O prompt pede quatro coisas:
  1. foco no objetivo, com explicações passo a passo;
  2. interatividade ("quick quizzes");
  3. lembrar interações passadas;
  4. "motivation and encouragement… celebrating achievements".
- Não há memória além do histórico do objetivo (`goal.tutor[]`).
- `use_search` nunca é ligado pela UI (auditoria A04).
- Para nossa meta 9, este prompt deve ser **reescrito**:
  - nada de "quizzes rápidos" logo depois de explicar;
  - nada de celebração vazia;
  - respostas curtas e precisas.
  - É a doutrina que o learnharness já aplica no side-chat.

### 5.9 Mudanças de prompt: `prompts-baseline` contra HEAD (diff verificado)

`git diff prompts-baseline HEAD -- app/src/lib/prompts`: 15 arquivos, +112/−44.

| Mudança | Arquivos | Motivo declarado |
|---|---|---|
| Removido "Do NOT include any other text or markdown tags (e.g., ```json)" | 9 prompts, **menos** quiz-generator (revertido) | `extractJSON` já remove cercas |
| Removido "You have excellent reasoning skills / Excel at Inference" | skill-gap-identifier | Não ajuda modelos *reasoning* e gasta tokens |
| Removidos a instrução e o campo `is_gap` do exemplo | skill-gap-identifier | Derivado no schema |
| Removido o parágrafo duplicado de formato | skill-mapper | Redundante |
| Limpeza de `[cite_start]`, `[cite: 225-235]`, `e.GET_STARTED` | path-scheduler | Resíduos da escrita do paper |
| Correção de "create update", "coginitive" e remoção de "!!!!!!" | learner-profiler | Ortografia e tom |
| Emojis removidos | tutor | Público profissional |
| `pathSchedulerCount()` (modo Adaptive) | path-scheduler | Feature de produto |
| **Novos:** `hands-on-quiz.ts`, `hands-on-review.ts` | — | Issue #31 |

O baseline verbatim está acessível via `git show prompts-baseline:app/src/lib/prompts/<arquivo>.ts`, já buscado no nosso clone.

---

## 6. Schemas zod: a política "reparar, não rejeitar"

Arquivos: `app/src/lib/schemas/{levels,learning,content,assessment,hands-on,requests,archive,tutoring,model-catalog}.ts`. Eles espelham os modelos Pydantic do Python.

```ts
export const RequiredLevel = z.enum(["beginner","intermediate","advanced"]);
export const CurrentLevel  = z.enum(["unlearned","beginner","intermediate","advanced"]);
export const LEVEL_ORDER = { unlearned: 0, beginner: 1, intermediate: 2, advanced: 3 };
export const envelope = (key) => (v) => Array.isArray(v) ? { [key]: v } : v;   // aceita array nu
export function dedupeByName<T extends {name:string}>(items: T[], max = 10): T[]  // case-insensitive, 1ª vence

export const SkillGap = z.object({ name, is_gap: z.boolean().optional(), required_level, current_level,
    reason: z.string().transform(v => v.split(/\s+/).filter(Boolean).slice(0, 20).join(" ")),
    level_confidence: Confidence })
  .transform(g => ({ ...g, is_gap: LEVEL_ORDER[g.current_level] < LEVEL_ORDER[g.required_level] }));
```

| Schema | Reparos |
|---|---|
| `SkillRequirements`, `SkillGaps` | `preprocess(envelope)`; `min(1)` (lista vazia é erro); dedupe com limite de 10 |
| `LearnerProfile.cognitive_status.overall_progress` | `clampProgress`: string vira int, truncado e limitado a 0..100 |
| `LearningPath` | `min(1)`; `.transform(v => v.slice(0, 10))`; `associated_skills` coerce para `String(x).trim()` |
| `KnowledgeDraft.sources` | `default([])`, preenchido pelo código |
| `DocumentStructure.content/summary` | `default("")`: `summary` é o último campo e é o que some quando o orçamento acaba |
| `DocumentQuiz` | listas com `default([])`; `correct_option` como número ou string |
| `OrderingQuestion` | itens únicos, `correct_order` é uma permutação válida e diferente da identidade |
| `ConfigurationQuestion` | JSON válido (≤12 000 chars, profundidade ≤40), `starter` diferente de toda resposta correta |
| `ArchiveSchema` (import) | versão 1, ids de objetivo únicos, `active_goal_id` existente, sessões `goalId:index` dentro da trilha |

Tipos exportados úteis para portar: `SkillGap`, `SkillRequirements`, `LearnerProfile`, `SessionItem`, `LearningPath`, `KnowledgePoint`, `KnowledgeDraft`, `DocumentStructure`, `LearnerFeedback`, `DocumentQuiz`, `QuizCounts`, `ChatTurn`.

---

## 7. O Learner Feedback Simulator: o que existe, o que falta e como usar

### 7.1 O que o paper descreve

Fonte: arXiv 2501.15749, HTML v1.

- **Agendamento "evolvable":**
  - o *path scheduler* gera uma trilha inicial com CoT;
  - um LLM **faz o papel do aprendiz** a partir do perfil atual, julga eficiência, engajamento e dificuldade, e antecipa reações (por exemplo, "quero mais exercícios", "difícil demais");
  - o scheduler refina;
  - depois de cada sessão, replaneja com o perfil atualizado, e a nova trilha só substitui a antiga **se o aluno aprovar**.
  - **Não** são especificados o número de iterações, o critério de parada, uma ablação do simulador na trilha, nem um objetivo formal.
- **Conteúdo:**
  - a integração passa por um refinamento em que o simulador comenta estrutura e coerência e o criador revisa;
  - a ablação "w/o Refinement" dá **Personalization 3,85 contra 4,17** com o refinamento (GPT-4o).
- **Juiz automático:**
  - GPT-4o com Likert 1–5, 200 amostras em 5 ocupações;
  - correlação com humanos baixa a moderada, **Pearson 0,38–0,52** (5 de 7 significativas).

### 7.2 O que o código entrega de fato

| Peça | Onde | Estado |
|---|---|---|
| Prompt do simulador (system + Task A path + Task B content) | `app/src/lib/prompts/feedback-simulator.ts` | Pronto |
| Agente `simulateFeedback` | `app/src/lib/agents/feedback.ts` | Pronto, testado (`quiz-feedback-tutor.test.ts`) |
| Rota `POST /api/simulate-feedback` | `app/src/app/api/simulate-feedback/route.ts` | Pronta, coberta por e2e (`e2e/specs/agents.spec.ts`) |
| Cliente `api.simulateFeedback` | `app/src/lib/client.ts:132` | **Zero chamadas na UI** (auditoria A07) |
| Laço simulador → `schedulePath({task:"refine"})` | — | **Inexistente**, também no Python (`refine_learning_path_with_llm` só é exportado) |
| Refinamento de conteúdo pelo simulador | — | Inexistente (o `content-creator.ts` com outline/draft/full está morto) |
| Simulação de aprendiz para avaliação | `v0.1-demo:backend/modules/learner_simulation/` | **Só em Python, não portado** |

- O prompt do simulador:
  - Diz "You are *not* a helpful assistant; you are *role-playing* a specific learner".
  - Exige que **toda** a personalidade venha do `learner_profile` (cognitive_status, preferences, behavioral_patterns).
  - Pede feedback "realistic, specific, and actionable".
- Critérios:
  - Task A (path): Progression, Engagement e Personalization.
  - Task B (content): Goal Relevance, Content Quality e Personalization, **mapeados nas mesmas três chaves** `progression/engagement/personalization` do JSON. É uma gambiarra de reuso de schema.
- A saída é **só qualitativa**: seis strings, **sem nota**. Para servir de gate, precisamos estender o schema com pontuação.

### 7.3 O módulo Python `learner_simulation` (base para o "aluno sintético")

Arquivos, todos CC0: `backend/modules/learner_simulation/{prompts.py, schemas.py, grounding_profile_creator.py, learner_behavior_simulator.py}`.

1. **`GroundTruthProfileCreator.create_profile`**
   - Recebe currículo + objetivo + requisitos e devolve um **perfil "verdade"**: cognitive status com `progress_percentage` por skill, preferências e padrões de comportamento.
   - É a persona do aluno simulado.
2. **`LearnerInteractionSimulator.simulate_interactions`**
   - Recebe o perfil verdade + `session_number` e devolve logs da sessão em três categorias:
     - `performance_metrics` (participação, notas de exercício, taxa de conclusão);
     - `time_tracking` (duração, atividades, tempo médio por tarefa);
     - `learner_feedback` (satisfação, maestria autoavaliada, alinhamento ao objetivo, dificuldade percebida);
   - mais `notes`.
   - O prompt admite ruído: "may not fully reflect all the details of the ground-truth profile".
3. **`progress_profile`** (`ground_truth_profile_creator_task_prompt_progress`)
   - Avança o perfil verdade depois de cada sessão: aumenta `progress_percentage`, promove skills, ajusta preferências e engajamento.
   - Uso implícito no paper: medir se o *profiler* (que só vê os logs) **reconstrói** o perfil verdade. Esse é o único jeito de avaliar a fidelidade do perfil, que o paper reconhece não medir diretamente.

Os schemas Python são frouxos: `interactions: List[Dict[str, Any]]` e strings livres. Para Monte Carlo precisamos de números.

### 7.4 Proposta para o nosso app

**(a) Gate de qualidade de trilha e conteúdo.** Implementação nossa, inspirada no paper.

```ts
// src/agent/subagents/mentor/sim-gate.ts (proposto)
interface SimScore { progression: 1|2|3|4|5; engagement: 1|2|3|4|5; personalization: 1|2|3|4|5;
                     blocking: string[];            // problemas que impedem uso (pré-requisito fora de ordem, salto de dificuldade…)
                     feedback: FeedbackDetail; suggestions: FeedbackDetail }
async function gatedPath(profile, region, opts = { maxRounds: 2, minScore: 4 }) {
  let path = await schedulePath({ task: "create", … });            // Task A
  assertDagOrder(path, region.graph);                               // verificação DETERMINÍSTICA de pré-requisitos (meta 1, formal)
  for (let round = 0; round < opts.maxRounds; round++) {
    const s = await simulate({ target: "path", profile, path });    // simulador + rubrica numérica
    if (s.blocking.length === 0 && Math.min(s.progression, s.engagement, s.personalization) >= opts.minScore) break;
    path = await schedulePath({ task: "refine", learning_path: path, feedback: s });   // Task B
    assertDagOrder(path, region.graph);
  }
  return path;    // registrar usage por chamada (meta 6); guardar scores no registro da sessão
}
```

- Use o simulador com **outro modelo** (slot Cheap ou outro provider) para reduzir o viés de autoavaliação do mesmo modelo, que é o caveat do paper com GPT-4o gerando e julgando.
- O gate **não substitui** verificações determinísticas:
  - ordem de pré-requisitos no DAG;
  - cobertura das skills do gap;
  - contagem de sessões;
  - preservação de sessões concluídas (`reconcilePath`).
- Orçamento: 2 rodadas no máximo. Os ganhos do paper são pequenos na trilha (Progression 4,38 → 4,56 com GPT-4o) e maiores no conteúdo (Personalization +0,32).

**(b) Aluno sintético para avaliação e para calibrar XP e ranking por Monte Carlo (meta 5).**

1. Portar os três prompts do `learner_simulation` com **schemas numéricos**: `accuracy ∈ [0,1]`, `minutes`, `completion ∈ [0,1]`, `perceived_difficulty ∈ 1..5`, `p_correct` por skill.
2. Gerar N personas (por exemplo, 50 por domínio) variando nível inicial, tempo diário (2–4 h), preferências e ritmo.
3. Rodar algumas sessões simuladas por persona com o LLM. É caro, então o objetivo é **calibrar** um modelo paramétrico barato (IRT/BKT: taxa de aprendizado, *slip*, *guess* e esquecimento por persona).
4. Monte Carlo com 10⁴–10⁵ alunos no modelo paramétrico para obter as distribuições de XP/semana, horas até cada região e acurácia. A partir delas, definir faixas de nível e de ganho de XP compatíveis com o nível atual (percentis).
5. Validar o **profiler**: comparar o perfil inferido pelo profiler (alimentado só com logs simulados) com o perfil verdade, com métricas como erro de nível por skill e acurácia de *mastered*.

---

## 8. Pipeline completo (como a aplicação usa tudo)

### 8.1 Onboarding (`features/onboarding/use-onboarding.ts`)

```mermaid
sequenceDiagram
  participant U as Aluno
  participant C as Cliente (hook)
  participant S as API
  U->>C: objetivo + currículo (PDF via /api/parse-resume com unpdf) + nº sessões (0 = Adaptive)
  C->>S: refine-goal (fast)
  C->>S: identify-skill-gap (mapper smart + identifier smart)
  C-->>U: REVISÃO: sliders de nível atual/requerido por skill, editar objetivo; auto-continua em 3 min
  U->>C: confirmar (ou timer)
  C->>S: profile {mode:init} (fast)
  C->>S: schedule-path {task:create} (smart, stream → títulos aparecem ao vivo)
  C->>C: addGoal({..., learning_path, mastery_history:[ponto inicial]})
```

- Cada etapa concluída vira checkpoint em `localStorage["genmentor.onboarding.v1"]`. Repetir a mesma entrada retoma do checkpoint.
- Um contador `generation` descarta respostas atrasadas de execuções antigas.
- Editar níveis na revisão faz `SkillGap.parse` (recalcula `is_gap`) e define `level_confidence:"high"` para o que o humano ajustou.

### 8.2 Sessão (`lib/pipeline.ts#runPipeline`)

- Estágios: `knowledge_points` → `knowledge_drafts` (paralelo, com preview parcial por ponto) → `document` (preview de título e overview) → `quiz` (`hands_on: true`, 2/1/1/1).
- `nextStage(state)` devolve o primeiro estágio sem checkpoint. Um F5 retoma de lá.
- Não há pré-geração da próxima aula (auditoria A08). Cada aula custa 4 ou mais chamadas smart em série; na avaliação, drafter e integrator levaram mais de 2 min cada no GLM.

### 8.3 Conclusão e atualização do perfil (`store/completion.ts`)

```ts
export function completeSession(goalId, index)   // atômico e idempotente: if_learned=true, completed_at, profile_update={id, status:"pending", evidence: quiz_results}
export async function refreshProfiles(goalId, retryFailed = false)
  // serial por objetivo (flag running em memória); processa pendências em ordem de completed_at;
  // chama profile update; ao voltar: se o perfil foi editado manualmente nesse meio-tempo → status "failed" (perfil manual vence);
  // se a tarefa sumiu (objetivo apagado/importado) → descarta; senão grava perfil + ponto em mastery_history.
```

- A lição de `wiki/80-known-pitfalls.md` vale para nós: **um fato local (aula concluída) nunca espera uma estimativa do modelo**.

### 8.4 Reagendamento (`features/path/reschedule-dialog.tsx` + `store/reconcile-path.ts`)

```ts
const fingerprint = ({ title, abstract, associated_skills, desired_outcome_when_completed }: SessionItem) =>
  JSON.stringify([title, abstract, associated_skills, desired_outcome_when_completed]);
export function reconcilePath(goal: Goal, path: SessionItem[]): Pick<Goal, "learning_path" | "sessions"> {
  // casa cada item novo com um antigo de mesmo fingerprint → reaproveita estado (doc, quiz, resultados) e if_learned antigo;
  // item sem par → if_learned:false (ignora o que o LLM marcou);
  // se alguma sessão antiga APRENDIDA ficou sem par → throw ("The new path changed a completed session") e a trilha original é preservada.
}
```

- Invariante garantida: **nenhuma sessão concluída se perde**, verificada por conteúdo e não por posição.
- Não garante a regra "aprendidas primeiro" da Task C.
- Se o modelo devolver mais de 10 sessões com as aprendidas no fim, o `slice(0,10)` as corta e o reconcile lança erro. Esse é um caso de borda.

### 8.5 Derivações honestas (`store/derive.ts`, `store/learning-evidence.ts`, `quiz-review.ts`)

- `sessionMinutes(state)`:
  - soma os intervalos entre timestamps consecutivos de abrir e concluir que sejam **≤ 90 min** (`SITTING_GAP_MS`);
  - um intervalo maior conta como "saiu";
  - evita registrar 2880 min para uma aula aberta na segunda e concluída na quarta;
  - serve para a nossa meta 6 (horas por dia).
- `activitySummary(goal)`: dias ativos distintos, sessões abertas e concluídas, média de minutos, última atividade.
- `targetSkills(goal)` / `targetProgress(goal)`:
  - o denominador são os **requisitos aceitos** pelo aluno, não o `%` do modelo;
  - nomes normalizados com `skillKey` = NFKC + trim + espaços colapsados + minúsculas;
  - requisitos duplicados ficam com o **maior** alvo;
  - estimativas conflitantes ficam com o **menor** nível (conservador).
- `reviewQueue(goal)`:
  - ordena por mais erros, depois mais omissões, depois mais antigo, depois ordem da aula;
  - avisa explicitamente que **não** é curva de esquecimento.
- Prática (`practice`) nunca sobrescreve o primeiro resultado nem dispara update de perfil.

---

## 9. `model-catalog.ts`: descoberta de modelos sem hardcode

```ts
export class CatalogError extends Error { code: "unavailable" | "unauthorized" | "rateLimited"; status }
export async function listModels(connection: { provider: "openai"|"anthropic"; apiKey: string; baseUrl?: string },
                                 signal?: AbortSignal): Promise<{ models: { id: string; name?: string }[]; truncated: boolean }>
```

- **URL:**
  - `${base}/models` para OpenAI-compatível (base padrão `https://api.openai.com/v1`, preservando prefixos de proxy);
  - `${base}/v1/models?limit=1000` para Anthropic (base `https://api.anthropic.com`), com headers `x-api-key` e `anthropic-version: 2023-06-01`.
- **Paginação Anthropic:** segue `has_more` e `last_id` em `after_id`, no máximo 3 páginas, com proteção contra `last_id` repetido.
- **Sanitização:**
  - ids string, com trim, não vazios, ≤120 chars e sem caracteres de controle;
  - `display_name` cortado em 200;
  - dedupe por id (Map) e no máximo 3000 itens;
  - ordenação por `localeCompare`.
- **Segurança:**
  - `redirect: "error"`, `cache: "no-store"`, timeout de 10 s combinado com o `AbortSignal` do request;
  - nunca usa credenciais do servidor;
  - **nunca propaga corpo nem URL do upstream** em erro (podem conter a chave), só o código.
  - `ModelCatalogRequest` (zod) rejeita `baseUrl` com usuário/senha, query, hash ou esquema diferente de http(s).
- Testes em `llm/model-catalog.test.ts`: proxy path, dedupe, paginação Anthropic, mapeamento 401/403/429/404/500, falha de rede, limite de páginas e URLs com credenciais.
- **Relevância para o learnharness:**
  - Já temos coisa melhor. `src/server/model-catalog.ts` federa o catálogo pi-ai por provider com chave, mais assinatura ChatGPT, assinaturas nativas e endpoints custom.
  - `src/server/custom-provider.ts#discoverModels` já faz `GET {base}/models` com `redirect:"manual"`, timeout de 15 s e limite de corpo de 8 MiB.
  - Vale portar só:
    1. a **paginação Anthropic** (`has_more`/`last_id`/`after_id`), se um dia descobrirmos modelos de um endpoint Anthropic-compatível custom;
    2. os **filtros de sanitização de id** (≤120 chars, sem caracteres de controle);
    3. a política de erro que não vaza o corpo do upstream.
  - O padrão de UI (`use-model-catalog.ts`) também é bom: carrega o catálogo ao abrir o seletor, cancela com `AbortController` ao mudar provider/chave/URL e mantém um nome livre ao lado da lista.
- Contra-exemplo a evitar: `DEFAULT_MODELS` em `llm/config.ts` tem nomes de modelo fixos. Nosso app já recusa escolher silenciosamente (`piEngineFor` lança erro sem slot configurado), e devemos manter isso.

---

## 10. Avaliação de prompts: tag `prompts-baseline` e `scripts/eval-prompts.sh`

### 10.1 Mecânica (sem executar, só leitura)

- `scripts/eval-prompts.sh [baseline|current|both]`:
  1. Carrega `app/.env.local` e força `GENMENTOR_LLM_MODE=live`.
  2. Extrai os prompts da tag para um diretório temporário: `git ls-tree --name-only prompts-baseline app/src/lib/prompts/` e depois `git show prompts-baseline:$f`.
  3. Para cada variante, roda `vitest run --config vitest.eval.config.mts` com `EVAL_PROMPTS_DIR` apontando para o diretório baseline ou para `app/src/lib/prompts`, e `EVAL_OUT=e2e/artifacts/eval/<variante>`.
  4. Imprime contagens de saídas e erros e o tempo total.
- `app/vitest.eval.config.mts`:
  - o truque é **alias de resolução**: `^@/lib/prompts/(.*)$` aponta para `${EVAL_PROMPTS_DIR}/$1`, antes do alias geral `@/`;
  - o **mesmo código de agente** roda com dois conjuntos de prompts;
  - timeout de 1 h e `fileParallelism:false`.
- `app/scripts/eval-prompts.eval.ts`:
  - para cada caso (`test.concurrent`), roda a **cadeia inteira**: goal-refiner → skill-gap → profiler-init → path-scheduler (4 sessões) → explorer → drafter (1º ponto, sem busca) → integrator → quiz (3 SC + 1 TF) → feedback-simulator (path) → profiler-update (quiz 3/4) → tutor (pergunta do caso);
  - grava `{case, agent, ms, output | error}` por arquivo;
  - erros são registrados e não lançados.
- `scripts/eval-report.py` gera `e2e/artifacts/eval/report.md`:
  - tabela por agente × caso com latência e um resumo compacto (por exemplo, "9 skills, 7 gaps: X beginner→intermediate…");
  - linhas de "Judgement" para um **humano** preencher.
- `e2e/fixtures/eval/cases.json` tem 5 personas com `{id, learning_goal, learner_information, question}`:
  - analyst-to-ds, backend-to-ml-eng, nurse-to-informatics, pm-to-product-analytics, designer-to-frontend.

### 10.2 Resultado registrado (`wiki/reviews/review-2026-09-09-prompt-eval.md`, glm-5.3-flash)

| Agente | Veredito | Latência média base → atual |
|---|---|---|
| goal-refiner | same | 3,1 s → 3,0 s |
| skill-gap | same, um pouco mais lento | 63,4 s → 76,8 s |
| profiler-init | same, **instável nas duas versões** (progress 20 % vs 60 % no mesmo caso) | 30,5 s → 27,8 s |
| path-scheduler | same (5 de 5 com 4 sessões) | 99,3 s → 80,6 s |
| knowledge-explorer | same, mais enxuto (5–6 pontos contra 6–8) | 32,1 s → 22,7 s |
| knowledge-drafter | same (4,9k–12,6k chars por ponto) | 168,3 s → 125,7 s |
| document-integrator | same (2 de 5 `summary` vazios no baseline por truncamento) | 170,7 s → 133,7 s |
| quiz-generator | **worse → revertido** (1 de 5 com contagem errada) | 12,9 s → 14,7 s |
| feedback-simulator | same | 18,8 s → 18,1 s |
| profiler-update | same | 18,2 s → 17,6 s |
| tutor | better (sem emoji) | 15,3 s → 14,1 s |

- Crítica ao método:
  - N=5 casos com **uma execução cada**, sem repetição nem teste estatístico;
  - o julgamento é humano e qualitativo;
  - não há métrica de qualidade de conteúdo.
- Ainda assim, a disciplina é exemplar: baseline congelado em tag, o mesmo código, saídas lado a lado e reversão obrigatória do que piorou. Para nós, acrescentar:
  - k≥3 repetições;
  - verificações automáticas (contagens, schema, idioma PT-BR, ausência de `#` nos drafts, citações válidas);
  - um juiz LLM com rubrica, de modelo diferente do gerador.

---

## 11. Números do paper (referência para expectativas)

| Medida | Resultado |
|---|---|
| Goal→skill, GPT-4o (Recall / Precision / Goal Alignment) | DirPrompt 0,42/0,31/3,45 · CoT 0,48/0,39/3,51 · **GenMentor FT 0,67/0,63/4,28** · w/o tracks 0,63/0,67/4,05 |
| Goal→skill, Llama 3.2 3B | DirPrompt 0,37/0,35/3,18 · CoT 0,45/0,38/3,24 · **FT 0,63/0,61/4,14** |
| Dataset de FT | 120k vagas do LinkedIn (Kaggle) → 58 064 com ≥500 palavras → 10 000 treino + 200 validação. Anotações (deveres → skills → níveis) geradas por GPT-4o. **Nem o dataset nem os pesos estão no repo** |
| Trilha, GPT-4o (Progression / Engagement) | DirPrompt 3,95/3,80 · CoT 4,38/4,63 · **GenMentor 4,56/4,71** |
| Trilha, Llama 3B | 3,94/3,71 · 4,07/4,17 · **4,09/4,32** |
| Conteúdo, GPT-4o | Personalization 4,17 (vs OutlineRAG 3,79; w/o Refinement 3,85); Content Quality 4,86 |
| Juiz LLM vs humanos (Pearson) | 0,38–0,52 (2 avaliadores, 20 itens, uma ocupação) |
| Preferência humana | skill gap 22/30 vs CoT; trilha 17/30; conteúdo 80 % vs OutlineRAG (5 participantes) |
| Estudo end-to-end (n=20) | skill identification 4,6±0,8; trilha 4,3±0,8; conteúdo 4,2±1,0; perfil dinâmico 4,1±0,9; facilidade 4,6±0,7; satisfação 4,3±0,7 |

Leitura crítica:

- A maior parte do ganho do paper vem do **fine-tuning goal→skill** (Recall +0,19 sobre CoT), que **não está disponível**.
- Os ganhos de trilha são pequenos (+0,18 em Progression com GPT-4o).
- As avaliações automáticas usam o mesmo GPT-4o como gerador e como juiz.
- Não há grupo de controle no estudo humano.
- Trate os prompts como **bom ponto de partida de engenharia**, não como estado da arte comprovado.

---

## 12. Testes relevantes e padrão de teste

- `agents/__tests__/fake-llm.ts`:
  - substitui o módulo `@/lib/llm` com `vi.mock`;
  - tem uma fila de respostas (`reset(...answers)`) e registra todo `ChatOpts` em `requests`;
  - o stream é fatiado em pedaços de 17 caracteres;
  - expõe `lastUserMessage()`.
  - Os testes verificam o **prompt renderizado**, o tier e a re-pergunta corretiva. Um exemplo: o 1º retorno é `{skill_gaps: []}`, e a 2ª mensagem do usuário contém "violated the output contract" e "At least one skill gap".
- `llm/core.test.ts`: `extractJSON` (cercas, prosa, vírgula, `\n`, aspas internas, cauda truncada, cerca dentro de string, chave extra, documento quebrado), `parsePartialJSON` progressivo, `openaiArgs` (thinking opt-in, token param) e o nudge do `jsonCall`.
- `store/completion.test.ts`: idempotência, falha e retry exatamente uma vez, serialização de conclusões simultâneas contra o perfil mais novo, edição manual vencendo e objetivo apagado.
- `learning-evidence.test.ts`: progresso ignora o `%` do modelo, normalização NFKC, gabaritos malformados, fila de revisão.
- Para o learnharness:
  - os testes rodam com `tsx --test` (node:test), não vitest;
  - o equivalente ao `fake-llm` é **injetar `engine`** (o `SubagentRunOptions.engine` já é o *test seam* off-network);
  - portar os casos de teste e não o mecanismo `vi.mock`.

---

## 13. Armadilhas (o que vai dar errado se portarmos sem pensar)

1. **Simulador decorativo.** Copiar `feedback.ts` não dá gate nenhum: a saída é qualitativa e nada a consome. É preciso rubrica numérica, laço com limite de rodadas e verificações determinísticas (seção 7.4).
2. **Integrador desperdiçado.** `structure.content` é gerado e descartado (seção 5.5). Corte o campo ou passe a usá-lo, mas não pague pelos dois.
3. **Títulos fixos em inglês** em `renderMarkdown` (`## Foundational Concepts`…) e prompts sem idioma de saída. Em PT-BR o modelo responde em inglês ou mistura. Adicione `{output_language}` a todos os prompts e regrave fixtures em lote.
4. **Escala.** Limites de 10 skills (`dedupeByName`) e 10 sessões (`LearningPath.slice`). Para 1000–1500 h, o GenMentor deve operar **por região do grafo** (um "goal" equivale a uma região ou marco), com o grafo e a fronteira fornecidos por nós.
5. **Perfil reescrito pelo LLM.**
   - Há instabilidade (20 % vs 60 %), deriva de nomes de skill (resolvida com `skillKey`) e `behavioral_patterns` inventado sendo reenviado ao modelo.
   - Mantenha o **estado cognitivo determinístico** (BKT/FSRS sobre evidências).
   - Use o LLM só para notas de preferência e comportamento, e alimente-o com dados reais (`activitySummary`).
6. **Sem atribuição questão → skill.** `quiz_performance.wrong_questions` não diz a que skill cada questão pertence; o profiler adivinha. No nosso app, toda questão ou flashcard deve carregar `nodeId` do grafo.
7. **Custo e latência.**
   - Cada aula faz 4 ou mais chamadas smart em série, com drafts em paralelo.
   - Uma re-pergunta pode dobrar uma chamada.
   - Os prompts injetam o perfil inteiro e a trilha inteira como JSON *pretty* a cada chamada.
   - Mitigar com pré-geração da próxima aula em background (nosso `subagents/runner.ts` com admissão de workers), perfil resumido e cache de prompt (o system como bloco cacheável).
8. **Thinking e orçamento.** Modelos *reasoning* com `max_tokens` baixo devolvem **string vazia** sem erro. Mantenha ≥8000 para JSON e ≥12 000 para textos longos, ou use o controle de thinking por slot do pi-ai.
9. **`thinking: {type:"disabled"}` para OpenAI oficial** é rejeitado. O repo trata isso como opt-in; o pi-ai já resolve no nosso caso.
10. **Injeção de prompt.**
    - `learner_information`, currículo, documentos e resultados de busca são interpolados crus.
    - Só o revisor de hands-on diz "treat as data".
    - Nós vamos injetar capítulos de livros e transcrições do YouTube: delimite como documento citado e instrua explicitamente.
11. **Placeholders.** `fill` só reconhece `{[a-z_]+}`. Um `{palavra}` minúsculo no texto de um prompt traduzido vira placeholder e **lança erro**. Ao traduzir, evite chaves literais em minúsculas ou escape-as.
12. **Identidade por índice.** As sessões são `goalId:index`, o que é frágil. Use UUID estável por nó ou sessão desde o início; o repo deixou isso no backlog.
13. **Resposta curta sem correção.** É sempre "answered" (autoavaliação). Para o nosso app, vale corrigir por LLM com rubrica, ou converter para flashcard com autoavaliação explícita.
14. **`parsePartialJSON` como último recurso de `extractJSON`** aceita objetos truncados se o schema tiver defaults (por exemplo, `summary: ""`). É intencional, mas pode mascarar truncamento. Logue quando o reparo de cauda for usado.
15. **Fixtures por hash.** Qualquer edição de prompt invalida o replay. Faça mudanças de prompt em lote, depois avaliação, depois regravação.
16. **O loop de 3 min com auto-continuar** no onboarding dispara chamadas pagas sem ninguém olhando (A13). Com assinatura, isso consome a cota do usuário.
17. **BYOK em `localStorage` em texto puro.** Não replicar. Usamos o transporte de credenciais do Electron e os arquivos de conexão do servidor.
18. **O tom do tutor** ("quick quizzes", "celebrating") contradiz a meta 9. Reescreva.

---

## 14. O que copiar ou adaptar (caminhos exatos)

Base: `C:\Users\nicoolas\Pictures\learnharness\_refs\extra\GeminiLight__gen-mentor\`. Os destinos são propostas que seguem as fronteiras do `docs/architecture.md` do learnharness: `src/core` puro, `src/agent` para agentes e prompts, `src/server` para IO.

| # | Origem | Destino proposto | Adaptação | Esforço |
|---|---|---|---|---|
| 1 | `app/src/lib/llm/partial-json.ts` | `src/core/llm-json/partial-json.ts` | Copiar quase verbatim (sem dependências) | XS |
| 2 | `app/src/lib/llm/core.ts` (`stripLeadingFence`, `isolateJSON`, `extractJSON`, `LLMError`) | `src/core/llm-json/extract-json.ts` | Descartar `anthropicArgs`/`openaiArgs`/`jsonCall` (pi-ai cuida disso) | XS |
| 3 | `app/src/lib/llm/core.test.ts` | `tests/llm-json.test.ts` | vitest → node:test + `assert` | XS |
| 4 | `app/src/lib/prompts/format.ts` (`fill`, `stringify`) | `src/core/prompt-fill.ts` | Opcional: aceitar `{camelCase}`? Manter o erro em placeholder faltante | XS |
| 5 | `app/src/lib/agents/run.ts` (padrão de re-pergunta) | `src/agent/subagents/mentor/run-json.ts` | Ou usar **`runSubmitAgent`** (TypeBox) para saídas estruturadas não-streamed, ou portar `runJSON`/`streamJSON` sobre `runSubagent` quando quisermos streaming parcial com preview | S |
| 6 | `app/src/lib/schemas/{levels,learning,content,assessment,hands-on,tutoring}.ts` | `src/core/mentor/schemas.ts` (zod) + TypeBox equivalentes para tools de submit | Trocar níveis `beginner…advanced` por níveis do nosso grafo (por exemplo, `none/recognize/apply/analyze/create` ou Bloom); limites (10/10) configuráveis | M |
| 7 | `app/src/lib/prompts/{goal-refiner,skill-mapper,skill-gap-identifier,learner-profiler,path-scheduler,knowledge-explorer,knowledge-drafter,document-integrator,quiz-generator,feedback-simulator}.ts` | `src/agent/prompts/mentor/*.ts` | Traduzir e adaptar: `{output_language}`, contexto de **região do grafo**, didática não cansativa, citações de livros e vídeos, sem `content` no integrador. Guardar o baseline (texto original) em `src/agent/prompts/mentor/baseline/` ou numa tag git nossa | M |
| 8 | `app/src/lib/prompts/hands-on-quiz.ts`, `hands-on-review.ts` + `agents/hands-on-review.ts` + `lib/configuration.ts` | `src/agent/prompts/mentor/practice-*.ts`, `src/core/configuration-compare.ts` | Generalizar o par gerar → auditar para flashcards e exercícios de Eletrônica (por exemplo, valores de componentes como "configuração") | S |
| 9 | `v0.1-demo:backend/modules/learner_simulation/prompts.py` (3 prompts) | `src/agent/prompts/mentor/sim-learner.ts` | Portar para TS com schemas **numéricos** (seção 7.3–7.4) | S |
| 10 | `app/src/lib/quiz.ts` (`resolveOption`, `judge`, `scoredCount`, `quizPerformance`) | `src/core/mentor/quiz-judge.ts` | Adicionar `nodeId` por questão; o nosso `question-core.ts` pode já cobrir parte disso, então verificar sobreposição | S |
| 11 | `app/src/lib/quiz-review.ts` | `src/core/mentor/review-queue.ts` | Substituir a ordenação heurística por FSRS quando houver flashcards; manter a regra "prática não sobrescreve o primeiro resultado" | S |
| 12 | `app/src/lib/store/reconcile-path.ts` | `src/core/mentor/reconcile-path.ts` | Fingerprint por `nodeId` estável mais conteúdo; acrescentar a verificação "aprendidas primeiro" e de ordem topológica | XS |
| 13 | `app/src/lib/store/completion.ts` (padrão) | `src/server/mentor/profile-updates.ts` | Reescrever sobre os nossos stores JSON e jobs (`src/server/jobs.ts`); manter fila serial por domínio, id de tarefa e "manual vence" | M |
| 14 | `app/src/lib/store/derive.ts` (`sessionMinutes`, `activitySummary`) | `src/core/mentor/study-time.ts` | Usar eventos `visibilitychange`/turnos para mais precisão; alimenta o perfil (meta 6) | XS |
| 15 | `app/src/lib/store/learning-evidence.ts` (`skillKey`, `targetSkills`) | `src/core/mentor/evidence.ts` | `skillKey` reutilizável na deduplicação de nós gerados por IA | XS |
| 16 | `app/src/lib/llm/replay.ts` (`fixtureHash`, `readFixture`, `writeFixture`, `chunked`) | `tests/support/llm-replay.ts` | Envolver um `PiEngine` fake que grava e reproduz `streamFn` | S |
| 17 | `scripts/eval-prompts.sh` + `app/scripts/eval-prompts.eval.ts` + `app/vitest.eval.config.mts` + `scripts/eval-report.py` + `e2e/fixtures/eval/cases.json` | `scripts/eval-mentor-prompts.mjs` + `tests/fixtures/eval/mentor-cases.json` | Substituir o alias vitest por injeção do módulo de prompts (`loadPrompts(dir)`); casos PT-BR para Inglês e Eletrônica; k repetições; checagens automáticas; relatório em TS | M |
| 18 | `app/src/lib/llm/model-catalog.ts` | Trechos em `src/server/custom-provider.ts#discoverModels` | Só a paginação Anthropic, os filtros de id e a política de erro (seção 9) | XS |
| 19 | `app/src/lib/llm/partial-json.ts` no cliente (padrão de `pipeline.ts`/`reschedule-dialog.tsx`) | `components/*` | Preview de títulos de trilha e de rascunho durante a geração | S |

**Não copiar:** `llm/index.ts`, `llm/config.ts`, `llm/context.ts` (SDKs diretos, BYOK em localStorage, `AsyncLocalStorage`), `lib/client.ts`/`api.ts` (o nosso transporte é outro), `store/index.ts` (zustand/localStorage), `content-creator.ts` (código morto), UI e i18n (outra linguagem visual), logos.

---

## 15. Dependências

| Dependência no gen-mentor | Situação no learnharness | Decisão |
|---|---|---|
| `zod` ^4.5.4 (inclui `z.toJSONSchema`) | `zod` ^4.4.3 já presente | OK. `toJSONSchema` existe no zod 4 |
| `openai` ^7.10, `@anthropic-ai/sdk` ^0.124 | Usamos `@earendil-works/pi-ai`/`pi-agent-core` 1.4.0 | **Não adicionar.** Usar `runSubagent`/`runSubmitAgent` |
| `typebox` | ^1.3.27 já presente (tools de submit) | Converter os schemas de saída para TypeBox onde usarmos submit |
| Tavily (fetch direto) | Já temos adaptadores Tavily, Brave, Exa, Firecrawl, Ollama (`src/core/search.ts`, `src/server/search.ts`) | Reusar os nossos |
| `unpdf` (parse de currículo) | `pdfjs-dist` + `pdf-markdown.ts` | Reusar os nossos |
| `zustand` + persist | Stores em arquivos JSON no servidor | Não adicionar |
| vitest | `tsx --test` (node:test) | Converter os testes |
| Node 24, `AsyncLocalStorage` | Node 24 (types), engines injetados | Não precisamos de ALS |

Novas dependências necessárias: **nenhuma**.

---

## 16. Plano de integração no learnharness

Mapeamento das metas do usuário ao que o GenMentor oferece:

| Meta | Contribuição do GenMentor | O que falta (nosso) |
|---|---|---|
| 1. Grafo massivo e expansão procedural | refiner, mapper, gap e scheduler (Task A/B/C) como **operadores locais** sobre uma região; `reconcilePath` para expandir sem perder progresso; `skillKey` para dedupe | Grafo/DAG global (open-mastery e r3), validador formal de aciclicidade e pré-requisitos, gatilho de expansão |
| 2. Memória SOTA | Perfil em 3 componentes (cognitivo, preferências, comportamento); evidência de quiz → update; fila serial | Memória real (r4); estado cognitivo determinístico (BKT/FSRS) |
| 3. Sessões por domínio | "Goal" isolado com perfil, trilha, sessões, tutor e histórico de maestria | Mapear Goal para DomainSession e Region |
| 4. Flashcards | Quiz com 6 tipos e gate gerar → auditar | Exportação Anki/Obsidian, FSRS |
| 5. XP e Monte Carlo | Simulador de aprendiz (Python `learner_simulation`) + princípio "gamificação só com dados reais" | Modelo paramétrico, MC e calibração |
| 6. Stats | `sessionMinutes`, `activitySummary` | Tokens por modelo (`onUsage` do `runSubagent`) |
| 7. Modelos sem hardcode | Tiers fast/smart; catálogo | Já resolvido pelos slots e pelo catálogo do learnharness; criar novas `ModelRole` |
| 8. UI cel shading | — | — |
| 9. Didática | Explorer foundational/practical/strategic; drafter com RAG e citações | Reescrever o tutor e os drafts com doutrina anti-"explica rápido e despeja perguntas" |

### Fase 0: fundações puras (1–2 dias)

1. Portar `partial-json.ts` + `extractJSON` para `src/core/llm-json/`, com testes node:test portados de `core.test.ts`.
2. Portar `fill()` para `src/core/prompt-fill.ts`.
3. Portar `reconcilePath`, `sessionMinutes`/`activitySummary`, `skillKey`/`targetSkills`, `judge`/`resolveOption`/`quizPerformance` e `configuration.ts` para `src/core/mentor/`, com testes.
4. Cabeçalho CC0 de proveniência em cada arquivo.

### Fase 1: agentes como sub-agentes pi (3–5 dias)

1. Criar `ModelRole`s em `config.ts`: por exemplo, `mentorPlanner` (smart), `mentorWriter` (smart), `mentorProfiler` (cheap), `mentorQuiz` (cheap), `mentorSimulator` (cheap ou outro provider). Resolver por `resolveRoleSpec` (sem hardcode, meta 7).
2. Agentes estruturados (`refineGoal`, `mapSkills`, `identifySkillGaps`, `initializeProfile`/`updateProfile`, `exploreKnowledge`, `generateQuiz`, `reviewPractice`, `simulateFeedback`):
   - usar `runSubmitAgent({ role, toolName: "submit_<x>", parameters: TypeBox, fill: zodRepair, systemPrompt, prompt: fill(task, vars), onStep })`;
   - o submit validado por TypeBox substitui o `extractJSON` + re-pergunta;
   - manter `extractJSON` como *fallback* para provedores sem tool-calling.
3. Agentes longos e streamed (`schedulePath`, `draftKnowledge`, cabeçalhos do integrador):
   - `runSubagent` com `onEvent` emitindo deltas;
   - na UI, `parsePartialJSON` para o preview;
   - validação final com zod e a re-pergunta corretiva portada de `run.ts`.
4. Todo uso passa por `onUsage`/`onStep`, que é o canal de dinheiro e de tokens por modelo (meta 6).
5. Prompts em `src/agent/prompts/mentor/`:
   - traduzir para PT-BR mantendo a estrutura;
   - placeholders novos: `{output_language}`, `{region_context}` (nós, pré-requisitos e fronteira), `{resources}` (capítulos de livro e vídeos já ligados à região);
   - integrador sem `content`;
   - tutor reescrito.
   - Congelar a tradução 1:1 como **nosso baseline** antes de otimizar.

### Fase 2: acoplamento ao grafo (1–2 semanas, depende de r3 e open-mastery)

1. "Goal" do GenMentor = **região ou marco** de um domínio. O DomainSession (Inglês, Eletrônica) contém N regiões.
2. **Skill Mapper → projeção da região.** As skills vêm dos **nós da região** e o LLM só é chamado para **expandir** quando a região é um *stub* (expansão procedural). A saída do mapper vira candidatos de nós, deduplicados por `skillKey` e validados pelo verificador de DAG antes de gravar.
3. **Skill Gap → nivelamento inicial** por nó, com `level_confidence`. A revisão humana com sliders (padrão do onboarding) é ótima para a primeira sessão de cada domínio.
4. **Path Scheduler (Task A)** recebe a **fronteira** (nós desbloqueados) e ordena até 10 sessões.
   - `assertDagOrder` rejeita qualquer violação de pré-requisito.
   - A correção é feita pela re-pergunta corretiva com a issue exata: "Session 3 usa nó X antes do pré-requisito Y".
5. **Task C (reschedule)** é disparada por evidência (quiz/FSRS) e não só por texto livre, sempre passando por `reconcilePath` (invariante: sessões concluídas são imutáveis).
6. **Conteúdo:**
   - Explorer → pontos da sessão.
   - Drafter com RAG sobre **nossos** recursos: capítulo do livro da região, transcrição do vídeo (PT ou EN legendado) e busca web.
   - `sources` com citações `[N]` apontando para página e capítulo ou para timestamp do vídeo.
   - Integrador só com overview, transições e resumo.
   - Pré-gerar a próxima aula em background (job com admissão de workers).

### Fase 3: gate do simulador e aluno sintético (1 semana)

1. `sim-gate.ts` (seção 7.4a): rubrica numérica, até 2 rodadas, modelo diferente do gerador, scores persistidos na sessão.
2. `sim-learner.ts`: portar os prompts do `learner_simulation` com schemas numéricos e gerar personas por domínio.
3. Notebook ou script de calibração: LLM-sim calibra parâmetros, depois Monte Carlo no modelo paramétrico, depois tabelas de XP e nível (meta 5).
4. Validação do profiler contra o perfil verdade simulado.

### Fase 4: avaliação contínua de prompts (2–3 dias)

1. `scripts/eval-mentor-prompts.mjs`, rodado manualmente e nunca em CI com chave real:
   - carrega `promptsDir` (baseline ou atual) por injeção;
   - roda a cadeia completa sobre `tests/fixtures/eval/mentor-cases.json` (≥5 personas: iniciante absoluto em Eletrônica, técnico em eletrônica rumo a pós-graduação, inglês A2 → C1, inglês B2 para leitura acadêmica, aluno de engenharia);
   - k=3 repetições;
   - checagens automáticas: schema, idioma, contagens, citações, ausência de `#` nos drafts, ordem do DAG;
   - juiz com rubrica.
2. Relatório lado a lado em `docs/research/` ou num artifact. Regra herdada do repo: **o que piorar é revertido**.
3. Record/replay por hash (portado de `replay.ts`) para os testes de integração dos agentes.

### Critérios de aceite sugeridos

- `tests/mentor-*.test.ts` verdes offline (engine fake e replay).
- Nenhuma sessão concluída alterada por um reschedule (teste de propriedade sobre `reconcilePath`).
- 100 % das trilhas aprovadas por `assertDagOrder`.
- Saídas em PT-BR em ≥95 % das execuções de avaliação.
- Tokens por chamada registrados por `role` e modelo.

---

## 17. Perguntas em aberto

1. Para estruturados, usar só `runSubmitAgent` (tool-calling) ou manter também o caminho de JSON no texto (`extractJSON`)? Isso depende de todos os modelos de assinatura (ChatGPT/Claude via bridge) suportarem tool-calling de forma confiável.
2. Qual escala de níveis adotar nos nós do grafo (4 níveis do GenMentor, Bloom ou CEFR para Inglês) e como mapear `required_level`/`current_level`?
3. O gate do simulador deve bloquear a apresentação (latência maior) ou rodar em background com substituição posterior (latência menor e complexidade de reconciliação)?
4. Vale tentar recriar o **fine-tuning goal→skill** do paper com dados próprios (por exemplo, ementas de cursos de Eletrônica e descritores CEFR)? O paper sugere ganho grande de recall (+0,19), mas o custo de dados é alto.
5. Quanto o aluno sintético por LLM é fiel o bastante para calibrar XP? O paper não mede a fidelidade do perfil. Sugiro validar com os primeiros dados reais do usuário antes de fixar faixas.
