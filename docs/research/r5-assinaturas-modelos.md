# R5 — Assinaturas de IA em app de terceiros e catálogo de modelos sem hardcode

> **Estado verificado em 2026-11-18.** Tarefa `r-auth-models`.
> Pergunta: como o nosso fork do learnharness (Next.js 16 + Electron, AGPL-3.0, local) pode usar **assinaturas** (ChatGPT, Claude, Copilot, Grok etc.) em vez de API keys, **respeitando os termos de serviço**, e como listar modelos **sem nenhum ID hardcoded**.
> Este relatório complementa `docs/research/lh-agent-providers.md` (que descreve a camada de provedores do learnharness por dentro). Aqui o foco é o **estado externo** (docs oficiais, termos, endpoints, quem usa o quê) e a **arquitetura recomendada**.

---

## 0. TL;DR (decisão recomendada)

1. **OpenAI tem um caminho OFICIAL desde o DevDay 2026 (2026-09-29): "Sign in with ChatGPT" + "ChatGPT plan usage" (SIWC).** É um OAuth público (PKCE, sem client secret) com **registro dinâmico** (`client_id=dynamic_agent_client` → o callback devolve um `client_id` emitido, `oaiapp_…`), escopos `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, `resource=https://api.openai.com/v1`. A inferência vai para a **API pública** `POST https://api.openai.com/v1/responses` (com `store:false`, `stream:true`), e os modelos da conta vêm de `GET https://api.openai.com/v1/models` (formato `models[]` estilo Codex). Vale para apps **open-source e locais** (o nosso caso). **O learnharness já implementa exatamente isso** em `electron/chatgpt.cjs`. → **Usar, com as melhorias da §2.7.**
2. O **fluxo "Codex CLI"** (client_id público `app_EMoamEEZ73f0CkXaXp7hrann`, backend `https://chatgpt.com/backend-api/codex/responses`) ainda funciona e é usado por Cline, DeepTutor, OpenClaw, pi e (marcado como *legacy*) OpenCode. Mas não é documentado para terceiros, depende de `client_version`/`originator`, e a própria doc do SIWC manda **não** apontar para `backend-api`. → **Não usar no nosso app.**
3. **Anthropic: não existe login de assinatura para apps de terceiros.** A página oficial de compliance proíbe: (a) oferecer login claude.ai no app; (b) rotear requisições por credenciais Free/Pro/Max/Ultra em nome do usuário; (c) coletar, armazenar ou intermediar tokens/sessões claude.ai. Desde **2026-04-04 (12h PT)** a assinatura deixou de cobrir "third-party harnesses" (começando pelo OpenClaw). **Permitido explicitamente:** o usuário logar no **binário oficial, não modificado, do Claude Code** com a própria assinatura; e `claude -p`/Agent SDK logados no plano consomem os limites do plano (support, atualização de 2026-10-07). → Caminho compliant para nós:
   - (a) **API key** do usuário. Desde 2026-10-07, Max (US$100/mês), Ultra (US$200/mês) e Team (US$20–100/assento, pool de até US$500) incluem **créditos mensais de API**.
   - (b) **Opt-in "CLI externo: Claude Code"**, que só aciona o `claude` instalado e logado pelo próprio usuário, sem nunca tocar em credenciais. É o que o learnharness já faz. **Desligado por padrão e com aviso**, porque há zona cinzenta residual.
4. **Google:** usar o OAuth do Gemini CLI ou do Antigravity em ferramentas de terceiros é **violação explícita** e pode levar à suspensão da conta. → **Só API key** (AI Studio ou Vertex). Assinantes AI Pro/Ultra recebem créditos Cloud mensais via Google Developer Program.
5. **GitHub Copilot:** o caminho oficial para apps é o **Copilot SDK** (`@microsoft/copilot-sdk`, MIT), com OAuth App próprio ou login do CLI. A cobrança cai no plano do usuário (AI Credits desde 2026-06-01). O OpenCode tem parceria formal (2026-01-16). O OAuth com client id do VS Code + `copilot_internal/v2/token` (usado via pi-ai) é **não oficial**.
6. **xAI (SuperGrok/X Premium):** o OAuth é promovido pela própria xAI para integrações OSS nomeadas (OpenCode 2026-05-21, Hermes, OpenClaw, Kilo, T3). Terceiros reutilizam o client público do Grok CLI. Não encontrei programa nem termos públicos para apps arbitrários. → **Amarelo: experimental e opt-in.**
7. **Kimi Code:** a chave de membership é restrita a "agentes de programação permitidos". Para um app de estudo, usar a API key da Moonshot Open Platform. **Qwen:** o OAuth gratuito acabou em 2026-04-15. **OpenRouter:** tem OAuth PKCE oficial que gera uma **API key do próprio usuário** (verde, ideal para BYOK sem copiar e colar).
8. **Modelos sem hardcode:** separar **entitlement** (o que a conta pode usar, vindo do endpoint do provedor ou do CLI) de **metadados** (contexto, preço e capacidades, em cascata: nativo → models.dev → LiteLLM → OpenRouter → estimado).
   - Cache *stale-while-revalidate*: fresco por 5 min, *stale* por 24 h, com ETag quando houver.
   - Refresh no boot, no login, na troca de conta, no erro "modelo indisponível" e manual.
   - Snapshot embutido só como fallback de **metadados**, nunca de entitlement.
   - Papéis (forte/barato/visão por domínio) resolvidos **por capacidade**, com pin opcional.
   - Hoje o learnharness **descarta** slugs da conta ChatGPT que o pi-ai não conhece (`refreshChatGPTModels`). Isso precisa mudar.

### Semáforo por provedor (para o nosso app: OSS, local, desktop)

| Provedor | Caminho por assinatura | Status de ToS | Recomendação |
|---|---|---|---|
| OpenAI ChatGPT (Go/Plus/Pro/Business) | SIWC plan usage → `api.openai.com/v1/responses` | **Verde** (documentado para OSS/local) | **P0: manter/melhorar** |
| OpenAI via client do Codex CLI | `chatgpt.com/backend-api/codex` | Amarelo/vermelho (não documentado, *legacy*) | Não usar |
| Anthropic Claude (Pro/Max/Ultra) por OAuth direto | — | **Vermelho** (proibido) | Nunca habilitar o `anthropic` OAuth do pi-ai |
| Anthropic via `claude` CLI do usuário | o CLI usa a própria sessão | Amarelo-verde (permitido no texto, mas usos "não ordinários" podem ser restringidos) | Opt-in, off por padrão |
| Anthropic API key (inclui créditos Max/Ultra/Team) | — | **Verde** | **P0: destacar no onboarding** |
| Google Gemini CLI / Antigravity OAuth | — | **Vermelho** (suspensão) | Nunca |
| Gemini API key (AI Studio) | — | Verde | Manter BYOK |
| GitHub Copilot via Copilot SDK | OAuth App próprio / login do CLI | Verde | P3 (avaliar) |
| GitHub Copilot via client do VS Code (pi-ai) | `copilot_internal/v2/token` | Amarelo | Opt-in "experimental" |
| xAI SuperGrok OAuth (client do Grok CLI) | device code em `auth.x.ai` | Amarelo | Opt-in "experimental" |
| Kimi Code membership | API key de coding | Amarelo/vermelho para uso não-coding | Usar a Moonshot API key |
| Qwen OAuth | encerrado em 2026-04-15 | — | Não |
| OpenRouter OAuth PKCE | gera API key do usuário | **Verde** | **P2: adicionar** |

---

## 1. Escopo, método e limitações

- **Fontes primárias lidas:**
  - documentação oficial completa do SIWC (`developers.openai.com/siwc/llms-full.txt`, ~106 KB);
  - artigos do Help Center da OpenAI 20001410 e 20001542;
  - diretório de parceiros em `learn.chatgpt.com/docs/sign-in-with-chatgpt`;
  - `learn.chatgpt.com/docs/pricing` (limites por plano) e `developers.openai.com/codex/auth`;
  - código do `openai/codex` (tag `rust-v0.170.0`, publicada em 2026-11-18): `codex-rs/login/src/server.rs`, `login/src/auth/manager.rs`, `codex-api/src/endpoint/models.rs`, `models-manager/src/{manager,cache}.rs`, `models-manager/models.json`;
  - `code.claude.com/docs/en/legal-and-compliance`, `authentication`, `agent-sdk/overview` e `agent-sdk/typescript`;
  - Claude Help Center: artigos 15036540 e 17154008;
  - `platform.claude.com/docs/en/api/models/list`;
  - referência `GET /v1/models` da OpenAI;
  - Gemini CLI ToS; `ai.google.dev` (Google AI plans; `models` API);
  - GitHub changelog (OpenCode, 2026-01-16) e `github/copilot-sdk` (`docs/auth/authenticate.md`, README Node);
  - x.ai (post de 2026-05-21 sobre OpenCode);
  - OpenRouter (`/docs/use-cases/oauth-pkce`, `GET /api/v1/models`);
  - `models.dev/api.json` (README do `anomalyco/models.dev`);
  - `BerriAI/litellm/model_prices_and_context_window.json`;
  - `tokenlens` (npm e GitHub);
  - código de pi (`earendil-works/pi`), OpenCode (`anomalyco/opencode`) e Cline (`cline/cline`).
- **Código local (somente leitura):**
  - learnharness: `electron/chatgpt.cjs`, `electron/subscriptions.cjs`, `electron/subscription-store.cjs`, `src/agent/chatgpt-*.ts`, `src/server/model-catalog.ts`, `src/agent/claude-code/*`, `docs/claude-code.md`;
  - DeepTutor (`_refs/DeepTutor`, só leitura, nada executado): `compose.codex-oauth.yaml`, `deeptutor/services/codex_auth/*`, `deeptutor/services/llm/provider_core/openai_codex_provider.py`.
- **Fontes secundárias**, usadas só para datas e contexto, sempre indicadas como tal: The Register, TechCrunch, Axios e o recap do DevDay (openai.com).
- **Limitações:**
  - O orçamento de WebSearch da sessão se esgotou no fim. Não confirmei se existe um programa "Sign in with Claude" para terceiros: nenhuma doc oficial lida o menciona, e a página de compliance manda "contact sales".
  - A ferramenta `paper-search` (arXiv) devolveu resultados irrelevantes. O tema é de produto e política, então as "fontes acadêmicas" pertinentes são RFCs: OAuth 2.0 for Native Apps (RFC 8252), PKCE (RFC 7636), Device Grant (RFC 8628), JWK Thumbprint URI (RFC 9278).
