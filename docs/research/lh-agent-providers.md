# lh-agent-providers: a camada de agente e provedores do LearnHarness

> Data da análise: 2026-11-18. Base: fork **sem modificações** do LearnHarness 0.6.1 (`package.json`, licença **AGPL-3.0-only**), Next 16.4 + Electron 44.9 + TypeScript, SDK Pi 1.4.0 (`@earendil-works/pi-ai`, `@earendil-works/pi-agent-core` e `@earendil-works/pi-telemetry`, todos **MIT**; repositório github.com/earendil-works/pi).
> Escopo lido por inteiro: `src/agent/**` (subscription-\*, chatgpt-\*, claude-code/, models.ts, prompts/, system-prompt.md, teacher-agent.ts, tools/, tools.ts, subagents/, side-chat.ts, plugin-agents.ts), `src/server/pi/**`, `src/server/{model-catalog, web-subscriptions, web-subscription-http, claude-code-config, custom-provider*, keys, pricing, turn-service, turn-runs, turn-preparation, compaction, chat-handler, plugins, plugin-host (trechos), plugin-inference (trechos)}.ts`, `app/api/{models, subscriptions, claude-code, custom-provider, keys}/**`, `src/core/{prices, cost-summary, context-usage, compaction, prompt-segments, auth-keys, auth-env, settings-resolution (exports), native-messages (trechos)}.ts`, `electron/{main, chatgpt, subscriptions, subscription-store}.cjs`, `docs/{claude-code, custom-providers, compaction-accounting, architecture}.md` e o README do pi-ai.
> Objetivo: dar a um engenheiro tudo o que ele precisa para implementar, sem reler as fontes, as metas do fork: grafo por domínio, memória, sessões por domínio, flashcards, XP/ranking, estatísticas de tokens e horas, IA por assinatura sem modelos hardcoded e um tutor que não canse.

---

## 0. Resumo executivo (TL;DR)

1. **Não existe modelo hardcoded.** Não há "factory pins". O usuário escolhe os slots `strong`, `cheap` e `vision` e, se quiser, sobrescreve por papel (`ModelRole`). Sem configuração, o turno devolve **503 `models_not_configured`**. O catálogo vem do **pi-ai, que é estático por versão** (`models.generated.js`). A exceção é o que é dinâmico de verdade: o **endpoint custom** (`GET <base>/models`), a conta ChatGPT (`GET https://api.openai.com/v1/models`) e o Copilot (`availableModelIds`).
2. **Há uma armadilha importante.** A lista do ChatGPT é **cruzada com o catálogo `openai` do pi-ai** (`refreshChatGPTModels` em `src/agent/chatgpt-bridge.ts`). Um modelo novo da OpenAI que ainda não esteja na versão instalada do pi-ai **desaparece**. Para "modelos novos sem mudar código", é preciso trocar essa interseção por um template de fallback (proposta na §2.5).
3. **Assinaturas suportadas hoje:**
   - **ChatGPT**, via OAuth próprio do LearnHarness com PKCE + loopback + `dynamic_agent_client` em `auth.openai.com`.
   - **GitHub Copilot** e **xAI/Grok**, via OAuth nativo do pi-ai.
   - **Claude**, somente **através do Claude Code CLI externo**: o binário `claude.exe` com o login dele mesmo. O pi-ai tem OAuth Anthropic (Pro/Max), mas o LearnHarness **não o expõe**. Isso está alinhado à política da Anthropic, que desde 2026-02-20 (com enforcement a partir de 2026-04-04) proíbe tokens OAuth de assinatura Free/Pro/Max em ferramentas de terceiros.
   - **Gemini** não tem caminho de assinatura, só API key.
4. **Tokens de assinatura ficam em JSON em texto puro** no `userData` do Electron. Os arquivos são `chatgpt-credentials.json` e `<provider>-credentials.json`, e as chaves de API ficam em `auth.json`. No POSIX o modo é 0600. No **Windows** nem o modo nem a checagem de dono são aplicados. A recomendação principal é envolver esses arquivos com `safeStorage` (DPAPI) do Electron.
5. **Montagem do professor** (`src/agent/teacher-agent.ts`):
   - `composeInstructions(kind)` junta `system-prompt.md`, os fragmentos `NN-nome.md` do agente e os fragmentos `shared/`. O usuário pode sobrepor fragmentos por override em `data/prompts/`.
   - O `Agent` do pi-agent-core recebe tools filtradas por toggle mais as tools de plugins (`registerInstructions`/`registerTools`).
   - Os jobs assíncronos (research/demo/visual/pdf) rodam como **subagentes** e devolvem o resultado como *steer*.
   - A compactação é um port do pi-coding-agent: limiar de 150k tokens, mantém os 20k recentes e reserva 16384.
6. **Contabilidade:**
   - Cada turno grava `TurnUsage {id, messageId, at, model:"provider:id", steps: CallUsage[]}` em `data/chats/<id>.json`. Side-chat e compactação também gravam ali.
   - Jobs gravam em `data/jobs/*.json` (`JobUsage`), a extração grava em `ChatRecord.extractions[]` e os plugins gravam em `<dataDir do plugin>/usage.jsonl`.
   - O valor em **dólar é calculado na leitura** com `calculateCost` do pi-ai, a partir do catálogo. Assinatura, Claude Code e custom ficam **sem preço** (tokens sim, US$ não).
   - **Não existe medição de horas de estudo**, e será preciso criar um ledger novo (§4.5).
7. **Extensão sem fork do core:** já existe uma **plugin API** (`src/server/plugin-host.ts`) com `registerInstructions`, `registerTools` (factory por turno recebendo `{chatId, agent}`), question/problem types, `agents`, `workers` e `inference`. O plugin `plugins/flashcards` (FSRS, AGPL, "No Anki integration") é o modelo a copiar. Para mudanças de núcleo, os pontos são `createTeacherTools`, `contextUpdates` e `prepareNextTurnWithContext`, fragmentos de prompt novos, `KIND_ROLE` e `ROLE_SLOT`, `buildCompactionPrompt` e o `onFinish` do `chat-handler`.

---

## 1. Arquitetura da camada (mapa)

```
Electron main (electron/main.cjs)
 ├─ dono das credenciais de assinatura (desktop):
 │    electron/chatgpt.cjs        -> userData/chatgpt-credentials.json
 │    electron/subscriptions.cjs  -> userData/<providerId>-credentials.json (github-copilot, xai)
 ├─ ipcMain: lh:chatgpt:control, lh:subscriptions:control, lh:subscriptions:web-browser
 └─ spawna o servidor Next (filho) com LH_DATA_DIR, LH_AUTH_FILE, LH_DESKTOP_SERVER=1, LH_DESKTOP_API_SECRET
        │  IPC process.send  "lh:chatgpt"  (status/models/lease, timeout 45s)
        │                    "lh:subscriptions" (snapshot/lease)
        ▼
Servidor Next (app/api/* -> src/server/* -> src/agent/*)
 ├─ src/server/keys.ts            auth.json <-> process.env (fill-gap, "env vence")
 ├─ src/server/model-catalog.ts   catálogo = pi builtins com chave + chatgpt + nativos + claude-code + custom
 ├─ src/agent/models.ts           piModels() / piEngineForSpec() -> PiEngine {model, streamFn, level}
 │     ├─ chatgpt-stream.ts       transporte openai-responses com token de assinatura
 │     ├─ subscription-stream.ts  transporte direto com lease (Copilot/xAI)
 │     ├─ claude-code/*           provider "claude-code" (CLI + ponte MCP loopback)
 │     └─ custom-provider.ts      provider OpenAI-compatible criado via createProvider
 ├─ src/server/chat-handler.ts    RAIZ DE COMPOSIÇÃO do turno (gate -> engine -> compaction -> agent -> runPiTurn)
 │     ├─ src/agent/teacher-agent.ts  createProberAgent / createTeacherAgent / createPracticeAgent
 │     ├─ src/agent/tools.ts + tools/* registry de tools
 │     ├─ src/agent/subagents/*       runner de jobs, researcher, demo, visual, pdf, extraction
 │     └─ src/server/compaction.ts    ensureCompacted / kickCompaction
 ├─ src/server/pi/ui-stream.ts    SSE "fio nativo": AgentEvents do pi sem tradução
 └─ src/server/plugins.ts + plugin-host.ts  plugin API (instructions/tools/agents/workers/inference)
```

