# unjs/unpdf: extração de PDF (pdf.js) para livros → capítulos → `Resource` ligados ao grafo

> **Escopo.** Analisa `unjs/unpdf`, clonado em `_refs/extra/unjs__unpdf` (commit `d809b22e`, 2026-11-15, versão `2.2.1`). Avalia o LiteParse (`@llamaindex/liteparse` e `-wasm`) para layout. Propõe o modelo `Resource{source, location, coversNodes[]}` no formato metacademy-content e um plano de integração no learnharness (Next.js 16 + Electron 44 + TS, AGPL-3.0).
> **Método.** Li por completo todo `src/`, os testes, `pdfjs.rolldown.config.ts`, os plugins rolldown, os polyfills, o README, o LICENSE e a skill `.agents/skills/upgrade-pdfjs`. Conferi as APIs de outline e destinos no `pdfjs-dist@6.3.289` já instalado no learnharness (`node_modules/pdfjs-dist/legacy/build/pdf.mjs` e `pdf.worker.mjs`). Também li o código PDF que o learnharness já tem (`src/agent/subagents/pdf-*.ts`, `next.config.ts`). **Nada do repositório de referência foi executado**: sem install, build ou testes.
> **Data de referência:** 2026-11-18.

---

## 0. TL;DR

1. **unpdf 2.2.1** (MIT, ~1 kLOC de TS, zero `dependencies`) é um *wrapper* fino sobre o PDF.js. Tem duas camadas:
   - (a) funções de alto nível: `extractText`, `extractTextItems`, `extractLinks`, `extractImages`, `renderPageAsImage`, `inspectPages`, `getMeta`, `getDocumentProxy`;
   - (b) um **build "serverless" do PDF.js 6.5.438**, empacotado com Rolldown, com o worker embutido, *patches* de fonte e polyfills. Ele roda em Node 24+, Bun, browser e Cloudflare Workers.
2. **O unpdf NÃO expõe outline/bookmarks** (`getOutline`), nem *page labels* nem destinos. O issue tracker tem 0 resultados para "outline". O relatório `r8-descoberta-repos.md` (linha 39) sugere o contrário e **está impreciso**. Para obter capítulos, chame `pdf.getOutline()` direto no `PDFDocumentProxy` (o retorno de `getDocumentProxy` é o proxy nativo do PDF.js). Depois resolva cada destino com `getDestination`, `cachedPageNumber` e `getPageIndex`. O §5 traz o algoritmo completo.
3. **O learnharness já usa `pdfjs-dist@6.3.289` (build `legacy`) diretamente**:
   - `src/agent/subagents/pdf-ops.ts`;
   - `pdf-markdown.ts`, um PDF→Markdown por regras melhor que o `extractText` do unpdf;
   - `headless.ts`, que renderiza com `@napi-rs/canvas`;
   - `next.config.ts`, que marca `pdfjs-dist` como `serverExternalPackages`.

   Adicionar o unpdf com o build serverless **duplicaria o PDF.js** (6.3 + 6.5) e rodaria o parsing na thread principal.
4. **Recomendação (Opção A):** não adotar o unpdf como dependência agora. **Portar quatro peças MIT**, cerca de 400 linhas, com cabeçalho de atribuição:
   - `walkOperatorList` (`src/_internal/operator-list.ts`);
   - `inspectPages` com `getCoverage` (`src/inspect.ts`), que detecta páginas escaneadas e camada OCR muito melhor que o `pdfInfo` atual;
   - os *defaults* de `getDocumentProxy` (`src/utils.ts`): `cMapUrl`, `wasmUrl`, `standardFontDataUrl` resolvidos via `import.meta.resolve` e `Buffer`→`Uint8Array`;
   - `getMeta` com `parseDates` (`src/meta.ts`).

   Escrever um módulo **novo**, `pdf-outline.ts` (outline → árvore de capítulos com intervalos de páginas e *page labels*), e o modelo `Source`/`Resource`. A **Opção B** (usar o unpdf com `definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'))`) é viável se preferirem dependência a cópia: veja o §7.
5. **LiteParse** (Apache-2.0, Rust + PDFium, 2.20.0) **também não tem outline**. Vale como camada **opcional** para três coisas:
   - layout (blocos `heading`, `table`, `list_item` com bbox e ordem de leitura);
   - `isComplex()` (triagem `needsOcr`);
   - OCR Tesseract embutido, só no pacote Node nativo.

   O pacote `-wasm` serve para o browser/renderer, sem Tesseract (OCR só via `ocrEngine` próprio). Use-o atrás de uma interface `LayoutParser`, com *pool* e `parseTimeoutMs`.
6. **Licenças:** unpdf é MIT; PDF.js é Apache-2.0; os decoders JBIG2/OpenJPEG/QCMS são BSD/Apache/MIT; LiteParse é Apache-2.0. **Todos são compatíveis com AGPL-3.0** em incorporação: Apache-2.0 → (A)GPLv3 é compatível em sentido único. Mantenha os avisos de copyright e o LICENSE/NOTICE.

---

## 1. Metadados do repositório

| Item | Valor |
|---|---|
| Repo | https://github.com/unjs/unpdf (org UnJS; autor Johann Schopplich) |
| Commit analisado | `d809b22e57e6a83a8f6b79b6dcad5348bfd14fcd`, 2026-11-15 |
| Versão npm | `unpdf@2.2.1` (`latest`). Publicada por GitHub Actions (OIDC *trusted publishing*) com proveniência SLSA v1. `unpackedSize` ≈ 3,14 MB em 177 arquivos. |
| Licença | **MIT**, "Copyright (c) 2023-PRESENT Johann Schopplich" (`LICENSE`) |
| PDF.js embutido | `pdfjs-dist ~6.5.438` (devDependency; o bundle vai em `dist/pdfjs.mjs`). As licenças são copiadas para `dist/licenses/` (`LICENSE_PDFJS`, `LICENSE_*JBIG2`, `LICENSE_*OPENJPEG`). |
| `dependencies` | nenhuma |
| `peerDependencies` (opcionais) | `pdfjs-dist: *` e `@napi-rs/canvas: ^0.1.69 \|\| ^1.0.0` |
| `engines` | `node >= 24`. ESM-only desde a 2.0.0 (2026-10-28). |
| CI | Node 24, Node 26, Node 24 no Windows, Bun e Cloudflare Workers (`.github/workflows/ci.yml`) |
| Stars | ~1,3k (segundo o r8; não reverifiquei, pois o orçamento de busca acabou) |

**Histórico recente (página de releases, 2026):**

- **2.2.1** (15/11): texto e links são processados página a página.
- **2.2.0** (14/11):
  - PDF.js 6.5;
  - polyfills de `Uint8Array.fromBase64` e `toBase64`;
  - workerd tratado como runtime sem canvas;
  - aceita `Buffer`;
  - `pdfjs-dist` passa a ser *peer* opcional.
- **2.1.0** (30/10): `registerImageDecoders`.
- **2.0.0** (28/10), quebra de compatibilidade:
  - exige Node 24 e passa a ser ESM-only;
  - `definePDFJSModule` passa a ser *lazy*;
  - `extractLinks` retorna `string[][]`;
  - `renderPageAsImage` retorna `Uint8Array`;
  - novo `inspectPages`;
  - `extractImages` passa a incluir imagens *inline* e máscaras, com `bounds`.

---

## 2. Arquitetura