- **Nomes de modelos** (GPT-6.2 Sol, Claude Opus 5.5 etc.) aparecem exatamente como nas fontes de nov./2026. O objetivo deste relatório é justamente **não depender deles**.

---

## 2. OpenAI

### 2.1 Dois caminhos completamente diferentes

| | **(A) SIWC "ChatGPT plan usage" (oficial)** | **(B) Login do Codex CLI (legado/não documentado p/ terceiros)** |
|---|---|---|
| Doc | `developers.openai.com/siwc/token-sharing-open-source/*` | Nenhuma para terceiros. Fonte: código `openai/codex` |
| `client_id` | `dynamic_agent_client` no 1º login → callback devolve `client_id` emitido (`oaiapp_…`), salvo por conta | Fixo: `app_EMoamEEZ73f0CkXaXp7hrann` (Codex CLI) |
| Authorize | `https://auth.openai.com/api/accounts/authorize` | `https://auth.openai.com/oauth/authorize` |
| Token | `https://auth.openai.com/api/accounts/oauth/token` (form, com `resource`) | `https://auth.openai.com/oauth/token` |
| Escopos | `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct` | `openid profile email offline_access api.connectors.read api.connectors.invoke` |
| Inferência | `POST https://api.openai.com/v1/responses` (Bearer = access token) | `POST https://chatgpt.com/backend-api/codex/responses` + header `chatgpt-account-id` |
| Modelos | `GET https://api.openai.com/v1/models` → `{models:[{slug, display_name, visibility, supported_in_api, context_window, input_modalities, supported_reasoning_levels,…}]}` | `GET https://chatgpt.com/backend-api/codex/models?client_version=X.Y.Z` |
| Identidade do app | `agent_name_hint` (nome real do app), `ext_agent_host_id` (por host) | `originator` (ex.: `codex_cli_rs`) |
| Controle do usuário | ChatGPT → Settings → Usage → **App limits** (limite semanal por app, 10–100%) e Login connections → Disconnect | Nenhum por app: aparece como uso do Codex |
| Quem usa | learnharness, pi (`openai-chatgpt.ts`), OpenCode (`chatgpt.ts`), OpenClaw (`token-sharing.ts`), TanStack/ai (`siwc.ts`), Kilo, T3, Amp, Warp, Notion, Vercel, Devin… | Cline, DeepTutor, pi (`openai-codex.ts`), OpenClaw, OpenCode ("Codex browser/device code (legacy)") |

### 2.2 SIWC: especificação implementável (o que um engenheiro precisa)

#### 2.2.1 Conceitos: *client* × *host*

- **Client:** a registration OAuth que o usuário autoriza. No fluxo dinâmico, cada `client_id` emitido fica **amarrado ao usuário e ao workspace** escolhidos no registro. Os limites e configurações de uso por app pertencem ao client.
- **Host:** onde uma instância do app roda (notebook, VM). O app define o ciclo de vida. Reiniciar ou relogar **não** cria host novo.
  - Gere e **persista** um `ext_agent_host_id` estável por host **antes do 1º login**.
  - Ele é opaco: não use email nem user id. Também **não é credencial**.
  - Formatos aceitos:
    - `urn:ietf:params:oauth:jwk-thumbprint:…` (recomendado, RFC 9278, derivado de um par de chaves; a OpenAI ainda não verifica posse da chave privada);
    - `urn:uuid:<uuidv4>` (suportado; é o que o learnharness usa);
    - `did:key:<key>`.
- Um mesmo `client_id` pode servir vários hosts do mesmo usuário e workspace (ex.: notebook + VM), cada um com seu host id.

#### 2.2.2 Requisição de autorização (abrir no navegador do sistema)

Endpoint: `https://auth.openai.com/api/accounts/authorize`. Todos os valores vão URL-encoded.

| Parâmetro | Valor |
|---|---|
| `client_id` | `dynamic_agent_client` no **primeiro** registro. Depois, o `client_id` emitido salvo para aquela conta |
| `agent_name_hint` | Nome **real** do app, igual em todas as instalações. **Só** no registro inicial (omitir na reautorização). O usuário pode editar o nome antes de aprovar; é metadado de exibição, não identidade |
| `ext_agent_host_id` | **Obrigatório**: o host id persistido |
| `id_token_hint` | Na reautorização: o `id_token` retido do último login (pode estar expirado). Pula o seletor de conta |
| `login_hint` | Opcional na reautorização: email salvo do id_token validado |
| `response_type` | `code` |
| `redirect_uri` | Loopback **`http://127.0.0.1:<porta>/auth/callback`**. Use sempre `127.0.0.1`, **não** `localhost`. Só a porta pode variar entre logins. O mesmo URI exato vai no authorize e no token exchange |
| `scope` | Identidade: `openid profile email`. Uso do plano: `offline_access resource.invoke chatgpt.tokens.use.direct` |
| `resource` | `https://api.openai.com/v1` |
| `state`, `nonce` | Aleatórios e novos a cada tentativa |
| `code_challenge_method` / `code_challenge` | `S256` / base64url(SHA-256(verifier)) sem padding |

Exemplo, no estilo do que o `electron/chatgpt.cjs` já monta:

```
https://auth.openai.com/api/accounts/authorize
  ?client_id=dynamic_agent_client
  &agent_name_hint=<NomeDoNossoApp>
  &ext_agent_host_id=urn%3Auuid%3A<uuid>
  &response_type=code
  &redirect_uri=http%3A%2F%2F127.0.0.1%3A<porta>%2Fauth%2Fcallback
  &scope=openid%20profile%20email%20offline_access%20resource.invoke%20chatgpt.tokens.use.direct
  &resource=https%3A%2F%2Fapi.openai.com%2Fv1
  &state=<rand>&nonce=<rand>&code_challenge_method=S256&code_challenge=<S256>
```

Para religar consentimento depois de uma recusa:
- refaça o OAuth com o `client_id` salvo e o **conjunto completo** de escopos;
- `prompt=consent` já é suportado;
- `force_reconsent=true` só depois que a OpenAI confirmar o deploy para a sua integração;
- não force consentimento em todo login.

#### 2.2.3 Callback e troca do código

- Callback de **novo registro**: `?code=…&scope=…&state=…&client_id=<EMITIDO>`.
  - Sem `client_id` emitido, o registro está **incompleto**.
  - **Nunca** salve `dynamic_agent_client` como ID da conexão.
- Na reautorização o `client_id` pode vir omitido: use o já associado. Se vier **diferente**, rejeite.
- `error=access_denied`: valide o `state`, pare e não troque o código.
- Troca do código:
  - `POST https://auth.openai.com/api/accounts/oauth/token`, form-urlencoded;
  - campos: `grant_type=authorization_code`, `client_id=<emitido>`, `code`, `code_verifier`, o mesmo `redirect_uri` e o mesmo `resource`;
  - **sem client secret**;
  - um `invalid_grant` descarta o código: recomece com o `client_id` emitido retido.
- Resposta: `access_token`, `refresh_token`, `id_token`, `token_type`, `expires_in`, `scope`, `earliest_refresh_at`.

#### 2.2.4 Validação (obrigatória antes de liberar inferência)

1. Valide o `id_token`:
   - assinatura contra o JWKS `https://auth.openai.com/.well-known/jwks.json` (RS256);
   - `iss=https://auth.openai.com`, `aud=<client_id emitido>`, `exp` e o `nonce` da tentativa;
   - use `sub` como identidade. Email e `sub` **não** identificam workspace: guarde o `client_id` junto com a identidade.
2. Na reautorização, confirme que o `sub` novo é o da conta selecionada **antes** de substituir credenciais.
3. **Confirme que `chatgpt.tokens.use.direct` está nos escopos concedidos.** Sem ele, mantenha o login (identidade) mas marque "uso do plano desligado" e ofereça religar ou usar uma API key.

#### 2.2.5 Armazenamento

- Um registro protegido por `client_id` emitido + identidade verificada, com:
  - `email`, `issuer`, `subject`, `client_id`, `ext_agent_host_id`;
  - `id_token`, `access_token`, `refresh_token`, `token_type`, `expires_in`, `scopes[]`, `saved_at`.
- Escrita atômica, só para o dono (`0600` no Unix). Fora do browser storage, do git, dos logs e da telemetria.
- **Nunca** tokens em URL.
- O `id_token` só pode ir como `id_token_hint` para o endpoint de authorize, e URLs com o hint devem ser redigidas nos logs.

#### 2.2.6 Refresh, tempos de vida e revogação

- **Access token:** 1 h (`expires_in: 3600`).
- **Refresh token:** 30 dias. Cada refresh devolve um refresh **novo**, também de 30 dias, sem limite de renovações enquanto válido. **Rotativo:** serialize os refreshes da mesma sessão para dois processos não disputarem o mesmo token.
- Requisição de refresh:
  - `POST https://auth.openai.com/api/accounts/oauth/token` (form);
  - campos: `grant_type=refresh_token`, `client_id=<emitido>` (não `dynamic_agent_client`), `refresh_token`, `resource=https://api.openai.com/v1`;
  - **sem** `scope` (mantém o grant).
- Erros de refresh:
  - `invalid_grant`, `invalid_refresh_token`, `token_expired`, `refresh_token_expired`, `refresh_token_invalidated` ou `refresh_token_reused`: limpe os tokens e refaça o OAuth com o mesmo `client_id`;
  - `invalid_client`: erro de configuração.
- Logout:
  - pegue o `revocation_endpoint` em `https://auth.openai.com/.well-known/openid-configuration`;
  - `POST` form com `token=<refresh>`, `token_type_hint=refresh_token` e `client_id`;
  - um **200 vazio** é sucesso, inclusive para token já inválido;
  - em erro de rede ou 5xx, retry com backoff. Se não confirmar, limpe localmente e avise o usuário de que pode desconectar o app em ChatGPT Settings;
  - revogar **não** apaga o client registrado.
- **Não há notificação** quando o usuário desconecta o app pelo ChatGPT. Detecte pelo 401 ou pelo refresh falhando, e não apague credenciais por falha temporária de rede.

#### 2.2.7 Claims do access token

