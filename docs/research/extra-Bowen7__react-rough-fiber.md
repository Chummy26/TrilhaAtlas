# extra-Bowen7__react-rough-fiber: renderer React "hand-drawn" via rough.js

> Análise do repositório `Bowen7/react-rough-fiber`, clonado em
> `_refs/extra/Bowen7__react-rough-fiber` (commit `f3a6158`, 2025-04-28, "Bump version").
> Data da análise: 2026-11-18. Nada do repositório foi executado (sem install, build ou testes).
> Todos os caminhos `src/...` abaixo são relativos a
> `_refs/extra/Bowen7__react-rough-fiber/packages/react-rough-fiber/`.

---

## 0. Resumo executivo

- **O que é:** um *custom renderer* React (`react-reconciler`) com cerca de **1.033 linhas de TS**. Tudo o que é renderizado dentro de `<RoughSVG>` passa por esse renderer, e cada `path/circle/ellipse/rect/line/polygon/polyline` vira um `<g data-rrf-group>` com 1 a 3 `<path>` gerados pelo `RoughGenerator` do rough.js. Licença **MIT** (Bowen, 2023), com `props.ts` derivado do Preact (MIT, Jason Miller). **É compatível com AGPL-3.0.**
- **Estado em 2026-11:** o projeto está **parado**. O último commit e o último release (npm `0.0.8`) são de 2025-04-28, e há 3 issues abertas. A issue **#15** (2026-11-04) mostra **crash com React 19.3 + react-reconciler 0.34**: `resolveEventTimeStamp is not a function` e `trackSchedulerEvent is not a function`. O host config não implementa as funções que o reconciler passou a exigir no React 19.1/19.2/19.3.
- **Achado crítico para o LH:** o `package.json` declara React `19.2.8`, mas o **Next 16.4.3 (App Router) usa o React interno `19.3.0-canary-278794d7-20261002`** (`node_modules/next/dist/compiled/react`). Em componentes cliente, o reconciler teria de ser da linha **0.34** (peer `react ^19.3.0`), justamente a combinação que quebra. **Não dá para usar o pacote npm como está.** Seria preciso fazer um fork vendorizado com o host config atualizado.
- **Segundo achado crítico:** a premissa "nós do React Flow que o LH já usa" não se confirma. `@xyflow/react` está no `package.json`, mas **não é importado em nenhum lugar** (mesmo achado de `docs/research/lh-ui-theme.md`). O grafo do LH é um **renderer Canvas 2D próprio** (`components/graph-canvas.ts`, `GraphCanvasRenderer.buildGeometry()` com um `Path2D` para todos os nós). Um renderer SVG não se aplica ali. O que se aproveita é o **algoritmo** (forma → `RoughGenerator` → paths), aplicado a `Path2D`.
- **Recomendação:** **não adotar o renderer como dependência.** Extrair o núcleo puro (`getDrawable` + `normalizePathInfo` + `parsePoints`, uns 120 linhas) para `lib/sketch/rough-core.ts`, sem DOM e determinístico com `seed`. Esse núcleo atende três usos:
  1. um **script de build** Lucide → ícones *sketchy* estáticos. Não precisa do svg2roughjs para o Lucide, porque os 2.034 ícones usam só as 7 formas primitivas e **zero `transform`**;
  2. **primitivas React SSR-safe** (`<SketchRect>`, `<SketchPath>`…) para `plan-block.tsx`, cards e badges;
  3. **cache de `Path2D` rough** no `graph-canvas.ts`.

  O `RoughSVG` vendorizado (com host config para reconciler 0.34) fica como opcional, só para envolver SVG de terceiros que não controlamos (gráficos de stats).
- **Armadilhas que o pacote original esconde:**
  - ignora `rx/ry` de `<rect>`: 398 retângulos arredondados do Lucide perderiam os cantos;
  - o parser `path-data-parser@0.1.0` não lê flags de arco compactas (`a2 2 0 001…`), o que afeta 49 módulos de ícone Lucide, entre eles `book-open`; o projeto só funciona por causa de um *patch* pnpm;
  - o truque de cor via CSS var não funciona com `fill` vindo de classes (Tailwind);
  - `markerEnd` vai parar no `<g>`, e as setas somem;
  - cria **um reconciler inteiro por `<RoughSVG>`**;
  - passa `onCaughtError = null` ao `createContainer`.

---

## 1. Identificação e licença

