# sigma.js v4: relatório de referência para a "galaxy view"

> **Chave:** `extra-jacomyal__sigma.js` · **Data:** 2026-11-18
> **Fonte lida:** `_refs/extra/jacomyal__sigma.js`, clone raso, commit `e7748c88` de 2026-11-10.
> **Escopo:** leitura do core `packages/sigma/src` (inteiro), dos pacotes satélites (`node-image`, `node-border`, `layer-webgl`, `layout-fa2-gpu`, `utils`, `export-image`), da documentação (`packages/website/src/content/docs`) e dos exemplos (`packages/website/src/examples`). Também consultei o registro npm em 2026-11-18 e o contexto do learnharness (`components/graph-canvas.ts`, `components/graph-view.tsx`, `docs/research/lh-ui-theme.md`, `docs/research/lh-graph-pedagogy.md`).
> **Segurança:** o repositório é tratado como dado não confiável. Nada foi instalado, buildado ou executado a partir dele, só lido.

---

## 0. TL;DR

- **O que é.** sigma 4.0.6 (MIT) é um renderer WebGL2 de grafos sobre o **graphology**. O v4 é uma **reescrita completa**:
  - uma única camada WebGL, com labels também em WebGL (atlas **SDF**);
  - **primitives** declarativos (shapes SDF, fragment layers, paths, extremities, variables, depthLayers) que viram shaders gerados;
  - **styles** declarativos (no lugar dos reducers), com análise de dependência;
  - estado por item e global (`isHovered`, `isHighlighted`, `isPanning`…), mais estado customizado;
  - drag embutido, arestas paralelas e self-loops;
  - **picking na GPU** com readback assíncrono (PBO + fence);
  - render **on-demand**, sem frames quando ocioso;
  - restauração de contexto WebGL perdido.
- **Licença.** MIT é **compatível com AGPL-3.0**: basta preservar o aviso de copyright. Todo o ecossistema recomendado (graphology\*, @react-sigma, @sigma/\*, @cosmos.gl/graph) é MIT. **Evitar `@cosmograph/cosmos`**, que é CC-BY-NC-4.0 e incompatível.
- **Por que o learnharness abandonou o sigma em 2026-09-13.** A causa foram as regiões de cluster em canvas externos, com loop de eventos próprio:
  - hulls atrasados no pan;
  - corrida de dimensionamento;
  - re-rasterização a cada evento de câmera, com picos de GPU e coil whine.

  No v4 isso **foi resolvido na arquitetura**. `addCustomLayerProgram` / `@sigma/layer-webgl` desenham contornos e heatmaps **no mesmo contexto GL e no mesmo frame**, intercalados por `depth`, sem canvas extra. O risco que sobra é o custo de GPU dos splats de densidade a cada frame. Mitigação: ligar só sob demanda.
- **Encaixe na galaxy view.** Atende bem de alguns milhares a algumas dezenas de milhares de nós. O caminho é:
  - nós cel-shaded via **fragment layer customizada** + contorno "tinta" com `layerBorder` em pixels + ícone SVG desenhado à mão via `layerImage({drawingMode:"color"})`;
  - forma "wobbly" via **SDF customizado** com semente por nó;
  - arestas de pré-requisito com `pathCurved` + `extremityArrow` + `layerDashed` (pré-requisito bloqueado);
  - LOD de labels de graça pelo `LabelGrid`, com tamanho por nível hierárquico;
  - regiões de subdomínio com `createContoursProgram`.
- **Correção formal da árvore.** `graphology-dag`:
  - `willCreateCycle` valida cada aresta proposta pela IA **antes** de inseri-la;
  - `topologicalGenerations` dá os "anéis" do layout radial (fundamentos no centro, fronteira no aro).
- **Layout.** Calcular fora do thread de UI (Worker ou servidor). Duas opções:
  - radial por gerações + setores por subdomínio;
  - FA2 em worker, com `fixed` nos nós já posicionados.

  `@sigma/layout-fa2-gpu` (Barnes-Hut na GPU) é opcional, com fallback. Acima de cerca de 50k nós ou para modo analítico, usar **cosmos.gl** (`@cosmos.gl/graph` 3.6.0, MIT).
- **Armadilhas principais:**
  - não importa em SSR: `WebGL2RenderingContext` é acessado no topo do módulo, então é preciso `next/dynamic({ssr:false})`;
  - `styles` e `primitives` são **imutáveis** depois do construtor;
  - funções em styles viram dependência `graph-state` e reavaliam **todos** os itens a cada mudança de estado global (inclusive início e fim de pan);
  - o FA2 worker atualiza atributos sem hints, o que reavalia todos os nós a cada tick;
  - fontes precisam estar carregadas antes do atlas SDF;
  - o worker do FA2 exige CSP `worker-src blob:`;
  - `kill()` remove **todos** os filhos do container.

---

## 1. Identificação e licença

### 1.1 Pacotes do monorepo (Lerna independente, build com preconstruct)

| Pacote | Versão (repo/npm) | Licença | Papel | Interesse para nós |
|---|---|---|---|---|
| `sigma` | 4.0.6 (npm 2026-11-10) | MIT | core: renderer, câmera, captors, styles, primitives, SDF atlas | **essencial** |
| `@sigma/node-image` | 4.0.2 | MIT | fragment layer `layerImage` + `TextureManager` (atlas de imagens) | **ícones SVG** |
| `@sigma/node-border` | 4.0.0 | MIT | fragment layer `layerBorder` (bordas múltiplas) | **contorno tinta** |
| `@sigma/node-piechart` | 4.0.0 | MIT | fatias por nó | talvez (proporção de domínio/mastery) |
| `@sigma/layer-webgl` | 4.0.0 | MIT | contornos, heatmap e cor em WebGL no mesmo contexto | **regiões de subdomínio, pontos fracos** |
| `@sigma/layout-fa2-gpu` | 4.0.0 (npm 2026-10-08) | MIT | ForceAtlas2 na GPU | opcional |
| `@sigma/utils` | 4.0.0 | MIT | `fitViewportToNodes`, `getNodesInViewport` | útil |
| `@sigma/export-image` | 4.0.0 | MIT | `toBlob`, `toFile`, `downloadAsPNG/JPEG` | compartilhar "mapa de progresso" |
| `@sigma/layer-leaflet` / `layer-maplibre` | 4.0.x | MIT | mapas | não |

O pacote `sigma` só depende de `events` ^3.3.0 e `graphology-utils` ^2.5.2, e tem `graphology` como peer. Os subpath exports são `sigma`, `sigma/types`, `sigma/settings`, `sigma/utils`, `sigma/rendering` e `sigma/primitives`.

### 1.2 LICENSE

`LICENSE.txt` é MIT, com "Copyright (C) 2012-2026, Alexis Jacomy, Guillaume Plique, Benoît Simard https://www.sigmajs.org".

- **Compatibilidade.** MIT → AGPL-3.0-only (licença do learnharness 0.6.1) é permitido: código MIT pode ser incorporado em obra AGPL.
- **Obrigações:**
  - manter o aviso de copyright e de permissão do MIT, seja no `THIRD_PARTY_NOTICES` ou equivalente gerado no build, seja no cabeçalho de arquivos copiados ou adaptados (por exemplo, se trouxermos o GLSL de `square.ts` / IQ box SDF, ou o algoritmo do `LabelGrid`);
  - não reutilizar logos, marca nem datasets do site (`packages/website/public`, `_data/`): têm origens diversas e não interessam.
- **Nota de procedência.** O README declara que LLMs ajudam no desenvolvimento desde o v4 (geração de GLSL, engines de styles e primitives, attachments), mas que a arquitetura é humana. Isso não afeta a licença. Só reforça que vale fixar versões e cobrir com testes de regressão visual.

### 1.3 Ecossistema (registro npm, consultado em 2026-11-18)

| Pacote | Versão | Data | Licença | Observação |
|---|---|---|---|---|
| graphology | 0.26.0 | 2025-01-26 | MIT | `Graph`, `DirectedGraph`, eventos de mutação |
| graphology-types | 0.24.8 | 2024-11-22 | MIT | tipos |
| graphology-dag | 0.4.1 | 2023-12-09 | MIT | `hasCycle`, `willCreateCycle`, `topologicalSort`, `topologicalGenerations`, `forEach*` (deps: mnemonist, graphology-utils) |
| graphology-layout-forceatlas2 | 0.10.1 | 2022-10-17 | MIT | FA2 síncrono + supervisor em Worker (blob) |
| graphology-communities-louvain | 2.0.2 | 2024-12-17 | MIT | comunidades → regiões e cores |
| graphology-metrics | 2.4.2 | 2026-09-02 | MIT | centralidades, densidade |
| graphology-layout | 0.6.1 | — | MIT | `circular`, `random`, `circlepack`, `rotation` |
| graphology-layout-noverlap | 0.4.2 | — | MIT | anti-sobreposição (pós-processo) |
| graphology-utils | 2.5.2 | — | MIT | — |
| @react-sigma/core | 6.0.0 | 2026-10-14 | MIT | peers: react ^18 \|\| ^19, sigma ^4.0.0, graphology ^0.26.0 |
| @react-sigma/layout-forceatlas2 | 6.0.0 | — | MIT | hooks de FA2 |
| @cosmos.gl/graph | 3.6.0 | 2026-11-04 | MIT | peers @luma.gl/\* ~9.3.0; alternativa para mais de 50k nós |
| @cosmograph/cosmos | 2.6.0 | — | **CC-BY-NC-4.0** | **incompatível**, não usar |