O access token é um JWT com: `sub`, `aud=https://api.openai.com/v1`, `client_id`, `scope`, `iss`, `iat`, `exp`, `jti`, `nbf` e o objeto opaco `https://api.openai.com/auth` com `per_user_salt` e `encrypted_auth_metadata`. Trate esse objeto como opaco.

#### 2.2.8 Modelos e inferência

- **Listar modelos da conta:** `GET https://api.openai.com/v1/models` com `Authorization: Bearer <access_token>`.
  - Resposta: `{ "models": [ … ] }`.
  - Filtrar `visibility === "list"` e manter a **ordem do servidor**. Mostrar `display_name` e enviar `slug` como `model`.
  - **Atualizar ao trocar de conta.**
  - O OpenCode também filtra `supported_in_api === true` e lê `context_window`, `input_modalities` e `supported_reasoning_levels[].effort` do mesmo payload (`packages/core/src/plugin/provider/chatgpt.ts`, schema `RemoteModel`). Os campos seguem o `ModelInfo` do Codex, §2.3.4.
- **Inferência:** `POST https://api.openai.com/v1/responses`, Bearer = access token. Os SDKs oficiais funcionam passando o token como `api_key` e `base_url=https://api.openai.com/v1`, com `max_retries=0`.
- **Restrições do preview** (`preview-limitations`):
  - **Obrigatório** `store:false` e `stream:true`.
  - `input` é um **array com todo o histórico** (sem `previous_response_id` via HTTP).
  - Use `instructions` ou mensagens `developer`: itens `role:"system"` são **rejeitados**.
  - **Campos proibidos:** `background`, `conversation`, `max_output_tokens`, `max_tool_calls`, `metadata`, `moderation`, `multi_agent`, `prompt`, `prompt_cache_retention`, `safety_identifier`, `temperature`, `top_logprobs`, `top_p`, `truncation`, `user`.
  - **Tools suportadas:** function/custom agrupadas em **namespaces** (ou via itens `additional_tools`). Web search depende do modelo e da política da conta.
  - **Tools não suportadas:** geração de imagem, file search, Code Interpreter, computer use nativo, MCP hospedado/connectors e `tool_search`. `programmatic_tool_calling` não é aceito nos `tools` de topo.
  - **Entradas:** texto, imagem e arquivos (quando o modelo aceita). Áudio, vídeo, Files API e transcrição **não**.
- **Sucesso só com `response.completed`.**
  - Um limite pode chegar como `response.failed` **depois** que o stream começou (`subscription_sharing_usage_limit_exceeded` ou `_unavailable`).
  - Trate `response.incomplete`, erro explícito e stream interrompido separadamente.

#### 2.2.9 Erros (mapeie por código, não por texto)

Antes de abrir o stream, a admissão pode responder `{"detail":"..."}` (texto diagnóstico, não código estável):
- **401:** identidade ou permissão não aceitas;
- **403:** política (ex.: região de serviço);
- **503:** roteamento indisponível; faça backoff.

Erros estruturados da camada Responses:

| `error.code` | HTTP | Ação |
|---|---|---|
| `subscription_sharing_user_not_eligible` | 403 | Explicar a restrição. **Não** repetir nem fazer loop de OAuth |
| `subscription_sharing_usage_limit_exceeded` | 429 | Pausar requisições do plano e linkar `https://chatgpt.com/settings/usage`. Pode ser o limite do **app**, não do plano todo. Não inferir horário de reset |
| `subscription_sharing_usage_unavailable` | 503 | Retry com backoff limitado |
| `subscription_sharing_unsupported_capability` | 400 | Ler `error.param` e remover o campo, tool, modelo ou tier. Não repetir o mesmo body |
| `subscription_sharing_route_not_supported` | 403 | Rota ou método errado (use `POST /v1/responses`) |
| `subscription_sharing_invalid_user` | 401 | Credencial inválida: guardar request id; relogar após revogação confirmada |
| `chatpass_v2_scope_not_authorized` / `chatpass_v2_invalid_authorization_context` | 403 | Configuração de client ou grant. Não trocar billing |
| `subscription_sharing_user_unavailable` | 503 | Backoff |

**Regra de produto da OpenAI:** um erro de plano **para** a inferência. Não há troca silenciosa para outro billing. O learnharness já segue isso ("No API-key fallback was used").

#### 2.2.10 Alternativa: Codex app-server com o token SIWC

Se um dia quisermos o **harness do Codex** (shell, MCP, subagentes) em vez do nosso loop:

1. Rodar `codex app-server --listen stdio://` com um provider de modelo: `base_url="https://api.openai.com/v1"`, `env_key="ACCESS_TOKEN"`, `wire_api="responses"`, `requires_openai_auth=false`, `supports_websockets=false`.
2. Mandar `initialize` com `clientInfo.name`, que deve **bater com o `agent_name_hint`**.
3. Seguir com `thread/start` e `turn/start`.
4. O refresh fica por nossa conta: reiniciar o processo com o token novo e chamar `thread/resume`.
5. O `model/list` do app-server pode devolver um catálogo **embutido**, que **não** é prova de entitlement.

Para um app de estudos não vale a pena: o nosso loop pi-agent-core já faz isso.

#### 2.2.11 UI/UX exigida (`siwc/ui-ux-guidelines`)

- Botão rotulado **"Continue with ChatGPT"**, com branding aprovado e proeminência igual à das outras opções.
- **Modal de boas-vindas só no 1º login** com uso do plano ("You're using your ChatGPT plan" / "Got it").
- **Indicador "Using ChatGPT plan"** perto do composer ou do seletor de modelo, com link **"Manage usage"** para `https://chatgpt.com/settings/usage`.
- Na página de uso do app, link "Manage usage" perto do resumo.
- No limite de uso: modal ou cartão compacto com **"Manage usage" como ação primária**.
- Se o app tiver planos pagos, deixar claro quais suportam uso do plano ChatGPT. Não se aplica a nós.

#### 2.2.12 Elegibilidade, limites e controles (planos em nov./2026)

- **Quem pode:**
  - O DevDay 2026 anunciou o uso do plano "em 16 parceiros" para Plus e Pro.
  - O Help Center (atualizado ~2026-11-12) ampliou para **Go, Plus, Pro e Business** em apps comerciais participantes.
  - O mesmo artigo diz que "ferramentas open-source suportadas continuam disponíveis a todos os usuários do ChatGPT" (redação ambígua para o Free; tratar com o erro `…user_not_eligible`).
  - Business depende do admin: Admin Console → Tenant settings → External access → "Use ChatGPT plan = Allowed". Também há um percentual de "Usage in other services" por workspace.
- **Programa:**
  - O uso do plano está aberto a **projetos open-source e projetos pessoais rodando localmente** (mais clientes privados selecionados).
  - App **pago ou hospedado remotamente** exige o formulário `openai.com/form/sign-in-with-chatgpt-interest/`.
  - O nosso fork (AGPL, Electron local) **se qualifica**. Se um dia virar SaaS, precisa aplicar.
- **Contabilização:**
  - O uso sai da franquia **"ChatGPT Work and Codex"** do plano. Não é uma franquia nova.
  - Para Plus, o **limite de 5 h é compartilhado entre todos os apps**. No Pro não há limite de 5 h.
  - Por app, o usuário define um **limite semanal** (% do total, 10–100%). É um teto, não reserva.
  - Créditos depois do limite: opt-in global (off por padrão), e o app precisa estar com limite de 100%.
- **Planos (learn.chatgpt.com/docs/pricing):**
  - Free US$0, Go US$8, Plus US$20/mês;
  - Pro US$100, US$200 ou US$500 (o Pro 500 tem 25× a franquia do Plus e Ultrafast);
  - Business US$20 por usuário/mês (anual).
  - Estimativa de mensagens **locais por janela de 5 h no Plus** (o Standard Business é igual):

| Modelo | Plus (msgs/5 h) |
|---|---|
| GPT-6.2 Astra | 6–50 |
| GPT-6.2 Sol | 17–180 |
| GPT-6 Astra | 5–45 |
| GPT-6.1 Sol | 15–160 |
| GPT-6.1 Terra | 35–285 |
| GPT-6 Sol | 15–150 |
| GPT-6 Luna | 350–3.000 |

- **Tabela de créditos** (por 1M tokens, entrada / cache / saída), útil para mostrar o "custo equivalente" nas estatísticas, sempre marcado como estimativa:
  - GPT-6.2 Sol: 50 / 2,5 / 250;
  - GPT-6.1 Terra: 25 / 1,25 / 125;
  - GPT-6 Luna: 2,5 / 0,25 / 12,5;
  - GPT-6.2 Astra: 200 / 10 / 1.000.
- **Multiplicadores de velocidade:** Fast 2–2,5×, Ultrafast 6–8× da franquia.
- **Para tutoria**, um modelo "Luna" ou "Terra" rende de 10 a 100× mais mensagens que um "Astra". Isso reforça o papel "barato" para geração em lote (flashcards, resumos) e o "forte" só para explicações difíceis.

### 2.3 Fluxo legado do Codex CLI (para referência; não recomendado)

Verificado no `openai/codex` (`rust-v0.170.0`) e no DeepTutor (`deeptutor/services/codex_auth/constants.py`, auditado contra o commit `81da9de…`).

#### 2.3.1 OAuth

- `CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"` (`codex-rs/login/src/auth/manager.rs`). Pode ser sobrescrito por `CODEX_APP_SERVER_LOGIN_CLIENT_ID`.
- **Authorize:** `https://auth.openai.com/oauth/authorize` com:
  - `response_type=code`, `client_id`, `redirect_uri`, `scope="openid profile email offline_access api.connectors.read api.connectors.invoke"`;
  - `code_challenge` + `S256`, `state`;
  - parâmetros extras `id_token_add_organizations=true`, `codex_cli_simplified_flow=true`, `originator=<originator>` (`server.rs` linhas ~589–613).
- **Portas:** padrão 1455, fallback 1457. O Codex atual usa `http://127.0.0.1:<porta>/auth/callback`. O DeepTutor e o Cline usam `http://localhost:1455/auth/callback`; por isso o `compose.codex-oauth.yaml` do DeepTutor publica 1455 e 1457 em loopback **só durante o login**.
- **Token:** `https://auth.openai.com/oauth/token`. O Codex faz refresh numa janela de 5 min antes da expiração, com mensagens específicas para refresh expirado, reutilizado ou revogado. **Revoke:** `https://auth.openai.com/oauth/revoke`.
- **Device code (beta)**, usado pelo pi: `https://auth.openai.com/api/accounts/deviceauth/usercode` e `…/deviceauth/token`. O usuário precisa habilitar device code nas configurações de segurança do ChatGPT.
- **Account id:** claim `https://api.openai.com/auth` → `chatgpt_account_id` no id_token ou no access token.
- **Credenciais do Codex:** `~/.codex/auth.json` (texto puro) ou keyring (`cli_auth_credentials_store = file|keyring|auto|ephemeral`).