| Item | Valor |
|---|---|
| Repo | https://github.com/Bowen7/react-rough-fiber |
| Commit clonado | `f3a6158675954db00a6857d40aaf3d3e9e5fa5f2` (2025-04-28 22:48 +0800) |
| npm | `react-rough-fiber@0.0.8` (latest, 2025-04-28). 20 versões no total, `next` = `0.0.7-experimental-b6e7f96` |
| peerDeps | `react >=17`, `react-dom >=17`, `react-reconciler >=0.26.2` (sem teto, e isso causa o #15) |
| deps | `its-fine ^1.2.5` (a 1.x é a linha React 18; para React 19 use `its-fine@2.1.1`) |
| rough.js | **devDependency** `roughjs@4.5.2` + patch → o `tsup` *embute* o rough.js patchado no `dist` |
| Licença | MIT ("Copyright (c) 2023 Bowen"), em `LICENSE` na raiz. `src/props.ts` tem cabeçalho MIT do Preact ("Copyright (c) 2015-present Jason Miller") |
| Docs | https://react-rough-fiber.amind.app/ (Nextra 2.4 / Next 13) e o blog https://www.bowencodes.com/post/react-rough-fiber |
| Issues abertas | #15 "How can I use it in react19" (2026-11-04), #6 "remote SVG cannot be animated" (2024-05), #4 "Crash on using LineRadial" (2024-05) |

**Compatibilidade com AGPL-3.0:** MIT e ISC são permissivas e compatíveis com GPL/AGPL. A única obrigação é **preservar os avisos de copyright e permissão** nos arquivos copiados e nos *notices* da distribuição. Itens a listar em `THIRD_PARTY_NOTICES` (ou equivalente) ao portar:

| Componente | Licença | Copyright a preservar |
|---|---|---|
| react-rough-fiber (shape/renderer/utils/constants) | MIT | Bowen 2023 |
| `props.ts` (diffProps do Preact) | MIT | Jason Miller 2015-present |
| patch do `path-data-parser` (parser em máquina de estados ao estilo SVGO) | MIT (path-data-parser: Preet Shihn) | se copiar o parser, citar path-data-parser/SVGO |
| roughjs 4.6.6 | MIT | Preet Shihn 2019 |
| Lucide (ícones derivados) | **ISC** + MIT (ícones vindos do Feather, Cole Bemis) | "Lucide Icons and Contributors" + Cole Bemis. Copiar `node_modules/lucide-react/LICENSE` |
| its-fine, react-reconciler | MIT | pmndrs / Meta |
| svg2roughjs 3.2.3, rough-notation 0.5.1, perfect-freehand 1.2.3, svgpath 2.6.0 | MIT | autores respectivos |

---

## 2. Estrutura do repositório

```
packages/react-rough-fiber/
  src/index.tsx        3   exports: RoughSVG, WCRoughSVG, tipos
  src/roughSVG.tsx    43   componente: container + root do reconciler
  src/context.tsx     21   WCRoughSVG (its-fine bridge de contexto)
  src/renderer.ts    204   host config do react-reconciler   ← núcleo do renderer
  src/props.ts       398   normalizeProps/diffProps/setProperty (Preact)  ← mapeamento de props
  src/shape.ts       166   getDrawable/normalizePathInfo/diffShape  ← mapeamento para o rough.js
  src/constants.ts    66   SVG_SHAPE_MAP, regex de camelCase, CSS vars
  src/types.ts        97   SVGShape, Options, HostConfig
  src/utils.ts        35   shallowEqual, parsePoints, isReact19
  src/__tests__/*   1308   vitest + jsdom + @testing-library/react (8 arquivos)
  tsup.config.ts           esm+cjs, platform browser, dts
patches/roughjs@4.5.2.patch          PathInfo.type + fixedDecimalPlaceDigits=3
patches/path-data-parser@0.1.0.patch parser robusto (flags de arco compactas)
apps/docs/                           site Nextra com demos (ícones, recharts, visx, d3-tree, texto, playground)
```

CI (`.github/workflows/pr.yml`): testa com React 18 e depois com `react@19.0.0 + react-reconciler@0.31.0`. **19.1, 19.2 e 19.3 nunca foram testados.**

---

## 3. Arquitetura

```
<RoughSVG options containerType="div" ...rest>         (react-dom)
   └─ <div ref>  ← container DOM real, vazio no SSR e no primeiro paint
        useEffect: reconciler.createContainer(div, LegacyRoot, ...)
                   reconciler.updateContainer(children, root)
           │
           ▼   (renderer secundário: isPrimaryRenderer=false, supportsMutation=true)
   host config (src/renderer.ts)
     createInstance(type)                       ← <svg>, <g>, <div>… criados de verdade
       ├─ SVG shape fora de <defs> → <g data-rrf-group>   (wrapper)
       └─ resto → createElementNS / createElement
     finalizeInitialChildren / commitUpdate → diffProps(type, el, newProps, oldProps, optionsRef.current)
           │
           ▼  (src/props.ts)
     normalizeProps → [domProps, shapeProps]
       ├─ domProps: camelCase→kebab, eventos, class/className, style (+ CSS vars de fill)
       └─ shapeProps: {type, geometria, fill, stroke, fillOpacity}
     diffShape(g, prevShape, nextShape, props, options)  (src/shape.ts)
       ├─ memo: shallowEqual(prevShape,nextShape) && shallowEqual(prevOpts,nextOpts) → return
       ├─ new RoughGenerator(); getDrawable(); generator.toPaths()
       └─ reconcilia os <path> filhos do <g> in place (diffNormalizedProps)
     diffNormalizedProps(g, prevDomProps, nextDomProps) → setProperty (estilo Preact)
```

Decisões de design, segundo o blog do autor:

1. Um renderer em vez de pós-processar o DOM: varrer `children` quebra com `memo` e atualizações de estado, e um DOM falso via Proxy redesenharia a cada atributo. O reconciler junta as mudanças de props em **um** redesenho por commit.
2. Para a cor do preenchimento hachurado, ele testou HostContext, `<defs>` patterns e um fill geométrico, e ficou com **CSS custom properties**, que só funcionam com `fill` **inline** (atributo ou `style`), nunca com `fill` vindo de CSS.

---

## 4. API pública

```tsx
import { RoughSVG, WCRoughSVG, type RoughOptions, type Options, type SVGShape } from "react-rough-fiber";

<RoughSVG containerType="div" options={opts} className="..." /* ...HTMLAttributes do container */>
  <svg viewBox="0 0 24 24">…</svg>   {/* qualquer árvore React; HTML também é aceito */}
</RoughSVG>
```

- `containerType?: string = "div"`: tag do container criado com `react-dom`.
- `options?: Options`, em que `Options = RoughOptions | ((shape: SVGShape, props: HTMLAttributes<SVGElement>) => RoughOptions)`. A forma de função permite **opções por forma**, por exemplo `fill:'none'` só para `path` (demo `react-d3-tree`), `fillStyle:'solid'` só para um `rect` 20×20 (teste), ou `hachureAngle` aleatório por estado (demo `visx`).
- `WCRoughSVG`: mesma API, embrulhada em `FiberProvider` + `useContextBridge` (its-fine). É necessário porque **contexto React não atravessa renderers** (react#17275).
- Tipo `SVGShape` (`src/types.ts`): união discriminada `path{d} | circle{cx,cy,r} | line{x1,y1,x2,y2} | rect{x,y,width,height} | ellipse{cx,cy,rx,ry} | polygon{points:string} | polyline{points:string}`.

### 4.1 Opções do rough.js que importam (wiki rough-stuff/rough; defaults do `RoughGenerator` 4.6.6)

| Opção | Default 4.6.6 | Efeito / uso sugerido no LH |
|---|---|---|
| `roughness` | 1 | 0 = forma perfeita. Ícones 24px: 0,4–0,9. Molduras de card: 0,8–1,5 |
| `bowing` | 1 | curvatura das retas. As demos de ícones usam 15 (exagero proposital) |
| `seed` | 0 (= `Math.random`) | 1…2³¹−1. **Sempre definir** para estabilidade, SSR e teste |
| `strokeWidth` | 1 | **não** é lido das props SVG pelo RRF (ver §5.4) |
| `fillStyle` | `hachure` | `solid`, `zigzag`, `cross-hatch`, `dots`, `dashed`, `zigzag-line` |
| `fillWeight` | −1 (→ strokeWidth/2) | espessura das hachuras. Diâmetro no estilo `dots` |
| `hachureAngle` / `hachureGap` | −41° / −1 (→ 4×strokeWidth) | densidade da hachura |
| `disableMultiStroke` / `disableMultiStrokeFill` | false | `true` = 1 traço só (mais limpo, menos "lápis") |
| `preserveVertices` | false | `true` mantém as extremidades fixas (bom para conectores e setas) |
| `curveStepCount` / `curveFitting` | 9 / 0,95 | qualidade de círculos e elipses |
| `simplification` | 0 | 0–1, simplifica paths complexos |
| `strokeLineDash(+Offset)` / `fillLineDash(+Offset)` | — | tracejado. O RRF aplica `stroke-dasharray` só no path de contorno |
| `dashOffset`, `dashGap`, `zigzagOffset` | −1 | parâmetros dos fillStyles `dashed` e `zigzag-line` |
| `fixedDecimalPlaceDigits` | — | **existe em `Options` 4.6.6**, mas `toPaths()` não o usa (ver §6) |
| `fillShapeRoughnessGain` | 0,8 | novo na 4.6: aspereza extra do preenchimento sólido |

---

## 5. Algoritmos-chave (com trechos curtos)

### 5.1 `createInstance`: toda forma vira um grupo (`src/renderer.ts` L26–46)

```ts
if (namespace === SVG_NAMESPACE || type === 'svg') {
  if (!inDefs && type in SVG_SHAPE_MAP) {
    domElement = ownerDocument.createElementNS(SVG_NAMESPACE, 'g')
    domElement.setAttribute(DATA_RRF_GROUP, '')
  } else { domElement = ownerDocument.createElementNS(SVG_NAMESPACE, type) }
} else { domElement = ownerDocument.createElement(type) }
```

- `getChildHostContext` (L99–111) propaga `{namespace, inDefs}`. `svg` → namespace SVG, `foreignObject` → HTML, `defs` → `inDefs=true`. Formas dentro de `<defs>` (clipPath, marker, pattern) ficam **lisas**, o que está certo.
- `getPublicInstance` (L149–157): o `ref` de uma forma devolve o **primeiro `<path>` filho** do grupo (teste `ref.test.tsx`), não um `SVGRectElement`.

### 5.2 Separar props de DOM e props de forma (`src/props.ts` `normalizeProps`, L44–206)

- Atributos geométricos da forma (`d`, `points`, `cx`…) **não vão para o DOM**. Vão para `shapeProps` com coerção `Number(value) || 0` (L66–71). `d` e `points` ficam como string.
- `fill`, `stroke` e `fillOpacity` são **copiados** para `shapeProps` e **também** aplicados ao `<g>` (herança).
- O resto passa pela lógica do Preact: camelCase de atributos SVG → kebab (`CAMEL_PROPS` em `constants.ts`), `onDoubleClick→dblclick`, `onFocus→focusin`, `onBlur→focusout`, `class/className`.
- **Truque da cor de preenchimento** (L162–203): o rough desenha hachuras como **traços** (`stroke`) cuja cor tem de ser a do `fill`, e o fill pode ser herdado de um `<g>` ancestral. A solução:

```ts
// shape default: fill = 'var(--rrf-fill-color)'
// elementos não-forma (svg, g, ...) publicam o fill herdável como CSS var:
if (!fill && type === 'svg') fill = '#000'          // default SVG
if (!isShapeType) {
  normalizedProps.style = { ...normalizedProps.style }
  if (fill) normalizedProps.style['--rrf-fill-color'] = fill
  if (fillOpacity) normalizedProps.style['--rrf-fill-opacity'] = fillOpacity
}
```

  Assim, a hachura de um `<path>` sem `fill` recebe `stroke="var(--rrf-fill-color)"` e herda a cor do ancestral mais próximo que declarou `fill` **como atributo ou `style`**.

### 5.3 `diffShape`: memoização + geração + reconciliação dos `<path>` (`src/shape.ts` L127–166)

```ts
const roughOptions = getRoughOptions(options, nextShapeProps, props)   // aplica a função por forma
if (shallowEqual(prevShapeProps, nextShapeProps) && shallowEqual(prevRoughOptions, roughOptions)) return
domElement._rrf_options = roughOptions
const generator = new RoughGenerator()
const drawable = getDrawable(generator, nextShapeProps, roughOptions)
pathInfos = generator.toPaths(drawable).filter(({ fill, stroke }) => fill !== 'none' || stroke !== 'none')
// depois: para i em 0..max(n_paths, n_children): remove sobras, cria <path> que faltam,
// diffNormalizedProps(child, child._pathProps, normalizePathInfo(pathInfos[i], ...))
```

- A memo é **rasa**. Arrays inline (`strokeLineDash: [5,10]`) ou função de opções que devolve objeto com valores aleatórios **regeneram a cada render**. Sem `seed`, o desenho "ferve" a cada re-render do pai.
- A ordem dos filhos é a do `toPaths`: **fill primeiro, contorno depois** (os testes verificam `children[0]` = fill e `children[1]` = stroke).

### 5.4 Mapeamento PathInfo → atributos (`normalizePathInfo`, L93–117)

```ts
const { type, strokeWidth, fill, ...rest } = pathInfo     // rest = { d, stroke }
if (type === 'fillSketch') {          // hachura/zigzag/dots…: traço colorido com a cor de fill
  pathProps['stroke-opacity'] = fillOpacity || 'var(--rrf-fill-opacity)'
  pathProps['stroke-width']  = strokeWidth                // fillWeight ou strokeWidth/2
  pathProps.fill = fill                                   // 'none'
} else {
  if (type === 'path') { /* stroke-dasharray / stroke-dashoffset a partir de strokeLineDash */ }
  if (fill !== 'var(--rrf-fill-color)') pathProps.fill = fill   // senão: SEM atributo → herda
}
```

- **Herança por ausência de atributo.** No contorno (`type:'path'`), `stroke` é `undefined` quando a forma não tinha `stroke`, então `setProperty` remove o atributo e o `<path>` herda `stroke`, `stroke-width`, `stroke-linecap` etc. do `<g>`/`<svg>`. É por isso que ícones Lucide (`stroke="currentColor" stroke-width=2` no `<svg>`) continuam respondendo a `color` e a classes `text-*`.
- `strokeWidth` do rough (default 1) **é descartado** no contorno, mas **é usado** para a hachura (`fillWeight` padrão = 0,5). A espessura da hachura **não acompanha** o `stroke-width` do SVG, então `fillWeight` precisa ser passado explicitamente.
- Fill sólido (`fillPath`) com fill = CSS var → sem atributo `fill` → herda o `fill` do ancestral.

### 5.5 Elemento SVG → chamada do rough (`getDrawable`, L10–75)

| SVG | Chamada | Observações |
|---|---|---|
| `path d` | `generator.path(d, o)` | usa `path-data-parser`. Com `d` vazio → `null` |
| `circle cx cy r` | `generator.circle(cx, cy, r*2, o)` | o rough recebe **diâmetro** |
| `ellipse cx cy rx ry` | `generator.ellipse(cx, cy, rx*2, ry*2, o)` | idem |
| `rect x y width height` | `generator.rectangle(x, y, w, h, o)` | **`rx`/`ry` ignorados** |
| `line x1 y1 x2 y2` | `generator.line(...)` | sem fill |
| `polygon points` | `generator.polygon(parsePoints(points), o)` | `parsePoints` divide por `/\s+|\s*,\s*/` **sem `trim`** |
| `polyline points` | `generator.linearPath(pts, o)` | fill ignorado pelo rough |

Não suportados (renderizados lisos, como estão): `text`, `image`, `use`, `foreignObject` (vira HTML), gradientes e patterns, que funcionam como *paint server* (`fill="url(#g)"` vira `stroke="url(#g)"` nas hachuras).

### 5.6 Eventos, refs, texto

- Eventos ao estilo Preact: `addEventListener(name, eventProxy)` com tabela `_rrf_listeners[name+useCapture]` e um `e.persist = () => {}` falso. **Não há eventos sintéticos do React**, nem `onChange` com semântica React, nem delegação.
- `value` e `checked` são **ignorados** no diff (L238–240), e `dangerouslySetInnerHTML` é ignorado (L347). **Inputs controlados e HTML bruto não funcionam** dentro de `RoughSVG`.
- Texto: `shouldSetTextContent=false`, mas `diffNormalizedProps` também faz `textContent = children` quando o filho é string ou número. É redundante e funciona.

### 5.7 Root e ciclo de vida (`src/roughSVG.tsx`)

```ts
const [reconciler] = useState(() => createReconciler(optionsRef))   // 1 reconciler POR instância
useEffect(() => {
  if (containerRef.current && !mountNodeRef.current)
    mountNodeRef.current = reconciler.createContainer(containerRef.current, LegacyRoot,
                                                      null, false, false, '', () => {}, null)
  optionsRef.current = options || {}
  if (mountNodeRef.current) reconciler.updateContainer(children, mountNodeRef.current, null)
}, [children, reconciler, options])
```

Problemas:

1. `createReconciler` executa a fábrica inteira do `react-reconciler` (o CJS é `module.exports = function $$$reconciler($$$config){…implementação toda…}`) **para cada `<RoughSVG>`**. Com 50 ícones na tela, são 50 reconcilers.
2. No React 19, `createContainer` tem **11 parâmetros**: `containerInfo, tag, hydrationCallbacks, isStrictMode, concurrentUpdatesByDefaultOverride, identifierPrefix, onUncaughtError, onCaughtError, onRecoverableError, onDefaultTransitionIndicator, transitionCallbacks` (verificado em `ReactFiberReconciler.js@v19.2.0`). O RRF passa 8 argumentos, ou seja, `onCaughtError = null` e `onRecoverableError = undefined`. O resultado é um `TypeError` quando um error boundary dentro do `RoughSVG` captura um erro.
3. `LegacyRoot` virou ConcurrentRoot na prática: `disableLegacyMode = true` em `shared/ReactFeatureFlags.js@v19.2.0`. O `updateContainer` dentro do `useEffect` é **assíncrono**, e o conteúdo aparece um ou mais frames depois do pai. No SSR, o `<div>` sai **vazio** (layout shift).

### 5.8 Patches pnpm (obrigatórios para o comportamento documentado)

- `patches/roughjs@4.5.2.patch`: acrescenta `type: OpSetType` a `PathInfo` (necessário para `normalizePathInfo` distinguir hachura de contorno) e o default `fixedDecimalPlaceDigits: 3` passado para `opsToPath` (paths menores).
- `patches/path-data-parser@0.1.0.patch`: troca o tokenizador por regex por um parser em máquina de estados (`readNumber` com estados `sign/whole/decimal_point/decimal/e/exponent`) que aceita **flags de arco compactas** (`a2 2 0 001…`) e devolve o que conseguiu parsear em vez de lançar exceção.

**No LH sem patch:** o roughjs **4.6.6 já está em `node_modules`** (transitivo via `mermaid@11.17.0`). Ele já tem `opsToPath(drawing, fixedDecimals)` público e `OpSet.type` em `Drawable.sets`, mas o `toPaths()` continua sem `type` e sem casas decimais. O `path-data-parser` instalado é o **0.1.0 sem patch**. Os dois pontos se resolvem sem patch: (a) iterar `drawable.sets` e chamar `generator.opsToPath(set, digits)` nós mesmos; (b) **pré-normalizar `d`** com `svgpath(d).abs().unarc()` (MIT, com tipos), que converte arcos em cúbicas e elimina o problema das flags. Ver §8.1.

---

## 6. Testes do repositório (o que garantem)

`src/__tests__` (vitest + jsdom + Testing Library; `setup.ts` liga `IS_REACT_ACT_ENVIRONMENT`):

- `svg.test.tsx` / `html.test.tsx`:
  - cada forma vira `<g>`;
  - sem fill/stroke inline → 2 paths (hachura `stroke=var(--rrf-fill-color)` + contorno sem `stroke`);
  - `fill="none"` → só o contorno;
  - `stroke="none"` → só a hachura;
  - `style={{fill}}` funciona igual ao atributo;
  - `<svg>` sem fill publica `--rrf-fill-color: #000` e `--rrf-fill-opacity: 1`;
  - `fillOpacity` vira `stroke-opacity` da hachura.
- `props.test.tsx`:
  - `containerType`;
  - mesma `seed` → mesmo `d`;
  - função de opções reavaliada no update (`fillStyle:'solid'` → `fill` sem atributo e `stroke="none"`);
  - `strokeLineDash` → `stroke-dasharray="5 10"`.
- `update.test.tsx`:
  - mudar `fill` para `none` remove um path;
  - mover a elipse regenera;
  - **mudar só `className` NÃO regenera os `d`** (memo).
- `context.test.tsx`: `WCRoughSVG` propaga o contexto.
- `ref.test.tsx`: ref de `<path>` → `path`, ref de `<g>` → `g`.
- `event.test.tsx`: `onClick` em `<button>`.

São bons **casos de teste para portar** para o nosso núcleo (ver §9). O LH usa `node:test` + `renderToStaticMarkup`, sem jsdom (por exemplo `tests/render-plan-block.test.tsx`). As primitivas SSR propostas são testáveis assim. O renderer customizado não é.

---

## 7. Medições no LH (2026-11-18)

| Fato | Evidência |
|---|---|
| React declarado `^19.2.8`, mas runtime App Router = **`19.3.0-canary-278794d7-20261002`** | `node_modules/next/dist/compiled/react/cjs/react.production.js` (`exports.version`), Next `16.4.3` |
| react-reconciler compatível: 0.31→React 19.0, 0.32→19.1, 0.33→19.2, **0.34.0→`react ^19.3.0`** (2026-09-09) | `npm view react-reconciler@x peerDependencies` |
| Host config "geral" obrigatório no reconciler 19.2 inclui `trackSchedulerEvent`, `resolveEventType`, `resolveEventTimeStamp`, `maySuspendCommitOnUpdate`, `maySuspendCommitInSyncRender`, `getSuspendedCommitReason`, `suspendOnActiveViewTransition`, `HostTransitionContext`, `bindToConsole`, `cloneMutableInstance`, `cloneMutableTextInstance`, `rendererPackageName/Version`, `extraDevToolsConfig`, `warnsIfNotActing` | `react-reconciler/src/forks/ReactFiberConfig.custom.js@v19.2.0`. **O RRF não implementa nenhum desses** |
| `enableComponentPerformanceTrack = true` (por isso o crash do #15) | `shared/ReactFeatureFlags.js@v19.2.0` |
| R3F 9.8.2 (2026-10-14) **vendoriza** o reconciler e implementa 87 chaves de host config, inclusive stubs de view transitions e fragments | `pmndrs/react-three-fiber@v9.8.2 packages/fiber/src/core/reconciler.tsx` |
| `@xyflow/react@12.11.3` instalado e **não importado** | grep em `app/ components/ lib/ src/ plugins/` |
| Grafo = Canvas 2D: `GraphCanvasRenderer.buildGeometry()` monta `nodesPath: Path2D` (discos via `arc`) e `shaftsPath/headsPath` | `components/graph-canvas.ts` L1238–1300, `draw()` L1620+ |
| `plan-block.tsx` desenha SVG com `<rect>`, `<path markerEnd>` e cores via **classes Tailwind** (`fill-none stroke-line-strong`) | `components/plan-block.tsx` L528–660 |
| roughjs 4.6.6 + path-data-parser 0.1.0 + points-on-path 0.2.1 já instalados (via mermaid) | `npm ls roughjs` |
| mermaid 11.17 aceita `look: 'classic' \| 'handDrawn' \| 'neo'` e `handDrawnSeed` | `node_modules/mermaid/dist/config.type.d.ts` L76/L81 |
| lucide-react 1.33.0: 2.034 ícones, cada módulo exporta `__iconNode: [tag, attrs][]` | `dist/esm/icons/*.mjs`. O pacote não tem `exports`, então o *deep import* é permitido |
| Elementos no Lucide: path 6032, circle 528, rect 403 (**398 com `rx`**), line 144, ellipse 17, polyline 6, polygon 2. **0 `transform`**, 0 `g/text/use/defs` | grep nos `.mjs` |
| 49 módulos com **flags de arco compactas** (ex.: `a2 2 0 001`, `a41 41 0 000`), incluindo `book-open`, `book-open-text` e `book-open-check` | grep regex nos `.mjs` |
| O LH importa ~45 ícones Lucide distintos (59 nomes com aliases `*Icon`) em 46 arquivos | grep `from "lucide-react"` |

---

## 8. Armadilhas (checklist)

1. **Incompatível com o React do Next 16** como pacote npm. Crash dos stubs ausentes (#15). Em dev (`__PROFILE__`) é certo; em produção é provável, mas não verificado. Pin para `react-reconciler@0.31` só serve para React 19.0, e o App Router usa 19.3 canary.
2. **Um reconciler por instância** (`useState(() => createReconciler(...))`), o que pesa com muitos ícones. Use um reconciler único por módulo, com opções por root (§10, F5).
3. **`onCaughtError = null`** e assinatura de `createContainer` desatualizada.
4. **Conteúdo só depois do effect.** O SSR sai vazio e o primeiro paint fica sem ícone. Se o renderer for usado, use `useLayoutEffect` + `updateContainerSync` + `flushSyncWork`, como o R3F.
5. **Contexto não atravessa** (tema, i18n, `LucideContext`). Requer `WCRoughSVG` com **its-fine 2.x** (o RRF declara `^1.2.5`).
6. **`fill` via classe CSS não alimenta a hachura.** O truque da CSS var só lê `fill` inline. No `plan-block.tsx` (`className="fill-…"`), a hachura sairia preta (`--rrf-fill-color: #000` do `<svg>`). Mitigação: `fill="currentColor"` + `color` via classe (o `currentColor` resolve no paint), ou `style={{ fill: "var(--color-…)" }}`.
7. **`markerEnd`/`markerStart` são aplicados ao `<g>`**, onde markers não valem, e as setas somem. `pathLength` também não é herdado, o que quebra animações de "desenhar" com `stroke-dashoffset`.
8. **`rect rx/ry` ignorados.** Cantos arredondados viram retos (398 retângulos no Lucide; os cards do LH são arredondados).
9. **Coerção numérica `Number(v) || 0`:** `width="100%"` ou `"10px"` vira **0**, e retângulos de fundo de gráficos desaparecem.
10. **`parsePoints` sem `trim`:** espaços nas pontas geram pontos `NaN`.
11. **Flags de arco compactas** quebram o `path-data-parser@0.1.0` sem patch (49 ícones Lucide).
12. **Sem `seed` → aleatório a cada (re)geração.** Com a mesma `seed` para todas as formas, todas começam a mesma sequência pseudoaleatória e repetem o mesmo "tremido" (`Random`: `Math.imul(48271, seed)`; a seed vai no objeto de opções e é recriada por forma). Derive uma seed por forma (hash do id).
13. **Memo rasa:** arrays e objetos inline nas opções regeneram a cada render. Memoize.
14. **Fill invisível é calculado mesmo assim.** No Lucide (`<svg fill="none">`), cada forma recebe `fill="var(--rrf-fill-color)"`, que é truthy, então o rough gera a hachura (e `pointsOnPath`) que acaba com `stroke: none`. Isso dobra o custo. Resolva o fill estaticamente quando ele for conhecido.
15. **`fillWeight` não segue o `stroke-width` do SVG** (padrão 0,5).
16. **Eventos não sintéticos, `value`/`checked`/`dangerouslySetInnerHTML` ignorados.** Não coloque formulários nem markdown renderizado dentro.
17. **`ref` de forma devolve um `<path>`.** `getBBox` ainda funciona, mas APIs específicas de `SVGRectElement`/`SVGCircleElement` não.
18. **DevTools não enxerga a subárvore** (sem `injectIntoDevTools`).
19. **Tamanho do DOM:** 1 forma → 1 `<g>` + até 3 `<path>`, cada `d` com dezenas de cúbicas (multi-stroke = 2 traços). Em grafos grandes isso fica proibitivo. É mais um motivo para Canvas/`Path2D` no grafo.

---

## 9. O que copiar/adaptar (arquivos exatos)

| Origem (`_refs/extra/Bowen7__react-rough-fiber/…`) | Destino proposto no LH | Ação |
|---|---|---|
| `packages/react-rough-fiber/src/shape.ts` → `getDrawable` (L10–75), `normalizePathInfo` (L93–117) | `lib/sketch/rough-core.ts` | **Adaptar:** sem DOM. Ler `drawable.sets` + `opsToPath(set, digits)` (dispensa o patch do rough). Suporte a `rx/ry`. Normalização de `d`. Fill estático quando conhecido. Manter cabeçalho MIT (Bowen) |
| `src/utils.ts` → `parsePoints`, `shallowEqual` | `lib/sketch/rough-core.ts` | Copiar e acrescentar `trim()` e filtro de `NaN` |
| `src/constants.ts` → `SVG_SHAPE_MAP`, regex `CAMEL_PROPS`/`IS_NON_DIMENSIONAL` | `lib/sketch/rough-core.ts` (shape map) e `components/sketch/rough-svg/constants.ts` (só na F5) | Copiar. Renomear as vars para `--lh-sketch-fill` / `--lh-sketch-fill-opacity` |
| `src/types.ts` → `SVGShape`, `Options` | `lib/sketch/types.ts` | Copiar, com `rect` estendido (`rx?`, `ry?`) e `points: [number, number][]` já parseado |
| `src/props.ts` (inteiro) | `components/sketch/rough-svg/props.ts` (**F5, opcional**) | Copiar com **os dois** cabeçalhos MIT (Preact + Bowen) |
| `src/renderer.ts` | `components/sketch/rough-svg/renderer.ts` (**F5**) | **Reescrever** o host config para reconciler 0.34 (lista do §7, stubs no estilo R3F 9.8.2). Reconciler singleton. `commitUpdate` só com a assinatura React 19 |
| `src/roughSVG.tsx`, `src/context.tsx` | `components/sketch/rough-svg/RoughSVG.tsx` (**F5**) | ConcurrentRoot + `updateContainerSync` + `flushSyncWork` em `useLayoutEffect`. Error handlers reais. its-fine ^2.1.1 |
| `src/__tests__/svg.test.tsx`, `props.test.tsx`, `update.test.tsx` | `tests/sketch-core.test.ts` / `tests/sketch-primitives.test.tsx` | Portar as **asserções** (contagem e ordem de paths, seed estável, `fill:none`→1 path, memo por className) para `node:test` + `renderToStaticMarkup` |
| `patches/path-data-parser@0.1.0.patch` | (não copiar) | Substituir por `svgpath(d).abs().unarc()`. Se preferir parser próprio, citar a origem MIT |
| `apps/docs/components/playground/index.tsx` → `DEFAULT_OPTIONS` | `lib/sketch/presets.ts` | Referência dos defaults para os presets `icon`, `frame`, `edge`, `node` |
| `apps/docs/components/demos/icon.tsx` → `AnimatedIconDemo` (seed muda a cada 0,5 s) | (ideia) | "Boil" por troca de seed. No LH, pré-computar 3 variantes em build e alternar via CSS `steps(3)` |

---

## 10. Plano de integração

### F0: Dependências (sem tocar no React)

- `roughjs@4.6.6`: tornar dependência **direta e fixa** (hoje vem só via mermaid).
- `svgpath@2.6.0` (MIT): normalização de `d`. Alternativa: `svg-pathdata@9.0.0` (MIT), o mesmo parser do svg2roughjs.
- `perfect-freehand@1.2.3` (MIT): espessura variável de "tinta" em build e anotações do usuário.
- `rough-notation@0.5.1` (MIT, estável desde 2020) para ênfase. Opcional: `react-rough-notation@1.0.8`.
- **Não** adicionar `react-rough-fiber` nem `react-reconciler` agora.

### F1: Núcleo puro `lib/sketch/rough-core.ts` (sem DOM, determinístico)

```ts
// lib/sketch/rough-core.ts — adaptado de react-rough-fiber (MIT © 2023 Bowen) src/shape.ts
import { RoughGenerator } from "roughjs/bin/generator.js";
import type { Drawable, Options as RoughOptions } from "roughjs/bin/core.js";
import svgpath from "svgpath";

export type Pt = [number, number];
export type SketchShape =
  | { type: "path"; d: string }
  | { type: "circle"; cx: number; cy: number; r: number }
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { type: "rect"; x: number; y: number; width: number; height: number; rx?: number; ry?: number }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number }
  | { type: "polygon"; points: Pt[] }
  | { type: "polyline"; points: Pt[] };

/** kind: 'stroke' = contorno (herda stroke/stroke-width do pai); 'fillSolid' = fill;
 *  'fillSketch' = hachura desenhada como traço na cor do fill. */
export interface SketchPath { kind: "stroke" | "fillSolid" | "fillSketch"; d: string; strokeWidth?: number }

const gen = new RoughGenerator(); // sem estado mutável entre chamadas (_o copia as opções)

/** FNV-1a 32-bit → [1, 2^31-1] (o Random do rough usa Math.imul(48271, seed)). */
export function seedFrom(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ((h >>> 0) % 0x7ffffffe) + 1;
}

export function parsePoints(s: string): Pt[] {
  const c = s.trim().split(/\s+|\s*,\s*/).map(Number);
  const out: Pt[] = [];
  for (let i = 0; i + 1 < c.length; i += 2) if (Number.isFinite(c[i]) && Number.isFinite(c[i + 1])) out.push([c[i], c[i + 1]]);
  return out;
}

const normD = (d: string) => svgpath(d).abs().unarc().round(3).toString(); // remove arcos/flags compactas

function roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number): string {
  rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);           // regra do SVG para rx/ry
  return `M${x + rx} ${y}H${x + w - rx}C${x + w - rx * 0.448} ${y} ${x + w} ${y + ry * 0.448} ${x + w} ${y + ry}` +
    `V${y + h - ry}C${x + w} ${y + h - ry * 0.448} ${x + w - rx * 0.448} ${y + h} ${x + w - rx} ${y + h}` +
    `H${x + rx}C${x + rx * 0.448} ${y + h} ${x} ${y + h - ry * 0.448} ${x} ${y + h - ry}` +
    `V${y + ry}C${x} ${y + ry * 0.448} ${x + rx * 0.448} ${y} ${x + rx} ${y}Z`; // 0.448 ≈ 1-κ (κ=0.5523)
}

export function drawableFor(s: SketchShape, o: RoughOptions): Drawable | null {
  switch (s.type) {
    case "path": return s.d ? gen.path(normD(s.d), o) : null;
    case "circle": return gen.circle(s.cx, s.cy, s.r * 2, o);          // rough usa DIÂMETRO
    case "ellipse": return gen.ellipse(s.cx, s.cy, s.rx * 2, s.ry * 2, o);
    case "rect": {
      const rx = s.rx ?? s.ry ?? 0, ry = s.ry ?? s.rx ?? 0;
      return rx > 0 || ry > 0
        ? gen.path(roundedRect(s.x, s.y, s.width, s.height, rx, ry), o)
        : gen.rectangle(s.x, s.y, s.width, s.height, o);
    }
    case "line": return gen.line(s.x1, s.y1, s.x2, s.y2, o);
    case "polygon": return gen.polygon(s.points, o);
    case "polyline": return gen.linearPath(s.points, o);
  }
}

/** Substitui generator.toPaths() + patch do RRF: mantém o tipo do OpSet e arredonda. */
export function sketchPaths(s: SketchShape, o: RoughOptions, digits = 2): SketchPath[] {
  const dr = drawableFor(s, o);
  if (!dr) return [];
  const ro = dr.options;
  return dr.sets.map((set) => {
    const d = gen.opsToPath(set, digits);
    if (set.type === "path") return { kind: "stroke" as const, d };
    if (set.type === "fillPath") return { kind: "fillSolid" as const, d };
    return { kind: "fillSketch" as const, d, strokeWidth: ro.fillWeight < 0 ? ro.strokeWidth / 2 : ro.fillWeight };
  });
}
```

Notas:

- Passe `fill: undefined` quando o fill for `none` ou desconhecido. O `generator.path` só gera fill se `o.fill && o.fill !== 'none' && o.fill !== 'transparent'` (4.6.6, `generator.js` L186). Isso evita a armadilha 14.
- O rough é determinístico com `seed`: o PRNG é inteiro (`Math.imul`) e a trigonometria do V8 é a mesma no Node e no Chromium do Electron. Isso permite **SSR sem hydration mismatch**, desde que as mesmas opções e casas decimais sejam usadas. Confirme com um teste de snapshot.
- Testes (`tests/sketch-core.test.ts`, `node:test`):
  1. a mesma seed dá `d` idênticos;
  2. `fill` undefined → só `stroke`;
  3. `fillStyle:'solid'` → `fillSolid` antes de `stroke`;
  4. **todos os 2.034 `__iconNode` do Lucide geram ≥1 path não vazio e sem `NaN`**, o que cobre as 49 flags compactas e os 398 `rx`;
  5. `seedFrom` fica em [1, 2³¹−1].

### F2: Ícones *sketchy* gerados em build (Lucide → SVG estático)

Para o Lucide, **não use svg2roughjs**. Ele precisa de DOM real: o CLI dele usa Puppeteer. O Lucide é 100% primitivas sem `transform`, então o núcleo da F1 resolve em Node puro, rápido e reproduzível no CI.

```ts
// scripts/build-sketch-icons.ts  (rodar com `tsx`, como os testes do LH)
import { sketchPaths, seedFrom, parsePoints, type SketchShape } from "../lib/sketch/rough-core.ts";
import { getStroke } from "perfect-freehand";
import { pointsOnPath } from "points-on-path";             // já vem com o roughjs (MIT)
import { writeFileSync } from "node:fs";

const ICONS = ["search", "settings", "x", "check", "book-open", "folder" /* … ~45 usados + novos do §5.3 de lh-ui-theme */];
const VARIANTS = 3;                                        // "boil": 3 seeds, alternadas via CSS steps(3)
const ICON_OPTS = { roughness: 0.7, bowing: 1.2, strokeWidth: 2, disableMultiStroke: false, preserveVertices: true };

const num = (v: string | undefined) => (v === undefined ? undefined : Number.parseFloat(v));
function toShape(tag: string, a: Record<string, string>): SketchShape | null {
  switch (tag) {
    case "path": return { type: "path", d: a.d };
    case "circle": return { type: "circle", cx: +a.cx, cy: +a.cy, r: +a.r };
    case "ellipse": return { type: "ellipse", cx: +a.cx, cy: +a.cy, rx: +a.rx, ry: +a.ry };
    case "rect": return { type: "rect", x: +(a.x ?? 0), y: +(a.y ?? 0), width: +a.width, height: +a.height, rx: num(a.rx), ry: num(a.ry) };
    case "line": return { type: "line", x1: +a.x1, y1: +a.y1, x2: +a.x2, y2: +a.y2 };
    case "polygon": return { type: "polygon", points: parsePoints(a.points) };
    case "polyline": return { type: "polyline", points: parsePoints(a.points) };
    default: return null;
  }
}

/** Opcional: "tinta" com espessura variável (cel/hand-inked) — contorno rough → outline preenchido. */
function inked(d: string): string {
  return pointsOnPath(d, 0.15).map((pts) => {
    const o = getStroke(pts, { size: 2.1, thinning: 0.55, smoothing: 0.5, streamline: 0.3,
                               simulatePressure: true, start: { taper: 3 }, end: { taper: 3 } });
    if (o.length < 2) return "";
    return o.reduce((acc, [x, y], i, arr) => {
      const [nx, ny] = arr[(i + 1) % arr.length];
      return acc + `${x.toFixed(2)} ${y.toFixed(2)} ${((x + nx) / 2).toFixed(2)} ${((y + ny) / 2).toFixed(2)} `;
    }, `M${o[0][0].toFixed(2)} ${o[0][1].toFixed(2)} Q`) + "Z";
  }).join(" ");
}

const out: Record<string, string[][]> = {};
for (const name of ICONS) {
  const { __iconNode } = await import(`lucide-react/dist/esm/icons/${name}.mjs`); // pin da versão!
  out[name] = Array.from({ length: VARIANTS }, (_, v) =>
    (__iconNode as [string, Record<string, string>][]).flatMap(([tag, attrs], i) => {
      const s = toShape(tag, attrs);
      return s ? sketchPaths(s, { ...ICON_OPTS, seed: seedFrom(`${name}#${i}#${v}`) }, 2)
                   .filter((p) => p.kind === "stroke").map((p) => p.d) : [];
    }));
}
writeFileSync("components/icons/sketch/generated.ts",
  `// GERADO — não editar. Derivado de Lucide (ISC) + Feather (MIT); ver THIRD_PARTY_NOTICES.\n` +
  `export const SKETCH_ICONS = ${JSON.stringify(out)} as const;\n`);
