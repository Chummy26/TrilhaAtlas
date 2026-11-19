# Módulo `resources`: vídeos e livros legais por nó

Este módulo implementa a SÍNTESE §2.8 (recursos por nó), §1.2 (P15: só fontes legais) e o contrato `Resource` da §2.3, seguindo o r6 (vídeos e livros). Também usa as notas extras de `youtubei.js`, `unpdf` e `build_segments` (DeepTutor).

Ele faz três coisas para cada nó do currículo:

- encontra vídeos do YouTube e livros abertos;
- pontua e diversifica os candidatos;
- monta a playlist do nó (explicação da IA, vídeo de intuição, leitura principal e aprofundamento).

Só usa fontes legais. Hosts de bibliotecas-sombra são recusados no próprio `fetch`.

| Camada | Pasta | Papel |
|---|---|---|
| core (puro, browser-safe) | `src/core/resources/` | Tipos, gramática de ids, licenças, score e gates, language-fit por domínio, MMR, set cover do livro-espinha, segmentos de transcrição, playlist, URL de embed, sumário (TOC), chunking, catálogo das sementes (zod) e casamento de texto. |
| server (composição + I/O de rede) | `src/server/resources/` | `safe-fetch` com allowlist, pacing e cota, cache com TTL, YouTube (Data API BYOK e modo enriquecido opt-in), OpenStax, LibreTexts, OTL, Open Library, Crossref, arXiv, Wikibooks, Kuphaldt, biblioteca local (PDF/EPUB), registro e sementes. |
| sementes | `content/resources/` | `channels.json` (37 canais) e `open-books.json` (36 livros abertos), ambos validados por zod ao carregar. |

## API pública

**Core** (`src/core/resources/index.ts`)

- **Score.** `scoreResource(parts, weights?)` calcula `0,35·rel + 0,25·qual + 0,15·lang + 0,10·lvl + 0,07·dur + 0,08·pref`, com gates `rel ≥ 0,35` e `lang > 0`. No inglês, `ENGLISH_WEIGHTS` aumenta o peso de idioma e de nível.
  - Peças do score: `relevance`, `quality`, `captionQuality(captions, hasManualCaptions?, spokenLang?)`, `levelFit`, `durationFit` e `bookSourcePrior`. Legendas desconhecidas (`captions` ausente, modo Data API) contam como ASR no idioma falado; só uma lista vazia conhecida vale 0.
  - Livros: `rel` = `CoverageLink.score`, que pelo contrato já é cobertura × confiança.
  - Confiança no canal: `betaPosterior` / `channelTrust` partem de um prior Beta(4,1) para canais curados, com meia-vida de 90 dias. `thompsonSample` faz a amostragem.
- **Idioma.** `languageFit(resource, policy, ctx)` usa `ELECTRONICS_RESOURCE_POLICY` (pt primeiro; en com legenda aceito) e `ENGLISH_RESOURCE_POLICY` (áudio original em inglês, tabela por banda CEFR, sem dublagem).
  - `Resource.lang` é o idioma FALADO ("und" quando desconhecido). O idioma do título fica em `Resource.titleLang` (campo opcional novo): é só uma dica, usada por domínios que aceitam dublagem; o inglês nunca a aceita como prova de áudio original.
  - Faixas de áudio marcadas "und" nunca decidem o idioma original (`languageOffer(r, { allowTitleHint })`).