```
                ┌──────────────────────── unpdf (src/, tsdown → dist/index.mjs) ───────────────────────┐
 Uint8Array ──► │ getDocumentProxy(data, opts)  ──►  getResolvedPDFJS()  ──►  import('unpdf/pdfjs')     │
 ArrayBuffer    │      │ nodeDefaults (fonts/cmaps/wasm do pdfjs-dist local)     ou definePDFJSModule(…) │
 Buffer         │      ▼                                                                                  │
 PDFDocument-   │ withDocument(data, op)  — cria/destrói o proxy SE foi criado aqui                       │
 Proxy          │   ├─ extractText / extractTextItems  (getTextContent por página, sequencial)            │
                │   ├─ extractLinks                    (getAnnotations → subtype Link → url)             │
                │   ├─ getMeta                         (pdf.getMetadata + PDFDateString)                 │
                │   ├─ inspectPages ──┐                                                                    │
                │   ├─ extractImages ─┼─► walkOperatorList (pilha de estado gráfico, OC, soft mask)       │
                │   └─ renderPageAsImage (pdf.canvasFactory + @napi-rs/canvas | DOM canvas)              │
                └──────────────────────────────────────────────────────────────────────────────────────────┘
                ┌──────────────── build serverless do PDF.js (rolldown → dist/pdfjs.mjs) ─────────────────┐
                │ mocks.mjs (DOMMatrix stub, FinalizationRegistry, navigator)                              │
                │ polyfills.mjs (Promise.try, Map.getOrInsert[Computed], Math.sumPrecise, toHex, base64…)  │
                │ import 'pdfjs-dist/build/pdf.worker.mjs'  → worker inline em globalThis.pdfjsWorker       │
                │ patches literais no fonte do PDF.js (âncoras verificadas no buildEnd)                    │
                │ decoders JBIG2/OpenJPEG como chunks lazy (#pdfjs-decoders; variante workerd só JS)       │
                └──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Mapa de arquivos (linhas)

| Arquivo | LOC | Papel |
|---|---|---|
| `src/index.ts` | 13 | Re-exports públicos |
| `src/utils.ts` | 168 | `getDocumentProxy`, `withDocument`, `definePDFJSModule`, `getResolvedPDFJS`, `isPDFDocumentProxy`, `interopDefault`, `isNode`, `canCompileWasm`, `isNodeProcess` |
| `src/text.ts` | 126 | `extractText` (*overloads* por `mergePages`), `extractTextItems`, `normalizeMergedText` |
| `src/meta.ts` | 84 | `getMeta`, `PDFInfo<DateValue>`, `parseISODateString` |
| `src/links.ts` | 34 | `extractLinks` |
| `src/inspect.ts` | 157 | `inspectPages`, `PageInspection`, `getCoverage` (área da união de retângulos) |
| `src/image.ts` | 310 | `extractImages`, `renderPageAsImage`, `toRGBA`, `getPageObject`, `prepareCanvasEnvironment` |
| `src/image-decoders.ts` | 16 | `registerImageDecoders` (registra o *loader* em `Symbol.for('unpdf.loadImageDecoder')`) |
| `src/_internal/operator-list.ts` | 143 | `walkOperatorList` (gerador), `getUnitSquareBounds`, `multiplyMatrices`, tipos `Matrix`, `Bounds`, `Operation` |
| `src/_internal/png.ts` | 92 | `encodePNG`: PNG RGBA 8-bit sem filtro, deflate via `CompressionStream`, CRC32 |
| `src/_internal/canvas.ts` | 44 | `resolveCanvasModule`, `injectCanvasConstructors` (DOMMatrix/Path2D do `@napi-rs/canvas`) |
| `src/_internal/dommatrix-polyfill.ts` | 47 | Stub mínimo de `DOMMatrix` (`translateSelf`, `scaleSelf`) |
| `src/pdfjs-serverless/index.mjs` | 6 | Entrada do bundle: mocks → polyfills → worker → `export * from 'pdfjs-dist/build/pdf.mjs'` |
| `src/pdfjs-serverless/polyfills.mjs` | 199 | Polyfills de APIs ES2025+ que o PDF.js 6.x usa |
| `src/pdfjs-serverless/rolldown/plugins.ts` | 178 | `patchPDFJSSource` (substituições literais + verificação de âncoras), `assertRuntimePatchesFirst`, `pdfjsTypes` |
| `src/pdfjs-serverless/decoders/*.mjs` | 28 | `createDecoderLoader`; variantes `default` (WASM + JS) e `workerd` (só JS) |
| `pdfjs.rolldown.config.ts` | ~55 | Minificação com `keepNames` (o PDF.js lê nomes de classe em runtime) e `moduleSideEffects` explícito |
| `test/*.test.ts` | ~600 | Vitest em dois *projects* (node, workerd); *fixtures* feitas à mão em `scripts/generate-fixtures.ts` |

---

## 3. API pública (exata)

`data` aceita `DocumentInitParameters['data'] | PDFDocumentProxy` em todas as funções. `pageNumber` começa em 1.

| Função | Assinatura (resumida) | Observações |
|---|---|---|
| `getDocumentProxy` | `(data, options?: DocumentInitParameters) => Promise<PDFDocumentProxy>` | `useSystemFonts: true`, `useWasm: canCompileWasm()`. Em Node com `pdfjs-dist` instalado, usa `nodeDefaults` (§4.1). As opções do chamador sobrescrevem tudo. |
| `extractText` | `(data, { mergePages?: boolean }) => Promise<{ totalPages, text: string \| string[] }>` | *Overloads* tipados: com `mergePages: true`, `text` é `string`. |
| `extractTextItems` | `(data) => Promise<{ totalPages, items: StructuredTextItem[][] }>` | `StructuredTextItem = { str, x, y, width, height, fontSize, fontFamily, dir: 'ltr'\|'rtl'\|'ttb', hasEOL }`. `x`/`y` em espaço PDF, com origem embaixo à esquerda. |
| `extractLinks` | `(data) => Promise<{ totalPages, links: string[][] }>` | Só anotações `Link` com `url`. **Links internos (`dest`) são ignorados.** |
| `extractImages` | `(data, pageNumber, { format?: 'rgba'\|'png' }) => Promise<ExtractedImage[]>` | `ExtractedImage = { data, width, height, key: string\|null, bounds: Bounds }` |
| `renderPageAsImage` | `(data, pageNumber, { canvasImport?, scale?, width?, height?, format?: 'png'\|'jpeg'\|'webp', quality?, toDataURL? })` | Em Node exige `canvasImport: () => import('@napi-rs/canvas')`. |
| `inspectPages` | `(data) => Promise<{ totalPages, pages: PageInspection[] }>` | `PageInspection = { textLength, invisibleTextLength, imageCount, imageCoverage }` |
| `getMeta` | `<P extends boolean>(data, { parseDates?: P }) => Promise<{ info: PDFInfo<P extends true ? Date\|null : string>, metadata: Metadata \| null }>` | `PDFInfo`: `PDFFormatVersion`, `Language`, `IsLinearized`, …, `Title`, `Author`, `Subject`, `Keywords`, `Creator`, `Producer`, `CreationDate`, `ModDate`, `Custom: Map` |
| `definePDFJSModule` | `(loader: () => Promise<any>) => void` | Troca o build do PDF.js; carrega no primeiro uso. |
| `getResolvedPDFJS` | `() => Promise<typeof PDFJS>` | Dá acesso direto a `OPS`, `ImageKind`, `PDFDateString`, `version`… |
| `registerImageDecoders` | `() => void` | Necessário apenas para decodificar CCITT, JBIG2 e JPX via API direta do PDF.js no build serverless. |

**Ausentes:** `getOutline`, `getPageLabels`, `getDestination(s)`, `getStructTree`, `getAttachments` e formulários. Todos estão disponíveis no `PDFDocumentProxy` retornado.

---

## 4. Algoritmos e decisões-chave (com trechos curtos)

### 4.1 `getDocumentProxy`: *defaults* robustos para Node (`src/utils.ts`)

Pontos que o learnharness **não** cobre hoje:

- **`Buffer` → `Uint8Array`:** o PDF.js rejeita `Buffer`, embora `Buffer` seja subclasse de `Uint8Array`. O unpdf converte assim: `new Uint8Array(data.buffer, data.byteOffset, data.byteLength)`.
- **Recursos locais via `import.meta.resolve`**, não via caminho relativo a `node_modules`:

  ```ts
  const pdfjsDir = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')))
  nodeDefaults = {
    useSystemFonts: false,
    standardFontDataUrl: `${join(pdfjsDir, 'standard_fonts')}/`,
    cMapUrl: `${join(pdfjsDir, 'cmaps')}/`,   // CJK sem /ToUnicode
    cMapPacked: true,
    wasmUrl: `${join(pdfjsDir, 'wasm')}/`,    // JBIG2/OpenJPEG/QCMS (livros escaneados!)
  }
  ```

  Confirmei no PDF.js 6.3.289 instalado: `getFactoryUrlProp` (`legacy/build/pdf.mjs` L15097) **lança erro** se a URL não termina em `/`. Por isso usa-se `` `${join(...)}/` `` e não `path.sep`. O learnharness já aprendeu isso para `standardFontsDir()`, mas **não passa `cMapUrl` nem `wasmUrl`**. Consequências: texto CJK com CMap predefinida sai vazio, e imagens JBIG2/JPEG 2000 (típicas de livros escaneados) podem não decodificar no `pdf_render`. Verificar com a *fixture* `image-decoders.pdf`.
- **`canCompileWasm()`:** testa com `new WebAssembly.Module(<8 bytes mágicos>)` e passa `useWasm: false` onde o runtime proíbe WASM, evitando *warnings*.
- **`isNodeProcess`** replica a regra do próprio PDF.js (`legacy/build/pdf.mjs` L6277): `process` real, sem NW.js e **sem processo Electron cujo `process.type !== 'browser'`**. Consequências no Electron:
  - processo *main* (`type === 'browser'`): Node;
  - *renderer*: DOM;
  - `utilityProcess` (`type === 'utility'`): **DOM, sem fontes nem CMaps locais**;
  - filho com `ELECTRON_RUN_AS_NODE=1` (`type` indefinido): Node. É o caso do servidor Next do learnharness (`electron/main.cjs` L216–227), portanto OK.

### 4.2 `withDocument`: posse do documento

```ts
const pdf = isPDFDocumentProxy(data) ? data : await getDocumentProxy(data, options)
try { return await operation(pdf) }
finally { if (pdf !== data) await pdf.loadingTask.destroy() }
```

Regra: **quem cria destrói**. Um *proxy* passado pelo chamador nunca é destruído, e `inspectPages` só chama `page.cleanup()` em documentos próprios (`shouldReleasePages`). Há testes disso em `test/document.test.ts` e `test/inspect-pages.test.ts`. `isPDFDocumentProxy` usa a heurística `'_pdfInfo' in data`.

### 4.3 Texto

- `getPageText`: concatena `item.str + (item.hasEOL ? '\n' : '')`, **página por página e em sequência**. O comentário do código: buscar todas as páginas de uma vez multiplica o pico de memória sem terminar antes.
- `normalizeMergedText`: `join('\n')`, depois colapsa espaços horizontais (`/[^\S\n]+/g → ' '`), apara espaços junto a `\n` e limita a no máximo uma linha em branco (`/\n{3,}/g → '\n\n'`).
- `extractTextItems`: `[a,b,c,d,e,f] = item.transform`, com `x = e`, `y = f` e `fontSize = Math.hypot(c, d)`. O `pdf-markdown.ts` do learnharness usa `hypot(a, b)`. As duas fórmulas só coincidem com escala uniforme; com `Tz` (escala horizontal) ou *skew*, `hypot(c, d)` é a altura real da fonte. `fontFamily` vem de `content.styles[item.fontName]`.
- **Avaliação:** o `documentToMarkdown` do learnharness (`src/agent/subagents/pdf-markdown.ts`) é **superior** para aulas. Ele detecta cabeçalhos por tamanho relativo ao corpo, listas, colunas, RTL e título primeiro. Não substitua por `extractText`.

### 4.4 `getMeta`

O PDF.js mantém em cache o resultado de `pdf.getMetadata()`. Por isso o unpdf **copia** `info` antes de converter datas (`PDFDateString.toDateObject`). Para o XMP, reconstrói um `Metadata` novo pela classe da instância (`metadata.constructor`), convertendo só `xmp:/xap:` `createdate`, `modifydate` e `metadatadate`. O teste "leaves the cached metadata of a reused document unparsed" garante que nada é mutado. **Útil para `Source.title/authors/year`** na ingestão de livros: muitos PDFs trazem `Title` lixo (por exemplo, "Microsoft Word - cap1.docx"), então trate como dica, não como verdade.

### 4.5 `walkOperatorList`: estado gráfico (`src/_internal/operator-list.ts`)

O gerador percorre `operatorList.fnArray/argsArray` mantendo:

- **pilha de CTM**: `save`/`restore`; `transform` concatena; `paintFormXObjectBegin` empilha e aplica a `/Matrix`; `beginAnnotation` parte do estado base mapeado em `annotationTransform × appearanceMatrix`;
- **`textRenderingMode`** (`Tr`): os modos 3 e 7 não pintam glifos, o que é típico de camada OCR;
- **visibilidade por *optional content***: `beginMarkedContentProps` com tag `'OC'` → `optionalContentConfig.isVisible(props)`;
- **soft masks**: operações dentro de `beginGroup` com `smask` são puladas, porque só modulam transparência.

`getUnitSquareBounds(transform)` projeta o quadrado unitário (onde imagens PDF são pintadas) e devolve a AABB. `multiplyMatrices(outer, inner)` segue a semântica de `cm`. O código é pequeno, puro e **ideal para copiar**.

### 4.6 `inspectPages` + `getCoverage`: triagem de escaneados (`src/inspect.ts`)

Medidas por página:

- `textLength`: caracteres sem espaço de todos os `items[].str`, contados com `Array.from`, que conta *code points*;
- `invisibleTextLength`: soma de `glyph.unicode` em `showText` com `!isVisible || Tr ∈ {3,7}`;
- `imageCount` e `imageCoverage`: área da **união** das AABBs das imagens visíveis, recortadas à `page.view`.

`getCoverage` é uma *sweep* exata: corta a página em *slabs* verticais em cada borda x, e em cada *slab* une os intervalos y ordenados. A complexidade é O(n² log n), trivial para n pequeno. A heurística sugerida no README é `textLength - invisibleTextLength < 20 && imageCoverage > 0.8` → "precisa de OCR". **Calibrar** com os livros reais de Eletrônica e Inglês.

**Comparação:** o `pdfInfo` do learnharness conta só `OPS.paintImageXObject`. Ele ignora imagens *inline*, máscaras, conteúdo oculto e soft masks, e não distingue texto OCR invisível.

### 4.7 Imagens e PNG

- `extractImages`: percorre o *walker*. Para `paintImageXObject` e `paintImageMaskXObject`, pega o objeto via `page.objs` ou `page.commonObjs` (o prefixo `g_` indica objeto compartilhado). Para `paintInlineImageXObject`, usa `args[0]`. Depois `toRGBA` copia sempre para um buffer novo (sem *alias* com o cache do PDF.js) e trata `RGBA_32BPP`, `RGB_24BPP` e 1-bit (`GRAYSCALE_1BPP` e máscara). O chamador deve forçar `isOffscreenCanvasSupported: false, isImageDecoderSupported: false`; sem isso, o browser entrega `ImageBitmap` sem pixels.
- `encodePNG`: PNG sem filtro, IDAT via `new CompressionStream('deflate')` (zlib, não `deflate-raw`) e CRC32 por tabela. **Zero dependências**, útil para extrair figuras de livros como assets de aula sem canvas.

### 4.8 `renderPageAsImage`

- Usa `pdf.canvasFactory`, a fábrica do documento, que também serve canvases intermediários (soft masks, grupos, padrões).
- Em Node exige `canvasImport`. Injeta `DOMMatrix`/`Path2D` do `@napi-rs/canvas` em `globalThis`.
- `assertEncodedType` detecta browsers que caem para PNG (WebP no Safari).
- O learnharness **já tem** um equivalente melhor integrado (`headless.ts`, com limite de memória do canvas). Não portar.

### 4.9 Build serverless (só relevante se formos *vendorizar*)

- `patchPDFJSSource`: substituições **literais** no fonte do PDF.js, por exemplo:
  - `#isWorkerDisabled = false` → `true`;
  - `await import(this.workerSrc)` → `globalThis.pdfjsWorker`;
  - `require("@napi-rs/canvas")` → Proxy sobre `Symbol.for("unpdf.canvasModule")`;
  - o *fetch* do WASM → *loader* registrado.

  O `buildEnd` **falha o build** se alguma âncora não casou, o que denuncia *drift* do PDF.js. É um bom padrão para qualquer *patch* que façamos em dependências.
- `assertRuntimePatchesFirst`: garante que `mocks.mjs`/`polyfills.mjs` não foram removidos por *tree-shaking* e que são avaliados antes do primeiro módulo `pdfjs-dist`.
- Minificação com `keepNames` (o PDF.js lê `constructor.name`).
- Para nós (Electron + Node, com `pdfjs-dist` *external*), **nada disso é necessário**: o build `legacy` do `pdfjs-dist` já traz polyfills e roda com *fake worker* em Node.

---

## 5. O que falta no unpdf e como fazer: outline → capítulos

### 5.1 Fatos verificados no PDF.js 6.3.289 instalado

- `PDFDocumentProxy.getOutline()` (`types/src/display/api.d.ts` L1014) retorna nós `{ title, bold, italic, color, dest: string | any[] | null, url, unsafeUrl, newWindow, count, items }`. O worker (`#readDocumentOutline`, `legacy/build/pdf.worker.mjs` ~L46770) também inclui `action`, `attachment`, `attachmentId` e `setOCGState`.
- **Retorna `null`, não `[]`, quando não há outline** (`return root.items.length > 0 ? root.items : null`). O tipo TS mente.
- A leitura é BFS com `RefSet` de processados, portanto **imune a ciclos**, e preserva a ordem dos irmãos. `title` vira `""` se não for string, e há *warning* "Invalid outline item encountered".
- `dest` pode ser:
  - **string** (destino nomeado): resolver com `pdf.getDestination(name)`;
  - **array explícito** `[pageRef, {name}, ...args]`. `pageRef` é `RefProxy {num, gen}` ou, em PDFs quebrados, um inteiro (índice 0-based).
- Página: `pdf.cachedPageNumber(ref)` (L22287/23553) retorna o número **1-based** só se a página já foi carregada. Caso contrário, use `(await pdf.getPageIndex(ref)) + 1` (0-based → 1-based).
- Modos de destino: `XYZ left top zoom`, `Fit`, `FitH top`, `FitV left`, `FitR left bottom right top`, `FitB`, `FitBH top`, `FitBV left`. O `top` dá a **posição vertical** onde a seção começa, permitindo cortar no meio da página.
- `pdf.getPageLabels()` → `string[] | null`, indexado por índice 0-based. Liga números **impressos** ("pages 744-748" no estilo Metacademy, "xii") a índices do PDF.

### 5.2 Algoritmo (novo `src/agent/subagents/pdf-outline.ts`, código nosso)

```ts
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface OutlineChapter {
  id: string;               // "2.3.1" — caminho 1-based na árvore (estável p/ o mesmo PDF)
  depth: number;            // 0 = topo
  title: string;
  startPage: number | null; // 1-based; null = destino não resolvível
  startTop: number | null;  // y (espaço PDF) do destino XYZ/FitH/FitR, p/ cortar no meio da página
  endPage: number | null;   // inclusivo
  printed?: { start?: string; end?: string }; // page labels
  url?: string | null;      // item que aponta p/ URL externa (raro em livros)
  children: OutlineChapter[];
}

type Dest = string | unknown[] | null | undefined;

async function resolveDest(pdf: PDFDocumentProxy, dest: Dest) {
  if (dest == null) return null;
  const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || explicit.length === 0) return null;
  const [ref, mode, ...args] = explicit as [unknown, { name?: string } | undefined, ...unknown[]];
  let page: number | null = null;
  if (ref && typeof ref === "object") {
    page = pdf.cachedPageNumber(ref as { num: number; gen: number });
    if (page == null) {
      try { page = (await pdf.getPageIndex(ref as { num: number; gen: number })) + 1; } catch { page = null; }
    }
  } else if (Number.isInteger(ref)) {
    page = (ref as number) + 1;
  }
  if (page == null || page < 1 || page > pdf.numPages) return null;
  const name = mode?.name;
  const top = name === "XYZ" ? args[1] : name === "FitH" || name === "FitBH" ? args[0] : name === "FitR" ? args[3] : null;
  return { page, top: typeof top === "number" ? top : null };
}

export async function extractOutline(pdf: PDFDocumentProxy): Promise<OutlineChapter[] | null> {
  const raw = await pdf.getOutline();           // null quando não há outline
  if (!raw) return null;
  const labels = await pdf.getPageLabels();     // null quando não há /PageLabels
  const flat: OutlineChapter[] = [];

  async function walk(nodes: typeof raw, depth: number, prefix: string): Promise<OutlineChapter[]> {
    const out: OutlineChapter[] = [];
    for (const [i, n] of nodes.entries()) {
      const r = await resolveDest(pdf, n.dest as Dest);
      const ch: OutlineChapter = {
        id: prefix ? `${prefix}.${i + 1}` : `${i + 1}`,
        depth,
        title: normalizeTitle(n.title) || `(sem título ${i + 1})`,
        startPage: r?.page ?? null, startTop: r?.top ?? null, endPage: null,
        url: n.url, children: [],
      };
      flat.push(ch);                                   // pré-ordem
      ch.children = await walk(n.items ?? [], depth + 1, ch.id);
      // "Parte I" sem destino herda a 1ª página resolvida de um descendente
      if (ch.startPage == null) {
        const firstChild = findFirst(ch.children, (c) => c.startPage != null);
        if (firstChild) { ch.startPage = firstChild.startPage; ch.startTop = firstChild.startTop; }
      }
      out.push(ch);
    }
    return out;
  }
  const tree = await walk(raw, 0, "");

  // Fim = (início do próximo nó em pré-ordem com depth <= d e página > início) - 1.
  // Se o próximo começa no meio da página (top abaixo do topo útil), a página é compartilhada.
  for (let i = 0; i < flat.length; i++) {
    const c = flat[i]!;
    if (c.startPage == null) continue;
    let end = pdf.numPages;
    for (let j = i + 1; j < flat.length; j++) {
      const n = flat[j]!;
      if (n.depth <= c.depth && n.startPage != null && n.startPage >= c.startPage) {
        end = n.startPage - 1;
        if (n.startPage > c.startPage && startsMidPage(n)) end = n.startPage; // página compartilhada
        break;
      }
    }
    c.endPage = Math.max(c.startPage, end);
    if (labels) c.printed = { start: labels[c.startPage - 1] ?? undefined, end: labels[c.endPage - 1] ?? undefined };
  }
  return tree;
}
// normalizeTitle: NFC, remove controles/PUA (reaproveitar `clean` de pdf-markdown.ts), trim, colapsa espaços.
// startsMidPage(n): n.startTop != null && n.startTop < (altura da página − margem ≈ 0.85·h) → requer page.view[3].
```

**Invariantes**, a testar com testes de propriedade (por exemplo `fast-check`) e candidatos às "provas" da meta 1:

1. `startPage ≤ endPage` para todo nó resolvido.
2. **Contenção:** `[child.start, child.end] ⊆ [parent.start, parent.end]`.
3. **Irmãos quase disjuntos:** `sib[k].end ≤ sib[k+1].start`, compartilhando no máximo uma página.
4. **Cobertura:** a união dos nós de topo cobre `[primeiro.start, numPages]`.
5. **Ordem:** se o outline não for monotônico (por exemplo, apêndices marcados antes), registrar `warnings` e, só para o cálculo de intervalos, reordenar irmãos por `(startPage, -startTop)`.

### 5.3 Granularidade (capítulo × seção)

- Se o topo tem ≤ 6 nós e todos têm filhos, e o título casa `/^(part|parte|livro|unit|unidade)\b/i`, **o "capítulo" é o depth 1**.
- Livros-texto de engenharia costumam ter 3–4 níveis (capítulo, seção, subseção). Para `Resource`, use **seção (depth 1–2) como unidade de ligação a nós** e o capítulo como região agregada (§6).

### 5.4 Fatiar o texto de uma seção

- Páginas `[startPage, endPage]` → `documentToMarkdown(doc, pages)`, reaproveitando o `pdf-markdown.ts` existente.
- Página inicial com `startTop`: manter só itens com `y ≤ startTop + ~1·fontSize`.
- Página final compartilhada: manter só itens com `y > next.startTop`.

Para isso, `pdf-markdown` precisa expor um filtro de linhas por faixa de `y`. Hoje `Line.y` já existe internamente (`interface Line { y: number }`).

### 5.5 Fallback quando não há outline (comum em escaneados e PDFs "impressos")

Use esta ordem:

1. **Página de sumário:** nas ~30 primeiras páginas, detectar a página cujo cabeçalho casa `/(contents|sumário|índice|table of contents)/i` e extrair linhas `^(.*?)[\s.·…]{2,}(\d+|[ivxlcdm]+)$`. Depois mapear página impressa → índice via `getPageLabels()` ou via **offset** inferido. Para inferir o offset, ache a página cujo primeiro cabeçalho grande casa *fuzzy* com o título do capítulo 1. Um LLM barato pode limpar o sumário, em saída estruturada.
2. **Cabeçalhos tipográficos:** o `levelOf` do `pdf-markdown.ts` (nível 1 = `size ≥ 1.6·body`) mais o regex `/^(chapter|capítulo|cap\.|part|parte|lesson|unit)\s+[\divxlc]+/i`.
3. **LiteParse** `blocks[kind=heading, level]` (§8).
4. **Escaneado** (`inspectPages`) → OCR (LiteParse + Tesseract) → volta ao passo 1.
5. Último recurso: janelas fixas de N páginas, com `provenance.method = 'window'`.

---

## 6. Modelo de dados: `Source` e `Resource` no formato metacademy-content

### 6.1 O formato original (metacademy-content, CC-BY-SA 3.0, descontinuado em 2017)

**Catálogo global** (`resources.txt` na raiz). Blocos `chave: valor`; 14 campos: `key`, `title`, `authors`, `edition_years`, `year`, `url`, `specific_url_base`, `resource_type` (`textbook`, `online textbook`, `online lectures`…), `free`, `requires_signup`, `level`, `description`, `extra`, `note`.

```
key: bishop
title: Pattern Recognition and Machine Learning
resource_type: textbook
level: graduate
```

**Por conceito** (`concepts/<tag>/resources.txt`). Um bloco por fonte, com **vários `location:`** permitidos:

```
source: bishop
edition: 1
location: Sections 5.2-5.3, pages 232-249
core: 1

source: coursera_hinton
location: Lecture "The backpropagation algorithm"
core: 1
```

Na prática, o Metacademy guarda a ligação **conceito → recursos**. Nós invertemos para **recurso → região** (`coversNodes[]`), sem perder a consulta reversa, via índice.

### 6.2 Tipos propostos (`src/core/resources.ts`, novo)

```ts
export type NodeId = string;
export type DomainId = string;           // sessão/domínio isolado (meta 3): "english", "electronics"

/** ≈ bloco do resources.txt global do Metacademy. */
export interface Source {
  id: string;                            // key — slug estável, ex.: "sedra-smith-8e"
  domainId: DomainId;
  kind: "book" | "video" | "playlist" | "course" | "article" | "ai-lesson";  // resource_type
  title: string;
  authors?: string[];
  edition?: number; editionYears?: number[]; year?: number;
  url?: string; specificUrlBase?: string;
  free?: boolean; requiresSignup?: boolean;
  level?: "intro" | "undergrad" | "advanced-undergrad" | "graduate" | "phd";
  language: string;                      // BCP-47: "pt-BR", "en"
  description?: string; note?: string;
  /** Livro/PDF local: identidade por conteúdo, não por caminho. */
  file?: {
    sha256: string; path: string; bytes: number; pageCount: number;
    pageLabels?: (string | null)[] | null;
    meta?: { title?: string; author?: string; creationDate?: string; producer?: string }; // getMeta
    scannedPages?: number[];             // inspectPages
    outline?: OutlineChapter[] | null;   // §5 — cache da árvore
  };
  /** Vídeo/playlist: id + idioma da faixa/legenda (relatório de YouTube). */
  video?: { platform: "youtube"; id: string; durationSec: number; captions?: string[]; dubbed?: string[] };
}