**Modo web/dev** (sem Electron, ou com `LH_DEV_URL`): `src/server/web-subscriptions.ts` importa os mesmos `electron/*.cjs` e se torna o dono das credenciais dentro do servidor. As rotas HTTP de controle (`app/api/subscriptions/route.ts`) exigem o header `x-learnharness-subscriptions: 1`, *same-origin* e corpo de até 16 KiB. **Não há endpoint HTTP que entregue token ou lease.** Em dev o Electron usa `userData-dev`.

---

## 2. (a) Login por assinatura

### 2.1 Visão geral por provedor

| Provedor | Como | Dono do OAuth | Onde o token fica | Observações |
|---|---|---|---|---|
| **ChatGPT** (Plus/Pro/Business) | "Sign in with ChatGPT" (agent OAuth, PKCE S256, loopback) | **LearnHarness** (`electron/chatgpt.cjs`, 542 linhas). Não usa o login embutido do pi | `userData/chatgpt-credentials.json` (desktop) ou `dirname(AUTH_FILE)/chatgpt-credentials.json` (web/dev) | Multi-conta, `activeId`, consentimento de uso em background. Modelos vêm de `GET /v1/models` (`visibility==="list"`) ∩ catálogo pi `openai` |
| **GitHub Copilot** | OAuth do pi-ai (`device_code`: userCode + verificationUri) | pi-ai via `electron/subscriptions.cjs` | `userData/github-copilot-credentials.json` | Filtra pelo `credential.availableModelIds`. Endpoint precisa ser `*.githubcopilot.com` ou domínio enterprise |
| **xAI / Grok** | OAuth do pi-ai (`auth_url`) | pi-ai via `electron/subscriptions.cjs` | `userData/xai-credentials.json` | Endpoint fixo `https://api.x.ai/v1` |
| **Claude** (Pro/Max) | **Não via OAuth.** Usa o **Claude Code CLI** instalado pelo usuário (`claude login` do próprio CLI) | O CLI (Anthropic) | Onde o CLI guarda | Provider `claude-code`, opt-in em `settings.claudeCode.enabled`. Uso sem preço. Ver §2.4 |
| Anthropic API, OpenAI API, Gemini, OpenRouter, Groq etc. | API key (BYOK) | n/a | `auth.json` (mapa plano `{VAR: valor}`), com o env vencendo | Tabela `AUTH_PROVIDER_KEYS` em `src/core/auth-keys.ts` |
| Endpoint custom OpenAI-compatible | sem chave ou `CUSTOM_OPENAI_API_KEY` | n/a | `auth.json` (par atômico chave + binding `__learnharness_custom_provider_binding`) | Ollama, vLLM, llama.cpp, LM Studio |

`NATIVE_SUBSCRIPTIONS` (`src/core/contracts/subscriptions.ts`) lista apenas `{providerId:"github-copilot", logicalId:"github-copilot-subscription"}` e `{providerId:"xai", logicalId:"xai-subscription"}`. O ChatGPT tem contrato próprio (`src/core/contracts/chatgpt.ts`).

### 2.2 ChatGPT: fluxo OAuth exato (`electron/chatgpt.cjs`)

Constantes:
- `ISSUER = https://auth.openai.com`
- `RESOURCE = https://api.openai.com/v1`
- `AUTHORIZE = ${ISSUER}/api/accounts/authorize`
- `TOKEN = ${ISSUER}/api/accounts/oauth/token`
- `JWKS = ${ISSUER}/.well-known/jwks.json`
- `SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"`

Passo a passo de `login(id?)`:
1. Sobe `http.createServer` em **127.0.0.1 numa porta aleatória**, com `redirect_uri = http://127.0.0.1:<port>/auth/callback`.
2. Gera o verifier PKCE (S256), um `nonce` e um `state`.
3. Abre o navegador com `openExternal(AUTHORIZE?...)` e os parâmetros:
   - `client_id`: o `clientId` da registration salva, ou `"dynamic_agent_client"` no primeiro login (registro dinâmico).
   - `agent_name_hint=LearnHarness`
   - `ext_agent_host_id=<hostId urn:uuid>` (estável por instalação)
   - `id_token_hint`/`login_hint` ao reautenticar
   - `response_type=code`, `scope`, `resource`, `code_challenge(_method)`, `state`, `nonce`
4. No callback, valida o `state`, rejeita parâmetros duplicados e confere o host. O **`client_id` emitido volta no callback** (registro dinâmico).
5. Troca o code em `TOKEN` com `grant_type=authorization_code` (incluindo `resource`).
6. Verifica o `id_token` com `jose.jwtVerify` contra o JWKS: RS256, `issuer`, `audience=clientId`, `nonce` e `azp`.
7. Valida o token set:
   - todos os escopos precisam estar presentes; sem o escopo de plano, o status vira `"scope"` e não existe accessToken;
   - o `access_token` **não pode começar com `sk-`** (evita confundir com API key);
   - `token_type` precisa ser `bearer` e `expires_in` é obrigatório.
8. O timeout total é de **180 s**.

Refresh, `credential()`:
- Renova quando `expiresAt <= now + 60 s`, usando `grant_type=refresh_token`.
- Um `invalid_grant` apaga os tokens e marca `reconnectRequired`.
- A rotação do refresh token é **sempre persistida**.

Modelos, `models()`:
- Faz `GET ${RESOURCE}/models` com `Authorization: Bearer <access>`, filtra `m.visibility === "list"` e devolve `{id: slug, name: display_name}`.
- Logout ou revogação usam o `revocation_endpoint` de `/.well-known/openid-configuration`.
- Outras operações: `select`, `consent(allowBackgroundUse)`, `disconnect` (esquece todas as registrations com o mesmo issuer+subject), `logout`, `pause/resume/close`. Os carimbos `epoch`, `authorityRevision` e `revision` invalidam leases antigos.

Formato do arquivo (`fileStore`). A escrita é atômica (arquivo temporário + fsync + rename, modo 0600), e o fsync de diretório é **pulado em win32**.

```json
{
  "version": 1,
  "hostId": "urn:uuid:...",
  "activeId": "<registration id>",
  "allowBackgroundUse": false,
  "registrations": [{
    "id": "...", "clientId": "...", "issuer": "https://auth.openai.com", "subject": "...", "email": "...",
    "tokens": { "accessToken": "...", "refreshToken": "...", "idToken": "...", "scopes": ["..."], "expiresAt": 1763500000000 },
    "reconnectRequired": false, "background": false
  }]
}
```

Transporte (`src/agent/chatgpt-stream.ts`):
- O modelo lógico vira `{...logical, api:"openai-responses", provider:"openai", baseUrl:"https://api.openai.com/v1", compat.supportsDeveloperRole:true}`.
- Usa o `streamSimple` de `pi-ai/api/openai-responses` com `apiKey = accessToken`, `maxRetries 0` e **nenhum retry depois do dispatch**.
- `chatGPTPayload` monta `{model, store:false, stream:true}` mais uma whitelist (`instructions, reasoning, include, text, tool_choice, parallel_tool_calls, prompt_cache_key`). Mensagens `system` viram `developer`, e as tools são embrulhadas em `{type:"namespace", name:"learnharness", tools}`.
- Exige um evento `response.completed`.
- Os erros de cota apontam para `https://chatgpt.com/settings/usage`.

Bridge (`src/agent/chatgpt-bridge.ts`):
- Canal IPC `lh:chatgpt` com as operações `status`, `models` e `lease`, timeout de 45 s.
- `desktopIPCConnected()` exige `LH_DESKTOP_SERVER=1`, um `LH_DESKTOP_API_SECRET` de 64 caracteres ou mais e `process.send` disponível.
- `chatGPTLease` recusa tokens `sk-`.

**Estado atual do produto (verificado na web, 2026-11):** no DevDay de 2026-09-29 a OpenAI ampliou o "Sign in with ChatGPT" para que apps de terceiros consumam a cota incluída em Plus/Pro/Business. A cota é compartilhada com ChatGPT Work/Codex, o usuário pode definir um limite semanal por app, e o uso **para** quando a cota acaba, sem cair em billing de API. O fluxo do LearnHarness (agent client dinâmico + `chatgpt.tokens.use.direct`) é exatamente esse produto. Riscos: a OpenAI pode deprecar modelos para sign-in (a doc da Docker cita GPT-5.2 e GPT-5.3-Codex deprecados para esse modo), e os limites mudam com o plano.