- **Diversidade e espinha.** `mmr(candidates, sim, λ = 0,7)` usa `channelAwareSimilarity`, que penaliza em 0,3 o mesmo canal. `planRegionReading` / `chooseSpine` / `greedySetCover` escolhem o livro-espinha; τ < 0,5 gera aviso de ordem divergente. `kendallTau(a, b)` compara duas ordens estritas; `kendallTauByRank(ordem, rank)` aceita empates (nós ensinados na mesma seção) e usa só os pares comparáveis, (C − D)/(C + D).
- **Transcrição.** `parseTimedText` (json3/srv3/legado) → `normalizeCues` → `buildSegments` gera segmentos de 20–90 s com gap ≤ 4 s. Também: `segmentAt`, `parseDescriptionChapters`, `segmentsByChapter`.
- **Playlist.** `rankCandidates(candidates, ctx)` → `buildNodePlaylist(input)`. Depois: `fitBudget`, `nextSuggestion`, `remainingAfterNext`.
- **YouTube e embed.** `youtubeEmbedUrl(videoId, opts)` usa youtube-nocookie, `cc_lang_pref`, `hl` e `start`/`end`; `embedLanguageFor(policy, cefr)` escolhe idioma e legendas. Utilitários: `videoIdFromUrl`, `parseIsoDuration`, `selectCaptionTrack`.
- **Sumário e chunks.** `buildToc(raw, numPages)` aplica os invariantes I1–I3 de faixas de página; `validateToc`, `pageWindowToc`, `tocBreadcrumb` e `tocUnits` completam. `chunkSection` / `chunkText` fazem chunks de 300–800 tokens com 12% de sobreposição.
- **Ids e licenças.** `parseResourceId` / `makeResourceId` seguem `<prefixo>:<id>[#<tocId>]`; `parseLicense`, `isOpenLicense` e `isBundleable` tratam licenças.
- **Catálogo e texto.** `parseChannelCatalog`, `parseOpenBookCatalog`, `channelsForDomain`, `booksForDomain`, `trustedChannelIds`, `rankByMatch` e `guessLanguage`.

**Server** (`src/server/resources/index.ts`)

- **`createDefaultRegistry({ libraryRoot, stateDir?, youtubeApiKey, youtubeEnrichedOptIn, fetch?, cache?, clock?, now?, regionCode? })`** devolve um `ResourceRegistry` com as 11 fontes.
  - `statusAll()` diz o estado de cada fonte com motivo em pt-BR.
  - `live(kind?)` lista as fontes disponíveis por classe legal: `official_api` > `open_license` > `user_owned` > `metadata_only` > `embed_only` > `opt_in_gray`.
  - `search(q)` faz fan-out, deduplica e devolve `{ results, errors, asked }`. Nunca lança.
  - `resolve`, `toc` e `content` despacham pelo prefixo do id. Só caem para a próxima fonte quando o erro é `unavailable`.
- **`createResourceFetch({ baseFetch?, allowlist?, extraAllowedHosts?, timeoutMs?, maxBytes? })`** monta o fetch seguro:
  - só https, sem credenciais na URL;
  - allowlist por host, com blocklist por rótulo que vence a allowlist;
  - redirects manuais, revalidados a cada salto; `Authorization`, `Proxy-Authorization` e `Cookie` caem quando o salto muda de origem;
  - teto de bytes declarado e por stream, e timeout;
  - User-Agent genérico.
  - Funções auxiliares: `isAllowedHost`, `isBlockedHost`, `assertAllowedUrl`, `fetchJson`, `fetchText`.
- **Biblioteca local.** `importBookFile({ bytes, fileName, libraryRoot })` e `importFromUrl({ url, fetch, libraryRoot })` (este só para fontes abertas e allowlisted).
  - Gravam `<library>/<sha256>/` com `original.<fmt>`, `toc.json`, `chunks.jsonl` e `meta.json`, este último gravado por último.
  - PDF: outline com destinos explícitos e nomeados, início no meio da página e rótulos de página. Sem outline, usa janelas de 10 páginas.
  - EPUB: `container.xml` → OPF → nav/NCX → spine, com leitor ZIP próprio.
  - Leitura e manutenção: `listLibrary`, `readLibraryItem`, `readLibraryChunks`, `removeLibraryItem`, `writeBinaryAtomic`.
  - `content(id)` de uma seção sem chunks próprios (PDF com profundidade > 2, entrada de EPUB que divide o documento com outra) devolve os chunks da unidade que guarda o texto: o ancestral mais próximo com chunks, ou a entrada anterior dona do mesmo documento, filtrados pelas páginas da seção quando conhecidas.
