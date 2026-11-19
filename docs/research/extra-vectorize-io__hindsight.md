# Hindsight (vectorize-io/hindsight): memória de agente para o learnharness

> Relatório `extra-vectorize-io__hindsight` · 2026-11-18
> Fonte analisada (somente leitura, nada foi executado): `C:/Users/nicoolas/Pictures/learnharness/_refs/extra/vectorize-io__hindsight`
> Commit `f6038a742743243c2df4a90b5b0542715f320359` (2026-11-18 10:03 +0100) · versão 1.2.1 · `@vectorize-io/hindsight-client` 1.2.1
> Complementa `docs/research/r4-memoria-contexto-sota.md`. O r4 recomendou uma implementação TS nativa "raw-first" inspirada no TEMPR. Este documento desce ao código e diz exatamente o que portar e como.

Todos os caminhos abaixo são relativos à raiz do clone. `ENGINE` = `hindsight-api-slim/hindsight_api/engine`.

---

## 0. TL;DR

- **O que é.** Hindsight é um servidor de memória para agentes, em Python (FastAPI) com Postgres e pgvector (ou `pg0` embarcado, ou Oracle 23ai). As operações centrais são **retain** (extrai fatos, entidades, tempo e causalidade com um LLM), **recall** (TEMPR: 4 braços de busca em paralelo, depois RRF, rerank e boosts) e **reflect** (CARA: um agente com ferramentas que lê mental models, depois observations, depois fatos crus).
- Por cima disso há uma **consolidação** em background, que transforma fatos em *observations* com `proof_count` e histórico. Há também **mental models**: documentos vivos que respondem a uma pergunta fixa e se atualizam por delta.
- **Licença.** MIT (Copyright 2025 Vectorize AI, Inc.). Pode ser incorporada a um projeto AGPL-3.0, desde que o aviso MIT seja mantido nos arquivos portados.
- **Encaixe nas metas.** Os conceitos encaixam quase 1:1 na meta 2 ("onde o aluno está / para onde vai / pontos fracos") e na meta 3 (um bank por domínio):
  - bank = domínio;
  - tags e `entity_labels` = nós do grafo e tipos de erro;
  - observations = crenças consolidadas sobre o aluno, com evidência;
  - mental models = os painéis "Estado atual", "Pontos fracos" e "Próximos passos", atualizados após cada consolidação.
- **Integração recomendada:** a **opção C, porta TS nativa e in-process** (TypeScript dentro do app), seguindo o r4. Portar:
  - os prompts de extração e consolidação (texto puro, MIT);
  - a matemática do recall (RRF k=60, combined scoring multiplicativo, cobertura temporal, spreading activation);
  - a pontuação de resolução de entidades;
  - o documento estruturado com delta-ops dos mental models.
- **Embeddings e reranker:** usar os modelos ONNX do próprio Hindsight. `hs-embed-1` (MIT, 112M parâmetros, 384 dimensões) e `hs-rerank-1` (MIT, 114M) suportam português.
- **Sidecar e MCP:** o sidecar Python (`@vectorize-io/hindsight-all` / `uvx hindsight-embed`) e o MCP `/mcp/{bank_id}/` ficam **apenas como harness de avaliação em desenvolvimento**. Em produção eles exigem uv/Python e Postgres, além de injetar de 24k a 43k tokens por consulta (segundo o r4).
- **Benchmark.** O "94,6% no LongMemEval-S" é **autorreportado** e usa um backbone forte. Em harness neutro o resultado cai (72,2% em LME-S no OmniMemEval e 59,8% no BEAM-10M, segundo o r4). Use o número como sinal de que a arquitetura é boa, não como garantia. Os próprios evals por operação mostram o que importa: com reranker cross-encoder local o recall acertou 6/19; com o decision model, 19/19.
- **Bônus para a meta 7.** O arquivo `ENGINE/providers/chatgpt_auth.py` implementa o fluxo oficial **"Sign in with ChatGPT for open-source apps"** (OAuth PKCE com loopback e escopo `chatgpt.tokens.use.direct`). É a referência mais limpa para "login com ChatGPT" sem chave de API.

---

## 1. Por que este repositório e em que estado está

| Item | Valor |
|---|---|
| Atividade | Commit de 18/11/2026 (hoje); monorepo muito ativo, 122 migrações Alembic |
| Pacotes | `hindsight-api-slim` (servidor), `hindsight-clients/{typescript,python,go,rust}`, `hindsight-all-npm` (wrapper Node do daemon), `hindsight-embed` (daemon CLI), `hindsight-control-plane` (UI Next.js, porta 9999), `hindsight-integrations/*` (~48 integrações, incluindo `ai-sdk`, `obsidian` e `claude-agent-sdk`), `hindsight-system-evals`, `hindsight-docs` |
| Portas | API 8888; control plane 9999 |
| Paper | arXiv 2512.12818, *Hindsight is 20/20: Building Agent Memory that Retains, Recalls, and Reflects* (14/12/2025) |
| Benchmarks publicados | benchmarks.hindsight.vectorize.io: LongMemEval-S 94,6%; LoCoMo 92%; PersonaMem-32K 86,6%; BEAM 100K 75% / 500K 71,1% / 1M 73,9% / 10M 64,1%; LifeBench-EN 71,5% |
| Modelos próprios (nov/2026) | `hs-decide-1-flash` (0,8B, base Qwen3.5-0.8B, Apache-2.0, contexto de 64k, servido com vLLM); `hs-rerank-1` (114M, base mmBERT-small, MIT, ONNX int8); `hs-embed-1` (112M, 384 dimensões, truncável por Matryoshka para 256/128/64, MIT, ONNX). Os três cobrem 8 idiomas, **PT incluído** |

**Por que interessa ao learnharness**
- **Meta 2.** O par observations + mental models é exatamente um "modelo do aluno" vivo e com evidência.
- **Meta 3.** Banks isolados por domínio, cada um com missão, diretivas e configuração próprias.
- **Meta 4.** Já existe um plugin de Obsidian (`hindsight-integrations/obsidian/`) e há "pages", mental models organizados em árvore de pastas como um wiki e exportáveis.
- **Meta 6.** A tabela e a rota `llm-requests` / `llm-requests/stats?split_by=model|operation` são o desenho pronto de "tokens por modelo".
- **Meta 7.** Há provedores por assinatura (`chatgpt`, `openai-codex`, `claude-code`, `github-copilot`, `cursor`) e o modelo é configurável por bank e por operação, nunca fixo no código.

---

## 2. Licença e compatibilidade

- Os arquivos `LICENSE` e `hindsight-clients/typescript/package.json` declaram **MIT**, "Copyright (c) 2025 Vectorize AI, Inc.".
- **MIT → AGPL-3.0: compatível.** Podemos copiar ou adaptar código, prompts e fixtures, com duas condições:
  1. manter o aviso de copyright e de permissão MIT, por exemplo num cabeçalho em cada arquivo portado (`// Portions adapted from vectorize-io/hindsight (MIT) — Copyright (c) 2025 Vectorize AI, Inc.`) e/ou em `THIRD_PARTY_NOTICES.md`;
  2. o conjunto distribuído continua AGPL-3.0.
- **Modelos:** `hs-embed-1` e `hs-rerank-1` são MIT; `hs-decide-1-flash` é Apache-2.0 (exige o NOTICE e marcar modificações). Os dois regimes são compatíveis com AGPL-3.0.
- **Dados e benchmarks:** o AMB (agent-memory-benchmark) é outro repositório. Datasets como LongMemEval e LoCoMo têm licenças próprias; não os embarcar no app.
- **Termos de serviço, não licença:** o provedor `claude-code` usa o Claude Agent SDK, cujos termos dizem que produtos de terceiros **não devem oferecer login claude.ai**; houve repressão em janeiro de 2026. A doc do próprio Hindsight restringe o uso a "pessoal/local". Ver §7.

---

## 3. Arquitetura

```
              ┌──────────────────────── hindsight-api-slim (FastAPI :8888) ────────────────────────┐
 cliente TS ─►│ api/http.py  /v1/default/banks/{bank}/...      mcp_tools.py  /mcp/{bank}/  (39 tools) │
 MCP ────────►│                                                                                   │
              │  engine/memory_engine.py (orquestra; ~25k linhas)                                 │
              │   ├─ retain/        chunking → fact_extraction (LLM) → embeddings(+datas)        │
              │   │                 → entity_resolver → links (temporal/semântico/causal/entity) │
              │   ├─ consolidation/ fatos novos → observations (create/update/delete, proof_count)│
              │   ├─ search/        TEMPR: semantic ∥ BM25 ∥ graph ∥ temporal → RRF → rerank     │
              │   │                 → combined scoring → empacotamento por orçamento de tokens   │
              │   ├─ reflect/       agente CARA: mental models → observations → recall → done    │
              │   ├─ mental_model_refresh.py  full | delta (structured_doc + delta_ops)          │
              │   └─ providers/     openai, anthropic, gemini, chatgpt(OAuth), openai-codex,     │
              │                     claude-code, copilot, cursor, ... (+25)                      │
              │  memories/pg/       SQL: recall.py, link_expansion.py, links.py, entity_resolver │
              └──────────────────────────────┬───────────────────────────────────────────────────┘
                                             ▼
                     Postgres + pgvector (HNSW parcial por fact_type) | pg0 embarcado | Oracle 23ai
```