```

- Componente: `components/icons/sketch/SketchIcon.tsx` renderiza `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={…} strokeLinecap="round" strokeLinejoin="round">` com um `<path d>` por traço, e uma `<g>` por variante com `.boil` (CSS `@keyframes` + `steps(3)`, desligado em `prefers-reduced-motion`).
  - Se usar `inked()`: troque para `fill="currentColor" stroke="none"`. O traço vira outline e fica igual à especificação de `lh-ui-theme.md` §5.3.
- Ligação com o plano de `docs/research/lh-ui-theme.md` §5.2: o *codemod* `lucide-react` → `@/components/icons/lucide-compat` passa a exportar `SketchIcon` com os mesmos nomes (`SearchIcon`, `XIcon`…). Ícones desenhados à mão substituem o gerado conforme ficam prontos. Mantenha a compatibilidade com as props `size`, `strokeWidth`, `className` e `absoluteStrokeWidth` (o Lucide calcula `strokeWidth*24/size`; ver `lucide-react/dist/esm/Icon.mjs`).
- Tamanho: os `d` rough são longos (2 traços × N cúbicas). **Meça** o `generated.ts` com 45 ícones × 3 variantes. Se pesar, use 2 casas decimais, `disableMultiStroke: true` em tamanhos ≤16px ou um sprite `<symbol>` em `public/`.
- **Svg2roughjs** (3.2.3, MIT, deps `roughjs ^4.6.6`, `svg-pathdata ^8`, `tinycolor2`) fica para **ilustrações complexas** com `transform`, `text`, gradiente e pattern (`new Svg2Roughjs(target, OutputType.SVG, roughConfig)`, `.svg = el`, `await .sketch()`, opções `seed`, `randomize`, `pencilFilter`, `fontFamily`, `sketchPatterns`). Rodar via janela oculta do Electron ou `puppeteer-core` (já no `package.json`), nunca em jsdom.

### F3: Primitivas React SSR-safe (substituem o renderer para o nosso próprio SVG)

```tsx
// components/sketch/primitives.tsx
"use client"; // (também roda no servidor: é puro)
import { memo, useMemo, type SVGProps } from "react";
import { sketchPaths, seedFrom, type SketchShape } from "@/lib/sketch/rough-core";
import type { Options as RoughOptions } from "roughjs/bin/core.js";

