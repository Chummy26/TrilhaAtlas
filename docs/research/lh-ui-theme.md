# lh-ui-theme: a UI do learnharness por inteiro e o plano para um visual cel shading

> Data: 2026-11-18 · Base analisada: learnharness 0.6.1 (raiz do repo, sem modificações) · Escopo: `app/**`, `components/**`, `src/core/themes.ts`, `src/store/themes.ts`, `src/server/theme-boot.ts`, `docs/themes.md`, `docs/keyboard.md`, `docs/dialog-overlay-contract.md`, `public/**`, `components.json`, `postcss.config.mjs`, imagens em `docs/assets/`.
> Método: li o código-fonte, olhei as capturas de tela `docs/assets/knowledge-graph.png` e `docs/assets/teaching-session.png`, compilei utilitários com o Tailwind 4.3.3 do próprio projeto num diretório temporário para confirmar como os tokens são resolvidos, e consultei fontes externas para o estado atual das bibliotecas de grafo (seção 10).
> Os números de linha são do estado atual do repositório e podem mudar.

---

## 0. Resumo

1. **Stack de UI.** Next.js 16.4.3 (App Router), React 19.2.8, Tailwind CSS 4.3.3 sem `tailwind.config` (tokens CSS-first em `app/globals.css`), shadcn "new-york" (`components.json`), primitivas Radix, `lucide-react` 1.33.0 (ISC), Electron ^44.9.3 com chrome mesclado.
2. **Grafo.** A home renderiza o grafo de conhecimento num **Canvas 2D feito à mão** (`components/graph-canvas.ts`). O layout é d3-force e a câmera é d3-zoom. **sigma.js foi abandonado** em 2026-09-13.
   - `@xyflow/react` está no `package.json`, mas **não é importado em lugar nenhum**: é uma dependência morta.
   - Também não são usados no núcleo: `@rive-app/react-webgl2`, `next-themes`, `embla-carousel-react`, `cmdk` e `media-chrome`.
3. **Navegação.** São só três telas de verdade: `/` (grafo ou home mínima), `/chat/new` (rascunho) e `/chat/[id]` (sessão). Há ainda `/plugins/[pluginId]/[viewId]` para telas de plugin. `/settings` redireciona: as configurações são um **diálogo modal único**. Uma barra lateral inline (`w-72`) e um compositor flutuante se repetem em todas as telas.
4. **Temas.** Um tema tem **12 cores hex** e um `mode` (dark/light).
   - `themeVars()` (`src/core/themes.ts:255`) traduz essas cores para os tokens shadcn mais os tokens `--lh-*`.
   - O primeiro frame é renderizado no servidor como `style` inline do `<html>` (`app/layout.tsx` com `readThemeBoot()`). Depois, `AppearanceProvider` aplica as mudanças com `setProperty`.
   - Temas importados ficam em `data/themes/<id>.json`.
   - **Não existe token estrutural de tema.** Sombras, raios, espessura de borda e blur são constantes de compilação.
5. **Achado verificado: dá para fazer o cel shading sem editar componentes.**
   - Raios hoje estão em `@theme inline`, ou seja, saem como **literais** no CSS gerado (`rounded-xl` vira `border-radius: 16px`).
   - Se os tokens do Tailwind forem redeclarados com indireção (`@theme { --shadow-lg: var(--lh-shadow-lg); --radius-xl: var(--lh-radius-xl); --blur: var(--lh-blur) }`), **todos os 54 `shadow-lg/xl` (67 sombras no total), os ~263 `rounded-*` com escala e os 27 `backdrop-blur*` passam a obedecer variáveis de runtime**. Confirmei isso compilando com o Tailwind 4.3.3.
   - `border` (1px) é literal e não pode ser sobrescrito por `@utility`. A saída é CSS *unlayered*, padrão que o repo já usa.
6. **Cel shading.** A proposta tem três partes:
   - um bloco opcional `skin` no arquivo de tema (cor de contorno, espessura, deslocamento da sombra dura, raios, tons);
   - um atributo `data-skin="cel"` no `<html>`;
   - um pequeno conjunto de classes `cel-*` para brilho especular.

   No Canvas: um `Path2D` extra para a sombra, um `stroke` de contorno, um `Path2D` de brilho especular e regiões **posterizadas** com d3-contour no lugar da mancha desfocada.
7. **Ícones.**
   - São 47 arquivos importando cerca de 70 ícones lucide distintos.
   - Há SVGs inline próprios: `LhMark`, `GlyphMark` (✓/✗), o spinner braille e o `PlanDiagram`.
   - Plugins passam SVG como *string* confiável.

   Plano: um componente central `<Icon name>` com registro gerado a partir de `assets/icons/*.svg` por script (SVGO mais codegen), um *shim* de compatibilidade com os nomes do lucide para migrar aos poucos, e uma regra ESLint `no-restricted-imports` ao final.
8. **Onde encaixar as features novas.**
   - Seletor de domínio no topo da barra lateral.
   - Chip de perfil (nível e XP) no rodapé da barra lateral, levando a uma rota nova `/profile`.
   - Mapa do currículo como modo principal da home, no mesmo motor de canvas com LOD.
   - Painel de recursos como *content-area view* à direita, a mesma família do overlay Chains.
   - Chip "Recursos" e *breadcrumb* na TopBar do chat.
9. **Capacidade.** O renderer atual aguenta bem a escala para a qual foi projetado: o próprio comentário do código fala em 338 nós e "low thousands".
   - Para 5k–50k nós faltam culling por viewport, índice espacial, orçamento de rótulos, LOD semântico (região → módulo → conceito), layout em Worker ou no servidor e carregamento por região.
   - Recomendação: **manter Canvas 2D com LOD hierárquico** na fase 1, e só depois trocar o *backend* de desenho para WebGL atrás do mesmo contrato `CanvasData`. Candidatos: PixiJS v8 para o visual estilizado, sigma.js v4 se quisermos um motor de grafo nativo, cosmos.gl apenas para uma "nuvem" analítica de mais de 100k nós.
10. **Processo.** O `AGENTS.md` do repo impõe a regra "No guessing": decisões de design são do dono. As perguntas abertas estão listadas na seção 9.

---

## 1. Stack e inventário de UI

| Item | Versão | Licença | Uso no núcleo |
|---|---|---|---|
| next | 16.4.3 (Turbopack padrão) | MIT | App Router; `proxy.ts` (antigo middleware) |
| react / react-dom | 19.2.8 | MIT | — |
| tailwindcss / @tailwindcss/postcss | 4.3.3 | MIT | CSS-first, sem config JS (`components.json` → `"config": ""`) |
| shadcn (estilo) | new-york, baseColor neutral, cssVariables | MIT | `components/ui/*` (button, input, textarea, separator, collapsible, tooltip customizado, hint, status-badge, glyph-mark, button-group) |
| radix-ui + @radix-ui/react-{popper,presence,focus-scope} | 1.6.x | MIT | tooltips, foco modal, *presence* |
| class-variance-authority, clsx, tailwind-merge | — | MIT/Apache | `cn()` em `lib/utils.ts`; variantes do `Button` |
| lucide-react | 1.33.0 | **ISC** | 47 arquivos, ~70 ícones |
| d3-force / d3-zoom / d3-selection / d3-shape | 3.x | ISC | layout e câmera do grafo (`src/core/layout.ts`, `components/graph-canvas.ts`) |
| dagre-d3-es | 7.0.14 | MIT | layout do plano da aula (`components/plan-block.tsx`) |
| streamdown (+ code, math, mermaid, cjk), katex 0.18.2, mermaid 11 | — | MIT | renderização de markdown e LaTeX (`components/md-blocks.tsx`) |
| motion | 13.x | MIT | usado só em `components/ai-elements/shimmer.tsx` |
| use-stick-to-bottom | — | MIT | rolagem do transcript (`ai-elements/conversation.tsx`) |
| **@xyflow/react** | 12.11.3 | MIT | **não usado** (dependência morta) |
| @rive-app/react-webgl2, next-themes, embla-carousel-react, cmdk, media-chrome | — | — | **não usados no núcleo** (o Rive pode servir para animações cel, ver 4.9) |
| Fontes | JetBrains Mono (chrome) e Source Sans 3 (prosa) via `next/font/google`; CMU Serif Bold local (`public/fonts/cmunbx.ttf`, OFL) para títulos | OFL | `app/layout.tsx`, `app/globals.css:94` |

Em `public/` só há `fonts/`, `plugin-loader.js`, `siwc/chatgpt-logo-white.svg` e `worklets/pcm-capture.js`. **Não existe pasta de ícones ou ilustrações.**

O comentário de `components/graph-canvas.ts` cita `docs/research/graph-rendering.md`, mas esse arquivo **não existe** no repo.

---

## 2. (a) Arquitetura de UI e navegação

### 2.1 Árvore de providers (`app/layout.tsx`)

```
<html class="{dark|light} --font-jetbrains --font-sans3" style={themeVars…} suppressHydrationWarning>
 <body class="min-h-dvh antialiased">
  ServerEventsProvider            components/server-events.tsx  (1 EventSource /api/events por janela; notify → fetch)
   PluginsProvider                components/plugins.tsx        (carrega plugins do navegador)
    AppearanceProvider            components/settings/appearance.tsx (tema + tipografia → CSS vars no <html>)
     SidebarProvider              components/sidebar.tsx:106    (<div class="flex h-dvh">, estado aberto/fechado)
      ActivityProvider            components/activity-dock.tsx  (jobs em background)
       AppShell                   components/sidebar.tsx:953
        HostRouteLifetimeProvider → HostContentRootContext → InteractionLayersProvider → SettingsDialogProvider
          ├─ SessionsSidebar      (aside w-72 | w-0, transição de largura de 200ms)
          ├─ FilePathDropZone     (class="relative isolate min-w-0 flex-1") → {children = página}
          ├─ KeyboardShortcuts    (um único listener de keydown na janela)
          └─ PluginWidgets
  UpdateBanner (fora de tudo; só no Electron)
```

### 2.2 Rotas

| Rota | Arquivo | Componente | O que mostra |
|---|---|---|---|
| `/` | `app/page.tsx` (`force-dynamic`) | `Home` (`components/home.tsx`) | Grafo em tela cheia (`GraphView`) **ou** `MinimalHome` quando `settings.graph.rendering` está desligado. Compositor flutuante (tópico mais o seletor Teach/Practice) e `StatsBar` |
| `/chat/new?mode=teach\|practice` | `app/chat/new/page.tsx` | `NewSession` | Rascunho: nada é criado até o primeiro envio |
| `/chat/[id]` | `app/chat/[id]/page.tsx` | `Chat` (`components/chat.tsx`, 161 KB) | TopBar (título renomeável, chip Plan, anel de cobertura, chip de fase, ações de plugin), transcript, `DockOverlay` (QuestionDock, PracticeDock, Composer e StatsBar), `PlanMarginalia`, `SessionFind`, side-thread |
| `/plugins/[pluginId]/[viewId]` | `app/plugins/…/page.tsx` | `PluginViewScreen` (`components/plugin-view.tsx`) | TopBar mais `PluginMountPoint`; plugins registram telas com `ctx.registerView` (o Flashcards registra `library`) |
| `/settings` | `app/settings/page.tsx` | `redirect("/chat/new")` | Configurações são um **modal** (`SettingsDialogProvider`), aberto com Mod+, ou pela linha "Settings" da barra lateral |
| `/api/**` | `app/api/*` | — | `themes`, `graph/*` (snapshot, positions, render-settings, costs, status, import), `chats/*`, `settings/*`, `events` (SSE), `models`, `keys`, `plugins/*`, `stt/token` etc. |

