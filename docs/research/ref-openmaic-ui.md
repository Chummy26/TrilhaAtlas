# OpenMAIC: camada de UI e renderização (ref-openmaic-ui)

> Pesquisa de referência para o fork do learnharness. Fonte: `_refs/OpenMAIC`, commit `cb225a52` de 2026-11-18,
> versão `1.5.0-rc.3`. Em 2026-11-18 o GitHub mostra cerca de 43,9k estrelas, o release estável mais recente
> `v1.4.2` (2026-11-09) e o RC `v1.5.0-rc.3` (2026-11-17).
> Pacotes no npm em 2026-11-18: `@openmaic/renderer@0.2.2` (2026-11-13) e `@openmaic/dsl@0.13.0`, ambos MIT.
> Escopo lido: `app/**`, `components/**`, `render-service/**`, `types/**`, `middleware.ts`, `public/**`, `assets/**`,
> `e2e/**` e `tests/**`. Também li, só quando necessário para entender a UI, partes de `lib/**` e
> `packages/@openmaic/**`. Nenhum código do repositório foi executado.

---

## 0. Resumo

- **Modelo de aula.** Uma aula é um `Stage` com uma lista de `Scene`s. Cada cena tem `type` (`slide | quiz | interactive | pbl`),
  um `content` correspondente e uma lista de `actions[]`, que é o roteiro de reprodução: `speech`, `spotlight`, `laser`, `wb_*`
  (quadro branco), `play_video`, `discussion` e `widget_*`. O contrato está em `@openmaic/dsl`, publicado no npm, MIT e sem
  dependências.
- **Reprodução.** Dois motores fazem o trabalho:
  - `PlaybackEngine` (`lib/playback/engine.ts`) é uma máquina de estados `idle → playing ⇄ paused`, com um estado `live` para
    discussão ou perguntas.
  - `ActionEngine` (`lib/action/engine.ts`) executa cada ação, alterando stores Zustand ou mandando `postMessage` para o iframe.
  - Os tempos ficam em `lib/choreography/timing.ts`, um módulo puro.
- **Slides.** `<SlideCanvas>` de `@openmaic/renderer` (npm, MIT) renderiza um JSON no estilo PPTist com viewport lógico
  1000×562,5. Os efeitos spotlight, laser, highlight e zoom são props.
- **Quadro branco.** É uma sobreposição animada (motion) que usa o mesmo modelo de elementos dos slides.
- **Falas e TTS.** O áudio de TTS é **pré-gerado por fala** (`/api/generate/tts`) e tocado por um único `HTMLAudioElement`
  reaproveitado. Se não houver áudio, o motor usa a Web Speech API dividida em frases ou, por último, um temporizador de
  leitura estimado.
- **Discussão e perguntas ao vivo.** Usam SSE de `/api/chat/pi`, um loop de "Director" construído com `pi-agent-core`. O texto
  é revelado por um `StreamBuffer` com tick de 30 ms.
- **Modelos.** O catálogo estático é grande e fica em `lib/ai/providers.ts`, com 20 provedores embutidos e capacidades por modelo,
  incluindo "thinking". Há também:
  - **descoberta dinâmica** via `/api/provider/probe-models`, que lê o `/models` de endpoints compatíveis com OpenAI;
  - **slots de modelo em árvore**, com herança (`lib/config/model-slots.ts`).

  **Não existe login por assinatura (OAuth)**: tudo é por chave de API. Porém o `@earendil-works/pi-ai@1.4.0` que o
  learnharness já instala inclui OAuth para `openai-chatgpt`, `openai-codex`, `anthropic`, `github-copilot` e outros
  (ver §4.6).
- **O que portar.**
  1. `@openmaic/dsl` e `@openmaic/renderer`, como dependências npm.
  2. O **standalone player** (`lib/standalone-player/playback/sequencer.ts` mais `pause-gate.ts`), um sequenciador sem stores
     baseado em "ports". É o melhor molde para a nossa "visualização de aula por nó".
  3. As partes puras de `lib/choreography`.
  4. `computePlaybackView`.
  5. `AudioPlayer`.
  6. `StreamBuffer`.
  7. A lógica de TTS do navegador.
  8. O pool de iframes interativos.
  9. A árvore de slots de modelo.

  **Não portar** o `PlaybackChromeRoot` (2.308 linhas), o `Roundtable` (2.419 linhas), o workbench, o PBL nem o
  `render-service`.
- **Licença.** MIT desde a v0.3.0 (2026-06-28, quando foi "relicensed to MIT"), portanto compatível com o nosso AGPL-3.0.
  Há exceções: `packages/mathml2omml` é LGPL-3.0+, os avatares são remix de Avataaars (licença própria, "free for personal and
  commercial use"), há um GSAP vendorizado e partes do modelo de slide foram portadas do PPTist (AGPL-3.0, o que não conflita
  conosco). Detalhes em §8.

---

## 1. Stack e mapa da UI

| Item | Valor |
|---|---|
| Framework | Next.js `16.3.3` (App Router), React `19.2.3`, Tailwind 4, shadcn (estilo `radix-vega`), `motion` 12, `lucide-react` |
| Estado | Zustand 5 (com `persist` em `settings`), immer, `useSyncExternalStore` no `SceneProvider` |
| IA | Vercel AI SDK 6 (`ai`, `@ai-sdk/*`) e `@earendil-works/pi-agent-core@0.80.3` como harness do chat |
| Persistência | **PostgreSQL obrigatório** no servidor (`DATABASE_URL`; sem ele o servidor não sobe), Dexie (IndexedDB) para legado e bytes de mídia, `BrowserKVStore` (`@openmaic/storage`) para o cursor de reprodução |
| i18n | i18next, 12 locales, **inclusive `pt-BR`** (`lib/i18n/locales/pt-BR.json`) |
| Testes | Vitest (cerca de 1.331 arquivos em `tests/`), Playwright (cerca de 50 specs em `e2e/tests`) |

Tamanho aproximado em linhas TS/TSX: `components/` com cerca de 104k, `lib/` com cerca de 225k, `packages/` com cerca de 153k,
`app/` com cerca de 14,7k e `render-service/` com cerca de 13,9k.

### Pastas relevantes

```
app/
  layout.tsx                 # providers globais: AdaptiveProvider, ThemeProvider, I18nProvider,
                             #   ModelSettingsInit, AgentRegistryInit, AccessCodeGuard, Toaster
  classroom/[id]/page.tsx    # só <ClassroomSurface classroomId variant="page"/>
  api/**                     # ~110 rotas (generate/tts, quiz-grade, chat/pi, provider/probe-models,
                             #   model-config, usage, export-video, ...)
  eval/whiteboard/page.tsx   # página de avaliação de layout do quadro (renderiza elementos isolados)
components/
  classroom/ClassroomSurface.tsx   # pipeline de carregamento do curso + <Stage/>
  stage.tsx                        # despacha entre o modo Edit e o de reprodução (Playback) + InteractiveIframeHost
  edit/PlaybackChromeRoot.tsx      # TODA a orquestração de reprodução (2308 linhas)
  canvas/canvas-area.tsx           # palco: camada do quadro + SceneRenderer + overlays
  stage/scene-renderer.tsx         # switch por scene.type
  slide-renderer/Editor/*          # RendererScreenCanvas (usa @openmaic/renderer) e ScreenCanvas legado
  whiteboard/{index,whiteboard-canvas,whiteboard-history}.tsx
  roundtable/{index,presentation-speech-overlay,audio-indicator}.tsx  # dock com avatares, balão, input
  chat/{chat-area,use-chat-sessions,proactive-card,lecture-notes-view}.tsx
  scene-renderers/{quiz-view,interactive-renderer,InteractiveIframeHost,pbl-renderer}.tsx
  classroom/course-end/{CourseEnd,badges}.tsx + course-end.css   # tela final com medalha
  settings/** (models/model-map, slot-picker, provider-config-panel, usage-dashboard, tts-*)
lib/
  playback/{engine,types,derived-state,cursor,action-resume,action-navigation}.ts
  action/engine.ts
  choreography/{timing,cursor,timeline,descriptors}   # puro, compartilhado com o exportador de vídeo
  buffer/stream-buffer.ts
  utils/audio-player.ts
  store/{stage,canvas,settings,widget-iframe,interactive-iframe-pool,whiteboard-history,...}.ts
  standalone-player/**      # player offline SEM stores (melhor molde para portar)
  ai/providers.ts, config/model-slots.ts, model-settings/**, server/model-config/**
packages/@openmaic/{dsl,renderer,editor,generation,storage,importer,geometry}
render-service/             # serviço Node 22 + Chromium + FFmpeg para exportar MP4 (opcional)
```