---

## 2. Contexto do learnharness: o abandono de 2026-09-13 e o que o v4 resolve

O cabeçalho de `components/graph-canvas.ts` (linhas 1–15) e `components/graph-view.tsx` registram que o sigma (v3) foi trocado por um Canvas 2D próprio (d3-force + d3-zoom, meta "338 → low thousands") porque:

1. as regiões de cluster ficavam em canvas externos, com loop de eventos separado;
2. os hulls atrasavam durante o pan;
3. havia corrida com o dimensionamento do canvas do sigma em rebuilds;
4. cada evento de câmera re-rasterizava o canvas de hulls (picos de GPU, coil whine).

| Problema v3 | Mecanismo no v4 | Risco residual |
|---|---|---|
| Regiões em canvas externo | `sigma.addCustomLayerProgram(id, depth, factory)` / `bindWebGLLayer(depth, renderer, Program)` desenham **no mesmo `WebGL2RenderingContext`, dentro de `render()`**, num bucket de `depth` (ex.: atrás das arestas) | `createDensitySplatProgram` faz splat aditivo num FBO R32F **a cada frame** (custo O(N·raio²) de fragment). Usar só sob demanda (hover ou seleção) |
| Atraso no pan | A câmera só muda a matriz (uniform). Layers custom recebem `RenderParams.matrix` no mesmo frame | — |
| Corrida de resize | Um só canvas WebGL. `resize()` interno, chamado em `render()` | O container precisa ter tamanho (ou `allowInvalidContainer`) |
| Re-raster por evento | Render on-demand (`scheduleRender`), sem loop contínuo. Ocioso = 0 frames | Animações próprias (pulsar nó) reintroduzem frames contínuos, então devem ser limitadas no tempo |
| — | Perda de contexto: eventos `webglContextLost` / `webglContextRestored`. As factories de layers custom são **re-invocadas** na restauração | Testar no Electron (troca de GPU em notebooks híbridos) |

A conclusão de `docs/research/lh-ui-theme.md` §7 continua razoável: **Canvas 2D com LOD na fase 1**, e sigma v4 quando a interação com o grafo for prioridade ou quando o critério "p95 > 16 ms com >15k primitivas" for atingido. Este relatório detalha como fazer essa troca sem repetir 2026-09.

---

## 3. Arquitetura

### 3.1 Visão geral

```mermaid
flowchart LR
  G[graphology Graph] -- eventos nodeAdded/attributesUpdated/... --> EH[core/event-handlers.ts]
  EH -->|scheduleProcess / partial refresh| S[Sigma (sigma.ts)]
  ST[styles + StateManager] --> S
  P[primitives] -->|generateNodeProgram / generateEdgeProgram| PR[Programs GLSL gerados]
  S -->|process: estilo→displayData→normalização→buckets| DT[NodeDataTexture / EdgeDataTexture (RGBA32F)]
  S -->|render| R[Frame: edges→labels de aresta→backdrops→nodes→attachments→labels]
  DT --> PR --> R
  C[Camera] -->|matrix| R
  MC[MouseCaptor/TouchCaptor] --> HR[HoverResolver (picking GPU async)] --> SM[StateManager isHovered] --> S
  CL[Custom layer programs (layer-webgl, fa2-gpu)] --> R
  SDF[SDFAtlasManager (labels)] --> R
```

### 3.2 Mapa de arquivos (linhas)

| Arquivo | Linhas | Conteúdo |
|---|---|---|
| `packages/sigma/src/sigma.ts` | 3452 | classe `Sigma`: construtor, process, render, API pública, kill |
| `packages/sigma/src/core/styles.ts` | 747 | resolução de valores de estilo, `classifyValue`, `analyzeStyleDeclaration`, defaults de display data |
| `packages/sigma/src/types/styles.ts` | ~860 | tipos de styles/estado, `DEFAULT_STYLES`, `DEPTHLESS_STYLES` |
| `packages/sigma/src/core/state-manager.ts` | 308 | estado por nó/aresta/grafo, dirty sets, `isIdle` |
| `packages/sigma/src/core/event-handlers.ts` | 317 | eventos graphology → refresh parcial/total |
| `packages/sigma/src/core/labels.ts` | 191 | `LabelGrid` (culling de labels) |
| `packages/sigma/src/core/label-renderer.ts` | 832 | render de labels SDF |
| `packages/sigma/src/core/sdf-atlas.ts` | 601 | `SDFAtlasManager` (EDT Felzenszwalb, inlined do tiny-sdf) |
| `packages/sigma/src/core/hover-resolver.ts` | 157 | picking assíncrono (PBO + fence) |
| `packages/sigma/src/core/camera.ts` | 276 | `Camera` (x, y, ratio, angle; `animate`) |
| `packages/sigma/src/core/drag-manager.ts` | 147 | drag embutido |
| `packages/sigma/src/core/fit-extent.ts` | 146 | `computeFittedExtent` (rescale considerando tamanhos) |
| `packages/sigma/src/core/edge-groups.ts` | 114 | índice de arestas paralelas |
| `packages/sigma/src/rendering/data-texture.ts` | 695 | textura de dados RGBA32F com free-list |
| `packages/sigma/src/rendering/nodes/generator.ts` | 513 | geração do shader de nós (SDF + layers) |
| `packages/sigma/src/rendering/nodes/factory.ts` | 485 | programa de nós |
| `packages/sigma/src/rendering/nodes/types.ts` | 465 | `SDFShape`, `FragmentLayer`, `LayerLifecycleHooks`, `ValueSource`, `LabelOptions` |
| `packages/sigma/src/rendering/edges/generator.ts` | 1461 | geração do shader de arestas (paths, extremities, layers) |
| `packages/sigma/src/rendering/edges/types.ts` | 658 | tipos de arestas |
| `packages/sigma/src/primitives/{types,parser,schema}.ts` | — | `PrimitivesDeclaration`, parser, `numberProp` / `colorProp` / `arrayProp` |
| `packages/node-image/src/{layer,texture,types}.ts` | 389 / 495 / 143 | `layerImage`, `TextureManager` |
| `packages/node-border/src/{layer,types}.ts` | — | `layerBorder` |
| `packages/layer-webgl/src/*` | — | `bindWebGLLayer`, `createContoursProgram`, `createHeatmapProgram`, `createColorLayerProgram`, `createDensitySplatProgram` |
| `packages/layout-fa2-gpu/src/fa2-layout.ts` | 784 | `ForceAtlas2GPULayout` |

### 3.3 Sistemas de coordenadas

**graph** (atributos x/y) → **framedGraph** (normalizado em 0..1 pela bbox) → **viewport** (pixels CSS) → **clipspace** (matriz da câmera).

- `autoRescale: true` (default) recalcula a bbox a cada process. **Inserir nós longe do centro "re-enquadra" o grafo inteiro**: péssimo para expansão procedural.
- `autoRescale: "once"` congela a bbox após o primeiro process. `setGraph` reseta o congelamento.
- `autoRescale: false` usa espaço de pixels centrado.
- `setCustomBBox({x:[min,max], y:[min,max]})` fixa a bbox de mundo. **Recomendado para nós:** um "universo" fixo por domínio, por exemplo `[-1000, 1000]²`.
- `itemSizesReference: "positions"` (default no v4): tamanhos em unidades do grafo, escalados com o zoom via `zoomToSizeRatioFunction` (default `Math.sqrt`). `"screen"` dá tamanho em pixels.
- Conversões públicas: `graphToViewport`, `viewportToGraph`, `framedGraphToViewport`, `viewportToFramedGraph`, `getGraphToViewportRatio`, `viewRectangle`.

### 3.4 Ordem de pintura e depth

`primitives.depthLayers` define os buckets. O default é `["edges","topEdges","nodes","topNodes"]` (`DEFAULT_DEPTH_LAYERS` em `primitives/types.ts:232`). Dentro de cada bucket a ordem é:

1. layers WebGL custom;
2. arestas;
3. fundos e labels de aresta;
4. backdrops;
5. nós;
6. attachments;
7. fundos de label;
8. labels de nó.

Dentro do bucket, `zIndex` ordena. Os estilos default mandam o nó em hover para `topNodes`, e a aresta para `topEdges` quando `whenState: ["isHighlighted","isHovered"]`. **Atenção:** o array é um **AND**.

Se você declarar `depthLayers` próprios **e** usar os estilos default, o construtor exige que os 4 nomes default estejam presentes. Com estilos próprios, use `DEPTHLESS_STYLES` como base.

---

## 4. API essencial

### 4.1 Construtor

```ts
new Sigma(graph, container, {
  primitives,        // PrimitivesDeclaration (IMUTÁVEL após construção)
  styles,            // { nodes, edges } (IMUTÁVEL; default = DEFAULT_STYLES por nível nodes/edges)
  settings,          // Partial<Settings> (mutável via setSetting/updateSetting/setSettings)
  nodeReducer, edgeReducer,         // ainda existem (pós-estilo), use pouco
  customNodeState, customEdgeState, customGraphState, // valores iniciais do estado custom
});
```