#### 2.3.2 Backend

- Base: `https://chatgpt.com/backend-api/codex` (`CHATGPT_CODEX_BASE_URL`).
- Inferência: `POST …/responses`.
- Headers usados pelo DeepTutor:
  - `Authorization: Bearer <access>`, `chatgpt-account-id: <id>`;
  - `OpenAI-Beta: responses=experimental`, `originator: <app>`;
  - `session-id`, `accept: text/event-stream`, `User-Agent`.
- Body: `{model, instructions, input, store:false, stream:true, …}`.

#### 2.3.3 Como o Codex descobre os modelos "por plano"

- **Endpoint:** `GET https://chatgpt.com/backend-api/codex/models?client_version=<versão>` (`codex-api/src/endpoint/models.rs`), com ETag. O servidor devolve só o que a **conta e o plano** podem usar.
- **Gating por versão:** cada modelo tem `minimal_client_version`. **Versões antigas recebem catálogo reduzido.** O DeepTutor contorna isso lendo `https://registry.npmjs.org/@openai%2Fcodex/latest` e usando essa versão como `client_version` (fallback fixo `0.153.4`). A versão atual é `0.170.0`.
- **Gerenciador** (`models-manager/src/manager.rs`):
  - semente = `models.json` embutido no binário;
  - cache em disco `$CODEX_HOME/models_cache.json` (um arquivo por originator), TTL `DEFAULT_MODEL_CACHE_TTL = 300 s`;
  - `refresh_if_new_etag`;
  - refresh depois de troca de auth (timeout 5 s);
  - um catálogo explícito do provider desliga a semente embutida.
- **DeepTutor:** fresco por 300 s, *stale* por 86.400 s, no máximo 512 modelos e 8 MiB.
- **Campos do `ModelInfo`** (bundle `models.json`):
  - `slug`, `display_name`, `description`, `visibility` (`list` ou `hide`), `priority` (ordem);
  - `supported_in_api`, `available_in_plans[]` (ex.: `free`, `go`, `plus`, `pro`, `prolite`, `promax`, `business`, `team`, `enterprise`, `edu`…), `minimal_client_version`;
  - `upgrade` (ex.: `gpt-5.6-sol` → `gpt-6-sol`), `context_window`, `max_context_window`, `auto_compact_token_limit`;
  - `input_modalities`, `default_reasoning_level`, `supported_reasoning_levels[{effort}]` (`low … xhigh`, `max`, `ultra`);
  - `supports_parallel_tool_calls`, `service_tiers`, `truncation_policy`, `prefer_websockets`, `use_responses_lite` etc.
- **Bundle de 2026-11-18** (`visibility=list`):
  - `gpt-6.2-sol` (ctx 500k), `gpt-6.2-astra` (272k), `gpt-6.1-sol` (500k), `gpt-6.1-terra` (500k);
  - `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5` (todos 272k).
  - Ocultos: `gpt-daybreak-*`, `codex-auto-review`.
  - **Lição para nós:** esses campos (`priority`, `upgrade`, `available_in_plans`, `visibility`) são exatamente o que precisamos para escolher papéis sem hardcode (§5.4).

### 2.4 Posição e termos oficiais da OpenAI

- O caminho **documentado e endossado** para terceiros é o SIWC, em `developers.openai.com/siwc`, citado no DevDay 2026 e no Help Center.
- A doc SIWC diz explicitamente para usar a rota pública da Responses API **em vez** dos endpoints `backend-api` do ChatGPT.
- O uso do token do Codex CLI em harnesses de terceiros foi **tolerado e até endossado publicamente** por Thibault Sottiaux (Codex, OpenAI) em jan./2026, segundo a The Register de 2026-02-20. Mas nunca virou API documentada.
- O próprio OpenCode passou a rotular esse caminho como **"legacy"** e implementa o SIWC como o principal.
- A doc de auth do Codex trata `~/.codex/auth.json` como senha e recomenda API key para automação.
- **Veredito:** SIWC = verde. Client do Codex = amarelo (risco de quebra e de política, sem controle por app para o usuário).

### 2.5 Quem usa o quê (apps de terceiros)

| App | Caminho | Evidência |
|---|---|---|
| **learnharness** (nossa base) | SIWC (`dynamic_agent_client`, `agent_name_hint=LearnHarness`, host `urn:uuid`) | `electron/chatgpt.cjs` linhas 10–15 e 336–346 |
| OpenCode (`anomalyco/opencode`, MIT, 227k★) | SIWC (`packages/core/src/plugin/provider/chatgpt.ts`) + Codex "legacy" (`openai.ts`, `codexBaseURL=https://chatgpt.com/backend-api/codex`) | código |
| pi (`earendil-works/pi`, MIT) | Ambos: `auth/oauth/openai-chatgpt.ts` (SIWC, porta 1455, `agent_name_hint="Pi"`) e `openai-codex.ts` | código. O pi-ai ≥1.5 expõe o SIWC como `oauth` do provider `openai` |
| OpenClaw (MIT, 394k★) | Ambos (`extensions/openai/token-sharing.ts`; `openai-chatgpt-oauth-*.ts` com client do Codex) | código + diretório oficial |
| Cline (Apache-2.0) | Client do Codex (`sdk/packages/core/src/auth/codex.ts`, `apps/vscode/src/integrations/openai-codex/oauth.ts`) | código |
| Roo Code | **Repositório arquivado** (último push em 2026-05-15) | GitHub |
| Kilo Code, Amp, Conductor, Dactyl, Devin, Hermes Agent, Hyperagent, Notion, Vercel, Vorflux, Warp (Lovable "em breve") | SIWC com uso do plano (parceiros comerciais) | diretório `learn.chatgpt.com/docs/sign-in-with-chatgpt` |
| Airtable, Canva, GitLab, HubSpot, Supabase | Só login (identidade) | idem |
| Integrações OSS listadas | OpenClaw, OpenCode, Pi, T3 Code | idem |
| DeepTutor (`_refs`) | Client do Codex + `backend-api/codex/{responses,models}`, `originator="DeepTutor"`, `compose.codex-oauth.yaml` (portas 1455/1457 só durante o login) | `deeptutor/services/codex_auth/constants.py`, `openai_codex_provider.py` |
| TanStack/ai (MIT) | SIWC (`packages/ai-openai/src/siwc.ts`) | GitHub code search |

### 2.6 learnharness hoje × spec SIWC (auditoria)

**Conforme:**
- PKCE S256 com `state` e `nonce`;
- loopback `127.0.0.1` em porta aleatória com path `/auth/callback` e validação de host, `state` e parâmetros duplicados;
- `dynamic_agent_client` só no 1º registro; `agent_name_hint` só no registro;
- `ext_agent_host_id` persistido (`urn:uuid`); `id_token_hint` e `login_hint` na reautorização;
- troca e refresh com `resource`;
- `id_token` verificado com `jose` (RS256, iss, aud, nonce, azp);
- checagem de todos os escopos; recusa de token `sk-`;
- refresh 60 s antes e serializado;
- revogação via `revocation_endpoint` com retry;
- multi-conta por `issuer+subject`;
- catálogo via `/v1/models` com `visibility==="list"`;
- payload com whitelist (`chatGPTPayload`: `store:false`, `stream:true`, `system→developer`, tools em `namespace`);
- exige `response.completed`;
- erros de cota linkam `chatgpt.com/settings/usage`;
- **nenhum fallback para API key**.

**Gaps e melhorias** (detalhadas na §6):
1. **Modelos desconhecidos são descartados.** `refreshChatGPTModels` (`src/agent/chatgpt-bridge.ts`) só aceita slugs que já existem no catálogo `openai` do pi-ai (versão fixada em 1.4.0; a última publicada é a 1.5.2). Um modelo novo da conta **não aparece** até atualizar o pi-ai, o que contraria o objetivo "sem hardcode". O OpenCode resolve isso com `deriveModels`, sintetizando o modelo a partir de `context_window`, `input_modalities` e `supported_reasoning_levels`.
2. O filtro `supported_in_api` não é aplicado, e `context_window` e os níveis de reasoning do servidor são ignorados (herdados do pi).
3. O mapeamento de erro é feito por **regex no texto** (`chatGPTStreamError`). Ele deveria usar `error.code`/`error.param` da tabela da §2.2.9.
4. **Credenciais em JSON puro.** No Windows não há ACL (`fileStore` só faz `0600` no POSIX). O ideal é cifrar com `safeStorage` do Electron (DPAPI no Windows).
5. O `agent_name_hint` fixo `"LearnHarness"` precisa virar o nome do fork, igual em todas as instalações. Registrations antigas continuam com o nome anterior.
6. Faltam itens de UI/UX: modal do 1º uso, badge "Using ChatGPT plan" + "Manage usage" e o rótulo "Continue with ChatGPT".

---

## 3. Anthropic (Claude Pro/Max/Ultra)

### 3.1 Linha do tempo

| Data | Fato | Fonte |
|---|---|---|
| ≥ fev./2024 | Os Consumer Terms (§3.7) já proíbem acesso automatizado fora de ferramentas sancionadas, exceto via API key | The Register 2026-02-20 |
| jan./2026 | Enforcement contra harnesses que imitavam o Claude Code. Thariq Shihipar (Anthropic) disse que harnesses de terceiros com assinatura violam os ToS (falta a telemetria do Claude Code) | The Register |
| 2026-02-19 | O OpenCode remove o suporte a chaves Claude Pro/Max citando "anthropic legal requests" | The Register |
| ~2026-02-20 | Página de compliance revisada: tokens OAuth Free/Pro/Max em qualquer outro produto, incluindo o Agent SDK, violam os Consumer Terms | The Register; `code.claude.com/docs/en/legal-and-compliance` |
| **2026-04-04 12:00 PT** | Limites da assinatura **deixam de cobrir "third-party harnesses"** (OpenClaw primeiro; "todos" depois). Alternativas: extra usage pago à parte ou API key. Boris Cherny (head do Claude Code) cita restrições de engenharia | TechCrunch, The Register, Axios |
| mai.–jun./2026 | Anunciado um "crédito Agent SDK". **Pausado em 2026-06-15**: Agent SDK, `claude -p` e uso por apps de terceiros continuam saindo dos limites da assinatura | support.claude.com 15036540 |
| **2026-10-07** | Max, Ultra e Team passam a incluir **créditos mensais de API** que cobrem Claude API, Managed Agents, Agent SDK e `claude -p` **com API key** de uma organização Console vinculada. Logado no plano, nada muda | support.claude.com 15036540 e 17154008 |
| 2026-11-18 | Claude Code CLI na **2.1.327** (npm); Agent SDK `@anthropic-ai/claude-agent-sdk` na 0.3.327. O learnharness exige ≥ 2.1.259 | npm |

