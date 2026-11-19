# Módulo `icons-theme` — ícones cel à mão e os temas Cel Papel / Cel Noite

Implementa a SÍNTESE §2.12 seguindo o r9: as sete leis do cel shading (§2.3), a cor (§4), o compilador de ícones (§7.2–§7.4), as regras de ícone (§8), o inventário P0/P1/P2 e as insígnias (§9.3–§9.4) e os tokens (§10.1). O compilador é **determinístico**: os mesmos esqueletos geram sempre os mesmos bytes, e os testes conferem que os arquivos commitados estão em dia.

## API pública

| Arquivo | Exporta | Papel |
|---|---|---|
| `components/icons/icon.tsx` | `<Icon name size? tone? soft? title? micro? live?>`, `IconProps`, `sizeFromClassName`, `iconLayers` | Desenha as camadas fill → shade → tinta sobre cor → tinta → hl. Usa só `currentColor` e variáveis CSS. É decorativo por padrão (`aria-hidden`); com `title` vira `role="img"`. Em ≤ 16 px usa a tinta micro, e o brilho só aparece a partir de 20 px. `live` liga o boil de 3 quadros. Não tem hooks: funciona no servidor e no cliente. |
| `components/icons/generated.ts` | `ICONS`, `ICON_NAMES`, `ICON_ALIASES`, `IconName`, `IconAlias`, `IconLayers`, `isIconName`, `resolveIconName` | Gerado: 138 ícones e 9 aliases (`hint`, `today`, `hours`, `x`, `gem`…). `IconLayers` tem `fill`, `shade`, `ink`, `hl`, `micro`, `boil` e as metades sobre cor `inkOnFill`, `microOnFill`, `boilOnFill`. |
| `components/icons/tones.ts` | `ICON_TONES`, `IconTone`, `SEMANTIC_TONES`, `RAMP_TONES`, `METAL_TONES`, `toneVars`, `layerPaint(layer, tone)`, `isIconTone` | Tom → tokens CSS. `layer` é `fill`, `shade`, `onFill`, `ink` ou `hl`. `accent` segue o domínio; status e XP não seguem. Fora do cel, todo tom resolve para `transparent`. |
| `components/icons/lucide-compat.ts` | 71 componentes com os nomes do lucide-react (`XIcon`, `SearchIcon`…), `LUCIDE_COMPAT`, `compatIconName`, `LucideIcon` | Troca direta: muda só o `import`. `strokeWidth` é ignorado e `color` vira `currentColor`. |
| `public/icons/sprite.svg` | `<symbol id="<nome>">` com `<title>` | Para plugins, `<use href>` e o atlas do canvas. As cores vêm das mesmas expressões de `layerPaint`. |
| `scripts/icons/compile.ts` | CLI `npx tsx scripts/icons/compile.ts [--check]`; `compileIcon`, `compileAll`, `compileInk(name, spec, frame?, micro?, mask?) → InkLayers`, `onFillMask`, `syncOutputs`, `renderedBytes`, `INK`, `fnv1a` | Esqueleto → tinta. Com `--check`, sai com 1 se as saídas estiverem desatualizadas. `syncOutputs` compara ignorando CRLF e grava com `writeFileAtomicSync` (temp + rename). |
| `scripts/icons/emit.ts` | `emitGenerated`, `emitSprite`, `iconPaths`, `standaloneSvg`, `inkVariant` | Gera o TS e o sprite. A tinta sobre cor sai antes da tinta, com a classe `icon-ink-on-fill`. |
| `scripts/icons/defs/*.ts` | `ICON_DEFS`, `ICON_ALIASES` | Esqueletos à mão: glyphs, sistema/arquivos, objetos, estados de nó, progresso e 7 × 3 insígnias. |
| `scripts/icons/sheet.ts` | CLI `npx tsx scripts/icons/sheet.ts [--out f.png] [--only a,b] [--big] [--soft] [--boil]` | Folha de contato via @resvg/resvg-js, para revisão visual. |
| `src/core/themes.ts` | presets `cel-papel` e `cel-noite` (`family: "cel"`), `ThemeFamily`, `themeFamily`, `themeRootAttributes`, `CEL_RAMPS`, `CEL_METALS`, `CEL_NEUTRALS`, `CEL_DOMAIN_RAMPS`, `CEL_STATUS_RAMPS`, `celTokens(mode, domain)`, `celPrimitiveTokens()`, `wcagContrast`, `wcagLuminance`, `hexChannels` | Cores cel em hex para o canvas e os testes. `parseThemeFile` e `exportThemeFile` preservam `family`. |
| `app/globals.css` (bloco `═══ CEL ═══`) | tokens `--c-*` e `--cel-*`; `.cel-card`, `.cel-button` (`-primary`, `-danger`, `-success`, `-xp`, `-ghost`), `.cel-chip`, `.cel-input`, `.cel-display`, `.cel-boil` | Só vale sob `[data-theme-family="cel"]`. O claro usa `.light` ou `[data-theme-mode="light"]`, e `data-domain="english"` troca o acento para coral. Respeita `prefers-reduced-motion`. |