`middleware.ts` faz duas coisas. Primeiro, cria um dono anônimo por navegador: o cookie é emitido na resposta da página e
encaminhado na própria requisição. Segundo, aplica o gate opcional `ACCESS_CODE`, validado por HMAC no cookie
`openmaic_access`: rotas `/api/*` sem o cookie recebem 401, e páginas passam e mostram um modal. O middleware também devolve
404 para `/workbench` quando a flag está desligada e exclui `api/sandbox/preview/tunnel` do matcher, porque aquela rota é um
stream duplex.

`types/` contém apenas shims: `web-speech.d.ts` (construtores de `SpeechRecognition`) e `web-extraction-vendors.d.ts` (turndown).

---

## 2. (a) Como a aula é renderizada

### 2.1 Modelo de dados (`@openmaic/dsl`, re-exportado em `lib/types/stage.ts` e `lib/types/action.ts`)

Estes tipos são a base que vale portar.

```ts
// packages/@openmaic/dsl/src/stage.ts (resumo)
type SceneType = 'slide' | 'quiz' | 'interactive' | 'pbl';
type StageMode = 'autonomous' | 'playback' | 'edit';
interface Stage { id; name; description?; languageDirective?; style?;
  whiteboard?: Whiteboard[]; videoManifest?; agentIds?; generatedAgentConfigs?: GeneratedAgentConfig[];
  interactiveMode?; taskEngineMode?; createdAt; updatedAt }
interface SceneCore<TAction = Action> { id; stageId; title; order; actions?: TAction[];
  whiteboards?: Slide[]; multiAgent?: MultiAgentConfig; createdAt?; updatedAt? }
// Scene é união discriminada: type amarrado ao content
type Scene<TAction, TContent extends {type: SceneType}> =
  TContent extends unknown ? SceneCore<TAction> & { type: TContent['type']; content: TContent } : never;
interface SlideContent { type: 'slide'; schemaVersion?: number; canvas: Slide }
interface QuizQuestion { id; type: 'single'|'multiple'|'short_answer'; question; options?: {label;value}[];
  answer?: string[]; analysis?; commentPrompt?; hasAnswer?; points? }
interface Slide { id; viewportSize /*1000*/; viewportRatio /*0.5625*/; theme; elements: PPTElement[];
  background?; animations?; script? }
// PPTElement: text | image | shape | line | chart | table | latex | video | audio | code
```

```ts
// packages/@openmaic/dsl/src/action.ts (resumo)
type Action =
  | { type:'spotlight'; elementId; dimOpacity? }        // fire-and-forget
  | { type:'laser'; elementId; color? }                 // fire-and-forget
  | { type:'speech'; text; audioId?; voice?; speed? }   // síncrono (espera o áudio)
  | { type:'play_video'; elementId }                    // síncrono
  | { type:'wb_open'|'wb_close'|'wb_clear' }
  | { type:'wb_draw_text'; content; x; y; width?; height?; fontSize?; color?; elementId? }
  | { type:'wb_draw_shape'; shape:'rectangle'|'circle'|'triangle'; x;y;width;height; fillColor? }
  | { type:'wb_draw_chart'; chartType; x;y;width;height; data:{labels;legends;series:number[][]} }
  | { type:'wb_draw_latex'; latex; x;y; width?; height?; color? }
  | { type:'wb_draw_table'; data:string[][]; x;y;width;height }
  | { type:'wb_draw_line'; startX;startY;endX;endY; style?; points? }   // coords 0..1000 × 0..562
  | { type:'wb_draw_code'; language; code; x;y; width?; height?; fileName? }
  | { type:'wb_edit_code'; elementId; operation:'insert_after'|'insert_before'|'delete_lines'|'replace_lines'; ... }
  | { type:'wb_delete'; elementId }
  | { type:'discussion'; topic; prompt?; agentId? }
  | { type:'widget_highlight'|'widget_annotation'|'widget_reveal'; target; content? }
  | { type:'widget_setState'; state: Record<string,unknown>; content? };
export const FIRE_AND_FORGET_ACTIONS = ['spotlight','laser'];
export const SYNC_ACTIONS = [ 'speech','play_video','wb_*'..., 'discussion','widget_*' ];
```

Um exemplo real está em `public/guide-course/en.json` (`{dslVersion, stage, scenes, outline}`). Ele tem 7 cenas (5 slides,
1 interactive e 1 quiz), e as ações seguem o padrão `spotlight → speech → spotlight → speech`. Uma ação típica:
`{"id":"s1_1","type":"speech","text":"Hi there…","audioId":"/guide-course/en/audio/s1_1.mp3"}`.

**Coordenadas.** Slide e quadro usam o viewport lógico **1000 × 562,5** (`viewportRatio` = altura/largura = 0,5625). O canvas
calcula `canvasScale` para caber no contêiner. `lib/whiteboard/viewport.ts::normalizeWhiteboardViewportRatio` corrige razões
invertidas.

### 2.2 Árvore de componentes no modo de reprodução

```
app/classroom/[id]/page.tsx
└─ ClassroomSurface (components/classroom/ClassroomSurface.tsx)
   │  runClassroomLoad() → useStageStore.loadFromStorage(id); estados loading|not-found|error;
   │  variant 'page' | 'pane'; useRunCourse() acompanha a geração no servidor (cenas chegando aos poucos)
   └─ ThemeProvider + MediaStageProvider
      └─ Stage (components/stage.tsx)
         ├─ AnimatePresence (cross-fade de opacidade de 280 ms entre os modos)
         │   ├─ EditChromeRoot     (modo 'edit', Pro mode; fora do nosso escopo)
         │   └─ PlaybackChromeRoot (modo 'playback'|'autonomous'; ref expõe teardown())
         │       ├─ SceneSidebar        (miniaturas; useNearViewport para carregamento preguiçoso)
         │       ├─ Header
         │       ├─ CanvasArea
         │       │   ├─ StageViewport (caixa 16:9 com sombra)
         │       │   │   ├─ camada z-[110]: <Whiteboard isOpen=…/>   (dentro de SceneProvider)
         │       │   │   ├─ <SceneRenderer scene mode/>   (oculto quando o quadro está aberto)
         │       │   │   ├─ SlideElementPickOverlay (referenciar elemento no chat)
         │       │   │   ├─ overlay de "gerando a próxima página" ou falha com retry
         │       │   │   ├─ número da cena (marca d'água) e botão Play "respirando" quando ocioso
         │       │   └─ CanvasToolbar (prev/next, play, quadro, painéis, apresentação)
         │       ├─ CourseEnd (overlay z-[130] no fim do curso)
         │       ├─ Roundtable (dock inferior: avatares, balão de fala, mic, input, velocidade)
         │       ├─ ChatArea (painel direito redimensionável: abas Notas de Aula / Chat; SSE)
         │       └─ AlertDialog "trocar de cena?" (quando há discussão ativa)
         └─ InteractiveIframeHost  ← FORA da troca de modo: mantém os iframes vivos (keep-alive)
```

`SceneRenderer` (`components/stage/scene-renderer.tsx`) despacha assim:

- `slide` → `SlideEditor`, que renderiza `PlaybackScreenCanvas` (ou `Canvas` em `autonomous`);
- `quiz` → `QuizView`;
- `interactive` → `InteractiveRenderer`, que é só um placeholder (o iframe real vive no host);
- `pbl` → `PBLRenderer`.

`PlaybackScreenCanvas` escolhe entre `RendererScreenCanvas`, que usa `@openmaic/renderer`, e o `ScreenCanvas` legado. A escolha
depende da flag `isPlaybackRendererEnabled()`.

### 2.3 Motor de reprodução

#### `PlaybackEngine` (`lib/playback/engine.ts`, 939 linhas)

```
idle ──start()──▶ playing ──pause()──▶ paused ──resume()──▶ playing
  ▲                  │ confirmDiscussion() / handleUserInterrupt(text)
  │                  ▼
  └─handleEndDiscussion()── live ──pause()──▶ paused (topic 'pending') ──resume()──▶ live
```

- **Construtor:** `new PlaybackEngine(scenes, actionEngine, audioPlayer, callbacks)`. O app sempre passa **uma única cena**,
  `[currentScene]`, e recria o motor a cada troca de cena.
- **Callbacks** (`lib/playback/types.ts`): `onModeChange`, `onSceneChange`, `onSpeechStart(text)`, `onSpeechEnd`,
  `onEffectFire`, `onProactiveShow(trigger)`, `onProactiveHide`, `onDiscussionConfirmed`, `onDiscussionEnd`,
  `onUserInterrupt(text)`, `onProgress(snapshot)`, `isAgentSelected`, `getPlaybackSpeed`, `onComplete` e
  `beforeSpeech`, que pausa a mídia dos iframes.