### 3.1 Modelo de dados (snapshot: `hindsight-api-slim/hindsight_api/alembic/versions/o1a2b3c4d5e6_oracle_baseline.py`)

**`memory_units`:** a tabela central. Guarda fatos *e* observations.

| Grupo | Colunas |
|---|---|
| Identidade e origem | `id`, `bank_id`, `document_id`, `chunk_id` |
| Conteúdo | `text`, `embedding vector(384)`, `context`, `search_vector` (BM25/tsvector), `text_signals` |
| Tempo | `event_date`, `occurred_start`, `occurred_end`, `mentioned_at` |
| Classificação | `fact_type CHECK IN ('world','experience','observation')`, `confidence_score`, `access_count`, `tags`, `metadata` |
| Consolidação | `consolidated_at`, `observation_scopes`, `proof_count`, `source_memory_ids`, `history`, `consolidation_failed_at` |
| Auditoria | `edited_at`, `created_at`, `updated_at` |

**Demais tabelas**

| Tabela | Conteúdo |
|---|---|
| `entities` | `canonical_name`, `mention_count`, `first_seen`, `last_seen`; liga-se às unidades por `unit_entities` |
| `entity_cooccurrences` | Coocorrência de entidades, usada na resolução |
| `memory_links` | `from_unit_id`, `to_unit_id`, `link_type CHECK IN ('temporal','semantic','entity','causes','caused_by','enables','prevents')`, `entity_id`, `weight CHECK 0..1` |
| `mental_models` | `id`, `bank_id`, `subtype ('directive'\|'pinned')`, `name`, `description`, `source_query`, `content`, `structured_content`, `embedding`, `entity_id`, `observations`, `links`, `tags`, `max_tokens` (padrão 2048), `trigger` (JSON), `last_refreshed_source_query`, `reflect_response`, `history`, `last_refreshed_at`, `last_updated`, `created_at` |
| Outras | `banks`, `documents`, `chunks`, `directives`, `observation_sources`, `async_operations`, `invalidated_memory_units`, e `llm_requests` (telemetria) |

### 3.2 Tipos de memória

| Tipo | O que é | Uso no learnharness |
|---|---|---|
| `world` | Fato sobre o mundo ou o usuário ("aluno mora em X", "aluno errou Y") | Eventos de estudo, erros, objetivos declarados |
| `experience` | Fato sobre o que o *assistente/agente* fez ("expliquei X com analogia Y") | Histórico didático do tutor: o que já foi tentado |
| `observation` | Crença consolidada, uma frase sobre um sujeito e uma faceta, com `proof_count`, `source_memory_ids` e `history` | "Aluno confunde present perfect com simple past" (proof 4) |
| Mental model | Resposta permanente a uma `source_query`, atualizada por gatilhos | "Estado atual", "Pontos fracos", "Próximos passos" |
| Page | Mental model dentro de uma árvore de pastas (wiki) | Caderno do aluno exportável para o Obsidian |
| Directive | Regra rígida aplicada no reflect | Regras pedagógicas ("nunca declarar domínio sem 2 acertos espaçados") |
| Disposition | `skepticism`, `literalism` e `empathy`, de 1 a 5; afeta só o reflect | Tom do tutor (meta 9) |

### 3.3 Configuração hierárquica
A ordem é variáveis de ambiente → tenant → bank (`PATCH /v1/default/banks/{bank}/config`). Os padrões vêm de `hindsight_api/config.py` (6,6k linhas):

| Chave | Valor padrão |
|---|---|
| `DEFAULT_LLM_PROVIDER` | `"openai"` |
| `DEFAULT_LLM_MODEL` | `"gpt-5-nano"` |
| `DEFAULT_EMBEDDINGS_LOCAL_MODEL` | `"BAAI/bge-small-en-v1.5"` (⚠ só inglês) |
| `DEFAULT_RERANKER_LOCAL_MODEL` | `"hindsight-ai/hs-rerank-1"` |
| `DEFAULT_SEMANTIC_MIN_SIMILARITY` | 0.3 |
| `DEFAULT_SEMANTIC_LINK_MIN_SIMILARITY` | 0.7 |
| `DEFAULT_RETAIN_CHUNK_SIZE` | 3000 caracteres |
| `DEFAULT_RETAIN_EXTRACT_CAUSAL_LINKS` | True |
| `DEFAULT_ENABLE_OBSERVATIONS` | True |
| `DEFAULT_CONSOLIDATION_BATCH_SIZE` | 50 |
| `DEFAULT_CONSOLIDATION_DEDUP_THRESHOLD` | 0.97 |
| `DEFAULT_REFLECT_MAX_ITERATIONS` | 10 |

O LLM pode ser configurado por operação (retain, consolidation, reflect...) e por bank: **nenhum modelo fica fixo no código**, que é exatamente o requisito da meta 7.

---

## 4. Superfícies de integração

### 4.1 Cliente TS: `hindsight-clients/typescript/src/index.ts` (MIT, 2.321 linhas)

O cliente é gerado por `@hey-api/openapi-ts` (`generated/sdk.gen.ts`, `generated/types.gen.ts`). A fachada é escrita à mão:

```ts
const hs = new HindsightClient({ baseUrl: 'http://127.0.0.1:8888', apiKey, maxAttempts: 3 });
await hs.createBank('lh-english', { retainMission, observationsMission, reflectMission,
  retainExtractionMode: 'concise', enableObservations: true });
await hs.retain('lh-english', transcript, { timestamp, context: 'Sessão de estudo; user=aluno, assistant=tutor',
  documentId: sessionId, tags: ['concept:present-perfect'], observationScopes: 'per_tag', async: true });
const r = await hs.recall('lh-english', 'erros recentes com tempos verbais', {
  budget: 'mid', maxTokens: 2048, types: ['world','experience','observation'], tags, tagsMatch: 'any' });
const ctx = recallResponseToPromptString(r);  // "FACTS:\n[json...]\n\nENTITIES:\n## nome\nobs..."
const a = await hs.reflect('lh-english', 'Quais são os 3 pontos fracos atuais?', { budget: 'low' });
await hs.createMentalModel('lh-english', 'Pontos fracos', 'Quais erros recorrentes...?', {
  tags: ['domain:english'], maxTokens: 1500,
  trigger: { mode: 'delta', refreshAfterConsolidation: true, minRefreshIntervalSeconds: 600 } });
```

**Pontos de atenção**
- `retryOnCapacity` repete apenas em 429/503, com backoff jitter e respeito a `Retry-After`. Só se aplica a recall e reflect, **nunca a escritas**: o retain não é idempotente sem `operationId`.
- Parâmetros de `recall`:

  | Parâmetro | Padrão / valores |
  |---|---|
  | `budget` | padrão `mid` |
  | `maxTokens` | padrão 4096 |
  | `includeEntities` / `maxEntityTokens` | 500 |
  | `includeChunks` / `maxChunkTokens` | 8192 |
  | `includeSourceFacts` / `maxSourceFactsTokens` | 4096 |
  | `tagsMatch` | `any`, `all`, `any_strict`, `all_strict`, `exact` |
  | Demais | `tagGroups`, `minScores`, `temporalWindow`, `queryTimestamp`, `preferObservations`, `rerank`, `trace` |

- Opções de `reflect`: `budget` (padrão `low`), `responseSchema` (saída estruturada), `excludeMentalModels`, `factTypes`, `includeFacts`, `includeToolCalls`, `applyAllDirectives`.
- **Mental models:** CRUD completo, além de `refreshMentalModel({mode})`, `dryRunRefreshMentalModel`, `getMentalModelHistory` e `clearMentalModel`.
- **Pages:** `getPageTree`, `createPageFolder`, `createPage`, `searchPages`, `exportPages`.
- **Bank:** `exportBank`, `importBank`, `cloneBank`.
- Os testes em `hindsight-clients/typescript/tests/*.test.ts` servem de especificação executável dos contratos.

### 4.2 REST: `hindsight-api-slim/hindsight_api/api/http.py` (10,4k linhas)
Todas as rotas abaixo ficam sob `/v1/default/banks/{bank_id}/`.