export interface PageRange {
  from: number; to: number;              // 1-based, inclusivo (índices do PDF)
  fromTop?: number | null;               // corte no meio da página (espaço PDF)
  toBeforeTop?: number | null;
  printed?: { from?: string; to?: string }; // page labels — o "pages 744-748" do Metacademy
}

/** ≈ cada linha `location:`; vários por Resource. */
export type ResourceLocation =
  | { kind: "chapter"; outlineId: string; title: string; depth: number; pages: PageRange }
  | { kind: "pages"; pages: PageRange; label?: string }                 // "Sections 5.2-5.3"
  | { kind: "timestamp"; startSec: number; endSec: number; chapterTitle?: string }
  | { kind: "freeform"; text: string };                                 // import legado do Metacademy

/** ≈ bloco de concepts/<tag>/resources.txt, invertido: um recurso cobre uma REGIÃO. */
export interface Resource {
  id: string;                            // hash(sourceId + locations) — idempotente
  sourceId: string;
  domainId: DomainId;
  edition?: number;
  locations: ResourceLocation[];
  coversNodes: NodeId[];                 // região (livro: muitos nós; vídeo: poucos)
  coverage?: Record<NodeId, { weight: number; role: "introduces" | "develops" | "reviews" | "exercises" }>;
  core: boolean;                         // metacademy `core: 1`
  extra?: string; note?: string;         // metacademy `extra:` / `note:`
  order: number;                         // ordem de leitura dentro da fonte (pré-ordem do outline)
  estMinutes?: number;                   // páginas × ~3–5 min (calibrar) | duração do vídeo
  provenance: {
    method: "outline" | "toc-llm" | "typographic" | "liteparse" | "window" | "manual";
    model?: string;                      // id do modelo SEM hardcode (meta 7) — vem do settings
    confidence: number;                  // 0..1
    createdAt: string;
  };
}
```

**Mapeamento Metacademy → nosso modelo**

| Metacademy | Nosso |
|---|---|
| `key` | `Source.id` |
| `resource_type` | `Source.kind` |
| `edition_years`/`year` | `Source.editionYears`/`year` |
| `specific_url_base` | `Source.specificUrlBase`, útil para `#page=N` em PDFs online |
| `source:` (no conceito) | `Resource.sourceId` |
| `location:` (n linhas) | `Resource.locations[]` (`freeform` no import; `chapter`/`pages`/`timestamp` quando estruturado) |
| `core: 1` | `Resource.core` |
| `extra:` / `note:` | `Resource.extra` / `note` |
| pasta do conceito | `Resource.coversNodes` (invertido) + índice `nodeId → resourceIds[]` |