- **Laço `processNext(generation)`.** Para cada ação:
  1. chama `onProgress` **antes** de avançar o cursor, de modo que o resume repete a fala interrompida;
  2. `speech`: chama `audioPlayer.play(audioId)`. Sem áudio, tenta o TTS do navegador (só se o provedor selecionado for
     `browser-native-tts`); sem ele, agenda o temporizador `estimateSpeechDurationMs(text, {speed})`;
  3. `spotlight` e `laser`: disparam e seguem via `queueMicrotask`, o que evita estouro de pilha quando há muitos em sequência;
  4. `discussion`: depois de `DISCUSSION_TRIGGER_DELAY_MS` (3 s), mostra o ProactiveCard e para à espera de
     `confirmDiscussion()` ou `skipDiscussion()`;
  5. `wb_*`, `widget_*` e `play_video`: `await actionEngine.execute(action)`. Um erro é registrado e a reprodução segue.
- **Token de geração (`playbackGeneration`).** Todo callback assíncrono verifica `isCurrentGeneration(gen)`. Pausar, parar,
  interromper ou pular invalida as gerações antigas. **Esse padrão anti-corrida vale copiar.**
- **Interrupção pelo aluno.** `handleUserInterrupt` guarda `savedActionIndex = actionIndex - 1`, de modo que, ao voltar, a frase
  interrompida é repetida. Ele faz `setMode('live')` **antes** de `audioPlayer.stop()`, porque `speechSynthesis.cancel()` pode
  disparar `onend` de forma síncrona.
- **Navegação.** `jumpToAction(i)` só é permitido dentro de um "prefixo reconstruível". Ações em `UNSAFE_ACTION_TYPES`
  (`play_video`, `discussion`, `widget_*`) bloqueiam o salto, segundo `lib/playback/action-navigation.ts`. Para reconstruir o
  estado do quadro, o motor reexecuta as `wb_*` anteriores com `{silent:true}`, sem animação e sem fala.
- **Cena sem ações.** Recebe uma "batida" sintética, `EMPTY_SCENE_DWELL`, que é uma fala vazia. Assim o slide aparece por cerca
  de 2 s e o autoplay avança (`lib/choreography/cursor.ts::resolvePlaybackCursor`).
- **Retomada.** Existem dois níveis:
  - `sessionStorage` por aba (`lib/playback/action-resume.ts`);
  - `BrowserKVStore` com a chave `playback-cursor:<stageId>`, persistida com debounce (`lib/playback/cursor.ts`). Ao montar,
    a cena salta para o cursor salvo **sem tocar automaticamente**.
- **Autoplay.** `settings.autoPlayLecture` passa para a próxima cena 1,5 s depois de `onComplete`. Ele **não** avança
  automaticamente a partir de quiz, interactive ou PBL.

#### `ActionEngine` (`lib/action/engine.ts`, 912 linhas)

- `execute(action, {silent, signal})`. Para `wb_*`, garante antes que o quadro está aberto (`ensureWhiteboardOpen`).
- Efeitos:
  - `spotlight` e `laser` gravam no `useCanvasStore` (`setSpotlight`, `setLaser`), com limpeza automática depois de
    `EFFECT_AUTO_CLEAR_MS` (5 s), um único timer reiniciado a cada efeito;
  - `wb_*` usa `createStageAPI(useStageStore).whiteboard.addElement(...)` (`lib/api/stage-api.ts`) e depois
    `await delay(WB_DRAW_MS)`;
  - `wb_draw_latex` renderiza KaTeX para calcular a altura;
  - `wb_draw_code` converte o código em `CodeLine[]` com ids `L1..Ln`, e `wb_edit_code` opera por id de linha.
- `widget_*` chama `sendWidgetMessage(type, payload)`, que vira `postMessage` para o iframe da cena. Os tipos de mensagem são
  `HIGHLIGHT_ELEMENT`, `SET_WIDGET_STATE`, `ANNOTATE_ELEMENT` e `REVEAL_ELEMENT`.
- `play_video` só começa quando a tarefa de mídia está `done` e tem `objectUrl`. A espera é limitada por `MAX_VIDEO_WAIT_MS`
  (5 min).

#### Tempos (`lib/choreography/timing.ts`, puro, também usado pelo exportador de vídeo)

| Constante | Valor | Uso |
|---|---|---|
| `EFFECT_AUTO_CLEAR_MS` | 5000 | spotlight e laser somem depois disso |
| `DISCUSSION_TRIGGER_DELAY_MS` | 3000 | atraso antes do card de discussão |
| `DISCUSSION_AUTO_SKIP_MS` | 5000 | contagem regressiva do card (autoskip) |
| `WB_OPEN_MS` / `WB_CLOSE_MS` | 2000 / 700 | animação de abrir e fechar o quadro |
| `WB_DRAW_MS` / `WB_EDIT_MS` / `WB_DELETE_MS` | 800 / 600 / 300 | |
| `wbDrawCodeMs(n)` | `min(800 + 50n, 3000)` | digitação do código |
| `wbClearMs(n)` | `min(380 + 55n, 1400)` | cascata de limpeza |
| `WIDGET_MS` | 300 | widgets |
| `estimateSpeechDurationMs` | CJK 150 ms/caractere; demais idiomas **240 ms/palavra (cerca de 250 WPM)**; mínimo de 2 s; dividido pela velocidade | fala sem áudio |

Para pt-BR, 240 ms/palavra é rápido para conteúdo técnico. Sugiro 300–360 ms/palavra no nosso app (ver §5).

### 2.4 Slides: `@openmaic/renderer`

- Uso: `<SlideCanvas slide effects renderImage renderVideo canvasPercentage onScaleChange elementIdPrefix videoInteractive mathPriority />`.
- O componente se ajusta sozinho ao pai, que precisa ter largura e altura definidas.
- Efeitos: `effects={{ spotlight:{elementId,dimness}, laser:{elementId,color,duration}, highlights:[…], zoom:{elementId,scale} }}`.
- Slots de mídia: `renderImage(el, src, defaultContent)` e `renderVideo(el)`. O app os usa para placeholders de geração,
  "retry" e estados `pending|failed|disabled` (`components/slide-renderer/Editor/RendererScreenCanvas.tsx`).
- Subpaths: `/elements` (os 9 `Base*Element`), `/types`, `/snapshot` (html-to-image ou html2canvas-pro, usado em miniaturas),
  `/geometry` (`getElementRange`, `getLineElementPath`, que funcionam em Node) e `fonts.css`/`picker-fonts.css`.
- Peers: `react>=18`, `react-dom`, `motion>=11`, `tailwindcss>=4` (o pacote emite classes arbitrárias do Tailwind 4, então é
  preciso `@source "../node_modules/@openmaic/renderer/dist/**/*.{js,cjs}"`), `echarts>=5.5` (opcional) e `shiki>=1` (opcional).
- Dependências: `@openmaic/dsl`, `@openmaic/geometry`, `katex ^0.16.33`, `lucide-react ^0.562`, `tinycolor2`, `html-to-image`
  e `html2canvas-pro`.
- Na reprodução, `RendererScreenCanvas` monta `effects` a partir do `useCanvasStore` (`spotlightElementId`, `laserElementId`,
  `highlightedElementIds`, `zoomTarget`) e lê o slide via `useSceneSelector(content => content.canvas)`.
- A `ChartElement` carrega o ECharts sob demanda (`chart-runtime.ts`, com `import('echarts/core')`, `SVGRenderer` e cache da
  promise). A `CodeElement` carrega o Shiki sob demanda.

### 2.5 Quadro branco

- `components/whiteboard/index.tsx`:
  - overlay `absolute inset-4` com animação spring de entrada (`scale 0.92 → 1`, `y 30 → 0`);
  - cabeçalho com "reset view", limpar (cascata animada mais snapshot no histórico) e histórico (`useWhiteboardHistoryStore`);
  - fundo pontilhado `radial-gradient(...) 24px`.
- `whiteboard-canvas.tsx`:
  - `InteractiveWhiteboardCanvas` com pan e zoom sempre ativos e limites de pan que dependem do zoom;
  - cada elemento é um `AnimatedElement`, um `memo` de `motion.div` que entra com `opacity 0, scale .92, y 8, blur(4px)`
    escalonado em 50 ms por índice e sai em cascata quando o quadro é limpo;
  - o conteúdo é renderizado por `ScreenElement`, o mesmo usado nos slides. **O quadro é um "slide" sem tema.**
- Fonte de verdade: `getDisplayedWhiteboard(stage, runtimeProjection)`. Pode ser `stage.whiteboard`, alimentado pelas ações
  locais, ou a "projeção de runtime" do servidor (`lib/whiteboard/runtime/*`), usada quando o agente de chat desenha no
  servidor. Nesse segundo caso, limpar e consultar o histórico ficam desativados.
- Na reprodução, o quadro **substitui** a cena: `CanvasArea` não renderiza o `SceneRenderer` enquanto `whiteboardOpen` for true.

### 2.6 Falas, TTS e legendas