- `defineSigmaOptions({...})` (em `types/options.ts`) dá inferência de tipos. As `variables` e `depthLayers` declarados em primitives ficam tipados em styles.
- **Não existe `setStyles` nem `setPrimitives`.** Mudar o tema (claro/escuro) exige uma de três coisas:
  - cores vindas de atributos;
  - estado global custom com regras;
  - recriar a instância (e então salvar e restaurar o estado da câmera).

### 4.2 Styles: tipos de valor (`types/styles.ts`)

| Forma | Exemplo | Dependência |
|---|---|---|
| Literal | `color: "#2b2b2b"` | static |
| Binding direto | `size: { attribute: "size", defaultValue: 8 }` | static |
| Binding numérico | `size: { attribute: "mastery", min: 6, max: 18, minValue: 0, maxValue: 1, easing: "quadraticOut" }` | static |
| Binding categórico | `color: { attribute: "subdomain", dict: { analog: "#f6a", digital: "#6af" } }` | static |
| `whenData` | `{ whenData: { locked: true }, then: 0.4, else: 1 }` | static (se os ramos forem static) |
| `whenState` | `{ whenState: "isHovered", then: 14, else: 10 }` | item-state |
| `when` (função) | `{ when: (a, s, gs) => gs.zoomTier > 1, then: …}` | **graph-state** |
| Função de valor | `(attrs, state, gs, graph) => …` | **graph-state** |

Regras em array, avaliadas na ordem com override:

- `{ when, then, else }`
- `{ whenState, then, else }`
- `{ whenData, then, else }`
- `{ matchData: "attr", cases: {...} }` (static)
- `{ matchState: "customFlag", cases: {...} }` (item-state)
- objeto de propriedades

Predicados (`StatePredicate`, `DataPredicate`):

- string → flag verdadeira;
- array → **AND** de flags;
- objeto → todos os pares iguais (AND).

**Propriedades de nó:** `x`, `y`, `size`, `color`, `opacity`, `shape`, `visibility`, `depth`, `zIndex`, `cursor`, `rotationAlignment`, `backdrop*` (`Visibility`, `Color`, `ShadowColor`, `ShadowBlur`, `Padding`, `BorderColor`, `BorderWidth`, `CornerRadius`, `LabelPadding`, `Area`), `label`, `labelColor`, `labelSize`, `labelFont`, `labelVisibility` (`auto`/`visible`/`hidden`), `labelPosition`, `labelAngle`, `labelDepth`, `labelAttachment`, `labelAttachmentPlacement`, `labelBackgroundColor`, `labelBackgroundPadding`, `labelCursor`. Somam-se as **variables** declaradas em primitives.

**Propriedades de aresta:** `path`, `selfLoopPath`, `parallelPath`, `parallelSpread`, `size`, `color` (aceita `{ node: "source" | "target" }`), `opacity`, `head`, `tail`, `visibility`, `depth`, `zIndex`, `cursor`, `label*` e `labelPosition` (`over`/`above`/`below`/`auto`/número).

### 4.3 Estado

- **Base de nó:** `isHovered`, `isLabelHovered`, `isHidden`, `isHighlighted`, `isDragged`.
- **Base de aresta:** `isHovered`, `isLabelHovered`, `isHidden`, `isHighlighted`, `parallelIndex`, `parallelCount`.
- **Base de grafo:** `isIdle`, `isPanning`, `isZooming`, `isDragging`, `hasHovered`, `hasHighlighted`.
- **API:** `setNodeState(key, partial)`, `setNodesState(keys[], partial)`, `setEdgeState`, `setEdgesState`, `setGraphState(partial)`, `getNodeState`, `getGraphState`.
- `setNodeState` só marca dirty se algo mudou (`hasNewPartialProps`) e agenda refresh.
- O estado custom não pode sombrear chaves base (`ForbidBaseKeys`).

### 4.4 Métodos públicos úteis

| Método | Uso |
|---|---|
| `setGraph(graph)` | troca de grafo (sessão por domínio) **sem recriar o WebGL**. Poda estados, religa handlers, reseta o congelamento do autoRescale |
| `refresh({ partialGraph?: {nodes,edges}, schedule?, skipIndexation? })` | reprocessa tudo ou parte. `skipIndexation: true` quando só estilos mudaram |
| `scheduleRender()` / `scheduleRefresh()` | agendamento via rAF |
| `setSetting` / `updateSetting` / `setSettings` | settings mutáveis |
| `getCamera()` / `setCamera(cam)` | câmera (`getState`, `setState`, `animate({x,y,ratio}, {duration})`) |
| `setCustomBBox(bbox \| null)` / `getBBox()` | mundo fixo |
| `addCustomLayerProgram(id, depth, factory)` / `removeCustomLayerProgram(id)` | layers WebGL no mesmo contexto. `factory(gl) → {render(params), kill(), preRender?, cacheData?}` |
| `getNodeDisplayData(key)` | posição/tamanho/cor finais (após estilo e normalização) |
| `getNodeDisplayedLabels()` | labels efetivamente desenhados (útil para testes) |
| `getNodeDataTexture()` / `getNormalizationFunction()` | integração GPU avançada (usado pelo fa2-gpu) |
| `createLayer` / `createCanvas` / `createWebGLContext` | camadas DOM extras (evitar; foi a raiz do problema de 2026-09) |
| `scaleSize(size)` | conversão de tamanho com zoom |
| `kill()` | libera tudo, chama `WEBGL_lose_context` e **remove todos os filhos do container** |

### 4.5 Eventos

- Para nó, aresta e stage, mais variantes de label: `click | doubleClick | rightClick | wheel | down | up | enter | leave` + `Node | Edge | Stage`. Exemplos: `clickNode`, `enterNode`, `leaveNode`, `doubleClickStage`.
- Ciclo de vida: `beforeProcess`, `afterProcess`, `beforeRender`, `afterRender`, `resize`, `kill`, `moveBody`.
- Drag: `nodeDragStart`, `nodeDrag`, `nodeDragEnd` (com `allDraggedNodes`).
- GL: `afterTexturesUpload`, `webglContextLost`, `webglContextRestored`.
- Eventos de aresta (`enableEdgeEvents: true`) custam **um segundo passe** de picking. Deixe desligado se não for preciso.

### 4.6 Settings relevantes (defaults de `settings.ts`)

| Setting | Default | Recomendação galaxy view |
|---|---|---|
| `hideEdgesOnMove` / `hideLabelsOnMove` | false / false | `hideEdgesOnMove: true` acima de cerca de 30k arestas |
| `renderLabels` / `renderEdgeLabels` | true / false | true / false |
| `enableEdgeEvents` | false | false (hover de aresta via nó) |
| `pickingDownSizingRatio` | 2 | 2 (ou 3 em telas 4K) |
| `stagePadding` | 30 | 40 |
| `minEdgeThickness` | 1.7 | 1.2 |
| `antialiasEdges` / `antialiasNodes` | true / true | `antialiasEdges: false` dá até **5×** de ganho de GPU (doc de performance); manter nos nós |
| `zoomToSizeRatioFunction` | `Math.sqrt` | manter |
| `itemSizesReference` | `"positions"` | manter |
| `autoRescale` | true | **`"once"` ou `setCustomBBox`** |
| `enableNodeDrag` | false | true só em modo de edição (exige bindings x/y ou `dragPositionToAttributes`) |
| `labelDensity` / `labelGridCellSize` / `labelRenderedSizeThreshold` | 1 / 100 / 6 | 0.8 / 120 / 7 |
| `minCameraRatio` / `maxCameraRatio` | null / null | 0.02 / 4 |
| `enableCameraRotation` | true | **false** (desorienta no layout radial) |
| `gestureTarget` | `"graph"` | `"graph"` (app desktop) |
| `allowInvalidContainer` | false | false |
| `DEBUG_logRenderStats` / `DEBUG_gpuTimerQueries` / `DEBUG_logShaders` / `DEBUG_displayPickingLayer` | false | ligar em dev para os benchmarks |

### 4.7 Primitives (`primitives/types.ts`)

```ts
interface PrimitivesDeclaration {
  nodes?: { shapes?, variables?, layers?, label?: LabelOptions, backdrop?, labelAttachments? };
  edges?: { paths?, extremities?, variables?, layers?, defaultHead?, defaultTail?, label? };
  depthLayers?: readonly string[];
}
```

- **Shapes (nó):**
  - `sdfCircle()`, `sdfSquare({cornerRadius, rotation})`, `sdfRectangle({aspectRatio, cornerRadius, rotation})`, `sdfDiamond()`, `sdfTriangle()`;
  - ou `CustomNodeShape {name, glsl, inradiusFactor?}`;
  - ou `SDFShape` completo, com `uniforms`, `attributes`, `variables` e `inradiusFactorGLSL`.
- **Layers (nó):**
  - `layerFill({color?})`;
  - `layerImage(...)` (`@sigma/node-image`);
  - `layerBorder({borders})` (`@sigma/node-border`);
  - piechart;
  - ou `FragmentLayer` custom.