### 6.3 Ligar capítulos a nós (`coversNodes`)

1. Para cada seção do outline (§5.3), gerar `{título, 300–600 palavras do início, termos-chave}` a partir do Markdown fatiado (§5.4).
2. **Recuperação de candidatos** no **grafo do domínio**: similaridade por embedding entre o resumo da seção e `título + resumo` dos nós, top-k ≈ 30, mais BM25 nos títulos.
3. **Juiz LLM com saída estruturada:** `{ nodeId, role, weight }[]`, restrito aos candidatos, cuja validade é checada no *merge*.
4. **Validações determinísticas:**
   - nós existem no domínio;
   - a ordem do livro é compatível com os pré-requisitos (aviso quando a seção *i* introduz A e uma seção anterior *j < i* "desenvolve" B com `B requires A`);
   - a região do capítulo é a união das seções (`coversNodes(cap) = ⋃ coversNodes(seção)`).
5. **Expansão procedural (meta 1):** seções sem nó correspondente viram **propostas de nós ou subdomínios**, no mesmo fluxo candidato → proposta → revisão citado no r8 §2.1 (Mathua/Clew). O sumário de um bom livro é uma semente forte para expandir o grafo.

---

## 7. Decisão: como usar o unpdf no learnharness

**Estado atual verificado no repo:**

