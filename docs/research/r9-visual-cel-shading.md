# r9 · Direção visual "clean + cel shading" e ícones SVG desenhados à mão

> Data: 2026-11-18 · Escopo: meta 8 do produto (UI clean em cel shading com ícones e assets SVG desenhados à mão), com ganchos para as metas 5 (níveis, XP, ranks) e 6 (stats leves).
> Base: learnharness 0.6.1 (raiz do repo, sem modificações). Este relatório **complementa** `docs/research/lh-ui-theme.md`, que mapeia *onde* o cel entra no código (indireção de tokens no Tailwind 4, bloco `skin`, canvas do grafo). Aqui o foco é *o quê*: princípios, paleta medida, tipografia, movimento, técnica de desenho dos ícones, tokens completos, lista de assets e guia de estilo.
> Método:
> - Li fontes primárias: READMEs e código no GitHub, docs oficiais (MDN, W3C, motion.dev, nextjs.org), metadados do Google Fonts, Crossref e arXiv.
> - Todos os contrastes foram **calculados por script** (luminância relativa WCAG 2.x). As rampas de tom foram geradas em OKLCH.
> - Construí um **protótipo** do compilador de ícones (perfect-freehand + polygon-clipping) e um **demo HTML** dos tokens, e os inspecionei renderizados (resvg e o navegador embutido).
> - Nada disso foi gravado no repo. Os arquivos estão no scratchpad da sessão (seção 15).
>
> **Limite desta pesquisa.** A cota de WebSearch da sessão estava esgotada (compartilhada com outros agentes). Por isso não fiz buscas abertas em Dribbble/Behance. Busquei fontes primárias por URL conhecida, `gh api`, registry do npm, Crossref e a API do arXiv. As referências de "toon UI" aplicadas vêm dessas fontes e dos repos de referência locais. As galerias não foram varridas.

---

## 0. Resumo executivo

1. **Definição operacional.** Cel shading em UI 2D são sete leis, com valores na seção 2.3:
   - uma luz global vinda do topo-esquerda;
   - contorno de tinta com hierarquia de traço (externo 2px, interno 1,5px);
   - 2–3 tons chapados por superfície com terminador duro (sem degradê);
   - sombra projetada dura deslocada (offset, blur 0);
   - rim light como filete interno claro;
   - especular como uma pílula branca, e só em objetos;
   - movimento "limitado" (quadros retidos) apenas no que é decorativo.

   O neobrutalismo é o subconjunto "1 tom + contorno + sombra dura". O cel acrescenta **tons com terminador, rim e especular**.
2. **Paleta medida (WCAG 2.2).** Os neutros claro "Papel" e escuro "Noite" e 8 rampas de acento (hl, base, shade, deep, lite) foram gerados em OKLCH com sombra puxada para violeta, no espírito do tom frio/quente de Gooch 1998.
   - Texto principal: 14,4–16,8:1.
   - Texto secundário: ≥5,7:1 em todas as superfícies.
   - **Tinta sobre qualquer acento: ≥5,6:1.** Chips e botões coloridos sempre usam texto em tinta.
   - Variantes `deep` (sobre papel) e `lite` (sobre superfícies escuras) dão ≥4,8:1 para texto colorido.