| Grupo | Rotas |
|---|---|
| Memórias | `memories` (retain), `memories/recall`, `memories/list`, `memories/{id}`, `memories/{id}/history`, `memories/{id}/observations` |
| Raciocínio | `reflect`, `consolidate`, `consolidation-strategies/preview` |
| Mental models e pages | `mental-models[/{id}[/refresh\|/dry-run-refresh\|/history\|/clear]]`, `pages...` |
| Observations e grafo | `observations`, `observations/scopes`, `observations/tree`, `entities`, `entities/graph`, `graph` |
| Configuração | `directives`, `config`, `tags`, `webhooks` |
| Documentos | `documents...`, `/reprocess`, `files/retain` |
| Operações e estatísticas | `operations`, `stats`, `stats/memories-timeseries`, `llm-requests`, `llm-requests/stats` (`split_by` = model ou operation) |
| Transferência | `export`, `import`, `clone`, `transfer/...` |

Também existem `/health`, `/metrics` e `/v1/version`.

### 4.3 MCP: `hindsight-api-slim/hindsight_api/mcp_tools.py` e `hindsight-docs/docs/developer/mcp-server.md`
- **39 ferramentas** em `_ALL_TOOLS`: `retain`, `sync_retain`, `recall`, `reflect`, `list_banks`, `create_bank`, a família de mental models, directives, memories (list/get/update/invalidate), documents, operations, tags, bank (get/update/delete/stats), `clear_memories` e a família de pages.
- **Modos de bank:** bank único em `/mcp/{bank_id}/` (27 ferramentas) e multi-bank em `/mcp/` (30 ferramentas).
- **Seleção do bank:** caminho da URL > header `X-Bank-Id` > `HINDSIGHT_MCP_BANK_ID`.
- ⚠ **Sem autenticação por padrão.** A autenticação vem do `ApiKeyTenantExtension`.
- ⚠ No MCP o recall usa `budget = "high"` por padrão: caro em tokens.
- `HINDSIGHT_API_MCP_INSTRUCTIONS` acrescenta texto às descrições das ferramentas.
- O learnharness já depende de `@modelcontextprotocol/sdk` 1.32.1. Conectar um cliente MCP Streamable HTTP em `http://127.0.0.1:8888/mcp/lh-english/` funciona sem código novo de protocolo.

### 4.4 Ciclo de vida do daemon pelo Node: `hindsight-all-npm/src/{server.ts,command.ts,types.ts}` (MIT, Node ≥ 22)

```ts
const srv = new HindsightServer({ profile: 'learnharness', port: 8888, host: '127.0.0.1',
  embedVersion: '1.2.1', env: { HINDSIGHT_API_LLM_PROVIDER: 'chatgpt', ... }, readyTimeoutMs: 30000 });
await srv.start();  // uvx hindsight-embed@<ver> profile create <p> --merge --port <port> --env K=V...
                    // && uvx hindsight-embed@<ver> daemon --profile <p> start ; poll GET /health (1s)
await srv.stop();   // daemon --profile <p> stop (timeout 5s)
```

- O spawn usa `windowsHide: true`.
- `getEmbedCommand()` devolve `["uvx","hindsight-embed@<ver>"]`, ou `["uv","run","--directory",path,"hindsight-embed"]` quando há `embedPackagePath`.
- **Exige `uv` instalado.** No Electron isso significa empacotar o uv (cerca de 30 MB) e baixar Python e wheels no primeiro uso. É inadequado para um app de estudante, mas serve para desenvolvimento e avaliação.

### 4.5 Templates de bank: `hindsight-docs/docs/developer/api/bank-templates.mdx`
Um manifesto JSON único cria bank, mental models e directives:

```json
{ "version": "1",
  "bank": { "reflect_mission": "...", "retain_mission": "...", "retain_extraction_mode": "concise",
            "observations_mission": "...", "entity_labels": [...], "disposition_empathy": 4 },
  "mental_models": [ { "id": "pontos-fracos", "name": "...", "source_query": "...", "trigger": {...} } ],
  "directives": [ { "name": "...", "content": "..." } ] }
```

**Ideia direta para a meta 3:** um template por domínio ("Inglês", "Eletrônica") versionado em `src/memory/templates/*.json`.

---

## 5. Algoritmos-chave (o que portar)

### 5.1 Retain: extração de fatos (`ENGINE/retain/fact_extraction.py`, 3,9k linhas; `ENGINE/retain/orchestrator.py`, 5k linhas)

**Pipeline**
1. **Chunking** recursivo, ciente de conversas e de JSONL. `DEFAULT_RETAIN_CHUNK_SIZE = 3000` caracteres.
2. **Delta retain:** quando o `document_id` já existe, só reprocessa chunks cujo hash mudou. `update_mode: 'replace'|'append'`.
3. **Memory Defense:** filtro de PII e segredos antes do LLM.
4. **Pré-checagem:** confirma que as embeddings estão acessíveis antes de gastar com o LLM.
5. **LLM por chunk:** saída JSON validada. Se mais de 20% dos fatos vierem malformados, faz um *retry* com uma mensagem corretiva de formato.
6. **Normalização** de cada fato (ver abaixo).
7. **Embeddings** com datas embutidas (§5.2), **resolução de entidades** (§5.3) e **links** (§5.4).
8. **Consolidação** assíncrona (§5.7).

**Schema pedido ao LLM (`ExtractedFact`)**

```
what, when, where, who, why            # 'N/A' = vazio
fact_kind: 'event' | 'conversation'
occurred_start, occurred_end: ISO | null
fact_type: 'world' | 'assistant'
entities: string[]                     # sempre inclui "user"
causal_relations: [{ target_index (< i), relation_type: "caused_by" }]   # no máximo 2 por fato
from_attachments: bool
```

**Normalização para o `Fact` armazenado**

```python
combined_text = " | ".join([what, f"When: {when}", f"Where: {where}", f"Involving: {who}", why])  # omite vazios/'N/A'
fact_type = "experience" if llm_fact_type == "assistant" else "world"
# event sem occurred_start → _infer_temporal_date(); sem occurred_end → = occurred_start
# mentioned_at = event_date (timestamp do retain)
# causal_relations com target_index fora de [0, i-1] → descartadas
```

**Prompt** (`_BASE_FACT_EXTRACTION_PROMPT` / `CONCISE_FACT_EXTRACTION_PROMPT`; também `VERBOSE_`, `VERBATIM_`, `CUSTOM_` e `CAUSAL_RELATIONSHIPS_SECTION`). As seções valem a pena portar quase literalmente:

| Seção | Regra |
|---|---|
| SELECTIVITY | Pergunta de corte: *"Would this be useful to recall in 6 months?"* |
| COREFERENCE | "my roommate" + "Emily" → "Emily (user's roommate)" |
| CLASSIFICATION | Fato do mundo/usuário versus ação do assistente |
| TEMPORAL HANDLING | Converte datas relativas em absolutas usando o Event Date. Datas grosseiras ocupam o período inteiro ("in 2015" → 2015-01-01..2015-12-31) |
| ENTITIES | Strings simples; incluir sempre "user" |
| Idioma | "Write every fact in the same language and script as the input text. Never translate." Essencial para PT e EN no mesmo app |

**Mensagem de usuário** (`_build_user_message`). A missão vai aqui, não no system prompt, **para manter o system prompt cacheável**:

```
{mission_preamble}Extract facts from the following chunk.

Chunk: {i+1}/{n}
Event Date: {Weekday, Month DD, YYYY (iso)} | Unknown
Context: {context|none}{Metadata...}{Narrator...}{ATTACHMENTS...}

Content:
{chunk}{reminders}
```

**Modos de extração:** `concise` (padrão), `verbose`, `custom` (instruções próprias), `verbatim` (guarda o texto) e `chunks` (sem LLM).

**`entity_labels`** (`ENGINE/retain/entity_labels.py`): vocabulário controlado `key:value` que o LLM pode atribuir e que vira entidade; com `tag: true`, vira também tag. O exemplo da própria docstring é `pedagogy:scaffolding`. **Para nós:**
- `concept:<nodeId>`, que liga o fato ao nó do grafo (meta 1);
- `error_type:<slug>`;
- `mastery:fragile|solid`.

### 5.2 Texto de embedding com datas (`ENGINE/retain/embedding_processing.py` → `augment_texts_with_dates`)
O vetor é calculado sobre um texto *aumentado*; o texto armazenado continua o original:

```
"{fact} (happened in {date})"            # ou "(happened from X to Y)"
+ " [" + entidades ordenadas + "]"
```