- **Ponte do embed (Electron).** `withEmbedReferer(details, appId)` e `allowEmbedFullscreen(permission, url)`.
- **Ritmo e cota.** `RateGate` / `gatedFetch` deixam uma requisição em voo por fonte, com intervalo mínimo: Open Library e Crossref 1 s, arXiv 3 s. `DailyQuota` controla o YouTube: 100 buscas/dia e 10 000 unidades, renovadas à meia-noite do Pacífico.
- **Cache.** `FileTtlCache` / `MemoryTtlCache` (YouTube por 30 dias).
- **Sementes.** `loadResourceSeeds(dir?)`.

## Decisões

- **Lista branca no `fetch`.** A política legal vive no `fetch`, não em cada adaptador. Todo adaptador recebe o fetch allowlisted. Os domínios de bibliotecas-sombra são bloqueados por rótulo de host, então espelhos e TLDs novos também caem, e o bloqueio vence até uma allowlist injetada. Um redirect para esses domínios é recusado antes de a requisição sair.
- **YouTube oficial primeiro.**
  - A Data API usa a chave do próprio usuário (BYOK). Shorts, lives e vídeos não incorporáveis são descartados. O cache respeita os 30 dias dos termos.
  - O modo enriquecido (`youtubei.js`, cliente ANDROID → ANDROID_VR) é **opt-in**, fica desligado por padrão e é a última fonte da ordem. Ele recusa faixas que exigem PO token, em vez de contorná-las.
- **Inglês primeiro com o vídeo.** Na playlist de inglês o vídeo de input vem antes da explicação da IA. Na de eletrônica a IA vem primeiro.
- **Extrator de texto de PDF próprio** sobre `pdfjs-dist/legacy`. O de `src/agent/subagents/pdf-markdown.ts` não foi importado porque usa `findLast` e quebra o typecheck em ES2022, além de ser de outro módulo.
- **Páginas impressas não viram páginas físicas.** Números de página vindos do Open Library ou do Crossref entram só como `pageLabel`; o módulo não inventa faixa física.
- **Páginas fora do sumário viram texto do livro.** No PDF, páginas fora de qualquer unidade (prefácio, índice) viram seções do livro inteiro, uma por trecho contíguo, com `span.pages` próprio. Um filtro por páginas nunca devolve chunk sem página.
- **EPUB.** Cada documento da spine fica sob a primeira entrada do sumário que aponta para ele. Documentos sem entrada continuam a entrada anterior.
- **Licenças NC** (OpenStax NC, MIT OCW) são buscadas em tempo de execução para estudo pessoal e nunca embarcadas. MIT OCW fica `link-only`.
- **Privacidade.** O User-Agent é genérico e não há `mailto` no Crossref. Nome de arquivo e conteúdo da biblioteca nunca saem da máquina.
- **Ids de canal.** Os ids não puderam ser verificados nesta rodada. As sementes usam handles (`@...`) com `unverified: true`, e só três ids conhecidos estão preenchidos. `trustedChannelIds` só devolve ids verificados.

## Revisão adversarial (bugs corrigidos)

Cada correção tem um teste de regressão marcado `(regression)` no nome.