## Decisões

- **Pipeline do compilador.** Os passos seguem o r9 §7.2:
  1. Achata e reamostra a cada 0,3.
  2. Aplica wobble de 0,22 com ruído de valor (comprimento de onda 7) e pressão 0,5 ± 0,12.
  3. Passa pelo perfect-freehand com size 2,1·w, thinning 0,32, smoothing 0,6 e streamline 0,2.
  4. Une tudo com `polygon-clipping.union` e simplifica com RDP de anel fechado (ε 0,04).
  5. Codifica em relativo com 2 casas decimais.
- **Sementes.** A semente é `FNV-1a(nome)`. Cada traço tem o próprio fluxo (`+ i·0x9E3779B1`), então mexer em um traço não redesenha os outros. O boil usa `+ k·7919`.
- **perfect-freehand sem as heurísticas de entrada ao vivo.** `getStroke` descarta os primeiros `size` px e os últimos 3 px do traço. Num grid de 24, isso apagava tracinhos e a barra do "A".
  - Montamos os stroke points e chamamos `getStrokeOutlinePoints` em escala ×16.
  - O taper é limitado a 16 % / 24 % do comprimento do traço.
- **A sombra própria não usa operação booleana.** É um clip Sutherland–Hodgman contra o meio-plano a 45° (`geometry.ts clipToShadow`). O corte é bisseccionado até cobrir 38 % da área.
  - A interseção do `polygon-clipping` falhava ("Unable to complete output ring") em silhuetas com wobble.
  - Clipar contra um meio-plano é exato anel a anel.
- **LOD.** A tinta micro (≤ 16 px) remove os traços `detail` e fica 15 % mais grossa. As insígnias (grid 48, família display) usam ε 0,06 por 24 unidades: o pior caso fica em 2180 B, dentro do orçamento de 2,4 KB.
- **Tema clássico intacto.** Camadas de tom pintam com `var(--icon-fill, var(<token do tom>, transparent))`. Nos 11 temas clássicos os tokens cel não existem, e o ícone vira um ícone de linha limpo.
  - O bloco CSS não redeclara nenhum token clássico, e todo seletor dele é gated ou `.cel-*`. Os testes conferem as duas coisas.
  - As utilities têm fallback para os tokens shadcn, então funcionam em qualquer tema.
- **Os 12 campos clássicos do preset cel.** `accent` = cor de foco/link (≥ 3:1). Os acentos de domínio (volt, coral) e o XP (grape) são tokens cel, porque o vocabulário de 12 cores não tem onde guardá-los.
  - Os neutros cel (bg, surface-1, text, textMuted, edge) são iguais às cores dos presets; os testes conferem.
  - Overrides de cor do usuário mudam só o vocabulário clássico. Os tokens cel são um sistema fixo.
- **Texto sobre cor é sempre tinta** (`--cel-on-fill`), ≥ 4,5:1 sobre a base e o tom claro de cada rampa e metal, e ≥ 3:1 sobre a sombra.
  - Vale também para os ícones. No Cel Noite, a tinta giz (`currentColor`) sobre o tom ficava entre 1,1 e 1,9:1: o check do exercício, o "Aa" do inglês e os ponteiros sumiam.
  - O compilador separa a tinta inteiramente sobre o preenchimento (`onFillMask`): todo ponto da linha central fica dentro do fill e a pelo menos meia espessura da borda. Pontos seguem a mesma regra com o raio.
  - Essa metade sai em `inkOnFill`, `microOnFill` e `boilOnFill` e pinta com `layerPaint("onFill", tom)` = `var(--icon-ink-on-fill, var(--cel-on-fill, var(--icon-ink, currentColor)))`.
  - O contorno e os traços que cruzam a borda continuam `currentColor`, porque separam a figura do fundo.
  - Exceções:
    - O tom `neutral` (cadeado, nó disponível) continua com a tinta normal.
    - Com `tone={false}`, as duas metades usam a tinta normal.
    - Fora do cel, `--cel-on-fill` não existe e tudo volta a `currentColor`.
  - Um container que troque `--icon-fill` por uma cor escura deve definir também `--icon-ink-on-fill`.