### 2.3 Copilot e xAI: OAuth nativo do pi-ai (`electron/subscriptions.cjs` + `subscription-store.cjs`)

- O login chama `staging.login(providerId, "oauth", {notify, prompt}, {agentName:"LearnHarness"})`, que suporta tanto `auth_url` quanto `device_code`. Os prompts tipados (`SubscriptionPrompt`: text, secret, select, manual_code) chegam à UI via `SubscriptionInteraction {attemptId, browser{id,url}, userCode, progress}`.
- APIs aceitas: `openai-responses`, `openai-completions` e `anthropic-messages`.
- Validação de endpoint: o xAI precisa usar `https://api.x.ai/v1`, e o Copilot precisa ser `*.githubcopilot.com` ou enterprise.
- O catálogo é `provider.getModels()` filtrado por `filterModels(models, credential)`. O Copilot exige `credential.availableModelIds`.
- Store em `<userData ou authDir>/<providerId>-credentials.json`:
  `{version:1, allowBackgroundUse, connectionId (uuid v4), credential:{type:"oauth", access, refresh, expires, enterpriseUrl?, availableModelIds?}}`.
  A checagem de modo dono-apenas é feita **exceto em win32**.
- O lease devolve `{apiKey?, headers?, baseUrl?}`. `nativeSubscriptionStream` (`src/agent/subscription-stream.ts`) despacha direto ao provider com essa auth e **proíbe sobrescrever o header `authorization`**.
- Operações de controle: `login, cancel, respond, open, retry, disconnect, consent`.

### 2.4 Claude: o único caminho permitido é o Claude Code CLI

Provider `claude-code`, API `claude-code-cli` (`src/agent/claude-code/*`):
- **Modelos:** `opus`, `sonnet` e `haiku` como aliases, com `contextWindow` 1.000.000, `maxTokens` 128.000 e custo 0 (placeholder; a UI mostra "unpriced"). A janela real vem da query de controle `get_context_usage`.
- **Versão mínima do CLI:** 2.1.259.
- **Descoberta do binário** (`binary.ts`/`installation.ts`): procura em PATH, `~/.local/bin`, `~/.claude/local` e `%APPDATA%/npm`. **No Windows só aceita `claude.exe`, não `claude.cmd`**, porque o Node recusa spawnar `.cmd/.bat` sem shell desde a correção do "BatBadBut" (CVE-2024-27980).
- **Spawn:**
  ```
  claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages
    --model X --effort Y --system-prompt-file F --tools "" --strict-mcp-config --mcp-config F
    --setting-sources user --settings {disableAllHooks, outputStyle:"default", env:{CLAUDE_CODE_DISABLE_CLAUDE_MDS:"1"}}
    --disable-slash-commands --no-session-persistence --permission-prompts none
    --allowedTools mcp__learnharness__*
  ```
- **Ponte de tools** (`tool-bridge.ts`): um servidor MCP StreamableHTTP em 127.0.0.1 com Bearer token aleatório. Toda chamada de tool exige um `claudecode/toolUseId` que case com a intenção do stream. As tools do LearnHarness aparecem ao CLI como `mcp__learnharness__<nome>`.
- **Processos vivos** (`live-processes.ts`, `reuse-context.ts`): ficam ociosos por até 10 min e são reaproveitados entre turnos da mesma sessão. `MCP_TOOL_TIMEOUT` é de 30 min.
- **Ambiente:** `externalCliEnv()` (`src/core/auth-env.ts`) remove do ambiente do filho as chaves que o LearnHarness injetou via fill-gap. O env real do usuário continua lá, e um `ANTHROPIC_API_KEY` no ambiente de lançamento pode, portanto, mudar o billing. `docs/claude-code.md` deixa explícito: "LearnHarness does **not** guarantee subscription-only use".
- **Ativação:** `claudeCodeEnabled()` (`src/server/claude-code-config.ts`) lê `settings.claudeCode.enabled`. `app/api/claude-code` GET devolve o status de instalação e exige o header `x-learnharness-claude-code: 1`.

**Política Anthropic (verificado em 2026-11):** os termos foram revisados em 2026-02-20 e o enforcement começou em 2026-04-04, 12h PT. Tokens OAuth de Free/Pro/Max servem **apenas** para Claude Code e claude.ai, e o uso deles em "qualquer outro produto, ferramenta ou serviço, incluindo o Agent SDK" é vedado. Um issue de julho de 2026 confirma que o bloqueio continua. Consequências para o fork:
- **Não habilitar** o `models.login("anthropic","oauth")` do pi-ai.
- O caminho "Anthropic se permitido" é **somente** dirigir o binário oficial `claude` (como já é feito) ou usar API key.
- Dirigir o CLI em modo `-p` a partir de outro app é uma **zona cinzenta**. O próprio LearnHarness se declara "not a provider-policy certification". Recomenda-se mostrar um aviso na UI e deixar o opt-in desligado por padrão, como hoje.

### 2.5 Admissão, leases e uso em background

- `CallPurpose` é `user` ou `background`. Pesquisa, demo, visual, pdf, extração e compactação são `background`.
- Com uma assinatura, chamadas `background` só passam se `allowBackgroundUse` estiver ativo (o consentimento é por conexão).
- `SubscriptionRequestCycle` (`src/agent/subscription-request-cycle.ts`) segura os eventos até o dispatch ser admitido, marca usage **não admitido** em um `WeakSet` (`markUnadmittedUsage`/`usageWasAdmitted`, que **não são contabilizados**) e, se o background for negado, tenta de novo em foreground quando cabe.
- **Não existe fallback para API key** quando a assinatura falha (decisão de produto: o usuário escolheu a assinatura).
- `webSubscriptionsEnabled()` é verdadeiro quando não há desktop e `runtime.request` está definido.

### 2.6 Restrições e riscos de segurança do login

1. **Credenciais em texto puro** (JSON) no disco. No POSIX são 0600. No **Windows não há ACL nem checagem de dono**.
2. A porta loopback do callback fica aberta por até 180 s. Qualquer processo local poderia tentar a corrida, mas `state` + PKCE + verificação do `id_token` mitigam isso.
3. O `hostId` é estável por instalação: um backup do `userData` copia a identidade do agente.
4. No modo web/dev o servidor Next é o dono do arquivo, protegido apenas pelo header + same-origin. **Não exponha a porta do dev server na LAN.**

---

## 3. (b) Listagem de modelos: hardcode ou dinâmico, preços e contexto

### 3.1 De onde vêm os modelos

`src/agent/models.ts`:
- `piModels()` cria `createModels({identity: APP_IDENTITY})` **uma vez** e registra todos os `builtinProviders()` do pi-ai (o Bedrock é trocado por uma API lazy), mais `createClaudeCodeProvider(streamClaudeCode)`. A cada chamada roda `providerSource?.sync(collection)`, que é o gancho do custom provider (`configureProviderSource({sync, isCustom})`).
- `piEngineForSpec(spec, background, lifecycle?, cacheRetention?)` resolve o modelo nesta ordem:
  1. `provider === "chatgpt"` → `chatGPTModel(id)`
  2. id lógico de assinatura nativa → `nativeSubscriptionModel`
  3. caso contrário, `models.getModel(provider, id)`.
- O mesmo `piEngineForSpec`:
  - força `input:["text","image"]` em modelos custom;
  - ajusta o `thinkingLevel` com `clampThinkingLevel`, ou escolhe o default via `DEFAULT_THINKING_ORDER`;
  - devolve um `streamFn` que injeta `cacheRetention` e `reasoning`. Para custom, re-resolve o modelo a cada request.
- `piEngineFor(role)` é legado e **sempre lança erro**. O caminho correto é `resolveRoleSpec(role, settings)` + `piEngineForSpec`, que é o `resolveEngine` do `chat-handler`.