- **Paths (aresta):** `pathLine()`, `pathCurved({segments=16, curvature})`, `pathCurvedS`, `pathStep({orientation, rotateWithCamera, offset, innerCornerSkipFactor})`, `pathStepCurved`, `pathLoop` (self-loop).
- **Extremities:** `extremityArrow({lengthRatio, widthRatio, margin})`, `extremityBar`, `extremityCircle`, `extremityDiamond`, `extremitySquare`.
- **Layers (aresta):**
  - `layerPlain()`;
  - `layerDashed({dashSize, gapSize, dashColor, gapColor, dashOffset, cap:"butt"|"round"})`, onde `DashSize = {value, mode?} | {attribute, default?, mode?}` e o modo default é pixels;
  - `layerGradient({…, enabled?: {attribute, default?}})`.
- **Variables:** `{ nome: { type: "number"|"color"|"string"|"boolean", default } }`. São injetadas no display data com a precedência **estilo > atributo do grafo > default** (`postEvaluateNode`: `d[var] = d[var] ?? attrs[var] ?? default`).

---

## 5. Algoritmos-chave

### 5.1 Pipeline process → render (`sigma.ts`)

- `pendingProcess: "none" | "nodes" | "full"` decide o trabalho de CPU no próximo frame.
- **Process (CPU, O(N)), em `processNodes` (cerca da linha 711):**
  - extent da bbox (respeitando `autoRescale`, `"once"` congela; `computeFittedExtent` quando `autoRescaleContent ≠ "positions"`);
  - normalização;
  - preenchimento do `LabelGrid` com câmera nula;
  - ordenação em buckets por depth e zIndex;
  - `addNodeToProgram` grava na data texture.
- `addNode`: `evaluateNodeStyle` → `postEvaluateNode` (fallback x/y, injeção de variables) → reducer → validação x/y (lança erro se não finito) → bucket.
- **Render (cerca da linha 1033):**
  1. `resize`;
  2. `processData` / `refreshState` se necessário;
  3. clear;
  4. framebuffer de picking;
  5. upload de texturas, emitindo `afterTexturesUpload`;
  6. passe de edge-frame;
  7. passe de label-frame;
  8. `preRender` das layers custom;
  9. **laço por depth** (layers custom → arestas → … → labels);
  10. blit de DEBUG.
- **Mover a câmera não reprocessa.** Só re-renderiza (uniform de matriz) e reconsulta o `LabelGrid` pelo viewport.

### 5.2 Análise de dependência de estilo (`core/styles.ts:263`)

```ts
function classifyValue(value) {
  if (isInlineFunctionConditional(value)) return "graph-state";      // when: fn → sempre graph-state
  if (isInlineStateConditional(value))  return worst("item-state", worst(dep(then), dep(else)));
  if (isInlineDataConditional(value))   return worst(dep(then), dep(else));
  if (isValueFunction(value)) return "graph-state";
  return "static"; // literal / attribute binding
}
```

`analyzeStyleDeclaration` consolida o pior caso de todas as regras e extrai `xAttribute` / `yAttribute`. Efeito prático:

- **static:** reavalia só os itens tocados no grafo.
- **item-state:** reavalia também os itens com estado sujo (dirty set do `StateManager`).
- **graph-state:** qualquer `setGraphState`, inclusive os internos `_setPanning` / `_setZooming` no início e no fim do gesto, além de `isDragging` e `hasHovered`, **reavalia todos os nós/arestas**.

**Regra para nós:** zero funções em `styles`. Use `whenState`, `whenData`, `matchState`, `matchData` e bindings.

### 5.3 Depth buckets + zIndex

- `DepthBucketCollection` (`rendering/bucket.ts`) mantém, por programa e por depth, faixas contíguas de índices ordenados por zIndex.
- Hover só move o nó para `topNodes` via regra `whenState`. Não há reordenação global.

### 5.4 Geração de shader de nó (`rendering/nodes/generator.ts`)

- O fragment shader calcula, por shape, `float sdf_<shape>(vec2 uv, float size, <uniforms…>, <attributes…>)`. Exemplo: `sdf_circle(uv,size){ return length(uv) - size; }`.
- Depois compõe as layers em ordem, com `color = blendOver(color, layer_<name>(v_<attr>…, u_<uniform>…));`.
- Struct global `context` disponível nas layers: `sdf`, `uv`, `shapeSize`, `shapeHalfSize`, `pixelSize`, `aaWidth`, `correctionRatio`, `pixelToUV`, `inradiusFactor`.
- `discard` quando `sdf > aaWidth`. Alfa = `smoothstep(aaWidth, -aaWidth, sdf) * v_opacity` (borda dura se `antialiasNodes: false`).
- Modo `PICKING_MODE` reusa o mesmo SDF com `u_pickingPadding`. **O picking respeita a forma exata**, inclusive a forma wobbly.
- Atributo por nó (padrão de `shapes/rectangle.ts`):

```ts
attributes: [{ name: "aspectRatio", size: 1, type: WebGL2RenderingContext.FLOAT, source }],
variables: { [source]: { type: "number", default: defaultValue } },
inradiusFactorGLSL: (r) => `0.70710678 / max(${r}, 1.0 / ${r})`,
```

### 5.5 Picking GPU assíncrono (`core/hover-resolver.ts`)

1. Renderiza IDs num framebuffer reduzido (`pickingDownSizingRatio`, default 2).
2. No movimento do ponteiro, faz `readPixels` em um `PIXEL_PACK_BUFFER` e cria `fenceSync`.
3. Faz polling via rAF e só lê o PBO quando a fence sinaliza.

O resultado é **sem stall de pipeline**: o hover chega 1–2 frames depois. A resolução também roda após renders, porque um nó pode passar sob o cursor parado.

### 5.6 LabelGrid (`core/labels.ts`)

O grid é preenchido no process em "câmera nula", com células de `labelGridCellSize` px. Cada célula ordena os candidatos por `size` decrescente e desempata por `key`, o que é determinístico. Por frame:

```ts
const cellArea = cellSize * cellSize;
const scaledCellArea = cellArea / ratio / ratio;
const labelsToDisplayPerCell = Math.ceil((scaledCellArea * density) / cellArea); // = ceil(density/ratio²)
```

Só as células no viewport são consultadas. Depois aplica-se `labelRenderedSizeThreshold`: tamanho renderizado < 6 px fica sem label. `labelVisibility: "visible"` força o label e `"hidden"` o suprime.

**Implicação didática:** o tamanho do nó é a prioridade do label. Tamanho por nível hierárquico (domínio > área > tópico > conceito) dá LOD semântico grátis.

### 5.7 Atlas SDF de texto (`core/sdf-atlas.ts`)

- `SDFAtlasManager.registerFont({family, weight, style})`, `ensureGlyphs(text)`, `measureText`.
- Glifos rasterizados num canvas 2D e convertidos em SDF por **EDT de Felzenszwalb–Huttenlocher** (inlined do tiny-sdf).
- Defaults: `fontSize` 64, `buffer` 8, `radius` 24, `cutoff` 0.25, `maxTextureSize` 2048, debounce 100 ms.
- `labelFont` aceita strings CSS como `"600 Kalam"`: `parseFontString` em `utils/misc.ts` extrai estilo e peso e o resto vira família.
- **Não observa `document.fonts`.** Se a webfont não carregou, os glifos ficam em fallback e não são regenerados. Ver §10.

### 5.8 Data textures (`rendering/data-texture.ts`)

- Textura 2D RGBA32F com largura limitada a `MAX_TEXTURE_SIZE`. A 4.0.6 trocou o 4096 fixo pelo limite real.
- Free-list de slots, capacidade inicial 1024, crescimento ×1.5. Itens ocultos usam `HIDDEN_ITEM_INDEX = -1`.
- Unidades de textura: 1 edge-frame, 2 node-frame, 3 node data, 4 edge data, 5 atributos de layer. O `node-image` usa a partir de 6.
- **Custo de memória** ~ (nós × texels por nó × 16 B). 50k nós cabem com folga.

### 5.9 TextureManager (`node-image/src/texture.ts`)

- Defaults:
  - `size {mode:"max", value:512}`;
  - `objectFit "cover"`;
  - `correctCentering false`;
  - `maxTextureSize 4096` (limitado ao máximo do GL);
  - `debounceTimeout 500`;
  - `crossOrigin "anonymous"`.
- Shelf packing (`utils/shelf-atlas.ts`) com margem de 1 px.
- `loadSVGImage` só é usado quando a URL termina em `.svg` **e** `size.mode === "force"`. O SVG **precisa ter `width` e `height` na raiz**, senão lança erro e cai no rasterizador comum.
- Slots de textura: 0–5 reservados; layer "image" usa 6–11; outros nomes fazem hash para 12/18/24. São 6 texturas por layer.
- `getAttributeData` lê `data[imageAttribute]` do **display data**, então a imagem e a cor **precisam ser declaradas como `variables`**:

```ts
nodes: { variables: { image: { type: "string", default: "/img/placeholder.png" } },
         layers: [layerFill(), layerImage()] }
```

- `drawingMode: "color"` usa o alfa da imagem como máscara e pinta com `colorAttribute`. **É o ideal para ícones SVG monocromáticos desenhados à mão.**
- **O README do pacote está desatualizado** (descreve o `NodeImageProgram` do v3 e um modo "background"). Confie no código.

### 5.10 Density splat: contornos e heatmap (`layer-webgl/src/density-splat-program`)