type Props = { shape: SketchShape; seedKey: string; options?: RoughOptions; fillColor?: string }
  & Omit<SVGProps<SVGGElement>, "fill">;

export const Sketch = memo(function Sketch({ shape, seedKey, options, fillColor, ...g }: Props) {
  const key = JSON.stringify(shape) + JSON.stringify(options) + (fillColor ?? "");
  const paths = useMemo(
    () => sketchPaths(shape, { ...options, seed: seedFrom(seedKey), fill: fillColor }, 2),
    [key, seedKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <g {...g}>
      {paths.map((p, i) =>
        p.kind === "stroke" ? <path key={i} d={p.d} fill="none" /> /* herda stroke do <g>/classe */
        : p.kind === "fillSolid" ? <path key={i} d={p.d} fill={fillColor} stroke="none" />
        : <path key={i} d={p.d} fill="none" stroke={fillColor} strokeWidth={p.strokeWidth} />)}
    </g>
  );
});
```

- `fillColor` aceita `"var(--color-…)"` ou `"currentColor"`, o que resolve a armadilha 6 sem CSS var mágica. `className` (Tailwind `stroke-*`) vai para o `<g>`, e o contorno herda.
- Aplicar em `components/plan-block.tsx`:
  - o `<rect>` do nó vira `<Sketch shape={{type:"rect",x:0,y:0,width:w,height:h}} seedKey={n.id} className={BOX[status]} …/>`;
  - as arestas usam `shape={{type:"path", d: edgePathD(pts, target)}}` com `preserveVertices: true`;
  - **a seta** sai do `markerEnd` e passa a ser desenhada como `polygon` rough na ponta, ou o marker é mantido num `<path>` liso invisível sobreposto. Testes existentes: `tests/render-plan-block.test.tsx`, `tests/plan-window.test.tsx`.
- Outros usos: molduras de cards e painéis (`<svg className="absolute inset-0 pointer-events-none">` + `ResizeObserver` para `w/h`), barra de XP e anel de progresso (`fillStyle: "hachure"`, preenchimento proporcional), badge de nível (`polygon`), separadores.

### F4: Grafo Canvas (`components/graph-canvas.ts`)

O núcleo vale para Canvas. Um `Path2D` aceita o `d` gerado, e `addPath(path, {e: x, f: y})` translada sem regenerar.

```ts
// dentro de GraphCanvasRenderer
private roughNode = new Map<string, { r: number; fill: Path2D; ink: Path2D }>();
private nodeGlyph(n: CanvasNode, r: number) {
  let g = this.roughNode.get(n.id);
  if (!g || g.r !== r) {
    const ps = sketchPaths({ type: "circle", cx: 0, cy: 0, r },
      { seed: seedFrom(n.id), roughness: 0.9, fill: "#000", fillStyle: "solid", disableMultiStroke: true }, 2);
    g = { r, fill: new Path2D(ps.filter(p => p.kind !== "stroke").map(p => p.d).join(" ")),
              ink: new Path2D(ps.filter(p => p.kind === "stroke").map(p => p.d).join(" ")) };
    this.roughNode.set(n.id, g);
  }
  return g;
}
// buildGeometry(): em vez de nodesPath.arc(...)
//   const g = this.nodeGlyph(n, nodeR); nodesPath.addPath(g.fill, { e: n.x, f: n.y }); inkPath.addPath(g.ink, { e: n.x, f: n.y });
// draw(): ctx.fill(this.nodesPath); ctx.stroke(this.inkPath)   (lineWidth / k como as arestas)
```

- **LOD:** use o rough só quando o raio na tela for ≥ ~6 px (`ratio` de `zoomRatioOf`). Abaixo disso, mantenha `arc`. Arestas rough (`gen.line(..., {preserveVertices:true, seed: seedFrom(from+to)})`) só com `simActive === false`. Durante o *force sim*, `buildGeometry` roda a cada tick, e regenerar milhares de linhas por frame é caro. Meça com o profiler.
- O cache é por `id`, invalidado por `nodeSize`, e respeita o "módulo sem DOM": o `Path2D` só existe dentro dos métodos e o `rough-core` não toca no DOM.
- Hulls e regiões (`buildRegions`) podem ganhar contorno `fillStyle:"hachure"` com `hachureGap` grande para o visual "marcador", mas isso é opcional.

### F5 (opcional): `RoughSVG` vendorizado para SVG de terceiros

Só se houver gráfico de biblioteca (recharts/visx) na página de stats. Antes, considere desenhar os gráficos leves com as primitivas da F3.

1. Copiar `src/{props,shape,constants,types,utils}.ts` com os cabeçalhos MIT. Em `shape.ts`, trocar `toPaths`+patch por `sketchPaths` da F1.
2. `renderer.ts`: **um reconciler por módulo**. As opções ficam por root:
   - `createInstance(type, props, rootContainer, hostContext)` grava `el._root = rootContainer`;
   - `diffProps` lê de um `WeakMap<Element, MutableRefObject<Options>>` registrado pelo `RoughSVG`.
3. Completar o host config para `react-reconciler@0.34.0` (pin exato, acompanhando `next/dist/compiled/react`). Base: as 87 chaves do R3F 9.8.2. Delta mínimo em relação ao RRF:

```ts
import { createContext } from "react";
import { DefaultEventPriority } from "react-reconciler/constants.js";
const extra = {
  rendererPackageName: "lh-sketch-svg", rendererVersion: "0.1.0", extraDevToolsConfig: null,
  warnsIfNotActing: false, supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
  resolveEventType: () => (typeof window !== "undefined" ? window.event?.type ?? null : null),
  resolveEventTimeStamp: () => (typeof window !== "undefined" ? window.event?.timeStamp ?? -1.1 : -1.1),
  trackSchedulerEvent: () => {}, requestPostPaintCallback: () => {},
  maySuspendCommit: () => false, maySuspendCommitOnUpdate: () => false, maySuspendCommitInSyncRender: () => false,
  preloadInstance: () => true, startSuspendingCommit: () => null, suspendInstance: () => {},
  waitForCommitToBeReady: () => null, getSuspendedCommitReason: () => null, suspendOnActiveViewTransition: () => {},
  NotPendingTransition: null, HostTransitionContext: createContext(null), resetFormInstance: () => {},
  cloneMutableInstance: (i: Element) => i.cloneNode(false), cloneMutableTextInstance: (t: Text) => t.cloneNode(false),
  resetTextContent: (i: Element) => { i.textContent = ""; },
  bindToConsole: (m: "log" | "warn" | "error", args: unknown[]) => console[m].bind(console, ...args), // conferir a assinatura na 0.34
  // view transitions / fragments: stubs do R3F 9.8.2 (no-op / throw "not supported")
};
// root: reconciler.createContainer(el, ConcurrentRoot, null, false, null, "", reportError, reportError, reportError, () => {}, null)
// mount: useLayoutEffect → updateContainerSync(children, root, null, null); flushSyncWork();
```

4. `commitUpdate(instance, type, oldProps, newProps)`: só a assinatura React 19 (remover `isReact19()`). `WCRoughSVG` com `its-fine@^2.1.1`.
5. Teste e2e no Electron (não dá com `renderToStaticMarkup`): montar, atualizar opções, error boundary interno e StrictMode.

### F6: Ênfase e anotação nas aulas (didática sem cansar)

- **rough-notation:** depois que a explicação termina de *streamar*, destacar **um** conceito-chave (`highlight` ou `underline`), nunca vários de uma vez. Isso combina com a meta 9 (sem despejar estímulos).

  ```ts
  import { annotate } from "rough-notation";
  const a = annotate(el, { type: "highlight", color: "var(--lh-hl)", animationDuration: 600, iterations: 1, multiline: true });
  a.show(); // cleanup: a.remove()
  ```

  Tipos disponíveis: `underline | box | circle | highlight | strike-through | crossed-off | bracket`. Para sequenciar, use `annotationGroup([...]).show()`. Precisa de layout real: rode em `useEffect` e respeite `prefers-reduced-motion` (`animate:false`).
- **perfect-freehand:** caneta do aluno sobre diagramas e circuitos (eventos `pointer*` com `e.pressure`) → `getStroke(points, { size, thinning, smoothing, streamline, simulatePressure: e.pointerType !== "pen" })` → path preenchido (mesma conversão de `inked()` acima). O mesmo pipeline dá a variação de espessura dos ícones da F2.
- **Mermaid** (já no LH via `@streamdown/mermaid`): `look: "handDrawn"` + `handDrawnSeed` fixo dão diagramas de aula no mesmo idioma visual. O mermaid já usa rough.js internamente.

### F7: Ordem sugerida e critérios de pronto

| Fase | Esforço | Pronto quando |
|---|---|---|
| F0+F1 | ~0,5–1 dia | teste "2.034 ícones Lucide sem NaN" verde; snapshot de seeds estável |
| F2 | ~1–2 dias | `lucide-compat` servindo SketchIcon. Tamanho do `generated.ts` medido. Reduced-motion respeitado |
| F3 | ~1–2 dias | `plan-block` sketchy com setas visíveis. `tests/render-plan-block.test.tsx` atualizado |
| F4 | ~1–2 dias | Profiling: idle sem custo extra; sim com rough só após assentar; LOD por zoom |
| F5 | ~2–3 dias (só se necessário) | e2e no Electron com React do Next (19.3 canary) |
| F6 | ~1 dia | 1 ênfase por bloco; caneta funcional |

---

## 11. Prós e contras de usar o renderer (resumo)

**Prós**
- Envolve **qualquer** árvore SVG React (ícones de terceiros, recharts, visx, d3-tree) sem tocar no código dela.
- Diff de props com memo evita regenerações à toa.
- Herança de `stroke`/`stroke-width` preservada (o contorno não tem atributo `stroke`).
- Opções por forma via função.
- Código pequeno, legível e MIT.

**Contras**
- Abandonado e quebrado no React 19.2+/19.3 do Next 16.
- Um reconciler por instância.
- SSR vazio e conteúdo atrasado.
- Contexto exige ponte.
- Eventos não sintéticos.
- Cor via classe CSS não funciona; markers somem; `rx` ignorado.
- Depende de patches.
- Não serve para o grafo Canvas do LH.

---

## 12. Perguntas em aberto

1. O LH vai ter gráficos de biblioteca (recharts/visx) em stats? Se não, a F5 é dispensável.
2. Estética dos ícones: rough "puro" (multi-stroke de lápis) ou "tinta" (perfect-freehand com outline e taper)? Para *cel shading*, a tinta com taper tende a casar melhor. Decidir com protótipo e *A/B* visual.
3. Orçamento de bundle para ícones gerados (3 variantes de "boil" ou 1)?
4. O `next` atualizado vai continuar empacotando React 19.3 canary? Se a F5 for feita, o pin do `react-reconciler` tem de acompanhar `node_modules/next/dist/compiled/react/package.json` a cada upgrade do Next. Vale um teste de CI que compare as versões.
5. Remover `@xyflow/react` (morto) ou reservá-lo para um editor pequeno de pré-requisitos? Ver `lh-ui-theme.md` §7.

---

### Fontes

- Código: `_refs/extra/Bowen7__react-rough-fiber` (commit `f3a6158`). Arquivos citados: `packages/react-rough-fiber/src/{renderer,props,shape,roughSVG,context,constants,types,utils}.ts(x)`, `src/__tests__/*.test.tsx`, `patches/*.patch`, `apps/docs/pages/{apis,faq}.mdx`, `apps/docs/components/{demos,sandboxes,playground}/*`.
- npm registry (2026-11-18): react-rough-fiber, react-reconciler (0.29.2–0.34.0), its-fine 2.1.1, roughjs 4.6.6, svg2roughjs 3.2.3, rough-notation 0.5.1, perfect-freehand 1.2.3, svgpath 2.6.0, svg-pathdata 9.0.0, lucide 1.75.0, @react-three/fiber 9.8.2.
- Issue #15: https://github.com/Bowen7/react-rough-fiber/issues/15
- React v19.2.0: `packages/react-reconciler/src/forks/ReactFiberConfig.custom.js`, `packages/react-reconciler/src/ReactFiberReconciler.js`, `packages/shared/ReactFeatureFlags.js`.
- R3F v9.8.2: `packages/fiber/src/core/reconciler.tsx`, `root.tsx`.
- svg2roughjs README e `nodejs-cli/README.md` (Puppeteer): https://github.com/fskpf/svg2roughjs
- Blog do autor: https://www.bowencodes.com/post/react-rough-fiber
- LH local: `package.json`, `next.config.ts`, `components/graph-canvas.ts`, `components/plan-block.tsx`, `node_modules/{roughjs,lucide-react,next/dist/compiled/react,mermaid}`, `docs/research/lh-ui-theme.md`.