`src/server/model-catalog.ts`:
- `catalogProviders()` reúne os providers com chave presente (`AUTH_PROVIDER_KEYS` + `keyValue`), mais `chatgpt` (se conectado), `claude-code` (se habilitado e instalado), as assinaturas nativas conectadas e `custom` (se utilizável).
- `modelCatalog()`, servido via `GET /api/models` (antes chama `refreshConnectionCatalog()`; resposta `no-store`), devolve **todos os modelos** desses providers mapeados por `toModelDto`:
  - para `claude-code` e `custom`, `cost` é `null`;
  - para `claude-code`, `contextWindow` e `maxTokens` também são `null`;
  - junto vêm `defaults`, `rolePins`, `slots` e `providers`.
- `catalogContextLimits()` produz o mapa `"provider:id" → contextWindow` usado pelo medidor de contexto.
- Validação: `validateChatSettings`/`validateModelsSettings` exigem que o provider esteja em `connectionProviderIds` e que o modelo exista. Os helpers `clampModelsLevels` e `clampChatLevel` ajustam os níveis de thinking.

### 3.2 Estático vs dinâmico

| Fonte | Natureza | Preço | Contexto/maxTokens | Como aparecem modelos novos |
|---|---|---|---|---|
| Builtins do pi-ai (anthropic, openai, google, openrouter, xai, groq, mistral, deepseek…) | **Estático por versão** (`models.generated.js`, `providers/*.models.js`) | `model.cost` (USD por 1M tokens: input/output/cacheRead/cacheWrite) | `model.contextWindow`/`maxTokens` | **Só atualizando o pi-ai** (`npm i @earendil-works/pi-ai@latest`) |
| ChatGPT | Dinâmico (`/v1/models`), mas **∩ catálogo pi `openai` com api `openai-responses`** | 0 (assinatura) | Herdado do modelo pi correspondente | Hoje: só se o pi-ai já conhecer o slug |
| Copilot | Dinâmico (`availableModelIds`) ∩ `getModels()` do pi | 0 | do pi | Idem |
| xAI assinatura | `getModels()` do pi | 0 | do pi | Idem |
| Claude Code | Aliases fixos `opus/sonnet/haiku` (o CLI resolve a versão real) | sem preço | 1M/128k placeholder, real via `get_context_usage` | **Automático**: o CLI aponta o alias para o modelo mais novo |
| Custom OpenAI-compatible | **100% dinâmico** (`GET <base>/models`, timeout 15 s, até 8 MiB, até 10.000 modelos) | sem preço | pin do usuário → metadado do endpoint (`max_input_tokens`, `context_length`, `n_ctx`, …) → 8192/4096 | Automático na descoberta, mais ids digitados à mão (`mergeManualModels`) |
| OpenRouter (API key) | Estático no pi (o pi gera o catálogo a partir da API da OpenRouter na build) | do pi | do pi | Atualizando o pi |

O `models.refresh()` do pi só faz efeito em providers dinâmicos (Radius, custom). Nos builtins é no-op.

### 3.3 Estratégia "sem hardcode" para o fork (proposta implementável)

1. **Fallback de template no ChatGPT.** Em `refreshChatGPTModels(supported)` (`src/agent/chatgpt-bridge.ts`), troque o descarte silencioso por:
   ```ts
   const known = supported.find(m => m.id === entry.id && m.api === "openai-responses");
   const template = known ?? newestOpenAIResponsesTemplate(supported); // maior contextWindow, reasoning: true
   return { ...template, id: entry.id, name: entry.name, provider: "chatgpt", cost: ZERO,
            ...(known ? {} : { catalogUnknown: true, contextWindow: CONSERVATIVE_CTX }) };
   ```
   Com isso, um modelo novo aparece no seletor marcado como "metadados estimados". Repita o padrão no `filterModels` do Copilot.
2. **Metadados dinâmicos de preço e contexto.** Crie um `src/server/model-metadata.ts` que leia, com cache diário em `data/cache/model-metadata.json`:
   - `https://models.dev/api.json` (projeto sst/models.dev, licença MIT, a verificar), com custo, limites e modalidades por provider;
   - `https://openrouter.ai/api/v1/models` (público), com `context_length` e `pricing.prompt/completion` por token.

   Use esses dados **apenas para preencher lacunas** (o modelo pi tem precedência), em `toModelDto` e em `catalogModel()` (`src/server/pricing.ts`).
3. **Slots por domínio.** Hoje os slots são globais (`settings.models.slots`) e o override é por chat (`ChatSettings`). Para "Inglês usa modelo X, Eletrônica usa Y", adicione `domains[domainId].models` (slots parciais) e resolva em `resolveConversationSpec(chatSettings, strongSlot)` (`src/core/settings-resolution.ts`) com a precedência chat → domínio → global.
4. **Atualização do pi-ai como rotina.** Fixe a versão, mas com um job de CI semanal que rode `npm outdated @earendil-works/*` e os testes no-drift (`tests/auth-provider-keys.test.ts`).

---

## 4. (c) Como o agente professor é montado

### 4.1 Fluxo de um turno (`src/server/chat-handler.ts`, `handleChatInput`)

1. **Gate do turno:** `resolveConversationSpec(record.settings, effective.models.strong)`. Se vier vazio, responde **503 `models_not_configured`**. `claimPreparingTurn` (`turn-preparation.ts`) evita turnos concorrentes.
2. **Refresh das assinaturas** e gate `providerKeyPresent(provider)` (`src/server/keys.ts`), que trata custom, claude-code e assinatura cada um do seu jeito.
3. **Engine:** `piEngineForSpec(conversation, () => callPurpose.background, lifecycle, retentionForSlot("strong"))`.
4. **`ensureCompacted`** (§4.6).
5. **Contribuições de plugins:** `getPluginAgentContributions()`.
6. **Coleta de uso:** `steps: CallUsage[]` + `collectUsage(usage)`.
7. **`agentOpts`:** `{pluginContributions, engine, callPurpose, requestCycle, messages, validateContext, contextUpdates, onUsage, toolToggles: effective.agent.tools, chatId, promptSwitches: effective.agent.prompts}`.
8. **Escolha do agente:**
   - `createPracticeAgent` se `chat.kind === "practice"`;
   - `createTeacherAgent` se já existe `probe_done` no histórico;
   - `createProberAgent` nos demais casos (diagnóstico inicial).
9. **Execução:** `registerLiveAgent` → `runPiTurn({agent, requestCycle, beforeCycle, usedToolCallIds, onError, onSettleError, onSettleFailure, onFinish})` (`src/server/pi/ui-stream.ts`, SSE com os `AgentEvent` do pi sem tradução e flush de `message_update` a cada 100 ms).
10. **`onFinish`:** `persistTurn` (`turn-service.ts`) → `chatStore.appendTurnUsage(chatId, {id, messageId, at, model:"provider:id", steps})` → `triggerExtraction` → `settleSteers` → `kickCompaction`.

### 4.2 System prompt (composição)

`composeInstructions(kind, switches?)` em `src/agent/teacher-agent.ts` usa `effectivePromptSegments` (`src/agent/prompt-segments.ts` + `src/core/prompt-segments.ts`):
- A **ordem** é: `src/agent/system-prompt.md` (filosofia base) → `prompts/<agente>/NN-*.md` → `prompts/shared/NN-*.md`. O practice usa uma *allowlist* dos fragmentos `shared`.
- Os fragmentos casam com `FRAGMENT_RE = /^\d+-[\w.-]+\.md$/` e são ordenados pelo prefixo numérico. **Basta criar um arquivo novo para ele entrar no prompt.**
- O separador é `"\n\n---\n\n"`.
- **Overrides:** `data/prompts/<agente>/<arquivo>.md` só valem se `settings.agent.prompts["<agente>/<arquivo>.md"] === true`. Funções: `readPromptOverride`, `allSegmentPaths` e `isValidSegmentPath`.
- Acréscimos de `baseAgentOptions`:
  - `SEND_TO_USER_DELIVERY_RULE` quando a guarda de narração se aplica (modelos da família Claude);
  - as instruções dos plugins (`registerInstructions`).

Fragmentos existentes (conteúdo resumido):
- `teacher/`:
  - `05-method`: verdades incondicionais, "como eu poderia ter descoberto isto", estilo 3Blue1Brown.
  - `10-planning`: mapa `plan_init` em mermaid, prever e checar.
  - `20-teaching`: um passo por vez, checagens recolhidas atrás de um botão.
  - `28-predictions`, `30-question-principles`, `40-jobs` (disciplina de research/pdf), `50-demos`, `55-images`.