O custo é zero e melhora a recuperação de perguntas temporais e por entidade. **Portar.**

### 5.3 Resolução de entidades (`ENGINE/memories/pg/entity_resolver.py` → `_resolve_from_candidates`)

```
gate: similaridade de trigramas >= _merge_min_similarity  E  tokens compatíveis
trigramas idênticos → score 1.0
senão score = SequenceMatcher.ratio(nome, candidato) * 0.5
            + (coocorrências ponderadas com as entidades do fato / nº de vizinhos) * 0.3
            + (Δdias(last_seen) < 7 ? (1 - Δdias/7) * 0.2 : 0)
merge se round(score, 6) >= 0.6 ; labels (key:value) só por correspondência exata
```

- Fixture de teste: `hindsight-api-slim/tests/entity_resolution_cases.jsonl` (68 casos). **Copiar para os testes TS.**
- Em TS, `SequenceMatcher.ratio` pode ser trocado pelo coeficiente de Dice sobre bigramas, mas os limiares precisam ser recalibrados com a fixture.

### 5.4 Links do grafo de memória (`ENGINE/memories/pg/links.py`)

| Tipo | Regra |
|---|---|
| temporal | Unidades a até 24h de distância; `weight = max(0.3, 1 - Δh/24)`; no máximo 20 por unidade |
| semantic | kNN top 50, mantidos se cos ≥ 0,7 |
| entity | Unidades que compartilham entidade (via `unit_entities`) |
| causal | `causes`, `caused_by`, `enables`, `prevents` (do `causal_relations`) |

### 5.5 Recall (TEMPR): `ENGINE/search/retrieval.py`, `ENGINE/memories/pg/recall.py`, `link_expansion.py`, `ENGINE/search/fusion.py`, `ENGINE/search/reranking.py`

**Passo 1. Análise da consulta** (`ENGINE/query_analyzer.py`): extrai a restrição temporal com `dateparser`, pontuando os matches para rejeitar falsos positivos. **Em TS: `chrono-node`** com `chrono.pt` e `chrono.en`, já sugerido no r4.

**Passo 2. Quatro braços em paralelo, por fact_type**
- **Semântico:** pgvector HNSW parcial por fact_type, sim ≥ 0,3.
- **BM25:** tsvector. Semântico e BM25 vão juntos num `UNION ALL`.
- **Grafo** (`LinkExpansionRetriever`): sementes semânticas com sim ≥ 0,3; expansão por entidade (`COUNT DISTINCT` de entidades compartilhadas, cap de 200 por entidade), por kNN semântico (peso) e por causal (peso + 1). Score aproximado: `tanh(shared*0.5) + semantic + causal`, no intervalo [0, 3].
- **Temporal:** `_select_with_temporal_coverage` distribui candidatos em **8 buckets** da janela e faz round-robin por similaridade, para cobrir o período inteiro. Proximidade: `1 - min(|meio - centro| / (janela/2), 1)`. Faz spreading activation pelos links com `_TEMPORAL_DECAY = 0.7` e `_CAUSAL_BOOST = {causes: 2.0, caused_by: 2.0, enables: 1.5, prevents: 1.5}`.

**Passo 3. Fusão**

```ts
// port de ENGINE/search/fusion.py :: reciprocal_rank_fusion
function rrf(lists: Record<'semantic'|'bm25'|'graph'|'temporal', string[]>, k = 60) {
  const s = new Map<string, number>();
  for (const ids of Object.values(lists)) ids.forEach((id, r) => s.set(id, (s.get(id) ?? 0) + 1 / (k + r + 1)));
  return [...s].sort((a, b) => b[1] - a[1]);
}
```

- O mesmo arquivo traz `interleave_fusion` (round-robin, usado na consolidação para que o "gêmeo" semântico nº 1 não se perca) e `cap_per_source`.

**Passo 4. Rerank e combined scoring** (`apply_combined_scoring`)
- O pré-filtro mantém 300 candidatos.
- Logits do CE fora de [0,1] passam por sigmoid.
- Com reranker *passthrough* (sem CE), o rank RRF é mapeado para [0,1; 1,0], para que os boosts **não virem a única ordenação**.

```ts
const recency  = linearRecency(daysAgo);                 // max(0.1, min(1, 1 - dias/365)); sem data → 0.5
                                                         // (alt.: exponencial 0.5**(dias/90) | none → 0.5)
const temporal = temporalProximity ?? 0.5;               // neutro se a consulta não é temporal
const proofNorm = clamp(0.5 + Math.log(proofCount) / 10, 0, 1); // proof=1 → 0.5 (neutro); fatos crus → 0.5
const final = ce * (1 + 0.2 * (recency - 0.5)) * (1 + 0.2 * (temporal - 0.5)) * (1 + 0.1 * (proofNorm - 0.5));
```

- Unidades com data grosseira (um período) contam a idade a partir do *fim* do período, com teto de 0,5.
- Os boosts movem a nota em no máximo ±10%, ±10% e ±5%: o CE manda.
- Testes: `hindsight-api-slim/tests/test_combined_scoring.py`, `test_fusion_cap.py`, `test_interleave_fusion.py`.

**Passo 5. Empacotamento por orçamento** (`hindsight-docs/docs/developer/retrieval.md`)
- Budget de candidatos: `low=100`, `mid=300` (padrão), `high=1000`.
- Modo adaptativo: `clamp(max_tokens * ratio, 20, 2000)`.
- O empacotamento até `max_tokens` (padrão 4096) **pula itens grandes demais, mas sempre devolve o primeiro**.
- Entidades (até 500 tokens), chunks de origem (até 8192) e source facts das observations (até 4096) entram em orçamentos separados.

**Saída para prompt** (`recallResponseToPromptString`): `FACTS:` seguido de um JSON por fato, com `text`, `context`, `occurred_start`, `occurred_end`, `mentioned_at` e `source_chunk`, mais `ENTITIES:\n## nome\nobs`. O formato é simples e funciona; o r4 sugere uma versão mais compacta em texto para economizar tokens.

### 5.6 Reflect (CARA): `ENGINE/reflect/{agent.py,prompts.py,tools_schema.py}`

- **Ferramentas** (formato OpenAI): `search_mental_models`, `read_mental_models`, `search_observations`, `recall`, `expand` (memória → chunk → documento) e `done{answer, memory_ids, mental_model_ids, observation_ids, answer_found}`. **Todas têm um argumento `reason`** (para depuração).
- ⚠ As ferramentas são chamadas **por response schema**, não como tool calls nativas (`providers/tools_via_schema.py`). Assim o reflect roda em qualquer provedor que aceite JSON estruturado, inclusive os de assinatura.
- **Sequência forçada.** Com `tool_choice` nomeado, o agente força `search_mental_models` → `search_observations` → `recall`. Um mental model *fresco e utilizável* libera os passos restantes.
- **Gate de suficiência.** Um `done` com `answer_found: false` antes de qualquer `recall` é **recusado uma vez**, e o agente força um recall. A descrição de `done` traz um texto explícito para isso: um resultado que só compartilha o tópico não é resposta.
- **Limites.** No máximo 10 iterações (`DEFAULT_MAX_ITERATIONS`). Se o contexto estoura, apaga resultados antigos e faz `_forced_final_synthesis`.
- **Prompt de sistema** (`build_system_prompt_for_tools`), em ordem:
  1. regra anti-alucinação;
  2. directives;
  3. mission;
  4. CRITICAL RULES;
  5. Temporal Reasoning: o `mentioned_at` mais recente prevalece, exceto DECISIONs com justificativa;
  6. Conflicts/Ambiguity;
  7. Showing Your Reasoning: checagem KEEP/DROP em 6 passos;
  8. HIERARCHICAL RETRIEVAL STRATEGY, adaptada às ferramentas habilitadas.
- **Custo.** Segundo `hindsight-docs/blog/2026-11-03-hindsight-models.md`, um reflect consome cerca de 45k tokens de entrada no gemini-3.8-flash, ou 7,5k quando orquestrado pelo decision model, ao preço de cerca de 3 pontos de qualidade em 4 de 7 LLMs. **Não chamar reflect a cada turno do tutor.**

### 5.7 Consolidação → observations: `ENGINE/consolidation/{prompts.py,consolidator.py,triage.py}`

- **Prompt** (`prompts.py`, 243 linhas, portável inteiro): `build_consolidation_system_prompt()` junta intro, LANGUAGE, `_TIME_RULE`, `_RULES` e `_OUTPUT_SECTION`, esta com um exemplo completo F1..F6 / O1..O6.
- `build_consolidation_input(facts_text, observations_text, observations_mission, capacity_note)` monta a entrada.
- **`_TIME_RULE`:** vale o `mentioned_at` mais recente; fatos antigos recebem o marcador `(stated after this fact)` e observations mais novas que o lote recebem `newer_than_input_facts`.
- **Contrato de saída por fato:**