### 3.2 O texto oficial em vigor (parafraseado)

Fonte: `code.claude.com/docs/en/legal-and-compliance`, seções "Authentication and credential use" e "Can customers offer Claude Code in their products?".

- **OAuth** serve exclusivamente a quem compra planos Free, Pro, Max, Ultra, Team e Enterprise, para o **uso ordinário do Claude Code e dos apps nativos da Anthropic**.
- **Desenvolvedores** de produtos que interagem com o Claude, **inclusive com o Agent SDK**, devem usar **API key** (Console ou nuvem suportada).
- A Anthropic **não permite** que terceiros:
  - ofereçam login claude.ai em seus apps;
  - roteiem requisições por credenciais Free/Pro/Max/Ultra em nome dos usuários;
  - **coletem, armazenem ou intermediem** credenciais ou tokens de sessão claude.ai. O login tem de completar no fluxo da própria Anthropic.
- **Ressalva explícita:** isso **não impede** o usuário final de logar no **binário não modificado do Claude Code** com a própria assinatura, inclusive quando uma plataforma hospeda o Claude Code.
- **Embutir ou pré-instalar o Claude Code em produtos** exige os Commercial Terms e três condições:
  - binário **não modificado**;
  - não remover métodos de auth;
  - cada usuário autenticado com a **própria** credencial (API key, assinatura ou nuvem), sem revenda nem intermediação.
- **Marca:** pode-se dizer em texto simples que o produto "roda o Claude Code", mas não usar o nome nem o logo como nome de feature.
- Os limites anunciados para Pro/Max/Ultra pressupõem **uso ordinário e individual** do Claude Code e do Agent SDK. A Anthropic pode aplicar medidas **sem aviso prévio**.
- **Agent SDK overview:** salvo aprovação prévia, terceiros não podem oferecer login claude.ai nem os rate limits do claude.ai em seus produtos.
- **`claude setup-token`** gera um token OAuth de **1 ano** (`CLAUDE_CODE_OAUTH_TOKEN`, escopo `user:inference`) para CI e scripts **do próprio usuário**.

### 3.3 O que é permitido e o que é proibido, para o nosso app

| Ação | Status |
|---|---|
| Implementar OAuth claude.ai no app (ex.: `models.login("anthropic","oauth")` do pi-ai, que usa `claude.ai/oauth/authorize` + `platform.claude.com/v1/oauth/token`) | **Proibido** |
| Ler `~/.claude/.credentials.json`/keychain, pedir ao usuário um `setup-token` e guardá-lo, ou injetar `CLAUDE_CODE_OAUTH_TOKEN` no processo | **Proibido** (coletar, armazenar ou intermediar) |
| Mandar requisições à `api.anthropic.com` com token OAuth da assinatura | **Proibido** |
| API key do usuário (BYOK), incluindo os créditos mensais Max/Ultra/Team | **Permitido** |
| Acionar o `claude` que o usuário instalou e logou por conta própria, sem tocar em credenciais e sem modificar o binário | **Permitido pelo texto** (ressalva do binário não modificado + `claude -p` consome o plano). Risco residual: "uso não ordinário" e a política de 2026-04-04 sobre "harnesses de terceiros" |
| Empacotar ou pré-instalar o Claude Code no instalador do app | Exige Commercial Terms → **não fazer**. O usuário instala |
| Usar "Claude Code" no nome de feature ou logo | Não. Só texto simples ("Usar o Claude Code instalado") |

### 3.4 Caminho compliant recomendado

1. **Padrão: Anthropic API key** (`ANTHROPIC_API_KEY`, já suportado em `src/core/auth-keys.ts`).
   - No onboarding, explicar que **Max dá US$100/mês, Ultra US$200/mês e Team até US$500/mês** em créditos de API para resgatar.
   - Fluxo de resgate: claude.ai → Settings → Billing → "API credits" → "Link organization". Exige 7 dias no plano. Os créditos expiram no fim do ciclo. Free, Pro e Enterprise não são elegíveis.
   - Com a key, temos `GET /v1/models` rico (§5.1) e custo em USD exato.
2. **Opcional: "CLI externo: Claude Code"**, como no learnharness (`src/agent/claude-code/*`, `docs/claude-code.md`), mantendo as salvaguardas atuais:
   - **off por padrão**, opt-in no app inteiro;
   - binário encontrado no PATH (no Windows, só `claude.exe`);
   - cada filho roda sem shell, em diretório temporário vazio, com `--tools ""`, `--strict-mcp-config` e as tools do app via MCP loopback com token;
   - `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`;
   - `externalCliEnv()` remove do ambiente do filho as chaves que o app injetou;
   - nenhuma tela de login própria: o usuário faz `claude` → `/login` fora do app.
   - **Adicionar:**
     - (a) ler o `account` da resposta de `initialize` (§3.5) e mostrar "via assinatura (Max)" ou "via API key". Hoje `docs/claude-code.md` admite não garantir uso só da assinatura, porque um `ANTHROPIC_API_KEY` no ambiente tem precedência;
     - (b) aviso curto na UI: uso intensivo ou automatizado pode ser restringido; para uso pesado, use API key;
     - (c) jobs em background (geração de grafo, flashcards em lote) **nunca** pelo Claude Code; só API key ou ChatGPT com consentimento de background.

### 3.5 Detalhes técnicos úteis (Claude Code)

- **Ordem de credenciais do CLI** (`code.claude.com/docs/en/authentication`):
  1. nuvem (`CLAUDE_CODE_USE_BEDROCK`, `…_VERTEX`, `…_FOUNDRY`);
  2. … `ANTHROPIC_API_KEY`/`apiKeyHelper` …;
  3. `CLAUDE_CODE_OAUTH_TOKEN`;
  4. … login `/login`, que é o padrão para assinantes.
  - Com `ANTHROPIC_API_KEY` definido, o CLI usa a key (depois de aprovada), e `/status` mostra qual credencial está ativa.
- **Modelos dinâmicos sem hardcode:** o protocolo de controle `stream-json` responde ao `initialize` com `models: ModelInfo[]` e `account: AccountInfo`. É o mesmo que o Agent SDK expõe como `initializationResult()`/`supportedModels()`/`accountInfo()`.
  - `ModelInfo` traz `value`, `resolvedModel` (ex.: o alias `sonnet` → `claude-sonnet-5-5`, CLI ≥ 2.1.197), `displayName`, `description`, `supportsEffort`, `supportedEffortLevels[]`, `supportsAdaptiveThinking` e `supportsFastMode`.
  - `AccountInfo` traz `email`, `organization`, `subscriptionType`, `tokenSource` e `apiKeySource`.
  - O learnharness **já envia** `initialize` em `src/agent/claude-code/context-window.ts` (para `get_context_usage`), mas **hardcoda** `opus/sonnet/haiku` em `src/agent/claude-code/provider.ts` (`CLAUDE_CODE_MODELS`). Basta capturar `response.models` e `response.account` desse `initialize` (sonda curta, cache por versão do CLI).
- **Limites e erros:**
  - o stream do CLI emite eventos de rate limit;
  - `errorCode:"credits_required"` indica franquia esgotada (CLI ≥ 2.1.181);
  - `rate_limits` e `extra_usage` aparecem quando o token tem `user:profile`.
  - Use isso para mostrar "limite do plano atingido" sem adivinhar.

---

## 4. Outros provedores

### 4.1 GitHub Copilot

- **Oficial para apps: Copilot SDK** (`github/copilot-sdk` → pacote `@microsoft/copilot-sdk`, MIT, v2.0.1). Métodos de auth:
  - (1) usuário logado no Copilot CLI (keychain);
  - (2) **GitHub OAuth App próprio**: o app recebe o token do usuário (`gho_`/`ghu_`) e passa ao SDK com `useLoggedInUser:false`;
  - (3) variáveis de ambiente;
  - (4) server-to-server, com billing da organização;
  - (5) BYOK.
  - (1)–(3) **exigem assinatura Copilot** do usuário, e o uso cai no plano dele.
  - **Modelos dinâmicos:** `client.listModels()` / `client.rpc.models.list()`.
- **Parceria formal com o OpenCode** (changelog de 2026-01-16): Pro, Pro+, Business e Enterprise via `/connect` + device login.
- **Billing:** desde **2026-06-01**, os premium requests foram substituídos por **GitHub AI Credits** (1 crédito = US$0,01, consumo por token ao preço de API). Pro US$10 inclui US$10 em créditos e Pro+ US$39 inclui US$39 (changelog de 2026-04-27 e cobertura secundária). Completions inline não consomem créditos.
- **Caminho do learnharness hoje:** OAuth do pi-ai (`auth/oauth/github-copilot.ts`).
  - Device flow em `github.com/login/device/code` com o **client id do VS Code Copilot** (`Iv1.b507a08c87ecfe98`, ofuscado em base64 no pi);
  - troca em `api.github.com/copilot_internal/v2/token`;
  - base `api.individual.githubcopilot.com` (ou `copilot-api.<enterprise>`).
  - **Não é a rota documentada para terceiros.** Funciona, mas é amarela.
- **Recomendação:** manter como opt-in "experimental". Se Copilot virar requisito, migrar para o Copilot SDK com um OAuth App nosso (P3).

### 4.2 Google Gemini