- `shared/`:
  - `10-voice`: sem elogios nem enchimento.
  - `15-accuracy`, `16-mental-model`, `20-question-tools`, `25-confidence`, `30-learner-files`, `35-side-conversations`.
  - `40-formatting`: markdown, LaTeX, mermaid, callouts.
- `prober/10-probe-doctrine`: busca binária em "strands" e fechamento com `probe_done`.
- `practice/00-base`, `practice/10-doctrine`.
- `side-chat/00-base` e `side-chat/90-style` (não editáveis). O side-chat (`src/agent/side-chat.ts`, `composeSideChatInstructions`) usa a base + `shared/{10-voice, 15-accuracy, 40-formatting}` + o estilo, numa chamada **sem tools e sem agent loop**.

A doutrina já é bem alinhada ao "ensino não cansativo": um passo por vez, sem elogios, checagens opcionais. Pontos de ajuste ficam nos fragmentos `20-teaching` e `10-voice`.

### 4.3 Construção do `Agent` (pi-agent-core)

`baseAgentOptions(kind, opts)` retorna:
```ts
new Agent({
  identity, sessionId: chatId,
  initialState: { systemPrompt, model: engine.model, thinkingLevel: engine.level, tools, messages },
  streamFn: engine.streamFn,
  finishTurn,                       // "question stopper": encerra quando uma tool de pergunta foi posta
  steeringMode: "all",              // steers (resultados de subagente, side-questions) entram todos
  convertToLlm: toLlmMessages,      // src/core/native-messages.ts: corte de compactação + markers custom -> user
  prepareNextTurnWithContext,       // só se opts.contextUpdates: injeta mensagens antes da próxima request
  prepareRequest,                   // callPurpose, requestCycle.prepare (admissão), validateContext
});
```
- O uso é capturado via `subscribe` no `message_end` de mensagens assistant. Mensagens abortadas ou não admitidas são ignoradas, e o resto vai para `onUsage(StepUsageCollector)`.
- `AgentKind` é `prober`, `teacher` ou `practice`. `CONVERSATION_TOOL_NAMES` reserva nomes que plugins não podem usar.

### 4.4 Tools

`src/agent/tools.ts`:
- Os builders retornam um `Record<string, AgentTool>`, que passa por `filterEnabledTools(tools, enabled)` (`src/core/pending.ts`) e depois por `healToolRecord`, que repara argumentos malformados (`tools/heal.ts`).
- `TOGGLEABLE_TOOLS = ["research","demo","visual","pdf"]`. `WRITABLE_TOOL_KEYS` acrescenta `explain`. Com `explain: true`, `quizMechanics` passa a "free": entra o `explain` (recall livre) e sai o `quiz` de múltipla escolha.

| Tool | Agente | Arquivo | Função |
|---|---|---|---|
| `probe` / `recall` | prober | tools.ts | pergunta diagnóstica / recall |
| `ask_user_question` | todos | tools.ts | pergunta estruturada (pertence ao cliente; a resposta chega como input) |
| `quiz` / `explain` | teacher | tools.ts | checagem MC ou explicação livre. `nodeId` é validado contra `chatStore` tree |
| `read`, `ls`, `find`, `grep` | prober, teacher | tools/read.ts, ls.ts, find.ts, grep.ts, file-access.ts | arquivos do aprendiz |
| `show_image` | teacher | tools/show-image.ts | exibe imagem |
| `plan_init` | teacher | tools/plan.ts | mermaid → `parseMermaidPlan` → `createTree` → `chatStore.saveTree`. Devolve nodeIds |
| `research`, `demo`, `visual`, `pdf` | prober (research/pdf), teacher | tools/jobs.ts | **jobs assíncronos** fire-and-forget |
| `list_sessions`, `list_propositions` | prober (com o gate do grafo) | tools/graph.ts | lê o **mapa de conhecimento**: só nomes, níveis e datas |
| `probe_done` | prober | tools/probe.ts | handoff para o teacher (`buildProbeHandoffSteer`) |
| `send_to_user` | família Claude | tools/send-to-user.ts | entrega explícita (guarda de narração) |
| `web_search`, `web_fetch` | researcher (subagente) | tools/web.ts | ver §4.5 |

Observação de design (`tools/graph.ts`): "context injection is dead". O prober **consulta** o grafo por tools em vez de recebê-lo injetado no prompt. A exceção é o modo practice, cuja criação (`app/api/chats/route.ts`) semeia um marker `graph-context` (`newGraphContextMessage(picks, chains)`) com proposições e cadeias.

Contrato de tool: o helper `serverExecute(name, schema, fn)` (`src/agent/tool-execute.ts`) recebe um schema TypeBox (`typebox`), valida e converte o resultado com `toToolResult`.

### 4.5 Subagentes, web search e jobs

- **Despacho:** `tools/jobs.ts`. Schemas:
  - `research{question, context?}`
  - `demo{title, brief}`
  - `visual{brief, image?}`
  - `pdf{path, question}`

  `dispatch()` é idempotente por `toolCallId` e chama `ctx.spawn`. A tool devolve um *ack* na hora, sem bloquear.
- **Runner:** `subagents/runner.ts`, `createJobRunner({chatStore, jobStore, deliver, engineFor, searchProvider, providerKeyMissing})`.
  - `KIND_ROLE`: research → `researcher`, demo → `demoBuilder`, visual → `visualMaker`, pdf → `pdfReader`.
  - O uso é acumulado com `accumulateJobUsage` em `JobRecord.usage` (`model: "provider:id"`).
  - `finishJob` salva o resultado como "delivery pending" e chama `deliver(buildSubagentSteer)`. O resultado entra no professor como **steer** (custom message `subagent-steer`).
- **Loop genérico:** `subagents/pi-run.ts`, `runSubagent(tools, {role?, engine?, systemPrompt, messages?, prompt?, maxTurns, abortSignal, onUsage, onToolStart, onEvent, beforeRequest, bypassWorkerRequestAdmission, onAssistantMessage, shouldStop, chatId})` → `{newMessages, text}`. Passa pelo gate `workerRequestStream`, com 8 requisições concorrentes por padrão (`agent.workerRequestConcurrency`).
- **Researcher:** `subagents/researcher.ts`, `maxTurns 12`, com as tools web + PDF e brief no formato fixo **Summary / Findings / Sources / Gaps**.
- **Web** (`tools/web.ts`, `createWebTools(search)`):
  - `web_search` usa um `SearchProvider` injetado: Tavily, Brave, Exa, Firecrawl ou Ollama, com chaves `TAVILY_API_KEY`, `BRAVE_…`, `EXA_…`, `FIRECRAWL_…` e `OLLAMA_…` em `AUTH_KEYS`.
  - `web_fetch` usa Readability + Turndown com fallback para `r.jina.ai` e corta em 40k caracteres.
  - `tools/safe-fetch.ts` é um `undici.Agent` que **bloqueia IPs privados e loopback depois do DNS**, como mitigação de SSRF.
- **Outros subagentes:**
  - `demo-builder.ts`: demos HTML interativas.
  - `visual-maker.ts` + `annotation-svg.ts`: imagens e anotações.
  - `pdf-reader.ts`, `pdf-ops.ts`, `pdf-markdown.ts`.
  - `submit-agent.ts`: saída estruturada via tool "submit".
  - `extraction.ts`: o **único escritor do grafo**, com os estágios extractor → auditor → merge determinístico.
- **Plugins:** `createPluginAgentService` (`src/agent/plugin-agents.ts`) dá aos plugins agentes persistentes do pi-agent-core, com tools `server`/`input`, `maxTurns`, recuperação após restart e um ledger de mensagens. `plugin-workers.ts` cuida de tarefas em background.

### 4.6 Compactação

- **Constantes** (`src/core/compaction.ts`, port do pi-coding-agent 1.4.0):
  - `KEEP_RECENT_TOKENS = 20000`
  - `COMPACTION_RESERVE_TOKENS = 16384`
  - `DEFAULT_COMPACTION_THRESHOLD_TOKENS = 150000`
  - Estimativa de tokens = caracteres/4, e imagens contam 1200.