```json
{ "facts": [ { "fact_id": "F3", "about": "uso de present perfect", "kind": "lasting",
    "existing": [ { "observation_id": "O2", "observation_about": "...", "effect": "changes",
                    "observation_text": "...", "text": "nova redação" } ],
    "adds": "no", "new": [], "same_as_fact": false } ],
  "deletes": [ { "observation_id": "O5", "merged_into": "O2" } ] }
```

- **Valores de `effect`:** `unrelated`, `repeats` (sobe o `proof_count`), `changes` (reescreve e guarda o estado anterior em `history`) e `ends` (o estado acabou).
- **Regras de `_RULES`:**
  - cada observation é uma frase curta, sobre um sujeito e uma faceta;
  - "Never calculate" contagens;
  - `deletes` são raros e sempre com `merged_into`.
- **Missão padrão:** *"Track anything notable in the new facts — names, numbers, dates, places, events, decisions, claims, relationships, and recurring patterns."* **Para nós**, deve ser uma missão pedagógica (§10.3).
- **`consolidator.py` (4,3k linhas):**
  - `_FactBatchResponse.to_actions(...)` converte as decisões em creates, updates, deletes e skips, com dedup, citações e notas de estado anterior `(YYYY-MM-DD HH:MM: ...)` até `_MAX_EARLIER_STATES`.
  - `_find_related_observations` usa recall com `fact_type=["observation"]`, `tags_match="all_strict"`, `reranking="interleave"` e `include_source_facts=True`.
  - `_build_observations_for_llm` usa ids curtos (O1, O2...) para economizar tokens e reduzir alucinação de UUID.
  - Reconcilia quase-duplicatas com cos ≥ 0,97. Lotes de 50 fatos.
  - Faz *triage* opcional com o decision model (`triage.py`) para descartar barato o que não muda nada.
- **Escopos:** `observation_scopes` (`per_tag`, `combined`, `all_combinations`, `shared` ou listas explícitas) definem *onde* as observations vivem. Com `per_tag` e a tag `concept:X`, cada conceito do grafo ganha seu próprio conjunto de crenças. Há também *strategies* por escopo (`consolidation-strategies/preview`).
- **Fixtures:** `hindsight-api-slim/tests/consolidation_actions.py` (167 linhas) e `consolidation_answers.py` (54), além de `test_consolidation*.py`. **Portar como testes de contrato.**

### 5.8 Mental models: refresh full e delta (`ENGINE/mental_model_refresh.py`, `ENGINE/reflect/structured_doc.py`, `ENGINE/reflect/delta_ops.py`)

- **Refresh `full`:** roda reflect com a `source_query` e substitui o conteúdo.
- **Refresh `delta`:** o LLM recebe o documento atual estruturado e os fatos novos, e devolve **operações tipadas**:
  - `AppendBlockOp`, `InsertBlockOp`, `ReplaceBlockOp`, `RemoveBlockOp`;
  - `AddSectionOp`, `RemoveSectionOp`, `ReplaceSectionBlocksOp`, `RenameSectionOp`.

  `apply_operations` descarta e reporta referências inválidas, e **nunca substitui o documento por conteúdo parcial**.
- **Documento estruturado:** `StructuredDocument{ sections: Section{id, heading, level, blocks: Block{id,text}[]}[] }`, com `split_markdown` (sem perdas) e `render_document`. Testes: `hindsight-api-slim/tests/test_structured_doc.py`, `test_delta_operation_parse.py`, `test_mental_model_delta.py`.
- **Prompts:** `STRUCTURED_DELTA_SYSTEM_PROMPT` e `DELTA_SYSTEM_PROMPT` em `ENGINE/reflect/prompts.py`.
- **Gatilhos** (`trigger`):
  - `mode: full|delta`;
  - `refresh_after_consolidation`, `refresh_cron`, `full_refresh_cron` e `min_refresh_interval_seconds`;
  - filtros (`factTypes`, `tagsMatch`, `tagGroups`, `excludeMentalModels`) e orçamentos (`recallMaxTokens`, `budget`).
- **Staleness:** compara `last_memory_seen_at` com `last_refreshed_at` (`hindsight-docs/docs/developer/api/mental-models.mdx`).
- **Fallback de delta para full:** `RefreshOutcome` registra motivos como `no_baseline_content` e `source_query_changed`.
- ⚠ Deleções de memória **não** marcam mental models como desatualizados.
- **Por que importa para a meta 2:** um painel "Pontos fracos" atualizado por delta tem estes efeitos:
  - não reescreve tudo a cada sessão, o que é barato e estável;
  - preserva os ids de bloco, o que permite que a UI anime as mudanças e que o tutor cite um bloco específico;
  - mantém histórico, de modo que "para onde vai" vira um diff ao longo do tempo.

### 5.9 Decision models (`hindsight-docs/docs/developer/decision-models.mdx`, blog de 03/11/2026)
- `hs-decide-1-flash` (0,8B) substitui o LLM grande nas decisões pequenas: triage da consolidação, orquestração do reflect e reranking. A mediana é de 167ms por requisição.
- Resultados publicados:
  - consolidação melhora em todos os LLMs (glm-5.3-flash sobe de 36 para 84);
  - pages: gpt-6-luna sobe de 82,5 para 90,0;
  - eval de recall: decision model 19/19, contra rrf 10/19 e cross-encoder ms-marco 6/19.
- Rodar localmente exige vLLM e GPU, o que **não é viável em notebook de estudante**. O serviço hospedado (Hindsight Inference) cobra cerca de US$0,02 por milhão de tokens de entrada, mas é um terceiro. Fica **fora do MVP**.

---

## 6. Protocolo de benchmark e ressalvas

- **Harness público:** o AMB (github.com/vectorize-io/agent-memory-benchmark, agentmemorybenchmark.ai), referenciado por `hindsight-system-evals/README.md`.
  - Execução: `uv run run-amb --dataset longmemeval --split s`.
  - O AMB usa **Gemini para responder e para julgar** e exige `GEMINI_API_KEY`; `AMB_REF=main`.
  - Datasets: LoCoMo, LongMemEval, BEAM, PersonaMem e sde-bench.
- **Evals internos por operação** (`hindsight-system-evals/`):
  - retain: 35 casos de capacidade;
  - recall: 19 casos num haystack de ~300 memórias, comparando rerankers (CE local 6/19, rrf 10/19, decision model 19/19).
- **A página benchmarks.hindsight.vectorize.io não descreve o protocolo** (backbone, budget, tokens por consulta). O paper arXiv 2512.12818 relata:
  - backbone OSS de 20B sobe de 39% (full-context) para 83,6% com Hindsight;
  - backbone maior chega a 91,4% em LongMemEval e até 89,61% em LoCoMo;
  - o melhor sistema aberto anterior em LoCoMo tinha 75,78%.
- **Ressalvas** (do r4 e da leitura do código):
  1. os números são autorreportados com orçamento alto, e o README cita reprodução pela Virginia Tech e pelo Washington Post;
  2. em harness neutro, 72,2% em LME-S (OmniMemEval) e 59,8% em BEAM-10M;
  3. cada consulta injeta de 24k a 43k tokens no AMB;
  4. o juiz LLM é Gemini.
- **O que fazer:** montar um mini-benchmark próprio de "memória do aluno", com categorias inspiradas no LongMemEval:
  - knowledge update: "o aluno já dominou X?" depois de errar e depois acertar;
  - temporal: "o que ele estudou semana passada?";
  - multi-session;
  - abstention.

  Gerar de 30 a 50 sessões sintéticas por domínio em PT e EN e medir acurácia × tokens injetados × custo de consolidação. O formato de caso dos evals de recall (consulta, ids esperados, haystack) serve de molde.

---

## 7. IA por assinatura (meta 7): o que o Hindsight ensina

### 7.1 Provedor `chatgpt`: `ENGINE/providers/chatgpt_auth.py` (fluxo oficial)
- **Documentação:** https://developers.openai.com/siwc/token-sharing-open-source ("Sign in with ChatGPT for open-source apps").
- **Endpoints e escopos:**
  - `ISSUER = https://auth.openai.com`;
  - `AUTHORIZE_URL = ISSUER/api/accounts/authorize`;
  - `TOKEN_URL = ISSUER/api/accounts/oauth/token`;
  - `RESOURCE = https://api.openai.com/v1`;
  - escopos `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct` (o plano exige `chatgpt.tokens.use.direct`).