- **Geração do áudio.** A geração da cena roda a etapa de narração. `/api/generate/tts` sintetiza **uma fala por chamada**,
  e o cliente dispara essas chamadas em paralelo. O resultado é um `audioId`, uma referência a asset guardada no pool do servidor
  ou no Dexie `audioFiles` (legado).
  - Provedores de TTS (`lib/audio/tts-providers.ts`, 1.740 linhas): `openai-tts`, `azure-tts`, `glm-tts`, `qwen-tts`,
    `voxcpm-tts` (clonagem de voz), `minimax-tts`, `xiaomi-tts`, `deepseek-tts`, `doubao-tts`, `elevenlabs-tts`, `google-tts`,
    `lemonade-tts` e `browser-native-tts`.
  - O agente tem `voiceConfig` (`{providerId, modelId?, voiceId}`) e `voiceDesign` (`identity/texture/delivery`, uma "receita"
    de voz independente de provedor).
- **`AudioPlayer`** (`lib/utils/audio-player.ts`):
  - **um único `HTMLAudioElement` por player, reaproveitado entre falas.** Criar um elemento novo por fala faz o
    `play()` programático ser recusado pelas políticas de autoplay no mobile a partir da segunda fala;
  - `requestToken` descarta resoluções obsoletas;
  - `URL.createObjectURL`/`revokeObjectURL` são pareados para não vazar memória;
  - `onended` é atribuído (não `addEventListener`) para não acumular listeners;
  - um `AbortError` vindo de `pause()` não é tratado como falha;
  - há fallback para uma URL legada com timeout de 15 s e `setPlaybackRate` reaplicado depois do `play()`.
- **TTS do navegador** (dentro do `PlaybackEngine`):
  - o texto é dividido em frases (`/(?<=[.!?。！？\n])\s*/`) por causa de um **bug do Chrome que corta enunciados acima de
    cerca de 15 s sem disparar `onend`**;
  - pausar é implementado como `cancel` seguido de falar de novo a partir do trecho atual, porque `speechSynthesis.pause()` não
    funciona no Firefox;
  - `ensureVoicesLoaded()` espera `voiceschanged` por até 2 s;
  - a fala chama `cancel()` antes de `speak()`, outro contorno para o Chrome;
  - `detectSpeechLang` escolhe o idioma da voz.
- **Velocidade.** `PLAYBACK_SPEEDS = [1, 1.25, 1.5, 2]` (`lib/store/settings.ts`); `ttsSpeed` e `ttsVolume`/`ttsMuted` são
  persistidos.
- **Legenda e balão.** O texto completo da fala vai para `lectureSpeech`, exibido no balão do `Roundtable` e acrescentado às
  "Notas de Aula" do `ChatArea` (`addLectureMessage`). Clicar numa nota salta para a ação (`onJumpToAction`).
- **Discussão ao vivo com TTS.** `useDiscussionTTS` (`lib/hooks/use-discussion-tts.ts`) sintetiza cada segmento quando o
  `StreamBuffer` o "sela" e segura a revelação do próximo trecho até o áudio terminar (`shouldHoldAfterReveal`).

### 2.7 `StreamBuffer`: ritmo do texto ao vivo (`lib/buffer/stream-buffer.ts`, 756 linhas)

- Fica entre o SSE e o estado React. É uma fila ordenada de itens (`agent_start`, `text` com crescimento por deltas e `sealed`,
  `action`, `thinking`, `cue_user`, `done` e `error`), consumida por **um único loop de tick**: `tickMs=30` e `charsPerTick=1`,
  cerca de 33 caracteres/s.
- Callbacks: `onTextReveal`, `onActionReady(…, signal)` (a ação dispara só quando o cursor de texto chega a ela), `onLiveSpeech`
  (somente o segmento atual), `onSpeechProgress` (0–1, para autoscroll), `onThinking`, `onCueUser(options)` e `onDone`.
- `pause()` custa O(1). Opções: `postTextDelayMs` e `actionDelayMs`.
- No `PlaybackChromeRoot`, cada callback é embrulhado em `queueMicrotask` e protegido por `sceneEpochRef`, o que descarta eventos
  de uma cena anterior.

### 2.8 Estado derivado da UI: `computePlaybackView` (`lib/playback/derived-state.ts`)

É uma função pura que reduz cerca de 13 variáveis brutas (`engineMode`, `lectureSpeech`, `liveSpeech`, `speakingAgentId`,
`thinkingState`, `isCueUser`, `isTopicPending`, `chatIsStreaming`, `discussionTrigger`, `playbackCompleted`, `idleText`,
`speakingStudent`, `sessionType`) a um `PlaybackView`:

```ts
type PlaybackPhase = 'idle'|'lecturePlaying'|'lecturePaused'|'waitingProactive'|'discussionActive'|'discussionPaused'|'cueUser'|'completed';
interface PlaybackView { phase; sourceText; bubbleRole: 'teacher'|'agent'|'user'|null; activeRole; buttonState: 'bars'|'play'|'restart'|'none'; isInLiveFlow; isTopicActive }
```

A precedência importa. As fases de fluxo ao vivo são avaliadas antes de `completed`, para que o ícone de "reiniciar" não vaze
para os balões dos agentes. `isTopicActive` bloqueia a troca de cena e abre o diálogo de confirmação. **É portável sem
alterações.**

### 2.9 Roundtable (dock inferior)

`components/roundtable/index.tsx` tem 2.419 linhas e é praticamente toda apresentação:

- avatar do professor com o balão de fala, cujo botão alterna entre barras "respirando", play e reiniciar;
- avatares dos alunos-agente, com indicador de áudio;
- input de texto e microfone (ASR via `useAudioRecorder`, com Web Speech ou servidor);
- `ProactiveCard` (convite para discussão, com "Entrar" ou "Pular" e contagem regressiva);
- respostas rápidas de `cue_user`, com as opções vindas do agente;
- velocidade, painéis e modo apresentação;
- `PresentationSpeechOverlay`, que em tela cheia transforma o balão numa legenda flutuante à esquerda ou à direita.

Atalhos (`PlaybackChromeRoot`): `Espaço` (play/pause), `←`/`→` (cenas, no modo apresentação), `↑`/`↓` (volume), `M` (mudo),
`C` (chat), `Esc` (sair da tela cheia) e `F11`. Os atalhos são ignorados em campos de texto (`isTextEntryTarget`).

### 2.10 Cenas interativas e widgets

- `InteractiveRenderer` é um **placeholder**:
  - registra o conteúdo no pool (`useInteractiveIframePool.mount(sceneId, {sourceHtml|src})`);
  - reivindica a visibilidade com um token `useId()`, para evitar que o cleanup atrasado do cross-fade esconda a nova instância;
  - informa o retângulo na tela **a cada frame via `requestAnimationFrame`**.
- `InteractiveIframeHost` (no topo do `Stage`):
  - mantém os iframes vivos, com LRU `IFRAME_POOL_CAP = 3`, e os posiciona sobre o retângulo do placeholder;
  - `sandbox="allow-scripts allow-forms allow-popups"`, **sem `allow-same-origin`** de propósito: o comentário explica que
    `allow-scripts` junto com `allow-same-origin` num `srcDoc` desfaria o isolamento;
  - escala a partir de um viewport lógico de **1280×720** (`lib/interactive/logical-viewport.ts`, com encolhimento mínimo de
    0,75 e uma dica "tem mais abaixo");
  - mostra um banner de erros de runtime;
  - repassa mensagens do seletor de elementos.
- `patchHtmlForIframe` (`lib/utils/iframe.ts`) injeta CSS-base, shims de captura de erro, ajuste de conteúdo, observação de
  estado (para o chat "ver" o estado do widget) e uma ponte de mídia (`MEDIA_CONTROL` pausa a mídia do iframe quando a narração
  começa).
- As bibliotecas que as páginas geradas podem usar são **vendorizadas localmente** em `/vendor/interactive`: katex 0.16.38,
  three 0.160.0, chart.js 4.4.8 e `@tailwindcss/browser` 4.1.18
  (`packages/@openmaic/generation/src/interactive-libraries.ts`). Isso é bom para o Electron offline.
- Tipos de widget (`lib/types/widgets.ts`): `simulation` (variáveis min/max/step mais presets), `diagram`
  (flowchart/mindmap/…, com `revealOrder`), `code`, `game` e `visualization3d`.

### 2.11 Quiz

- `QuizView` (`components/scene-renderers/quiz-view.tsx`, 1.112 linhas) passa pelas fases
  `not_started → answering → submitting → grading → reviewing`.
- As questões `single` e `multiple` são corrigidas localmente (`lib/quiz/grading.ts::gradeChoiceQuestions`). A chave de
  resposta é resolvida de forma exata e única, por valor ou rótulo.
- `short_answer` vai para `POST /api/quiz-grade`, que pede ao LLM o JSON `{"score": n, "comment": "..."}`. Se o parse falhar,
  dá **metade da nota**, e um erro de rede também dá metade.