- **Gemini CLI ToS (geminicli.com):** acessar diretamente os serviços por trás do Gemini CLI (ex.: Code Assist) com software de terceiros, por exemplo usando o OAuth do Gemini CLI em outra ferramenta, **viola os termos** e pode levar a **suspensão ou encerramento** da conta.
- Relatos (fórum oficial e issues) indicam o mesmo para o Antigravity, com bans a partir de fev.–mar./2026 que derrubaram também o acesso ao Gemini CLI e ao Code Assist (backend de abuso compartilhado). O pi-ai **removeu** os providers `google-gemini-cli`/`google-antigravity` da pasta de OAuth.
- **Google AI plans** (`ai.google.dev/gemini-api/docs/google-ai-plans`): os benefícios de AI Pro/Ultra para devs valem **só na UI do AI Studio**. API key e apps externos são cobrados à parte. Assinantes com Cloud Billing ganham **créditos Cloud mensais** pelo Google Developer Program, aplicáveis à Gemini API (relatos de ~US$10/mês no Pro).
- **Recomendação:** apenas `GEMINI_API_KEY` (já em `AUTH_PROVIDER_KEYS`). Nunca OAuth de produto Google.
- **Modelos:** `GET https://generativelanguage.googleapis.com/v1beta/models` (campos `name`, `displayName`, `inputTokenLimit`, `outputTokenLimit`, `supportedGenerationMethods`, `thinking`).

### 4.3 xAI (Grok / SuperGrok / X Premium)

- **Oficial:** post da xAI de **2026-05-21** ("Use Grok in OpenCode"): SuperGrok ou X Premium funcionam no OpenCode via "xAI Grok OAuth" (navegador ou headless), com "mais integrações open-source em breve".
- Cobertura secundária cita Hermes, OpenClaw, Kilo e T3 Code. A conta precisa de assinatura ativa (Free falha).
- **Técnica (pi-ai `auth/oauth/xai.ts`):** device code em `https://auth.x.ai/oauth2/device/code` e `…/oauth2/token`, client `b1a00492-073a-47ea-816f-4c329264a828` (o do Grok CLI), escopos `openid profile email offline_access grok-cli:access api:access`. Os refresh tokens **rotacionam** (importar as credenciais do Grok CLI quebra o login do CLI).
- O learnharness já expõe "Grok" via `electron/subscriptions.cjs` com endpoint fixo `https://api.x.ai/v1`.
- **Não encontrei termos nem programa público para apps arbitrários** → **amarelo**. Manter como opt-in "experimental" e revalidar a cada versão.

### 4.4 Kimi (Moonshot)

- **Kimi Code membership:** API key de membership para `https://api.kimi.com/coding/v1` (modelo `kimi-for-coding`), documentada para Claude Code, Roo e OpenCode. O pi-ai tem device flow em `auth.kimi.com` (client `17e5f671-…`).
- **Termos:** o uso de programação deve ficar no Kimi CLI e em **agentes de programação permitidos**, e **alterar o User-Agent** é violação.
- Para um **app de estudo** (não é agente de código), isso é no mínimo ambíguo → usar a **Moonshot Open Platform API key** (`MOONSHOT_API_KEY`, já na tabela).

### 4.5 Qwen

- O **OAuth gratuito do Qwen Code foi encerrado em 2026-04-15** (doc `QwenLM/qwen-code/docs/users/configuration/auth.md`).
- Alternativas: Alibaba Cloud Coding Plan ou API key. O learnharness já tem `qwen-token-plan*` como API key.

### 4.6 OpenRouter (verde, recomendado)

- **OAuth PKCE oficial** (`openrouter.ai/docs/use-cases/oauth-pkce`): o usuário autoriza o app e o app recebe uma **API key do próprio usuário** (cobrança nos créditos dele).
  1. Authorize: `https://openrouter.ai/auth?callback_url=<url>&code_challenge=<S256>&code_challenge_method=S256`.
  2. Troca: `POST https://openrouter.ai/api/v1/auth/keys`.
- **Localhost em qualquer porta** é suportado. App local ganha título fixo `localhost:<porta>`; para atribuição use URL pública (site ou repo).
- Modo headless: sem `callback_url`, o usuário cola o código (uso único, 10 min).
- Parâmetros úteis:
  - `key_label`;
  - `limit` (teto em US$ preenchido; ótimo para "orçamento de estudo");
  - `expiration` (`1-day`…`never`);
  - `state`, `workspace_id`.
- O pi-ai **1.4.0 (instalado) já tem** `auth/oauth/openrouter.js`. A credencial vem com `refresh:""` e `expires: MAX_SAFE_INTEGER`, então o `validateCredential` de `electron/subscription-store.cjs` (exige `refresh` não vazio) precisaria de um caso especial.

### 4.7 Meta (nota)

O pi-ai tem `auth/oauth/meta.ts`: device flow em `auth.meta.com` com o client do "Muse Code CLI", trocando por uma API key de ~1 dia. Também reutiliza o client de um CLI oficial → amarelo. Fora de escopo.

---

## 5. Listagem dinâmica de modelos (sem hardcode)

### 5.1 Endpoints nativos (entitlement)

| Fonte | Endpoint | Campos úteis | Preço? | Observações |
|---|---|---|---|---|
| OpenAI API key | `GET https://api.openai.com/v1/models` | `id`, `created`, `owned_by`, `shutdown_date` | Não | Lista inclui embeddings, imagem etc. Precisa de metadados externos para contexto e capacidades |
| **ChatGPT plano (SIWC)** | `GET https://api.openai.com/v1/models` (Bearer SIWC) | `models[]`: `slug`, `display_name`, `visibility`, `supported_in_api`, `context_window`, `input_modalities`, `supported_reasoning_levels`, (`priority`, `upgrade`…) | Não (plano) | **Por conta/plano.** Manter a ordem do servidor. Atualizar ao trocar de conta |
| Codex backend (legado) | `GET https://chatgpt.com/backend-api/codex/models?client_version=` | `ModelInfo` completo (§2.3.3) | Não | ETag. A versão gateia modelos |
| **Anthropic API key** | `GET https://api.anthropic.com/v1/models?limit=1000` (header `anthropic-version`; paginação `after_id`/`has_more`; filtro `lifecycle=active,deprecated,retired`) | `id`, `display_name`, `created_at`, `lifecycle`, `deprecated_at`, `retires_at`, `line` (`haiku`/`sonnet`/`opus`/`fable`/`mythos`), `max_input_tokens`, `max_tokens`, `capabilities` (`effort.{low…max,xhigh}`, `thinking.types.{adaptive,enabled,disabled,between_tools}`, `image_input`, `pdf_input`, `structured_outputs`, `context_management`, `server_tools`, `batch`, `citations`, `code_execution`) | Não | O mais rico. Mais novos primeiro. **Use `line` em vez de parsear o id** |
| **Claude Code CLI** | controle `initialize` (stream-json) / Agent SDK `supportedModels()` | `value`, `resolvedModel`, `displayName`, `supportedEffortLevels`, `supportsAdaptiveThinking`, `supportsFastMode`; `account.subscriptionType`/`tokenSource`/`apiKeySource` | Não (CLI) | Aliases resolvidos pela conta |
| Gemini API key | `GET https://generativelanguage.googleapis.com/v1beta/models` | `name`, `displayName`, `inputTokenLimit`, `outputTokenLimit`, `supportedGenerationMethods`, `thinking` | Não | Filtrar `generateContent` |
| OpenRouter | `GET https://openrouter.ai/api/v1/models` (**público**, ~940 KB, 478 modelos em 2026-11-18) | `id`, `canonical_slug`, `name`, `context_length`, `architecture.input_modalities`, `pricing.{prompt,completion,input_cache_read,input_cache_write,…,overrides[]}` (USD **por token**, string), `top_provider.max_completion_tokens`, `supported_parameters`, `reasoning.{supported_efforts,default_effort}`, `expiration_date` | **Sim** | Também serve de fonte de metadados para modelos de outros provedores (`openai/…`, `anthropic/…`) |
| Copilot | SDK `client.listModels()`; via pi: `credential.availableModelIds` | `id`, `provider{id,kind,label}`, suporte a reasoning effort | Não (AI Credits) | — |
| Custom OpenAI-compatible | `GET <base>/models` | já implementado em `src/server/custom-provider.ts` | — | — |

### 5.2 Catálogos abertos de metadados (preço, contexto, capacidades)

| Catálogo | Licença | Tamanho/escopo (2026-11-18) | Campos | Prós | Contras |
|---|---|---|---|---|---|
| **models.dev** (`anomalyco/models.dev`, ex-`sst`) — `https://models.dev/api.json` | **MIT** | 6,7 MB; **324 providers** (anthropic 18 modelos, openai 53, openrouter 382, github-copilot 39, xai, google, moonshotai, kimi-code-plan…) | por provider: `id`, `env[]`, `npm`, `api`, `doc`; por modelo: `id`, `name`, `family`, `attachment`, `reasoning`, `reasoning_options[{type:"effort",values}]`, `tool_call`, `structured_output`, `temperature`, `knowledge`, `release_date`, `last_updated`, `modalities.{input,output}`, `open_weights`, `limit.{context,output}`, `cost.{input,output,cache_read,cache_write}` (**USD/1M**), `experimental.modes`, `canonical_model_id` | Comunitário e muito atualizado (usado pelo OpenCode). Esquema por provider casa com o nosso modelo. Também `models.json` (só modelo) e `catalog.json`. Logos em `/logos/{provider}.svg` | Grande: reduzir aos providers usados. `openai-codex` só no v2 com `?include=openai-codex` (dados de assinatura opt-in). Sem garantia de SLA |
| **LiteLLM** `model_prices_and_context_window.json` (`BerriAI/litellm`) | MIT (o repo marca NOASSERTION por causa da pasta `enterprise/`; o JSON fica fora dela) | 4,3 MB; 6.222 chaves, incluindo `chatgpt/*` e `github_copilot/*` | `input_cost_per_token`, `output_cost_per_token`, `cache_read_input_token_cost`, `cache_creation_input_token_cost` (+ variantes `_above_1hr`, `_above_272k`, `_batches`, `_priority`), `max_input_tokens`, `max_output_tokens`, `mode`, `supports_*` (vision, reasoning, function_calling, prompt_caching, web_search…), `deprecation_date` | Detalhe de preço por faixa e tier | Chaves heterogêneas (`provider/id` ou `id`). Arquivo grande |
| **OpenRouter `/api/v1/models`** | Termos do OpenRouter (dados públicos da API) | 478 modelos | §5.1 | Preço real de roteamento, `overrides` por faixa de prompt, `reasoning.supported_efforts` | Preço do OpenRouter ≠ preço direto do provedor; ids com prefixo |
| **tokenlens** (`xn1cklas/tokenlens`) | MIT | npm `tokenlens@1.3.1`; 2.0.0-alpha.3 de 2025-10-04; repo com último push em 2026-07-02 | registry + helpers `getContext`, `getTokenCosts`, compactação | API TS pronta para contexto e custo | **Desatualizado** (sem release em 2026). Melhor consumir models.dev direto |
| **pi-ai gerado** (`providers/*.models.ts`) | MIT | estático por versão | `cost`, `contextWindow`, `maxTokens`, `thinkingLevelMap` | Já integrado ao learnharness | Só atualiza com bump do pi-ai (o fork está fixo em 1.4.0; a atual é 1.5.2) |