Seções do modal de Settings (`components/settings/settings-dialog.tsx:67`): Providers, Agent, Appearance, Graph, Keyboard, General, mais Core plugins, Community plugins e `plugin:<id>`.

### 2.3 Geometria e layout por superfície

- **Barra lateral** (`components/sidebar.tsx:655`):
  - `aside` com `w-72` (288px) e `border-r bg-background`.
  - Faixa superior: `LhMark` como link para Home e o botão de fechar. É a área de arrastar da janela no Electron (`lh-drag lh-lights-gutter`).
  - Abaixo, as "portas" `+ TEACHING` e `PRACTICE` dentro de `PluginSidebarActions`, depois "SESSIONS" com busca, o filtro Teaching/Practice/All e a lista de sessões (`flex-1`).
  - Fixos no rodapé: `ActivitySection` (agentes em background, linha 854) e a linha "Settings" (linha 859).
  - Fecha sozinha abaixo de 928px no Electron (`SIDEBAR_AUTOCLOSE`, espelhado em `electron/main.cjs`).
- **TopBar** (`components/top-bar.tsx`):
  - É **lei do dono**: toda superfície com barra de topo usa este componente.
  - Altura `h-15` (60px), igual à faixa da barra lateral, com `border-b`.
  - É a área de arrastar da janela; os elementos interativos nativos se excluem dela automaticamente pela regra em `globals.css:530`.
  - O `SidebarToggle` vem primeiro, e o título usa `font-title text-3xl`.
- **Home** (`components/home.tsx`):
  - O `main` ocupa toda a área (`absolute inset-0`).
  - O compositor flutua em baixo (`max-w-[46rem] px-4`, forma `rounded-2xl border bg-card p-1.5 shadow-lg`, botão `size-10 rounded-[10px]`).
  - No topo à esquerda fica só o `SidebarToggle`.
  - No topo à direita fica a coluna de controles do grafo (`GraphChromeRow`, `graph-view.tsx:807`): busca, Chains, Import notes e engrenagem, cada um `rounded-xl border bg-card/85 shadow-lg backdrop-blur`. Abaixo dela, o custo do pipeline e as pílulas de execução.
- **Chat** (`components/chat.tsx`):
  - Coluna `COLUMN = "mx-auto w-full max-w-none px-6"` e `DOCK = "mx-auto w-full max-w-[46rem] px-4"` (linhas 135–136).
  - O `DockOverlay` (linha 2376) traz uma faixa degradê `h-24 bg-gradient-to-t from-background via-background/85` (linha 2843), depois o shell do compositor `rounded-2xl border bg-card shadow-lg` (linha 2878), depois `QuestionDock` ou `PracticeDock` e por fim `StatsBar`.
  - `PlanMarginalia` ocupa o flanco direito da faixa do dock quando há pergunta pendente e espaço para isso (`MARGIN_MIN_W = 220`).