1. Cria um FBO **R32F** (exige `EXT_color_buffer_float`).
2. Faz splat aditivo de um kernel por nó, com raio `radius` em px de grafo, `zoomToRadiusRatioFunction` (default `sqrt`) e pesos `getWeight(node)` cacheados em `cacheData`.
3. Faz um passe fullscreen que mapeia densidade → cor.
   - **Contornos:** `createContoursProgram(nodes, {radius=100, feather=1.5, levels:[{color, threshold}], border?:{color, thickness}})`.
   - **Heatmap:** `createHeatmapProgram(nodes, {radius, colorStops, shading?, getWeight?})`.

Para ligar a layer: `const off = bindWebGLLayer("regions", renderer, createContoursProgram(nodeKeys, opts), "region:analog")`, que devolve uma função de cleanup.

Ver o exemplo `webgl-layers/highlight-group.astro`, que combina Louvain, `depthLayers` por comunidade e toggles de contorno.

### 5.11 ForceAtlas2 na GPU (`layout-fa2-gpu/src/fa2-layout.ts`)

- Usa texturas float em ping-pong e uma quadtree **Barnes-Hut na GPU** (`quadTreeDepth: "auto"`, `quadTreeTheta: 1`).
- Controle **AIMD** de `iterationsPerFrame` (`"auto"`, `maxIterationsPerFrame` 100).
- O sigma renderiza **direto das posições da simulação**. O backport para o graphology acontece a cada `backportInterval` (200 ms) e no stop.
- API:
  - `new ForceAtlas2GPULayout(renderer, settings)`;
  - `start(budget | -1)`;
  - `run({iterations?, duration?}) → Promise`;
  - `stop()`;
  - `setNodeFixed(node, bool)` / `isNodeFixed`;
  - eventos `started` e `stopped({reason: "stop"|"iterations"|"duration"|"structure"|"kill"})`.
- **Mudança estrutural para o layout** (reason `"structure"`): adicione o lote inteiro e reinicie.
- Requer `EXT_color_buffer_float` e `EXT_float_blend`.

### 5.12 Eventos do graphology → sigma (`core/event-handlers.ts`)

- `LAYOUT_IMPACTING_FIELDS = x, y, zIndex, type`.
- `nodeAdded`, `edgeAdded` → refresh parcial agendado. Desde a 4.0.5, itens adicionados são avaliados uma vez.
- `nodeDropped` → `scheduleProcess`. A 4.0.5 corrigiu o #1516, que reavaliava o grafo todo em drops.
- `nodeAttributesUpdated` → refresh parcial do nó. Reindexa se o campo mexe em layout.
- `eachNodeAttributesUpdated` **sem hints** → refresh parcial de **todos** os nós, com reindexação. **É o que o FA2 worker do graphology faz a cada tick** (`assignLayoutChanges` usa `graph.updateEachNodeAttributes` sem hints).

---

## 6. Ecossistema graphology para a árvore formal

| Necessidade | Pacote / função | Notas |
|---|---|---|
| Grafo dirigido de pré-requisitos | `new DirectedGraph({ allowSelfLoops: false, multi: false })` | `multi: false` impede duplicatas. Ainda assim, arestas paralelas e self-loops são renderizáveis no v4 |
| Validar aresta da IA **antes** de inserir | `willCreateCycle(graph, source, target)` | O(V+E) por chamada. Agrupe as propostas do LLM e valide uma a uma |
| Checagem global | `hasCycle(graph)` | após import ou merge |
| Ordem de estudo | `topologicalSort(graph)`, `forEachNodeInTopologicalOrder` | — |
| Anéis do layout radial | `topologicalGenerations(graph)` → `string[][]` | geração 0 = fundamentos |
| Regiões | `louvain(graph, {resolution})` / `louvain.assign` | ou usar o atributo `subdomain` gerado pela IA (preferível: semântico e estável) |
| Métricas | `graphology-metrics` (`degree`, `betweenness`, `pagerank`) | priorizar o "próximo conceito" |
| Layout força | `graphology-layout-forceatlas2` (`inferSettings`, `FA2Layout` worker) | o worker é um Blob, então a CSP precisa de `worker-src blob:`. Respeita o atributo `fixed` (`helpers.js:144`). O supervisor reinicia o worker em add/drop |
| Pós-processo | `graphology-layout-noverlap` | remove sobreposição após inserir lotes |
| React | `@react-sigma/core` 6: `SigmaContainer`, `useSigma`, `useLoadGraph`, `useRegisterEvents`, `useSetSettings`, `useCamera` (`zoomIn`, `zoomOut`, `reset`, `goto`, `gotoNode`), `useFullScreen`, `ControlsContainer`, `ZoomControl`, `FullScreenControl` | memoizar `options` (`useMemo`), senão recria a instância |

---

## 7. Mapeamento para a nossa galaxy view

### 7.1 Modelo de atributos

```ts
// Nó (graphology attributes)
type KNodeAttrs = {
  x: number; y: number;           // mundo fixo [-1000,1000]², calculado em worker/servidor
  label: string;
  level: 0 | 1 | 2 | 3 | 4;       // 0=domínio, 1=área, 2=tópico, 3=conceito, 4=fato/detalhe
  subdomain: string;              // "analog" | "digital" | "grammar" | ...
  generation: number;             // de topologicalGenerations
  mastery: number;                // 0..1 (KT/FSRS)
  status: "locked" | "available" | "learning" | "mastered";
  icon?: string;                  // URL de SVG desenhado à mão (com width/height na raiz!)
  wobbleSeed: number;             // hash(key) % 6.283
  color: string;                  // cor cel base (por subdomínio)
  inkColor?: string;              // contorno
};
// Aresta
type KEdgeAttrs = { kind: "prereq" | "related" | "part-of"; locked?: boolean; strength?: number };
```

### 7.2 Configuração (esboço completo)

```ts
"use client";
import Sigma from "sigma";
import { sdfCircle, layerFill, pathLine, pathCurved, extremityArrow, layerPlain, layerDashed } from "sigma/rendering";
import { layerImage } from "@sigma/node-image";
import { layerBorder } from "@sigma/node-border";
import { celLayer, sdfWobble } from "./galaxy-primitives";

type NS = { isFocus: boolean; isDimmed: boolean; lod: "far" | "mid" | "near" };

export function createGalaxy(graph, container) {
  return new Sigma<KNodeAttrs, KEdgeAttrs, {}, NS>(graph, container, {
    primitives: {
      depthLayers: ["regions", "edges", "topEdges", "nodes", "topNodes"],
      nodes: {
        shapes: [sdfWobble(), sdfCircle()],
        variables: {
          icon: { type: "string", default: "" },
          inkColor: { type: "color", default: "#1d1b16" },
          wobbleSeed: { type: "number", default: 0 },
        },
        layers: [
          celLayer(),                                                 // base cel (2 tons + highlight)
          layerImage({ name: "image", drawingMode: "color", imageAttribute: "icon",
                       colorAttribute: "inkColor", padding: 0.22 }), // ícone desenhado à mão
          layerBorder({ borders: [{ size: 2, mode: "pixels", color: { attribute: "inkColor" } }] }), // tinta
        ],
        label: { font: "600 Kalam", margin: 6 },
      },
      edges: {
        paths: [pathLine(), pathCurved({ segments: 10, curvature: 0.18 })], // sem pathLoop
        extremities: [extremityArrow({ lengthRatio: 3, widthRatio: 2.2 })],
        layers: [layerPlain(), layerDashed({ dashSize: { value: 6 }, gapSize: { value: 5 }, cap: "round" })],
      },
    },
    customNodeState: { isFocus: false, isDimmed: false, lod: "far" },
    styles: {
      nodes: [
        {
          x: { attribute: "x" }, y: { attribute: "y" },
          shape: "wobble",
          label: { attribute: "label" },
          color: { attribute: "color", defaultValue: "#9bb" },
          size: { attribute: "level", dict: { "0": 34, "1": 22, "2": 14, "3": 9, "4": 6 } } as any, // categórico
          labelVisibility: "auto",
          depth: "nodes",
        },
        { whenData: { status: "locked" }, then: { opacity: 0.45 } },
        { whenState: "isDimmed", then: { opacity: 0.15, labelVisibility: "hidden" } },
        { matchState: "lod", cases: { far: { visibility: "visible" }, mid: {}, near: {} } },
        { whenState: "isHovered", then: { size: 18, depth: "topNodes", labelVisibility: "visible",
                                          backdropVisibility: "visible" } },
        { whenState: "isFocus", then: { depth: "topNodes", labelVisibility: "visible" } },
      ],
      edges: [
        { path: "curved", head: "arrow", size: 1.2, color: { node: "source" }, opacity: 0.55, depth: "edges" },
        { whenData: { kind: "related" }, then: { path: "line", head: "none", opacity: 0.25 } },
        { whenState: "isHighlighted", then: { opacity: 1, size: 2, depth: "topEdges" } },
      ],
    },
    settings: {
      autoRescale: "once", stagePadding: 40, enableCameraRotation: false,
      antialiasEdges: false, labelDensity: 0.8, labelGridCellSize: 120, labelRenderedSizeThreshold: 7,
      minCameraRatio: 0.02, maxCameraRatio: 4, enableEdgeEvents: false,
    },
  });
}
```

Notas sobre o esboço:

1. A forma exata do binding categórico numérico (`dict` com chave string) deve ser conferida no spike. Alternativa: gravar `size` como atributo direto.
2. A ativação do dash: na doc, `layerDashed` com `gapSize` vindo de atributo (`{attribute: "lockedGap", default: 0}`) desliga o tracejado quando o gap é 0. Use isso para "pré-requisito ainda bloqueado".
3. Chamar `setCustomBBox({ x: [-1000, 1000], y: [-1000, 1000] })` logo após criar.