- **Segmentos.** O piso de 20 s olhava o tamanho do segmento JÁ somado ao próximo cue. Com cues de 5 s e frases a cada 15 s, isso cortava segmentos de 15 s, e a passada de fusão juntava tudo num bloco de 60 s. Agora o piso vale para o segmento atual, como no `build_segments` do DeepTutor.
- **Kendall τ.** Nós ensinados na mesma seção do livro-espinha recebiam ordem arbitrária e geravam τ = −1 e um aviso falso. Agora são empates e contam só os pares comparáveis.
- **Idioma do título.** A Data API punha `snippet.defaultLanguage` (idioma do título) em `lang`. Um vídeo de título em inglês sem `defaultAudioLanguage` passava como áudio original em inglês. Agora vai para `titleLang`.
- **Faixa "und".** Em vídeo de uma faixa só, o youtubei.js devolve `language: null` e `is_original: true`. A faixa virava "und" e escondia o idioma da legenda ASR (`audioLang` "und"; inglês dava 0). Agora "und" nunca decide o idioma.
- **Legendas desconhecidas.** `captionQuality` dava 0 quando a Data API não informa legendas, enquanto o language-fit supõe ASR. Vídeos sem legenda humana perdiam 20% de `qual`.
- **Confiança dobrada.** Livros usavam `link.score × confidence`, mas `link.score` já inclui a confiança. O campo `CandidateSignals.confidence` foi removido.
- **CEFR ≥ B2.** Subníveis CEFR-J (`B2.1`) não contavam como B2.
- **PDF vindo de `Buffer`.** `bytes.slice()` num `Buffer` é uma vista da mesma memória (muitas vezes do pool), e o pdfjs recusa `Buffer`. O import falhava no caminho Electron/IPC. Agora a cópia é um `Uint8Array` puro.
- **Seção profunda vazia.** `content()` de uma seção sem chunks próprios devolvia `[]`.
- **Remoção no Windows.** `fs.rmSync` ignora em silêncio caminhos com acentos (Node 24 no Windows): `removeLibraryItem` dizia `true` e deixava a pasta. Agora a remoção é recursiva com `unlinkSync`/`rmdirSync`.
- **Escrita do original.** Bytes idênticos não são regravados (um visualizador pode estar com o arquivo aberto). O temp tem nome único (UUID, `wx`) e o rename tenta de novo por cerca de 100 ms quando o Windows segura o arquivo, como em `src/store/atomic-write.ts`.
- **arXiv com versão.** `resolve("arxiv:2207.05872v2")` passava na validação e depois não achava a própria entrada.
- **Redirect entre origens.** Os redirects manuais mantinham `Authorization` e `Cookie`.
- **`fetchJson`.** Os headers do chamador passados como `Headers` ou lista se perdiam no spread.
- **Robustez.** A regex de controle/PUA do `toc.ts` usava os caracteres PUA literais, invisíveis. Agora usa escapes.

## Como testar

```
node scripts/run-tests.mjs "tests/resources-*.test.ts"
npx tsc --noEmit --allowImportingTsExtensions --strict --target es2022 --module esnext --moduleResolution bundler --verbatimModuleSyntax --noUncheckedIndexedAccess --skipLibCheck --types node src/core/resources/*.ts src/server/resources/*.ts tests/resources-*.test.ts tests/helpers/tiny-pdf.ts
```

São 7 arquivos e 92 testes, com `fetch` mockado e relógio falso (nenhuma rede real). Estado e biblioteca ficam em `os.tmpdir()`. O fast-check cobre as propriedades de score, Kendall com empates, segmentos (≥ 20 s), TOC, chunking e ordem do registro.

| Arquivo | Cobre |
|---|---|
| `resources-scoring` | Score e gates, language-fit (eletrônica e inglês), MMR, set cover e espinha. |
| `resources-content` | Segmentos, timedtext, legendas, capítulos, embed, ids, TOC, chunking e playlists. |
| `resources-safe-fetch` | Bloqueio de libgen, Anna's Archive, Z-Library e Sci-Hub; hosts oficiais liberados; redirects (sem credenciais entre origens), teto de bytes, timeout e headers do `fetchJson`. |
| `resources-youtube` | Fixtures da Data API e do InnerTube, cota e cache. |
| `resources-books` | Fixtures de OpenStax, LibreTexts, OTL, Open Library, Crossref, arXiv, Wikibooks e Kuphaldt. |
| `resources-library` | Import de PDF mínimo (`tests/helpers/tiny-pdf.ts`), PDF com outline, EPUB, ZIP e provider da biblioteca. |
| `resources-registry` | RateGate, registro, `createDefaultRegistry` e validação das sementes. |