- **Visual atual** (capturas em `docs/assets`):
  - Tema escuro neutro (#141414, #1C1C1C, bordas #434343).
  - Chrome em monoespaçada caixa-alta com *tracking* largo; prosa em Source Sans; títulos em CMU Serif.
  - Grafo de pontos brancos com regiões em névoa colorida por cluster.
  - Cards de pergunta com opções `rounded-lg border`, trilho de confiança colorido e diagrama do plano com o nó atual em halo amarelo desfocado.
  - O conjunto é minimalista e "terminal"; não há ilustração nem ícones expressivos.

### 2.4 Estado

| Tipo | Onde | Chaves / arquivos |
|---|---|---|
| Preferências do aparelho (localStorage) | cliente | `lh:sidebar-open`, `lh:session-kind-filter`, `lh.graph.camera.v1` (câmera do grafo), `lh:keymap` (atalhos remapeados) |
| Configurações do usuário (servidor, JSON) | `data/settings.json` (via `/api/settings/*`) | `appearance` (tema, overrides de cor, fonte, tamanho), `graph` (rendering, extração), `models` (slots) |
| Ajustes do renderer do grafo | `data/graph/render-settings.json` | tamanhos, física e regiões |
| Posições do grafo | `data/graph/positions.json` | ledger de posições (o layout evolui em vez de se reembaralhar) |
| Temas importados | `data/themes/<id>.json` | `ThemeStore` (`src/store/themes.ts`) |
| Atualização de dados | SSE `/api/events` | `useServerEvent` e `useServerResync` (notify → fetch) |
| Camadas de interação | `components/interaction-layers.tsx` | pilha modal/popup e dono do Escape |

**Ponto de atenção para domínios.** `config.ts` calcula `PATHS`, `THEMES_DIR` e os demais caminhos como **constantes de módulo** a partir de `LH_DATA_DIR`. Para isolar dados por domínio é preciso um resolvedor de caminhos por requisição (ver 6.1).

### 2.5 Contratos de interação que a UI nova precisa respeitar

Fontes: `docs/dialog-overlay-contract.md` e `docs/keyboard.md`.

- **Escape tem um único dono**: só a camada mais alta responde, e um Escape tratado não pode também fechar a camada de baixo.
- **Tab nativo está desativado.** Tab só percorre campos; Shift+Tab muda o nível de raciocínio.
- **Famílias de superfície:**
  - modal (Settings, confirmações);
  - menu/popup ancorado (`MenuShell`, `usePopoverDismiss`);
  - *content-area view* (Chains, overlays de diagrama), que fica dentro da área principal e mantém a barra lateral interativa;
  - UI inline.
- **Lei do "no-ring"**: nenhum *outline* de foco (`globals.css:25`).
- **Electron**: regiões de arrastar resolvem pela **ordem do DOM**, não pelo z-index. Um overlay que cobre uma TopBar precisa ser o **último filho** do seu contêiner.
- **Atalhos** vêm de `src/core/keyboard.ts` (registro com `id`, `scope`, `binding`). Para adicionar ações novas (trocar domínio, abrir perfil), registre ali e trate em `components/keyboard-shortcuts.tsx`.

---

## 3. (b) Sistema de temas

### 3.1 Fluxo

```mermaid
flowchart LR
  A[settings.json → appearance.theme e overrides] --> B[readThemeBoot()<br/>src/server/theme-boot.ts]
  T[(BUILTIN_THEMES<br/>src/core/themes.ts:144)] --> B
  F[(data/themes/&lt;id&gt;.json<br/>ThemeStore)] --> B
  B --> C["effectiveColors(theme, appearance)<br/>themes.ts:226"]
  C --> D["themeVars(colors, mode)<br/>themes.ts:255"]
  D --> E["&lt;html class=mode style=vars&gt;<br/>app/layout.tsx (SSR, sem flash)"]
  E --> G[AppearanceProvider<br/>useLayoutEffect: setProperty / removeProperty<br/>+ classe dark/light + window.lh.setAppearance]
  G --> H[Utilitários Tailwind<br/>bg-card, text-muted-foreground, border…]
  G --> I["Canvas do grafo: tokenHex('--primary') etc.<br/>graph-view.tsx:220, :1419"]
  G --> J[Mermaid: claro/escuro pelo mode]
```

### 3.2 Tokens de cor (saída de `themeVars`)

| Variável | Origem (chave do tema) | Uso |
|---|---|---|
| `--background` | background | página; `body` |
| `--foreground`, `--card-foreground`, `--popover-foreground`, `--secondary-foreground`, `--accent-foreground`, **`--primary`** | text | texto; **`--primary` = texto** (botão primário claro no escuro, e é a cor dos nós do grafo: `NODE_COLOR_TOKEN = "--primary"`) |
| `--primary-foreground` | background | texto sobre o primário |
| `--card`, `--popover`, `--secondary`, `--muted` | surface | cards, menus, campos |
| `--accent` | `shiftHex(surface, ±14)` | **superfície de hover**, não é o accent do tema |
| `--muted-foreground` | textMuted | texto secundário; arestas e rótulos do grafo |
| `--destructive`, `--lh-error` | error | — |
| `--border`, `--input` | border | `* { border-color: var(--color-border) }` |
| `--ring`, **`--lh-accent`** | accent | toggles, card de tema selecionado; o "accent de verdade" |
| `--lh-line-strong` | text | contornos fortes (plano, callouts, LhMark) |
| `--lh-ink-strong` / `--lh-ink-italic` / `--lh-ink-code` | bold / italic / code | ênfases da prosa (`.lh-prose strong/em`) |
| `--lh-success`, `--lh-warning` | success / warning | status |

Outros tokens de `AppearanceProvider.appearanceVars()`: `--font-prose`, `--font-title`, `--lh-prose-size`, `--lh-code-ligatures` e `--lh-heading-weight`.

Tokens fixos em `globals.css`: `--radius: 8px`, a escala tipográfica (`--text-xs` 11px até `--text-3xl` 32px, cada um com seu *line-height*), a escala de raios (`--radius-sm` 4 / `md` 8 / `lg` 12 / `xl` 16) e `--font-ui`/`--font-mono` (JetBrains).

### 3.3 Como o Tailwind 4 resolve tokens (testado com 4.3.3)

| Declaração | Saída compilada | Muda em runtime? |
|---|---|---|
| `@theme inline { --radius-xl: 16px }` (como está hoje) | `.rounded-xl { border-radius: 16px }` | **Não** |
| `@theme { --radius-2xl: 20px }` | `.rounded-2xl { border-radius: var(--radius-2xl) }` | Sim |
| sombra padrão `shadow-xl` | `--tw-shadow: 0 20px 25px -5px var(--tw-shadow-color, …)` (valor **embutido**) | **Não** |
| `@theme { --shadow-xl: var(--lh-shadow-xl) }` | `.shadow-xl { --tw-shadow: var(--lh-shadow-xl) }` | **Sim** |
| `backdrop-blur` (sem sufixo) | `blur(8px)` literal; com `@theme { --blur: var(--lh-blur) }` vira `blur(var(--blur))` | Sim, com a indireção |
| `backdrop-blur-sm` | `blur(var(--blur-sm))` | Sim |
| `border` | `border-width: 1px` literal. `@utility border {…}` **não sobrescreve**: as duas regras são emitidas e a nativa vence | Só com CSS *unlayered* |

**Conclusão:** para criar "skins" é preciso indirecionar sombras, raios e blur por `var(--lh-*)` e sobrescrever `.border` com CSS fora de camada (*unlayered*). Utilitários ficam numa *cascade layer* e perdem para CSS fora de camada. O repo já usa esse truque, por exemplo em `.lh-prose :where(ul, ol)`.

### 3.4 Formato de arquivo de tema (atual)

```json
{
  "name": "My Theme",
  "mode": "dark",
  "colors": {
    "background": "#1e1e2e", "surface": "#313244", "border": "#45475a",
    "text": "#cdd6f4", "textMuted": "#a6adc8", "accent": "#cba6f7",
    "bold": "#b4befe", "italic": "#f5c2e7", "code": "#fab387",
    "error": "#f38ba8", "success": "#a6e3a1", "warning": "#f9e2af"
  }
}
```

- As 12 chaves são obrigatórias, em `#rgb` ou `#rrggbb`. `mode` é `"dark"` ou `"light"`. `parseThemeFile` (`themes.ts:88`) devolve o primeiro campo inválido.
- O id é o *slug* do nome (`themeIdFromName`). Ids de preset são reservados; colisões ganham `-2`, `-3` etc. (`app/api/themes/route.ts`).
- Os overrides do usuário moram em `appearance.colors` (9 chaves) e em chaves legadas (`appearance.background`, `mdRendering.boldColor`, `mdRendering.italicColor`), e **sobrevivem à troca de tema**.

### 3.5 Como criar um tema novo hoje

1. **Pela UI:** Settings → Appearance → Theme → **Import JSON**. Isso faz `POST /api/themes`, que valida e grava `data/themes/<id>.json` (no Electron, em `userData/data/themes/`). Para apagar, `DELETE /api/themes/[id]`, que volta para "default" se o tema estiver ativo.
2. **Como preset:** adicione `builtin("Nome", "dark"|"light", {...12 cores})` em `BUILTIN_THEMES` (`src/core/themes.ts:144`). Os cards de tema (`components/settings/theme-cards.tsx`) leem a lista sozinhos.
3. **Testes que travam o comportamento:**
   - `tests/themes.test.ts`: o Default reproduz **literalmente** os valores do `:root` de `globals.css`, então ao mudar o Default é preciso mudar os dois; `--muted-foreground = textMuted`; o hover claro escurece.
   - `tests/themes-api.test.tsx` e `tests/theme-live.test.tsx`.
   - `tests/appearance-chrome.test.ts`.

### 3.6 Onde o tema é carregado

| Momento | Arquivo | Mecanismo |
|---|---|---|
| Primeiro frame (SSR) | `app/layout.tsx` → `readThemeBoot()` (`src/server/theme-boot.ts`) | classe `dark`/`light` mais `style` inline no `<html>`; `await connection()` impede que a página seja pré-renderizada com o tema da máquina de build |
| Troca ao vivo | `components/settings/appearance.tsx` (`AppearanceProvider`) | `useLayoutEffect`: `setProperty`, e `removeProperty` para variáveis que saíram do conjunto (`staleVarNames`) |
| Catálogo | `GET /api/themes` | presets mais customizados |
| Janela nativa | `window.lh.setAppearance({mode, background})` → `electron/main.cjs` (`chromeColors`) | cor de fundo e `titleBarOverlay` |
| Canvas | `graph-view.tsx:1404–1428` | `tokenHex()` converte o token computado em hex (via um canvas 1×1) a cada mudança de paleta |
| Plugins | — | herdam os tokens CSS se os usarem. O CSS do Flashcards tem raios e cores próprios (`--fc-red` etc.), então **não seria re-skinado** |

### 3.7 Limitações atuais para o nosso objetivo

- O tema só controla **cor**. Raio, sombra, espessura, blur e fonte do chrome (`--font-ui` em `@theme inline`) são literais.
- `ThemeStore.writeTheme` e `exportThemeFile` **descartam campos desconhecidos** (gravam só name, mode e colors). Um bloco `skin` precisa ser tratado no parse, na gravação, na exportação e no tipo.
- **Cores fixas no código:**
  - `CONFIDENCE_COLORS` (`components/confidence-rail.tsx:25`);
  - halo amarelo do plano (`plan-block.tsx:295+`, `feGaussianBlur`);
  - matizes HSL dos clusters (`clusterHue`, `CLUSTER_LIGHTNESS` em `graph-canvas.ts:123`);
  - `bg-white`/`text-white` (5 ocorrências);
  - a variante `destructive` do Button usa `text-white`.
- **Strings de classe repetidas:** `"rounded-xl border bg-card p-2 text-xs shadow-xl"` aparece cerca de 20 vezes como `menuClass`. Não há constantes semânticas de superfície.

---

## 4. (c) Cel shading "clean"

### 4.1 Princípios traduzidos em tokens

| Princípio cel | Token / técnica | Valor sugerido (claro / escuro) |
|---|---|---|
| Contorno grosso de tinta | `--lh-ink` (cor), `--lh-stroke` (contornos de objeto), `--lh-stroke-strong` (destaque), `--lh-stroke-hair` (divisórias internas) | ink `#1d1a2b` / `#07080d`; stroke 2px; strong 3px; hair 1.5px. **Hierarquia de traço**: contorno externo mais grosso que as linhas internas |
| Sombra dura deslocada | `--lh-shadow-{xs…2xl}` = `Npx Npx 0 0 var(--lh-ink)` | base (3,3); xs 1, sm 2, md 3, lg 4, xl 5, 2xl 6 (px) |
| 2–3 tons chapados por cor | **bandas duras semitransparentes** em `inset` (`inset 0 2px 0 0 rgb(255 255 255/.22)`, que é o "rim light", e `inset 0 -3px 0 0 rgb(0 0 0/.18)`, que é a "sombra própria") | funciona sobre **qualquer** cor de fundo e gera base, claro e escuro sem calcular paleta |
| Tons calculados (canvas, ícones) | `--lh-{surface,accent,success,…}-{shade,light}` calculados em TS (OKLab, ΔL ≈ −0,10 / +0,08) | hex, para o canvas poder ler |
| Brilho especular | `.cel-gloss::after` (pílula branca 85% no canto superior esquerdo, borda dura) | só em botões primários, chips, badges, nós |
| Sem gradiente suave | `--lh-blur: 0px`, `--lh-blur-sm: 0px`; trocar os `bg-gradient-*` por faixas sólidas ou retícula de paradas duras | — |
| Cantos | `--lh-radius-{sm,md,lg,xl,2xl}` | 6 / 10 / 14 / 18 / 22 (cantos mais "gordinhos" combinam com contorno grosso) |
| Estado pressionado | `translate(var(--lh-press), var(--lh-press))` e sombra reduzida | 2px |
| Paleta | cores saturadas e planas, papel claro ou noite azulada; tinta mais escura que tudo | presets na seção 4.10 |

### 4.2 Extensão do formato de tema: bloco `skin` (opcional e retrocompatível)

```ts
// src/core/themes.ts
export interface ThemeSkin {
  style: "flat" | "cel";            // "flat" = comportamento atual
  ink?: string;                     // #hex; padrão: derivado (dark: background −24 em L; light: text)
  stroke?: number;                  // px, 1–4 (padrão cel 2)
  strokeStrong?: number;            // px, 1–6 (padrão cel 3)
  strokeHair?: number;              // px, 1–3 (padrão cel 1.5)
  shadow?: { x: number; y: number; color?: "ink" | string }; // 0–8 px
  radius?: { sm: number; md: number; lg: number; xl: number; "2xl": number };
  tones?: { shade: number; light: number; rimAlpha?: number; shadeAlpha?: number }; // ΔL OKLab 0–0.3; alfas 0–0.5
  specular?: boolean;
  blur?: number;                    // px; cel = 0
}
export interface ThemeFile { name: string; mode: ThemeMode; colors: ThemeColors; skin?: ThemeSkin }
```

O que muda em cada lugar:

- `parseThemeFile`: valida `skin` com limites (clamp) e **ignora** o bloco se ele estiver ausente, para que os arquivos antigos continuem válidos.
- `src/store/themes.ts` (`writeTheme`) e `exportThemeFile`: passam a persistir `skin`.
- `themeVars(c, mode, skin?)`: quando há `skin`, emite as variáveis da tabela 4.1. O Default **não emite nada novo**, e assim o teste de igualdade com os literais de `globals.css` continua válido. A remoção ao voltar para um tema sem skin já é feita por `staleVarNames`.
- Novo helper puro `toneHex(hex, dL)` (OKLab ↔ sRGB, cerca de 40 linhas) para gerar `--lh-*-shade/light` em hex. Não use `oklch(from …)`: o canvas precisa de hex e a função fica testável.
- `app/layout.tsx`: `<html data-skin={theme.skin?.style ?? "flat"}>`.
- `AppearanceProvider`: `root.dataset.skin = …` no mesmo `useLayoutEffect` que já alterna `dark`/`light`.
- `theme-cards.tsx` (`Preview`): mostrar o skin na miniatura (borda grossa, sombra dura).
- Settings → Appearance: um toggle "Cel shading" e sliders de stroke e deslocamento, como overrides no mesmo padrão de `appearance.colors`. Isso é opcional.

### 4.3 Mudanças em `app/globals.css` (o coração da re-skin)

```css
/* 1) Indireção: TODOS os utilitários existentes passam a obedecer ao skin.
      Tirar as escalas de raio de @theme inline (linhas 134–139) e trazê-las para cá. */
@theme {
  --radius-sm: var(--lh-radius-sm);  --radius-md: var(--lh-radius-md);
  --radius-lg: var(--lh-radius-lg);  --radius-xl: var(--lh-radius-xl);
  --radius-2xl: var(--lh-radius-2xl);
  --shadow-xs: var(--lh-shadow-xs);  --shadow-sm: var(--lh-shadow-sm);
  --shadow-md: var(--lh-shadow-md);  --shadow-lg: var(--lh-shadow-lg);
  --shadow-xl: var(--lh-shadow-xl);  --shadow-2xl: var(--lh-shadow-2xl);
  --blur: var(--lh-blur);            --blur-sm: var(--lh-blur-sm);
  /* nomes "sem sufixo" legados também usados no código (`shadow` ×4, `rounded` sem sufixo ~29×) */
  --shadow: var(--lh-shadow-sm);     --radius: var(--lh-radius-md);
  /* remover --radius de @theme inline (linha 139) E do bloco :root,.dark (linha 41): o :root fora de camada venceria */
  --font-ui: var(--lh-font-ui, var(--font-jetbrains)), ui-monospace, monospace; /* fonte do chrome trocável */
}

/* 2) Padrões = visual de hoje (o "flat" não muda nada) */
:root {
  --lh-radius-sm: 4px; --lh-radius-md: 8px; --lh-radius-lg: 12px; --lh-radius-xl: 16px; --lh-radius-2xl: 16px;
  --lh-shadow-xs: 0 1px 2px 0 rgb(0 0 0 / .05);
  --lh-shadow-sm: 0 1px 3px 0 rgb(0 0 0 / .1), 0 1px 2px -1px rgb(0 0 0 / .1);
  --lh-shadow-md: 0 4px 6px -1px rgb(0 0 0 / .1), 0 2px 4px -2px rgb(0 0 0 / .1);
  --lh-shadow-lg: 0 10px 15px -3px rgb(0 0 0 / .1), 0 4px 6px -4px rgb(0 0 0 / .1);
  --lh-shadow-xl: 0 20px 25px -5px rgb(0 0 0 / .1), 0 8px 10px -6px rgb(0 0 0 / .1);
  --lh-shadow-2xl: 0 25px 50px -12px rgb(0 0 0 / .25);
  --lh-blur: 8px; --lh-blur-sm: 8px;
  --lh-stroke: 1px; --lh-stroke-strong: 1px; --lh-stroke-hair: 1px;
  --lh-ink: var(--border);
}

/* 3) Skin cel: só o que é "geometria de estilo"; as cores vêm do tema */
:root[data-skin="cel"] {
  --lh-blur: 0px; --lh-blur-sm: 0px;
  --lh-rim: inset 0 2px 0 0 rgb(255 255 255 / var(--lh-rim-a, .22));
  --lh-self: inset 0 -3px 0 0 rgb(0 0 0 / var(--lh-shade-a, .18));
  --lh-shadow-xs: 1px 1px 0 0 var(--lh-ink);
  --lh-shadow-sm: 2px 2px 0 0 var(--lh-ink);
  --lh-shadow-md: var(--lh-rim), var(--lh-self), 3px 3px 0 0 var(--lh-ink);
  --lh-shadow-lg: var(--lh-rim), var(--lh-self), 4px 4px 0 0 var(--lh-ink);
  --lh-shadow-xl: var(--lh-rim), 5px 5px 0 0 var(--lh-ink);   /* menus e diálogos: sem auto-sombra */
  --lh-shadow-2xl: var(--lh-rim), 6px 6px 0 0 var(--lh-ink);
}

/* 4) Contorno: fora de camada (vence os utilitários; @utility NÃO vence, testado) */
.border { border-width: var(--lh-stroke, 1px); }
/* divisórias de um lado só: traço fino (hierarquia de traço); cada utilitário já só define o seu lado */
[data-skin="cel"] .border-b { border-bottom-width: var(--lh-stroke-hair); }
[data-skin="cel"] .border-t { border-top-width: var(--lh-stroke-hair); }
[data-skin="cel"] .border-r { border-right-width: var(--lh-stroke-hair); }
[data-skin="cel"] .border-l { border-left-width: var(--lh-stroke-hair); }
```

Notas sobre esse bloco:

- O `skin` do tema sobrescreve `--lh-shadow-*`, `--lh-radius-*` e `--lh-stroke` inline no `<html>`. O bloco `[data-skin="cel"]` dá valores padrão razoáveis quando o tema só declara `style: "cel"`.
- Nos temas cel, a cor de `border` deve ser a **própria tinta**, para que `border-border/60` (divisórias) vire tinta a 60%.
- As regras por lado do passo 4 não precisam de reset: no Tailwind 4, `.border-b` e os demais já definem só o próprio lado. Um elemento com `border` e `border-b` ao mesmo tempo fica com o lado de baixo fino, porque a regra por lado vem depois com especificidade maior. Valide visualmente.
- `rounded-[10px]` aparece 10 vezes e foi calculado à mão como "raio do shell menos padding" (comentário em `components/composer.tsx:16`). Troque por `rounded-[calc(var(--lh-radius-2xl)-6px)]` em `composer.tsx:220`, `composer.tsx:231`, `home.tsx:289`, `attach-files-button.tsx:169`, `question-dock.tsx:904`, `practice-dock.tsx:162`, `plugin-question-dock.tsx:160` e `side-thread.tsx:153`/`side-thread.tsx:173`.

### 4.4 Classes cel (poucas, opt-in, nada de reescrever componentes)

```css
/* botão/chip "gomoso": 2 tons por banda dura + especular */
[data-skin="cel"] .cel-gloss { position: relative; isolation: isolate; }
[data-skin="cel"] .cel-gloss::after {
  content: ""; position: absolute; left: 12%; top: 16%; width: 26%; height: 22%;
  border-radius: 999px; background: rgb(255 255 255 / .85); pointer-events: none;
}
[data-skin="cel"] .cel-press:active { transform: translate(2px, 2px); box-shadow: var(--lh-shadow-xs); }
/* faixa de 2 tons sem degradê: parada dura em 60% */
[data-skin="cel"] .cel-band { background-image: linear-gradient(to bottom, transparent 60%, var(--lh-self-tone, rgb(0 0 0 / .14)) 60%); }
/* retícula (halftone) para substituir faixas de fade */
[data-skin="cel"] .cel-halftone {
  background-image: radial-gradient(var(--background) 32%, transparent 33%);
  background-size: 6px 6px; /* círculos com borda dura, não é degradê suave */
}
```

Onde aplicar:

- `.cel-gloss` e `.cel-press`: botão enviar do compositor, `Button` com `variant="default"`, chips de nível/XP, badges, seletor de domínio.
- `.cel-band`: opção selecionada no `QuestionDock`.
- `.cel-halftone`: no lugar da faixa degradê do dock (`chat.tsx:2843`, `new-session.tsx:190`).

### 4.5 Inventário: onde estão sombras, raios, bordas, blur e degradês

Contagem em `components/` e `app/`:

- **Sombras:** `shadow-xl` 28, `shadow-lg` 26, `shadow-xs` 4, `shadow` 4, `shadow-sm` 2, `shadow-md` 2, `shadow-2xl` 1, `shadow-none` 3. Ficam em 42 arquivos.
- **Raios:** `rounded-sm` 72, `rounded-xl` 69, `rounded-lg` 59, `rounded-md` 54, `rounded-full` 34, `rounded-2xl` 9, `rounded-[10px]` 10, `rounded-[6px]` 3.
- **Blur:** `backdrop-blur` 19, `backdrop-blur-sm` 8, mais `backdrop-blur-[18px]` em `side-thread.tsx:279`.
- **Opacidade de card:** `bg-card/85` 9, `bg-card/80` 7, `bg-card/60` 4, `bg-card/95` 1, `bg-card/50` 1.

| Família | Onde | Hoje | Ação cel |
|---|---|---|---|
| Chrome flutuante do grafo | `graph-view.tsx:360, 442, 461, 837, 864, 1610, 1629`; `notes-import.tsx:109`; `plugin-chrome.tsx:96`; `model-picker-pill.tsx:8`; `minimal-home.tsx:159` | `rounded-xl border bg-card/85 shadow-lg backdrop-blur` | automático pela indireção. Opcional: trocar `bg-card/85` por `bg-card` (opaco fica mais "cel") |
| Shells do compositor | `home.tsx:247`, `chat.tsx:2878`, `new-session.tsx:200`, `plugin-composer.tsx:93` | `rounded-2xl border bg-card shadow-lg` | automático; botão enviar com `.cel-gloss .cel-press` |
| Menus (`MenuShell menuClass`) | ~20 lugares: `sidebar.tsx:883`, `model-picker.tsx:312/336`, `graph-view.tsx:1511`, `settings/*`, `setup-dialog.tsx`, `plugin-ui-host.tsx:302`, `dictation-language.tsx:75`, `citation-*` | `rounded-xl border bg-card p-2 text-xs shadow-xl` | automático; **extrair** para `components/ui/surfaces.ts` (`SURFACE.menu`) |
| Diálogos | `abort-turn-dialog.tsx:69`, `delete-{node,session,source}-dialog.tsx`, `keyboard-shortcuts.tsx:185`, `plugin-ui-host.tsx:353`, `settings-dialog.tsx`, `setup-dialog.tsx` | `rounded-xl border bg-card p-5 shadow-xl` e fundo `bg-background/80 backdrop-blur-sm` | automático; fundo cel = `bg-background/80` sem blur (ou retícula) |
| Overlays de área | `session-overlay.tsx:231`, `plan-block.tsx:875`, `chain-table.tsx:820`, `plugin-surface-shell.tsx:107` | `bg-background/80 backdrop-blur-sm` | automático (blur 0) |
| Cards do transcript | `practice-cards.tsx:69,121,258`, `answered-card.tsx:30,65`, `thinking-block.tsx`, `artifacts/*` | `rounded-xl border bg-card p-4` | automático (borda 2px); sombra opcional `shadow-sm` |
| Dock de pergunta | `question-dock.tsx:657–747` | opções `rounded-lg border`; selecionada `border-primary bg-accent`; "não sei" `border-dashed` | selecionada: `.cel-band` com `shadow-sm`; tracejado continua |
| Trilho de confiança | `confidence-rail.tsx:25–47` | 6 cores fixas e `linear-gradient` com paradas **duras** (já é "cel") | trocar as cores por tokens `--lh-error…--lh-success` em 6 passos |
| Shimmer de carregamento | `ai-elements/shimmer.tsx:55–63` | varredura de degradê suave (motion) | trocar por "pisca em degraus" (`steps(4)`) ou o spinner braille |
| Faixa do dock | `chat.tsx:2843`, `new-session.tsx:190` | `bg-gradient-to-t from-background via-background/85` | banda sólida de 2 passos ou `.cel-halftone` |
| Brilho do plano | `plan-block.tsx:573–635` (`feGaussianBlur`, GLOW_*) | halo amarelo desfocado | contorno de tinta mais sombra amarela dura (offset 3px) e especular |
| Hover do nó | `graph-canvas.ts:1707` (`createRadialGradient`) | halo radial suave | anel duro (stroke) na cor do accent |
| Regiões | `graph-canvas.ts:337+, 1368+` (splat, box blur, upscale) | névoa colorida | **posterização com d3-contour** (4.6) |
| Código e tabelas | `globals.css:324–392` | `border: 1px solid var(--border)`, raio .75rem | `var(--lh-stroke-hair)` e `var(--lh-radius-lg)` |
| Scrollbar | `globals.css:236–257` | thumb `var(--color-border)`, raio 8px | thumb com contorno de tinta, raio `--lh-radius-sm` |
| Tooltip | `components/ui/tooltip.tsx` (TooltipContent) | shadcn | automático |
| Inputs/Button shadcn | `ui/input.tsx` (`shadow-xs`, `rounded-md`), `ui/button.tsx` (`outline` → `shadow-xs`) | — | automático |

### 4.6 Canvas do grafo em cel (`components/graph-canvas.ts`)

Mudanças mínimas mantendo a regra "um `Path2D`, um `fill`":

```ts
// CanvasColors (graph-canvas.ts:130) ganha:
interface CanvasColors { /* …atuais… */ ink: string; nodeShade: string; specular: string;
  cel?: { stroke: number; shadow: number } }   // px de tela; ausente = desenho atual

// buildGeometry(): além de nodesPath, montar specPath (brilho):
specPath.moveTo(n.x - nodeR*0.35 + nodeR*0.28, n.y - nodeR*0.35);
specPath.arc(n.x - nodeR*0.35, n.y - nodeR*0.35, nodeR*0.28, 0, Math.PI*2);

// draw(), passo 4 (nós), com cel:
ctx.save(); ctx.translate(cel.shadow / k, cel.shadow / k);
ctx.fillStyle = colors.ink; ctx.fill(this.nodesPath); ctx.restore();       // sombra dura
ctx.fillStyle = colors.node; ctx.fill(this.nodesPath);                      // tom base
ctx.lineWidth = cel.stroke / k; ctx.strokeStyle = colors.ink; ctx.stroke(this.nodesPath); // contorno
ctx.fillStyle = colors.specular; ctx.fill(this.specPath);                    // especular
```

Outras mudanças no canvas:

- **Estados de domínio no mapa** (bloqueado, disponível, estudando, dominado, revisão pendente): um `Path2D` por *bucket* de estado. São 5 `fill`s no total, e o custo continua independente de N.
- **Rótulos estilo "adesivo"**: `ctx.lineJoin = "round"; ctx.strokeStyle = colors.background; ctx.lineWidth = 3 / k; ctx.strokeText(...)` antes do `fillText`. Isso dobra o custo por rótulo, então só vale junto com o orçamento de rótulos da seção 7.3.
- **Hover**: troca o gradiente radial (linha 1707) por `ctx.arc(…glowOuter)` com `stroke` na cor do accent e `lineWidth = 2 / k`, mais a mesma sombra dura.
- **Regiões posterizadas**: `buildRegions` já produz um campo de densidade de baixa resolução (até 512px). Em vez de redimensionar com suavização, aplique `d3-contour` (ISC, ~5 KB) com `contours().size([w, h]).thresholds([t1, t2])(values)`.
  - O resultado são polígonos em 2 níveis: banda clara e banda base de cada cluster.
  - Converta para coordenadas de mundo, monte um `Path2D` por nível com `fill` chapado (`hsl(hue, 55%, L1/L2)`) e **um `stroke` de tinta** no contorno externo.
  - O efeito são "ilhas" cel com borda dura, que leem como continentes. Isso combina muito com o mapa de currículo.
  - Só reconstrói quando a geometria muda; o custo é o mesmo de hoje.
- **Arestas**: tinta com `lineCap = round`. Pré-requisitos fortes podem ser desenhados duas vezes (tinta grossa e cor fina por cima) para o efeito "contorno".
- **De onde vêm as cores**: `graph-view.tsx:1419` passa a ler `tokenHex("--lh-ink")`, `"--lh-accent-shade"` e `"--background"`, e lê `--lh-stroke` como número via `getComputedStyle`.

### 4.7 Tipografia (opcional)

- O chrome usa JetBrains Mono em caixa alta. Para "clean" cel funciona bem, mas uma sans arredondada de licença OFL (Nunito, Lexend, Fredoka) suaviza bastante.
- Para isso, torne `--font-ui` trocável em runtime (passo 1 de 4.3) e adicione uma linha "Fonte da interface" em Appearance.
- Títulos em CMU Serif contrastam com o cel; sugira `sessionNameSerif = false` nos presets cel.

### 4.8 Acessibilidade e movimento

- Contorno de 2px melhora a percepção de limites, mas confira o contraste da **tinta sobre o fundo** no tema escuro (tinta mais escura que o fundo some). Nos temas escuros, use "tinta" = `#000` mais um **rim light** interno `inset` claro, que é o que dá a leitura.
- `prefers-reduced-motion`: as animações novas (pressionar, "boil" dos ícones, confete de nível) precisam do mesmo `@media` que o repo já usa.
- A lei do "no-ring" continua valendo; o foco de teclado continua usando os anéis próprios do dock.

### 4.9 Animação

- O `@rive-app/react-webgl2` já é dependência (runtime MIT; o editor Rive é SaaS). Serve para mascote, *level-up* e badges animados em estilo cel, com estados (máquina de estados do Rive).
- Para efeitos simples, CSS com `steps()` dá o "toon timing" (animar em "2s" ou "3s", como em animação de baixa taxa).

### 4.10 Presets propostos

Todos os valores abaixo precisam de validação de contraste.

```json
{ "name": "Cel Dia", "mode": "light",
  "colors": { "background": "#fbf6ea", "surface": "#ffffff", "border": "#1d1a2b",
    "text": "#1d1a2b", "textMuted": "#6b6577", "accent": "#ff7a45",
    "bold": "#2f6fdf", "italic": "#c2418a", "code": "#c85a1e",
    "error": "#e5484d", "success": "#2ea44f", "warning": "#f2a516" },
  "skin": { "style": "cel", "ink": "#1d1a2b", "stroke": 2, "strokeStrong": 3, "strokeHair": 1.5,
    "shadow": { "x": 3, "y": 3, "color": "ink" },
    "radius": { "sm": 6, "md": 10, "lg": 14, "xl": 18, "2xl": 22 },
    "tones": { "shade": 0.10, "light": 0.08, "rimAlpha": 0.5, "shadeAlpha": 0.12 },
    "specular": true, "blur": 0 } }
```

```json
{ "name": "Cel Noite", "mode": "dark",
  "colors": { "background": "#1a1c2b", "surface": "#262a40", "border": "#05060a",
    "text": "#f1eee6", "textMuted": "#a3a0b5", "accent": "#ffd23f",
    "bold": "#7cc6ff", "italic": "#ff8fc7", "code": "#ffb36b",
    "error": "#ff6b6b", "success": "#5be08f", "warning": "#ffc145" },
  "skin": { "style": "cel", "ink": "#05060a", "stroke": 2, "strokeStrong": 3, "strokeHair": 1.5,
    "shadow": { "x": 3, "y": 3, "color": "ink" },
    "radius": { "sm": 6, "md": 10, "lg": 14, "xl": 18, "2xl": 22 },
    "tones": { "shade": 0.08, "light": 0.10, "rimAlpha": 0.14, "shadeAlpha": 0.25 },
    "specular": true, "blur": 0 } }
```

Sugestão: **a cor de destaque varia por domínio** (por exemplo Eletrônica em amarelo elétrico `#ffd23f`, Inglês em coral `#ff7a45`). Isso pode ser um override automático de `accent` ao trocar de domínio (ver 6.1).

### 4.11 Ordem de implementação e testes afetados

1. Indireção de tokens em `globals.css` (valores padrão = visual atual). O resultado deve ser **pixel-idêntico**; confirme com os testes `tests/render-*.test.tsx` e uma inspeção visual.
2. `ThemeSkin` em `src/core/themes.ts` (parse, `themeVars`, `toneHex`), no store, no export e no `data-skin` do layout e do provider. Testes novos em `tests/themes.test.ts`.
3. Presets Cel Dia e Cel Noite mais a miniatura em `theme-cards.tsx`.
4. Constantes semânticas de superfície (`SURFACE.*`) e codemod dos ~20 `menuClass`. Os testes `render-graph-chrome`, `render-sidebar` e outros comparam strings de classe e precisarão de atualização.
5. Canvas cel (nós, hover, regiões com d3-contour) e `PlanDiagram` sem blur.
6. Ícones (seção 5).

---

## 5. (d) Ícones: hoje e o plano para SVG desenhado à mão

### 5.1 Inventário atual

- `components.json` declara `"iconLibrary": "lucide"`. `lucide-react` 1.33.0 (ISC) é importado em **47 arquivos**.
- **Ícones lucide em uso**, contando os imports em várias linhas:

  ActivityIcon, ArrowDownIcon, ArrowRight(Icon), ArrowUpRight, BookIcon, BookOpenIcon, BotIcon, CheckIcon, ChevronDown/Left/Right/UpIcon, ChevronRight, CircleX, ClipboardCheckIcon, CopyIcon, CornerDownLeft(Icon), DownloadIcon, DumbbellIcon, EllipsisIcon, File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileSymlinkIcon, FileText(Icon), FileVideo, Folder(Icon), FolderOpenIcon, FolderPlusIcon, GripVertical, KeyIcon, KeyboardIcon, ListTreeIcon, Loader2Icon, MaximizeIcon, MessageCircleQuestion(Icon), Mic(Icon), MinusIcon, PaletteIcon, PanelLeftClose/OpenIcon, PaperclipIcon, PenToolIcon, Pencil, Pin, PinOff, PlayIcon, PlugIcon, PlusIcon, PuzzleIcon, Quote, RefreshCw, SearchIcon, Settings(Icon), Square(Icon), Trash2Icon, UploadIcon, WaypointsIcon, X(Icon).

  Os mais usados: XIcon (7), ChevronRightIcon (6), WaypointsIcon, SettingsIcon, MaximizeIcon, DownloadIcon e CheckIcon (5 cada).
- **SVG inline próprio:**
  - `components/lh-mark.tsx` (marca do app, usa `var(--lh-line-strong)`);
  - `components/ui/glyph-mark.tsx` (✓/✗ "estilo LaTeX", contornos extraídos da Zapf Dingbats);
  - `braille-spinner.tsx`;
  - `plan-block.tsx` (diagrama);
  - `extraction-coverage.tsx` (anel);
  - `artifacts/{invert-disc,image-card,visual-card}.tsx`;
  - `session-overlay.tsx`, `settings-dialog.tsx`, `plugin-surface-shell.tsx` e `plugin-ui-host.tsx`.
- **Arquivos:** `public/siwc/chatgpt-logo-white.svg` (logo de terceiro; manter como está, é marca registrada).
- **Plugins:** `PluginAction.icon` e `PluginButtonProps.icon` são **strings de markup SVG confiável**, renderizadas com `dangerouslySetInnerHTML` (`plugin-chrome.tsx:44`, `plugin-ui-host.tsx:203`). O Flashcards define `flashcardsIcon` próprio.
- **Tamanho:** sempre por `className` (`size-3`, `size-3.5`, `size-4`, `size-5`). O `Button` aplica `[&_svg:not([class*='size-'])]:size-4`.

### 5.2 Arquitetura proposta

```
assets/icons/                         ← fonte (SVG desenhados à mão; 1 arquivo por ícone)
  ink/  search.svg  close.svg  …      ← camada de tinta (traços já convertidos em contorno preenchido)
  tone/ search.svg  …                 ← (opcional) camada de tom chapado
scripts/build-icons.mjs               ← SVGO + codegen (roda no "dev"/"build", como os plugins:build-*)
components/icons/
  generated.tsx                       ← GERADO: const PATHS: Record<IconName, {ink: string; tone?: string; hl?: string; vb: string}>
  icon.tsx                            ← <Icon name size? className title? variant?>
  lucide-compat.ts                    ← export const SearchIcon = (p) => <Icon name="search" {...p}/> … (mesmos nomes do lucide)
  names.ts                            ← export type IconName = keyof typeof PATHS
public/icons/sprite.svg               ← GERADO: <symbol id="search"> (para plugins e para o atlas do canvas)
```

```tsx
// components/icons/icon.tsx
import { PATHS, type IconName } from "./generated";
export function Icon({ name, className, title, variant = "cel", ...rest }:
  { name: IconName; className?: string; title?: string; variant?: "line" | "cel" } & React.SVGProps<SVGSVGElement>) {
  const g = PATHS[name];
  return (
    <svg viewBox={g.vb} className={className} aria-hidden={title ? undefined : true}
         role={title ? "img" : undefined} focusable="false" {...rest}>
      {title && <title>{title}</title>}
      {variant === "cel" && g.tone && <path d={g.tone} fill="var(--lh-icon-tone, transparent)" />}
      <path d={g.ink} fill="currentColor" />
      {variant === "cel" && g.hl && <path d={g.hl} fill="var(--lh-icon-hl, rgb(255 255 255 / .8))" />}
    </svg>
  );
}
```

- **Por que codegen e não SVGR?** SVGR no Turbopack exige `turbopack.rules` com `@svgr/webpack` em `next.config.ts`, mais declarações TS e cuidado com SSR. O codegen dá componentes puros, compatíveis com SSR e Electron, que dependem só de `currentColor` e CSS vars, e sem configuração de bundler. O `sprite.svg` atende os plugins e o canvas.
- **Migração incremental:**
  1. Criar `lucide-compat.ts` com os mesmos nomes exportados (`XIcon`, `SearchIcon`…). Ícone ainda não desenhado vira reexport do lucide como fallback.
  2. Fazer um codemod (sed ou jscodeshift) trocando `from "lucide-react"` por `from "@/components/icons/lucide-compat"` nos 47 arquivos. Nenhuma mudança de JSX.
  3. Ir desenhando; cada ícone novo substitui o fallback.
  4. Ao fim: `eslint.config.mjs` com `no-restricted-imports` para `lucide-react`, remover a dependência e mudar `components.json` (`iconLibrary`) para não regenerar shadcn com lucide.
- **Canvas** (ícones nos nós do mapa): rasterize o sprite numa **atlas** `ImageBitmap` em 2–3 tamanhos (por exemplo 16/32/64 × DPR) com `createImageBitmap(new Blob([svg]))` e use `drawImage` por nó visível. É barato, mas precisa do culling da seção 7.
- **Plugins:** opcionalmente, expor `ctx.ui.hostIcon(name): string`, que devolve o markup SVG do registro, para que plugins usem o mesmo set. Isso exige mudar o contrato público (`src/core/plugin-ui.ts`).

### 5.3 Especificação de desenho (para quem for desenhar)

- **Grade:** 24×24, área útil 20×20, centro óptico.
- **Tinta:** traço aparente de ~2px (equivalente ao `stroke` do tema na escala `size-4`), com **variação de espessura feita à mão** (afinando nas pontas). Como o traço é convertido em *outline*, a cor sai de `fill=currentColor`, e a espessura não muda pelo CSS. Exporte um set "regular"; um set "bold" para tamanhos de 12px é opcional.
- **Camadas:**
  - `ink`: obrigatória, preto `#000`;
  - `tone`: opcional, marcador `#FF00FF`, que o script converte para `var(--lh-icon-tone)`;
  - `hl`: brilho, marcador `#00FFFF`, convertido para `var(--lh-icon-hl)`.

  Isso dá 2–3 tons chapados por ícone, como pede o cel.
- **Boil** (tremido de traço feito à mão) só em hover ou estados vivos: um filtro SVG global `<filter id="lh-boil"><feTurbulence baseFrequency=".02" numOctaves="1" seed="{1..3}"/><feDisplacementMap scale="0.8"/></filter>` alternando o `seed` com `steps(3)`. Respeite reduced-motion e evite em listas longas.
- **Nomes semânticos** (não por forma): `close`, `search`, `settings`, `chevron-right`, `send`, `attach`, `mic`, `plan`, `chains`, `practice`, `teach`, `graph`, `import`, `export`, `copy`, `pin`, `trash`, `file-*`, `folder-*`, `play`, `stop`, `expand`, `drag-handle`, `refresh`, `plugin`, `palette`, `keyboard`, `key`, `bot`, `quote`, `question`, `check`, `x-mark`.
- **Ícones novos para as features:**
  - `domain-electronics`, `domain-english`, `domain-generic`;
  - `xp`, `level-badge` (escudo com número desenhado), `streak`, `trophy`, `rank`;
  - `video`, `book`, `chapter`, `lesson-ai`, `resource`, `prereq`, `locked`, `mastered`, `review-due`;
  - `profile`, `hours`, `tokens`, `flashcard`, `anki`, `obsidian`.

  Logos de terceiros como YouTube, Anki e Obsidian devem seguir as diretrizes de marca de cada um; prefira glifos genéricos.
- **Ferramentas:** Inkscape (GPL, só ferramenta), Affinity Designer ou Procreate exportando SVG, e depois SVGO (MIT, `preset-default`, `removeDimensions`, `convertColors`). Alternativa para "parecer feito à mão" sem desenhar tudo: **Rough.js** (MIT) gera traços rabiscados a partir de formas e serve para molduras ou ilustrações, mas não substitui ícones bem desenhados.
- **Sets prontos para inspiração ou base** (confirme a licença na fonte do autor):
  - Doodle Icons (Khushmeen Sidhu): 450+ SVG, listado como CC0;
  - Open Doodles (Pablo Stanley): ilustrações, CC0;
  - Iconoodle (GitHub NK2552003): MIT.

  Todos são compatíveis com AGPL.

---

## 6. (e) Onde encaixar as features novas

### 6.1 Seletor de domínio (workspace)

**Wireframe da barra lateral proposta:**

```
┌──────────────────────────────┐
│ ● ● ●   [LH]            [⇤]  │  ← faixa h-15 (LhMark = Home), igual hoje
│ ┌──────────────────────────┐ │
│ │ ⚡ Eletrônica         ▾  │ │  ← DomainSwitcher (novo) .cel-gloss, cor do domínio
│ └──────────────────────────┘ │
│  + AULA        🏋 PRÁTICA    │  ← portas atuais (PluginSidebarActions)
│  SESSÕES [busca…]            │
│  [Teaching|Practice|All]     │
│  · Lei de Ohm      agora     │  ← lista filtrada pelo domínio ativo
│  · Divisor de tensão  1d     │
│  …                           │
│  AGENTES EM BACKGROUND       │  ← ActivitySection (igual)
│ ┌──────────────────────────┐ │
│ │ (◕) Nv 12  ▰▰▰▰▱▱ 62%    │ │  ← ProfileChip (novo) → /profile
│ └──────────────────────────┘ │
│  ⚙ CONFIGURAÇÕES             │
└──────────────────────────────┘
```

- **Componente:** `components/domain-switcher.tsx`, um botão que abre um `MenuShell` (mesma disciplina de foco, setas e Escape) com:
  - a lista de domínios (ícone, nome, nível do domínio, horas);
  - "Novo domínio…";
  - "Gerenciar".

  Inserir em `sidebar.tsx` logo após a faixa do `LhMark` (cerca da linha 698, antes de `<PluginSidebarActions>`).
- **Com a barra lateral fechada:** mostrar um chip compacto `⚡` ao lado do `SidebarToggle` no header da Home (`home.tsx`, `<header>` no fim do arquivo) e na TopBar do chat (antes do título).
- **Atalhos:** registrar `switch-domain` (Mod+Shift+D, abre o menu) e `domain-1…9` (Mod+1…9) em `src/core/keyboard.ts` e despachar em `components/keyboard-shortcuts.tsx`.
- **Estado no cliente:** `DomainProvider` (contexto com `domains`, `active` e `switch(id)`), montado em `AppShell` acima de `SessionsSidebar`.
  - Trocar de domínio faz `POST /api/domains/active` (grava o cookie `lh-domain` e o registro), `router.refresh()` e um *resync* dos consumidores de SSE.
  - Chaves de localStorage por domínio: `lh.graph.camera.v1:<domain>` e `lh:session-kind-filter:<domain>`.
  - Preferências globais continuam globais: `lh:sidebar-open`, `lh:keymap`, tema.
- **Servidor** (pré-requisito, fora do escopo de UI mas bloqueante):
  - Hoje `config.ts` exporta `PATHS.chats` e `PATHS.graph` como constantes.
  - Proposta: `data/domains/<domainId>/{chats,graph,core-plugin-data,…}` mais um resolvedor `dataPaths(domainId)` usado pelas stores. Ficam globais: `settings.json`, temas, auth e prompts.
  - Cada route handler e server component lê o domínio do cookie (`cookies()`) ou o deriva do id do chat.
  - Não dá para usar `proxy.ts` mais AsyncLocalStorage para propagar o contexto, porque o proxy roda separado dos handlers.
- **Tema por domínio:** `domain.accent` aplicado como override de `--lh-accent` e `--ring`, mais `--lh-domain` usado no mapa e nos chips.

### 6.2 Perfil: nível, XP, ranking e estatísticas

- **Entrada:** `ProfileChip` no rodapé da barra lateral, acima da linha "Settings" (`sidebar.tsx:859`). Atalho opcional Mod+Shift+P (`open-profile`).
- **Rota nova:** `app/profile/page.tsx` → `components/profile/profile-screen.tsx`, com `TopBar` (título "Perfil" em `font-title`) e corpo rolável, como em `PluginViewScreen`. Foi escolhida uma **página** e não um modal porque é conteúdo de leitura e rolagem, e o Settings já ocupa o lugar de modal único.
- **Layout leve** (sem parágrafos explicativos, números grandes, legendas curtas):

```
┌ Perfil ─────────────────────────────────────────────────────────────┐
│ (avatar desenhado)  Nicolas · Nível global 14   ▰▰▰▰▰▱▱ 3.420/5.000 │
│ ┌ Eletrônica ─────────┐ ┌ Inglês ─────────────┐                     │
│ │ [escudo 9]  ▰▰▰▱▱   │ │ [escudo 6]  ▰▰▱▱▱   │  ← nível por domínio │
│ │ Top 22% · 140h      │ │ Top 41% · 62h       │  ← ranking (MC)      │
│ │ ▁▂▅█▆▃▁ ▲você       │ │ ▁▃▇█▅▂▁   ▲você     │  ← histograma duro   │
│ └─────────────────────┘ └─────────────────────┘                     │
│ Horas por dia  [heatmap 26 semanas, 4 tons chapados]   🔥 12 dias   │
│ Tokens por modelo                                                   │
│  gpt-6.1-sol   ████████████▌ 4,1M  (assinatura)                     │
│  claude-…      █████▏        1,7M  $3,20                            │
│  Total 6,0M · $3,20 · 312 turnos                                    │
└─────────────────────────────────────────────────────────────────────┘
```

- **Onde o XP aparece fora do perfil:**
  - na `StatsBar` (lado direito, "+N XP" da sessão; popover "Session stats" com o XP ganho);
  - em *toasts* rápidos "+15 XP" com sombra dura ao responder certo, perto do `QuestionDock`;
  - num modal de **level-up**. Referência: `DeepTutor/web/components/space/learning/LevelUpCelebration.tsx` (Apache-2.0, confete em canvas 2D). Em versão cel, com confete chapado de 2 tons e contorno;
  - nos badges de nível por região no mapa (6.3).
- **Dados que já existem:**
  - `TurnUsage` (`src/core/contracts/chat.ts:185`): `model` por turno, `steps[]` com `CallUsage` (tokens de entrada, saída, cache e raciocínio).
  - `GraphCostSummary` (`src/core/cost-summary.ts:58`): extração e auditoria.
  - `ChatSummary.createdAt/updatedAt`.
  - Formatação em `components/usage-format.ts` (`formatTokens`, `formatUsd`, `prettyModel`, `planCostLabel`).
- **O que falta:**
  - *Heartbeat* de tempo ativo (visibilidade e foco mais interação, por exemplo em intervalos de 30s, gravado por domínio e por dia). Os timestamps de turno subestimam o tempo de leitura.
  - Uma API agregadora `GET /api/profile/stats?domain=`.
- **Gráficos:** seguir as diretrizes de dataviz (paleta chapada, sem degradê): barras horizontais, heatmap de calendário de 4 níveis e histograma em degraus para o ranking Monte Carlo. Dá para fazer em SVG puro, sem biblioteca. Referência leve de "faixa de stats": `BloomTutor/frontend/src/components/me/activity-stats.tsx` (MIT, `StatStrip` de 5 colunas).

### 6.3 Mapa do currículo massivo

- **Lugar:** a **visão principal da Home** (`home.tsx` → `<main>`), por domínio. O grafo atual de proposições (conhecimento extraído das sessões) vira uma **camada**: a maestria do aluno projetada sobre os nós do currículo.
- **Controle de modo:** na `GraphChromeRow` (`graph-view.tsx:807`), um segmentado **Currículo | Conhecimento**, com "Chains" continuando como botão.
- **Novo componente:** `components/curriculum-map.tsx`. Reaproveita `GraphCanvasRenderer`, generalizado: o contrato `CanvasData` ganha `level`, `parentId`, `state` e `iconName`. A estrutura de `GraphView` (chrome, card, câmera persistida, dono do Escape) continua a mesma.
- **Elementos de UI novos:**
  - *Breadcrumb* no topo à esquerda, depois do `SidebarToggle`: `Eletrônica › Circuitos DC › Leis de Kirchhoff`. Cada parte dá zoom para aquela região.
  - **Minimapa** no canto inferior direito (canvas de 160×120, só ilhas e retângulo da viewport), escondido em telas estreitas.
  - **Legenda de estados** mínima: 5 glifos sem texto, com tooltip.
  - **"Próximo passo"**: um chip pulsante (2 tons, `steps`) no nó recomendado e um botão "Ir" no compositor.
  - Badges de nível e progresso por **ilha/região**, que são os "níveis em várias partes".
- **No chat:** a TopBar ganha um chip de *breadcrumb* compacto (nó atual) ao lado do chip "Plan" (`chat.tsx`, cerca de 1700). Ele abre o mapa focado no nó. O `PlanMarginalia` continua sendo o plano da aula; o mapa é o plano do ano.
- **Layout recomendado:** "fundamentos no centro, doutorado na borda". O `src/core/layout.ts` já tem `DepthAnchorMode = "radial"` com `inferenceDepths` (Tarjan, O(V+E), seguro contra ciclos), que é perfeito para profundidade de pré-requisito. Ver a seção 7 para escala.

### 6.4 Painel de recursos por nó

- **Família:** *content-area view* (como Chains): um painel `absolute` à direita dentro da área principal, com `w-[26rem]` e tela cheia abaixo de 768px.
  - Não é modal: o mapa continua navegável.
  - Registra uma camada em `InteractionLayers` para ser dono do Escape.
  - Deve ser o **último filho** do contêiner por causa da regra de arrastar do Electron.
- **Arquivo novo:** `components/resource-panel.tsx`. Ele substitui o card de detalhe atual (`graph-view.tsx:1629`, `w-80`) no modo Currículo; no modo Conhecimento o card atual continua.

```
┌ Lei de Ohm ───────────────────────────── [×] ┐
│ Eletrônica › Circuitos DC   ◆ disponível     │
│ ~2h · +120 XP · pré-req: Tensão, Corrente ✓  │
│ [ ▶ Começar aula ]  [ 🏋 Praticar ]          │  ← cria sessão teach/practice com graphContext
│ ─ Vídeos ─────────────────────────────────── │
│ [thumb] Ohm em 8 min · Canal X · PT  · 8:12  │
│ [thumb] Ohm's law…   · Canal Y · EN·CC · 11m │  ← badges: PT / EN·legenda / EN·dublado
│ ─ Livros ─────────────────────────────────── │
│ 📖 Boylestad, cap. 4 (p. 98–131) · cobre 14 nós│
│ ─ Pré-requisitos ─────────────────────────── │
│ (mini-DAG local: PlanDiagram/dagre)          │
│ ─ Revisão ────────────────────────────────── │
│ 7 cartões vencidos · [Revisar]               │
└──────────────────────────────────────────────┘
```

- **"Começar aula"** reaproveita `SessionStarter` (`components/start-session.ts`) com `graphContext`, o mesmo caminho do seletor de proposições da Home (`home.tsx`, `begin()`).
- **Mini-DAG** de pré-requisitos: reaproveitar `PlanDiagram` (`components/plan-block.tsx`, dagre-d3-es), que já renderiza DAGs pequenos com nó em destaque.
- **Vídeos no Electron:** um `iframe` de `youtube-nocookie.com` não aciona `will-navigate` da janela principal. Porém o *permission handler* do Electron nega tudo fora da origem local (`electron/main.cjs:312+`), então tela cheia e autoplay de terceiros podem precisar de exceção explícita. Cliques "abrir no YouTube" vão para `shell.openExternal`, que já é o comportamento atual. Use thumbnails estáticas e carregue o player só ao clicar (o padrão *lite embed*).
- **No chat:** um chip "Recursos" (ícone `book`) ao lado do chip "Plan" abre o mesmo painel como overlay de sessão (o idiom de `components/session-overlay.tsx`).

### 6.5 Fim de sessão (flashcards e XP)

- O plugin **Flashcards** já existe: FSRS-6, `ctx.registerView('library')` e ação na barra lateral. Hoje é "Native only; no Anki integration".
- Proposta: um **card de encerramento** no fim do transcript (no estilo `practice-cards.tsx`, `rounded-xl border bg-card p-4`) com:
  - XP ganho;
  - cartões gerados, com os botões "Revisar agora", "Exportar para Anki" e "Obsidian";
  - o próximo nó sugerido.
- A exportação para Anki ou Obsidian é de outro relatório.

### 6.6 Ganchos de UI para uma didática "não cansativa"

- O `DockOverlay` já separa leitura (transcript) de interação (dock). Para evitar "explica rápido e despeja perguntas", a UI pode:
  - mostrar explicações em **blocos com "Continuar ▸"**, com a pergunta aparecendo no dock só quando o aluno avança;
  - usar o `PlanMarginalia` como indicador de ritmo;
  - adiar perguntas com o "Thinking while reading" que já existe.
- Isso depende do prompt e do agente, mas o espaço de UI já está lá. Mantenha os textos de UI curtos, sem "ajuda" em parágrafos.

---

## 7. (f) Capacidade do graph-view e alternativas

### 7.1 Como funciona hoje

| Etapa | Implementação | Complexidade / custo |
|---|---|---|
| Dados | `GET /api/graph`: snapshot inteiro (nós, arestas derivadas, `logicalEdges`, `impLinks`, clusters) | O(N) de JSON por fetch; refetch em eventos `lh:graph-revision` e SSE |
| Layout | servidor: settle incremental no merge, com posições num ledger; cliente: `incrementalLayout` **síncrono** em `useEffect` se o ledger faltar | d3-force: Barnes–Hut O(N log N) por tick × centenas de ticks; bloqueia a main thread |
| Física ao vivo | `createGraphSimulation` com **todos os nós** a cada frame enquanto se arrasta (`advanceSim`) | O(N log N) por frame |
| Geometria | `buildGeometry`: 1 `Path2D` de nós, 1 de hastes, 1 de pontas; `measureText` e quebra de rótulo por nó | O(N) por mudança, não por frame |
| Regiões | `buildRegions`: bitmap de densidade (≤512px), box blur pré-multiplicado, upscale | O(N + pixels); na física ao vivo, só a cada 3 frames |
| Desenho | 1 `fill` de nós, 1 `stroke` de arestas, **rótulos de todos os nós visíveis por filtro** (`fillText` por linha, **sem culling de viewport**), hover e rótulos de região | `fillText` domina: ~2·N chamadas quando há zoom |
| Picking | `pickAt` monta um array projetado com **todos** os nós a cada `pointermove` e depois `pickNearest` linear | O(N) com alocação por evento. O comentário diz que "a spatial grid only earns its keep past ~10k nodes" |
| Loop | 1 rAF com *dirty flag*; CPU zero em repouso | excelente |
| Câmera | d3-zoom (`screen = world·k + [x,y]`), persistida por aparelho | — |

O comentário de arquitetura (`graph-canvas.ts:12`) declara a escala-alvo: "338 → low thousands of nodes".

### 7.2 Onde quebra para um currículo de ~1000–1500h

Hipótese de tamanho: domínio → 10–30 subdomínios → 100–400 módulos → 2k–8k conceitos → 10k–40k micro-habilidades. Com vários domínios, isso vai de dezenas de milhares a 100k nós somados.

As ordens de grandeza abaixo são **estimativas** para Canvas 2D no Chromium; meça com o harness de 7.5.

| Item | ~2k nós | ~10k nós | ~50k nós |
|---|---|---|---|
| `fill` de um `Path2D` de discos | <1 ms | 1–3 ms | 5–15 ms |
| `stroke` de arestas (≈1,5·N) | <1 ms | 2–5 ms | 10–25 ms |
| `fillText` de todos os rótulos (2 linhas) | 4–10 ms | 20–60 ms (**estoura 16 ms**) | inviável |
| Física ao vivo ao arrastar (todos os nós) | ok | 5–15 ms por tick (engasga) | inviável |
| Layout síncrono no cliente (300 ticks) | ~0,3–1 s | vários s (congela) | inviável |
| JSON do snapshot | ~1 MB | ~5 MB | ~25 MB+ |

### 7.3 Arquitetura proposta: hierarquia, LOD semântico, culling e carregamento por região

1. **Modelo hierárquico**: cada nó tem `level` (0 = domínio, 1 = subdomínio/região, 2 = módulo, 3 = conceito, 4 = micro-habilidade), `parentId`, `prereqs[]`, `estHours`, `state` e `regionId`.
2. **Layout pré-computado no servidor** (Worker thread), **aninhado**:
   1. ilhas das regiões: força entre metanós com raio proporcional a √horas mais colisão (`forceCollide`);
   2. dentro de cada região, os filhos com `forceX/Y` para o centro da região, colisão e âncora de profundidade **radial** (já existe: `DepthAnchor` em `src/core/layout.ts`).

   As posições vão para o ledger por nível. A expansão procedural (IA criando nós) usa o padrão "o layout evolui": cada nó novo nasce perto do pai e dos pré-requisitos e fica ancorado, sem reembaralhar o resto.
3. **LOD semântico pela razão de zoom** (`zoomRatioOf`):
   - L0: só ilhas (d3-contour cel), rótulo e badge de nível; ≤50 itens.
   - L1: módulos e **arestas agregadas** entre módulos (largura proporcional à contagem); ≤500.
   - L2: conceitos na viewport.
   - L3: micro-habilidades e rótulos completos perto do cursor.

   As transições de opacidade reaproveitam `labelAlpha` e `LABELS_FADE_RATIO`.
4. **Colapso e expansão por região** (foco mais contexto): clicar numa ilha dá zoom e expande só ela; as outras ficam como metanós. A seleção persiste em `data-*` por domínio.
5. **Índice espacial**: grade uniforme (célula ≈ 2× espaçamento) reconstruída em `buildGeometry`. `visibleIds(viewportRect)` alimenta os paths, que passam a ser **por tile de grade** com cache por versão. O `pickAt` passa a consultar só as células vizinhas e deixa de alocar por evento. d3-quadtree (ISC) é uma alternativa.
6. **Orçamento de rótulos**: no máximo ~200–300 por frame, por prioridade (nó atual > próximo passo > pontos fracos > hover > área da região), com **anti-colisão** numa grade de ocupação em espaço de tela. Opcional: cache de rótulos rasterizados (`OffscreenCanvas` ou `ImageBitmap` por nó e faixa de zoom, com LRU).
7. **Física ao vivo só local**: ao arrastar, simular apenas o nó, seus vizinhos e a região (subgrafo). O resto fica fixo (`fx/fy`).
8. **Dados por região**: `GET /api/curriculum?domain=&level<=1` (sempre) e `GET /api/curriculum/region/:id` (ao expandir), com ETag ou `graphRevision`. O SSE avisa invalidação por região.
9. **Ícones nos nós**: atlas de `ImageBitmap` do sprite (5.2), desenhado só em L2/L3 e só para nós visíveis.

Com isso, cada frame desenha no máximo ~3–8k primitivas mesmo com 100k nós no domínio. Canvas 2D aguenta isso com folga e mantém o visual cel (strokes e `Path2D`) simples.

### 7.4 Alternativas WebGL/GPU (estado em nov/2026)

| Opção | Licença | Estado atual | Pontos fortes | Pontos fracos para nós |
|---|---|---|---|---|
| **Canvas 2D próprio** (atual, com 7.3) | — | em produção no repo | loop único, zero dessincronia, cel trivial (stroke e `Path2D`), já testado | teto de ~10–20k primitivas por frame; texto caro |
| **sigma.js v4** | MIT | docs em sigmajs.org mostram **v4.0.6**; prereleases 4.0.0 em abr/2026 | WebGL2; estilos **declarativos**; formas SDF; camadas de borda (`@sigma/node-border`, bom para contorno cel); *depth layers*; segundo os anúncios, rótulos migraram para WebGL com SDF | requer graphology; o repo **já saiu do sigma** por dessincronia das regiões (canvas externo); regiões cel precisariam de programa ou camada custom; API v4 recente |
| **PixiJS v8** | MIT | v8 estável (WebGL e WebGPU) | cena 2D genérica de alto desempenho (benchmark oficial: 100k sprites com ~15 ms CPU / ~2 ms GPU); sprites de ícones SVG, contornos e filtros; ótimo para "skill tree" estilizada | não é biblioteca de grafo: culling, picking, rótulos e LOD ficam por nossa conta (as mesmas peças de 7.3) |
| **cosmos.gl** (ex-@cosmograph/cosmos) | MIT; projeto na OpenJS Foundation | v3: renderização via luma.gl (WebGL2), init assíncrono, força de colisão em GPU | **força e render na GPU** para centenas de milhares a ~1M de pontos; API de clusters (`setPointClusters`) | **sem rótulos embutidos** (só posições amostradas para overlay); estética de "nuvem de pontos"; o app Cosmograph tem licenciamento próprio (planos Free/Pro/Team desde jul/2026), não confundir com a lib |
| **deck.gl / luma.gl** (luGraph) | MIT | luGraph **experimental** (demo com ~1M vértices e ~2M arestas) | escala extrema; WebGPU em evolução | pesado; API experimental; estética de mapa de dados |
| **@xyflow/react** (React Flow) | MIT | 12.11.x (release de performance em jul/2026) | nós são componentes React; ótimo para **edição** de subgrafos pequenos; `onlyRenderVisibleElements` | DOM por nó: confortável até centenas, difícil acima de ~1–2k; **já está no package.json sem uso** |
| **cytoscape.js** | MIT | maduro (o DeepTutor usa 3.33) | rica em layouts e análise | Canvas/DOM; desempenho parecido com o nosso renderer, sem ganho real |
| GraphWaGu (acadêmico, WebGPU) | — | pesquisa | 100k nós e 2M arestas a ≥10 fps | não é produto |

### 7.5 Recomendação e critério de troca

- **Fase 1 (agora):** manter o Canvas 2D e implementar 7.3. Ganhos: LOD, culling, orçamento de rótulos, layout no servidor ou Worker e carga por região. Isso se encaixa na filosofia do código ("dumb draw function" com dados prontos) e no visual cel.
- **Harness de benchmark** (antes de decidir qualquer troca):
  - uma página de dev ou teste que gere grafos sintéticos (2k, 10k, 50k, 100k) com hierarquia;
  - medir ms por frame em pan e zoom, tempo de `buildGeometry` e de regiões, e memória;
  - rodar no Electron real em hardware de referência (iGPU).

  Os testes de `tests/graph-canvas.test.ts` cobrem só funções puras.
- **Critério de troca para WebGL:** se, com LOD, o p95 de frame passar de 16 ms em L2 com mais de 15k primitivas visíveis, trocar **só o backend de desenho** atrás de `CanvasData`:
  - **PixiJS v8** se a prioridade for o visual cel e ilustrado (sprites, contornos, partículas de XP);
  - **sigma.js v4** se a prioridade for interação de grafo pronta (picking e estilos por estado).
- **cosmos.gl** só para um modo opcional de "galáxia analítica" (ver todos os nós de um domínio de uma vez, sem rótulos).
- **@xyflow/react:** usar apenas para editores pequenos, como curadoria manual de pré-requisitos de uma região; caso contrário, remover a dependência.

---

## 8. Componentes a reutilizar

### 8.1 Reutilizar **sem mudança** (só herdam tokens)

- **Infraestrutura de interação:**
  - `components/interaction-layers.tsx`, `host-dialog.tsx`, `menu-shell.tsx`;
  - `popover-dismiss.ts`, `backdrop-dismiss.ts`, `focus-hygiene.ts`, `field-cycle.ts`, `enter-submits.ts`;
  - `host-content-root.tsx`, `plugin-surfaces.tsx`, `plugin-surface-targets.ts`.
- **Dados, eventos e sessão:**
  - `components/server-events.tsx`, `session-core.ts`, `session.ts`, `session-view-readers.ts`, `jobs-context.ts`, `settings-signal.ts`, `start-session.ts`, `opening-prompt.ts`.
- **Transcript e markdown:**
  - `ai-elements/conversation.tsx`, `ai-elements/message.tsx`, `ai-elements/reasoning.tsx`;
  - `md-blocks.tsx`, `host-markdown.tsx`, `mermaid-render.ts`, `latex-glyph.tsx`;
  - `citation-*`, `selection-*`, `session-find*.tsx`.
- **Entrada:** `path-input*.tsx`, `file-path-*.tsx`, `attach-files-button.tsx`, `dictation*.tsx`, `composer-actions.tsx`, `enter-submits.ts`.
- **Chrome:**
  - `top-bar.tsx` (lei do dono: usar sempre);
  - `SidebarProvider` e `SidebarToggle` (`sidebar.tsx`);
  - `keyboard-shortcuts.tsx` (só estender o registro);
  - `update-banner.tsx`, `braille-spinner.tsx`.
- **Settings:** `settings/controls.tsx` (`SettingsRow`, `Toggle`, `CommitInput`, `SettingsSlider`), `settings/settings-dialog.tsx` (adicionar seções), `settings/model-menu.tsx`, `model-picker.tsx`, `usage-format.ts`.
- **Grafo e plano (lógica pura):**
  - `graph-canvas.ts`: `fitTransform`, `zoomRatioOf`, `labelAlpha`, `arrowGeometry`, `wrapRegionLabel`, `boxBlurRound`, câmera d3-zoom, loop com *dirty flag*;
  - `src/core/layout.ts` (`inferenceDepths`, `createGraphSimulation`, `incrementalLayout`, `DepthAnchor`);
  - `plan-block.tsx` (`PlanDiagram`/dagre, para DAGs locais);
  - `chain-table.tsx` e `tree-presentation.tsx` (visão Chains);
  - `cluster-geometry.ts` (`clusterHue`).
- **Plugins:** todo o host (`plugin-*.tsx/.ts`, `plugins.tsx`, `plugin-view.tsx`). Profile e Mapa poderiam até ser *plugin views*, mas recomendo núcleo (`/profile`), por depender de dados de todos os domínios.
- **Primitivas UI:** `ui/tooltip.tsx`, `ui/hint.tsx`, `ui/input.tsx`, `ui/textarea.tsx`, `ui/separator.tsx`, `ui/collapsible.tsx`, `ui/button-group.tsx`, `ui/status-badge.tsx`, `ui/glyph-mark.tsx`.

### 8.2 Reutilizar **com mudança pequena**

| Componente | Mudança |
|---|---|
| `ui/button.tsx` | variante `default` com `.cel-gloss .cel-press` quando `data-skin=cel`; `destructive` sem `text-white` fixo |
| `stats-bar.tsx` | slot de XP da sessão; linha de XP no popover |
| `graph-view.tsx` | modo Currículo/Conhecimento; leitura dos tokens cel; painel de recursos no lugar do card; chave de câmera por domínio |
| `graph-canvas.ts` | caminho cel (4.6), culling, LOD e orçamento (7.3), picking por grade |
| `confidence-rail.tsx` | cores via tokens |
| `plan-block.tsx` | brilho sem blur no modo cel |
| `chat.tsx` (DockOverlay e TopBar) | faixa sem degradê; chips de Recursos e *breadcrumb* |
| `home.tsx` e `new-session.tsx` | botão com `rounded-[calc…]`; chip de domínio no header |
| `sidebar.tsx` | `DomainSwitcher` e `ProfileChip` |
| `settings/theme-cards.tsx` e `appearance-section.tsx` | miniatura e controles de skin |
| `lh-mark.tsx` | versão desenhada à mão (opcional) |
| `minimal-home.tsx` | vira o "data view" leve (resumo por domínio) se o dono quiser |

---

## 9. Riscos, pendências e perguntas ao dono

O `AGENTS.md` do repo diz "No guessing": decisões de design são do dono. Antes de implementar, confirme:

1. **Escopo do cel:** cel **substitui** o visual atual (preset padrão) ou é **um skin a mais** (presets "Cel Dia" e "Cel Noite")? Recomendo skin a mais, com padrão cel no fork.
2. **Fontes do chrome:** manter JetBrains Mono em caixa alta ou trocar por uma sans arredondada (OFL) no skin cel? E manter CMU Serif nos títulos?
3. **Domínio:** a troca de domínio é por cookie com rotas intactas (recomendado) ou por prefixo de rota `/d/[domain]/…`?
4. **Perfil:** `/profile` como página (recomendado) ou mais uma seção do modal de Settings?
5. **Home:** o mapa do currículo vira a visão padrão da Home, com o grafo de proposições como camada (recomendado), ou ganha uma rota própria `/map`?
6. **Ícones:** quem desenha (designer, IA de imagem mais vetorização manual, ou base CC0 ajustada)? Quantos estilos (regular e bold)? O "boil" animado é desejado?
7. **Dependências mortas:** remover `@xyflow/react`, `next-themes`, `embla-carousel-react`, `cmdk` e `media-chrome`? Confira antes se algum plugin as usa em runtime.
8. **Testes de render:** vários `tests/render-*.test.tsx` comparam strings de classe. A extração de `SURFACE.*` e os botões cel exigem atualizá-los.
9. **Plugins:** o CSS do Flashcards usa raios e cores próprios. Vale definir um contrato de tokens públicos para plugins (`--lh-radius-*`, `--lh-stroke`, `--lh-ink`) em `docs/plugin-authoring.md`?
10. **Referência quebrada:** `docs/research/graph-rendering.md` é citado no código mas não existe. Recriar ou atualizar os comentários.

---

## 10. Fontes

**Código:**
- `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `app/chat/*`, `app/settings/page.tsx`, `app/plugins/*`, `app/api/themes/*`
- `components/{home,minimal-home,sidebar,top-bar,graph-view,graph-canvas,cluster-geometry,stats-bar,chat,composer,question-dock,practice-dock,plan-window,plan-block,lh-mark,confidence-rail,plugin-chrome,plugin-ui-host,plugin-view}.tsx/.ts`
- `components/ui/*`, `components/settings/{appearance,appearance-section,theme-cards,settings-dialog}.tsx`
- `src/core/themes.ts`, `src/store/themes.ts`, `src/server/theme-boot.ts`, `src/core/layout.ts`, `src/core/keyboard.ts`, `src/core/contracts/chat.ts`, `src/core/cost-summary.ts`, `src/core/plugin-ui.ts`, `src/core/plugins.ts`
- `config.ts`, `electron/main.cjs`, `components.json`, `postcss.config.mjs`, `package.json`, `AGENTS.md`

**Documentação do repo:** `docs/themes.md`, `docs/keyboard.md`, `docs/dialog-overlay-contract.md`, `docs/plugin-architecture.md`, `docs/plugin-authoring.md`.

**Imagens:** `docs/assets/knowledge-graph.png`, `docs/assets/teaching-session.png`, `docs/assets/lh_banner_dark.png`.

**Verificação local:** compilação de `shadow-*`, `rounded-*`, `backdrop-blur*`, `border` e `@utility border` com `tailwindcss` 4.3.3 do projeto, num diretório temporário (sem tocar no repo).

**Referências em `_refs/`** (só leitura):
- `DeepTutor/web/components/space/learning/LevelUpCelebration.tsx` (Apache-2.0)
- `BloomTutor/frontend/src/components/me/activity-stats.tsx` (MIT)
- `open-mastery/web/skilltree/index.html` (árvore em SVG; o diretório `graph/` é CC-BY-SA 4.0)
- `OpenMAIC/components/ai-elements/*` (usa @xyflow/react; MIT)

**Externas:**
- sigma.js v4: [migração v3→v4](https://www.sigmajs.org/how-to/technical/migration-v3-v4/), [site v4](https://v4.sigmajs.org/), [sigmajs.org](https://sigmajs.org)
- cosmos.gl: [repo cosmosgl/graph](https://github.com/cosmosgl/graph), [OpenJS: Introducing cosmos.gl](https://openjsf.org/blog/introducing-cosmos-gl), [Cosmograph: What's new](https://cosmograph.app/docs-general/whats-new/), [Cosmograph: licenciamento](https://classic.cosmograph.app/docs/cosmograph/Citing%20and%20licensing)
- PixiJS: [v8 beta (benchmarks)](https://pixijs.com/blog/pixi-v8-beta), [v8 launch](https://pixijs.com/blog/pixi-v8-launches), [GraphAware: D3 com PixiJS e LOD](https://graphaware.com/blog/scale-up-your-d3-graph-visualisation-webgl-canvas-with-pixi-js/)
- React Flow: [performance](https://reactflow.dev/learn/advanced-use/performance), [What's new 2026-07-06](https://reactflow.dev/whats-new/2026-07-06), [API ReactFlow](https://reactflow.dev/api-reference/react-flow)
- luma.gl / deck.gl: [luGraph](https://luma.gl/next/docs/api-reference/experimental/lugraph), [deck.gl](https://deck.gl/)
- GraphWaGu: [EVL UIC](https://www-new.evl.uic.edu/documents/pacificvisgraphwagu.pdf)
- Next 16, Turbopack e SVGR: [turbopack config](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack), [upgrade v16](https://nextjs.org/docs/app/guides/upgrading/version-16)
- Ícones desenhados à mão: [Doodle Icons (listagem)](https://community-en.eagle.cool/resource/doodle-icons-khushmeen), [Open Doodles](https://www.opendoodles.com/about), [Iconoodle](https://gh.r-mj.com/NK2552003/Iconoodle)