### 7.3 Layer cel-shading (custom `FragmentLayer`)

```ts
export const celLayer = (): FragmentLayer => ({
  name: "cel",
  uniforms: [
    { name: "u_celLight", type: "vec2", value: [-0.6, 0.6] },
    { name: "u_celShade", type: "float", value: 0.78 },
  ],
  attributes: [{ name: "celColor", size: 4, type: WebGL2RenderingContext.UNSIGNED_BYTE, normalized: true, source: "color" }],
  glsl: /*glsl*/ `
vec4 layer_cel(vec4 v_celColor, vec2 u_celLight, float u_celShade) {
  vec2 p = context.uv / max(context.shapeSize, 1e-4);   // disco unitário
  vec2 L = normalize(u_celLight);
  float band = dot(p, L) < -0.25 ? u_celShade : 1.0;    // 2 tons duros (cel)
  vec3 rgb = v_celColor.rgb * band;
  if (length(p - L * 0.45) < 0.18) rgb = mix(rgb, vec3(1.0), 0.65); // brilho especular "pintado"
  return vec4(rgb, v_celColor.a);
}`,
});
```

- O padrão de atributo (`UNSIGNED_BYTE` normalizado, `source: "color"`) é o mesmo de `rendering/nodes/layers/fill.ts`.
- O antialiasing da silhueta continua vindo do gerador (`smoothstep(aaWidth, -aaWidth, sdf)`). As bandas internas são duras de propósito.
- Para suavizar só 1 px, use `smoothstep(-0.25 - context.pixelToUV, -0.25 + context.pixelToUV, dot(p, L))`.

### 7.4 Forma "wobbly" desenhada à mão (custom `SDFShape`)

```ts
export const sdfWobble = (): SDFShape => ({
  name: "wobble",
  uniforms: [],
  attributes: [{ name: "wobbleSeed", size: 1, type: WebGL2RenderingContext.FLOAT, source: "wobbleSeed" }],
  variables: { wobbleSeed: { type: "number", default: 0 } },
  inradiusFactor: 0.9,
  glsl: /*glsl*/ `
float sdf_wobble(vec2 uv, float size, float wobbleSeed) {
  float a = atan(uv.y, uv.x);
  float r = size * (1.0 + 0.04 * sin(5.0 * a + wobbleSeed) + 0.025 * sin(9.0 * a + 2.3 * wobbleSeed));
  return length(uv) - r * 0.93;   // 0.93 mantém dentro do quad
}`,
});
```

- Isso **não é um SDF exato**, mas o erro é pequeno para amplitudes ≤ 5%. O AA e o picking funcionam.
- O `inradiusFactor` define onde ícone e backdrop cabem. Use 0.9.
- Precisa do mesmo cabeçalho de licença MIT apenas se copiarmos trechos (aqui é código nosso).

### 7.5 Ícones SVG desenhados à mão

- Use `layerImage({ drawingMode: "color", imageAttribute: "icon", colorAttribute: "inkColor" })`: o alfa do SVG vira máscara e a cor vem do tema.
- **Requisitos dos SVGs:**
  - `width` e `height` na raiz;
  - traço preto e fundo transparente;
  - servidos do mesmo host (em Electron, `app://`), com `crossOrigin` "anonymous" funcionando.
- Para nitidez em SVG: `textureManagerOptions: { size: { mode: "force", value: 128 } }` e URL terminando em `.svg`.
- Reduza `debounceTimeout` (500 ms) para cerca de 50 ms para os ícones aparecerem rápido no zoom-in.
- Atlas: 4096² / 128² = 1024 ícones por textura. Há 6 texturas por layer, então cerca de 6k ícones distintos, mais que suficiente.

### 7.6 Arestas pedagógicas

| Semântica | Estilo |
|---|---|
| Pré-requisito (A → B) | `path: "curved"`, `head: "arrow"`, cor do nó de origem (`{node:"source"}`) |
| Pré-requisito bloqueado | `layerDashed` com `gapSize` vindo de atributo (> 0 só se `locked`) |
| Relacionado (não dirigido) | `path: "line"`, `head: "none"`, opacidade 0.25 |
| Hierarquia (part-of) | normalmente **não desenhar**: a contenção é expressa por região e anel |
| Caminho de estudo ativo | `setEdgesState(pathEdges, {isHighlighted: true})` + `setNodesState(others, {isDimmed: true})` |

- **Performance:** cada aresta paga o vértice do path mais pesado registrado (`pathLoop` = 66 vértices contra 4 do `pathLine`). Registre só `pathLine` + `pathCurved` com `segments` 8–10.

### 7.7 Regiões de subdomínio e mapa de pontos fracos

```ts
const offRegion = bindWebGLLayer("regions", renderer,
  createContoursProgram(nodesOfSubdomain, {
    radius: 140, feather: 1.5,
    levels: [{ color: "#f6e7c855", threshold: 0.35 }],
    border: { color: "#1d1b16", thickness: 2 },            // contorno "tinta"
  }), `region:${subdomainId}`);
```

- Por custo de GPU, ligue as regiões **só para o subdomínio em hover ou selecionado**, ou para no máximo cerca de 6 subdomínios visíveis em zoom "far". Remova com `offRegion()`.
- **Pontos fracos:** `createHeatmapProgram(nodes, { radius: 90, getWeight: n => 1 - mastery(n), colorStops: [...] })`, num toggle explícito ("ver lacunas").

### 7.8 LOD semântico

- **Labels:** automático via `LabelGrid`, com tamanho por `level`.
- **Visibilidade por zoom.** Ouça `renderer.getCamera().on("updated", …)`, com throttle de 100 ms, e calcule o `tier` a partir de `ratio`. **Só quando o tier mudar**, faça:

```ts
renderer.setNodesState(keysByLevel[4], { lod: tier === "near" ? "near" : "far" });
```

  Combine com a regra `matchState: "lod"`, que oculta o `level 4` em "far". Isso reavalia **só** os nós afetados (dependência item-state).
- **Evite** `customGraphState.zoomTier` com `when: fn`, porque isso força reavaliação global a cada pan.
- Para colapsar subárvores (focus+context), aplique `isDimmed` no complemento do foco (`setNodesState`).

### 7.9 Expansão procedural pela IA

1. O agente propõe nós e arestas (JSON tipado).
2. **Validação formal (worker):**
   - ids únicos;
   - `willCreateCycle(graph, s, t)` aresta a aresta;
   - rejeitar arestas que criam ciclo e devolver ao agente com explicação;
   - `topologicalGenerations` incremental (a geração do novo nó = 1 + max(geração dos pré-requisitos)).
3. **Posicionamento:**
   - posição inicial = baricentro dos pré-requisitos + deslocamento radial para fora (anel da geração) + jitter determinístico (seed = hash(key));
   - relaxação local com d3-force (`forceRadial(r_g)` + `forceCollide` + `forceLink`) **só nos novos nós** (antigos com `fx`/`fy`), em Worker, por cerca de 100 ticks;
   - alternativa: FA2 worker com `fixed: true` nos antigos.
4. **Inserção em lote:**
   - `graph.import({nodes, edges}, true)` ou `addNode` em sequência dentro de um mesmo tick, para o sigma agendar um único refresh parcial;
   - nascer com `size` pequeno e animar com `animateNodes(graph, targets, {duration: 400})` (`sigma/utils`);
   - para lotes > cerca de 200 nós, pular a animação.
5. Com `autoRescale: "once"` ou `setCustomBBox`, **a câmera não pula**. Opcionalmente use `camera.animate` até o centro do lote.

### 7.10 Sessões por domínio (Electronics, English)

- **Uma** instância sigma por janela. Troque com `renderer.setGraph(graphDoDominio)` e restaure `camera.setState(savedCameraByDomain[id])`.
- Guarde `camera.getState()` no `beforeunload` e na troca de sessão.
- **Não** crie um sigma por aba: os navegadores limitam contextos WebGL (cerca de 16) e cada instância aloca data textures e atlas.

### 7.11 Fontes (labels hand-drawn)

```ts
await Promise.all([document.fonts.load('600 16px "Kalam"'), document.fonts.load('400 16px "Kalam"')]);
const renderer = createGalaxy(graph, container); // só depois
```

### 7.12 Next.js 16 + Electron

- **SSR:** `const Galaxy = dynamic(() => import("./galaxy-view"), { ssr: false })`. Importar `sigma` no servidor quebra porque `rendering/edges/generator.ts:33` faz `const { FLOAT, UNSIGNED_BYTE } = WebGL2RenderingContext;` no topo do módulo.
- **Container:**
  - precisa ter dimensões ao construir;
  - **o sigma deve ser o único dono do container**, porque `kill()` remove todos os filhos;
  - overlays React ficam num irmão posicionado por cima.
- **Electron:**
  - verificar se o GPU process está ativo (`app.getGPUFeatureStatus()`);
  - SwiftShader (fallback de software) pode não expor `EXT_color_buffer_float` / `EXT_float_blend`, o que quebra contornos, heatmap e fa2-gpu. Detecte a falha e desligue essas features;
  - CSP com `worker-src 'self' blob:` (FA2 worker) e `img-src 'self' app: data:` (ícones).