- **Registro dinâmico:** `client_id = "dynamic_agent_client"`, com `agent_name_hint` no primeiro registro; o `ext_agent_host_id` é persistido.
- **Fluxo:** PKCE S256 com loopback em `http://127.0.0.1:1455/auth/callback`.
- **Tokens:** o access token vale 1h e é renovado 300s antes de expirar. O refresh token **rotaciona**: salvar o novo refresh token a cada renovação, sob file lock, porque dois processos renovando ao mesmo tempo invalidam a sessão.
- **Chamadas:** `POST api.openai.com/v1/responses` com `store:false` e `stream:true`.
- **No Electron:** o processo main abre o navegador do sistema e escuta o loopback. Os tokens ficam em `safeStorage`, nunca no renderer. Isso se encaixa no pi-ai como provedor customizado; o modelo é escolhido em runtime.

### 7.2 Provedor `openai-codex` (`ENGINE/providers/codex_auth.py`)
Reaproveita `~/.codex/auth.json` (client `app_EMoamEEZ73f0CkXaXp7hrann`) e chama o **backend privado** do ChatGPT. **Não usar como padrão:** é dependente de API não pública. O 7.1 é a via oficial.

### 7.3 `claude-code` (Anthropic por assinatura)
- Funciona pelo Claude Agent SDK, mas os termos dizem que terceiros **não devem oferecer login claude.ai**, e houve repressão em janeiro de 2026. A doc do Hindsight limita a "uso pessoal/local".
- **Recomendação:** no learnharness, a Anthropic entra só por **chave de API** do próprio usuário, ou pelo Claude Code instalado pelo próprio usuário com aviso explícito. Não oferecer um botão "Login com Claude".

### 7.4 Telemetria de tokens (meta 6)
A tabela `llm_requests` registra cada chamada com operação, provedor, modelo, tokens e duração; `GET .../llm-requests/stats?split_by=model|operation` agrega. **Copiar o desenho:**
- um `llm_requests` local (JSONL ou SQLite) gravado por um wrapper único em volta do pi-ai, com `{ts, domain, sessionId, operation: 'tutor'|'retain'|'consolidate'|'mm_refresh'|'reflect', provider, model, inputTokens, cachedTokens, outputTokens, ms}`;
- "horas de estudo por dia" vem dos timestamps de sessão, não daqui.

---

## 8. Arquivos exatos a copiar ou adaptar

Caminhos relativos a `C:/Users/nicoolas/Pictures/learnharness/_refs/extra/vectorize-io__hindsight`. Todos são MIT, salvo indicação.

| # | Arquivo | O que extrair | Ação | Destino sugerido no learnharness |
|---|---|---|---|---|
| 1 | `hindsight-api-slim/hindsight_api/engine/retain/fact_extraction.py` | `_BASE_FACT_EXTRACTION_PROMPT`, `CONCISE_FACT_EXTRACTION_PROMPT`, `CAUSAL_RELATIONSHIPS_SECTION`, `_build_user_message`, schema `ExtractedFact` e a normalização para `Fact` (combined_text, mapeamento de tipos, inferência temporal, filtro causal, retry acima de 20%) | **Adaptar** (prompts quase literais + zod) | `src/memory/retain/extract.ts`, `src/memory/prompts/extract.ts` |
| 2 | `hindsight-api-slim/hindsight_api/engine/retain/embedding_processing.py` | `augment_texts_with_dates` | **Portar** (cerca de 20 linhas) | `src/memory/embed/augment.ts` |
| 3 | `hindsight-api-slim/hindsight_api/engine/retain/entity_labels.py` | Formato `key:value` e regra `tag: true` | **Adaptar** | `src/memory/retain/labels.ts` |
| 4 | `hindsight-api-slim/hindsight_api/engine/retain/orchestrator.py` | Delta retain por hash de chunk, agrupamento por `document_id` e ordem das etapas | **Inspirar** (não portar as 5k linhas) | `src/memory/retain/index.ts` |
| 5 | `hindsight-api-slim/hindsight_api/engine/memories/pg/entity_resolver.py` | `_resolve_from_candidates`: pesos 0,5/0,3/0,2, limiar 0,6, gate de trigramas | **Portar** | `src/memory/entities.ts` |
| 6 | `hindsight-api-slim/tests/entity_resolution_cases.jsonl` | 68 casos | **Copiar** (fixture) | `test/memory/fixtures/entity_resolution_cases.jsonl` |
| 7 | `hindsight-api-slim/hindsight_api/engine/memories/pg/links.py` | Regras de link temporal, semântico e causal com os pesos | **Portar** | `src/memory/links.ts` |
| 8 | `hindsight-api-slim/hindsight_api/engine/memories/pg/recall.py` | `_select_with_temporal_coverage` (8 buckets), proximidade temporal, spreading (`_TEMPORAL_DECAY`, `_CAUSAL_BOOST`) | **Portar a lógica** (o SQL vira JS) | `src/memory/recall/temporal.ts` |
| 9 | `hindsight-api-slim/hindsight_api/engine/memories/pg/link_expansion.py` | Braço de grafo: sementes ≥ 0,3, expansão por entidade/semântico/causal, `tanh(shared*0.5)+...` | **Portar a lógica** | `src/memory/recall/graph.ts` |
| 10 | `hindsight-api-slim/hindsight_api/engine/search/fusion.py` | `reciprocal_rank_fusion` (k=60), `interleave_fusion`, `cap_per_source` | **Portar** | `src/memory/recall/fusion.ts` |
| 11 | `hindsight-api-slim/hindsight_api/engine/search/reranking.py` | `apply_combined_scoring`, `compute_recency_decay`, `_recency_for_unit`, fallback passthrough | **Portar** | `src/memory/recall/score.ts` |
| 12 | `hindsight-api-slim/tests/test_combined_scoring.py`, `test_fusion_cap.py`, `test_interleave_fusion.py` | Casos numéricos | **Traduzir para vitest** | `test/memory/recall/*.test.ts` |
| 13 | `hindsight-api-slim/hindsight_api/engine/query_analyzer.py` | Pontuação de matches de data (anti falso positivo) | **Inspirar** (usar chrono-node) | `src/memory/recall/temporal-query.ts` |
| 14 | `hindsight-docs/docs/developer/retrieval.md` | Orçamentos low/mid/high, modo adaptativo, regra de empacotamento | **Seguir** | `src/memory/recall/budget.ts` |
| 15 | `hindsight-api-slim/hindsight_api/engine/consolidation/prompts.py` | Prompt de consolidação inteiro (243 linhas) | **Copiar/adaptar** (trocar a missão) | `src/memory/prompts/consolidate.ts` |
| 16 | `hindsight-api-slim/hindsight_api/engine/consolidation/consolidator.py` | `_FactBatchResponse.to_actions`, `_build_observations_for_llm` (ids curtos), `_find_related_observations`, dedup 0,97, `_MAX_EARLIER_STATES` | **Adaptar** (só as partes citadas) | `src/memory/consolidate.ts` |
| 17 | `hindsight-api-slim/tests/consolidation_actions.py`, `consolidation_answers.py` | Respostas canônicas → ações | **Traduzir** (fixtures) | `test/memory/consolidate.test.ts` |
| 18 | `hindsight-api-slim/hindsight_api/engine/reflect/structured_doc.py` | `Block`, `Section`, `StructuredDocument`, `split_markdown`, `render_document` | **Portar** | `src/memory/mm/structured-doc.ts` |
| 19 | `hindsight-api-slim/hindsight_api/engine/reflect/delta_ops.py` | 8 operações e `apply_operations` (descarta referências inválidas e as reporta) | **Portar** | `src/memory/mm/delta-ops.ts` |
| 20 | `hindsight-api-slim/tests/test_structured_doc.py`, `test_delta_operation_parse.py`, `test_mental_model_delta.py` | Casos | **Traduzir** | `test/memory/mm/*.test.ts` |
| 21 | `hindsight-api-slim/hindsight_api/engine/reflect/prompts.py` | `build_system_prompt_for_tools` (blocos de regras temporais, conflito e KEEP/DROP), `STRUCTURED_DELTA_SYSTEM_PROMPT` | **Adaptar** | `src/memory/prompts/reflect.ts`, `src/memory/prompts/mm-delta.ts` |
| 22 | `hindsight-api-slim/hindsight_api/engine/reflect/tools_schema.py` | Descrições das 6 ferramentas, `_DONE_SUFFICIENCY_GATE`, `answer_found` | **Adaptar** como ferramentas do pi-agent-core (typebox/zod) | `src/agent/memory-tools.ts` |
| 23 | `hindsight-api-slim/hindsight_api/engine/reflect/agent.py` | Sequência forçada, liberação por mental model fresco, recall obrigatório antes de uma resposta negativa | **Inspirar** (cerca de 100 linhas de TS) | `src/memory/reflect.ts` |
| 24 | `hindsight-api-slim/hindsight_api/engine/mental_model_refresh.py` | Gatilhos, staleness, fallback de delta para full | **Inspirar** | `src/memory/mm/refresh.ts` |
| 25 | `hindsight-api-slim/hindsight_api/alembic/versions/o1a2b3c4d5e6_oracle_baseline.py` | Colunas e CHECKs de `memory_units`, `memory_links`, `mental_models`, `entities` | **Referência de schema** | `src/memory/store/schema.sql` |
| 26 | `hindsight-api-slim/hindsight_api/engine/providers/chatgpt_auth.py` | Fluxo OAuth "Sign in with ChatGPT" | **Portar para TS** (processo main do Electron) | `electron/auth/chatgpt.ts` |
| 27 | `hindsight-clients/typescript/src/index.ts` | `HindsightClient`, `retryOnCapacity`, `recallResponseToPromptString` | **Usar como dependência** só no modo sidecar; ou copiar o `retryOnCapacity` | `src/memory/sidecar/client.ts` |
| 28 | `hindsight-all-npm/src/server.ts`, `command.ts`, `types.ts` | Spawn, poll e stop do daemon com `windowsHide` | **Adaptar** (só no modo dev/eval) | `electron/sidecar/hindsight.ts` |
| 29 | `hindsight-integrations/ai-sdk/src/tools/index.ts` | Como expor retain/recall/reflect como ferramentas zod | **Molde** para o pi-agent-core | `src/agent/memory-tools.ts` |
| 30 | `hindsight-integrations/obsidian/` (`sync.ts`, `frontmatter.ts`, `client.ts`) | Sincronização com o vault e convenção de frontmatter | **Inspirar** (meta 4) | `src/integrations/obsidian/` |
| 31 | `hindsight-docs/docs/developer/api/bank-templates.mdx` | Formato do manifesto de bank | **Adotar o formato** | `src/memory/templates/{english,electronics}.json` |