- A matemática inline usa KaTeX (`renderQuizMathText`). O estado da tentativa é persistido (`lib/quiz/runtime.ts`,
  `view-state.ts`) e retomável.
- Ao revisar, o componente emite `emitQuizReviewed`. O `CourseEnd` agrega com `summarizeScenes()`:
  `{quiz:{correct,total,pct}, unattemptedQuizIds, firstWrongQuizId}`, com as ações `reviewWrong | doQuiz | restart`.
- `CourseEnd` também traz:
  - medalha feita em CSS (`.ce-coin`: aro em conic-gradient, disco, ranhura, brilho) que inclina na direção do ponteiro;
  - respeito a `prefers-reduced-motion`;
  - sequência de 1,8 s que pode ser pulada com clique ou Esc;
  - `BadgeDefinition {id, Art}` já pensado para um sistema de conquistas.

### 2.12 Q&A e discussão ao vivo

- `ChatArea` e `use-chat-sessions.ts` (2.235 linhas) enviam um POST para `/api/chat/pi`, que roda um **loop "Director"**
  com `pi-agent-core` (`lib/chat/pi/director-loop.ts`). O Director chama sub-agentes (professor, assistente, alunos) por
  ferramentas: `call-agent`, `classroom-actions`, `native-whiteboard`, `native-spotlight`, `read-scene`, `cue-user`,
  `close-session` e `web-search`.
- O resultado volta como SSE de eventos do tipo `StatelessEvent`, que são empurrados para o `StreamBuffer`.
- O quadro "vivo" do chat é persistido no servidor. A cada rodada, o modelo recebe o estado do quadro como texto e,
  opcionalmente, uma imagem PNG renderizada pelo `render-service` `/preview` quando o modelo tem visão
  (`lib/chat/pi/README.md`).
- Agentes padrão (`lib/orchestration/registry/built-in.ts`): `default-1` professor, `default-2` assistente e `default-3..6`
  alunos. Um aluno é sorteado como "iniciador" da discussão (`pickStudentAgent`).

### 2.13 Estado (stores)

| Store | Arquivo | Conteúdo relevante |
|---|---|---|
| `useStageStore` | `lib/store/stage.ts` (1.740 linhas) | `stage`, `scenes`, `currentSceneId`, `mode`, `chats`, geração (`generatingOutlines`, `failedOutlines`, `courseGenerating`), `isOwner`/`readOnly`; persistência com dirty-snapshot e epochs |
| `useCanvasStore` | `lib/store/canvas.ts` | efeitos (spotlight, laser, highlight, zoom), `canvasScale`/`viewportSize`/`viewportRatio`, `playingVideoElementId`, `whiteboardOpen`/`whiteboardClearing`, `runtimeWhiteboardProjection`, além do estado do editor |
| `useSettingsStore` | `lib/store/settings.ts` | `persist` em `localStorage` (`settings-storage`): `ttsSpeed`, `ttsVolume`, `ttsMuted`, `playbackSpeed`, `autoPlayLecture`, `selectedAgentIds`, tamanhos de painéis |
| `useWidgetIframeStore` | `lib/store/widget-iframe.ts` | callback de `postMessage` por `sceneId`, resolvido no momento do envio (o iframe registra um commit depois) |
| `useInteractiveIframePool` | `lib/store/interactive-iframe-pool.ts` | `entries[sceneId]{srcDoc, src, rect, clip, owner, tick}` em LRU |
| `useWhiteboardHistoryStore` | `lib/store/whiteboard-history.ts` | snapshots antes de limpar |

- `createSelectors` (`lib/utils/create-selectors.ts`) gera `store.use.campo()`, com uma assinatura granular por campo.
- `SceneProvider` (`lib/contexts/scene-context.tsx`) usa `useSyncExternalStore` com immer: `useSceneSelector<T, R>(sel)`
  assina apenas a fatia selecionada da cena atual. Um modo "controlado" redireciona as escritas para a sessão de edição.

### 2.14 Standalone player, o molde mais limpo para portar

`lib/standalone-player/**` (cerca de 2.755 linhas) é o player do HTML exportado offline. Ele **reimplementa a mesma semântica
de reprodução sem stores, sem IndexedDB e sem IA**:

- `SceneSequencer` (`playback/sequencer.ts`): `play(actions) → 'completed'|'cancelled'`, `pause()`, `resume()`, `cancel()`,
  `dismissDiscussion()`. O trabalho de DOM fica atrás de `SequencerPorts`:

  ```ts
  interface SequencerPorts {
    playAudio(ref: string, control: StepControl): Promise<boolean>; // false ⇒ temporizador de leitura
    playVideo(elementId: string, control: StepControl): Promise<void>;
    sendWidgetMessage(type: string, payload: Record<string, unknown>): void;
    onView(view: { caption: string|null; effects: SlideEffects; discussion: string|null }): void;
  }
  ```
- `PauseGate` e `pausableDelay(ms, {signal, gate}, skip?)` (`playback/pause-gate.ts`, 97 linhas): uma contagem regressiva
  que congela durante a pausa e é cancelável por `AbortSignal`. São puros e testáveis com timers falsos.
- `scenes/SlideScene.tsx` é literalmente `<SlideCanvas slide effects renderVideo/>`.
- `QuizScene`, `InteractiveScene`, `PlaybackOverlays` (`CaptionBar`, `DiscussionCard`, `StartOverlay`) e `navigation.ts`
  (teclado e hash `#scene-n`) completam o player.

---

## 3. (b) Provedores e modelos

### 3.1 Catálogo estático

- `lib/ai/providers.ts` (2.947 linhas) define `PROVIDERS: Record<ProviderId, ProviderConfig>` com 20 ids embutidos: `openai`,
  `azure`, `atlascloud`, `anthropic`, `bedrock`, `google`, `deepseek`, `qwen`, `kimi`, `minimax`, `glm`, `siliconflow`,
  `doubao`, `openrouter`, `grok`, `tencent-hunyuan`, `xiaomi`, `tokendance`, `lemonade` e `ollama`. Ids `custom-*` também são
  aceitos.
- Cada entrada tem `type` (`openai|azure|anthropic|bedrock|google`, que determina o SDK), `defaultBaseUrl`,
  `alternateBaseUrls`, `requiresApiKey`, `supportsModelDiscovery` e `models: ModelInfo[]`. Um `ModelInfo` tem
  `{id, name, contextWindow, outputWindow, capabilities{streaming, tools, vision, thinking: ThinkingCapability}}`.
  Por exemplo, o catálogo da OpenAI já lista `gpt-5.6`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5` e `gpt-5.4*`.
- `ThinkingCapability` unifica os controles de raciocínio:
  - `control`: `none|toggle|toggle-budget|effort|level|mode|budget-only`;
  - `requestAdapter`: openai, anthropic, google, qwen, deepseek e outros;
  - valores aceitos para effort, level e budget.

  O `ThinkingConfig {mode, effort, level, enabled, budgetTokens}` é traduzido para `providerOptions` pelo adaptador
  (`lib/ai/thinking-config.ts`). **Esse esquema é um bom modelo para não fixar parâmetros por modelo no código.**
- `getModel(config)` cria o `LanguageModel` do AI SDK e:
  - usa a Responses API em modelos `gpt-5.x-codex`;
  - aplica middleware de preservação de raciocínio;
  - contorna incompatibilidades de streaming de endpoints compatíveis com OpenAI;
  - tem timeout de 15 min (`LLM_FETCH_TIMEOUT_MS`).

### 3.2 Descoberta dinâmica

`POST /api/provider/probe-models` (`app/api/provider/probe-models/route.ts`):

- usa `fetchModels(baseUrl, apiKey)` no `/models` compatível com OpenAI, tentando vários candidatos;
- protege contra SSRF (`validateClientBaseUrl`);
- filtra modelos que não são de chat com `/(tts|asr|whisper|embedding|rerank|image|video|moderation|…)/i`;
- devolve 404 quando o provedor não expõe a lista, e a UI cai para entrada manual.

Os modelos sondados ganham `source: 'probed'` e são **substituídos em bloco** a cada nova sondagem; os manuais ou do catálogo são
preservados. Para testar uma credencial, a UI chama `/api/verify-model`.

### 3.3 Slots de modelo em árvore, sem hardcode por uso

`lib/config/model-slots.ts` (RFC #1701) define uma floresta de "usos de IA", com uma árvore por capacidade. O filho herda do pai:

```
chat:  llm ─┬ material.chapters
            ├ course.research / course.outline / course.agents / course.actions
            ├ course.content ─┬ .slide ├ .quiz ├ .interactive └ .pbl
            ├ classroom            (quiz-grade, chat-adapter, pbl runtime)
            └ agent (requires toolCalling, noThinkingEffort) └ agent.title (configOnly)