### 7.13 Layout radial por gerações (recomendado para a árvore formal)

```ts
import { topologicalGenerations } from "graphology-dag";
export function radialLayout(g, { r0 = 80, dr = 120, sectors }: { r0?: number; dr?: number; sectors: Record<string, [number, number]> }) {
  const gens = topologicalGenerations(g);
  gens.forEach((gen, i) => {
    const r = r0 + i * dr;
    // barycenter: ordena por média angular dos pais para reduzir cruzamentos
    gen.sort((a, b) => meanParentAngle(g, a) - meanParentAngle(g, b));
    const bySector = groupBy(gen, (n) => g.getNodeAttribute(n, "subdomain"));
    for (const [sd, nodes] of Object.entries(bySector)) {
      const [a0, a1] = sectors[sd];
      nodes.forEach((n, k) => {
        const a = a0 + ((k + 0.5) / nodes.length) * (a1 - a0);
        g.mergeNodeAttributes(n, { x: r * Math.cos(a), y: r * Math.sin(a), generation: i });
      });
    }
  });
}
```

- Isso coincide com `lh-graph-pedagogy.md`: não usar d3-force puro para a camada curricular L1.
- Rode em Worker e transfira as posições como `Float32Array`.
- Aplique de uma vez com `graph.updateEachNodeAttributes(fn, { attributes: ["x", "y"] })`. **Passar hints** evita reavaliar estilos que não dependem de x/y.

---

## 8. Arquivos exatos para copiar, adaptar ou consultar

Todos os caminhos são relativos a `_refs/extra/jacomyal__sigma.js/`. Em regra, **consuma pelo npm**. Copie apenas trechos de GLSL e padrões, mantendo o aviso MIT.

| Caminho | O que é | Como usar no learnharness |
|---|---|---|
| `packages/sigma/src/rendering/nodes/shapes/rectangle.ts` | padrão de SDF com atributo por nó, `variables` e `inradiusFactorGLSL` | **adaptar** para `sdfWobble` (`components/galaxy/primitives.ts`) |
| `packages/sigma/src/rendering/nodes/shapes/square.ts` | IQ box SDF com `u_cornerRadius` e `u_rotation` | referência para "cartões" de domínio arredondados |
| `packages/sigma/src/rendering/nodes/layers/fill.ts` | fragment layer mínima (atributo de cor) | **template** do `celLayer` |
| `packages/sigma/src/rendering/nodes/generator.ts` | composição de layers, struct `context`, AA, picking | consulta para escrever GLSL que funcione no gerador |
| `packages/sigma/src/rendering/nodes/types.ts` | `SDFShape`, `FragmentLayer`, `LayerLifecycleHooks` | tipos dos nossos primitives |
| `packages/sigma/src/rendering/edges/layers/dashed.ts` | `layerDashed` (`DashSize` com `attribute`) | aresta de pré-requisito bloqueado |
| `packages/sigma/src/rendering/edges/paths/curved.ts` | Bezier quadrática, `curvature` como `ValueSource` | curvatura por aresta (atributo) |
| `packages/node-image/src/layer.ts`, `texture.ts` | `layerImage`, `TextureManager`, `loadSVGImage` | **consumir** via npm. Ler `texture.ts` para entender `size.mode: "force"` + SVG |
| `packages/node-border/src/types.ts`, `layer.ts` | `layerBorder` e o schema `borders[]` | contorno de tinta em pixels |
| `packages/layer-webgl/src/contours/index.ts`, `heatmap/index.ts`, `density-splat-program/index.ts` | contornos e heatmap | **consumir**. Adaptar só se precisarmos de "hachura" cel nos contornos |
| `packages/layer-webgl/src/bind-webgl-layer.ts` | 20 linhas: `addCustomLayerProgram` + cleanup | padrão do nosso `useRegionLayer` |
| `packages/layout-fa2-gpu/src/fa2-layout.ts`, `README.md` | FA2 GPU | opcional (fase 3) |
| `packages/sigma/src/core/labels.ts` | `LabelGrid` | **copiar a ideia** (≈40 linhas, com aviso MIT) para o renderer Canvas 2D atual da fase 1 (`components/graph-canvas.ts`), para ter LOD de labels hoje |
| `packages/sigma/src/core/hover-resolver.ts` | picking assíncrono | referência caso o Canvas 2D precise de picking por cor |
| `packages/sigma/src/utils/animate.ts` | `animateNodes` | animação de inserção |
| `packages/utils/src/fitViewportToNodes.ts`, `getNodesInViewport.ts` | enquadrar e consultar o viewport | "ir para o conceito". **Leem atributos `x` / `y`**, então mantenha esses nomes |
| `packages/website/src/examples/styling/custom-node-shape.astro` | SDF de coração (template de shape custom) | exemplo mínimo |
| `packages/website/src/examples/styling/node-images.astro` | `layerImage` + `variables.image` | exemplo mínimo de ícones |
| `packages/website/src/examples/core/hover-search.astro` | estados custom `isActive` / `hasActiveSubgraph` + `refresh({skipIndexation:true})` | **padrão de busca e foco** |
| `packages/website/src/examples/webgl-layers/highlight-group.astro` | Louvain + `depthLayers` por comunidade + contornos | **padrão de regiões** |
| `packages/website/src/examples/core/large-graph.astro` | 5k nós / 10k arestas (default), circlepack + FA2 worker | baseline de benchmark |
| `packages/website/src/examples/core/fa2-gpu-layout.astro` | uso do FA2 GPU | fase 3 |
| `packages/website/src/content/docs/how-to/technical/performance.md` | guia de performance | ler antes do benchmark |
| `packages/website/src/content/docs/how-to/technical/framework-integration.md` | Next / React | `next/dynamic` + `kill` + `setGraph` |
| `packages/website/src/content/docs/how-to/technical/migration-v3-v4.md` | migração | `hidden` → `visibility`, `forceLabel` → `labelVisibility` |

---

## 9. Dependências

```bash
# core (fase 2)
npm i sigma@4.0.6 graphology@0.26.0 graphology-types@0.24.8 graphology-dag@0.4.1 \
      graphology-utils@2.5.2 @sigma/node-image@4.0.2 @sigma/node-border@4.0.0 @sigma/layer-webgl@4.0.0
# layout / análise
npm i graphology-layout@0.6.1 graphology-layout-forceatlas2@0.10.1 graphology-layout-noverlap@0.4.2 \
      graphology-communities-louvain@2.0.2 graphology-metrics@2.4.2
# opcionais
npm i @sigma/utils@4.0.0 @sigma/export-image@4.0.0 @sigma/layout-fa2-gpu@4.0.0
npm i @react-sigma/core@6.0.0      # só se preferirmos hooks; um wrapper próprio de ~80 linhas dá mais controle
```

- Fixar versões **exatas**: a linha v4 teve 6 patches até 2026-11-10, e houve mudanças de comportamento na 4.0.4 e na 4.0.5.
- O `d3-force` já existente segue útil para o relaxamento local no worker.
- O `@xyflow/react`, não usado no `package.json`, pode sair.

---

## 10. Armadilhas

1. **SSR:** `WebGL2RenderingContext` é acessado no topo do módulo (`rendering/edges/generator.ts:33`). Use sempre `dynamic(..., {ssr:false})` e nunca importe `sigma/rendering` em código compartilhado com o servidor.
2. **Styles e primitives imutáveis.** Não há `setStyles`. Para trocar o tema, use cores por atributo e variables, ou recrie a instância preservando a câmera.
3. **Funções em styles** (`when: fn` ou função de valor) → dependência `graph-state` → **reavaliação de todos os itens** em cada `setGraphState`, inclusive início e fim de pan e zoom (`_setPanning`, `_setZooming`) e hover (`hasHovered`).
4. **FA2 worker do graphology** usa `updateEachNodeAttributes` **sem hints**, o que dispara refresh parcial de todos os nós com reindexação a cada tick. Rode o layout fora do grafo exibido (cópia) e aplique as posições no fim, ou com hints `{attributes:["x","y"]}`.
5. **O supervisor do FA2 reinicia o worker** a cada add/drop. Adicione em lote com o layout parado.
6. **`autoRescale: true`** re-enquadra tudo ao inserir nós nas bordas. Use `"once"` ou `setCustomBBox`.
7. **Fontes:** o `SDFAtlasManager` não observa `document.fonts`. Carregue as webfonts antes de criar o sigma.
8. **`kill()` remove todos os filhos do container.** Nada de React renderizando dentro dele.
9. **Container sem tamanho** lança erro (a menos que `allowInvalidContainer`). Cuidado com abas ocultas (`display:none`) e painéis colapsáveis.
10. **Limite de contextos WebGL:** uma instância por janela, com `setGraph` para trocar de domínio.
11. **SVG sem `width`/`height`** na raiz → `loadSVGImage` lança erro e cai no rasterizador (borrado). Além disso, SVG só é usado com `size.mode: "force"` e URL terminando em `.svg`.
12. **Imagem e cor do `layerImage` precisam ser `variables` declaradas**, porque são lidas do display data e não diretamente dos atributos.
13. **O README do `@sigma/node-image` está desatualizado** (API do v3). Confie em `src/layer.ts`.
14. **`DEFAULT_STYLES` de aresta** usa `whenState: ["isHighlighted","isHovered"]`, um **AND** e não OR.
15. **`depthLayers` próprios + estilos default** exigem que os 4 nomes default estejam presentes. Com estilos próprios, parta de `DEPTHLESS_STYLES`.
16. **Bindings:** `DirectAttributeBinding` usa `defaultValue`, mas o `ValueSource` dos primitives (ex.: `curvature`, `aspectRatio`) usa `default`. Os nomes são diferentes.
17. **x/y inválidos** (NaN, undefined) lançam erro no `addNode`. Valide a saída da IA e do layout antes de inserir.
18. **Path mais caro dita o custo de todas as arestas:** não registre `pathLoop` se não houver self-loops e mantenha `segments` baixos.
19. **Semitransparência é cara** (doc de performance). Prefira cores sólidas "esmaecidas" a `opacity` < 1 em muitos nós, e `antialiasEdges: false`. Os frames são fragment-bound: cortar vértices pela metade economizou ~6%, enquanto mudanças em opacidade e AA economizaram até ~80%.
20. **Eventos de aresta** dobram o picking. Mantenha `enableEdgeEvents: false`.
21. **Contornos e heatmap** alocam FBO R32F e fazem splat por frame. Exigem `EXT_color_buffer_float`, e o fa2-gpu também `EXT_float_blend`. Detecte e degrade (SwiftShader no Electron, GPUs antigas).
22. **CSP:** o FA2 worker é Blob → `worker-src blob:`.
23. **`@react-sigma`:** `options` sem `useMemo` recriam a instância a cada render.
24. **`fitViewportToNodes` e `getNodesInViewport` leem atributos `x` e `y`.** Não renomeie as coordenadas.
25. **Rotação de câmera** está ligada por default (`enableCameraRotation: true`). Desligue para não desorientar.
26. **Hover assíncrono** chega 1–2 frames atrasado. Testes E2E precisam esperar por `enterNode` e não assumir sincronia.