- `package.json`: `pdfjs-dist ^6.3.289` instalado e `@napi-rs/canvas 1.0.9` no lockfile; Electron `^44.9.3`.
- `src/agent/subagents/pdf-ops.ts`: `loadBytes` → `getDocument({ data, standardFontDataUrl, verbosity: 0 })`, `pdfInfo`, `pdfExtract`, `pdfSearch`, `convertPdf`.
- `src/agent/subagents/pdf-markdown.ts`: `documentToMarkdown`, `joinPages`.
- `src/agent/subagents/headless.ts`: renderização PDF com pdfjs + Skia.
- `app/api/graph/import/route.ts`: o import de notas usa `convertPdf` com `MAX_PDF_PAGES = 1000`.
- `next.config.ts`: `serverExternalPackages` inclui `pdfjs-dist`; `outputFileTracingIncludes` cobre `pdfjs-dist/legacy/**` e `standard_fonts/**`, **mas não `cmaps/**` nem `wasm/**`**.

| Opção | Como | Prós | Contras |
|---|---|---|---|
| **A. Portar trechos (recomendada)** | Copiar ~400 LOC MIT (§10) para `src/agent/subagents/` e escrever `pdf-outline.ts` | Uma só cópia do PDF.js; zero dependência nova; controle de `AbortSignal`, que o unpdf não tem; encaixa no `convertPdf` existente | Manter o código copiado; acompanhar mudanças do PDF.js manualmente |
| **B. unpdf + `pdfjs-dist` legacy** | `npm i unpdf@2.2.1`; no boot do servidor: `definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'))`; adicionar `"unpdf"` a `serverExternalPackages` | API pronta e testada em 5 runtimes; `getDocumentProxy` já resolve fontes, CMaps e WASM | Os tipos do unpdf 2.x apontam para `pdfjs-dist` 6.5, então é preciso **subir para `~6.5.438`**; sem `AbortSignal`; `engines: node >= 24` (verificar `process.versions.node` do Electron 44); outline continua manual |
| **C. unpdf serverless (default)** | `npm i unpdf` e usar como está | Zero configuração; funciona até no *renderer* | **Duplica o PDF.js** (6.3 do app + 6.5 embutido); *worker* desligado → parsing na thread do *event loop* do Next; patches globais (`Map.prototype.getOrInsert`…) |
| D. LiteParse no lugar do pdf.js | `@llamaindex/liteparse` | Layout, tabelas, OCR | Sem outline; binário nativo de ~32 MB; não substitui o `pdf.js` |