tts | asr | image | video | webFetch | webSearch | document  (raízes isoladas)
```

- `STAGE_SLOTS` mapeia rótulos internos de chamada para slots, por exemplo `'quiz-grade' → 'classroom'` e
  `'scene-actions' → 'course.actions'`.
- `slotLineage(id)` resolve o modelo efetivo subindo pela árvore.
- O servidor lê `openmaic.yml` (`openmaic.example.yml`) com quatro seções:
  - `providers` (preset, `apiKey: ${ENV}`, `models` como allowlist);
  - `slots` (padrões `provider:model`);
  - `lock` (slots fixos, com toda a subárvore);
  - `allowUserKeys`.
- A UI de configurações tem três "formas" (`lib/model-settings/shape.ts`): `yourself` (o usuário adiciona chaves), `choose`
  (escolhe entre os provedores do servidor) e `admin` (somente leitura).
- `components/settings/models/model-map.tsx` desenha os slots como um **mapa de "estações"**, com zoom e pan.
- As gravações usam concorrência otimista: há `revision`, e um 409 recarrega a visão (`lib/model-settings/client.ts`).
- O "Token Plan" (`lib/config/token-plan-presets.ts`) reúne presets de planos de API chineses (GLM, Kimi, MiniMax, Xiaomi
  e outros), que preenchem vários slots de uma vez. **Continua sendo chave de API, não OAuth.**

### 3.4 Uso e tokens (meta 6)

- `lib/usage/normalize.ts::normalizeUsage(LanguageModelUsage)` produz
  `{inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, reasoningTokens}`. O formato espelha o `TokenUsage` do
  cc-switch, e linhas sem tokens são ignoradas.
- `lib/server/usage-storage.ts` grava JSONL mensal em `data/usage/YYYY-MM.jsonl`, com campos
  `{kind:'llm'|'image'|'video'|'tts'|'asr', providerId, modelId, source, tokens…, quantity, unit}`.
- `GET /api/usage` agrega por modelo, por dia e por tipo. `components/settings/usage-dashboard.tsx` mostra um gráfico de
  tendência com ECharts carregado sob demanda.
- `lib/ai/llm.ts::recordUsageSafe` é chamado depois de cada `generateText`/`streamText`.
- **Dá para portar quase sem mudanças** para as estatísticas de tokens por modelo do perfil. Basta acrescentar `sessionId`/
  `domainId` e `durationMs`.

### 3.5 Login por assinatura

**Não existe no OpenMAIC.** Uma busca por `oauth|chatgpt|codex|subscription` em `lib/`, `app/` e `components/` encontra apenas
links "Open in ChatGPT/Claude" (`components/ai-elements/open-in-chat.tsx`) e o roteamento de modelos `*-codex` para a Responses
API. O `pi-agent-core` é usado só como harness: `lib/agent/runtime/stream-fn.ts` ignora o `model` do pi e envia a chamada para o
AI SDK do próprio OpenMAIC.

### 3.6 Onde está o caminho para assinatura (fora do OpenMAIC)

O learnharness já depende de `@earendil-works/pi-ai@1.4.0`, que traz:

- `dist/auth/oauth/{openai-chatgpt,openai-codex,anthropic,github-copilot,xai,openrouter,kimi-coding,radius}.js`, mais `pkce`,
  `callback-server` e `device-code`;
- `openai-chatgpt.d.ts`, descrito como "Sign in with ChatGPT", um fluxo de cliente público sem segredo que envia o token direto
  para api.openai.com;
- `anthropic.d.ts`, descrito como "Claude Pro/Max", que usa `http.createServer` e por isso só roda em Node (no Electron isso é o
  processo main);
- **um catálogo remoto com ETag e `Last-Modified`** (`models-store.d.ts`), que resolve o requisito "modelos sem hardcode" melhor
  que o catálogo estático do OpenMAIC.

**Ressalva de ToS:** é preciso verificar os termos atuais da OpenAI e da Anthropic para uso de assinatura em apps de terceiros.
Em 2026 houve relatos de a Anthropic restringir tokens OAuth de Claude Pro/Max fora do Claude Code. Confirme antes de
habilitar.

---

## 4. (c) O que portar para a visualização de aula por nó

### 4.1 Tabela de reaproveitamento

| # | O quê | Onde | Como reaproveitar | Dependências | Esforço |
|---|---|---|---|---|---|
| 1 | Contrato `Stage/Scene/Action` | `packages/@openmaic/dsl` (npm `@openmaic/dsl@0.13.0`) | Instalar como dependência ou copiar `stage.ts`/`action.ts`. Estender com `SceneType` novos (`video`, `reading`, `flashcards`) usando o genérico `Scene<TAction, TContent>`, como o app faz com `AppSceneContent` | nenhuma | baixo |
| 2 | Renderizador de slides | `packages/@openmaic/renderer` (npm `@openmaic/renderer@0.2.2`) | `<SlideCanvas slide effects renderImage renderVideo/>` com `@source` no CSS. Os efeitos vêm do nosso sequenciador | react 19, motion (temos 13), tailwind 4, echarts e shiki opcionais, katex 0.16 | baixo |
| 3 | Sequenciador sem stores | `lib/standalone-player/playback/{sequencer,pause-gate}.ts` | Copiar e adaptar para `NodeLessonSequencer` com ports `playAudio` (nosso TTS), `playVideo` (YouTube IFrame API), `sendWidgetMessage` e `onView`. Acrescentar `wb_*` reaproveitando o ActionEngine (item 6) e `youtube_seek`/`youtube_play` | nenhuma | médio |
| 4 | Tempos e cursor | `lib/choreography/{timing,cursor}.ts` | Copiar e ajustar `NON_CJK_MS_PER_WORD` para pt-BR (cerca de 320) | nenhuma | baixo |
| 5 | Máquina de estados de interrupção | `lib/playback/engine.ts` | Copiar só os padrões: token `playbackGeneration`, `handleUserInterrupt` (guarda `actionIndex-1` e define o modo antes de parar o áudio), `jumpToAction` com reconstrução silenciosa do quadro, `EMPTY_SCENE_DWELL` | — | médio |
| 6 | Execução de quadro branco | `lib/action/engine.ts` (métodos `executeWb*`) + `components/whiteboard/*` | Reescrever `createStageAPI(...).whiteboard` sobre o nosso store. `WhiteboardCanvas` + `AnimatedElement` (memo) renderizam com `ScreenElement`; no nosso caso, usar os `Base*Element` de `@openmaic/renderer/elements` | motion, katex | médio-alto |
| 7 | Player de áudio | `lib/utils/audio-player.ts` | Copiar quase sem mudanças (elemento único, token, revogação de blob). Trocar `resolveAudioBlob` pelo nosso cache (IndexedDB ou arquivo no Electron) | nenhuma | baixo |
| 8 | TTS do navegador e fallback | `PlaybackEngine.playBrowserTTS*` | Extrair para `browserSpeak(text, {rate, voice, signal})` com divisão em frases e o padrão cancel + falar de novo | Web Speech | baixo |
| 9 | Ritmo de texto ao vivo | `lib/buffer/stream-buffer.ts` | Para explicações de IA geradas na hora: revelação sincronizada com ações (ex.: spotlight quando o texto chega à referência). Ver o alerta de performance §5.1 | nenhuma | baixo |
| 10 | Estado derivado da UI | `lib/playback/derived-state.ts` | Copiar `computePlaybackView` e as fases | nenhuma | baixo |
| 11 | Iframes interativos | `lib/store/interactive-iframe-pool.ts`, `components/scene-renderers/{InteractiveRenderer,InteractiveIframeHost}.tsx`, `lib/utils/iframe.ts`, `lib/interactive/*` | Para simulações (eletrônica: circuitos e osciloscópio). Manter `sandbox` sem `allow-same-origin`, viewport lógico 1280×720, keep-alive LRU 3 e assets vendorizados | zustand (ou o nosso store) | médio |
| 12 | Quiz | `components/scene-renderers/quiz-view.tsx`, `lib/quiz/grading.ts`, `app/api/quiz-grade/route.ts` | Correção local e LLM para `short_answer`. Trocar a "metade da nota" no fallback por "não corrigido" e enviar os erros para a geração de flashcards | katex | médio |
| 13 | Tela de fim e medalha | `components/classroom/course-end/*` | `BadgeDefinition {id, Art}` com a medalha em CSS, reestilizada em cel shading (contorno grosso, 2–3 tons, sem gradiente suave) e ligada ao XP | — | baixo |
| 14 | Slots de modelo | `lib/config/model-slots.ts`, `lib/model-settings/shape.ts` | Árvore `llm → lesson.explain / lesson.quiz / graph.expand / memory.summarize / flashcards`, com herança e `requires: ['toolCalling']`. Combinar com o catálogo remoto do pi-ai | — | baixo |
| 15 | Normalização e registro de uso | `lib/usage/normalize.ts`, `lib/server/usage-storage.ts`, `app/api/usage/route.ts` | Estatísticas de tokens por modelo e por dia (meta 6). Acrescentar `domainId`/`sessionId` | `ai` (tipos) | baixo |
| 16 | Prompt de ações de slide | `packages/@openmaic/generation/templates/slide-actions/system.md` | Padrão "aponta primeiro, depois fala" (spotlight antes do text) num array JSON intercalado. Útil para a didática da meta 9 | — | baixo |
| 17 | Atalhos e modo apresentação | `PlaybackChromeRoot` (keydown), `lib/standalone-player/navigation.ts` | Espaço, setas, M, Esc, com a guarda `isTextEntryTarget` | — | baixo |
| 18 | Testes | `tests/playback/*`, `tests/audio/audio-player-*.test.ts`, `tests/quiz/*`, `e2e/fixtures/{mock-api,media-stubs}.ts` | Usar como especificação de comportamento (corridas, vazamentos, reaproveitamento do elemento de áudio) | vitest e playwright | — |

### 4.2 O que **não** portar

- `components/edit/PlaybackChromeRoot.tsx`: mais de 40 `useState`, efeitos acoplados e callbacks com refs; é difícil de manter.
  Reescrever como um componente pequeno sobre o sequenciador.
- `components/roundtable/index.tsx`, por motivo semelhante (2.419 linhas). Fazer uma versão enxuta: avatar, balão, botão.
- Workbench, PBL v2/v3, sandbox E2B, edição Pro (`components/edit/**`, `@openmaic/editor`), importador PPTX e `render-service`
  (Chromium e FFmpeg; só se quisermos exportar MP4).
- A persistência em Postgres (`lib/persistence/**`) e a identidade de dono anônimo do middleware. No Electron, um usuário
  local com SQLite ou arquivos é suficiente.

### 4.3 Arquitetura proposta: `NodeLessonView`

```
GraphNode (id, domainId, regionIds)
  └─ NodeLesson  (≈ Stage)
       ├─ scenes: LessonScene[]  (≈ Scene; type amarrado a content)
       │    'slide'      → AI explanation (SlideContent + actions speech/spotlight/wb_*)
       │    'reading'    → book chapter {bookId, chapter, pages, excerptMd}   (nova)
       │    'video'      → YouTube {videoId, start, end, lang, captions:'auto'|'pt'} (nova)
       │    'interactive'→ simulação (iframe sandbox)
       │    'quiz'       → QuizContent  → erros alimentam flashcards
       └─ sourceRefs (livro cobre região maior: link N:1 de nós para capítulo)

<NodeLessonView lesson>
  ├─ <LessonStage>  (16:9, ContainBox)
  │    ├─ <SlideCanvas …effects/> | <ReadingPane/> | <YouTubeScene/> | <InteractiveSlot/> | <QuizView/>
  │    └─ <WhiteboardOverlay/> (AnimatePresence)
  ├─ <CaptionBubble view=computePlaybackView(...)/>   (folha isolada; ver §5.1)
  └─ <LessonControls/> (play/pause, velocidade, cenas, "perguntar")
NodeLessonSequencer (ports):
  playAudio → nosso TTS (pré-gerado por fala, cache por hash(text+voice+speed))
  playVideo → YT IFrame API (seekTo/playVideo; onStateChange ENDED → resolve)
  onView    → useSyncExternalStore
  onProgress→ memória (posição, ação atual) + XP (eventos)
```

Para a meta 2 (memória), cada `onProgress(snapshot)` e `onComplete` são eventos naturais para gravar "onde o aluno está".
Interrupções com pergunta (`handleUserInterrupt`) e erros de quiz servem de sinal de "ponto fraco".

### 4.4 Lições de didática para a meta 9

- **Aponta primeiro, depois fala.** O roteiro intercala `spotlight` e `speech`, com um foco por frase, e não despeja perguntas.
- **O aluno controla o ritmo.** Pode interromper a qualquer momento com uma pergunta, e ao voltar a última frase é repetida.
- **A discussão é opcional.** O convite aparece 3 s depois da fala, com contagem regressiva de 5 s para pular sozinho.
- **O quiz fica separado da exposição.** Ele é uma cena própria, e o autoplay não entra nele sozinho.
- **Limite de tamanho por fala.** O OpenMAIC usa cerca de 70 caracteres chineses para o professor, 60 para o assistente e 40
  para o aluno (`buildLengthGuidelines`, citado em `lib/chat/pi/README.md`). Para pt-BR, convém calibrar em palavras.

---

## 5. (d) Armadilhas de performance (e corretude) observadas

1. **Re-render em alta frequência.** O `StreamBuffer` faz tick a cada 30 ms, e cada `onLiveSpeech` e `onSpeechProgress` vira
   `setState` no `PlaybackChromeRoot`, que repassa cerca de 60 props para o `Roundtable` e o `ChatArea`. São cerca de 33 renders
   por segundo de árvores com milhares de linhas.
   *Mitigação:* guardar o texto revelado num store externo ou ref e assinar só na folha do balão (`useSyncExternalStore`), ou
   fazer a revelação em CSS (`clip-path`/`steps()`).
2. **Assinatura do store inteiro.** `Stage` faz `const { mode, setMode, scenes, currentSceneId, generatingOutlines, stage } =
   useStageStore()` sem seletor, então re-renderiza em qualquer mudança do store.
   *Mitigação:* seletores atômicos (`store.use.x()`) ou `useShallow`.
3. **Laço de rAF permanente.** `InteractiveRenderer` chama `getBoundingClientRect()` e `visibleClientRect()` em **todo frame**
   enquanto está montado, o que força layout continuamente.
   *Mitigação:* `ResizeObserver` + `IntersectionObserver` + `scroll` passivo, atualizando só quando algo muda.
4. **Iframes.** O LRU de 3 documentos é um compromisso entre memória e recarga. Se o conteúdo do `srcDoc` mudar (a string
   precisa ser idêntica), o iframe recarrega. Um identificador de observação gerado por instância quebrava o keep-alive (está
   comentado no código). `backdrop-filter`/blur sobre um iframe vivo é caro; o `CourseEnd` só escurece (`blurBehind=false` para
   interactive).
5. **`backdrop-blur` e transforms.** O chrome usa `bg-white/80 backdrop-blur-xl` em várias camadas. O `Stage` evita
   **de propósito** transform no ancestral durante o cross-fade, para não repintar o backdrop a cada frame nem distorcer
   `layoutId`. Num visual cel shading (cores chapadas), dá para dispensar o blur.
6. **Tipografia de matemática.** O renderer tem orçamentos: 4.000 caracteres-fonte e 100 fórmulas síncronas, e 256.000
   caracteres de markup por frame. O restante vai para `requestIdleCallback`. Miniaturas usam `mathPriority="background"`.
   Num conteúdo de nível doutorado em eletrônica, com muitas fórmulas, isso importa.
7. **Bundle.** O ECharts é a maior parte do bundle da sala e é carregado sob demanda; o Shiki também. O editor Pro é pré-carregado
   antes de trocar de modo (`lib/edit/preload-editor.ts`). O `package.json` raiz tem dezenas de dependências pesadas (AWS SDK,
   e2b, monaco, xterm, three); **portar só `dsl` e `renderer`**.
8. **Fontes.** `@openmaic/renderer/fonts.css` aponta para um CDN externo (`https://file.maic.chat/fonts/*.woff2`), e
   `picker-fonts.css` baixa fontes CJK de 7,5–10 MB. No Electron offline, não importar, ou autohospedar
   (`FONT_CDN_BASE_URL` em `fonts.config.mjs`).
9. **Animações do quadro.** Cada elemento anima `filter: blur()`, que é caro com muitos elementos. `AnimatedElement` precisa de
   `memo` para que pan e zoom não façam o motion remedir projeções (o código comenta "content visibly lag"). A limpeza em
   cascata é limitada a 1,4 s.
10. **Áudio.**
    - Um elemento por fala quebra o autoplay no mobile e no Electron com política restrita.
    - Esquecer `revokeObjectURL` vaza buffers.
    - O Chrome corta `speechSynthesis` perto de 15 s.
    - As vozes chegam de forma assíncrona.
    - `pause()` não funciona no Firefox.
    - Um `play()` pendente rejeita com `AbortError` quando há pausa; isso não é erro.
11. **Corridas assíncronas** (corretude, mas aparecem como travamentos). Os padrões usados contra elas são o token de geração
    (motor), `sceneEpochRef` (callbacks de SSE), `claimStageSceneLoadToken` (carregamento), a verificação de identidade
    `engineRef.current !== engine` em `onProgress` e a posse de visibilidade por `useId()` no pool de iframes. **Replicar todos.**
12. **Miniaturas.** `SlideThumbnail` com `useNearViewport` (carregamento preguiçoso) e `mathPriority="background"`. Snapshots com
    `html2canvas-pro`/`html-to-image` são caros, então devem ser cacheados (`lib/utils/course-thumbnail-cache.ts`).
13. **Postgres obrigatório** e o `render-service` (Chromium mais FFmpeg, jobs que levam dezenas de minutos) não fazem sentido
    num app desktop leve.
14. **Conflitos de versão no nosso fork.**
    - O learnharness força `katex` 0.18.2 via `overrides`, enquanto o renderer declara `^0.16.33`. É preciso testar a saída e
      o CSS (`katex.min.css`).
    - O `lucide-react` do renderer (`^0.562`) duplica o nosso (`^1.33`), o que aumenta o bundle. Considerar dedupe ou uma
      cópia vendorizada.
    - O `motion` 13 do learnharness atende ao peer `>=11`, mas o OpenMAIC testa com a 12.

---

## 6. UI e assets: o que serve para o visual cel shading e desenhado à mão (meta 8)

- O visual do OpenMAIC é **clean e "glass"**: primária roxa `#722ed1`, tokens oklch do shadcn, `rounded-2xl`, sombras suaves,
  `backdrop-blur`, ícones `lucide-react` e fonte Inter Variable (`@fontsource`, com subsets por `unicode-range`, o que corrige
  cirílico e vietnamita).
- **Não é cel shading.** Para a meta 8, reaproveitar a estrutura de tokens (`app/globals.css`, `@theme inline`) e trocar por
  uma paleta chapada, contorno de 2–3 px (`--outline`) e sombra dura deslocada.
- `public/avatars/*.svg` são **remix de Avataaars (Pablo Stanley)**, com metadados RDF no SVG. Não são desenhados à mão no
  estilo pedido; servem só de placeholder.
- `public/logos/*.svg|png` são logos de provedores (marcas de terceiros).
- `assets/*.gif|png` são material de README. `banner.png` é uma ilustração flat (lilás), e `interactive_mode/desktop_interactive.png`
  mostra o layout real: cena centralizada 16:9, toolbar fina abaixo, dock com avatar e balão à esquerda e avatares dos agentes
  com mic e chat à direita.
- `public/guide-course/{en,zh}.json` com MP3 pré-gerados é um **curso de exemplo completo** e serve como fixture de teste do
  nosso player.
- `public/vendor/gsap.min.js` (GSAP, licença própria da GreenSock/Webflow) só é usado na exportação de vídeo (Hyperframes).

---

## 7. `render-service/` (resumo)

É um serviço Node 22 isolado (Hono, `@hyperframes/producer`, `puppeteer-core`, FFmpeg) que:

- recebe um ZIP de projeto Hyperframes compilado no navegador e renderiza um MP4 de forma assíncrona (`POST /owner-bound/render`,
  com polling e download);
- oferece `POST /preview`, que gera um PNG síncrono de uma cena autocontida. O chat o usa para "ver" o quadro.

Admissão com 429 e `reason` (`queue_full`, `per_identity_limit`, `capacity_busy`), posse por um cabeçalho afirmado pelo proxy do
app e saneamento de HTML não confiável (`untrusted-html-csp.ts`, `untrusted-document-sanitizer.ts`).

**Para nós:** só interessa se quisermos exportar aulas em vídeo. A ideia de dar ao LLM com visão um PNG do quadro, para ele
corrigir a própria diagramação, pode ser feita no Electron com `webContents.capturePage()`, sem serviço separado.

---

## 8. Licenças

| Componente | Licença | Observação para o nosso fork AGPL-3.0 |
|---|---|---|
| OpenMAIC (raiz) e `@openmaic/*` (`dsl`, `renderer`, `editor`, `generation`, `storage`, `importer`, `geometry`) | **MIT**, © 2026 THU-MAIC. Relicenciado para MIT na v0.3.0 (2026-06-28) | Pode ser incorporado em AGPL. Manter o aviso de copyright MIT nos arquivos copiados (ex.: um cabeçalho ou `THIRD_PARTY_NOTICES`) |
| `packages/mathml2omml` | LGPL-3.0-or-later | Não precisamos dele (exportação para DOCX/PPTX) |
| `packages/pptxgenjs` | MIT | Não precisamos |
| Modelo de slide e partes do renderer | Derivados do **PPTist** (AGPL-3.0), ex.: "ported from PPTist StaticTable.vue" | Compatível com AGPL. Recomendo atribuir o PPTist nos NOTICES |
| Avatares `public/avatars/*` | Avataaars, "free for personal and commercial use" | Não usar no visual final (estilo diferente) |
| GSAP vendorizado | GreenSock Standard "no charge" (não é OSI) | Não portar |
| Fontes (KaTeX, Noto, SourceHan via CDN) | MIT/OFL | Autohospedar se necessário |
| Bibliotecas de interativos: katex, three, chart.js, @tailwindcss/browser | MIT | OK |
| echarts | Apache-2.0 | OK |

---

## 9. Riscos e incertezas

- O repositório tem uma cadência altíssima (`1.5.0-rc.3`, 920 commits, `CHANGELOG.md` de 300 KB). As APIs internas de `lib/`
  mudam com frequência, então prefira **depender dos pacotes npm** (`dsl` e `renderer`) e copiar só módulos puros.
- O `PlaybackEngine` aceita várias cenas, mas o app só passa uma por vez. A semântica de várias cenas (`onSceneChange`) é pouco
  exercitada.
- O fallback de correção do quiz que dá **metade da nota** distorce métricas, XP e ranking; não copiar.
- O `estimateSpeechDurationMs` em pt-BR (240 ms/palavra) provavelmente é rápido demais para conteúdo técnico.
- Login por assinatura: é responsabilidade do pi-ai, não do OpenMAIC. Verificar ToS e o comportamento real em produção.

---

## 10. Índice rápido de arquivos citados

- Contrato: `packages/@openmaic/dsl/src/{stage,action,slides}.ts`, `lib/types/{stage,action,provider,widgets}.ts`
- Reprodução: `lib/playback/{engine,types,derived-state,cursor,action-resume,action-navigation}.ts`, `lib/action/engine.ts`,
  `lib/choreography/{timing,cursor}.ts`
- Player sem stores: `lib/standalone-player/{App.tsx,playback/sequencer.ts,playback/pause-gate.ts,scenes/*.tsx,navigation.ts}`
- Áudio: `lib/utils/audio-player.ts`, `lib/audio/tts-providers.ts`, `app/api/generate/tts/route.ts`,
  `lib/hooks/use-discussion-tts.ts`
- Texto ao vivo: `lib/buffer/stream-buffer.ts`, `app/api/chat/pi/route.ts`, `lib/chat/pi/*`
- UI: `components/classroom/ClassroomSurface.tsx`, `components/stage.tsx`, `components/edit/PlaybackChromeRoot.tsx`,
  `components/canvas/canvas-area.tsx`, `components/stage/scene-renderer.tsx`,
  `components/slide-renderer/Editor/{RendererScreenCanvas,ScreenCanvas}.tsx`, `components/whiteboard/*`,
  `components/roundtable/*`, `components/chat/{chat-area,proactive-card,lecture-notes-view}.tsx`
- Interativos: `components/scene-renderers/{interactive-renderer,InteractiveIframeHost}.tsx`,
  `lib/store/interactive-iframe-pool.ts`, `lib/utils/iframe.ts`, `lib/interactive/*`,
  `packages/@openmaic/generation/src/interactive-libraries.ts`
- Quiz e fim de curso: `components/scene-renderers/quiz-view.tsx`, `lib/quiz/*`, `app/api/quiz-grade/route.ts`,
  `components/classroom/course-end/*`, `lib/classroom/complete-summary.ts`
- Modelos: `lib/ai/providers.ts`, `lib/config/model-slots.ts`, `lib/model-settings/{shape,client}.ts`,
  `app/api/provider/probe-models/route.ts`, `openmaic.example.yml`, `components/settings/models/*`
- Uso: `lib/usage/normalize.ts`, `lib/server/usage-storage.ts`, `app/api/usage/route.ts`,
  `components/settings/usage-dashboard.tsx`
- Stores: `lib/store/{stage,canvas,settings,widget-iframe}.ts`, `lib/utils/create-selectors.ts`,
  `lib/contexts/scene-context.tsx`
- Testes e e2e: `tests/{playback,audio,quiz,slide-renderer,scene-renderers}/*`, `e2e/tests/*.spec.ts`,
  `e2e/fixtures/{mock-api,media-stubs,server-seed}.ts`, `playwright.config.ts`
- Fora do OpenMAIC (pi-ai no learnharness): `node_modules/@earendil-works/pi-ai/dist/auth/oauth/*`,
  `dist/models-store.d.ts`, `dist/model-catalog.d.ts`