- **Funções** (mesmo arquivo):
  - `estimateMessageTokens` e `compactionCutIndex`;
  - `newCompactionMarker`, que cria um custom `compaction` com `firstKeptMessageId`;
  - `serializeForSummary` e `planTreeToText`;
  - **`buildCompactionPrompt`**, com as seções *learner's understanding*, *teaching arc*, *plan tree verbatim* e *current moment*.
- **Servidor** (`src/server/compaction.ts`):
  - O sumarizador é `runSubagent` com `maxTurns 1`, **usando o mesmo engine da sessão**.
  - `ensureCompacted` age antes do turno e `kickCompaction` depois dele.
  - O limiar efetivo é `min(setting, contextWindow − reserve)`.
  - `projectedContextTokens` mede o contexto. `measuredContextTokens` (`src/core/context-usage.ts`) usa o input + output + cacheRead + cacheWrite da última resposta e é invalidado por um marker.
  - O uso da compactação é gravado como `TurnUsage` com a chave do id do marker (`docs/compaction-accounting.md`).
- **Na conversão para LLM:** `toLlmMessages` substitui tudo antes do marker ativo pelo texto do resumo, enviado como mensagem `user`. A mensagem `system` inicial (prompt + tools) nunca é compactada.

---

## 5. (d) Contabilidade de tokens e custo

### 5.1 Modelo de dados (`src/core/contracts/chat.ts`, `jobs.ts`)

```ts
interface CallUsage { inputTokens; outputTokens; cacheReadTokens; cacheWriteTokens; cacheWrite1hTokens?; reasoningTokens }
interface TurnUsage { id; messageId; at /* ISO */; model /* "provider:id" */; steps: CallUsage[] }   // 1 step = 1 request ao LLM
interface ChatRecord { id; title; createdAt; updatedAt; messages: LhMessage[]; kind?: "teach"|"practice"; tree?;
                       turns?: TurnUsage[]; extractions?: ExtractionRunUsage[]; settings?: ChatSettings; sideChats?; version? } // CURRENT_CHAT_VERSION = 2
interface ExtractionRunUsage { startedAt; at; durationMs; stats?; stages: { extractor: ExtractionStageUsage; auditor: ExtractionStageUsage } }
interface JobUsage { model; input/output/cacheRead/cacheWrite/reasoning totais; cacheWrite1hTokens?; calls?: CallUsage[]; steps; lastStep? }
```
Helpers: `piUsageToStep` (Usage do pi → CallUsage) e `accumulateJobUsage`.

### 5.2 Onde é persistido

| Origem | Arquivo | Chamada |
|---|---|---|
| Turno do professor/prober/practice | `data/chats/<chatId>.json` → `turns[]` | `chatStore.appendTurnUsage` em `chat-handler` `onFinish` |
| Side-chat | idem, `turns[]` (id = `answerId`) | `src/server/side-chat.ts` |
| Compactação | idem, `turns[]` (id = id do marker) | `src/server/compaction.ts` |
| Extração do grafo | `ChatRecord.extractions[]` + `graph/sources.json` (notas) | `subagents/extraction.ts` |
| Jobs (research/demo/visual/pdf) | `data/jobs/<toolCallId>.json` → `usage` | `subagents/runner.ts` |
| Plugins (agents/workers/inference) | `<dataDirectory do plugin>/usage.jsonl` (linha `{timestamp, model, usage:{…, cost}}`) | `src/server/plugin-inference.ts` `onUsage` |

`data/` é `LH_DATA_DIR`. No desktop isso é `%APPDATA%/<app>/data` (`userData/data`); em dev é o `data/` do repositório.

### 5.3 Preço

- `src/server/pricing.ts`:
  - `catalogModel(id)` devolve `undefined` para assinatura, claude-code e custom.
  - `callCost` usa `calculateCost(model, usage)` do pi-ai, com os preços do catálogo.
  - Também exporta `turnCost`, `sessionCost` e `jobCost`.
- `src/core/prices.ts` (puro): `CallPricer`, `isChatGPTPlan`, `subscriptionLabel`, `isSubscriptionModel`, `sumSteps`, `sessionCacheHitRate`, `turnCost`, `sessionCost` → `{cost, unpriced, subscription?, subscriptionProviders?, turnCosts}`, e `jobCost`.
- `src/core/cost-summary.ts`: `graphCostSummary` sobre os estágios de extração e auditoria.
- **Consumidores atuais:** `app/api/chats/[id]/route.ts` (`pricing: sessionCost(chat)`), `src/server/observability.ts` (o dock de atividades: `costUsd` por job, `contextLimit` vindo de `catalogContextLimits`) e `components/activity-dock.tsx`.
- **O dólar nunca é persistido.** Ele é recalculado na leitura, então uma mudança de preço no catálogo reprecifica o histórico.

### 5.4 Painel de estatísticas (proposta)

Crie `src/server/stats.ts` com `aggregateUsage({from, to, domain?})`, que:
1. Percorre `chatStore.listChats()` e, para cada `turns[]`, soma os `steps` por `model`, `chat.kind`, `domain` (campo novo, §6.4) e dia (`at`).
2. Soma `JobRecord.usage` (`listJobs()`) por `model` e `kind`.
3. Soma `extractions[].stages.*`.
4. Lê os `usage.jsonl` dos plugins.
5. Calcula US$ com `callCost` quando houver preço. Para os não precificados, **mostra os tokens** e a etiqueta "assinatura" ou "local".

Exponha `GET /api/stats?from&to&domain`. As métricas úteis são: tokens de entrada, saída, cache e reasoning por modelo; a taxa de cache hit (`sessionCacheHitRate`); o custo equivalente em API (opcional: precificar tokens de assinatura **como se fossem API**, usando o modelo pi correspondente, como "valor economizado").

### 5.5 Horas de estudo: não existe, é preciso criar

Hoje há apenas `TurnUsage.at` e os timestamps das mensagens. Duas opções, que podem ser combinadas:
- **A, derivada (sem UI nova).** Sessionize os timestamps de mensagens user/assistant por chat com um *idle gap* de 5 min: tempo ativo = Σ min(gap, 5 min). É barata, mas superestima leitura passiva e subestima a leitura longa de uma resposta.
- **B, heartbeat (recomendada).** O cliente envia `POST /api/stats/activity` a cada 30 s enquanto `document.visibilityState === "visible"` e houve interação (teclado, scroll ou ponteiro) nos últimos 60 s. O servidor grava `data/stats/activity-YYYY-MM.jsonl` com `{chatId, domain, kind, start, end}` e faz coalescing. Some por domínio e por dia. Isso alimenta "horas por domínio", streaks e XP.

---

## 6. (e) Pontos de extensão exatos

### 6.1 Duas vias: plugin (preferível) ou core

O host de plugins (`src/server/plugin-host.ts`, documentado em `docs/plugin-api/*` e `docs/plugin-authoring.md`) entrega a cada plugin com backend um `PluginBackendContext` com:
- `registerInstructions({agents, text})`: texto estático anexado ao system prompt dos agentes-alvo. Para atualizar, desregistre e registre de novo.
- `registerTools({agents, create(turn) => AgentTool[]})`: a **factory roda a cada turno** com `turn = {chatId, agent}` e precisa ser **síncrona**. O nome segue `^[A-Za-z_][\w-]{0,63}$`, colisões com nomes reservados ou builtin geram erro, e o schema é validado (`validatePluginSchema`). As opções são `executionMode` (parallel/sequential), `replay` (safe/never) e `outputSchema`.
- `registerQuestionType`, `registerProblemType`, `handle(op, handler)` (operações RPC para a UI do plugin) e `createBackgroundTool` (jobs de plugin com recuperação).
- `learning` (`src/server/plugin-learning.ts`): leitura **somente** de sessões, grafo (`graphSnapshot`) e ledgers (`nodes.jsonl`, `chains.jsonl`, `sessions.jsonl`, `coverage.jsonl`, `sources.json`, `positions.json`).
- `inference.engineFor(model, purpose)` + `onUsage` (contabilizado em `usage.jsonl`), `agents` (agentes persistentes) e `workers`.
- O `dataDirectory` é privado do plugin.

O plugin `plugins/flashcards` (AGPL-3.0, FSRS em `FSRS-LICENSE.txt`, "No Anki integration") é o molde para os flashcards Anki/Obsidian: exportar `.apkg` ou markdown com `#flashcard` pode virar uma operação `handle("export-anki")`.