---

## 9. Dependências

**Opção C (porta TS nativa, recomendada)**

| Necessidade | Pacote | Observação |
|---|---|---|
| LLM | `@earendil-works/pi-ai` (já presente) | Saída JSON via schema, igual ao `tools_via_schema` do Hindsight |
| Validação | `zod` 4 (já presente) | Schemas `ExtractedFact` e `ConsolidationResponse` |
| Datas na consulta | `chrono-node` (locales `pt` e `en`) | Substitui o `dateparser` |
| Embeddings | `onnxruntime-node` + `hindsight-ai/hs-embed-1` (`onnx/model.onnx`) | Mean pooling e normalização L2, **sem prefixos**, 384 dimensões. Rodar no processo main ou num worker. Tokenizer: carregar o `tokenizer.json` (via `@huggingface/tokenizers` ou `@huggingface/transformers`) |
| Reranker | `hindsight-ai/hs-rerank-1` (`onnx/model.onnx`, int8) | Pares (consulta, documento) → nota entre 0 e 1. Opcional; sem ele, usar o fallback por rank RRF |
| Persistência | `better-sqlite3` + FTS5 (BM25 embutido) + `sqlite-vec` **ou** força bruta em JS | Um aluno gera ~10³–10⁵ fatos por domínio; força bruta em 50k×384 float32 leva ~10–20 ms, então HNSW não é necessário no começo |
| Alternativa sem módulo nativo | JSON/JSONL (padrão atual em `src/store/`) + `minisearch` (BM25) + vetores em `Float32Array` | Evita o rebuild nativo no Electron |

**Opção A/B (sidecar ou MCP, apenas desenvolvimento)**
- `uv` (que baixa Python 3.11+), `hindsight-embed@1.2.1` e Postgres (`pg0` embarcado, suportado no Windows) ou Docker.
- `@vectorize-io/hindsight-client@1.2.1` ou `@modelcontextprotocol/sdk`.
- Node ≥ 22 para `@vectorize-io/hindsight-all`.

---

## 10. Plano de integração

### 10.1 Decisão
- **Produção: opção C.** É uma porta TS nativa e in-process, com dados locais por domínio. Motivos:
  - não exige Python nem Postgres no notebook do aluno;
  - o orçamento de contexto fica sob controle nosso;
  - funciona offline, com exceção do LLM;
  - a licença MIT permite portar prompts e algoritmos.
- **Desenvolvimento e avaliação: opção A** (sidecar via `hindsight-all-npm`) como *oráculo*. O mesmo conjunto de sessões sintéticas passa pelo Hindsight real e pela nossa porta, e comparamos acurácia e tokens. A opção B (MCP) só vale para uma demo rápida conectando o tutor ao `/mcp/lh-english/`, sem código de memória.

### 10.2 Módulo proposto (`src/memory/`)

```
src/memory/
  store/        schema.sql | jsonl-store.ts   (um arquivo por domínio = bank; meta 3)
  embed/        onnx-embedder.ts, augment.ts  (hs-embed-1, datas + entidades)
  retain/       chunk.ts, extract.ts, labels.ts, index.ts  (fila assíncrona no main)
  entities.ts   links.ts
  recall/       semantic.ts, bm25.ts, graph.ts, temporal.ts, temporal-query.ts,
                fusion.ts, score.ts, budget.ts, index.ts
  consolidate.ts               (lotes de 50, ids curtos, to_actions, dedup 0.97)
  mm/           structured-doc.ts, delta-ops.ts, refresh.ts  (mental models)
  reflect.ts                   (sequência forçada; usado só nos refreshes e em perguntas abertas)
  prompts/      extract.ts, consolidate.ts, reflect.ts, mm-delta.ts  (com cabeçalho MIT)
  templates/    english.json, electronics.json  (formato bank-template)
  telemetry.ts                 (llm_requests; meta 6)
```

**Tipos centrais em TS:**

```ts
type FactType = 'world' | 'experience' | 'observation';
interface MemoryUnit {
  id: string; domainId: string; documentId?: string; chunkId?: string;
  text: string; embedding: Float32Array; context?: string;
  occurredStart?: string; occurredEnd?: string; mentionedAt: string;
  factType: FactType; tags: string[]; entityIds: string[];
  proofCount?: number; sourceMemoryIds?: string[];
  history?: { at: string; text: string }[]; consolidatedAt?: string;
}
type LinkType = 'temporal'|'semantic'|'entity'|'causes'|'caused_by'|'enables'|'prevents';
interface MentalModel {
  id: string; domainId: string; name: string; sourceQuery: string;
  doc: StructuredDocument; tags: string[]; maxTokens: number;
  trigger: { mode: 'full'|'delta'; refreshAfterConsolidation: boolean; minRefreshIntervalSeconds: number };
  lastRefreshedAt?: string; lastMemorySeenAt?: string;
  history: { at: string; ops: DeltaOp[] }[];
}
```

### 10.3 Mapeamento pedagógico (o que guardar e como)

**Bank = domínio** (`english`, `electronics`), cada um com um arquivo ou banco próprio. Isso dá isolamento forte (meta 3) e exportação e backup triviais.

**Retain ao fim de cada sessão** (e a cada N turnos em sessões longas):
- `documentId = sessionId`, para que o delta retain reprocesse só o que mudou;
- `timestamp` = início da sessão. ⚠ Sem isso as datas relativas ficam erradas;
- `context = "Sessão de estudo de {domínio}. 'user' é o aluno; 'assistant' é o tutor."`, para que o LLM separe `world` (aluno) de `experience` (tutor);
- tags: `domain:<id>`, `session:<id>` e `concept:<nodeId>` dos nós tocados (vindos de `src/core/graph.ts`);
- `entity_labels`: `concept:*`, `error_type:*` e `mastery:*`;
- eventos estruturados (quiz, resultados de flashcard do Anki) entram como texto curto e factual: *"18/11/2026: acertou 3/5 em 'present perfect vs simple past'; dois erros usando 'did' + particípio."*

**Missão de retain (exemplo):** *"Registre o que revela o conhecimento do aluno: acertos, erros (com o tipo de erro), dúvidas, confusões entre conceitos, objetivos, prazos, preferências de estudo, sinais de cansaço ou frustração. Ignore conversa social sem valor pedagógico."*

**Missão de observations:** *"Mantenha crenças curtas sobre o aluno, uma por conceito e faceta: nível de domínio, erro recorrente, conceito frágil, preferência didática. Use 'changes' quando a evidência nova contradiz e 'ends' quando um problema foi superado."* Com `observation_scopes: 'per_tag'` sobre `concept:*`, cada nó do grafo ganha suas crenças, e o `proof_count` vira evidência acumulada, útil como sinal auxiliar de domínio.