3. **Modo escuro híbrido, testado no demo.** Painéis usam **keyline escura e rim light**. Objetos pequenos de estado (ícones, nós do grafo, insígnias, campos) usam **contorno claro "giz"** (#E9E4D6, 14,2:1) ou a borda de campo `--cel-edge` (#8C88A6, ≥4:1).
   - Só keyline escura fez os nós "disponível" e "bloqueado" sumirem no fundo escuro (contraste de 1,1–1,5:1).
4. **Tipografia (Google Fonts, OFL, self-hosted via `next/font`).**
   - **Fredoka** para display (wdth 75–125, wght 300–700).
   - **Nunito** para UI e prosa (wght 200–1000). Os **dígitos padrão são tabulares**, conferido nos avanços dos glifos, então contadores não "tremem".
   - **Shantell Sans** para anotações "à mão" do tutor (eixos INFM e BNCE).
   - **JetBrains Mono** (já no repo) para código.
   - Fredoka tem dígitos proporcionais e **não tem `tnum`**. Não use Fredoka em números animados.
   - Alternativas: Atkinson Hyperlegible Next (2025) para prosa de máxima legibilidade, ou Recursive (eixo CASL) como família única.
5. **Movimento.** Durações de 90 a 900 ms. Molas geradas como CSS `linear()` (overshoot de 1,5%, 6,8% e 16%) e equivalentes em `motion`.
   - No código-fonte do motion, os padrões são stiffness 100, damping 10, mass 1, bounce 0,3 e visualDuration 0,3 s, com ζ = 1 − bounce.
   - Use `MotionConfig reducedMotion="user"`.
   - Regra de ouro: **movimento funcional é suave (60 fps); movimento decorativo é "em 3s"** (`steps(3)`, 8 fps).
6. **Ícones: um "compilador" determinístico em vez de desenhar 60 SVGs à mão.**
   - Cada ícone é um **esqueleto** em grade de 24px, escrito por humano ou por LLM.
   - O build aplica **wobble de baixa frequência com seed = hash(nome)**, gera o traço de tinta com **perfect-freehand**, achata com **polygon-clipping** e simplifica com RDP (ε = 0,04).
   - Depois emite 4 camadas: `fill`, `shade` (terminador a 45°), `ink` e `hl`.
   - **Prototipado e renderizado:** 1,0–2,4 KB por ícone com 3 camadas. O visual fica estável entre builds, e seeds +1/+2 geram os quadros de "boil".
   - Ícones de UI podem partir do path do **Lucide (ISC)**. O próprio README do perfect-freehand mostra o Feather passado por `getStroke`.
7. **Filtros SVG** (`feTurbulence` + `feDisplacementMap`): só em ilustrações estáticas e pequenas, com região de filtro limitada e `numOctaves` ≤ 2. **Nunca animar** `seed` ou `baseFrequency`. O "boil" é feito com 3 quadros pré-assados.
8. **Entregáveis deste relatório:**
   - tokens CSS completos (seção 10), compatíveis com o `data-skin="cel"` e o bloco `skin` propostos em `lh-ui-theme.md`;
   - especificação de ícones (seção 8);
   - lista priorizada de **73 ícones** em P0/P1/P2, mais insígnias e ilustrações (seção 9);
   - mini guia de estilo e checklist de PR (seção 12);
   - plano em fases com testes automatizáveis de contraste e lint de ícones (seção 13).

---

## 1. Contexto no repo (o que já existe e o que este relatório assume)

- **Stack:** Next.js 16.4.3, React 19.2.8, Tailwind 4.3.3 (CSS-first em `app/globals.css`), shadcn "new-york", `lucide-react` 1.33.0 (ISC), `motion` 13.1.1 instalado (o latest é 14.14.0), `@resvg/resvg-js` (útil para gerar folhas de contato de ícones em teste) e Electron ^44.9.3.
- **Motor de renderização.** O Electron 44.11.x embute o **Chromium 152.0.7977.169** (`releases.electronjs.org`, 2026-11-17). Dá para usar CSS moderno sem *polyfill*.
  - Versões mínimas no Chrome, segundo `@mdn/browser-compat-data` 8.1.9: `corner-shape` 139, sintaxe relativa de cor 122, `paint-order` 123, `@starting-style` 117, `color-mix()` 111, `linear()` (Baseline) e `text-wrap: balance` 114.
- **Leis do dono que afetam o visual:**
  - *no-ring law*: `*:focus-visible { outline: none }` em `globals.css:25`;
  - escada tipográfica 11/12,5/14/16/20/25/32;
  - ritmo de 4px;
  - "No guessing": decisões de design são do dono.

  Este relatório propõe; as decisões abertas estão na seção 14.
- **`lh-ui-theme.md` já resolveu a mecânica:**
  - indireção `@theme { --shadow-*: var(--lh-shadow-*) … }`;
  - `.border` fora de camada;
  - `data-skin="cel"`;
  - `ThemeSkin` no JSON de tema;
  - classes `cel-gloss`, `cel-press`, `cel-band` e `cel-halftone`;
  - canvas cel com `Path2D` e regiões posterizadas por `d3-contour`.

  Os tokens `--cel-*` deste relatório **alimentam** os `--lh-*` de lá (ponte na seção 10.3).
- **Lições já registradas nos refs** (lidas, não executadas):
  - **DeepTutor** (`_refs/DeepTutor/web/components/chat/home/StarterIcons.ts`):
    - ícones desenhados no **grid de 16px a 1:1**, porque "a 24px set scaled to 16px puts every stroke between two pixels";
    - a skin "mapa do tesouro" foi **removida** por parecer cartoon;
    - estado é codificado por **forma** antes da cor;
    - progresso usa **cor de tinta**, e `--primary` só aparece a 100% (`ProgressRing.tsx`).
  - **BloomTutor:** disciplina de "só N sombras" (`ref-bloomtutor-ui.md` §7).
  - Essas lições viram regras da seção 12.

---

## 2. Cel/toon shading: da renderização 3D para a UI 2D

### 2.1 Fundamentos (fontes primárias verificadas)

| Trabalho | Ideia que aproveitamos |
|---|---|
| Decaudin, *Cartoon-looking rendering of 3D scenes* (INRIA, 1996; DOI não verificado) | O "pipeline cartoon" original: cores chapadas, contorno e sombra projetada |
| Lake, Marshall, Harris, Blackstein, *Stylized rendering techniques for scalable real-time 3D animation*, NPAR 2000 ([10.1145/340916.340918](https://doi.org/10.1145/340916.340918)) | **Quantização** de `n·l` numa textura 1D de poucos texels, com bandas e **terminador duro**. Silhuetas detectadas e "tintadas" |
| Gooch, Gooch, Shirley, Cohen, *A non-photorealistic lighting model for automatic technical illustration*, SIGGRAPH 98 ([10.1145/280814.280950](https://doi.org/10.1145/280814.280950)) | Sombra é **mudança de matiz** (quente → frio), não só escurecimento. Por isso o `shade` gira o matiz em direção ao violeta em vez de multiplicar por preto, o que evita o "tom lamacento" |
| Anjyo & Hiramitsu, *Stylized highlights for cartoon rendering and animation*, IEEE CG&A 2003 ([10.1109/MCG.2003.1210865](https://doi.org/10.1109/MCG.2003.1210865)) | O especular é uma **forma desenhada** (deslocada, escalada, cortada), não um reflexo físico. Na UI vira uma pílula branca com rotação fixa |
| Barla, Thollot, Markosian, *X-Toon: an extended toon shader*, NPAR 2006 ([10.1145/1124728.1124749](https://doi.org/10.1145/1124728.1124749)) | Textura de tom 2D: a segunda dimensão controla abstração e **rim/backlight**. Na UI vira filete interno claro e nível de detalhe |
| Motomura (Arc System Works), *GuiltyGearXrd's Art Style: The X Factor Between 2D and 3D*, GDC 2015 ([GDC Vault](https://www.gdcvault.com/play/1022031/GuiltyGearXrd-s-Art-Style-The)) | Referência canônica de controle artístico de sombra, contorno e **animação limitada** (quadros retidos). Só a sinopse foi verificada; os detalhes vêm de memória e não foram reconferidos |
| Wikipedia, [Cel shading](https://en.wikipedia.org/wiki/Cel_shading) | Contorno por **inverted hull** (back faces ampliadas em preto) ou por **detecção de borda** (Sobel em profundidade e normal) |
| Thomas & Johnston, *The Illusion of Life* (1981), via [Twelve basic principles](https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation) | *Squash & stretch* com volume constante, antecipação, follow-through, exagero com contenção e timing |

**Trabalhos recentes (2024–2025) relevantes para a produção de assets** (arXiv conferido via API):

- **ToonCrafter** ([2405.17933](https://arxiv.org/abs/2405.17933), 2024): interpolação generativa de animação cartoon. Útil para pré-visualizar *in-betweens* de ilustrações animadas; **não** para runtime.
- **StarVector** ([2312.11556](https://arxiv.org/abs/2312.11556), dez/2023), **OmniSVG** ([2504.06263](https://arxiv.org/abs/2504.06263), abr/2025; dataset MMSVG-2M), **Chat2SVG** ([2411.16602](https://arxiv.org/abs/2411.16602), nov/2024; o LLM gera *templates* de primitivas geométricas e a difusão refina), **LLM4SVG** ([2412.11102](https://arxiv.org/abs/2412.11102)) e **SVGDreamer** ([2312.16476](https://arxiv.org/abs/2312.16476)).
  - A lição comum: o LLM é bom em **estrutura e primitivas**, e fraco em consistência de traço e grade.
- **SketchAgent** ([2411.17673](https://arxiv.org/abs/2411.17673), nov/2024): um LLM desenha **traço a traço** por uma linguagem de ações em grade, sem *fine-tuning*.
  - É exatamente o modelo da seção 7: o LLM (ou o humano) escreve o **esqueleto**, e um compilador determinístico dá o acabamento "à mão".

### 2.2 Tabela de tradução 3D → UI 2D

| Elemento 3D | Tradução em UI 2D (CSS, SVG, canvas) | Token / técnica |
|---|---|---|
| Luz direcional única | **Topo-esquerda, sempre.** Sombras vão para +x/+y; sombra própria embaixo e à direita; especular em cima e à esquerda | convenção (seção 2.3) |
| Quantização `n·l` (2–3 bandas) | 2–3 tons chapados por superfície: `hl` (luz), `base`, `shade` (sombra própria) | rampas `--c-*-hl/base/shade` |
| Terminador duro | Paradas duras: `linear-gradient(… 60%, shade 60%)`, `radial-gradient(circle at 38% 36%, base 0 58%, shade 59%)`; em SVG, camada `shade` recortada por uma reta a 45° | `--cel-band`, compilador de ícones |
| Silhueta (inverted hull) | `border` de tinta 2px; em SVG o traço vira polígono preenchido; no canvas, `ctx.stroke(path)` com `lineWidth` em px de tela | `--cel-stroke`, `--cel-line` |
| Linhas internas (detecção de borda) | Mais finas que a silhueta (hierarquia de traço) | `--cel-stroke-hair` 1,5px |
| Sombra projetada (shadow map) | `box-shadow: Xpx Ypx 0 0 ink`, blur sempre 0 | `--cel-elev-1..4` |
| Rim light / backlight | `inset 0 1.5px 0 rgb(255 255 255 / α)` (filete no topo) | `--cel-rim-top` |
| Especular estilizado | Pílula branca (≈14×5px a −12°) no canto superior esquerdo, **só em objetos** | `.cel-gloss::after`, camada `hl` |
| Sombra própria | `inset 0 -3px 0 <shade da cor>`. Nunca preto translúcido sobre cor | `--cel-self-bottom` |
| Ambiente e sombras "em retícula" | Retícula de pontos com borda dura (halftone) ou hachura a 45° no lugar de fades | `--cel-halftone`, `--cel-hatch` |
| Animação limitada ("em 2s/3s") | `steps(3)` a 8 fps só em *loops* decorativos (boil, brilho); feedback de UI fica contínuo | `--cel-steps-boil` |

### 2.3 As sete leis do estilo (invariantes)

1. **Uma luz:** topo-esquerda. Sombra em (+x, +y). Nada contradiz isso, nem ícone, nem canvas, nem ilustração.
2. **Tinta com hierarquia:**
   - silhueta 2px (`--cel-stroke`);
   - interno e divisórias 1,5px;
   - destaque e CTA 3px;
   - insígnias e ilustrações grandes 4px.
3. **Tons chapados:** no máximo 3 por superfície (hl, base, shade). **Zero degradê suave**, `backdrop-filter` e sombra com blur.
4. **Sombra dura** com 5 degraus de deslocamento: 2, 3, 4, 6 e 8 px. A elevação comunica **camada** (fluxo < botão < menu < diálogo), não "importância".
5. **Rim e especular são condimento:** rim em superfícies coloridas e flutuantes; especular **só** em CTA primário, gema de XP, insígnias e nós dominados.
6. **Forma antes de cor:** todo estado (bloqueado, disponível, estudando, revisão, dominado, erro) tem forma, padrão ou ícone próprios. A cor é redundante.
7. **"Clean" vence "sketchy":**
   - o *wobble* à mão vive **só** em ícones e ilustrações;
   - bordas de componentes são geométricas;
   - texto nunca tem efeito;
   - fica um único elemento "gomoso" por região de tela.

---

## 3. Referências de estilo aplicado (princípios, sem copiar marcas)

### 3.1 Neobrutalismo: o parente mais próximo

- **NN/g**, *Neobrutalism: Definition and Best Practices* (Hayat Sheikh, 11/04/2025, [nngroup.com/articles/neobrutalism](https://www.nngroup.com/articles/neobrutalism/)).
  - Características: alto contraste, cores saturadas, linhas grossas, **sombras sólidas deslocadas** (o exemplo é preto a 4px), tipografia ousada.
  - Boas práticas que adotamos:
    - usabilidade primeiro;
    - **testar contraste**, porque amarelo com ciano falha;
    - **limitar a paleta a 2–3 cores fortes** por tela;
    - display chunky só em títulos e texto corrido em fonte neutra;
    - **24–32px de respiro** em volta de formas pesadas;
    - estados de interação óbvios;
    - hierarquia com títulos de cerca de 2× o corpo.
  - Armadilhas: telas que cansam, contraste falho, elementos competindo e hierarquia achatada.
- **neobrutalism-components** ([ekmas/neobrutalism-components](https://github.com/ekmas/neobrutalism-components), MIT, ~5,7k★, ativo em nov/2026) é a implementação shadcn de referência. Em `src/styling/globals.css`:
  - `--border: oklch(0% 0 0)`, `--box-shadow-x/y: 4px` e `--shadow: var(--box-shadow-x) var(--box-shadow-y) 0px 0px var(--border)`;
  - raio de 5px;
  - pesos 500 e 700.

  O `Button` (`src/components/ui/button.tsx`) implementa o **"afundar"** com `hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none`. O "reverse" faz o inverso.
  - Aproveitamos o padrão de tokens e o gesto de pressionar.
  - Rejeitamos o raio de 5px e a sombra de 4px em tudo. No nosso estilo ela é escalonada por camada.
- **Diferença conceitual:** neobrutalismo = 1 tom + contorno + sombra dura. **Cel = neobrutalismo + tons com terminador + rim + especular + traço com variação de espessura nos assets.** O "clean" vem de mais respiro, menos cores por tela e efeitos só onde há affordance.

### 3.2 "Sketchy UI": o que funciona e o que cansa

- **Rough.js** ([rough-stuff/rough](https://github.com/rough-stuff/rough), MIT, v4.6.6, <9 kB, ~21k★) desenha primitivas "à mão" em canvas e SVG. Algoritmos adaptados da lib *handy* do Processing. Último push em 2024-07: é maduro e estável.
- **Wired Elements** ([rough-stuff/wired-elements](https://github.com/rough-stuff/wired-elements), MIT, último push em 2023-10) leva o Rough.js para web components. É bom como prova de conceito, mas mostra o limite: **toda** borda rabiscada vira ruído visual e custo de render. Não seguimos esse caminho.
- **Excalidraw** ([excalidraw/excalidraw](https://github.com/excalidraw/excalidraw), MIT, ~136k★) é a prova industrial das duas técnicas:
  - cada elemento guarda `seed: number` com o comentário *"Random integer used to seed shape generation so that the roughjs shape doesn't differ across renders"* (`packages/element/src/types.ts`);
  - o *freedraw* usa perfect-freehand com `thinning: 0.6`, `smoothing: 0.5`, `size = strokeWidth × 4.25` e `easing: t => Math.sin(t·π/2)` (`packages/element/src/shape.ts`, constantes "tuned empirically").
  - Lição: **seed fixo é obrigatório** para estabilidade visual, e os parâmetros são ajustados no olho.
- **Conclusão:** na nossa UI o "à mão" fica **pré-assado** em ícones e ilustrações. Os componentes ficam geométricos e limpos.

### 3.3 Padrões de "toon UI" de jogos e apps gamificados (princípios genéricos)

- **Botão com "lábio"** (extrusão): uma faixa inferior na cor `shade` do próprio botão (`inset 0 -3px 0 shade`) mais sombra projetada. Ao pressionar, o botão desce e o lábio some. É a leitura tátil mais forte e funciona em claro e escuro.
- **Shape language:**
  - círculo = amigável e "objeto coletável" (gema de XP, nós);
  - retângulo arredondado = estável e "contêiner" (cards, painéis);
  - triângulo e diagonal = ação e alerta (CTA, setas, raio).
- **Cada estado tem silhueta própria:** cadeado, anel vazio, meio cheio, selo. Isso é o que permite reconhecer o estado de longe e por daltônicos.
- **Texto "adesivo"** para números de nível e XP: preenchimento colorido com contorno grosso de tinta (`-webkit-text-stroke` + `paint-order: stroke fill`) e sombra dura.
- **Recompensa proporcional:** a celebração cresce com a raridade (toast < carimbo < level-up). Não celebrar o trivial evita o "cansaço de confete", em linha com a meta 9.

### 3.4 Lições negativas (do código dos refs)

- **DeepTutor:**
  - removeu a skin "pergaminho / mapa do tesouro";
  - trocou o mapa de rota ilustrado por lista ("ilustração sem affordance atrapalha");
  - trocou emoji escolhido pelo modelo por um anel de progresso ("carried no information and read as clip art").
- **Regra derivada:** **ilustração só onde não há ação** (empty states, celebrações, emblemas de domínio). **Ícone só com significado.** **Nunca emoji gerado por IA como ícone.**

---

## 4. Paleta e acessibilidade

### 4.1 Método (reproduzível)

- **Espaço de cor:** OKLCH (Ottosson, [OKLab](https://bottosson.github.io/posts/oklab/)). O mapeamento ao gamut sRGB reduz o croma em passos de 3% até caber.
- **Rampa por acento** (algoritmo usado, portável para TS em `src/core/themes.ts` ao lado do `toneHex` proposto em `lh-ui-theme.md` §4.2):
  - `shade` = L − 0,13; C × 1,02; matiz desviado 12% em direção a 300° (violeta), no máximo 14°. É a sombra fria de Gooch.
  - `hl` = L + 0,10 (até 0,97); C × 0,55; matiz desviado 10% em direção a 95° (amarelo), no máximo 10°.
  - `deep` = desce L em passos de 0,01 até contraste ≥4,8:1 com o papel e ≥4,5:1 com o afundado. É o texto colorido no claro.
  - `lite` = sobe L e reduz C até contraste ≥4,8:1 com `surface-3` escuro. É o texto colorido no escuro.
- **Contraste:** fórmula WCAG 2.x. Metas:
  - texto ≥4,5:1 (AA 1.4.3);
  - texto principal ≥7:1 (AAA 1.4.6);
  - fronteiras de componentes e estados ≥3:1 (1.4.11 Non-text Contrast);
  - foco ≥3:1 entre estado com e sem foco (2.4.13, AAA).
- **WCAG 3:** está em **Working Draft de 10/09/2026**, e o algoritmo de contraste ainda é "to be determined" ([w3.org/TR/wcag-3.0](https://www.w3.org/TR/wcag-3.0/)). Portanto **WCAG 2.2 é a régua normativa**. O APCA pode ser usado como checagem extra, mas não como critério de aceite.

```ts
// src/core/cel-ramp.ts (proposta) — depende de helpers oklch↔hex (≈40 linhas) e contrast()
export function celRamp(base: string, paper = "#FBF7EE", sunken = "#F3EDE0", darkRaised = "#2C2C3C") {
  const { l, c, h } = toOklch(base);
  const toward = (H: number, target: number, frac: number, cap: number) => {
    const d = ((target - H + 540) % 360) - 180; return H + Math.max(-cap, Math.min(cap, d * frac));
  };
  const shade = fromOklch(l - 0.13, c * 1.02, toward(h, 300, 0.12, 14));
  const hl = fromOklch(Math.min(0.97, l + 0.1), c * 0.55, toward(h, 95, 0.1, 10));
  let deep = base, lite = base;
  for (let i = 0; i < 80; i++) { const x = fromOklch(l - 0.01 * i, c * Math.min(1, 0.9 + 0.002 * i), toward(h, 300, 0.06, 8));
    if (contrast(x, paper) >= 4.8 && contrast(x, sunken) >= 4.5) { deep = x; break; } }
  for (let i = 0; i < 60; i++) { const x = fromOklch(Math.min(0.98, l + 0.01 * i), c * Math.max(0.45, 1 - 0.01 * i), h);
    if (contrast(x, darkRaised) >= 4.8) { lite = x; break; } }
  return { hl, base, shade, deep, lite };
}
```

### 4.2 Neutros (valores finais e contraste medido)

**Claro, "Papel"**

| Token | Hex | vs papel `#FBF7EE` | vs superfície `#FFFFFF` | vs afundado `#F3EDE0` | Uso |
|---|---|---|---|---|---|
| `--cel-text` / `--cel-line` | `#1E1B2E` | **15,69** | 16,78 | 14,38 | texto, tinta, sombra |
| `--cel-text-muted` | `#5E5870` | **6,32** | 6,76 | 5,80 | secundário, placeholder |
| `--cel-text-faint` | `#8C8698` | 3,29 | 3,51 | 3,01 | só ≥24px ou decorativo |
| `--cel-focus` / `--cel-link` | `#0B6DB3` | 5,10 | 5,45 | — | foco, links |

Tons das superfícies (OKLCH ΔL −0,045): papel `#ECE8DF`, superfície `#F0F0F0`, afundado `#E4DED1`.

**Escuro, "Noite"**

| Token | Hex | vs bg `#16161F` | vs s1 `#22222F` | vs s2 `#1B1B26` | vs s3 `#2C2C3C` | Uso |
|---|---|---|---|---|---|---|
| `--cel-text` | `#F2EEE4` | **15,51** | 13,55 | 14,72 | 11,83 | texto |
| `--cel-text-muted` | `#A9A5BA` | **7,51** | 6,56 | 7,13 | 5,73 | secundário |
| `--cel-text-faint` | `#77738A` | 3,94 | — | — | — | só ≥24px |
| `--cel-edge` | `#8C88A6` | 5,29 | 4,62 | 5,02 | 4,04 | **fronteira de campos e toggles** (1.4.11) |
| `--cel-line` (keyline) | `#07070B` | 1,12 | 1,28 | 1,18 | 1,47 | silhueta de painéis (decorativa) |
| `--cel-line-object` (giz) | `#E9E4D6` | **14,15** | 12,36 | — | 10,79 | ícones, nós, insígnias |
| `--cel-focus` | `#FFD23F` | 12,44 | 10,87 | — | — | foco |
| `--cel-link` | `#7CC4FF` | — | 8,37 | — | 7,31 | links |

Tons das superfícies: sombra (ΔL −0,045) de bg `#0C0C15` e s1 `#181724`; rim (ΔL +0,10) de s1 `#3B3B49` e s3 `#464657`.

### 4.3 Acentos (rampas calculadas)

| Nome | hl | **base** | shade | deep (texto no claro) | lite (texto no escuro) | tinta/base | tinta/shade | deep/papel | lite/s3 |
|---|---|---|---|---|---|---|---|---|---|
| volt | `#FFF5D8` | `#FFD23F` | `#E49E09` | `#8A6400` | `#FFD23F` | 11,62 | 7,35 | 5,03 | 9,49 |
| coral | `#FCB398` | `#FF7A59` | `#D34A4B` | `#BC4335` | `#FF7A59` | 6,54 | 3,88 | 4,92 | 5,34 |
| sky | `#97D4F7` | `#4FB3FF` | `#3386D8` | `#0B6DB3` | `#4FB3FF` | 7,37 | 4,43 | 5,10 | 6,02 |
| mint | `#ABE9B9` | `#3DD68C` | `#0FA785` | `#027957` | `#3DD68C` | 8,95 | 5,50 | 5,07 | 7,30 |
| grape | `#CEB4F3` | `#A98BFF` | `#8461D4` | `#7759BF` | `#A98BFF` | 6,25 | 3,71 | 4,95 | 5,11 |
| rose | `#FBA09E` | `#FF5C7A` | `#CE2A68` | `#C22F5B` | `#FD667F` | 5,64 | 3,32 | 5,10 | 4,82 |
| amber | `#FEDDAC` | `#FFB020` | `#DD7E01` | `#995D04` | `#FFB020` | 9,18 | 5,64 | 5,01 | 7,49 |
| teal | `#9DDACA` | `#2EC4B6` | `#07969B` | `#037674` | `#2EC4B6` | 7,74 | 4,67 | 5,10 | 6,32 |

Leitura da tabela:

- **Texto sobre preenchimento colorido é sempre tinta.** No claro `#1E1B2E` dá ≥5,64; no escuro `#07070B` dá ≥6,76, nos dois modos.
- Texto **branco** sobre `shade` fica entre 2,3 e 5,0. **Proibido** como regra geral.
- O `shade` só serve de **lábio, banda ou tom de ícone**, nunca de fundo de texto pequeno: tinta/shade cai para 3,3–3,9 em coral, grape e rose.
- `base` contra papel dá 1,35–2,78. Preenchimentos coloridos **não** cumprem 3:1 sozinhos. Cumprem porque **todo preenchimento interativo tem contorno de tinta** (15:1), e essa é a vantagem estrutural do cel para o critério 1.4.11.
- Metais das insígnias (tinta sobre a base): bronze `#D9894A` 6,10; prata `#C3CCD8` 10,35; ouro `#FFC93C` 10,93; jade `#46D6A8` 9,15; safira `#5AA9FF` 6,84; ametista `#A98BFF` 6,25; rubi `#FF5C7A` 5,64.

### 4.4 Cor por domínio (meta 3)

| Domínio | Acento | Por quê |
|---|---|---|
| **Eletrônica** | **volt** `#FFD23F` | "faísca, energia"; maior contraste com tinta (11,6:1) |
| **Inglês** | **coral** `#FF7A59` | quente, conversacional; distinto do volt mesmo para deuteranopia (diferença grande de luminância) |
| Futuros | teal, sky, grape, mint | rampas prontas. A ordem de atribuição maximiza a distância de matiz em relação aos domínios ativos |

`lh-ui-theme.md` §4.10 propôs o mesmo amarelo `#ffd23f` e um coral muito próximo (`#ff7a45`). A paleta aqui é compatível.

- Mecânica: `data-domain="…"` no `<html>` (ou no contêiner da sessão) troca `--cel-accent*`.
- **Status (sucesso, erro, aviso) e XP (grape) não mudam com o domínio**, para não haver ambiguidade semântica.

### 4.5 Modo escuro: a decisão "keyline vs giz" (testada)

- No demo, com **keyline escura em tudo**, os nós "disponível" (`#22222F` com contorno `#07070B`) e "bloqueado" (tracejado escuro) **quase sumiram** no fundo `#16161F`.
  - Contraste da keyline: 1,12–1,47:1.
  - A retícula a 12% ficou invisível.
- Com **giz** (`#E9E4D6`) só em objetos pequenos, nós, insígnias e ícones ficaram nítidos e coerentes com os ícones, cuja tinta é `currentColor` = texto claro. Os painéis com keyline escura mais rim mantiveram o ar "noite" sem virar "lousa".
- **Regra:** no escuro, `--cel-line` (painéis, botões, menus) é a keyline escura; `--cel-line-object` (ícones, nós, insígnias, chips de estado) é o giz; campos de entrada, checkboxes e toggles usam `--cel-edge`, que dá ≥4:1. No claro, os três são a mesma tinta.
- **Variante opcional "Lousa":** giz em tudo, com contorno de 1,5px. Mais contraste, porém visualmente mais ruidosa. Fica como preset alternativo.

### 4.6 Foco por teclado (conflito com a *no-ring law*)

- **2.4.7 Focus Visible é nível AA.** A lei atual remove o *outline* em todo lugar; os indicadores ficam a cargo dos componentes.
- O cel oferece indicadores "do estilo", sem o anel do navegador:
  - **AA:** a sombra dura troca de tinta para `--cel-focus` e cresce de 3 para 4px. No demo, ficou claramente visível nos dois modos.
  - **AAA (2.4.13):** a sombra **não conta**, porque *"does not include shadow and glow effects outside the component"* ([Understanding 2.4.13](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)). É preciso alterar pixels do próprio componente.
    - A troca de cor da borda de tinta para `#0B6DB3` dá 3,08:1, no limite.
    - Mais robusto: um contorno **tracejado** de tinta "desenhado" a 3px de distância (`outline: 2px dashed var(--cel-focus); outline-offset: 3px`) **só em `:focus-visible`** e **só no skin cel**. Contra o papel dá 5,10:1; no escuro, 12,44:1.
- **Decisão do dono** (seção 14): manter só o AA via sombra, ou abrir exceção estilizada à lei.

---

## 5. Tipografia

### 5.1 Recomendação

| Papel | Fonte (Google Fonts, OFL) | Eixos (metadados GF) | Adicionada | Por quê | Cuidados |
|---|---|---|---|---|---|
| **Display** (títulos, números de nível, insígnias) | **Fredoka** | `wdth` 75–125, `wght` 300–700 | 2021-12 | Arredondada, "gomosa", casa com o contorno grosso; o `wdth` permite títulos mais largos (108–112%) | **Dígitos proporcionais e sem `tnum`** (verificado no GSUB e no hmtx). Não usar abaixo de 16px nem em contadores animados |
| **UI e prosa** | **Nunito** | `wght` 200–1000 | 2012-08 | Terminais arredondados com leitura neutra; peso variável fino para a hierarquia; **dígitos padrão tabulares** (todos com avanço 600) | Sem `tnum` no GSUB, mas é desnecessário. Para prosa longa, 16px com peso 450 e entrelinha 1,5 |
| **Anotação "à mão"** (notas do tutor, empty states, legendas de ilustração) | **Shantell Sans** | `BNCE` −100…100, `INFM` 0–100, `SPAC` 0–100, `wght` 300–800 | 2023-01 | Fonte "desenhada" de verdade, com eixos para dosar informalidade e "pulo" das letras. Coerente com os ícones à mão | Arquivo grande (1,28 MB o TTF completo; `next/font` subseta). **Uso pontual**, máx. 1 bloco por tela, `INFM` 60–70 e `BNCE` 20–30 |
| **Código e dados técnicos** | **JetBrains Mono** (já no repo) | `wght` 100–800 | 2020-11 | Mantém o código e o chrome técnico existente | — |
| Alternativa de prosa (legibilidade máxima) | **Atkinson Hyperlegible Next** | `wght` 200–800 (+ itálico) | **2025-01** | Braille Institute; desenhada para baixa visão; tem `tnum` | Personalidade mais "grotesca"; usar como opção em Appearance |
| Alternativa de família única | **Recursive** | `CASL` 0–1, `MONO` 0–1, `CRSV`, `slnt`, `wght` 300–1000 | 2019-06 | Uma família cobre UI linear, títulos casuais e código mono; inspirada em *single-stroke casual* de letreiros | Arquivo variável grande; o casual pleno pode cansar em corpo de texto |
| Alternativa "limpa e arredondável" | **Google Sans Flex** | `ROND` 0–100, `opsz`, `wdth`, `wght`, `slnt` | 2025-11 | Eixo de arredondamento contínuo | OFL, mas **"Google Sans" é marca registrada** (`ofl/googlesansflex/TRADEMARKS.md`): não usar o nome em produto nem insinuar afiliação; 3,9 MB o TTF completo |

Descartadas para texto:

- display muito pesadas (Luckiest Guy, Bangers, Titan One, Lilita One), que servem no máximo para uma palavra;
- manuscritas de baixa legibilidade (Caveat, Gaegu, Kalam);
- Winky Rough (2025), que imita "tinta borrada" e degrada em corpo pequeno.

**Português:** todas cobrem o subconjunto `latin` (á, ã, â, ç, é, ê, í, ó, ô, õ, ú). Basta `subsets: ["latin"]`; inclua `latin-ext` só se houver nomes estrangeiros.

### 5.2 Escala e uso

- **Mantenha a escada do repo** (11 / 12,5 / 14 / 16 / 20 / 25 / 32) e acrescente dois degraus de display para o perfil e o level-up: **40** e **52**.
- **Display** (Fredoka): peso 600, `font-stretch: 108%`, tracking −0,01em. Só em ≥20px.
- **UI** (Nunito): rótulos com peso 650, botões 700, corpo 450, ênfase 800.
- Rótulos em caixa-alta: Nunito 800, 11–12,5px, tracking +0,06em. Substitui o JetBrains em caixa-alta do chrome atual, que é "terminal" demais para o cel.
- **Números:** Nunito (tabular nativo) ou `font-variant-numeric: tabular-nums` com JetBrains Mono. Nunca Fredoka em número que muda.
- **Texto adesivo** (nível, XP grande):

  ```css
  .cel-sticker { font: 600 40px/1 var(--cel-font-display); font-stretch: 112%; color: var(--cel-accent);
    -webkit-text-stroke: 6px var(--cel-line); paint-order: stroke fill; /* Chromium ≥123 */
    text-shadow: 3px 3px 0 var(--cel-shadow); }
  ```

  Como o traço é desenhado **antes** do preenchimento (`paint-order`), o contorno fica para fora e não come a letra. No demo, "Nv 12" ficou legível nos dois modos.

### 5.3 Integração (`next/font`, self-hosted no build, sem requisição ao Google em runtime)

`next/font` "downloads CSS and font files at build time … No requests are sent to Google by the browser" ([nextjs.org](https://nextjs.org/docs/app/api-reference/components/font)). Isso funciona offline no Electron. O padrão de `display` é `swap`; `axes` inclui eixos extras de fontes variáveis.

```ts
// app/fonts.ts (proposta) — importar no app/layout.tsx junto do JetBrains_Mono atual
import { Fredoka, Nunito, Shantell_Sans } from "next/font/google";
export const display = Fredoka({ subsets: ["latin"], variable: "--font-fredoka", axes: ["wdth"] });
export const ui = Nunito({ subsets: ["latin"], variable: "--font-nunito" });
export const hand = Shantell_Sans({ subsets: ["latin"], variable: "--font-shantell", axes: ["BNCE", "INFM"], preload: false });
// <html className={`${display.variable} ${ui.variable} ${hand.variable} …`}>
```

**Verificar no build:**

- se o `next/font` 16.4 aceita `axes: ["BNCE","INFM"]` para a Shantell. Os eixos existem nos metadados do GF, mas o loader valida contra a própria lista;
- se não aceitar, use `next/font/local` com o TTF de `google/fonts/ofl/shantellsans`.

`--font-ui`, hoje em `@theme inline` e portanto literal, precisa virar runtime para o skin trocar a fonte do chrome. Ver `lh-ui-theme.md` §4.3, passo 1.

---

## 6. Microinterações e movimento

### 6.1 Princípios aplicados

- ***Squash & stretch* com volume constante:** se `scaleX` sobe, `scaleY` desce (≈ 1/scaleX).
  - Uso: toasts de XP "pousando", knob de toggle, gema coletada.
  - Amplitude **≤ ±15%**, para não virar "geleia".
- **Antecipação:** um micro recuo de 1–2px antes de um deslocamento grande (toggle, abrir gaveta). Só quando a ação foi iniciada pelo usuário.
- ***Overshoot* (mola):** entradas de menus, diálogos e toasts com overshoot de 3–7%. Celebrações até 16%.
- **Follow-through:** partículas e "linhas de impacto" chegam depois do objeto principal (40–80 ms de atraso).
- **Exagero com contenção:** a escala de celebração é proporcional à raridade do evento (seção 3.3).
- **Timing limitado:** loops decorativos "em 3s" (`steps(3)`, ≈8 fps): boil, brilho e chama do streak. Feedback funcional (hover, press, arrastar) é contínuo e imediato.

### 6.2 Molas: números verificados

- No **código** do motion (`packages/motion-dom/src/animation/generators/spring.ts`): `defaultStiffness = 100`, `defaultDamping = 10`, `defaultMass = 1.0`, `defaultDuration = 800` ms, `defaultBounce = 0.3` e `defaultVisualDuration = 0.3` s.
  - O `bounce` é mapeado "as SwiftUI does": razão de amortecimento ζ = 1 − bounce (bounce negativo dá superamortecido).
  - A página da doc diz `bounce` padrão 0,25 ([motion.dev/docs/react-transitions](https://motion.dev/docs/react-transitions)). **Vale o código (0,3).**
- `bounce` e `duration` são **ignorados** se `stiffness`, `damping` ou `mass` forem definidos.
- **Molas de duração** (`bounce` + `duration`/`visualDuration`) "can be generated as pure CSS". Foi o que fizemos abaixo.
- **Versão:** o repo tem `motion` 13.1.1. O 14.0.0 (2026-10-02) só removeu APIs internas de compatibilidade (CHANGELOG), então a atualização é segura. Desde o 12.43, SVG e `backgroundColor` têm aceleração por hardware.

Curvas CSS `linear()` geradas pela mesma fórmula (oscilador subamortecido com ζ = 1 − bounce e assentamento em t = 1), simplificadas por RDP (ε = 0,006). `linear()` é Baseline ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/easing-function/linear)).

| Token | bounce | overshoot | Uso |
|---|---|---|---|
| `--cel-ease-settle` | 0,2 | 1,5% | barras de progresso, troca de painel |
| `--cel-ease-pop` | 0,35 | 6,8% | menus, diálogos, toasts, soltar o botão |
| `--cel-ease-squish` | 0,5 | 16,3% | celebração, carimbo, gema |

(Strings completas na seção 10.1. Regenere com o [gerador de Jake Archibald](https://linear-easing-generator.netlify.app/) se mudar o bounce.)

### 6.3 Catálogo de microinterações

| Gatilho | Animação | Propriedades | Duração / easing | `prefers-reduced-motion` |
|---|---|---|---|---|
| Hover em clicável elevado | Sobe 1px; sombra 3→4px | `transform`, `box-shadow` | 140 ms, `--cel-ease-out` | Só a troca de sombra |
| Press (botão e chip) | Desce 2px; sombra →1px; lábio 3→2px | idem | 90 ms ao pressionar; soltar com `--cel-ease-pop` 240 ms | Sem translate |
| Toggle | Knob recua 2px (antecipação), desliza e faz *squash* (sx 1,15 / sy 0,9) no fim | `transform` | 260 ms, pop | Troca instantânea |
| Abrir menu ou popover | `scale .92→1` + `translateY(-4px→0)` a partir da âncora; opacidade | `transform-origin` = âncora | 180 ms, pop | Só fade de 120 ms |
| Diálogo | `scale .9→1` + `rotate(-1deg→0)` | `transform` | 260 ms, pop | Fade |
| Toast "+XP" | Sobe 24px com *squash* ao pousar; some encolhendo | `transform`, `opacity` | 420 ms, squish | Fade |
| Resposta correta | "Carimbo": selo entra de `scale 1.4 rotate(-8deg)` até 1 e 0°; 4 linhas de impacto em `steps(3)` | `transform` | 380 ms | Selo estático mais cor e ícone |
| Resposta errada | *Shake* horizontal decrescente (6, −6, 4, −4, 0 px) | `translateX` | 320 ms | Borda tracejada mais ícone, sem shake |
| XP entra na barra | Preenchimento com mola; o especular "corre" pela barra | `scaleX` (não `width`) | 600 ms, settle | Salto direto |
| Level-up | Insígnia pop, confete chapado de 2 tons (≤40 partículas, contornadas) "em 2s" (12 fps) | canvas ou `transform` | 900 ms | Insígnia estática mais texto |
| Nó desbloqueado (canvas) | Anel 0→1,2→1 e 6 traços radiais de tinta | canvas | 420 ms | Troca de estado sem anel |
| "Pensando" ou gravando | Ícone em *boil* de 3 quadros (8 fps) | troca de `<path>` | loop de 375 ms | Primeiro quadro estático |
| Troca de domínio | Wipe circular de borda dura a partir do seletor (View Transitions, Chromium ≥111) | `clip-path` | 360 ms | Troca instantânea |

**Performance:**

- Animar `box-shadow` repinta. Em listas longas, renderize a sombra dura como **pseudo-elemento sólido** (`::before` com fundo de tinta e deslocamento) e anime o `transform` dele.
- Nunca use `backdrop-filter` nem blur.
- Partículas em canvas com orçamento fixo e pausa fora da tela (o padrão já usado no DeepTutor, nos *thinking-orbs*).

### 6.4 Código de referência

```tsx
// Envolver o app (AppShell) uma vez:
import { MotionConfig } from "motion/react";
<MotionConfig reducedMotion="user" transition={{ type: "spring", bounce: 0.35, visualDuration: 0.24 }}>{children}</MotionConfig>
// "user": desliga animações de transform/layout e mantém opacity e cor (motion.dev/docs/react-accessibility).

// Toast de XP com squash & stretch (volume ~constante):
<motion.div
  initial={{ y: 24, opacity: 0, scaleX: 0.9, scaleY: 1.1 }}
  animate={{ y: 0, opacity: 1, scaleX: [0.9, 1.12, 0.96, 1], scaleY: [1.1, 0.86, 1.04, 1] }}
  transition={{ duration: 0.42, times: [0, 0.45, 0.75, 1] }}
  className="cel-toast">+15 XP</motion.div>

// Botão: sem JS — CSS puro (seção 10.2) com :hover/:active e --cel-ease-pop no retorno.
```

```css
/* Boil de 3 quadros pré-assados (seeds +0/+1/+2 do compilador) */
.cel-boil > path { visibility: hidden; animation: cel-boil 375ms steps(1, end) infinite; }
.cel-boil > path:nth-child(2) { animation-delay: -125ms; }
.cel-boil > path:nth-child(3) { animation-delay: -250ms; }
@keyframes cel-boil { 0% { visibility: visible; } 33.333%, 100% { visibility: hidden; } }
@media (prefers-reduced-motion: reduce) {
  .cel-boil > path { animation: none; } .cel-boil > path:first-child { visibility: visible; }
}
```

**Acessibilidade de movimento** (WCAG 2.2):

- 2.3.3 *Animation from Interactions* (AAA): respeitar o *reduced motion*.
- 2.2.2 *Pause, Stop, Hide* (A): loops com mais de 5 s ao lado de conteúdo precisam ser pausáveis. Boil só em estados transitórios, como "pensando".
- Nada pisca acima de 3 Hz (2.3.1). O boil a 8 quadros/s troca *forma*, não luminância, mas mantenha a área pequena.

---

## 7. Assets desenhados à mão em SVG: técnica

### 7.1 Opções avaliadas

| Técnica | Como | Prós | Contras | Veredito |
|---|---|---|---|---|
| Desenho manual (Inkscape, Affinity, Procreate → SVG) | Artista desenha cada ícone | Máxima expressividade | Lento (60+ ícones), difícil manter a consistência de peso; cada ajuste global exige redesenho | Só para **ilustrações-chave** (emblemas, empty states) |
| **perfect-freehand** ([MIT, v1.2.3](https://github.com/steveruizok/perfect-freehand)) | `getStroke(pontos, {size, thinning, smoothing, streamline, easing, start/end:{taper,cap}, simulatePressure, last})` devolve o **polígono do contorno** do traço | Traço com espessura variável de verdade; saída é *fill* (escala sem `stroke-width`); o README mostra ícones Feather passados por `getStroke` ("Freehand Anything"); usado no Excalidraw | Polígono com autointerseções: achatar com `polygon-clipping.union` (README, seção "Flattening") | **Base do compilador** |
| **Rough.js** ([MIT, v4.6.6](https://github.com/rough-stuff/rough)) | Primitivas e paths "rabiscados"; `rough.generator(config, size)` no servidor; `generator.toPaths(drawable)` devolve `{d, stroke, strokeWidth, fill}` na ordem de render ([wiki](https://github.com/rough-stuff/rough/wiki/RoughGenerator)) | Hachuras (`hachure`, `cross-hatch`, `zigzag`, `dots`, `dashed`) prontas; **`seed`** de 1 a 2³¹ torna a geração repetível | Traço de espessura constante; `roughness` 1 já é "rabiscado" demais para UI clean | Só para **hachura e retícula** em ilustrações (com `roughness` ≤ 0,6 e `seed` fixo) |
| Filtros SVG (`feTurbulence` + `feDisplacementMap`) | Desloca pixels por ruído: `P'(x,y) = P(x + s·(XC−0,5), y + s·(YC−0,5))` ([MDN](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feDisplacementMap)) | Zero trabalho por ícone; aplica em qualquer coisa | Custo proporcional à área × oitavas; animar `seed`/`baseFrequency` recalcula a cada quadro; rasteriza (borda fica borrada em telas 1×); comportamento em `linearRGB` por padrão | **Só** em ilustrações estáticas pequenas (seção 7.5) |
| Sets prontos à mão | [Doodle Icons](https://khushmeen.com/icons.html) (400+ ícones, **CC0** segundo a página), [Iconoodle](https://github.com/NK2552003/Iconoodle) (MIT) | Rápido | Estilo de terceiros; peso e grade não casam com o nosso; sem camadas de tom | Inspiração e *moodboard*, não base |
| SVG gerado por IA (StarVector, OmniSVG, Chat2SVG, LLM4SVG) | Texto ou imagem → código SVG | Bom em estrutura | Inconsistente em grade, peso e terminais; *paths* longos | Usar o LLM para escrever o **esqueleto** (seção 7.2), à moda do SketchAgent e do Chat2SVG |

### 7.2 Decisão: o "compilador de ícones" (prototipado)

**Ideia.**

- Cada ícone é um **esqueleto geométrico** no grid de 24px: linhas centrais dos traços mais a silhueta fechada para os tons.
- O build transforma o esqueleto em arte "à mão" de forma **determinística**:
  1. **Amostragem** do path a cada 0,3px (`svg-path-properties`, ISC, v2.2.0), com a normal em cada ponto.
  2. **Wobble controlado:** ruído de valor 1D ao longo do comprimento de arco (nós a cada 7px, interpolação cosseno), com amplitude de **0,22px** na direção da normal. É baixa frequência, para parecer "mão firme" e não tremida.
  3. **Pressão sintética:** 0,5 ± 0,12 com outro ruído 1D (comprimento de onda 11px). Junto com `thinning: 0.32`, a espessura varia ±10–15%.
  4. **perfect-freehand:** `size 2.1` (silhueta) ou ×0,7–0,85 (linhas internas), `thinning 0.32`, `smoothing 0.6`, `streamline 0.2`, `simulatePressure:false`, `last:true`; taper de início 1,0px e de fim 1,8px (abertos). Em loops fechados, **fechamento por sobreposição**: o traço continua 1,4px além do início, como uma mão fechando o círculo.
  5. **`polygon-clipping.union`** de todos os traços: uma camada de tinta sem autointerseções.
  6. **RDP** com ε = 0,04 em anéis fechados (dividindo no ponto mais distante; um bug do protótipo mostrou que RDP ingênuo colapsa anel fechado) e arredondamento a 2 casas.
  7. **Tons:** `fill` = silhueta; `shade` = interseção da silhueta com o semiplano abaixo de uma reta a 45° deslocada `cut` px do centro (luz no topo-esquerda), o que dá o terminador duro; `hl` = elipse pequena rotacionada.
  8. **Seed = FNV-1a(nome)**. Os quadros de *boil* usam seed + k·7919 (k = 1, 2).
- **Resultado do protótipo** (6 ícones: `book`, `flashcard`, `node-mastered`, `domain-electronics`, `xp-gem`, `close`), renderizado com `@resvg/resvg-js` a 16/24/48/96px, claro e escuro:
  - Visual coerente: tinta com leve variação, cantos "de caneta", terminador nítido, especular discreto. No escuro, com tinta = `currentColor` claro, o resultado parece um "giz cel" muito bom.
  - **Tamanho:** sem simplificação, 0,5–6,6 KB por ícone; com RDP ε = 0,02, 0,28–2,6 KB; com **ε = 0,04, 0,28–2,4 KB** (tinta: 0,19–1,1 KB), sem diferença visual a 96px. 60 ícones dão ≈ 80–100 KB brutos, muito menos com gzip.
  - **A 16px os detalhes internos colapsam** (linhas do flashcard, facetas da gema). Daí a regra de LOD: traços marcados `detail` saem da variante `micro`.
  - Quadros de *boil* (seed +1/+2): diferença sutil e estável, com a sensação de "vivo" sem tremer.
  - **Bug encontrado e corrigido:** subpaths com vários `M` devem ser **separados** antes da amostragem. Do contrário a amostragem liga o fim de um traço ao início do outro ("Z" fantasma).

### 7.3 Código de referência (versão limpa do protótipo)

```ts
// scripts/icons/compile.ts — roda no build (tsx), como os scripts plugins:build-*
import { getStroke } from "perfect-freehand";              // MIT
import pc from "polygon-clipping";                          // MIT (0.15.7)
import { svgPathProperties } from "svg-path-properties";    // ISC (2.2.0)

export type Stroke = { d: string; w?: number; closed?: boolean; detail?: boolean };
export type IconSpec = {
  family: "glyph" | "object";
  ink: Stroke[];                                  // linhas centrais; cada subpath começa com "M" absoluto
  fill?: string;                                  // silhueta fechada (camada de tom)
  light?: { cx: number; cy: number; cut: number }; // terminador: reta a 45° passando a `cut` px do centro
  hl?: Array<[cx: number, cy: number, rx: number, ry: number, rot?: number]>;
};
export const INK = { size: 2.1, thinning: 0.32, smoothing: 0.6, streamline: 0.2,
  amp: 0.22, wavelength: 7, taperStart: 1.0, taperEnd: 1.8, step: 0.3, eps: 0.04 };

const fnv1a = (s: string) => { let h = 0x811c9dc5; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193); } return h >>> 0; };
const mulberry32 = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function noise1d(rng: () => number, length: number, wl: number) {
  const n = Math.max(2, Math.ceil(length / wl) + 2), k = Array.from({ length: n }, () => rng() * 2 - 1);
  return (s: number) => { const x = s / wl, i = Math.floor(x), f = (1 - Math.cos((x - i) * Math.PI)) / 2;
    return k[i] * (1 - f) + k[Math.min(i + 1, n - 1)] * f; };
}
function sample(d: string, step: number) {
  const p = new svgPathProperties(d), L = p.getTotalLength(), n = Math.max(2, Math.ceil(L / step)), pts = [];
  for (let i = 0; i <= n; i++) { const s = (L * i) / n, { x, y } = p.getPointAtLength(s), t = p.getTangentAtLength(s);
    pts.push({ x, y, nx: -t.y, ny: t.x, s }); }
  return { pts, L };
}
function inkStroke(d: string, rng: () => number, w = 1, closed = false) {
  const { pts, L } = sample(d, INK.step), wob = noise1d(rng, L, INK.wavelength), pr = noise1d(rng, L, INK.wavelength * 1.6);
  let input = pts.map((p) => { const o = wob(p.s) * INK.amp; return [p.x + p.nx * o, p.y + p.ny * o, 0.5 + 0.12 * pr(p.s)]; });
  if (closed) input = input.concat(input.slice(1, Math.ceil(1.4 / INK.step) + 1)); // fechamento por sobreposição
  const outline = getStroke(input, { size: INK.size * w, thinning: INK.thinning, smoothing: INK.smoothing,
    streamline: INK.streamline, simulatePressure: false, last: true,
    start: { taper: closed ? 0 : INK.taperStart, cap: true }, end: { taper: INK.taperEnd, cap: true } });
  return pc.union([outline as [number, number][]]);
}
const rdp = (p: number[][], e: number): number[][] => { if (p.length < 3) return p; const [x1, y1] = p[0], [x2, y2] = p[p.length - 1];
  const L = Math.hypot(x2 - x1, y2 - y1) || 1e-9; let dm = 0, ix = 0;
  for (let i = 1; i < p.length - 1; i++) { const d = Math.abs((y2 - y1) * p[i][0] - (x2 - x1) * p[i][1] + x2 * y1 - y2 * x1) / L; if (d > dm) { dm = d; ix = i; } }
  return dm > e ? rdp(p.slice(0, ix + 1), e).slice(0, -1).concat(rdp(p.slice(ix), e)) : [p[0], p[p.length - 1]]; };
const rdpRing = (r: number[][], e: number) => { let k = 0, dm = -1; r.forEach((q, i) => { const d = Math.hypot(q[0] - r[0][0], q[1] - r[0][1]); if (d > dm) { dm = d; k = i; } });
  return rdp(r.slice(0, k + 1), e).slice(0, -1).concat(rdp(r.slice(k), e)); };
const f2 = (v: number) => String(Math.round(v * 100) / 100);
const toD = (mp: number[][][][]) => mp.map((poly) => poly.map((r) => "M" + rdpRing(r, INK.eps).map(([x, y]) => `${f2(x)} ${f2(y)}`).join("L") + "Z").join("")).join("");

export function compile(name: string, spec: IconSpec, frame = 0, micro = false) {
  const rng = mulberry32(fnv1a(name) + frame * 7919);
  const strokes = spec.ink.filter((s) => !(micro && s.detail))
    .flatMap((s) => s.d.match(/M[^M]*/g)!.map((sub) => inkStroke(sub, rng, (s.w ?? 1) * (micro ? 1.15 : 1), !!s.closed && /z\s*$/i.test(sub))));
  const out: Record<string, string> = { ink: toD(pc.union(...(strokes as any))) };
  if (spec.fill) {
    const { pts } = sample(spec.fill, 0.25); const fill = [[pts.map((p) => [p.x, p.y])]] as any;
    out.fill = toD(fill);
    if (spec.light) { const { cx, cy, cut } = spec.light, k = 40, ox = cx + cut * Math.SQRT1_2, oy = cy + cut * Math.SQRT1_2;
      out.shade = toD(pc.intersection(fill, [[[ox - k, oy + k], [ox + k, oy - k], [ox + 2 * k, oy + 2 * k], [ox, oy + 3 * k]]] as any)); }
  }
  if (spec.hl && !micro) out.hl = spec.hl.map(([cx, cy, rx, ry, rot = -35]) => { const r = (rot * Math.PI) / 180, ring = [];
    for (let i = 0; i < 24; i++) { const t = (i / 24) * 2 * Math.PI, x = rx * Math.cos(t), y = ry * Math.sin(t);
      ring.push([cx + x * Math.cos(r) - y * Math.sin(r), cy + x * Math.sin(r) + y * Math.cos(r)]); }
    return toD([[ring]]); }).join("");
  return out;
}
```

Esqueletos de exemplo, os mesmos do protótipo:

```ts
export const ICONS: Record<string, IconSpec> = {
  "node-mastered": { family: "object", fill: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z", light: { cx: 12, cy: 12, cut: 2.8 },
    ink: [{ d: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z", closed: true }, { d: "M8 12.3l2.7 2.7L16.2 9.4", w: 1.05 }],
    hl: [[8.2, 7.6, 1.6, 0.85]] },
  "domain-electronics": { family: "object", fill: "M13.5 2.5 5 13.5h6l-1.5 8 8.5-11h-6z", light: { cx: 11.5, cy: 12, cut: 1.2 },
    ink: [{ d: "M13.5 2.5 5 13.5h6l-1.5 8 8.5-11h-6z", closed: true }], hl: [[10.6, 8.6, 1.2, 0.5, -55]] },
  flashcard: { family: "object", light: { cx: 11, cy: 13.5, cut: 2.4 },
    fill: "M4 8.5a1.5 1.5 0 0 1 1.5-1.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5z",
    ink: [{ d: "M4 8.5a1.5 1.5 0 0 1 1.5-1.5h11a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5z", closed: true },
          { d: "M7.5 4h11A1.5 1.5 0 0 1 20 5.5v10", w: 0.85 }, { d: "M8 12h6M8 15h4", w: 0.7, detail: true }],
    hl: [[6.6, 9.4, 0.9, 0.5]] },
  close: { family: "glyph", ink: [{ d: "M6.5 6.5l11 11" }, { d: "M17.5 6.5l-11 11" }] },
};
```

### 7.4 Pipeline de build e integração

```
assets/icons/
  skeletons/*.ts            ← IconSpec por ícone (humano ou LLM escreve; revisão humana obrigatória)
  lucide-bootstrap.json     ← paths do Lucide (ISC) usados como esqueleto de glifos de UI + aviso de licença
scripts/icons/compile.ts    ← seção 7.3
scripts/icons/build.ts      ← compila tudo → components/icons/generated.ts (+ variantes micro e boil)
                              → public/icons/sprite.svg (<symbol id>) para plugins e atlas do canvas
                              → test-output/icons-sheet.png (folha de contato via @resvg/resvg-js, já dependência)
components/icons/icon.tsx   ← <Icon name size tone? title?> (camadas fill/shade/ink/hl)
components/icons/lucide-compat.ts ← mesmos nomes do lucide-react, para migração incremental (lh-ui-theme §5.2)
```

```tsx
// components/icons/icon.tsx
import { ICONS, type IconName } from "./generated";
export function Icon({ name, size = 24, tone = true, title, className, ...rest }:
  { name: IconName; size?: number; tone?: boolean; title?: string } & React.SVGProps<SVGSVGElement>) {
  const g = ICONS[name]; const ink = size <= 16 && g.micro ? g.micro : g.ink;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} focusable="false"
         aria-hidden={title ? undefined : true} role={title ? "img" : undefined} {...rest}>
      {title && <title>{title}</title>}
      {tone && g.fill && <path d={g.fill} fill="var(--icon-fill, transparent)" />}
      {tone && g.shade && <path d={g.shade} fill="var(--icon-shade, transparent)" />}
      <path d={ink} fill="var(--icon-ink, currentColor)" />
      {tone && g.hl && size >= 20 && <path d={g.hl} fill="var(--icon-hl, #fff)" />}
    </svg>
  );
}
```

- **Por que codegen e não SVGR:** é o mesmo argumento de `lh-ui-theme.md` §5.2. Sem regra de Turbopack, compatível com SSR e Electron, só `currentColor` e CSS vars.
- **SVGO v4** ([release v4.0.0](https://github.com/svg/svgo/releases/tag/v4.0.0), MIT; latest 4.1.0) passou a deixar `removeViewBox` e `removeTitle` **fora** do `preset-default`. Mantenha assim. Os paths já saem simplificados do compilador, então o SVGO é só um passe final no `sprite.svg`.
- **Canvas** (nós do mapa): rasterize o sprite numa atlas `ImageBitmap` (16/32/64 × DPR) uma vez por troca de tema e use `drawImage` por nó visível. Ver `lh-ui-theme.md` §5.2 e §7.
- **Plugins:** opcionalmente expor `ctx.ui.hostIcon(name)` (mudança de contrato público).

### 7.5 Filtros SVG: quando e como (com moderação)

- **Onde:** só ilustrações estáticas (empty states, emblemas de domínio no perfil), no máximo 1–2 na tela, nunca em listas, ícones de UI ou texto.
- **Receita "borda de tinta irregular":**

  ```svg
  <filter id="cel-rough" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  ```

  - `seed` fixo (estabilidade).
  - `numOctaves` ≤ 2: o custo cresce com as oitavas.
  - **Região do filtro justa** (`x/y/width/height`), porque o custo cresce com a área.
  - `scale` de 1–2 user units num viewBox de 96–128. Acima disso, o traço "derrete".
  - `color-interpolation-filters="sRGB"` deixa o deslocamento previsível; o padrão é `linearRGB` ([MDN feTurbulence](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feTurbulence)).
- **Nunca animar** `seed` nem `baseFrequency`: força o recálculo do ruído a cada quadro. Para *boil*, use 3 quadros pré-assados (seção 6.4).
- **Preferir pré-assar:** quando um filtro só serve para dar irregularidade, aplique o deslocamento **no build** (o próprio compilador já faz o wobble). O resultado é path puro, nítido e barato.
- **Medir no Electron:** DevTools, aba Performance, mais "Rendering → Paint flashing". O orçamento é que o filtro não apareça em repaints durante a rolagem.

---

## 8. Especificação dos ícones

### 8.1 Grade e geometria

- **Canvas** 24×24, **área útil** 20×20 (margem de 2px). O Lucide usa margem mínima de 1px; nós usamos 2px porque a tinta é mais grossa e o *wobble* precisa de folga.
- **Keylines:**
  - círculo Ø20;
  - quadrado 18×18 com raio 2;
  - retrato 16×20;
  - paisagem 20×16;
  - centro óptico ajustado para formas assimétricas (teste: lado a lado com círculo e quadrado, borrado).
- **Pesos** (nominal, antes da variação de pressão):

  | Elemento | Peso em 24px | Equivale em 16px |
  |---|---|---|
  | silhueta | 2,1 | 1,4 |
  | linhas internas | 1,5–1,8 (`w` 0,7–0,85) | 1,0–1,2 |
  | detalhes (`detail: true`) | 1,5 | (omitidos) |
  | micro (≤16px) | silhueta ×1,15 | 1,6 |

- **Cantos:** juntas arredondadas por construção (perfect-freehand). Raios no esqueleto:
  - 2px em formas ≥8px;
  - 1px em formas <8px;
  - diagonais em ângulo reto com raio de cerca de 2,41px para ficar na grade.

  Regras herdadas do [guia do Lucide](https://lucide.dev/guide/design/icon-design-guide).
- **Espaço:** ≥2px entre elementos distintos e ≥2px em vãos internos (teste: um círculo de Ø2 cabe sem tocar).
- **Pixel grid:** o esqueleto fica em meia unidade sempre que possível. O *wobble* (0,22) é pequeno o bastante para não "sujar" a 24px.
- **Densidade:** no máximo 3 traços internos por ícone. Teste do borrão: manchas escuras indicam excesso de detalhe.

### 8.2 Camadas e cores

| Camada | Obrigatória | Cor (token) | Regra |
|---|---|---|---|
| `fill` | não (só a família *object*) | `--icon-fill` (padrão: `--cel-accent-hl`) | Silhueta; tom de luz |
| `shade` | junto com `fill` | `--icon-shade` (padrão: `--cel-accent-shade`) | Terminador a 45°; 35–45% da área, lado inferior direito |
| `ink` | sim | `--icon-ink` = `currentColor` | Tinta; no escuro vira giz automaticamente |
| `hl` | não | `--icon-hl` (branco) | 1 elipse; só em objetos, só ≥20px |

### 8.3 Famílias, tamanhos e estados

- **Glyph** (chrome de UI: fechar, chevrons, +, busca, enviar…): **só tinta**. Variante `micro` a 16px, que é o tamanho dominante no repo (`size-4`).
  - Lição do DeepTutor: a 16px, desenhar para o tamanho. A variante `micro` remove `detail` e engrossa a tinta.
- **Object** (domínios, recursos, gamificação, estados de nó): tinta, tons e especular. Tamanhos de 20/24/32/48.
- **Display** (insígnias, emblemas, empty states): grid de 48 ou 96. Silhueta de 4px equivalentes (`--cel-stroke-display`) e até 3 tons.
- **Estados:**
  - padrão: tons ligados;
  - inativo ou não selecionado: `tone={false}`, só tinta, com `--icon-ink: var(--cel-text-muted)`;
  - selecionado: tons com o acento do domínio;
  - desabilitado: só tinta com opacidade 0,45, sem `hl`;
  - "vivo" (pensando, gravando): `.cel-boil`.

### 8.4 Nomes, acessibilidade e marcas

- **Nomes semânticos** em kebab-case (`review-due`, não `clock-arrow`). Um nome por conceito; o desenho pode mudar sem renomear.
- **Ícone decorativo:** `aria-hidden`. Botão só com ícone: `aria-label` no botão. Ícone informativo isolado: `title`.
- **Sem texto dentro do ícone**, com exceção de glifos tipográficos como "Aa".
- **Sem logos de terceiros:** YouTube, Anki e Obsidian viram glifos genéricos (tela com play, pilha de cartas, nota com seta). Respeita as diretrizes de marca e evita impersonação.
- **Licenças:**
  - esqueletos derivados do Lucide: ISC. Os ícones de origem Feather são MIT. Manter o aviso em `THIRD_PARTY_NOTICES`;
  - perfect-freehand, polygon-clipping e svgo: MIT; svg-path-properties: ISC;
  - tudo é compatível com AGPL-3.0.

---

## 9. Lista priorizada de assets

Legenda:

- **Fam.:** G = glyph (só tinta, com micro); O = object (tinta, tons e especular); D = display.
- **Boot:** esqueleto inicial vindo do Lucide (nome do ícone Lucide). "novo" = desenhar o esqueleto do zero.

### 9.1 P0: necessário no primeiro release cel (33)

| # | Nome | Metáfora | Fam. | Boot |
|---|---|---|---|---|
| 1 | `home` | casinha | G | `house` |
| 2 | `map` | três nós ligados (o grafo) | G | `waypoints` |
| 3 | `lesson` | livro aberto com faísca (aula) | G | novo |
| 4 | `practice` | lápis com check | G | `pencil` + `check` |
| 5 | `review` | duas cartas com seta circular | G | novo |
| 6 | `search` | lupa | G | `search` |
| 7 | `settings` | engrenagem de 6 dentes | G | `settings` |
| 8 | `profile` | busto | G | `user` |
| 9 | `stats` | três barras | G | `chart-column` |
| 10 | `close` | X | G | `x` |
| 11 | `chevron` | um esqueleto, rotacionado para ←→↑↓ | G | `chevron-right` |
| 12 | `plus` | + | G | `plus` |
| 13 | `check` | ✓ | G | `check` |
| 14 | `more` | três pontos | G | `ellipsis` |
| 15 | `send` | seta em pílula | G | `arrow-up` |
| 16 | `attach` | clipe | G | `paperclip` |
| 17 | `mic` | microfone | G | `mic` |
| 18 | `sidebar` | painel lateral | G | `panel-left` |
| 19 | `domain-switch` | duas setas se cruzando | G | `arrow-left-right` |
| 20 | `domain-electronics` | raio | O | novo (protótipo) |
| 21 | `domain-english` | balão de fala com "Aa" | O | novo |
| 22 | `domain-generic` | bússola | O | `compass` |
| 23 | `node-locked` | cadeado (com hachura no nó) | O | `lock` |
| 24 | `node-available` | anel com ponto | O | novo |
| 25 | `node-learning` | círculo meio cheio | O | novo |
| 26 | `review-due` | relógio com seta | O | `clock` + `rotate-ccw` |
| 27 | `node-mastered` | selo com check | O | novo (protótipo) |
| 28 | `book` | livro | O | novo (protótipo) |
| 29 | `video` | tela com play | O | `monitor-play` |
| 30 | `ai-explain` | página com faísca | O | `file-text` + `sparkle` |
| 31 | `flashcard` | duas cartas | O | novo (protótipo) |
| 32 | `xp` | gema facetada | O | novo (protótipo) |
| 33 | `warning` | triângulo com ! | G | `triangle-alert` |

### 9.2 P1: features das metas 1, 4, 5 e 6 (25)

| # | Nome | Metáfora | Fam. | Boot |
|---|---|---|---|---|
| 34 | `chapter` | livro aberto com marcador | O | `book-open` |
| 35 | `subtitles` | balão com duas linhas | G | `captions` |
| 36 | `audio-dub` | alto-falante com ondas | G | `volume-2` |
| 37 | `exercise` | folha com caixinha marcada | O | `clipboard-check` |
| 38 | `deck` | pilha de 3 cartas | O | novo |
| 39 | `export-cards` | cartas com seta para fora (Anki genérico) | G | novo |
| 40 | `export-notes` | nota com seta (Obsidian genérico) | G | `file-output` |
| 41 | `node-new` | estrela de 4 pontas | O | `sparkle` |
| 42 | `prerequisite` | seta ligando dois pontos | G | novo |
| 43 | `expand-graph` | broto com + (expansão procedural) | O | `sprout` |
| 44 | `frontier` | bandeirinha (próximo recomendado) | O | `flag` |
| 45 | `level-up` | escudo com seta para cima | O | novo |
| 46 | `streak` | chama | O | `flame` |
| 47 | `trophy` | troféu | O | `trophy` |
| 48 | `leaderboard` | pódio | G | novo |
| 49 | `percentile` | curva de sino com marcador ("você") | G | novo |
| 50 | `goal` | alvo | O | `target` |
| 51 | `insight` | lâmpada | O | `lightbulb` |
| 52 | `weak-spot` | rachadura com curativo | O | novo |
| 53 | `memory` | três camadas empilhadas com ponto | O | `layers` |
| 54 | `clock` | relógio (horas estudadas) | G | `clock` |
| 55 | `calendar-heat` | calendário com quadradinhos | G | `calendar` |
| 56 | `tokens` | ficha hexagonal com entalhes | O | novo |
| 57 | `model` | chip com faísca | O | `cpu` |
| 58 | `trend-up` | linha subindo | G | `trending-up` |

### 9.3 P2: sistema e migração do lucide (15)

`theme` (paleta), `keyboard`, `plugin` (peça), `key` (login e provedor), `sync`, `download`, `upload`, `trash`, `edit`, `copy`, `pin`, `info`, `help`, `cost` (moeda), `drag-handle`.

Total: **73 ícones**. Os ~70 ícones lucide em uso hoje (`lh-ui-theme.md` §5.1) são cobertos por P0, P2 e o `lucide-compat`. Os não desenhados continuam como *fallback* do lucide até serem substituídos.

### 9.4 Assets display (não ícones)

| Prioridade | Asset | Especificação |
|---|---|---|
| P0 | **Insígnias de rank** (7 formas de tier × 3 divisões) | Forma é a pista primária: T1 círculo · T2 losango arredondado · T3 escudo · T4 escudo com asas · T5 hexágono · T6 estrela · T7 estrela com louros. **Divisão = 1–3 pips** abaixo da forma. Metal = cor secundária (bronze, prata, ouro, jade, safira, ametista, rubi; tinta ≥5,6:1 sobre todos). Gerados pelo compilador em grid de 48 com `--cel-stroke-display`. Nomes sugeridos (decisão do dono), tema "luz e conhecimento": Faísca, Chama, Tocha, Farol, Estrela, Constelação, Supernova |
| P0 | **Badge de nível** | Escudo com número em Fredoka "adesivo" (seção 5.2). O número é texto, não desenho |
| P1 | **Anel de maestria** (programático) | 4 segmentos com vão (limiares de domínio vindos do motor de KT/FSRS), **tinta** enquanto incompleto e acento só a 100% (lição do DeepTutor) |
| P1 | **Emblemas de domínio** 96px | Eletrônica (raio, resistor em zigue-zague e trilha de circuito); Inglês (balão "Aa", bandeirola). 3 tons, filtro "rough" opcional (seção 7.5) |
| P1 | **Empty states** (3) | "grafo vazio" (ilha com broto), "nenhuma revisão" (cartas empilhadas com check), "sem conexão" (plugue desconectado, que combina com Eletrônica). Texto em Shantell Sans, uma linha |
| P1 | **Explosão de level-up** | 8 traços de tinta radiais mais confete chapado de 2 tons (canvas) |
| P2 | Texturas | `--cel-halftone` e `--cel-hatch` em CSS. Padrão SVG de hachura (Rough.js, `fillStyle: "hachure"`, `roughness: 0.5`, `seed` fixo) para regiões bloqueadas do mapa |
| P3 (opcional) | Mascote | **Não recomendado agora.** Ilustração sem affordance; reavaliar depois do MVP |

---

## 10. Tokens CSS completos

### 10.1 Arquivo `app/cel.css` (proposta; importado após `globals.css`)

Os seletores seguem o repo: `.dark`/`.light` no `<html>` e `data-skin="cel"` (`lh-ui-theme.md` §4.2). No repo, o escuro é o padrão (`:root, .dark`).

```css
/* =================== 1. PRIMITIVOS (rampas OKLCH pré-calculadas; hex para o canvas ler) =================== */
:root {
	--c-volt-hl: #fff5d8;  --c-volt: #ffd23f;  --c-volt-shade: #e49e09;  --c-volt-deep: #8a6400;  --c-volt-lite: #ffd23f;
	--c-coral-hl: #fcb398; --c-coral: #ff7a59; --c-coral-shade: #d34a4b; --c-coral-deep: #bc4335; --c-coral-lite: #ff7a59;
	--c-sky-hl: #97d4f7;   --c-sky: #4fb3ff;   --c-sky-shade: #3386d8;   --c-sky-deep: #0b6db3;   --c-sky-lite: #4fb3ff;
	--c-mint-hl: #abe9b9;  --c-mint: #3dd68c;  --c-mint-shade: #0fa785;  --c-mint-deep: #027957;  --c-mint-lite: #3dd68c;
	--c-grape-hl: #ceb4f3; --c-grape: #a98bff; --c-grape-shade: #8461d4; --c-grape-deep: #7759bf; --c-grape-lite: #a98bff;
	--c-rose-hl: #fba09e;  --c-rose: #ff5c7a;  --c-rose-shade: #ce2a68;  --c-rose-deep: #c22f5b;  --c-rose-lite: #fd667f;
	--c-amber-hl: #feddac; --c-amber: #ffb020; --c-amber-shade: #dd7e01; --c-amber-deep: #995d04; --c-amber-lite: #ffb020;
	--c-teal-hl: #9ddaca;  --c-teal: #2ec4b6;  --c-teal-shade: #07969b;  --c-teal-deep: #037674;  --c-teal-lite: #2ec4b6;
	--c-bronze: #d9894a; --c-bronze-shade: #b25e26; --c-bronze-hl: #e5bb9d;
	--c-silver: #c3ccd8; --c-silver-shade: #99a3ae; --c-silver-hl: #eef3f9;
	--c-gold: #ffc93c;   --c-gold-shade: #d89c11;   --c-gold-hl: #fff4dd;
	--c-jade: #46d6a8;   --c-jade-shade: #11ac76;   --c-jade-hl: #b4f0d7;
	--c-sapphire: #5aa9ff; --c-sapphire-shade: #0883d2; --c-sapphire-hl: #a9cffb;
	--c-amethyst: #a98bff; --c-amethyst-shade: #7965d8; --c-amethyst-hl: #cabffa;
	--c-ruby: #ff5c7a;   --c-ruby-shade: #cf2962;   --c-ruby-hl: #fca9b1;
}

/* =================== 2. SEMÂNTICOS =================== */
/* Escuro "Noite" — padrão do repo (:root, .dark) */
:root[data-skin="cel"], [data-skin="cel"].dark {
	color-scheme: dark;
	--cel-bg: #16161f;        --cel-bg-shade: #0c0c15;
	--cel-surface-1: #22222f; --cel-surface-1-shade: #181724; --cel-surface-1-rim: #3b3b49;
	--cel-surface-2: #1b1b26; --cel-surface-2-shade: #11111b;
	--cel-surface-3: #2c2c3c; --cel-surface-3-rim: #464657;
	--cel-text: #f2eee4; --cel-text-muted: #a9a5ba; --cel-text-faint: #77738a;
	--cel-line: #07070b;                    /* keyline de painéis (decorativa) */
	--cel-line-object: #e9e4d6;             /* giz: ícones, nós, insígnias (14,2:1) */
	--cel-line-soft: rgb(242 238 228 / 0.2);/* divisórias, retícula, hachura */
	--cel-edge: #8c88a6;                    /* campos/toggles/checkbox: ≥4:1 */
	--cel-shadow: #000;
	--cel-rim: rgb(255 255 255 / 0.14);
	--cel-self: rgb(0 0 0 / 0.3);
	--cel-on-fill: #07070b;                 /* texto sobre qualquer acento: ≥6,7:1 */
	--cel-focus: #ffd23f; --cel-link: #7cc4ff; --cel-hl: rgb(255 255 255 / 0.85);
	--cel-scrim: rgb(0 0 0 / 0.55);
	--cel-success: var(--c-mint);  --cel-success-shade: var(--c-mint-shade);  --cel-success-text: var(--c-mint-lite);
	--cel-warning: var(--c-amber); --cel-warning-shade: var(--c-amber-shade); --cel-warning-text: var(--c-amber-lite);
	--cel-danger: var(--c-rose);   --cel-danger-shade: var(--c-rose-shade);   --cel-danger-text: var(--c-rose-lite);
	--cel-info: var(--c-sky);      --cel-info-shade: var(--c-sky-shade);      --cel-info-text: var(--c-sky-lite);
	--cel-xp: var(--c-grape);      --cel-xp-shade: var(--c-grape-shade);      --cel-xp-text: var(--c-grape-lite);
}
/* Claro "Papel" */
[data-skin="cel"].light {
	color-scheme: light;
	--cel-bg: #fbf7ee;        --cel-bg-shade: #ece8df;
	--cel-surface-1: #ffffff; --cel-surface-1-shade: #f0f0f0; --cel-surface-1-rim: #ffffff;
	--cel-surface-2: #f3ede0; --cel-surface-2-shade: #e4ded1;
	--cel-surface-3: #ffffff; --cel-surface-3-rim: #ffffff;
	--cel-text: #1e1b2e; --cel-text-muted: #5e5870; --cel-text-faint: #8c8698;
	--cel-line: #1e1b2e; --cel-line-object: #1e1b2e; --cel-line-soft: rgb(30 27 46 / 0.22);
	--cel-edge: #1e1b2e;
	--cel-shadow: #1e1b2e;
	--cel-rim: rgb(255 255 255 / 0.55);
	--cel-self: rgb(30 27 46 / 0.1);
	--cel-on-fill: #1e1b2e;
	--cel-focus: #0b6db3; --cel-link: #0b6db3; --cel-hl: #ffffff;
	--cel-scrim: rgb(30 27 46 / 0.45);
	--cel-success-text: var(--c-mint-deep); --cel-warning-text: var(--c-amber-deep);
	--cel-danger-text: var(--c-rose-deep);  --cel-info-text: var(--c-sky-deep); --cel-xp-text: var(--c-grape-deep);
}

/* Acento por domínio (status e XP não mudam) */
[data-skin="cel"], [data-skin="cel"] [data-domain="electronics"], [data-skin="cel"][data-domain="electronics"] {
	--cel-accent: var(--c-volt); --cel-accent-shade: var(--c-volt-shade); --cel-accent-hl: var(--c-volt-hl);
	--cel-accent-text: var(--c-volt-lite);
}
[data-skin="cel"] [data-domain="english"], [data-skin="cel"][data-domain="english"] {
	--cel-accent: var(--c-coral); --cel-accent-shade: var(--c-coral-shade); --cel-accent-hl: var(--c-coral-hl);
	--cel-accent-text: var(--c-coral-lite);
}
[data-skin="cel"].light, [data-skin="cel"].light [data-domain="electronics"] { --cel-accent-text: var(--c-volt-deep); }
[data-skin="cel"].light [data-domain="english"], [data-skin="cel"].light[data-domain="english"] { --cel-accent-text: var(--c-coral-deep); }

/* =================== 3. GEOMETRIA, ELEVAÇÃO, TEXTURA, MOVIMENTO, TIPO, ÍCONES =================== */
[data-skin="cel"] {
	/* traço */
	--cel-stroke-hair: 1.5px; --cel-stroke: 2px; --cel-stroke-bold: 3px; --cel-stroke-display: 4px;
	/* raios */
	--cel-radius-xs: 6px; --cel-radius-sm: 10px; --cel-radius-md: 14px; --cel-radius-lg: 20px; --cel-radius-xl: 28px; --cel-radius-pill: 999px;
	/* deslocamentos da sombra dura (luz topo-esquerda) */
	--cel-o1: 2px; --cel-o2: 3px; --cel-o3: 4px; --cel-o4: 6px; --cel-o5: 8px;
	--cel-press: 2px; --cel-lift: 1px;
	/* elevação — nunca blur */
	--cel-rim-top: inset 0 1.5px 0 0 var(--cel-rim);
	--cel-self-bottom: inset 0 -3px 0 0 var(--cel-self);
	--cel-elev-0: none;
	--cel-elev-1: var(--cel-o1) var(--cel-o1) 0 0 var(--cel-shadow);
	--cel-elev-2: var(--cel-rim-top), var(--cel-self-bottom), var(--cel-o2) var(--cel-o2) 0 0 var(--cel-shadow);
	--cel-elev-3: var(--cel-rim-top), var(--cel-o3) var(--cel-o3) 0 0 var(--cel-shadow);
	--cel-elev-4: var(--cel-rim-top), var(--cel-o4) var(--cel-o4) 0 0 var(--cel-shadow);
	--cel-elev-pressed: var(--cel-self-bottom), 1px 1px 0 0 var(--cel-shadow);
	--cel-sunken: inset 0 2px 0 0 var(--cel-self);
	/* texturas cel (paradas duras) */
	--cel-halftone: radial-gradient(var(--cel-line-soft) 28%, transparent 30%) 0 0 / 6px 6px;
	--cel-hatch: repeating-linear-gradient(-45deg, var(--cel-line-soft) 0 1.5px, transparent 1.5px 6px);
	/* movimento */
	--cel-dur-press: 90ms; --cel-dur-hover: 140ms; --cel-dur-enter: 240ms; --cel-dur-pop: 420ms; --cel-dur-celebrate: 900ms;
	--cel-ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
	--cel-ease-in: cubic-bezier(0.5, 0, 0.75, 0);
	--cel-ease-settle: linear(0, 0.023 3.3%, 0.121 8.3%, 0.541 23.3%, 0.698 30%, 0.817 36.7%, 0.901 43.3%, 0.966 51.7%, 1.006 63.3%, 1.015 75%, 1);
	--cel-ease-pop: linear(0, 0.035 3.3%, 0.124 6.7%, 0.575 18.3%, 0.796 25%, 0.916 30%, 1.015 36.7%, 1.06 43.3%, 1.068 50%, 1.006 78.3%, 1);
	--cel-ease-squish: linear(0, 0.016 1.7%, 0.125 5%, 0.931 20%, 1.044 23.3%, 1.139 28.3%, 1.162 31.7%, 1.159 35%, 1.125 40%, 1.019 51.7%, 0.991 56.7%, 0.976 61.7%, 0.974 68.3%, 0.999 86.7%, 1);
	--cel-steps-boil: steps(3, jump-none);
	/* tipografia */
	--cel-font-display: var(--font-fredoka), var(--font-nunito), system-ui, sans-serif;
	--cel-font-ui: var(--font-nunito), system-ui, sans-serif;
	--cel-font-prose: var(--font-nunito), system-ui, sans-serif;
	--cel-font-hand: var(--font-shantell), var(--font-nunito), sans-serif;
	--cel-font-mono: var(--font-jetbrains), ui-monospace, monospace;
	--cel-weight-body: 450; --cel-weight-ui: 650; --cel-weight-button: 700; --cel-weight-strong: 800; --cel-weight-display: 600;
	--cel-tracking-caps: 0.06em; --cel-tracking-display: -0.01em;
	--cel-text-display-1: 40px; --cel-text-display-2: 52px;
	/* ícones */
	--icon-ink: currentColor; --icon-fill: var(--cel-accent-hl); --icon-shade: var(--cel-accent-shade); --icon-hl: var(--cel-hl);
	/* espaço em volta de formas pesadas (NN/g: 24–32px) */
	--cel-gap-heavy: 24px; --cel-gap-hero: 32px;
}
@media (prefers-reduced-motion: reduce) {
	[data-skin="cel"] { --cel-dur-press: 0ms; --cel-dur-hover: 0ms; --cel-dur-enter: 120ms; --cel-dur-pop: 120ms; --cel-dur-celebrate: 200ms;
		--cel-ease-pop: var(--cel-ease-out); --cel-ease-squish: var(--cel-ease-out); --cel-ease-settle: var(--cel-ease-out); --cel-press: 0px; --cel-lift: 0px; }
}
```

### 10.2 Receitas de componentes (validadas no demo)

```css
/* Botão primário: lábio na cor shade + sombra dura + especular */
[data-skin="cel"] .cel-btn {
	--b: var(--cel-accent); --bs: var(--cel-accent-shade);
	position: relative; isolation: isolate; color: var(--cel-on-fill); background: var(--b);
	font: var(--cel-weight-button) 15px/1 var(--cel-font-ui);
	border: var(--cel-stroke) solid var(--cel-line); border-radius: var(--cel-radius-md); padding: 11px 18px;
	box-shadow: var(--cel-rim-top), inset 0 -3px 0 0 var(--bs), var(--cel-o2) var(--cel-o2) 0 0 var(--cel-shadow);
	transition: transform var(--cel-dur-hover) var(--cel-ease-out), box-shadow var(--cel-dur-hover) var(--cel-ease-out);
}
[data-skin="cel"] .cel-btn[data-gloss]::after { /* especular: SÓ no CTA primário */
	content: ""; position: absolute; left: 9px; top: 5px; width: 14px; height: 5px; border-radius: 999px;
	background: var(--cel-hl); transform: rotate(-12deg); pointer-events: none; }
[data-skin="cel"] .cel-btn:hover { transform: translate(calc(-1 * var(--cel-lift)), calc(-1 * var(--cel-lift)));
	box-shadow: var(--cel-rim-top), inset 0 -3px 0 0 var(--bs), var(--cel-o3) var(--cel-o3) 0 0 var(--cel-shadow); }
[data-skin="cel"] .cel-btn:active { transform: translate(var(--cel-press), var(--cel-press)); transition-duration: var(--cel-dur-press);
	box-shadow: inset 0 -2px 0 0 var(--bs), 1px 1px 0 0 var(--cel-shadow); }
[data-skin="cel"] .cel-btn:focus-visible { /* AA: sombra de foco; AAA: ver §4.6 */
	box-shadow: var(--cel-rim-top), inset 0 -3px 0 0 var(--bs), var(--cel-o3) var(--cel-o3) 0 0 var(--cel-focus); }
[data-skin="cel"] .cel-btn[data-variant="neutral"] { --b: var(--cel-surface-1); --bs: var(--cel-surface-1-shade); color: var(--cel-text); }
[data-skin="cel"] .cel-btn[data-variant="danger"]  { --b: var(--cel-danger); --bs: var(--cel-danger-shade); }
[data-skin="cel"] .cel-btn:disabled { background: var(--cel-hatch), var(--cel-surface-2); color: var(--cel-text-muted); box-shadow: none; transform: none; }
@supports (corner-shape: squircle) { [data-skin="cel"] .cel-btn[data-squircle] { corner-shape: squircle; border-radius: 22px; } } /* Chromium ≥139 */

/* Card no fluxo */
[data-skin="cel"] .cel-card { background: var(--cel-surface-1); border: var(--cel-stroke) solid var(--cel-line);
	border-radius: var(--cel-radius-lg); box-shadow: var(--cel-elev-1); padding: 16px; }

/* Campo (afundado: sombra no topo interno) */
[data-skin="cel"] .cel-input { background: var(--cel-surface-2); color: var(--cel-text); border: var(--cel-stroke) solid var(--cel-edge);
	border-radius: var(--cel-radius-sm); box-shadow: var(--cel-sunken); padding: 10px 12px; font: var(--cel-weight-body) 15px/1.2 var(--cel-font-ui); }
[data-skin="cel"] .cel-input::placeholder { color: var(--cel-text-muted); }

/* Chip / badge */
[data-skin="cel"] .cel-chip { font: 700 12.5px/1 var(--cel-font-ui); padding: 6px 10px; border-radius: var(--cel-radius-pill);
	border: var(--cel-stroke-hair) solid var(--cel-line-object); background: var(--cel-accent-hl); color: var(--cel-on-fill); }

/* Barra de XP: trilho afundado, preenchimento com rim + lábio, marcas a cada 10% */
[data-skin="cel"] .cel-bar { position: relative; height: 18px; background: var(--cel-surface-2); border: var(--cel-stroke) solid var(--cel-line-object);
	border-radius: 999px; box-shadow: var(--cel-sunken); overflow: hidden; }
[data-skin="cel"] .cel-bar > i { position: absolute; inset: 0; transform-origin: left; transform: scaleX(var(--p, 0));
	background: var(--cel-xp); box-shadow: inset 0 2px 0 0 var(--cel-rim), inset 0 -4px 0 0 var(--cel-xp-shade);
	transition: transform 600ms var(--cel-ease-settle); }
[data-skin="cel"] .cel-bar::after { content: ""; position: absolute; inset: 0; pointer-events: none;
	background: repeating-linear-gradient(90deg, transparent 0 calc(10% - 1.5px), var(--cel-line-soft) calc(10% - 1.5px) 10%); }

/* Menu / popover / chrome flutuante */
[data-skin="cel"] .cel-menu { background: var(--cel-surface-3); border: var(--cel-stroke) solid var(--cel-line);
	border-radius: var(--cel-radius-md); box-shadow: var(--cel-elev-3); padding: 6px; }
[data-skin="cel"] .cel-menu [aria-selected="true"] { background: var(--cel-accent-hl); color: var(--cel-on-fill); border-radius: 8px; }

/* Diálogo + scrim com retícula (sem blur) */
[data-skin="cel"] .cel-dialog { background: var(--cel-surface-3); border: var(--cel-stroke) solid var(--cel-line);
	border-radius: var(--cel-radius-xl); box-shadow: var(--cel-elev-4); }
[data-skin="cel"] .cel-scrim { background: var(--cel-halftone), var(--cel-scrim); }

/* Tooltip (inverte tinta/papel) */
[data-skin="cel"] .cel-tooltip { background: var(--cel-text); color: var(--cel-bg); font: 650 12.5px/1 var(--cel-font-ui);
	padding: 7px 10px; border-radius: 10px; box-shadow: var(--cel-o1) var(--cel-o1) 0 0 var(--cel-accent); }

/* Toast de XP */
[data-skin="cel"] .cel-toast { font: 800 15px/1 var(--cel-font-ui); padding: 9px 14px; border-radius: 999px; background: var(--cel-xp);
	color: var(--cel-on-fill); border: var(--cel-stroke) solid var(--cel-line); box-shadow: var(--cel-elev-2); }

/* Estados de nó (DOM; no canvas, ver §11) — forma antes de cor */
[data-skin="cel"] .cel-node { width: 44px; aspect-ratio: 1; border-radius: 50%; position: relative;
	border: var(--cel-stroke) solid var(--cel-line-object); box-shadow: var(--cel-o1) var(--cel-o1) 0 0 var(--cel-shadow); }
[data-skin="cel"] .cel-node[data-state="locked"]    { background: var(--cel-hatch), var(--cel-surface-2); border-style: dashed; border-color: var(--cel-edge); box-shadow: none; }
[data-skin="cel"] .cel-node[data-state="available"] { background: var(--cel-surface-1); }
[data-skin="cel"] .cel-node[data-state="learning"]  { background: conic-gradient(var(--cel-accent) 0 calc(var(--m, .5) * 100%), var(--cel-surface-1) 0); }
[data-skin="cel"] .cel-node[data-state="review"]    { background: radial-gradient(circle at 38% 36%, var(--cel-warning) 0 58%, var(--cel-warning-shade) 59%); }
[data-skin="cel"] .cel-node[data-state="mastered"]  { background: radial-gradient(circle at 38% 36%, var(--cel-success) 0 58%, var(--cel-success-shade) 59%); }

/* Texto adesivo e anotação à mão */
[data-skin="cel"] .cel-sticker { font: 600 40px/1 var(--cel-font-display); font-stretch: 112%; color: var(--cel-accent);
	-webkit-text-stroke: 6px var(--cel-line-object); paint-order: stroke fill; text-shadow: 3px 3px 0 var(--cel-shadow); }
[data-skin="cel"] .cel-hand { font-family: var(--cel-font-hand); font-variation-settings: "INFM" 70, "BNCE" 30; color: var(--cel-text-muted); }
```

### 10.3 Ponte para os tokens existentes

Faça o mapeamento abaixo dentro de `[data-skin="cel"]`. Para usar no Tailwind, use `@theme` **não-inline**, que lê as variáveis em runtime (achado de `lh-ui-theme.md` §3.3).

| Token atual (repo) | Recebe | Observação |
|---|---|---|
| `--background` | `--cel-bg` | |
| `--card`, `--popover` | `--cel-surface-1`, `--cel-surface-3` | |
| `--muted`, `--secondary` | `--cel-surface-2` | |
| `--accent` (hover do shadcn) | `--cel-surface-1-shade` | é o hover, não o acento |
| `--foreground` e derivados | `--cel-text` | |
| `--muted-foreground` | `--cel-text-muted` | |
| `--border` | `--cel-line` | no escuro, campos sobrescrevem com `--cel-edge` (abaixo) |
| `--input` | `--cel-edge` | |
| `--ring`, `--lh-accent` | `--cel-focus` / `--cel-accent` | |
| `--lh-error`, `--lh-success`, `--lh-warning` | `--cel-*-text` | o repo usa esses tokens como **texto** (`text-error`) e como tinta (`bg-success/15`): a variante de texto serve aos dois |
| `--lh-line-strong`, `--lh-ink` | `--cel-line` | |
| `--lh-stroke`, `--lh-stroke-strong`, `--lh-stroke-hair` | `--cel-stroke`, `--cel-stroke-bold`, `--cel-stroke-hair` | |
| `--lh-shadow-xs…2xl` | `--cel-elev-1` (xs, sm), `--cel-elev-2` (md, lg), `--cel-elev-3` (xl), `--cel-elev-4` (2xl) | `lh-ui-theme.md` §4.3 |
| `--lh-radius-sm…2xl` | `--cel-radius-xs`, `-sm`, `-md`, `-lg`, `-xl` | `lh-ui-theme` sugeria 6/10/14/18/22; aqui 6/10/14/20/28 (diálogos mais "gordinhos"). Decisão menor |
| `--lh-blur`, `--lh-blur-sm` | `0px` | |
| `--font-ui` (chrome) | `--cel-font-ui` | requer o `--font-ui` em runtime |

```css
[data-skin="cel"].dark :is(input, textarea, select, [role="switch"], [role="checkbox"]) { border-color: var(--cel-edge); }
@custom-variant cel (&:where([data-skin="cel"] *));   /* utilitário: cel:shadow-cel-2 */
@theme {
	--shadow-cel-1: var(--cel-elev-1); --shadow-cel-2: var(--cel-elev-2); --shadow-cel-3: var(--cel-elev-3); --shadow-cel-4: var(--cel-elev-4);
	--radius-cel-sm: var(--cel-radius-sm); --radius-cel-md: var(--cel-radius-md); --radius-cel-lg: var(--cel-radius-lg); --radius-cel-xl: var(--cel-radius-xl);
	--color-cel-accent: var(--cel-accent); --color-cel-accent-hl: var(--cel-accent-hl); --color-cel-xp: var(--cel-xp);
	--font-cel-display: var(--cel-font-display); --font-cel-hand: var(--cel-font-hand);
}
```

### 10.4 Presets no formato atual de tema (12 cores + `skin`)

```json
{ "name": "Cel Papel", "mode": "light",
  "colors": { "background": "#FBF7EE", "surface": "#FFFFFF", "border": "#1E1B2E", "text": "#1E1B2E", "textMuted": "#5E5870",
    "accent": "#0B6DB3", "bold": "#7759BF", "italic": "#C22F5B", "code": "#BC4335",
    "error": "#C22F5B", "success": "#027957", "warning": "#995D04" },
  "skin": { "style": "cel", "ink": "#1E1B2E", "edge": "#1E1B2E", "objectLine": "#1E1B2E",
    "stroke": 2, "strokeStrong": 3, "strokeHair": 1.5, "shadow": { "x": 3, "y": 3, "color": "ink" },
    "radius": { "sm": 6, "md": 10, "lg": 14, "xl": 20, "2xl": 28 },
    "tones": { "shade": 0.13, "light": 0.10, "rimAlpha": 0.55, "shadeAlpha": 0.10 }, "specular": true, "blur": 0 } }
```

```json
{ "name": "Cel Noite", "mode": "dark",
  "colors": { "background": "#16161F", "surface": "#22222F", "border": "#07070B", "text": "#F2EEE4", "textMuted": "#A9A5BA",
    "accent": "#FFD23F", "bold": "#A98BFF", "italic": "#FD667F", "code": "#FFB020",
    "error": "#FD667F", "success": "#3DD68C", "warning": "#FFB020" },
  "skin": { "style": "cel", "ink": "#07070B", "edge": "#8C88A6", "objectLine": "#E9E4D6",
    "stroke": 2, "strokeStrong": 3, "strokeHair": 1.5, "shadow": { "x": 3, "y": 3, "color": "#000000" },
    "radius": { "sm": 6, "md": 10, "lg": 14, "xl": 20, "2xl": 28 },
    "tones": { "shade": 0.13, "light": 0.10, "rimAlpha": 0.14, "shadeAlpha": 0.30 }, "specular": true, "blur": 0 } }
```

- Contrastes das cores de ênfase no claro: `bold` 4,95 sobre papel e 5,30 sobre branco; `italic` 5,10; `code` 4,92.
- No escuro: `bold` 6,69 sobre o fundo e 5,11 sobre s3; `italic` 6,32; `code` 9,83.
- **Novos campos** em relação ao `ThemeSkin` de `lh-ui-theme.md` §4.2: `edge` e `objectLine`, para o modo escuro híbrido (§4.5). Precisam entrar em `parseThemeFile`, `writeTheme` e `exportThemeFile`.

---

## 11. Canvas do grafo em cel (complemento a `lh-ui-theme.md` §4.6)

- **Estados codificados por forma** (um `Path2D` por *bucket* de estado; o custo segue independente de N):

  | Estado | Forma | Preenchimento | Contorno |
  |---|---|---|---|
  | bloqueado | disco | hachura (`createPattern` de um tile 6×6) | tracejado `--cel-edge` |
  | disponível | anel com ponto central | `surface-1` | `line-object` |
  | estudando | disco | arco preenchido até p(domínio) (`ctx.arc` de −90° até p·360°) | `line-object` |
  | revisão devida | disco | warning com terminador | contorno e "entalhe" de relógio |
  | dominado | disco | success com terminador e especular | `line-object` |
  | próximo recomendado | qualquer um dos acima | — | sombra dura na cor do acento (offset de 3px em tela) |

- **Terminador num lote de discos** (3 `fill` por bucket):

  ```ts
  ctx.save(); ctx.clip(discs);                              // discs: Path2D com todos os discos do bucket
  ctx.fillStyle = shade; ctx.fill(discs);                   // tudo na sombra
  ctx.fillStyle = base;  ctx.fill(litDiscs);                // litDiscs: discos de raio r deslocados (−0.24r, −0.24r)
  ctx.restore();
  ctx.lineWidth = stroke / k; ctx.strokeStyle = objectLine; ctx.stroke(discs);
  ctx.fillStyle = hl; ctx.fill(specDots);                   // só no bucket "dominado"
  ```

  O deslocamento −0,24r corresponde ao `radial-gradient(circle at 38% 36%, base 0 58%, shade 59%)` do DOM.
- **Arestas:** tinta 1,5px em tela, `lineCap = "round"`. Pré-requisitos fortes em duas passadas: tinta de 3px e depois a cor de 1,5px por cima.
- **Rótulos "adesivo":** `strokeText` com a cor do fundo antes de `fillText`. Só dentro do orçamento de rótulos (`lh-ui-theme.md` §7.3).
- **Cores** lidas por `tokenHex()`: `--cel-line-object`, `--cel-accent`, `--cel-accent-shade`, `--cel-success(-shade)`, `--cel-warning(-shade)`, `--cel-edge` e `--cel-hl`. Todos já são hex, então o canvas não precisa converter OKLCH.

---

## 12. Mini guia de estilo

### 12.1 Faça

- **Uma luz, topo-esquerda.** Sombras sempre para baixo e à direita, inclusive no canvas e nos ícones.
- **Tinta em tudo que é interativo.** É o que garante o 3:1 de 1.4.11, independentemente da cor do preenchimento.
- **Texto sobre cor = tinta.** Texto colorido usa `deep` (claro) ou `lite` (escuro).
- **Tons com terminador duro.** Sombra própria na cor `shade` da própria cor, nunca preto translúcido sobre cor.
- **Escalone a elevação por camada:** fluxo = 2px, botão = 3px, menu = 4px, diálogo = 6px.
- **Respiro:** 24–32px em volta de blocos com contorno pesado. No máximo 3 acentos visíveis por tela (domínio, XP e um status).
- **Forma antes de cor** em todo estado. Teste em escala de cinza.
- **Microcopy curto.** A ilustração entra só onde não há ação. Uma frase em Shantell no máximo.
- **Celebração proporcional à raridade.** O feedback padrão é discreto: chip mais toast.

### 12.2 Não faça

- Degradê suave, blur, glassmorphism, `backdrop-filter`, sombra difusa.
- Especular em tudo (vira "clip-art"). Só no CTA primário, gema, insígnia e nó dominado.
- Borda rabiscada em componentes, ou wobble em texto.
- Fredoka em número animado ou em corpo de texto.
- Emoji como ícone, ou ícone gerado sem passar pelo compilador.
- Filtro SVG animado, ou filtro em lista.
- Logos de terceiros (YouTube, Anki, Obsidian) como ícone de recurso.
- Cor de ação (`--cel-accent`) em progresso parcial. Progresso é tinta; o acento aparece a 100%.

### 12.3 Checklist de PR (pode virar teste)

- [ ] Toda cor nova está em `cel.css` e passa no teste de contraste (§13).
- [ ] Nenhum `box-shadow` com blur > 0 sob `[data-skin=cel]`.
- [ ] Nenhum `backdrop-blur*` ou `bg-gradient-*` novo.
- [ ] Ícones novos vêm de `assets/icons/skeletons` e passam no lint de ícones.
- [ ] Animação nova tem fallback de `prefers-reduced-motion`.
- [ ] Estados novos têm forma, padrão ou ícone distintos, além da cor.

---

## 13. Plano de implementação (fases) e testes

| Fase | Entrega | Depende de | Testes |
|---|---|---|---|
| 0 | Indireção de tokens (`lh-ui-theme.md` §4.3) com o visual atual pixel-idêntico | — | `tests/render-*` existentes |
| 1 | `app/cel.css` (§10.1), presets Cel Papel e Cel Noite (§10.4), `edge` e `objectLine` no `ThemeSkin` | 0 | **Novo `tests/cel-contrast.test.ts`**: porta `contrast()` (≈15 linhas) e afirma todas as duplas da §4 (texto ≥4,5, principal ≥7, `edge` e `objectLine` ≥3, `on-fill` sobre cada acento ≥4,5) |
| 2 | Fontes (§5.3), sticker e hand; `--font-ui` em runtime | 1 | Snapshot de `layout.tsx`; checar o build do `next/font` com os eixos |
| 3 | Receitas de componentes (§10.2) aplicadas a Button, MenuShell, compositor, dock e toasts | 1 | Strings de classe nos `tests/render-*`, que já comparam classes |
| 4 | Compilador de ícones (§7.3), `generated.ts`, `Icon` e `lucide-compat`; ícones P0 | — (paralelo) | **`tests/icons.test.ts`**: viewBox `0 0 24 24`; só `fill` com `currentColor` ou `var(--icon-*)`; nenhum atributo `stroke`; bbox dentro de [1, 23]; ≤ 2,5 KB por ícone; **determinismo** (dois builds dão o mesmo hash); folha de contato PNG com `@resvg/resvg-js` |
| 5 | Microinterações (§6.3) e `MotionConfig` | 3 | Teste de que toda `@keyframes` nova tem bloco de reduced-motion |
| 6 | Canvas cel (§11) e atlas de ícones | 1, 4 | Teste do contrato `CanvasColors` |
| 7 | Ícones P1, insígnias, emblemas e empty states | 4 | Revisão visual da folha de contato |

---

## 14. Riscos e perguntas ao dono

1. **Escopo do cel:** substitui o visual atual ou é skin opcional (presets Cel Papel e Cel Noite)? A recomendação, como em `lh-ui-theme.md` §9, é skin opcional, padrão no fork.
2. **Foco por teclado:** aceitar o indicador estilizado (contorno tracejado só em `:focus-visible` no skin cel) para chegar a AAA (2.4.13), ou ficar no AA via sombra de foco (§4.6)?
3. **Escuro híbrido** (keyline em painéis e giz em objetos) ou variante "Lousa" (giz em tudo)?
4. **Fontes:** Fredoka + Nunito + Shantell Sans (recomendado), Atkinson Hyperlegible Next na prosa, ou Recursive como família única? Manter CMU Serif nos títulos de sessão? Recomendo desligar no cel, porque o contraste de estilos é forte.
5. **Nomes das tiers** de rank (§9.4) e se as insígnias variam por domínio.
6. **Esqueletos por LLM:** permitir que um modelo escreva `IconSpec` com revisão humana obrigatória na folha de contato?
7. **Riscos técnicos:**
   - `next/font` pode recusar eixos customizados da Shantell. Mitigação: `next/font/local`.
   - `corner-shape` só no Chromium (fora do Electron, cai para `round`).
   - Animar `box-shadow` em listas longas (usar pseudo-elemento).
   - `polygon-clipping` teve a última versão em 2023-12. É estável e roda só no build; alternativa: `clipper2`.
   - Testes de render que comparam strings de classe vão quebrar nas fases 3 e 4. Isso é esperado.

---

## 15. Artefatos desta pesquisa (scratchpad; efêmeros, fora do repo)

- Protótipo do compilador: `C:\Users\nicoolas\AppData\Local\Temp\claude\93f77aa8a8fded61\ce8a727e-bf7b-4ba7-a17e-a44935702d32\scratchpad\proto\build-icons.mjs`. Saídas em `...\scratchpad\proto\out\` (SVGs claro, escuro e boil, e `sheet.png`, a folha de contato a 16/24/48/96px).
- Demo dos tokens: `C:\Users\nicoolas\AppData\Local\Temp\claude\93f77aa8a8fded61\ce8a727e-bf7b-4ba7-a17e-a44935702d32\scratchpad\r9v\demo.html` com `...\scratchpad\r9v\cel-tokens.css`. Os dois modos ficam lado a lado (o demo usa `data-theme` em vez de `.dark`/`.light`).
- Scripts de cor e contraste: `...\scratchpad\pal.py`, `run1.py`, `run2.py`, `run3.py`. Curvas de mola: `...\scratchpad\spring.py`. Verificação de dígitos e GSUB: `...\scratchpad\feat.py`, `digits.py`.

---

## 16. Fontes

**Teoria e pesquisa**

- Lake et al., NPAR 2000, <https://doi.org/10.1145/340916.340918>
- Gooch et al., SIGGRAPH 98, <https://doi.org/10.1145/280814.280950>
- Anjyo & Hiramitsu, IEEE CG&A 2003, <https://doi.org/10.1109/MCG.2003.1210865>
- Barla, Thollot, Markosian, NPAR 2006, <https://doi.org/10.1145/1124728.1124749>
- Motomura, GDC 2015, <https://www.gdcvault.com/play/1022031/GuiltyGearXrd-s-Art-Style-The>
- <https://en.wikipedia.org/wiki/Cel_shading>
- <https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation>
- ToonCrafter <https://arxiv.org/abs/2405.17933>
- StarVector <https://arxiv.org/abs/2312.11556>
- OmniSVG <https://arxiv.org/abs/2504.06263>
- Chat2SVG <https://arxiv.org/abs/2411.16602>
- SVGDreamer <https://arxiv.org/abs/2312.16476>
- LLM4SVG <https://arxiv.org/abs/2412.11102>
- SketchAgent <https://arxiv.org/abs/2411.17673>
- OKLab <https://bottosson.github.io/posts/oklab/>

**Estilo aplicado**

- NN/g, *Neobrutalism* (2025-04-11), <https://www.nngroup.com/articles/neobrutalism/>
- neobrutalism-components (MIT), <https://github.com/ekmas/neobrutalism-components> (`src/styling/globals.css`, `src/components/ui/button.tsx`)
- Excalidraw (MIT), <https://github.com/excalidraw/excalidraw> (`packages/element/src/types.ts`, `packages/element/src/shape.ts`)
- Wired Elements (MIT), <https://github.com/rough-stuff/wired-elements>

**Bibliotecas e ferramentas**

- perfect-freehand 1.2.3 (MIT), <https://github.com/steveruizok/perfect-freehand>
- Rough.js 4.6.6 (MIT), <https://github.com/rough-stuff/rough>, opções em <https://github.com/rough-stuff/rough/wiki>, gerador em <https://github.com/rough-stuff/rough/wiki/RoughGenerator>
- polygon-clipping 0.15.7 (MIT), <https://github.com/mfogel/polygon-clipping>
- svg-path-properties 2.2.0 (ISC), <https://www.npmjs.com/package/svg-path-properties>
- SVGO v4 (MIT), <https://github.com/svg/svgo/releases/tag/v4.0.0>
- motion 14.14.0 (MIT): <https://motion.dev/docs/react-transitions>, <https://motion.dev/docs/react-accessibility>, <https://github.com/motiondivision/motion/blob/main/CHANGELOG.md>, <https://github.com/motiondivision/motion/blob/main/packages/motion-dom/src/animation/generators/spring.ts>
- Gerador de `linear()`, <https://linear-easing-generator.netlify.app/>

**Ícones**

- Lucide (ISC + MIT do Feather): guia em <https://lucide.dev/guide/design/icon-design-guide>, licença em <https://github.com/lucide-icons/lucide/blob/main/LICENSE>
- Phosphor core (MIT; *duotone* = camada a 20% + contorno preenchido), <https://github.com/phosphor-icons/core>
- Tabler (MIT), <https://github.com/tabler/tabler-icons>
- Iconoir (MIT), <https://github.com/iconoir-icons/iconoir>
- Doodle Icons (CC0), <https://khushmeen.com/icons.html>
- Iconoodle (MIT), <https://github.com/NK2552003/Iconoodle>

**Web platform**

- MDN: `feTurbulence` <https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feTurbulence>, `feDisplacementMap` <https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feDisplacementMap>, `linear()` <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/easing-function/linear>, `corner-shape` <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/corner-shape>
- `@mdn/browser-compat-data` 8.1.9 (via unpkg)
- Electron releases, <https://releases.electronjs.org/releases.json> (44.11.4 → Chromium 152.0.7977.169)

**Acessibilidade**

- WCAG 2.2, Focus Appearance, <https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html>
- Contrast (Minimum), <https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html>
- Non-text Contrast, <https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html>
- WCAG 3.0 WD (2026-09-10), <https://www.w3.org/TR/wcag-3.0/>

**Tipografia**

- Metadados do Google Fonts, <https://fonts.google.com/metadata/fonts>
- Repositório google/fonts, <https://github.com/google/fonts> (`ofl/fredoka`, `ofl/nunito`, `ofl/shantellsans`, `ofl/recursive`, `ofl/atkinsonhyperlegiblenext`, `ofl/winkyrough`, `ofl/googlesansflex/TRADEMARKS.md`)
- next/font, <https://nextjs.org/docs/app/api-reference/components/font>

**Internas (repo)**

- `docs/research/lh-ui-theme.md`, `docs/research/ref-deeptutor-web.md`, `docs/research/ref-bloomtutor-ui.md`
- `_refs/DeepTutor/web/components/chat/home/StarterIcons.ts`, `_refs/DeepTutor/web/components/space/learning/ProgressRing.tsx` (lidos, não executados)
- `app/globals.css`, `app/layout.tsx`, `package.json`