**Regra prática:** o que só **lê** o grafo e **adiciona** tools ou instruções deve ser plugin, porque evita conflitos de merge com o upstream AGPL. O que precisa **escrever** o grafo canônico, mudar a contabilidade ou alterar a montagem do turno exige mexer no core.

### 6.2 Tabela de pontos de extensão

| Necessidade | Onde | Como |
|---|---|---|
| **Doutrina estática** (ex.: como usar o grafo curricular, regras de memória, ensino não cansativo) | `src/agent/prompts/teacher/60-curriculum.md`, `prompts/shared/50-memory.md` | Basta criar o arquivo (`FRAGMENT_RE`). Para deixar editável, o usuário liga o override em `settings.agent.prompts` |
| **Contexto dinâmico por sessão** no início (fatia do grafo curricular, objetivos do domínio) | `app/api/chats/route.ts` (criação do chat) + `src/core/native-messages.ts` | Copie `newGraphContextMessage` como `newCurriculumContextMessage(...)` com `customType: "curriculum-context"`. Adicione-o à lista "neutral" (~linha 991) e ao `toLlmMessages`, que já converte qualquer custom em `user`. Renderize em `src/core/view.ts` (`case "graph-context"` é o modelo) |
| **Contexto dinâmico por turno** (memória recuperada, estado de mastery) | `AgentBuildOptions.contextUpdates(messages) => AgentMessage[]` (`teacher-agent.ts:123`, aplicado via `prepareNextTurnWithContext` e também injetado como `steer` no `beforeCycle` em `chat-handler.ts:822`) | Hoje é usado só pelas side-questions. Estenda o closure em `chat-handler.ts:697` para também emitir um custom `memory-context`. **Atenção:** são mensagens *não salvas*. Deduplique pelo id para não injetar duas vezes, e lembre que a compactação as engole |
| **Contexto por tool** (preferido pelo design atual: "context injection is dead") | `src/agent/tools/graph.ts` (padrão `list_sessions`/`list_propositions`) | Crie `curriculum_lookup`, `recall_memory` e `find_resources` como tools de leitura. O modelo decide quando consultar e o prompt fica pequeno |
| **Tools novas** `update_mastery`, `expand_graph` | `src/agent/tools.ts` → `createTeacherTools(ctx, enabled)` (e `createProberTools` se fizer sentido); `TeacherToolContext` ganha `masteryStore`/`curriculumStore` | Cada tool sai de `serverExecute("update_mastery", Type.Object({...}), async (args) => ...)`. Para torná-la desligável, inclua o nome em `TOGGLEABLE_TOOLS` (`src/core/pending.ts`). Injete as stores onde o `chat-handler` monta o ctx. Ou via plugin, com `registerTools` (só se a escrita for em store do plugin) |
| **Jobs em background novos** (ex.: `expand_graph` pesado, `curate_resources`) | `src/agent/tools/jobs.ts` (schema + `dispatch`), `subagents/runner.ts` (`KIND_ROLE`), `config.ts` (`ModelRole`), `src/core/settings.ts` (`ROLE_SLOT`, ~linha 326), a união `JobRecord.kind` | Novo `kind` → novo `ModelRole` (ex.: `curator: "cheap"`) → subagente `subagents/curator.ts` usando `runSubagent` → resultado como steer `subagent-steer` |
| **Recursos** (vídeos, livros) | `tools/web.ts` (`createWebTools(search)`) + `subagents/researcher.ts` | Novo subagente "curator" com `web_search`/`web_fetch` e um brief fixo `{title, url, type: video/book/article, level, minutes, why}`. Persista em `data/resources/<domain>.jsonl`. Transcrições do YouTube via `web_fetch` com `safeFetch` (respeitando os ToS) |
| **Memória de longo prazo** | (1) escrita: `chat-handler` `onFinish`, depois de `appendTurnUsage` (ao lado de `triggerExtraction`); (2) escrita na compactação: `src/server/compaction.ts` + `buildCompactionPrompt` (nova seção "durable learner facts"); (3) leitura: tool `recall_memory` ou `contextUpdates` | Crie `triggerMemoryUpdate(chatId)`, um job `background` com o papel `cheap`, que extrai fatos e preferências do aprendiz para `data/memory/<domain>.jsonl`. Reaproveite o padrão do `extraction.ts` (submit-agent + auditor) |
| **Grafo curricular massivo por domínio** | `subagents/extraction.ts` (o único escritor do grafo de *aprendizado*); ledgers em `config.ts` `LEDGER_FILES` | Mantenha o **grafo curricular** (o que existe para aprender) **separado** do grafo de *aprendizado* (o que o aluno demonstrou). `expand_graph` escreve no curricular. `update_mastery` liga um nó curricular a evidências ou proposições |
| **Sessões por domínio** | `ChatRecord`/`ChatSettings` (`src/core/contracts/chat.ts`), `resolveConversationSpec` (`src/core/settings-resolution.ts`) | Adicione `domain?: string` ao `ChatRecord`, filtre `listChats` e faça o merge de slots domínio → global. Composição de prompt por domínio: `prompts/domains/<domain>/NN-*.md`, carregado em `composeInstructions` |
| **Pergunta/quiz custom** (cloze, pronúncia, circuito) | plugin `registerQuestionType` / `registerProblemType` | Ver `docs/plugin-question-contract.md` e `docs/plugin-problem-contract.md` |
| **Estatísticas e XP** | `onFinish` (turno), `runner.finishJob`, `update_mastery` | Um evento `emit("xp", {...})` (`src/core/events.ts`) e o ledger `data/stats/xp.jsonl`. As rankings via Monte Carlo consomem esse ledger e o de mastery |
| **Provedor novo** | `src/agent/models.ts` (`piModels()` registra os providers); `createProvider` do pi-ai (ver `custom-provider.ts`) | Para outro endpoint compatível (ex.: um segundo custom), generalize `CUSTOM_PROVIDER` para uma lista |
| **Política de thinking e cache por papel** | `piEngineForSpec(spec, background, lifecycle, cacheRetention)`, `retentionForSlot` | Para tutoria, use `thinkingLevel: "low"` no professor (latência menor) e `"high"` no curador do grafo |

### 6.3 Nomes reservados e armadilhas

- `CONVERSATION_TOOL_NAMES` mais os nomes builtin são reservados: um plugin com o mesmo nome derruba **todas** as contribuições desse plugin naquele turno.
- Tools de pergunta (`quiz`, `ask_user_question`) são *client-owned*. O placeholder "Question posed" nunca é persistido. Uma tool nova que pause esperando input do aluno precisa seguir esse contrato (ou ser `kind: "input"` em plugin-agents).
- Provedores que reiniciam os ids de tool call (DeepSeek usa `call_0`) são tratados por `ToolCallIdUniquifier` (`src/server/pi/call-ids.ts`), alimentado com todos os ids do histórico. Não gere ids próprios.
- A compactação descarta os custom markers anteriores ao corte. Contexto que precisa sobreviver tem de ir para o resumo (`buildCompactionPrompt`) ou ser reinjetado por turno.

---

## 7. Riscos ao rodar no Windows