**Mental models por domínio** (`trigger: {mode:'delta', refreshAfterConsolidation:true, minRefreshIntervalSeconds:600}`):

| id | source_query | Meta |
|---|---|---|
| `estado-atual` | "Onde o aluno está agora neste domínio: conceitos dominados, em progresso e não vistos; nível estimado; evidências com data." | 2 |
| `pontos-fracos` | "Quais erros recorrentes e conceitos frágeis o aluno tem hoje? Para cada um: exemplo, frequência e última ocorrência." | 2 |
| `trajetoria` | "Para onde o aluno está indo: objetivos declarados, próximos passos combinados, prazos e o que mudou desde a última semana." | 2 |
| `como-aprende` | "O que funciona e o que cansa este aluno: formatos preferidos, duração ideal de sessão, sinais de fadiga." | 9 |

**Directives** (aplicadas ao reflect e aos refreshes):
- "Não declarar um conceito como dominado sem pelo menos 2 acertos em sessões diferentes."
- "Pontos fracos superados vão para uma seção 'Superados', não são apagados."

**Uso no tutor** (`src/agent/teacher-agent.ts`). É barato, porque evita reflect a cada turno:
1. No início da sessão, injetar no system prompt os 3 ou 4 mental models renderizados (cerca de 1,5–3k tokens, **cacheáveis**).
2. Dar ao agente a ferramenta `memory_recall(query, tags?)`, com budget `mid` e `maxTokens` de 1500 a 2000, para detalhes sob demanda.
3. `memory_reflect` fica só para perguntas abertas do aluno ("como eu evoluí este mês?").

**Fonte de verdade:** a memória é **qualitativa**. O domínio "oficial" de cada conceito (para XP e para o algoritmo de repetição espaçada) continua no grafo e no store de flashcards. As observations alimentam o tutor e podem servir de *feature* para o Monte Carlo (meta 5), mas não o substituem.

### 10.4 Fases

| Fase | Entrega | Critério de pronto |
|---|---|---|
| 0. Oráculo (1–2 dias, dev) | Script de dev sobe o Hindsight via `hindsight-all-npm` (bank `lh-eval-english`) e roda 30 sessões sintéticas em PT/EN mais 40 perguntas | Linha de base de acurácia e tokens por consulta registrada |
| 1. Store + retain | `src/memory/store`, `embed` (hs-embed-1 ONNX), `retain` com prompts portados (itens 1–3 e 5–7 da §8), telemetria `llm_requests` | Fixture de entidades passando (≥ 90% dos 68 casos); fatos com datas absolutas corretas |
| 2. Recall TEMPR | 4 braços, RRF, scoring, budget (itens 8–14) | Testes numéricos traduzidos passando; acurácia de recall ≥ a do oráculo com ≤ 1/5 dos tokens |
| 3. Consolidação | Prompt e `to_actions` (itens 15–17), escopo por `concept:*` | Fixtures de consolidação passando; `proof_count` e `history` coerentes em sessões sintéticas com "knowledge update" |
| 4. Mental models delta | `structured-doc`, `delta-ops`, `refresh` (itens 18–24); UI de painel por domínio | 4 painéis atualizando após cada sessão sem reescrever blocos não afetados |
| 5. Tutor + extras | Injeção no system prompt, ferramenta `memory_recall`, export de painéis e pages para o Obsidian (meta 4), estatísticas por modelo (meta 6), OAuth ChatGPT (meta 7, item 26) | Sessão real de ponta a ponta; tokens por turno medidos |

### 10.5 Relação com as metas

| Meta | Contribuição do Hindsight |
|---|---|
| 1. Grafo massivo | `entity_labels concept:<nodeId>` ligam memórias aos nós; o braço de grafo usa entidades compartilhadas. A expansão procedural do grafo não é escopo do Hindsight |
| 2. Memória de contexto | **Núcleo:** retain → observations → mental models "estado / pontos fracos / trajetória" |
| 3. Sessões isoladas | Bank por domínio (arquivo próprio), com templates de bank |
| 4. Anki/Obsidian | Plugin Obsidian de referência; pages/mental models exportáveis como markdown |
| 5. XP Monte Carlo | Indireto: `proof_count` e histórico das observations como features. Nada pronto |
| 6. Estatísticas | Desenho de `llm_requests` com `split_by=model\|operation` |
| 7. Assinaturas | `chatgpt_auth.py` (oficial); modelo configurável por operação e por bank |
| 8. UI cel shading | Não se aplica |
| 9. Didática | Disposition (empathy), directives e o mental model `como-aprende`; evitar repetir explicações já tentadas (memórias `experience`) |

---

## 11. Armadilhas

1. **Embedding padrão só em inglês.** O `BAAI/bge-small-en-v1.5` vem como padrão. Usar `hs-embed-1` (multilíngue, com PT). Trocar de modelo depois exige reembeddar tudo: versionar o `embedding_model` em cada unidade.
2. **Timestamp do retain.** Sem um `timestamp` correto, "ontem" vira uma data errada para sempre. O Event Date entra no prompt.
3. **Missão de retain restritiva demais** gera documentos sem nenhum fato. Logar `facts=0` por chunk e alertar.
4. **Extração não determinística.** O mesmo transcript produz fatos diferentes. Testes devem usar fixtures de *saída* do LLM, não chamadas reais.
5. **Custo da consolidação.** É uma chamada de LLM por lote de 50 fatos, mais o recall de observations relacionadas. Rodar em background, com debounce no fim da sessão e um modelo barato configurável.
6. **Custo do reflect** (~45k tokens de entrada sem decision model). Nunca usar no loop do tutor; preferir mental models pré-computados.
7. **Deleções não invalidam mental models.** Se o aluno apagar uma sessão, forçar um refresh `full` dos painéis do domínio.
8. **MCP sem autenticação**, e o daemon escuta em uma porta local. Se usar o sidecar, prender em `127.0.0.1` e configurar `ApiKeyTenantExtension`.
9. **Budget padrão alto no MCP** (`high`). Passar o `budget` explicitamente.
10. **Cross-encoder genérico fraco** (6/19 no eval interno). Usar `hs-rerank-1` ou o fallback por RRF, nunca o ms-marco.
11. **Resolução de entidades em PT.** Os limiares foram calibrados em inglês, e a fixture tem 68 casos em EN. Criar casos em PT ("o aluno" / "eu" / nome próprio; termos técnicos de eletrônica com sinônimos, como "resistor" e "resistência").
12. **Refresh token rotativo do ChatGPT.** Duas janelas ou processos renovando ao mesmo tempo derrubam a sessão. Usar um único dono (o processo main) e um lock.
13. **Termos da Anthropic.** Não oferecer login claude.ai (§7.3).
14. **Benchmark ≠ produto.** Os 94,6% usam backbone forte e orçamento alto; em harness neutro o resultado cai 20 pontos ou mais. Medir no nosso domínio.
15. **Módulos nativos no Electron** (`better-sqlite3`, `onnxruntime-node`) exigem `electron-rebuild` e binários por plataforma. Avaliar a alternativa JSONL com força bruta no início.
16. **Tamanho do código.** `memory_engine.py` (25k linhas), `config.py` (6,6k) e `http.py` (10k) carregam muito multi-tenant, Oracle e webhooks. **Não portar em bloco**: portar só os arquivos da §8.

---

## 12. Perguntas em aberto

1. O `hs-embed-1` e o `hs-rerank-1` rodam no `@huggingface/transformers` (transformers.js) com o tokenizer do mmBERT, ou é preciso `onnxruntime-node` com um tokenizer separado? Qual a latência em CPU de notebook?
2. O fluxo "Sign in with ChatGPT for open-source apps" exige registro do app ou aprovação da OpenAI para distribuição? Qual `agent_name_hint` usar? O pi-ai já tem um provedor equivalente, ou é preciso escrever um?
3. Qual é o protocolo exato (backbone, budget, tokens injetados) por trás dos 94,6%? A página de benchmarks não diz, e o paper usa configurações diferentes da versão 1.2.1.
4. Os limiares de resolução de entidades (0,6) e de link semântico (0,7) valem para texto em PT com hs-embed-1, ou precisam de recalibração?
5. Vale usar o `hs-decide-1-flash` via Hindsight Inference (pago, terceiro) para triage da consolidação, ou um modelo pequeno da assinatura do usuário dá conta?
6. Qual a granularidade ideal de retain para sessões longas: por sessão inteira ou a cada N turnos? O delta por hash de chunk ajuda, mas os chunks de 3000 caracteres podem cortar exercícios no meio.
7. Como reconciliar observations ("aluno domina X", proof 5) com o estado de repetição espaçada dos flashcards quando divergem? Qual é a fonte de verdade em cada tela?