### 5.3 Princípios ("nunca hardcodar")

1. **Entitlement ≠ metadados.**
   - A lista de modelos selecionáveis vem **sempre** da fonte da conexão (§5.1).
   - Catálogos externos só **enriquecem**: nunca adicionam um modelo que a conta não lista e nunca escondem um que ela lista.
2. **Modelo desconhecido é exibido, não descartado.** Se não há metadados, mostrar com o selo "metadados estimados", contexto conservador e preço "desconhecido". Hoje o learnharness descarta, o OpenCode exibe.
3. **Ordem e papéis vêm do servidor quando possível:**
   - SIWC/Codex: `priority` e `upgrade`;
   - Anthropic: `line` + `created_at` + `lifecycle`;
   - OpenAI key: `shutdown_date`.
4. **Nenhum ID literal no código de produto.** IDs só aparecem como:
   - (a) dados vindos da rede ou do CLI;
   - (b) pins do usuário salvos nas configurações;
   - (c) fixtures de teste.
   - Até o "default" é uma **regra** ("o primeiro por `priority` com reasoning"), não um ID.
5. **Falha fechada para entitlement, aberta para metadados.**
   - Sem catálogo da conta, os modelos dessa conexão não são selecionáveis (como já faz `chatGPTScope`).
   - Sem metadados, o modelo continua selecionável com estimativa.

### 5.4 Arquitetura proposta (TypeScript, encaixa no learnharness)

Diretório sugerido: `src/server/model-registry/` (o núcleo novo), consumido por `src/server/model-catalog.ts`.

```ts
// src/server/model-registry/types.ts
export type BillingKind = "plan" | "api" | "cli" | "local";   // plan = assinatura via SIWC/Copilot/xAI
export interface EntitlementEntry {
  connection: string;           // "chatgpt:<accountId>", "anthropic-key", "claude-code", "openrouter-key"...
  provider: string;             // id lógico no app ("chatgpt", "anthropic", "claude-code", ...)
  id: string;                   // o que vai no request (slug/alias)
  displayName?: string;
  order?: number;               // priority do servidor ou posição na lista
  hidden?: boolean;             // visibility === "hide"
  native?: {                    // tudo opcional: só o que a fonte trouxe
    contextWindow?: number; maxOutput?: number;
    input?: ("text" | "image" | "pdf" | "file")[];
    reasoningLevels?: string[]; defaultReasoning?: string;
    lifecycle?: "active" | "deprecated" | "retired"; retiresAt?: string; shutdownDate?: string;
    upgradeTo?: string;         // Codex `upgrade`
    line?: string;              // Anthropic `line`
    resolvedModel?: string;     // Claude Code alias -> id real
    supportedInApi?: boolean;
  };
}
export interface ModelMetadata {
  contextWindow?: number; maxOutput?: number; reasoning?: boolean; toolCall?: boolean;
  input?: string[]; cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number }; // USD / 1M
  knowledge?: string; releaseDate?: string;
  source: "native" | "models.dev" | "litellm" | "openrouter" | "pi" | "estimated";
}
export interface CatalogModel extends EntitlementEntry { meta: ModelMetadata; billing: BillingKind; estimated: boolean }

export interface EntitlementSource {
  connection: string;
  billing: BillingKind;
  list(signal: AbortSignal, prev?: { etag?: string }): Promise<{ entries: EntitlementEntry[]; etag?: string } | "not-modified">;
}
```

**Fontes (uma por conexão):**
- `chatgptPlanSource`: reaproveita o `models()` de `electron/chatgpt.cjs`, mas devolve os campos completos.
- `openaiKeySource`, `anthropicKeySource` (com paginação), `geminiKeySource`, `openrouterSource`.
- `claudeCodeSource`: `initialize` → `models`/`account`.
- `copilotSource`: `availableModelIds` ou SDK.
- `customSource`: já existe.

**Resolução de metadados (`resolveMetadata(entry)`), em cascata e campo a campo (o primeiro que tiver o campo vence):**
1. `entry.native`;
2. models.dev `api[providerMap(entry.provider)].models[entry.native?.resolvedModel ?? entry.id]`, com `providerMap`: `chatgpt→openai`, `claude-code→anthropic`, `github-copilot→github-copilot`, `xai-subscription→xai`;
3. models.dev por `canonical_model_id`, ou pelo id sem sufixo de data (`-YYYYMMDD`);
4. LiteLLM `${litellmProvider}/${id}` ou `id`;
5. OpenRouter `${vendor}/${id}`;
6. catálogo do pi-ai (o que o learnharness usa hoje);
7. `estimated`: `contextWindow = min(conhecidos da mesma família) ?? 128_000`, `maxOutput = 8_192`, `reasoning = !!entry.native?.reasoningLevels?.length`, `estimated: true`.

**Cache (arquivos em `userData/cache/`, escrita atômica):**

| Item | Chave | Fresco | *Stale* aceitável | Validação |
|---|---|---|---|---|
| Entitlement por conexão | `catalog/<provider>-<sha256(accountId)>.json` | **5 min** (como o Codex `DEFAULT_MODEL_CACHE_TTL=300s`) | **24 h** (como o DeepTutor), com badge "lista possivelmente desatualizada" | ETag/`If-None-Match` quando houver (Codex). Hash do conteúdo nos demais |
| Metadados (models.dev reduzido) | `model-metadata.json` (só providers configurados + `openai`, `anthropic`) | **24 h** | 30 dias | `ETag`/`Last-Modified` do `models.dev/api.json` |
| LiteLLM/OpenRouter | `litellm-prices.json`, `openrouter-models.json` | 24 h | 30 dias | idem. Só baixar se o models.dev não cobrir |
| Snapshot embutido | `resources/model-metadata.snapshot.json` (gerado no build por `scripts/snapshot-model-metadata.mjs` a partir do models.dev, com atribuição MIT) | — | — | Usado só se não houver rede **e** cache. **Nunca** como entitlement |

**Gatilhos de refresh:**
1. boot do app;
2. login, troca de conta ou reconexão (obrigatório: a doc SIWC manda atualizar ao trocar de conta);
3. abrir o seletor de modelo com cache vencido (refresh em background e devolve o *stale*);
4. **erro de modelo** (404 `model_not_found`, `subscription_sharing_unsupported_capability` com `param` = modelo, alias inválido no CLI): invalidar a conexão e re-listar uma vez;
5. botão "Atualizar modelos";
6. a cada 60 min com o app aberto (barato).
- Serializar refresh por conexão e descartar respostas obsoletas por número de sequência. O learnharness já tem `catalogSequence` e `authorityRevision`.

**Papéis sem ID** (substitui "strong/cheap/vision" com pin):

```ts
type RoleSpec =
  | { kind: "pinned"; provider: string; id: string; thinkingLevel?: string }
  | { kind: "auto"; prefer: "strongest" | "cheapest" | "fastest"; connection?: string;
      require?: { reasoning?: true; input?: string[]; minContext?: number; billing?: BillingKind[] } };
```

- **`strongest`:**
  - conexões com `order` do servidor (SIWC/Codex): o 1º por `priority` que satisfaz `require`;
  - Anthropic: `line` com rank `mythos > fable > opus > sonnet > haiku`, depois o `created_at` mais novo, só `active`. **O rank vem de config editável**, não do código;
  - genérico: o maior `meta.cost.output` (proxy) entre os não estimados.
- **`cheapest`:** o menor `meta.cost.input + meta.cost.output`. Em `billing:"plan"` o preço é 0, então usar `cost` de metadados como proxy de peso na franquia (para ChatGPT a tabela de créditos da §2.2.12 tem a mesma ordem).
- A UI mostra "Automático → GPT-x (resolvido)" e permite pin.
- **Por domínio** (Inglês, Eletrônica): `domains[domainId].roles` sobrepõe o global. Ver `lh-agent-providers.md` §3.3 item 3.
- **Depreciação e migração:**
  - pin some do entitlement → se `native.upgradeTo` existe (Codex) ou há modelo `active` da mesma `line` (Anthropic), migrar com aviso ("Modelo X foi substituído por Y");
  - senão, marcar o slot como indisponível e cair no `auto` equivalente;
  - mostrar `shutdown_date`/`retires_at` com antecedência.

**Testes** (seguir o padrão `tests/*.test.ts` do learnharness):
- fixtures JSON de cada endpoint da §5.1 (SIWC `models[]`, Anthropic `data[]` paginado, OpenAI `data[]`, OpenRouter, `initialize` do CLI);
- testes de que (1) modelo desconhecido aparece com `estimated:true`, (2) `visibility:"hide"`/`supported_in_api:false` somem, (3) o pin migra por `upgrade`, (4) cache *stale* é servido sem rede, (5) **nenhum literal de modelo** no código fonte (lint por regex `gpt-|claude-|gemini-` fora de `tests/` e `fixtures/`).

### 5.5 Estatísticas de uso (objetivo 6 do produto)

- Registrar por evento: `{day, domain, connection, provider, model, billing, inputTokens, cachedTokens, outputTokens, reasoningTokens?, durationMs}`.
  - Responses/SIWC: `usage` do `response.completed`;
  - Claude Code: usage do stream;
  - Anthropic API: `usage`.
- **USD só quando `billing === "api"`** (via `meta.cost`). Para `plan` e `cli`: mostrar tokens e, opcionalmente, "equivalente estimado", sempre rotulado.
- Para ChatGPT, linkar **"Manage usage"** (`chatgpt.com/settings/usage`), porque o app **não** enxerga a franquia restante. Para Claude Code, usar os eventos de rate limit e `credits_required`.

---

## 6. Recomendação exata para o nosso app (com arquivos)

### P0: conformidade e base (antes de qualquer feature)