| # | Risco | Onde | Mitigação |
|---|---|---|---|
| 1 | **Claude Code exige `claude.exe`.** A instalação via npm gera `claude.cmd`, que é **rejeitado** (o Node não spawna `.cmd` sem shell, CVE-2024-27980) | `src/agent/claude-code/binary.ts`, `installation.ts` | Documente o instalador nativo (`~/.local/bin/claude.exe`) e mostre na UI o caminho encontrado e a versão (mínimo 2.1.259) |
| 2 | **Credenciais em texto puro, sem ACL.** A checagem de modo e de dono é pulada em win32. `chatgpt-credentials.json`, `<provider>-credentials.json` e `auth.json` ficam legíveis por qualquer processo do usuário (e por backups ou sync do OneDrive se `%APPDATA%` for redirecionado) | `electron/chatgpt.cjs` `fileStore`, `electron/subscription-store.cjs`, `src/store/auth.ts` | Use `safeStorage.encryptString` do Electron (DPAPI) no main process para os tokens. Em web/dev, avise. Opcionalmente, aplique `icacls` para restringir ao usuário |
| 3 | **Rename atômico com EPERM/EBUSY.** Antivírus (Defender), o indexador ou o OneDrive seguram handles, e `fs.renameSync(tmp, file)` falha esporadicamente. Não há fsync de diretório em win32 | todos os stores (temp + rename) | Retry com backoff (estilo `graceful-fs`, 3 a 10 tentativas, até 1 s) e exclusão de `userData` do scan em dev |
| 4 | **Árvore de processos.** `kill()` no Windows é `TerminateProcess`, sem SIGTERM gracioso, e filhos do `claude.exe` (node, MCP) podem ficar órfãos. Processos vivos com idle de 10 min mantêm handles abertos | `claude-code/live-processes.ts`, `launch.ts` | Use `taskkill /T /F /PID` no shutdown ou Job Objects. Garanta o cleanup em `app.on("before-quit")` |
| 5 | **Arquivos temporários** (`--system-prompt-file`, `--mcp-config`) em `%TEMP%`: o Defender escaneia, há atraso e o cleanup falha num crash | `claude-code/launch.ts` | Use um diretório próprio em `userData/tmp`, limpe no boot e trate EBUSY no unlink |
| 6 | **Caminhos.** `MAX_PATH` de 260 em `userData/data/...` profundos; usuários com espaço ou caracteres não ASCII no nome; separador `\`; case-insensitivity nas checagens de "dentro da pasta permitida" das tools `read/ls/find/grep` | `src/agent/tools/file-access.ts`, `fs-shared.ts` | Use `path.resolve` + `path.relative` com `toLowerCase()` em win32. Teste com `C:\Users\Usuário Teste\`. Considere `\\?\` ou `LongPathsEnabled` |
| 7 | **CRLF** nos `.md` de prompt e mermaid com `git core.autocrlf=true`: `\r` vaza nos prompts e no `parseMermaidPlan` | `src/agent/prompts/**`, `tools/mermaid-plan.ts` | `.gitattributes` com `*.md text eol=lf` e normalização `\r\n → \n` na leitura |
| 8 | **Portas loopback** (callback OAuth, ponte MCP, servidor Next filho). Ligar em 127.0.0.1 normalmente não abre o prompt do Firewall, mas software corporativo pode bloquear | `electron/chatgpt.cjs`, `tool-bridge.ts`, `main.cjs` | Mantenha o bind estrito em `127.0.0.1` (nunca `0.0.0.0`) e mostre um erro claro em caso de timeout |
| 9 | **Variáveis de ambiente case-insensitive.** `process.env` no Windows não diferencia `Path` de `PATH`. O fill-gap usa `=== undefined` e não é afetado, mas cópias do env para o spawn podem duplicar chaves | `src/server/keys.ts`, `auth-env.ts`, `externalCliEnv()` | Normalize as chaves ao montar o env do filho |
| 10 | **`LH_IGNORE_ENV_KEYS=1` apaga do processo as variáveis de ambiente reais**, inclusive `OPENAI_API_KEY` usada por outras ferramentas filhas | `src/server/keys.ts` `initAuthEnv` | Use apenas para simular um usuário novo |
| 11 | **Dependências nativas e build** (Next standalone, staging de `core-plugins`, `esbuild` dos plugins). Binários por plataforma (`@esbuild/win32-x64` etc.) e o rebuild do Electron | `scripts/build-*`, `plugins/*/scripts/build.mjs` | Rode a CI em `windows-latest` e use `electron-builder --win` com `asarUnpack` para os binários |
| 12 | **SmartScreen e assinatura de código.** Um instalador sem assinatura gera aviso, e um `claude.exe` baixado pode ser marcado | `docs/desktop-release.md` | Assinatura Authenticode (ou aviso na doc) |

---

## 8. Licenças

- **LearnHarness**: AGPL-3.0-only. O fork herda a AGPL. Se o app for oferecido como serviço web, o código-fonte modificado precisa estar disponível aos usuários (§13 da AGPL). Os plugins do repositório (`plugins/flashcards`) também são AGPL, e o FSRS tem licença própria em `FSRS-LICENSE.txt` (verificar: ts-fsrs é MIT).
- **Pi SDK** (`@earendil-works/pi-ai`, `pi-agent-core`, `pi-telemetry` 1.4.0): MIT. A compactação é um port do pi-coding-agent (MIT) dentro de um arquivo AGPL.
- **Dependências citadas:** `jose` (MIT), `typebox` (MIT), `undici` (MIT), Readability (`@mozilla/readability`, Apache-2.0), Turndown (MIT).
- **Serviços:** a Jina Reader (`r.jina.ai`) tem ToS próprio e rate limit. Tavily, Brave, Exa e Firecrawl são pagos, com chave. models.dev (sst, MIT, a verificar) e a API pública de modelos da OpenRouter têm ToS próprio.

---

## 9. Recomendações priorizadas

1. **P0 — Fallback de template para modelos do ChatGPT e do Copilot fora do catálogo pi** (§3.3-1). Sem isso, a meta "sem hardcode" falha a cada lançamento da OpenAI até alguém atualizar o pi-ai.
2. **P0 — Criptografar as credenciais com `safeStorage` (DPAPI)** no main do Electron, com migração transparente do JSON atual (`version: 2`, campo `enc`). No Windows é o maior risco real.
3. **P0 — Ledger de horas** por heartbeat (§5.5) mais `GET /api/stats` agregando turns, jobs, extrações e plugins (§5.4). Tokens para todos os providers, US$ só quando houver preço, mais o "equivalente API" opcional.
4. **P1 — Domínio como entidade** (`ChatRecord.domain`, slots por domínio, `prompts/domains/<d>/`). É a base para as sessões Inglês e Eletrônica, o grafo por domínio e as estatísticas por domínio.
5. **P1 — `update_mastery` e `expand_graph` no core** (`createTeacherTools` + stores novas), separando o grafo **curricular** do grafo de **aprendizado** que o `extraction.ts` já escreve. A leitura do currículo fica por tool (`curriculum_lookup`), seguindo o princípio "context injection is dead", mais um marker `curriculum-context` no início da sessão.
6. **P1 — Memória de longo prazo:** escrita em background no `onFinish` e na compactação (seção nova em `buildCompactionPrompt`), leitura pela tool `recall_memory`. Use o papel `cheap` e `callPurpose: "background"`, o que exige `allowBackgroundUse` em assinaturas; trate a negação com elegância.
7. **P2 — Curador de recursos** como job assíncrono (novo `kind` e `ModelRole`), reaproveitando o researcher e o `safeFetch`.
8. **P2 — Metadados dinâmicos de preço e contexto** (models.dev / OpenRouter) só para preencher lacunas. Bom para custom e para ChatGPT fora do catálogo.
9. **P2 — Robustez no Windows:** retry de rename, `taskkill /T` e `.gitattributes` com LF.
10. **Não fazer:** expor o OAuth Anthropic do pi-ai (proibido desde 2026-02/04) nem cair silenciosamente de assinatura para API key (quebra a promessa de custo do produto).

---

## 10. Perguntas em aberto

1. Existe versão mais nova do pi-ai do que a 1.4.0, com modelos OpenAI e Anthropic de 2026-H2, e ela muda a API (`createModels`, `streamSimple`)? Rodar `npm view @earendil-works/pi-ai versions`.
2. O endpoint `GET /v1/models` com token de assinatura devolve `context_window`/`max_output_tokens`? Se sim, o template de fallback pode usar valores reais.
3. Dirigir o `claude -p` a partir de um app de terceiros com assinatura Pro/Max é aceito pela Anthropic? É zona cinzenta, e o próprio LearnHarness não certifica.
4. O "Sign in with ChatGPT" para apps não parceiros (registro dinâmico `dynamic_agent_client`) seguirá aberto ou exigirá aprovação de app? O DevDay 2026 citou 16 parceiros.
5. Qual o limite semanal por app que o usuário define no ChatGPT e como o LearnHarness exibe "cota esgotada" (hoje é um link para `chatgpt.com/settings/usage`)?
6. Onde exatamente o `safePluginDataDirectory` coloca o `dataDirectory` de plugins core vs instalados (`data/core-plugin-data/<id>` vs `data/plugins/<id>/…`)? Afeta o agregador de estatísticas.
7. O XP e o ranking Monte Carlo devem considerar o custo em tokens (eficiência) ou só o mastery e o tempo? Definição de produto.