- **Brilho especular só onde a lei 5 deixa:** gema de XP, escudos de nível, insígnias e nó dominado. O troféu era o único fora dessa lista e ficou fosco; um teste fixa a lista.
- **Margem.** Toda tinta fica em [1, grid − 1]. As insígnias usam 1 unidade de folga no grid 48, não 2.
- **Saídas atômicas.** `compile.ts` grava `generated.ts` e `sprite.svg` com temp + rename (`src/store/atomic-write.ts`), com fallback in-place no Windows. O `--check` não grava nada e trata CRLF/LF como iguais (`core.autocrlf=true`).
- **`app/globals.css` em LF.** O arquivo estava em CRLF, o que quebrava `tests/themes.test.ts` ("Default reproduces…"), que compara o bloco `:root` com uma string LF. Agora é LF, e um teste impede a volta do CRLF.
- **Foco.** A "lei sem anel" do app proíbe o outline do navegador. `.cel-button` e `.cel-input` desenham uma faixa de foco própria com `box-shadow`.
- **Desabilitado se lê pela forma:** tinta tracejada, sem sombra.
- **Boil** em `.cel-boil` tem 3 quadros empilhados.
  - Fora do cel, ou com movimento reduzido, só o primeiro quadro aparece.
  - No cel, os quadros alternam em degraus a 8 fps (`--cel-boil-dur: 375ms`), sem interpolação.

## Como testar

```bash
node scripts/run-tests.mjs "tests/cel-*.test.ts"   # 61 testes: tokens/CSS, WCAG, família, ícones, <Icon>
npx tsx scripts/icons/compile.ts --check           # saídas commitadas em dia
npx tsx scripts/icons/compile.ts                   # regenerar após editar scripts/icons/defs/*.ts
npx tsx scripts/icons/sheet.ts --big               # folha de contato em os.tmpdir()/cel-icons-sheet.png
```

- `tests/cel-contrast.test.ts` cobre:
  - o bloco CSS fixado a `celTokens` e `celPrimitiveTokens` (papel, noite, inglês, domínio aninhado);
  - escala de tinta e sombras duras, sem blur nem gradiente;
  - isolamento dos temas clássicos;
  - WCAG AA de todos os pares nos dois modos e nos presets;
  - tinta sobre cor contra base, sombra e tom claro de toda rampa e metal; o contorno contra todo fundo;
  - `globals.css` sem CRLF;
  - propriedades fast-check de `wcagContrast`.
- `tests/cel-icons.test.ts` cobre:
  - determinismo: compila 2×, emite 2× num diretório temporário, e as saídas commitadas batem;
  - `syncOutputs` num diretório temporário: CRLF conta como em dia, `--check` não grava, nenhum `.tmp-` sobra;
  - erros de esqueleto degenerado (sem tinta, nome fora de kebab-case, glyph com fill/hl, fill sem área, path inválido);
  - ≤ 2,4 KB por ícone, incluindo micro, boil e as metades sobre cor;
  - geometria em [1, grid − 1] e sombra em ~38 % do lado escuro;
  - separação da tinta sobre cor: os ícones esperados e um esqueleto sintético com traço interno, traço que cruza a borda e pontos; a ordem e a pintura no sprite, no `standaloneSvg` e no `<Icon>`;
  - a lista de ícones com brilho especular;
  - inventário P0, as 21 insígnias (pips contados) e todo nome do lucide-compat;
  - ausência de cor literal;
  - `<Icon>` renderizado no servidor (a11y, LOD, tom, boil, alias) e os componentes compat;
  - fast-check com esqueletos aleatórios.

## Pendências de integração (fora deste módulo)

- **Ninguém põe `data-theme-family` no `<html>`.** Sem esse atributo, o bloco cel nunca ativa.
  - `app/layout.tsx` precisa espalhar `themeRootAttributes(theme)`.
  - O efeito de `components/settings/appearance.tsx` precisa chamar `root.setAttribute("data-theme-family", themeFamily(activeTheme))`.
- **`electron/appearance-chrome.cjs` (`PRESET_APPEARANCE`)** precisa de:
  - `"cel-papel": { mode: "light", background: "#fbf7ee" }`
  - `"cel-noite": { mode: "dark", background: "#16161f" }`

  Hoje o Cel Papel abre escuro, em `#141414`. O teste "native boot projection…" falha por isso.
- **`tests/themes.test.ts`**: a lista de ids de preset precisa de `"cel-papel"` e `"cel-noite"`.