1. **Manter o SIWC do learnharness** (`electron/chatgpt.cjs`) como **o** caminho OpenAI por assinatura.
   - Trocar `agent_name_hint: "LearnHarness"` (linha ~339) pelo nome do fork, igual em todas as instalações, e manter `clientInfo.name` igual se um dia usarmos o Codex app-server.
   - Manter o host `urn:uuid` (ou migrar para JWK thumbprint, RFC 9278, gerando o par de chaves uma vez).
2. **Cifrar credenciais** de `chatgpt-credentials.json` e `<provider>-credentials.json` com `electron.safeStorage.encryptString` (DPAPI no Windows, Keychain no macOS, libsecret no Linux). Manter o JSON só como envelope: `{version, ciphertext}`. Isso afeta `fileStore` em `electron/chatgpt.cjs` e `electron/subscription-store.cjs`.
3. **Anthropic:**
   - **nunca** expor `models.login("anthropic","oauth")` do pi-ai, e adicionar um teste que falha se o provider `anthropic` aparecer com `auth.oauth` na UI;
   - manter o Claude Code CLI **off por padrão**;
   - adicionar o texto de aviso (§3.4) e o "billing source" lido do `initialize.account`;
   - no onboarding, destacar a **API key** com a dica dos créditos mensais Max/Ultra/Team.
4. **Google:** só API key. Documentar que o OAuth de Gemini CLI/Antigravity é proibido.
5. **Copilot/xAI:** manter em `electron/subscriptions.cjs`, mas com rótulo "experimental (não oficial)" e um texto de 1 linha sobre o risco. O xAI é promovido pela própria xAI para integrações OSS; o Copilot oficial é o SDK.
6. **UI/UX SIWC:**
   - rótulo "Continue with ChatGPT" (pode ficar em inglês, pois é exigência de branding);
   - modal no 1º uso;
   - badge "Usando plano ChatGPT · Gerenciar uso" perto do seletor de modelo;
   - modal de limite com "Gerenciar uso" como ação primária.

### P1: catálogo dinâmico

7. Criar `src/server/model-registry/` (§5.4) e plugar em `modelCatalog()`/`catalogContextLimits()` (`src/server/model-catalog.ts`).
8. **ChatGPT:**
   - em `electron/chatgpt.cjs` `models()`, devolver também `supported_in_api`, `context_window`, `input_modalities`, `supported_reasoning_levels` e `priority`;
   - em `src/agent/chatgpt-bridge.ts` `refreshChatGPTModels`, **parar de descartar** slugs desconhecidos: sintetizar `Model<"openai-responses">` com `contextWindow` do servidor, `input` das modalidades, `reasoning` e níveis do servidor (o mesmo padrão de `deriveModels` do OpenCode).
9. **Claude Code:** substituir `CLAUDE_CODE_MODELS` fixo (`src/agent/claude-code/provider.ts`) por `initialize.models` (cache por versão do CLI + sonda curta). Fallback **sem IDs**: se a sonda falhar, a conexão fica "indisponível", não "opus/sonnet/haiku".
10. **API keys:**
    - `anthropicKeySource` (`/v1/models`, paginado, `lifecycle` ativo);
    - `openaiKeySource` (`/v1/models` + filtro por metadados `mode=chat/responses`);
    - `geminiKeySource`;
    - o catálogo estático do pi-ai passa a ser só a fonte 6 de metadados.
11. **Metadados:** `model-metadata.json` a partir de `https://models.dev/api.json` (cache diário, reduzido) + snapshot no build. LiteLLM e OpenRouter só para lacunas.
12. **Erros SIWC estruturados:** em `src/agent/chatgpt-stream.ts`, ler `error.code`/`error.param` (body e eventos `response.failed`) e mapear pela tabela da §2.2.9, deixando a regex só como último recurso.

### P2: BYOK sem atrito e stats

13. **OpenRouter OAuth PKCE** como nova conexão: reutilizar `auth/oauth/openrouter.js` do pi-ai e tratar `refresh:""` em `validateCredential`. Passar `limit` (orçamento) e `key_label` com o nome do app.
14. Estatísticas por modelo e por domínio (§5.5), com "billing kind" explícito.

### P3: opcionais

15. Copilot via `@microsoft/copilot-sdk` com GitHub OAuth App próprio (só se houver demanda).
16. Revisitar a cada trimestre: SIWC (Free elegível? `force_reconsent`?), política da Anthropic (programa "previously approved"?) e programa de integrações da xAI.

### Não fazer

- Usar o client do Codex CLI (`app_EMoamEEZ73f0CkXaXp7hrann`) ou `chatgpt.com/backend-api`.
- Ler `~/.codex/auth.json`, `~/.claude/*` ou credenciais do Grok CLI.
- Cair silenciosamente de assinatura para API key.
- Empacotar o binário do Claude Code.
- Usar o OAuth de Gemini CLI/Antigravity, ou a chave Kimi Code fora de coding.

---

## 7. Riscos e perguntas em aberto

1. **SIWC é "preview":** campos, tools e elegibilidade podem mudar. Ainda não foi feito deploy de `force_reconsent`. "Open-source tools remain available to all ChatGPT users" é ambíguo para o plano Free.
2. **Distribuição comercial:** se o fork virar pago ou hospedado, o SIWC exige o formulário de interesse, e a Anthropic exige os Commercial Terms se o Claude Code for embarcado.
3. **Claude Code via app de terceiros:** o texto permite o uso do binário não modificado pelo usuário. Mas a política de 2026-04-04 mira "third-party harnesses", e a Anthropic pode agir "sem aviso". O learnharness se declara "not a provider-policy certification". Não encontrei (o orçamento de busca acabou) nenhum programa "Sign in with Claude" ou exceção "previously approved" com processo público.
4. **xAI e Copilot (via pi-ai)** reutilizam client ids de CLIs oficiais. Podem ser bloqueados a qualquer momento.
5. **Metadados comunitários** (models.dev/LiteLLM) podem errar preço ou contexto. Mostrar a fonte e permitir override manual.
6. **Windows:** o callback loopback precisa de porta livre e o firewall pode perguntar. Usar `127.0.0.1` (não `localhost`) e porta 0 (aleatória), como já é feito.

---

## 8. Fontes (URLs)

**OpenAI**
- SIWC (índice e doc completa): https://developers.openai.com/siwc/llms.txt · https://developers.openai.com/siwc/llms-full.txt
- Overview / Registro / Sessões / Modelos / Limitações / Erros / Tokens / UI: https://developers.openai.com/siwc/token-sharing-open-source · …/sign-in · …/profiles-and-sessions · …/models-and-inference · …/preview-limitations · …/errors-and-recovery · …/token-reference · https://developers.openai.com/siwc/ui-ux-guidelines · …/codex-app-server
- Cookbook: https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt
- Help Center: https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt · https://help.openai.com/en/articles/20001542
- Parceiros: https://learn.chatgpt.com/docs/sign-in-with-chatgpt
- Preços/limites Codex+Work: https://learn.chatgpt.com/docs/pricing
- Codex auth: https://developers.openai.com/codex/auth
- `GET /v1/models`: https://developers.openai.com/api/reference/resources/models/methods/list
- DevDay 2026 recap: https://openai.com/index/devday-2026-recap/
- Código Codex: https://github.com/openai/codex (`codex-rs/login/src/server.rs`, `codex-rs/login/src/auth/manager.rs`, `codex-rs/codex-api/src/endpoint/models.rs`, `codex-rs/models-manager/src/manager.rs`, `codex-rs/models-manager/models.json`)
- Formulário: https://openai.com/form/sign-in-with-chatgpt-interest/

**Anthropic**
- https://code.claude.com/docs/en/legal-and-compliance
- https://code.claude.com/docs/en/authentication
- https://code.claude.com/docs/en/agent-sdk/overview · https://code.claude.com/docs/en/agent-sdk/typescript
- https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-ultra-and-team-plans
- https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers
- https://platform.claude.com/docs/en/api/models/list
- Contexto (secundário): https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546 · https://techcrunch.com/2026/04/04/anthropic-says-claude-code-subscribers-will-need-to-pay-extra-for-openclaw-support/ · https://www.theregister.com/software/2026/04/06/anthropic-closes-door-on-subscription-use-of-openclaw/5222854 · https://axios.com/2026/04/06/anthropic-openclaw-subscription-openai

**Outros**
- Gemini CLI ToS: https://geminicli.com/docs/resources/tos-privacy/
- Google AI plans: https://ai.google.dev/gemini-api/docs/google-ai-plans · Models API: https://ai.google.dev/api/models
- Discussão sobre bans do Antigravity: https://github.com/google-gemini/gemini-cli/discussions/20632
- GitHub + OpenCode: https://github.blog/changelog/2026-01-16-github-copilot-now-supports-opencode/
- Copilot billing: https://github.blog/changelog/2026/04/27/github-copilot-is-moving-to-usage-based-billing/
- Copilot SDK: https://github.com/github/copilot-sdk (`docs/auth/authenticate.md`) · https://docs.github.com/en/copilot/how-tos/copilot-sdk/authenticate-copilot-sdk/authenticate-copilot-sdk
- xAI + OpenCode: https://x.ai/news/grok-opencode
- Kimi Code: https://www.kimi.com/code/docs/en/third-party-agents.html · https://www.kimi.com/code/docs/en/benefits.html
- Qwen Code auth: https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/auth.md
- OpenRouter OAuth: https://openrouter.ai/docs/use-cases/oauth-pkce · Models: https://openrouter.ai/api/v1/models

**Catálogos e código de referência**
- models.dev: https://models.dev/api.json · https://github.com/anomalyco/models.dev
- LiteLLM: https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
- tokenlens: https://github.com/xn1cklas/tokenlens
- pi (pi-ai): https://github.com/earendil-works/pi (`packages/ai/src/auth/oauth/*.ts`, `packages/ai/src/providers/openai.ts`)
- OpenCode: https://github.com/anomalyco/opencode (`packages/core/src/plugin/provider/chatgpt.ts`, `openai.ts`)
- Cline: https://github.com/cline/cline (`sdk/packages/core/src/auth/codex.ts`)
- OpenClaw: https://github.com/openclaw/openclaw (`extensions/openai/token-sharing.ts`)
- TanStack AI: https://github.com/TanStack/ai (`packages/ai-openai/src/siwc.ts`)
- RFCs: 7636 (PKCE), 8252 (OAuth native apps), 8628 (device grant), 9278 (JWK thumbprint URI)