---

## 11. Plano de integração em fases

### Fase 0: higiene (agora, sem sigma)

- Portar a ideia do `LabelGrid` (§5.6) para `components/graph-canvas.ts`: LOD de labels determinístico no Canvas 2D atual.
- Adicionar `graphology` + `graphology-dag` ao **modelo** de dados (independente do renderer):
  - `willCreateCycle` no pipeline de expansão da IA;
  - `topologicalGenerations` para o layout radial.
- **Critério de aceite:** 0 ciclos aceitos em 1.000 propostas sintéticas (teste unitário); labels estáveis sem flicker em pan.

### Fase 1: spike isolado (1–2 dias)

- Criar `components/galaxy/` com:
  - `galaxy-view.tsx` (dynamic, `ssr:false`);
  - `sigma-host.ts` (cria, faz `setGraph` e `kill`);
  - `primitives.ts` (`celLayer`, `sdfWobble`);
  - `styles.ts`;
  - `layout.worker.ts` (radial + relaxação d3-force).
- Atrás da flag `NEXT_PUBLIC_GALAXY_RENDERER=sigma|canvas`.
- **Benchmarks** com `DEBUG_logRenderStats` + `DEBUG_gpuTimerQueries`, em notebook com iGPU (Intel Iris Xe ou equivalente) e no Electron empacotado. As metas abaixo são **alvos**, não medições:

| Cenário | Meta |
|---|---|
| 5k nós / 10k arestas (baseline `large-graph.astro`) | process inicial < 150 ms; pan p95 < 8 ms |
| 20k nós / 40k arestas | process < 400 ms; pan p95 < 16 ms; GPU ociosa = 0 frames |
| Inserção de 50 nós | < 30 ms de CPU no main thread; sem pulo de câmera |
| Hover | latência < 2 frames |
| Contornos ligados (1 subdomínio) | p95 < 16 ms a 20k nós |
| Memória JS + GPU estimada | < 350 MB a 20k nós |

- **Critério de aceite:** paridade visual com o tema cel (screenshots de regressão); nenhum canvas extra no DOM; 0 frames em idle (rAF instrumentado).

### Fase 2: produção (galaxy view padrão)

- Sessões por domínio com `setGraph` + câmera persistida.
- LOD por `setNodesState` em mudanças de tier.
- Regiões sob demanda (hover ou seleção).
- Ícones SVG (atlas forçado em 128 px).
- Busca e foco (padrão `hover-search.astro`).
- `export-image` para o "cartão de progresso".
- Fallback automático para Canvas 2D se `getContext("webgl2")` falhar.
- **Critério de aceite:** gatilho do `lh-ui-theme.md` (p95 > 16 ms com >15k primitivas no Canvas 2D) satisfeito pelo sigma, que fica abaixo de 16 ms.

### Fase 3: escala e extras

- `@sigma/layout-fa2-gpu` para o "modo exploração livre" (try/catch → FA2 worker).
- Heatmap de lacunas.
- Modo analítico com mais de 50k nós via **cosmos.gl** (`@cosmos.gl/graph` 3.6.0, MIT) numa tela separada, sem tentar unificar renderers.

---

## 12. Alternativas

| Opção | Prós | Contras | Veredito |
|---|---|---|---|
| **sigma v4** | maduro (desde 2012), MIT, graphology, primitives e GLSL customizáveis, labels SDF, picking exato, on-demand, layers no mesmo contexto | v4 recente (API em movimento), styles e primitives imutáveis, curva de GLSL | **recomendado** para 5k–50k |
| **cosmos.gl** (`@cosmos.gl/graph` 3.6.0, MIT) | simulação de força **na GPU** até milhões de nós | labels fora do GL (DOM / canvas próprio), estética menos controlável, peers luma.gl 9.3 | modo analítico com mais de 50k nós |
| `@cosmograph/cosmos` 2.6.0 | — | **CC-BY-NC-4.0** (incompatível com AGPL comercial) | **não usar** |
| Canvas 2D atual (d3) | já existe, zero dependências novas, estética fácil (roughness via Path2D) | CPU-bound; p95 cresce com primitivas; sem picking por forma | manter na fase 0/1 |
| PixiJS v8 / custom WebGL | controle total, sprites | reimplementar labels, culling, picking e câmera (o que o sigma já dá) | não compensa |
| @xyflow/react | ótimo para dezenas ou centenas de nós editáveis (DOM) | não escala para milhares | só para editor local de subgrafo |

---

## 13. Questões em aberto

1. Escala-alvo real por domínio após 6–12 meses de expansão (5k? 50k?). Isso define se o cosmos.gl entra ou não.
2. Layout: radial determinístico por gerações (estável, "mapa mental") ou força (orgânico)? Proposta: radial como base e força só para relaxação local.
3. A forma wobbly fica boa com AA em telas de baixa DPI? Validar no spike (amplitude ≤ 5%).
4. As GPUs dos usuários (Electron em Windows) expõem `EXT_color_buffer_float` / `EXT_float_blend`? É preciso telemetria opt-in de capacidades.
5. Binding categórico com chave numérica (`level` → tamanho) funciona como esperado, ou é melhor gravar `size` já resolvido?
6. Precisamos de arestas clicáveis (custo de um segundo passe), ou a interação por nó basta?
7. Os contornos de região devem ter hachura ou "rough" para combinar com o cel? Isso exigiria adaptar o passe de cor do `density-splat-program`.

---

## 14. Fontes

- Repositório: https://github.com/jacomyal/sigma.js (commit `e7748c88`, 2026-11-10). Local em `_refs/extra/jacomyal__sigma.js`.
- Docs v4: https://www.sigmajs.org (fonte em `packages/website/src/content/docs/`):
  - conceitos: rendering, lifecycle, styles-and-primitives, depth-and-z-order, sizes, coordinate-systems;
  - referência: settings, state-flags, sigma-api, events, style-properties, style-value-types, primitives-schema, camera-api;
  - how-tos: performance, framework-integration, loading-data, migration-v3-v4, shapes, fill-layers, hover-search, drag-drop, webgl-layers, sync-html-svg, attachments.
- `CHANGELOG.md` (4.0.0 → 4.0.6) e `LICENSE.txt` (MIT).
- npm (consultado em 2026-11-18):
  - https://www.npmjs.com/package/sigma
  - https://www.npmjs.com/package/graphology
  - https://www.npmjs.com/package/graphology-dag
  - https://www.npmjs.com/package/graphology-layout-forceatlas2 (README via unpkg)
  - https://www.npmjs.com/package/@react-sigma/core
  - https://www.npmjs.com/package/@sigma/layout-fa2-gpu
  - https://www.npmjs.com/package/@cosmos.gl/graph
  - https://www.npmjs.com/package/@cosmograph/cosmos
- graphology: https://graphology.github.io (standard library: dag, layout-forceatlas2, communities-louvain, metrics).
- Inigo Quilez, 2D SDFs: https://iquilezles.org/articles/distfunctions2d/ (citado em `rectangle.ts` / `square.ts`).
- Felzenszwalb & Huttenlocher, "Distance Transforms of Sampled Functions" (2012), base do EDT em `sdf-atlas.ts` (via mapbox/tiny-sdf, BSD-2).
- Contexto learnharness: `components/graph-canvas.ts` (linhas 1–15), `components/graph-view.tsx`, `docs/research/lh-ui-theme.md` §7, `docs/research/lh-graph-pedagogy.md`.