**Escolha:** A agora. Reavaliar B se o time quiser `extractImages` ou `inspectPages` sem manter código. Em qualquer caso, **subir `pdfjs-dist` para `~6.5.438`**: é a versão testada pelo unpdf e traz `Map.getOrInsert` e `Math.sumPrecise`, que o build `legacy` polifila. Antes, ler o *changelog* `[api-major]` de 6.3→6.5, seguindo o roteiro de `.agents/skills/upgrade-pdfjs/SKILL.md`.

---

## 8. LiteParse para layout (avaliação)

| | `@llamaindex/liteparse` (Node) | `@llamaindex/liteparse-wasm` |
|---|---|---|
| Versão / licença | 2.20.0 / Apache-2.0 | 2.20.0 / Apache-2.0 |
| Motor | Rust + **PDFium** (napi-rs); Tesseract embutido; LibreOffice para Office | Rust → WASM (target web; build `nodejs` existe no repo). **Sem Tesseract**: OCR só via `ocrEngine` próprio; `xmp` nunca preenchido |
| Tamanho | `unpackedSize` ≈ 31,9 MB, mais o binário da plataforma via `optionalDependencies` (`@llamaindex/liteparse-win32-x64-msvc` etc.) | ≈ 5,6 MB (medido na 2.14.2) |
| API | `new LiteParse(config & { poolSize?, parseTimeoutMs? })`; `parse(input)`; `parseBatches(input, { batchSize=25 })` (AsyncGenerator); `isComplex(input)`; `screenshot(input, pages?)`; `warmUp()`; `close()`; `ParseTimeoutError` (só em modo *pool*: mata o processo) | `await init()`; `new LiteParse(config)`; `parse(bytes)`; `openBatchSession(bytes, n)` → `nextBatch()`; `isComplex(bytes)`; `searchItems` |
| Saída | `ParseResult { totalPages, pages: ParsedPage[], text, images, screenshots, pageErrors, docMeta? }`. `ParsedPage { pageNum, pageLabel?, width, height, text, markdown, textItems: TextItem[], blocks?: LayoutBlock[], complexity?, structureTree? }`. `LayoutBlock.kind ∈ heading\|paragraph\|list_item\|code\|table\|grid_fallback\|rule\|figure` com `level`, `bbox`, `rows: LayoutCell[][]` | igual |
| Coordenadas | **topo-esquerda, 72 DPI** (viewport) | igual |
| Outline | **não tem** (confirmado nos `.d.ts`) | **não tem** |

**Quando usar:**

- `isComplex()` → `needsOcr` com `reasons` (`scanned`, `no-text`, `garbled`, `vector-text`…). É mais rico que `inspectPages` para decidir OCR.
- Tabelas e fórmulas de livros de Eletrônica (tabelas de datasheet, *pinouts*), onde as regras do `pdf-markdown` falham.
- Livros escaneados: OCR Tesseract (`ocrEnabled: true`, `ocrLanguage: "por+eng"`, `dpi`).

**Integração:**

- Interface `LayoutParser { parse(bytes, pages): Promise<LayoutPage[]> }` com duas implementações, `PdfjsRules` (o atual) e `LiteParse` (opcional e configurável), e escolha por página via `inspectPages`/`isComplex`.
- Em Electron:
  - adicionar `@llamaindex/liteparse` a `serverExternalPackages`;
  - incluir `node_modules/@llamaindex/liteparse-*/**/*` em `outputFileTracingIncludes`, como já é feito para `@napi-rs/canvas-*`;
  - incluir também em `asarUnpack` do `electron-builder.yml`.
- Usar `poolSize: 1–2` e `parseTimeoutMs` sempre, porque PDFs hostis podem travar.

**Armadilhas:**

- Converter coordenadas ao misturar com o pdf.js: `y_pdfjs = pageHeight − y_lp − height`.
- No momento da checagem, as `optionalDependencies` do 2.20.0 estavam fixadas em **2.19.0**: há *skew* de versão, então fixar a versão exata.
- O pacote nativo instala o CLI `lit` e depende de `commander`.

---

## 9. Pipeline de ingestão de livros (alvo)

```
[UI: arrastar PDF / diálogo Electron]
   → POST /api/library/import  (novo; padrão de app/api/graph/import/route.ts: limite de bytes, %PDF-)
   → sha256(bytes)  ← ANTES do pdf.js (ele assume a posse do ArrayBuffer) → dedupe por hash
   → job em worker_threads (src/store/jobs.ts) — não bloquear o event loop do Next
        open(bytes.slice(), { standardFontDataUrl, cMapUrl, cMapPacked:true, wasmUrl,
                              maxImageSize: 16_777_216, verbosity: 0 })
        getMeta(parseDates)            → Source.title/authors/year (dica)
        numPages > cap? → recusar/confirmar
        getPageLabels()                → Source.file.pageLabels
        inspectPages()                 → scannedPages → (opcional) LiteParse OCR
        extractOutline()               → OutlineChapter[] | null → fallback §5.5
        para cada seção: documentToMarkdown(doc, pages) recortado por y → resumo + embedding
        mapear seção → nós (§6.3) → Resource[] (provenance, confidence)
        nós ausentes → propostas de expansão do grafo
   → persistir Source + Resource[] no store do DOMÍNIO (isolamento por sessão/domínio, meta 3)
[UI do nó] "Leitura: Sedra & Smith, cap. 3 §3.2 (pp. 112–118)" → abre viewer pdf.js no renderer em #page=112
```

