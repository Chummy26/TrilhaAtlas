# YouTube.js (LuanRT) — busca, legendas e transcrições do YouTube para o learnharness

> Relatório de pesquisa `extra-LuanRT__YouTube.js`. Data: 2026-11-18.
> Repositório analisado: `https://github.com/LuanRT/YouTube.js`, clonado com `--depth 1` em
> `_refs/extra/LuanRT__YouTube.js`. HEAD `d6bcf97` (2026-11-11), pacote npm `youtubei.js@18.3.0` (publicado em 2026-10-23).
> Só leitura: nada do repositório foi instalado, compilado ou executado.
> Fontes externas foram lidas com WebFetch: issues do repositório, README e examples do BgUtils, registro npm, wiki e código do yt-dlp e código do FreeTube. A cota de WebSearch da sessão acabou no início, então não houve busca aberta; li só fontes primárias por URL direta.

---

## 0. Resumo executivo

- **O que é:** cliente TypeScript (ESM) para a **InnerTube**, a API privada que os apps oficiais do YouTube usam. Roda em Node, Deno, navegador (com proxy de CORS), Cloudflare Workers e React Native. **Licença MIT**, compatível com o nosso AGPL-3.0. Tem 3 dependências de runtime: `@bufbuild/protobuf`, `fflate` e `meriyah`.
- **Faz bem, sem API key:** busca com filtros codificados em protobuf (`Innertube.search`), sugestões de busca, metadados de vídeo (`getBasicInfo`/`getInfo`), trilhas de legenda (`PlayerCaptionsTracklist`: `caption_tracks`, `translation_languages`, `kind: 'asr'`), capítulos, "heatmap" (trechos mais repetidos), canais, playlists e "Cursos" (`LockupView` com `content_type: 'COURSE'`).
- **Estado em novembro de 2026, o que importa para nós:**
  1. **`MediaInfo.getTranscript()` (endpoint `/get_transcript`) está quebrado na prática.** A issue [#1102](https://github.com/LuanRT/YouTube.js/issues/1102) ("failed with status 400") está aberta desde 2025-12-12. Os testes de `getInfo` estão comentados em `tests/main.test.ts` (linhas 13–26), sinal de que o próprio CI deixou de confiar nesse caminho.
  2. **O caminho que funciona é `getBasicInfo(videoId, { client: 'ANDROID' })`** seguido de download direto do `base_url` da trilha de legenda (timedtext). Usuários confirmaram isso no #1102 (2026-02-09 e 2026-02-11). O projeto `youtube-transcript-plus` (MIT) faz o mesmo com `clientName: 'ANDROID'`.
  3. **No cliente WEB, legendas exigem PO token** quando a URL traz `exp=xpe` ou `exp=xpv`. A tabela do yt-dlp marca "`web`: Subs, GVS". O código do yt-dlp e do FreeTube anexa `pot=<token>&potc=1&c=<CLIENTE>` à URL. Já `android_vr` e `tv` aparecem como "Not required" no guia do yt-dlp.
  4. **A biblioteca não baixa o conteúdo da legenda.** Ela só expõe `base_url`. O PR que adicionaria `getCaptionTrackContent` ([#1104](https://github.com/LuanRT/YouTube.js/issues/1104)) foi fechado sem merge. Nós escrevemos o fetch e o parser de timedtext (`fmt=json3`/`srv3`), com `tlang=pt` para a tradução automática EN→PT.
  5. Só os clientes **web/mweb** devolvem `translationLanguages` (comentário no código do yt-dlp). No ANDROID, use `is_translatable` e aplique `tlang` sem consultar a lista.
- **Recomendação:** usar `youtubei.js` como **dependência npm fixada** (não copiar o código) num módulo server-side `src/core/youtube/*` do Next.js standalone. Por cima dele, escrever um "provider de transcrição" com cadeia de fallback: ANDROID, depois ANDROID_VR, depois WEB+PO token (via `bgutils-js` num `WebContentsView` offscreen do Electron, no padrão do FreeTube, que também é AGPL-3.0) e por último `/get_transcript`. Tocar os vídeos **somente pelo IFrame Player oficial**, com overlay de legenda PT nosso, sincronizado pelos cues.

---

## 1. Identificação e números

| Item | Valor |
|---|---|
| Repo | `LuanRT/YouTube.js`, pacote npm `youtubei.js` |
| Versão / data | 18.3.0 (2026-10-23); HEAD `d6bcf97` (2026-11-11, bump de dependências) |
| Licença | MIT, "Copyright (c) 2021 LuanRT" (`LICENSE`) |
| Dependências de runtime | `@bufbuild/protobuf ^2.0.0` (protobuf), `fflate ^0.8.2` (compressão do cache de sessão), `meriyah ^7.3.1` (parser JS para extrair o decipher do player) |
| `engines` | não declarado; o guia oficial cita fetch nativo (Node ≥ 16.8) |
| Formato | **ESM-only** (CommonJS removido na v15.0.0, 2025-07-18) |
| Entradas (`package.json#exports`) | `node` → `dist/src/platform/node.js`; `browser`/`default` → `web.js`; `./agnostic`, `./web`, `./web.bundle`, `./cf-worker`, `./react-native` |
| Tamanho | ~35 mil linhas TS em `src/`; 589 classes de nó do parser (`src/parser/classes/**`) |
| Ritmo | releases a cada 1–4 semanas em 2026 (17.0.0 em 03-16 ... 18.3.0 em 10-23); a v18.0.0 teve breaking change em comentários |

Releases de 2025–2026 relevantes para nós (de `CHANGELOG.md`):
- **15.0.0** (2025-07): remove CJS.
- **16.0.0** (2025-10): extração do player via AST (meriyah) e avaliador JS assíncrono.
- **17.0.0** (2026-03): filtros de busca atualizados (breaking), cliente `ANDROID_VR`, remoção do `getTrending`.
- **17.1.0** (2026-06): chips de refinamento de busca (`Search.applyRefinement`).
- **18.2.0** (2026-10): `publish_date`/`upload_date` em `basic_info`, `LockupView.duration`, `CourseProgressView`.
- **18.3.0** (2026-10): `LockupView` com `content_type` `course`.

---

## 2. Licença e compatibilidade com AGPL-3.0

- **youtubei.js (MIT): compatível.** MIT é permissiva e compatível com GPL/AGPL. Podemos depender do pacote ou copiar trechos, desde que o aviso de copyright e o texto MIT sejam mantidos. Ação: adicionar uma entrada em `THIRD_PARTY_NOTICES` (ou equivalente) com o texto do `LICENSE`.
- **bgutils-js (MIT, v4.0.3 no npm): compatível**, com a mesma obrigação de aviso.
- **FreeTube (AGPL-3.0): compatível.** O padrão de geração de PO token em Electron (`src/main/poTokenGenerator.js`, `src/botGuardScript.js`) pode ser adaptado mantendo o aviso e marcando as modificações. Isso também vale para os nossos usuários: código-fonte disponível, mesmo em uso via rede.
- **yt-dlp (Unlicense / domínio público):** a lógica de `exp=xpe/xpv`, `pot`/`potc`/`c` e `tlang` pode ser reimplementada livremente. Mesmo assim, reescrevemos em vez de copiar.
- **Risco que não é de licença:** os Termos de Serviço do YouTube proíbem acesso automatizado fora da API oficial e do player oficial. O risco é contratual e operacional (bloqueio de IP, "Sign in to confirm you're not a bot"), não de copyright do código. Mitigações:
  1. App desktop com o IP residencial do próprio usuário e volume baixo.
  2. Cache agressivo de transcrições.
  3. **Nunca baixar nem re-hospedar mídia**; reprodução só pelo embed oficial.
  4. Opção de usar a YouTube Data API v3 com a chave do usuário para busca (ver §10).

---

## 3. Arquitetura

```mermaid
flowchart TD
  A[Innertube.create(options)] --> S[Session.create]
  S -->|"generate_session_locally=false"| SW["GET /sw.js_data (JSPB)<br/>api_key, visitorData, clientVersion..."]
  S -->|"generate_session_locally=true"| LOC["contexto local<br/>visitorData = proto(id aleatório, ts)"]
  S --> CFG["POST /youtubei/v1/config<br/>(coldConfigData, hashes)"]
  S --> P["Player.create (opcional)<br/>/iframe_api → base.js → meriyah → decipher"]
  S --> H[HTTPClient]
  S --> AC[Actions.execute(endpoint,args)]
  AC --> H
  H -->|"injeta context, ajusta cliente,<br/>headers, auth"| YT[(youtube.com/youtubei/v1/*)]
  AC --> PR[Parser.parseResponse]
  PR --> N["YTNodes (589 classes)<br/>+ classes JIT para renderers novos"]
  PR --> M["Memo: índice por tipo<br/>(contents_memo, actions_memo...)"]
  N --> W["Wrappers de alto nível:<br/>Search, VideoInfo/MediaInfo,<br/>TranscriptInfo, Channel, Playlist"]
  PL["Platform shim (node/web/deno/cf-worker)<br/>fetch, Cache, sha1, eval"] -.-> H
  PL -.-> P
```

### 3.1 Camadas

1. **`Platform` shim** (`src/utils/Utils.ts:15`, `src/platform/*.ts`): o ponto de entrada de cada runtime chama `Platform.load({...})` com `fetch`, `Request`, `Headers`, `Cache`, `sha1Hash`, `uuidv4`, `eval` e um flag `server`. O flag é `true` em Node. Ele decide se o `HTTPClient` pode setar `User-Agent`/`Origin`, coisa que o navegador proíbe.
   - `node.ts`: `Cache` grava arquivos em `os.tmpdir()/youtubei.js` (modo não persistente) ou em `path.resolve(__dirname__, '..','..','.cache','youtubei.js')` (persistente). Atenção: no Electron empacotado esse diretório fica dentro do `asar` ou de `node_modules` (ver §8).
   - `jsruntime/default.ts`: `eval` **lança erro** por padrão. Só é necessário para decifrar URLs de mídia, o que não usamos.
2. **`Session`** (`src/core/Session.ts`):
   - `Session.create` (linha 292) chama `getSessionData` (374).
   - Com `generate_session_locally=false`, faz `GET https://www.youtube.com/sw.js_data`, remove o prefixo JSPB `)]}'` e lê `data[0][2]`. Daí extrai `device_info[0]` (hl), `[1]` (gl), `[13]` (visitorData), `[16]` (clientVersion), `[61]` (configInfo/appInstallData), `[103]` (deviceExperimentId) e `[107]` (rolloutToken). Ver `#getSessionData`, linha 528.
   - Com `generate_session_locally=true`, monta o contexto com `Constants.CLIENTS.WEB` e um `visitorData` local via `ProtoUtils.encodeVisitorData(generateRandomString(11), unix_ts)`.
   - Depois, opcionalmente, faz `POST /youtubei/v1/config` (`retrieve_innertube_config`, default `true`) e guarda a sessão serializada e comprimida no `ICache` (chave `innertube_session_data`, invalidada pela versão major da lib).
   - `#buildContext` (592) produz o objeto `context.client` enviado em toda requisição.
3. **`HTTPClient.fetch`** (`src/utils/HTTPClient.ts:40`): toda chamada InnerTube vira `POST https://www.youtube.com/youtubei/v1/<endpoint>?prettyPrint=false&alt=json`.
   - Se o body é JSON, `#processJsonPayload` (160) copia `session.context` por deep clone e o injeta no payload. Se o payload traz `client: 'ANDROID' | 'IOS' | 'TV' ...`, `#adjustContext` (206) reescreve `clientName`, `clientVersion`, `osName`, `androidSdkVersion`, `userAgent` etc. e seta os headers `X-Youtube-Client-Name`/`-Version`.
   - Para ANDROID também seta `User-Agent: com.google.android.youtube/21.03.36 (...)` e `X-GOOG-API-FORMAT-VERSION: 2`.
   - Autenticação por OAuth (TV) ou cookie (SAPISIDHASH via `generateSidAuth`) é opcional; não usaremos.
   - Respostas fora de 2xx viram `InnertubeError("Request to ... failed with status code N", body)`.
4. **`Actions.execute(endpoint, args)`** (`src/core/Actions.ts:98`): normaliza argumentos (`token`→`continuation`, remove `parse`/`request`/`clientActions`...). Com `parse: true`, devolve `Parser.parseResponse(json)`; sem ele, devolve `{ success, status_code, data }`. Também segue `navigateAction` em respostas de `/browse`.
5. **Parser** (`src/parser/parser.ts`):
   - `parseResponse` (232) percorre os campos de topo conhecidos (`contents`, `onResponseReceived*`, `actions`, `header`, `captions`, `videoDetails`, `streamingData`, `engagementPanels`, `playabilityStatus` etc.). Para cada grupo cria um **memo** (`Map<classname, YTNode[]>`) que indexa todo nó instanciado durante aquele parse.
   - Por isso os wrappers fazem `page.contents_memo.getType(SectionList)` sem conhecer o caminho exato no JSON. Isso dá resistência a mudanças de layout.
   - `parseItem` (569) pega a primeira chave do objeto (`videoRenderer`, `lockupViewModel`...) e passa por `sanitizeClassName` (197), que remove "Renderer"/"Model" e troca "Radio" por "Mix". Se não existe classe com esse nome, `generateRuntimeClass` (`generator.ts:474`) **introspecta o JSON e gera uma classe JIT**, emitindo um warning com o TS sugerido. O parse nunca quebra por renderer desconhecido, mas loga bastante (ver #1118).
   - `YTNode.is(...)`/`.as(...)` (`helpers.ts`) fazem type guard e cast por `static type`. `ObservedArray` adiciona `filterType`, `firstOfType` e `as`.
6. **Wrappers** (`src/parser/youtube/*`, `src/core/mixins/*`):
   - `Feed`: memos concatenados, `videos`/`playlists` via memo e continuações.
   - `Search extends Feed`.
   - `MediaInfo` (base de `VideoInfo`): `basic_info`, `captions`, `streaming_data`, `getTranscript`, `toDash`.
   - `TranscriptInfo`, `Channel`, `Playlist`.
7. **`Player`** (`src/core/Player.ts`): baixa `/iframe_api` para obter o player id e depois `/s/player/<id>/player_es6.vflset/en_US/base.js`. Extrai as funções de assinatura e `n` com meriyah e as avalia via `Platform.shim.eval`. **Não precisamos dele**: use `retrieve_player: false`. Ele só serve para decifrar URLs de mídia.

---

## 4. APIs relevantes (assinaturas exatas)

### 4.1 Criação

```ts
import { Innertube, UniversalCache, Log, ClientType } from 'youtubei.js';
const yt = await Innertube.create(options?: SessionOptions);
```

Opções de `SessionOptions` (`src/core/Session.ts`) que importam para nós:

| Opção | Uso recomendado |
|---|---|
| `lang` / `location` | `'pt'`/`'BR'` para textos e região PT-BR; `'en'`/`'US'` para buscar conteúdo em inglês. Viram `hl`/`gl`. |
| `retrieve_player` | **`false`**: sessão mais rápida, sem baixar `base.js`. Não decifra mídia, e não precisamos. |
| `generate_session_locally` | `true` dispensa `/sw.js_data`, com menos requisições. FreeTube usa `true` por padrão. Os testes do repo usam `false`. Comece com `true` e caia para `false` quando aparecer bot-check. |
| `retrieve_innertube_config` | default `true` (1 POST a `/config`). Pode desligar. |
| `enable_session_cache` + `cache` | `new UniversalCache(true, <LH_DATA_DIR>/youtubei)` persiste a sessão. **Sempre passe o diretório** (§8). |
| `visitor_data` | fixar um visitorData persistente por instalação, ou rotacionar quando houver bloqueio. |
| `po_token` | PO token de sessão. Para legendas WEB, o token é por vídeo e vai na URL de timedtext, não aqui (§6.6). |
| `fetch` | injetar fetch com proxy, timeout, logging ou contagem de requisições. |
| `client_type` | `ClientType.WEB` (default). Prefira trocar o cliente por chamada (`{ client: 'ANDROID' }`). |
| `fail_fast` | `true` para não cair silenciosamente no contexto local. |

### 4.2 Busca

```ts
yt.search(query: string, filters?: SearchFilters): Promise<YT.Search>
// SearchFilters (src/types/Misc.ts):
//   upload_date?: 'all'|'today'|'week'|'month'|'year'
//   type?: 'all'|'video'|'shorts'|'channel'|'playlist'|'movie'
//   duration?: 'all'|'over_twenty_mins'|'under_three_mins'|'three_to_twenty_mins'
//   prioritize?: 'relevance'|'popularity'
//   features?: ('hd'|'subtitles'|'creative_commons'|'3d'|'live'|'purchased'|'4k'|'360'|'location'|'hdr'|'vr180')[]
yt.getSearchSuggestions(query: string, previous_query?: string): Promise<string[]>
```

- `Search` tem estes campos e métodos:
  - `results: ObservedArray<YTNode>`: conteúdo achatado das `ItemSection`.
  - `videos`, herdado de `Feed`: filtra `Video`, `LockupView` com `content_type` VIDEO/MOVIE/SHORT/STATION, `ReelItem`, `ShortsLockupView` etc.
  - `playlists`, `refinements: string[]`, `estimated_results: number`, `sub_menu`, `watch_card`.
  - `refinement_filters: string[]` e `applyRefinement(label | ChipCloudChip)` (chips como "Shorts" ou "Assistidos").
  - `getContinuation(): Promise<Search>` (paginação).
- Filtros viram protobuf `SearchFilter` (`protos/misc/params.proto:9`) codificado em base64 e passado em `searchEndpoint.params`. Enums: `UploadDate{TODAY=2,WEEK=3,MONTH=4,YEAR=5}`, `SearchType{VIDEO=1,CHANNEL=2,PLAYLIST=3,MOVIE=4,SHORTS=9}`, `Duration{OVER_TWENTY_MINS=2,UNDER_THREE_MINS=4,THREE_TO_TWENTY_MINS=5}`, `features_subtitles=5`, `Prioritize{POPULARITY=3}`.
- O valor `'all'` não está nos enums; resulta em `undefined` e o campo fica sem filtro, como esperado.
- `YTNodes.Video` (`src/parser/classes/Video.ts`):
  - `video_id`, `title: Text`, `description` (getter que junta `snippets`), `author: Author` (`name`, `id`, `url`, `is_verified`), `thumbnails`, `published?: Text`, `view_count?: Text`, `length_text?: Text`, `badges`.
  - Getters: `duration → { text, seconds }`, `has_captions` (badge "CC"), `is_live`, `is_4k`.
- `YTNodes.LockupView` (layout novo): `content_id`, `content_type`, `metadata: LockupMetadataView` (título e linhas) e o getter `duration`.
- `Channel.search(query)` (`src/parser/youtube/Channel.ts:370`) busca **dentro de um canal**, útil para whitelists como MIT OCW ou Khan Academy. `yt.getPlaylist(id)` devolve `items` (`PlaylistVideo | LockupView ...`) com continuação. `yt.getCourses()` e `Channel.getCourses()` dão acesso aos "Cursos" do YouTube.

### 4.3 Metadados de vídeo e trilhas de legenda

```ts
yt.getBasicInfo(video_id: string, options?: { client?: InnerTubeClient; po_token?: string }): Promise<YT.VideoInfo> // só /player
yt.getInfo(target: string | NavigationEndpoint, options?): Promise<YT.VideoInfo>              // /player + /next em paralelo
// InnerTubeClient = 'IOS'|'WEB'|'MWEB'|'ANDROID'|'ANDROID_VR'|'VISIONOS'|'YTMUSIC'|'YTMUSIC_ANDROID'|'YTSTUDIO_ANDROID'|'TV'|'TV_SIMPLY'|'TV_EMBEDDED'|'YTKIDS'|'WEB_EMBEDDED'|'WEB_CREATOR'
```

Campos de `MediaInfo` (`src/core/mixins/MediaInfo.ts`):

- **`basic_info`**: `id`, `title`, `duration` (s), `keywords`, `short_description`, `channel_id`, `author`, `view_count` (int), `is_live`, `category`, `publish_date`, `upload_date`, `tags`, `is_family_safe` etc.
- **`playability_status`**: `{ status, reason, ... }`. Status `ERROR` faz o construtor lançar `InnertubeError('This video is unavailable')`. `LOGIN_REQUIRED` ("Sign in to confirm you're not a bot") **não lança**, apenas deixa `captions` indefinido.
- **`captions?: PlayerCaptionsTracklist`** (`src/parser/classes/PlayerCaptionsTracklist.ts`):

  ```ts
  interface CaptionTrackData {
    base_url: string;            // URL timedtext (https://www.youtube.com/api/timedtext?v=...&lang=en&...)
    name: Text;                  // "English (auto-generated)" — localizado por hl
    vss_id: string;              // ".en" (manual), "a.en" (ASR/automática), ".pt-BR"
    language_code: string;       // "en", "pt-BR"...
    kind?: 'asr' | 'frc';        // 'asr' = gerada por reconhecimento de fala
    is_translatable: boolean;
  }
  caption_tracks?: CaptionTrackData[];
  audio_tracks?: { audio_track_id; captions_initial_state; default_caption_track_index?; caption_track_indices: number[]; ... }[];
  translation_languages?: { language_code: string; language_name: Text }[];  // só web/mweb
  ```

- **Truque (de `VideoInfo.ts:62–77`):** o `language_code` da trilha ASR revela o **idioma falado** do vídeo. A lib usa isso para preencher `format.language`.
- **`streaming_data.adaptive_formats[]`** (`Format`) traz `audio_track { id, display_name, audio_is_default }`, `language` e as flags `is_dubbed`, `is_auto_dubbed` (xtag `acont=dubbed-auto`), `is_original` e `is_descriptive`. Isso permite detectar **dublagem PT (inclusive automática)** e marcar o vídeo como "tem áudio em PT".

### 4.4 Transcrição "oficial" (painel), hoje instável

```ts
const info = await yt.getInfo(videoId);              // precisa do /next
const ti: YT.TranscriptInfo = await info.getTranscript();
ti.transcript.content?.body?.initial_segments        // (TranscriptSegment | TranscriptSectionHeader)[]
ti.languages: string[]; ti.selectedLanguage: string;
await ti.selectLanguage('English (auto-generated)'); // match por TÍTULO localizado
// TranscriptSegment: { start_ms: string; end_ms: string; snippet: Text; start_time_text: Text; target_id }
```

### 4.5 Capítulos e trechos mais vistos (só `/next`)

- Capítulos: `info.engagement_panels` contém `MacroMarkersList` com `MacroMarkersListItem { title: Text; time_description: Text; on_tap_endpoint; thumbnail }`. O `on_tap_endpoint.payload.watchEndpoint.startTimeSeconds` traz o início em segundos.
- `info.heat_map` (`Heatmap`) é derivado de `MacroMarkersListEntity` (mutations) e indica os trechos mais repetidos. Serve de sinal de relevância de segmento.

### 4.6 PO token / atestação

```ts
yt.getAttestationChallenge('ENGAGEMENT_TYPE_UNBOUND') // POST /att/get → { bg_challenge: { interpreter_url, interpreter_hash, program, global_name } }
```

O resultado alimenta o BgUtils (§6.7).

### 4.7 Utilidades

- `Log.setLevel(Log.Level.ERROR)` (ou `NONE`) silencia os warnings de parser. Níveis: `NONE=0`, `ERROR=1`, `WARNING=2`, `INFO=3`, `DEBUG=4`.
- `Parser.setParserErrorHandler(fn)` redireciona erros de parser para a nossa telemetria.
- `ProtoUtils.encodeVisitorData(id, ts)` e `Utils.generateRandomString(n)` geram visitorData.
- `Utils.timeToSeconds('1:02:03')`.

---

## 5. Exemplo de referência do repo

`examples/transcript/index.ts` (12 linhas):
1. `Innertube.create({ generate_session_locally: true })`.
2. `getInfo('hePb00CqvP0')`.
3. `info.getTranscript()`.
4. Imprime `selectedLanguage` e `initial_segments.length`.
5. `selectLanguage('Hebrew')`.

É o fluxo do painel (§6.5), **hoje sujeito ao erro 400 do #1102**. Serve só como documentação da API.

---

## 6. Algoritmos-chave

### 6.1 Bootstrap de sessão sem API key

- A API key do WEB (`Constants.CLIENTS.WEB.API_KEY`) e a versão do cliente (`2.20260623.01.00`) estão em `src/utils/Constants.ts`. A requisição nem manda `key=`: o endpoint `www.youtube.com/youtubei/v1/*` aceita o `context` sozinho.
- O `visitorData` é um protobuf `VisitorData{ id: string(11), timestamp }` em base64url (`ProtoUtils.encodeVisitorData`). Ele vai no `context.client.visitorData` e no header `X-Goog-Visitor-Id`. É a "identidade" deslogada que o YouTube usa para personalizar e para o antibot.

### 6.2 Troca de cliente por chamada

Passar `{ client: 'ANDROID' }` em `getBasicInfo` coloca `client` no payload. Em `HTTPClient.#processJsonPayload`, o contexto é clonado e ajustado:
- `clientName=ANDROID`, `clientVersion=21.03.36`, `androidSdkVersion=36`, `osName=Android`, `osVersion=13`, `platform=MOBILE`, `clientFormFactor=SMALL_FORM_FACTOR`.
- O header `User-Agent` vira o do app Android, e `X-GOOG-API-FORMAT-VERSION` vira `2`.
- O campo `client` é removido do payload.

**O `User-Agent` só é aplicado quando `Platform.shim.server` é `true` (Node).** No renderer do Electron, o navegador ignora esse header e o CORS bloqueia `youtube.com`. Por isso toda a integração precisa rodar no servidor Node.

### 6.3 Parser dinâmico com memo (a ideia mais reaproveitável)

Trecho essencial (MIT, © 2021 LuanRT), `src/parser/parser.ts:197`:

```ts
export function sanitizeClassName(input: string) {
  return (input.charAt(0).toUpperCase() + input.slice(1))
    .replace(/Renderer|Model/g, '').replace(/Radio/g, 'Mix').trim();
}
```

`parseItem`:
1. Pega `Object.keys(data)[0]` e o normaliza com `sanitizeClassName`.
2. Procura a classe registrada em `RUNTIME_NODES`; se não existe, gera uma JIT.
3. Valida contra `validTypes`.
4. Instancia e faz `_addToMemo(classname, node)`.

Depois, os wrappers consultam por tipo (`memo.getType(Video, LockupView)`) em vez de por caminho JSON. Isso explica por que a busca sobrevive bem às mudanças de layout do YouTube.

### 6.4 Busca

`Innertube.search` (`src/Innertube.ts:201`):
1. Monta `SearchFilter`, faz `encode().finish()`, depois `u8ToBase64` e `encodeURIComponent`.
2. Cria `NavigationEndpoint({ searchEndpoint: { query, params } })` e chama `.call(actions)`, que vira `POST /search`.
3. Constrói `new Search(actions, response)`.

`Search` acha o `SectionList` pelo memo (ou pelos comandos de continuação), extrai `ItemSection.contents` e expõe `header.chip_bar` para refinamentos.

### 6.5 Transcrição pelo painel (`/get_transcript`)

`MediaInfo.getTranscript()` (linha 184), resumido:
1. Exige a resposta do `/next`, ou seja, `getInfo` e não `getBasicInfo`.
2. Procura em `engagement_panels` o painel com `panel_identifier === 'engagement-panel-searchable-transcript'`.
3. `panel.content.as(ContinuationItem).endpoint.call(actions)`. O `NavigationEndpoint` resolve `apiUrl` a partir de `commandMetadata.webCommandMetadata.apiUrl` (`/youtubei/v1/get_transcript`) e envia `{ params }` (protobuf opaco gerado pelo servidor).
4. `new TranscriptInfo(actions, response)` lê `actions_memo.getType(Transcript)[0]`. A estrutura é `TranscriptSearchPanel { header: TranscriptSearchBox, body: TranscriptSegmentList, footer: TranscriptFooter{ language_menu: SortFilterSubMenu } }`.
5. `selectLanguage(title)` acha o `sub_menu_item` pelo **título localizado** e chama `/get_transcript` com `item.continuation` (`reloadContinuationData`).

**Status (2026-11):** #1102 está aberto ("failed with status 400"). Os relatos ligam o erro ao antibot: a resposta do `/player` WEB chega sem `captionTracks` e com "Sign in to confirm you're not a bot". Também há relatos de "Precondition check failed". Trate esse caminho como **último fallback**.

### 6.6 Legendas via timedtext (o caminho principal, implementado por nós)

A lib entrega `caption_tracks[].base_url`. O download e o parse ficam conosco. Regras consolidadas do yt-dlp (`yt_dlp/extractor/youtube/_video.py`), do FreeTube (`src/renderer/helpers/api/local.js`) e do `youtube-transcript-plus`:

1. **Cliente:** `getBasicInfo(id, { client: 'ANDROID' })`. Pelo guia do yt-dlp, `android` exige PO só para GVS/Player (mídia), não para legendas. `android_vr` aparece como "Not required" em tudo, mas sem vídeos "made for kids". Se `captions` vier vazio ou o status não for `OK`, tente `ANDROID_VR`.
2. **Formato:** acrescente `fmt=json3` (alternativas: `srv3`, `vtt`, `ttml`; o yt-dlp suporta `json3, srv1, srv2, srv3, ttml, srt, vtt`). **Remova `xosf`**: tanto yt-dlp quanto FreeTube o removem, porque `xosf=1` gera dados de posição indesejados.
3. **Tradução automática:** acrescente `tlang=<alvo>` **somente se o alvo for diferente do `lang` original da URL**. Comentário do yt-dlp: com `tlang` igual ao idioma original, as legendas vêm danificadas.
   - `translation_languages` só vem em respostas web/mweb. No ANDROID, confie em `is_translatable` e valide se a resposta veio não vazia.
4. **PO token (só WEB/MWEB):** se `exp` na query contém `xpe` ou `xpv`, a trilha exige token. Anexe `pot=<token ligado ao videoId>`, `potc=1` e `c=<clientName>` (por exemplo `WEB`). Sem token, a resposta vem vazia ou falha; o yt-dlp descarta a trilha.
5. **Formatos de resposta:**
   - **json3:** `{ events: [{ tStartMs, dDurationMs?, segs?: [{ utf8, tOffsetMs? }], aAppend? }] }`. Eventos só com `"\n"` (`aAppend`) são quebras de linha da ASR e devem ser ignorados.
   - **srv3 (XML, default no ANDROID):** `<timedtext format="3"><body><p t="ms" d="ms">texto<s t=".." ac="..">palavra</s></p>`.
   - **Legado:** `<transcript><text start="s" dur="s">texto</text>`.
   - Sempre decodifique entidades: `&amp; &lt; &gt; &quot; &#39; &#NNN;`.
6. **Seleção de trilha para um aluno PT-BR** (vss_id: `.xx` é manual, `a.xx` é ASR):
   1. Manual `pt`/`pt-BR`.
   2. ASR `pt`.
   3. Manual no idioma original + `tlang=pt`.
   4. ASR original + `tlang=pt`.
   5. Original sem tradução; a UI pode oferecer tradução por LLM.

   No domínio **Inglês**, busque **as duas** trilhas: `en` original e `en→pt` (tlang). Isso dá legenda dupla.

### 6.7 PO token com BgUtils (fallback WEB)

- **bgutils-js 4.0.3** (MIT, sem dependências de runtime). Exports: `bgutils-js/botguard` (`BotGuardClient`), `bgutils-js/webpo` (`WebPoMinter`), `bgutils-js/utils` (`buildURL`, `GOOG_API_KEY`) e `bgutils-js/shared-types`.
- O exemplo `examples/browser/web/src/main.ts` do YouTube.js usa a API antiga v3 (`BG.Challenge.create`, `BG.PoToken.generate`, `generatePlaceholder`). Está desatualizado; não copie.

Fluxo v4, como no `botGuardScript.js` do FreeTube e no `examples/index-innertube.ts` do BgUtils:

1. Obtenha o desafio: `yt.getAttestationChallenge('ENGAGEMENT_TYPE_UNBOUND')` (`/att/get`) devolve `bg_challenge { interpreter_url, program, global_name }`. Alternativa: extrair do HTML (`ytAtN`).
2. Baixe o JS do interpretador (a URL vem em `interpreter_url.private_do_not_access_or_else_trusted_resource_url_wrapped_value`, prefixe `https:`) e execute-o **num contexto de navegador real**.
3. `BotGuardClient.create({ program, globalName, globalObject: window })` e depois `snapshot({ webPoSignalOutput }, 10_000)`, que devolve `botguardResponse`.
4. `POST buildURL('GenerateIT', true)` com os headers `content-type: application/json+protobuf`, `x-goog-api-key: GOOG_API_KEY` e `x-user-agent: grpc-web-javascript/0.1`, e corpo `[requestKey, botguardResponse]`. O FreeTube usa a requestKey `O43z0dpjhgX20SCx4KAo`. A resposta é `[integrityToken, ttlSecs, refreshThreshold, fallback]`.
5. `WebPoMinter.create({ integrityToken }, webPoSignalOutput)` e depois `mintAsWebsafeString(videoId)`. **O token é ligado ao vídeo.** Gere um por vídeo; o minter é reutilizável enquanto o TTL valer.

**Em Electron,** o padrão do FreeTube (`src/main/poTokenGenerator.js`, AGPL-3.0) evita jsdom e usa Chromium de verdade:
- `WebContentsView` com `offscreen: true`, sem janela, numa partição em memória `session.fromPartition('potoken', { cache: false })`.
- Página `data:` com `baseURLForDataURL: 'https://www.youtube.com/'`.
- `sandbox`, `contextIsolation` e `safeDialogs` ligados; áudio mudo; permissões e janelas negadas.
- Script injetado com `executeJavaScript`, fila serializada e `clearData()` ao fim.
- Ao portar, **evite** dois problemas do original: interpolar parâmetros como código (use `JSON.stringify`) e o `Access-Control-Allow-Origin: *` em todo `https://*/*` da partição (restrinja aos hosts do Google).

---

## 7. Arquivos exatos: ler, copiar ou adaptar

Caminhos relativos a `_refs/extra/LuanRT__YouTube.js/`. **Recomendação geral: não vendorizar.** O valor da lib está nas atualizações frequentes (versões de cliente, classes de parser). Use `npm i youtubei.js@18.3.0` com versão exata e o Renovate do repo, e copie apenas *ideias* ou trechos pequenos com aviso MIT.

| Arquivo | O que tem | Ação |
|---|---|---|
| `src/parser/youtube/Search.ts` | wrapper de busca, chips, continuação | **Usar via npm.** Referência para o nosso `youtubeSearch()` (mapear `search.videos` para DTO). |
| `src/Innertube.ts` (l. 75–200, 201–275, 277–302, 559–568) | `getInfo`, `getBasicInfo` (com `client` e `po_token`), `search` com protobuf, `getSearchSuggestions`, `getAttestationChallenge` | Usar via npm. |
| `src/core/mixins/MediaInfo.ts` (l. 184–209) | `getTranscript()` pelo painel | Usar via npm como **fallback 4**. Adaptar a ideia: chamar `/next` sozinho para capítulos (§9.3). |
| `src/parser/youtube/TranscriptInfo.ts` | `languages`, `selectLanguage` | Usar via npm. Atenção: o match é por título localizado. |
| `src/parser/classes/PlayerCaptionsTracklist.ts` | `CaptionTrackData`, `translation_languages`, `audio_tracks` | **Copiar só o tipo** `CaptionTrackData` (6 campos) para nosso contrato `src/core/contracts/youtube.ts`, para não vazar tipos da lib pela API. |
| `src/parser/classes/Transcript*.ts` (7 arquivos, 14–23 linhas cada) | árvore do painel de transcrição | Ler só para entender. |
| `src/utils/StreamingInfo.ts` (l. 791–819, `getTextSets`) | como a lib monta URLs de legenda (`fmt=vtt/ttml`, papel `dub` se há `tlang`) | Adaptar a ideia no nosso `buildTimedTextUrl`. |
| `examples/transcript/index.ts` | exemplo mínimo | Documentação. |
| `src/utils/HTTPClient.ts` (l. 160–330) | ajuste de contexto por cliente, headers | Ler para depurar (cliente ANDROID e UA). |
| `src/core/Session.ts` | `SessionOptions`, cache de sessão, `sw.js_data` | Ler (opções e cache). |
| `src/utils/Constants.ts` | versões de cliente e UAs | Ler; **não fixar** essas versões no nosso código. |
| `src/parser/classes/misc/Format.ts` (l. 195–245) | `audio_track`, `is_auto_dubbed`, `language` via xtags | Usar via npm para o selo "áudio PT/dublado". |
| `src/parser/classes/MacroMarkersListItem.ts`, `EngagementPanelSectionList.ts` | capítulos | Usar via npm. |
| `src/platform/node.ts` | `Cache` em disco (diretório default problemático) | Ler; passar sempre `persistent_directory`. |
| `docs/updating-the-parser.md` | como a lib lida com renderers novos (JIT) | Ler. |
| `examples/browser/web/src/main.ts` | integração **antiga** com BgUtils v3 | Não copiar (API mudou na v4). |

Fora do repo (fontes a portar):
- **FreeTube** `src/main/poTokenGenerator.js` + `src/botGuardScript.js` (AGPL-3.0): adaptar para `electron/youtube-potoken.cjs` (§9.4).
- **yt-dlp** `_video.py`, trechos de legendas (Unlicense): reimplementar as regras de `exp=xpe/xpv`, `tlang` e `xosf`.

---

## 8. Dependências e armadilhas

### 8.1 Dependências a adicionar

- `youtubei.js@18.3.0` (exato).
- `bgutils-js@4.0.3` (exato), somente para a fase PO token, no processo Electron.
- **Nenhuma** dependência nativa. `meriyah` e `fflate` são JS puro.

### 8.2 Armadilhas, da mais grave para a menos grave

1. **`getTranscript()` / `/get_transcript` dá 400 por causa do antibot** (#1102, aberto desde 2025-12). Não o use como caminho principal.
2. **Legendas no cliente WEB exigem PO token** (`exp=xpe|xpv`). Sem token, a resposta vem vazia; houve relato de "200 com corpo vazio" no #1102.
3. **Bot-check:** `playability_status.status === 'LOGIN_REQUIRED'` com o motivo "Sign in to confirm you're not a bot" **não lança exceção**; `captions` simplesmente fica `undefined`. Verifique o status e classifique o erro.
4. **O ANDROID também pode passar a exigir PO token "Player"** (o guia do yt-dlp diz "GVS or Player"). Monitore e mantenha a cadeia de fallback (ANDROID_VR → WEB+PO → `/get_transcript` → opcionalmente yt-dlp externo).
5. **Rodar só no servidor Node.** No navegador, CORS bloqueia e não dá para setar `User-Agent`/`Origin` (o shim web tem `server: false`). No learnharness, isso significa o standalone Next (`ELECTRON_RUN_AS_NODE`), não o renderer.
6. **Next.js standalone:**
   - Adicione `'youtubei.js'` a `serverExternalPackages` (ESM com `import ... with { type: 'json' }` e geração JIT de classes; evitar bundling).
   - A lib importa `../../package.json` com import attributes em 5 arquivos (`Session.ts`, `Player.ts`, `parser.ts`, `StreamingInfo.ts`, `Utils.ts`). Compilado, isso aponta para `node_modules/youtubei.js/dist/package.json`. O `next.config.ts` do learnharness já documenta que o tracer **perde JSON importado via import attributes** (caso do pi-ai). Inclua `"node_modules/youtubei.js/dist/**/*"` (ou ao menos o `dist/package.json`) em `outputFileTracingIncludes` e cubra no `smoke-server`.
7. **Diretório de cache:** `new UniversalCache(true)` sem diretório grava em `node_modules/youtubei.js/.cache/youtubei.js`, que é somente leitura num app empacotado. Use sempre `new UniversalCache(true, path.join(process.env.LH_DATA_DIR, 'youtubei'))`. Atenção também ao `outputFileTracingExcludes` (`**/data/**/*`) se o diretório ficar sob `data/`.
8. **Parser barulhento:** classes novas geram `console.warn` com TS sugerido (#1118 e outros). Chame `Log.setLevel(Log.Level.ERROR)` e `Parser.setParserErrorHandler(...)` para a nossa telemetria.
9. **Textos localizados por `hl`:** `Text` como "1,2 mi de visualizações", "há 2 anos" ou o nome da trilha "Português (gerada automaticamente)". Não parseie números da busca; use `basic_info.view_count` (int) do `/player`. `TranscriptInfo.selectLanguage` exige o título no idioma de `hl`.
10. **`tlang` igual ao idioma original danifica as legendas.** Traduções automáticas também tendem a 429 sob volume: use cache e backoff.
11. **`translation_languages` ausente nas respostas ANDROID:** não dependa da lista.
12. **Shorts e lives poluem a busca:** use `type: 'video'` e `duration` adequado, e descarte `ShortsLockupView`, `ReelItem` e `is_live`.
13. **`Video.has_captions` depende do badge "CC",** que nem sempre aparece no layout novo (`LockupView` não tem esse badge). Use o filtro `features: ['subtitles']`, que traz só legendas **humanas**, e confirme pela lista de trilhas.
14. **ESM-only:** o `main.cjs` do Electron não pode fazer `require('youtubei.js')`. Mantenha o uso no servidor Next, que é ESM.
15. **Proxy corporativo:** o `fetch` (undici) do Node não usa o proxy do sistema. Se precisar, passe `fetch` customizado com `ProxyAgent`.
16. **Parser com memo global:** `parseResponse` usa um `MEMO` de módulo e é síncrono, então é seguro no event loop. Não chame o parser de forma reentrante de dentro de construtores de nó.
17. **Erro 153 no embed:** houve relatos em 2025 de "Video player configuration error" quando a página do embed não envia `Referer` ou é servida de `file://` ou protocolo custom. O learnharness serve de `http://127.0.0.1:<porta>`, o que deve funcionar. Não use `referrerpolicy="no-referrer"` no iframe. Não verifiquei isso nesta sessão (busca esgotada); teste no app.
18. **`exp=xpe` na prática:** o FreeTube anexa `pot` a todas as trilhas quando tem token. O yt-dlp só o faz quando `exp` contém `xpe`/`xpv` ou quando a política do cliente exige. Siga o yt-dlp: menos tokens, menos chamadas BotGuard.

---

## 9. Plano de integração no learnharness

### 9.1 Onde fica cada peça

```
src/core/contracts/youtube.ts        # DTOs puros: VideoCandidate, CaptionTrack, Cue, TranscriptResult, YtError
src/core/youtube/client.ts           # Innertube singletons por locale (pt-BR / en-US), cache, Log, fetch instrumentado
src/core/youtube/search.ts           # youtubeSearch(query, opts) → VideoCandidate[]  (mapeia Video/LockupView)
src/core/youtube/timedtext.ts        # buildTimedTextUrl, needsPot, parseJson3, parseSrv3, parseLegacyXml, decodeEntities
src/core/youtube/captions.ts         # selectTrack + fetchTranscript (cadeia de fallback) + cache em disco
src/core/youtube/chapters.ts         # /next só: capítulos + heatmap
src/agent/youtube-pot-bridge.ts      # pede PO token ao Electron via process.send (padrão de chatgpt-bridge.ts)
electron/youtube-potoken.cjs         # gerador offscreen (adaptado do FreeTube) + bgutils-js
src/agent/tools/youtube.ts           # tools do agente: youtube_search, youtube_transcript (padrão de tools/web.ts)
app/api/youtube/*                    # rotas p/ UI (busca manual, transcript p/ overlay) — runtime nodejs
components/video-lesson/*            # IFrame Player + overlay de legenda PT + painel de transcrição clicável
tests/youtube-*.test.ts              # unit com fixtures JSON gravadas; smoke ao vivo opcional (LH_YT_LIVE=1)
```

`next.config.ts`:
- `serverExternalPackages: [..., "youtubei.js"]`.
- `outputFileTracingIncludes["*"]`: adicionar `"node_modules/youtubei.js/dist/**/*"`.

CSP (se houver):
- `frame-src https://www.youtube-nocookie.com https://www.youtube.com`
- `script-src https://www.youtube.com` (para `iframe_api`)
- `img-src https://i.ytimg.com`

### 9.2 Código-esqueleto (original, para implementar)

```ts
// src/core/youtube/client.ts
import { Innertube, UniversalCache, Log, Parser } from "youtubei.js";
import path from "node:path";

type Locale = { lang: "pt" | "en"; location: "BR" | "US" };
const KEY = Symbol.for("lh.youtube.clients");
Log.setLevel(Log.Level.ERROR);
Parser.setParserErrorHandler(() => { /* contar em observability, sem console */ });

export function youtube(locale: Locale): Promise<Innertube> {
  const g = globalThis as any; g[KEY] ??= new Map<string, Promise<Innertube>>();
  const k = `${locale.lang}-${locale.location}`;
  if (!g[KEY].has(k)) {
    g[KEY].set(k, Innertube.create({
      lang: locale.lang, location: locale.location,
      retrieve_player: false, generate_session_locally: true, retrieve_innertube_config: false,
      enable_session_cache: true,
      cache: new UniversalCache(true, path.join(process.env.LH_DATA_DIR ?? "data", "youtubei", k)),
    }).catch((e) => { g[KEY].delete(k); throw e; }));
  }
  return g[KEY].get(k);
}
```

```ts
// src/core/youtube/timedtext.ts (trechos)
export interface Cue { startMs: number; endMs: number; text: string }

export function needsPot(baseUrl: string): boolean {
  const exp = new URL(baseUrl).searchParams.getAll("exp").join(",");
  return /\bxp[ev]\b/.test(exp);
}

export function buildTimedTextUrl(baseUrl: string, o: { fmt?: "json3" | "srv3" | "vtt"; tlang?: string; pot?: string; client?: string }) {
  const u = new URL(baseUrl, "https://www.youtube.com");
  u.searchParams.delete("xosf");
  u.searchParams.set("fmt", o.fmt ?? "json3");
  const orig = u.searchParams.get("lang");
  if (o.tlang && o.tlang.split("-")[0] !== orig?.split("-")[0]) u.searchParams.set("tlang", o.tlang); // nunca tlang==lang
  if (o.pot) { u.searchParams.set("pot", o.pot); u.searchParams.set("potc", "1"); if (o.client) u.searchParams.set("c", o.client); }
  return u.toString();
}

export function parseJson3(j: { events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[] }): Cue[] {
  const out: Cue[] = [];
  for (const e of j.events ?? []) {
    const text = (e.segs ?? []).map((s) => s.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
    if (!text) continue;                                 // quebras "\n" da ASR (aAppend)
    const start = e.tStartMs ?? 0;
    out.push({ startMs: start, endMs: start + (e.dDurationMs ?? 0), text });
  }
  return out;
}
// parseSrv3: /<p\b[^>]*\bt="(\d+)"[^>]*?(?:\bd="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g → strip <s ...> tags → decodeEntities
// parseLegacyXml: /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g (segundos → ms)
```

```ts
// src/core/youtube/captions.ts (cadeia de fallback)
type Source = "android" | "android_vr" | "web+pot" | "panel";
export async function fetchTranscript(videoId: string, want = "pt", opts: { alsoOriginal?: boolean } = {}): Promise<TranscriptResult> {
  const cached = await readCache(videoId, want); if (cached) return cached;
  const yt = await youtube({ lang: "en", location: "US" });
  const errors: string[] = [];
  for (const client of ["ANDROID", "ANDROID_VR"] as const) {
    try {
      const info = await yt.getBasicInfo(videoId, { client });
      const st = info.playability_status;
      if (st?.status !== "OK") { errors.push(`${client}: ${st?.status} ${st?.reason ?? ""}`); continue; }
      const tracks = info.captions?.caption_tracks ?? [];
      if (!tracks.length) { errors.push(`${client}: sem trilhas`); continue; }
      const pick = selectTrack(tracks, want);               // §6.6 passo 6
      const url = buildTimedTextUrl(pick.track.base_url, { fmt: "json3", tlang: pick.translateTo });
      const cues = await getCues(url);                     // fetch + json3→fallback srv3; trata 429 com backoff
      if (cues.length) return writeCache(videoId, want, { videoId, source: client.toLowerCase() as Source, ...pick.meta, cues });
    } catch (e) { errors.push(`${client}: ${String(e)}`); }
  }
  // 3) WEB + PO token (só no desktop): getBasicInfo(videoId) → se needsPot(base_url) pede token ao Electron
  // 4) painel: (await yt.getInfo(videoId)).getTranscript() → TranscriptSegment[] → Cue[]
  throw new YtTranscriptError("NO_TRANSCRIPT", errors);
}
```

Cache: um arquivo JSON por `(videoId, lang, kind, translatedFrom)` em `LH_DATA_DIR/youtube/transcripts/`. Legendas quase nunca mudam, então TTL longo (90 dias). Um índice de metadados (título, canal, duração, trilhas, `hasPtAudio`) fica separado.

### 9.3 Busca e ligação vídeo → grafo (meta 1 do produto)

Pipeline, rodado como *background job* do learnharness quando um nó ou região do grafo é criado ou expandido:

1. **Geração de consultas:** a partir de `{ título do nó, descrição, pré-requisitos, nível }`, um LLM gera de 3 a 6 queries em PT e EN (no domínio Inglês, EN puro). Para expandir, use `getSearchSuggestions`.
2. **Busca:** `yt.search(q, { type: 'video', duration: nível ≤ intermediário ? 'three_to_twenty_mins' : 'over_twenty_mins', features: preferirCC ? ['subtitles'] : [], prioritize: 'relevance' })`. Opcional: `Channel.search(q)` em uma **allowlist por domínio** (por exemplo MIT OCW, 3Blue1Brown, Khan Academy, Ben Eater, "ElectroBOOM" etc. para Eletrônica).
3. **Pré-filtro** com `search.videos`: remova shorts e lives; aplique faixa de duração e tamanho mínimo de canal; deduplique; aplique blocklist.
4. **Enriquecimento** com `getBasicInfo(ANDROID)`:
   - Trilhas de legenda e idioma falado (ASR).
   - `streaming_data.adaptive_formats[].audio_track`/`is_auto_dubbed`/`language` para o selo "áudio PT disponível".
   - `basic_info` (duração, views, data).
5. **Transcrição e segmentação:**
   - `fetchTranscript` e capítulos via `/next` (sem `/player` WEB): `new NavigationEndpoint({ watchNextEndpoint: { videoId } }).call(yt.actions, { parse: true })`, depois `engagement_panels → MacroMarkersList → MacroMarkersListItem`.
   - Segmente por capítulo; na falta, por janelas de 60–120 s alinhadas a pausas.
6. **Casamento semântico:** gere embeddings dos segmentos e dos nós e calcule similaridade. Um LLM-juiz avalia uma amostra quanto a precisão, didática, ritmo e pré-requisitos implícitos.
   - Resultado: `VideoResource { videoId, segments: [{ startMs, endMs, nodeIds[], score }], spokenLang, captionLangs, hasPtAudio }`.
   - Use o `heat_map` como sinal secundário de relevância.
7. **Ordenação:** respeite a ordem topológica do grafo. Um vídeo longo que cobre vários nós vira um recurso da **região**, como um livro; segmentos curtos ficam ligados a nós.

### 9.4 PO token no desktop (fase opcional)

- `electron/youtube-potoken.cjs` adapta o FreeTube: `WebContentsView` offscreen, partição em memória, `executeJavaScript` de um bundle do `bgutils-js` (gerado no build; nada de código remoto além do interpretador BotGuard que o próprio Google serve) e fila serializada.
- Canal IPC `{ channel: "lh:youtube-pot", id, op: "mint", videoId }`, no mesmo padrão de `src/agent/chatgpt-bridge.ts` (`process.send` + `process.on('message')` com o checker `desktopIPCConnected()`).
- No modo web (sem Electron), o fallback 3 fica indisponível; registre isso e siga para o 4.
- Endurecimento: valide `videoId` com `/^[\w-]{11}$/`; passe parâmetros com `JSON.stringify`; não aplique `Access-Control-Allow-Origin: *` amplo; limpe a partição.

### 9.5 Tools do agente (padrão `src/agent/tools/web.ts`)

```ts
youtube_search      { query: string; lang?: "pt"|"en"; duration?: "short"|"medium"|"long"; captionsOnly?: boolean; count?: 1..10 }
  → [{ videoId, title, channel, durationS, published, hasCC, url }]
youtube_transcript  { videoId: string; lang?: string; fromS?: number; toS?: number; maxChars?: number }
  → "[00:12] texto ...\n[00:17] ..."   (+ meta: source, kind, translatedFrom)
```

- Use `serverExecute(...)` como em `web_search`. As mensagens de erro devem ser legíveis pelo agente: "sem legendas", "bloqueio antibot, tente depois", "PO token indisponível no modo web".
- Didática (meta 9): o professor usa a transcrição para **citar o trecho exato e mandar o aluno ao minuto certo** ("assista 03:10–07:45"), sem parafrasear o vídeo inteiro nem disparar perguntas logo depois.

### 9.6 Player na UI (meta 1 e 8)

- IFrame Player API em `https://www.youtube-nocookie.com/embed/<id>?enablejsapi=1&start=<s>&end=<s>&cc_load_policy=1&cc_lang_pref=pt&hl=pt&rel=0&modestbranding=1`.
- **Overlay de legenda nosso** sincronizado via `player.getCurrentTime()` (polling de 200–250 ms). Isso dá legenda dupla EN+PT no domínio Inglês e glossário clicável.
- Painel de transcrição com click-to-seek (`player.seekTo`).
- O áudio dublado não é controlável pela API do embed; mostre só o selo "tem áudio PT" e oriente o usuário a trocar pela engrenagem do player.

### 9.7 Testes

- **Fixtures** em `tests/fixtures/youtube/`: JSON bruto de `/player` ANDROID (com e sem trilhas, `LOGIN_REQUIRED`), de `/search`, e de timedtext `json3`, `srv3` e legado. Grave-os uma vez com um script e nunca no CI.
- **Unidade:** `selectTrack` (matriz de casos pt/en/asr/manual), `buildTimedTextUrl` (remove `xosf`, nunca `tlang==lang`, `pot/potc/c`), `needsPot`, os três parsers, `decodeEntities`, classificação de erros.
- **Integração:** construir `new YT.Search(actions, { data: fixture })` e `new YT.VideoInfo([{ data: fixture }], actions, 'cpn')` com um `Actions` fake. Os construtores só parseiam.
- **Smoke ao vivo** opcional (`LH_YT_LIVE=1`), diário, em 3–5 vídeos conhecidos. Serve para detectar quebras do YouTube antes dos usuários.

### 9.8 Fases sugeridas

| Fase | Entrega | Esforço |
|---|---|---|
| F1 | `client.ts`, `search.ts`, `timedtext.ts`, `captions.ts` (ANDROID → ANDROID_VR → painel), cache, tools do agente, testes de unidade | 2–3 dias |
| F2 | Player + overlay + painel de transcrição; selo de dublagem; capítulos via `/next` | 2–3 dias |
| F3 | Pipeline de ligação vídeo→grafo (§9.3) como job de background, com embeddings e LLM-juiz | 4–6 dias |
| F4 | PO token desktop (Electron + bgutils-js) como fallback WEB; telemetria de taxa de sucesso por fonte | 2–3 dias |
| F5 (opcional) | Fallback externo: yt-dlp instalado pelo usuário; ASR local (Whisper) para vídeos sem legenda | — |

---

## 10. Alternativas, prós e contras

| Opção | Prós | Contras |
|---|---|---|
| **youtubei.js (recomendado)** | TS nativo, MIT, sem API key, busca rica (filtros, chips, canais, cursos), parser resistente a mudanças, mantido ativamente (2026) | Usa API privada (ToS); `/get_transcript` quebrado; WEB exige PO token para legendas; lib grande (~35k LOC) e barulhenta |
| YouTube Data API v3 (oficial) | Conforme ToS; estável | `search.list` custa 100 unidades da cota padrão de 10.000/dia (cerca de 100 buscas/dia); `captions.download` só para vídeos que você gerencia, então **não serve para transcrição de terceiros**; exige API key/OAuth do usuário |
| yt-dlp (Unlicense, binário Python) | O mais robusto; plugins de PO token (`bgutil` provider); todos os formatos e `tlang` | Binário externo pesado; processo filho; atualização constante; não é TS |
| `youtube-transcript-plus` (MIT) | Pequeno; ANDROID `/player` + XML; retries e erros tipados | Só transcrição (sem busca); raspa a API key do HTML do watch; sem `tlang` documentado |
| Invidious/Piped públicos | Simples | Instâncias instáveis e bloqueadas; dependência de terceiros |
| Whisper local (ASR) | Funciona sem legendas | Exige baixar o áudio, o que é delicado (ToS) e pesado |

---

## 11. Questões em aberto

1. Por quanto tempo o caminho ANDROID continua sem PO token para `/player` e legendas? O guia do yt-dlp já lista "GVS or Player" para android. É preciso telemetria de taxa de sucesso por fonte e alerta.
2. `ANDROID_VR` devolve `captionTracks` com `is_translatable` e `tlang` funcional? Validar no smoke ao vivo. Não testei: nada foi executado nesta análise.
3. Qual é o limiar de 429 em `tlang=pt` por IP? Calibrar backoff e cache. Considerar traduzir por LLM (assinatura do usuário) quando o `tlang` falhar, com custo contabilizado nos stats de tokens (meta 6).
4. Confirmar o erro 153 do embed no Electron/127.0.0.1 e a política de `Referer` (§8, item 17).
5. Oferecer ao usuário a YouTube Data API v3 (chave própria) como backend de **busca** "conforme ToS", mantendo a transcrição via InnerTube?
6. Política de privacidade: um visitorData persistente identifica a instalação para o YouTube. Rotacionar por domínio de estudo (meta 3, sessões isoladas)?

---

## 12. Fontes consultadas

- Código local: `_refs/extra/LuanRT__YouTube.js` (HEAD `d6bcf97`, 2026-11-11). Arquivos lidos por completo: `src/Innertube.ts`, `src/core/Session.ts`, `src/core/Actions.ts`, `src/utils/HTTPClient.ts`, `src/utils/Constants.ts`, `src/core/mixins/MediaInfo.ts`, `src/parser/youtube/{Search,TranscriptInfo}.ts`, `src/parser/classes/{PlayerCaptionsTracklist,Transcript*,SortFilterSubMenu,Video,LockupView,ContinuationItem,EngagementPanelSectionList,NavigationEndpoint}.ts`, `src/parser/parser.ts` (parseResponse/parseItem/parseCommand), `src/platform/{node,web,lib}.ts`, `src/types/*`, `tests/main.test.ts`, `examples/transcript/index.ts`, `examples/browser/web/src/main.ts`, `docs/updating-the-parser.md`, `CHANGELOG.md`, `LICENSE`, `package.json`, `protos/misc/params.proto`.
- Issues: [#1102 get_transcript 400](https://github.com/LuanRT/YouTube.js/issues/1102), [#1141 "use Android as the client"](https://github.com/LuanRT/YouTube.js/issues/1141), [#1118 parser type mismatch](https://github.com/LuanRT/YouTube.js/issues/1118), [lista de issues "transcript"](https://github.com/LuanRT/YouTube.js/issues?q=transcript).
- BgUtils: [repo](https://github.com/LuanRT/BgUtils), [examples/index-innertube.ts](https://raw.githubusercontent.com/LuanRT/BgUtils/main/examples/index-innertube.ts), [README](https://raw.githubusercontent.com/LuanRT/BgUtils/main/README.md), [npm bgutils-js/latest](https://registry.npmjs.org/bgutils-js/latest) (4.0.3, MIT).
- [npm youtubei.js/latest](https://registry.npmjs.org/youtubei.js/latest) (18.3.0, MIT).
- [Guia de primeiros passos do YouTube.js](https://ytjs.dev/guide/getting-started.html) (avaliador JS customizado, `retrieve_player`).
- yt-dlp: [PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide) e [`_video.py`](https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/yt_dlp/extractor/youtube/_video.py) (regras `exp=xpe/xpv`, `pot/potc/c`, `tlang`, `xosf`, "only web/mweb provide translationLanguages").
- FreeTube (AGPL-3.0): [`src/main/poTokenGenerator.js`](https://raw.githubusercontent.com/FreeTubeApp/FreeTube/development/src/main/poTokenGenerator.js), [`src/botGuardScript.js`](https://raw.githubusercontent.com/FreeTubeApp/FreeTube/development/src/botGuardScript.js), [`src/renderer/helpers/api/local.js`](https://raw.githubusercontent.com/FreeTubeApp/FreeTube/development/src/renderer/helpers/api/local.js).
- [youtube-transcript-plus](https://github.com/ericmmartin/youtube-transcript-plus) e [`src/index.ts`](https://raw.githubusercontent.com/ericmmartin/youtube-transcript-plus/main/src/index.ts) (ANDROID `/player` e XML).
- Arquivos do learnharness lidos para adaptar o plano: `next.config.ts`, `src/agent/tools/web.ts`, `src/agent/chatgpt-bridge.ts`, `electron/main.cjs`, `electron/desktop-api.cjs`, `docs/architecture.md`.