---

## 10. Arquivos exatos para copiar/adaptar

O caminho de origem é relativo a `_refs/extra/unjs__unpdf/`. Em todo arquivo derivado, pôr no cabeçalho `// Portions adapted from unpdf (MIT) © 2023-PRESENT Johann Schopplich — https://github.com/unjs/unpdf` e registrar em `THIRD_PARTY_NOTICES`.

| Origem | Destino proposto | Adaptação |
|---|---|---|
| `src/_internal/operator-list.ts` (inteiro) | `src/agent/subagents/pdf-operator-walk.ts` | Trocar os imports de tipo para `pdfjs-dist/types/src/display/api` e `.../optional_content_config` (existem no pacote) ou `pdfjs-dist/legacy/build/pdf.mjs`. Sem mudança lógica. |
| `src/inspect.ts` (`inspectPages`, `inspectPage`, `getCoverage`, `countCharacters`) | `src/agent/subagents/pdf-inspect.ts` | Receber `PDFDocumentProxy` já aberto (padrão `openBytes`) e um `AbortSignal` por página. Remover `withDocument` e `registerImageDecoders` (desnecessários com `wasmUrl`). Expor `isLikelyScanned(page, { minText: 20, minCoverage: 0.8 })`. Unir com `pdfInfo` (manter `math_density`). |
| `src/utils.ts` (bloco `nodeDefaults`, `canCompileWasm`, conversão de `Buffer`, `isNodeProcess`) | `src/agent/subagents/pdf-ops.ts` (`loadBytes`) e `headless.ts` | Substituir `standardFontsDir()` (caminho relativo `../../../node_modules`) por `import.meta.resolve('pdfjs-dist/package.json')`. Adicionar `cMapUrl`, `cMapPacked`, `wasmUrl` e `maxImageSize`. |
| `src/meta.ts` (inteiro) | `src/agent/subagents/pdf-meta.ts` | Trocar `withDocument` por `doc` aberto; obter `PDFDateString` via `await import('pdfjs-dist/legacy/build/pdf.mjs')`. |
| `src/text.ts` (`normalizeMergedText`, `getPageTextItems`) | opcional | Só se precisarmos de texto "cru" para *embeddings*. O `pdf-markdown` já é melhor. |
| `src/_internal/png.ts` (inteiro) | opcional: `src/agent/subagents/png-encode.ts` | Para salvar figuras extraídas sem canvas. |
| `src/image.ts` (`extractImages`, `toRGBA`, `getPageObject`) | opcional: `src/agent/subagents/pdf-figures.ts` | Para extrair figuras de livros como assets das aulas. Exige o *walker*. |
| `scripts/generate-fixtures.ts` (`serializePDF`, `stream`) | `tests/fixtures/make-pdf.ts` (nosso) | **Reescrever** (não executar o deles) para gerar *fixtures* com `/Outlines`, destino nomeado (`/Names << /Dests … >>`), `/PageLabels << /Nums [0 << /S /r >> 4 << /S /D >>] >>` e seção começando no meio da página (`/Dest [p /XYZ 0 120 null]`). |
| `src/pdfjs-serverless/**`, `pdfjs.rolldown.config.ts` | **não copiar** | Desnecessário com `pdfjs-dist` legacy *external*. Copiar só a ideia "âncora de patch verificada no build" se um dia formos aplicar *patches* no PDF.js. |

**Testes a portar ou escrever** (`tests/*.test.ts`, executados com `tsx --test`):

- **Ciclo de vida:** documento próprio é destruído; o do chamador não (ver `test/document.test.ts`).
- **`inspectPages`:** expectativas exatas de `test/inspect-pages.test.ts` com `scanned-pages.pdf` e `unpainted-images.pdf`. As *fixtures* são MIT e pequenas (3 KB e 2 KB); podem ser copiadas como dados de teste.
- **Outline (novos):**
  - PDF sem outline → `null`;
  - destino nomeado;
  - destino com ref inteiro;
  - nó "Parte" sem destino herda do filho;
  - outline não monotônico gera *warning*;
  - página compartilhada (XYZ no meio);
  - *page labels* romanos e arábicos;
  - as 5 invariantes da §5.2 como propriedade.
- **CJK:** `cjk-predefined-cmap.pdf` deve extrair `日本語テキスト` depois de configurar `cMapUrl`.
- **Decoders:** `image-decoders.pdf` deve renderizar sem *warnings* depois de configurar `wasmUrl`.

---

## 11. Dependências e configuração

| Item | Ação |
|---|---|
| `pdfjs-dist` | `^6.3.289` → `~6.5.438` (alinhar com o unpdf; revisar `[api-major]`) |
| `next.config.ts` → `outputFileTracingIncludes["*"]` | Adicionar `"node_modules/pdfjs-dist/cmaps/**/*"` e `"node_modules/pdfjs-dist/wasm/**/*"` |
| `next.config.ts` → `serverExternalPackages` | Se a Opção B for adotada, `"unpdf"`. Se o LiteParse for adotado, `"@llamaindex/liteparse"`. |
| `electron-builder.yml` | Se o LiteParse for adotado: `asarUnpack` dos binários `@llamaindex/liteparse-*` |
| Novas dependências (Opção A) | **nenhuma** |
| Opção B | `unpdf@2.2.1` (zero dependências) |
| Layout (opcional) | `@llamaindex/liteparse@2.20.0` (nativo) ou `@llamaindex/liteparse-wasm@2.20.0` (renderer) |

---

## 12. Armadilhas (checklist)

1. **O unpdf não tem outline.** Use `pdf.getOutline()` no *proxy*. O r8 (linha 39) diz o contrário; corrigir lá.
2. `getOutline()` resolve **`null`** sem outline, apesar do tipo `Array`.
3. `dest` pode ser string (nomeado) ou array; `ref` pode ser `{num, gen}` ou inteiro. `cachedPageNumber` só funciona após `getPage`; caso contrário, use `getPageIndex(ref) + 1`.
4. **Posse do buffer:** o PDF.js *transfere* ou *detacha* o `ArrayBuffer`. Calcule o hash e guarde uma cópia **antes**; para reusar, passe `bytes.slice()`. Os testes do unpdf fazem isso (`fixtures[filename].slice()`).
5. `Buffer` do Node é recusado: converter para `Uint8Array` com o mesmo `byteOffset`.
6. URLs de fábrica (`standardFontDataUrl`, `cMapUrl`, `wasmUrl`) **precisam terminar em `/`**, também no Windows (`getFactoryUrlProp` lança erro).
7. **Electron:** o PDF.js (e o unpdf) tratam *renderer* e `utilityProcess` como **não-Node**: fábricas DOM, sem fontes nem CMaps locais. Rodar a ingestão no servidor filho (`ELECTRON_RUN_AS_NODE=1`, como hoje) ou em `worker_threads` dele, nunca em `utilityProcess` sem reconfigurar.
8. **Bloqueio do *event loop*:** tanto o build serverless do unpdf (`#isWorkerDisabled = true`) quanto o `legacy` em Node (*fake worker*) parseiam na thread atual. Para livros de 500–1000 páginas, usar `worker_threads` e cancelamento cooperativo, como já documentado em `convertPdf`.
9. `maxImageSize` é ilimitado (`-1`) por padrão: passar `16_777_216` ou similar. Limitar `numPages` antes de iterar. Impor *timeout* (`Promise.race`) por job.
10. `isEvalSupported` **não existe mais** nas opções de `getDocument` da 6.3.289 instalada (conferido em `legacy/build/pdf.mjs` L21975–22001). Não "configurar" algo inexistente. Manter o `pdfjs-dist` atualizado: o CVE-2024-4367 foi corrigido em 4.2.67.
11. **Não duplicar o PDF.js:** o unpdf serverless embute o 6.5. Com o app no 6.3 são duas cópias, com comportamentos e tipos divergentes.
12. **Coordenadas:** o unpdf e o pdf.js usam origem **embaixo à esquerda** (espaço PDF, sem `/Rotate` nem `/UserUnit`); o LiteParse usa **topo-esquerda, 72 DPI**. Páginas com `/Rotate` exigem `page.getViewport()` para converter.
13. **Páginas impressas × índices:** "pp. 744–748" se refere a *labels*. Guardar ambos (`PageRange.printed`). Sem `/PageLabels`, inferir o *offset* e marcar `confidence` baixa.
14. Títulos de outline vêm com controles, PUA e ligaduras: normalizar (reusar `clean` do `pdf-markdown.ts`). `title` pode ser `""`.
15. Outlines muito profundos (subsubseções) → escolher a granularidade (§5.3). "Parte I" sem destino → herdar do primeiro filho.
16. PDFs criptografados: `PasswordException` → hoje vira `"unreadable"` no `convertPdf`. Para livros, pedir a senha na UI (opção `password`).
17. `extractImages` no browser pula *bitmaps* sem `isOffscreenCanvasSupported: false` e `isImageDecoderSupported: false`.
18. `getMeta`: não mutar `meta.info` (cache do PDF.js). `Title` costuma ser lixo de exportação.
19. Heurística de escaneado (`< 20` caracteres visíveis e cobertura `> 0.8`) é **ponto de partida**; calibrar por domínio. Slides com foto de fundo dão falso positivo.
20. Se um dia *vendorizar* o build serverless: os *patches* são por âncora literal e quebram a cada *upgrade* do PDF.js (o `buildEnd` acusa). Seguir `.agents/skills/upgrade-pdfjs/SKILL.md`.

---

## 13. Plano de integração (fases)

**Fase 0, saúde do pdf.js atual (½ dia).**

- `pdf-ops.ts`/`headless.ts`: `nodeDefaults` com `import.meta.resolve`, mais `cMapUrl`, `wasmUrl` e `maxImageSize`.
- `next.config.ts`: tracing de `cmaps/**` e `wasm/**`.
- Testes CJK e decoders (*fixtures* do unpdf).
- Subir para `pdfjs-dist ~6.5.438`.

**Fase 1, triagem e metadados (1 dia).**

- Portar `pdf-operator-walk.ts`, `pdf-inspect.ts` e `pdf-meta.ts`.
- `pdfInfo` passa a usar `inspectPages` (imagens *inline*, máscaras, OC, OCR invisível).
- A rota `/api/graph/import` usa `scannedPages` para uma mensagem melhor que "OCR not supported yet".

**Fase 2, outline e capítulos (2–3 dias).**

- `pdf-outline.ts` (§5.2): `extractOutline`, `resolveDest`, intervalos, *labels*, invariantes e testes de propriedade.
- `pdf-markdown.ts`: filtro por `y` para cortar no meio da página.
- *Fallback* com sumário (TOC) e tipografia (§5.5).

**Fase 3, modelo `Source`/`Resource` (2 dias).**

- `src/core/resources.ts` (tipos do §6.2) e persistência no store do domínio: arquivo JSON por domínio via `src/store/atomic-write.ts`, ou tabela dedicada, a decidir no relatório de store.
- Índice `nodeId → resourceIds`.
- Import opcional de `resources.txt` estilo Metacademy (`freeform`).

**Fase 4, ligação seção → nós e expansão (3–4 dias).**

- Job em `worker_threads` (§9): candidatos por embedding, juiz LLM com saída estruturada e modelo do settings (sem hardcode), validações determinísticas.
- Propostas de novos nós a partir de seções órfãs.

**Fase 5, UI (2 dias).**

- Painel "Leituras" no nó: capítulo, páginas impressas e tempo estimado.
- Viewer pdf.js no *renderer* com *worker* próprio (`pdfjs-dist/build/pdf.worker.mjs`), navegando por `#page=` ou `PDFLinkService` para o `dest` exato.
- Ícone SVG desenhado à mão (meta 8).

**Fase 6, opcional: LiteParse (2 dias).**

- `LayoutParser` com LiteParse para páginas complexas e escaneadas: `isComplex`, OCR `por+eng`, *pool* e *timeout*.
- Empacotamento no Electron.

---

## 14. Licenças e compatibilidade com AGPL-3.0

| Componente | Licença | Compatível com AGPL-3.0? | Obrigações |
|---|---|---|---|
| unpdf (código TS copiado ou dependência) | MIT | Sim | Manter o aviso de copyright e o texto MIT (cabeçalho mais `THIRD_PARTY_NOTICES`) |
| PDF.js (`pdfjs-dist`) | Apache-2.0 | Sim (Apache-2.0 → GPLv3/AGPLv3, em sentido único) | Manter `LICENSE` e avisos; indicar modificações se houver *patch* |
| Decoders em `pdfjs-dist/wasm/`: JBIG2 (PDFium), OpenJPEG, QCMS | BSD-3 / BSD-2 / MIT, mais *wrappers* Apache-2.0/BSD-2/MIT da Mozilla (`LICENSE_PDFJS_*`) | Sim | Redistribuir os `LICENSE_*` (`wasm/LICENSE_JBIG2`, `LICENSE_OPENJPEG`, `LICENSE_QCMS`, `LICENSE_PDFJS_*`) |
| LiteParse (`@llamaindex/liteparse[-wasm]`) | Apache-2.0 (PDFium BSD-3; Tesseract Apache-2.0) | Sim | Avisos e NOTICE |
| *Fixtures* do unpdf (`test/fixtures/*.pdf`) | MIT (as feitas à mão); `sample.pdf` vem do W3C | Sim, para testes | Citar a fonte (o README das *fixtures*) |
| metacademy-content (se importarmos dados) | **CC-BY-SA 3.0 US** | Conteúdo, não código: pode ser usado com atribuição e *share-alike* **no conteúdo derivado** | Manter separado do código AGPL e atribuir |

---

## 15. Referências

- unpdf: https://github.com/unjs/unpdf (README, `src/`, `test/`), commit `d809b22e`; npm https://registry.npmjs.org/unpdf/latest; releases https://github.com/unjs/unpdf/releases
- PDF.js (tipos e implementação conferidos localmente):
  - `node_modules/pdfjs-dist/types/src/display/api.d.ts`: `getOutline` L1014, `getDestination` L939, `getPageIndex` L925, `getPageLabels` L945, `cachedPageNumber` L1206;
  - `legacy/build/pdf.worker.mjs` `#readDocumentOutline`;
  - `legacy/build/pdf.mjs`: `getFactoryUrlProp` L15097, `isNodeJS` L6277, opções de `getDocument` L21975+.
- LiteParse: https://github.com/run-llama/liteparse; https://registry.npmjs.org/@llamaindex/liteparse/latest; https://unpkg.com/@llamaindex/liteparse/dist/lib.d.ts; https://unpkg.com/@llamaindex/liteparse-wasm/pkg/liteparse_wasm.d.ts; https://unpkg.com/@llamaindex/liteparse-wasm/README.md
- Metacademy: https://github.com/metacademy/metacademy-content (`resources.txt` na raiz; `concepts/backpropagation/resources.txt`)
- Relatórios internos relacionados: `docs/research/r8-descoberta-repos.md` (§2.2 e linhas 39 e 310–311), `docs/research/r3-geracao-curriculo-grafo.md`
- Código do learnharness afetado: `src/agent/subagents/pdf-ops.ts`, `pdf-markdown.ts`, `pdf-reader.ts`, `headless.ts`; `app/api/graph/import/route.ts`; `next.config.ts`; `electron/main.cjs`.

> Nota: o orçamento de busca web da sessão acabou durante esta análise. As versões e APIs do LiteParse e do unpdf vêm de buscas diretas ao registry npm, ao unpkg e ao GitHub (WebFetch), e não de buscas gerais. As stars do unpdf (~1,3k) vêm do r8 e não foram reverificadas.
