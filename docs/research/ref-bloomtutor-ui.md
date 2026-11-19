# BloomTutor: análise de produto e UI (ref-bloomtutor-ui)

> Fonte analisada: `C:\Users\nicoolas\Pictures\learnharness\_refs\BloomTutor` (somente leitura, nada foi executado).
> Escopo: `frontend/**`, `extension/**`, `integrations/**`, `site/**`, `assets/**`, `package.json` e as features do README. Algumas leituras pontuais no `backend/` serviram para confirmar regras de streak, progresso e eventos.
> Data da análise: 2026-11-18.

---

## 0. TL;DR

- **O que é:** BloomTutor ("Bloom, 2-Sigma AI Tutor") é um tutor de IA local, de um único usuário e sem login. O usuário dá um objetivo ou material (tópico, pasta de projeto, página web ou PDF). Um modelo de linguagem gera um *outline* com itens de domínio em forma de checkbox e depois **uma lição por vez**, sob demanda. A leitura é anotável: o usuário seleciona texto e escolhe **Ask**, **Mark** ou **Translate**. O feedback do aluno ajusta a lição seguinte. Um **mapa de conhecimento** posiciona cada curso numa taxonomia congelada da Wikipedia (Vital Articles nível 5).
- **Versão e estado:** v0.3.0 (CHANGELOG de 2026-11-12). O HEAD `5f13f54` é de 2026-11-17. Projeto muito novo e ativo. Licença **MIT**.
- **Stack de UI:** Next.js 15.5 (App Router) + React 19 + Tailwind 4 + Radix/shadcn + next-intl (en/zh) + react-markdown com KaTeX. Backend FastAPI (fora do escopo, só consultado).
- **Gamificação:** **não há XP, nível, ranking nem conquistas.** Existe só *streak* atual e máximo (qualquer evento num dia local conta), contadores (cursos, lições lidas, perguntas), heatmap de 26 semanas, calendário mensal e saudação por período do dia. **Não há estatística de tokens nem de tempo de estudo.**
- **Integrações:** **não há Anki, Obsidian, Notion, flashcards nem SRS.** Existem um web clipper para Chrome (MV3), plugins de CLI (Claude Code marketplace e DeepSeek Harness), importação de PDF, projeto ou URL, export de notas em Markdown e Langfuse opcional no backend.
- **Modelos:** qualquer endpoint OpenAI-compatible, configurado por variáveis de ambiente (`LLM_MODEL`, `LLM_FAST_MODEL`, `PDF_READING_MODEL`). **Não há seletor de modelo na UI.**
- **O que mais vale copiar:**
  1. A arquitetura de tokens de tema, que separa `primary` de preenchimento de `primary-text` com contraste garantido, e testes que impõem isso.
  2. O padrão de espera honesta: progresso assintótico mais "Waited Xs" mais "isso costuma levar ~N s".
  3. A bolha de seleção com pontos na margem, ancorada pela CSS Custom Highlight API sem mutar o DOM.
  4. O fluxo *clarify* de 1 ou 2 perguntas com chips antes de criar um curso.
  5. A galeria de estilos de ensino e o escopo de feedback (`auto/next/course`).
  6. O plano de ensino `repair/consolidate/advance`, com no máximo 1 ou 2 conceitos novos por lição.
  7. O princípio "**nenhuma chamada de modelo sem clique**", imposto por teste.
  8. O `StatStrip`, o `MiniHeatmap` e o calendário de atividade.
  9. O esquema de arestas tipadas e versionadas do grafo.
- **O que evitar:**
  - o arquivo monolítico `lesson.tsx` (2467 linhas);
  - o mapa raso, preso a um snapshot da Wikipedia;
  - a falta de seletor de modelo;
  - a "revisão" que é só recapitulação na lição seguinte, sem SRS;
  - o diálogo bloqueante de criação;
  - o gate de "Finished reading" para progresso;
  - a seção obrigatória de perguntas de reflexão no fim de toda lição;
  - a estética verde plana, oposta ao cel shading pretendido.

---

## 1. Identificação, versão e licença

| Item | Valor |
|---|---|
| Repositório | `github.com/Li-Evan/BloomTutor` |
| Versão do app | 0.3.0 (`CHANGELOG.md`, 2026-11-12) |
| HEAD clonado | `5f13f54` de 2026-11-17, "docs: install the DSH plugin from npm (bloomtutor-dsh 0.1.0) (#21)" (clone raso, 1 commit) |
| Licença do código | **MIT**, "Copyright (c) 2026 Li Zhengping" (`LICENSE`) |
| Componentes shadcn/ui | MIT, (c) 2023 shadcn (`frontend/src/components/ui/*`) |
| Fontes | Outfit, Public Sans e JetBrains Mono em subsets Latin, **SIL OFL 1.1** (`frontend/src/fonts/`) |
| Dados de conhecimento | Wikipedia Vital Articles L5 (**CC BY-SA 4.0**) + Wikidata (**CC0**) em `backend/data/knowledge/l5-2026.11.json.gz` |
| `package.json` da raiz | Não é o app. É o pacote npm `bloomtutor-dsh` 0.1.0, um plugin do DeepSeek Harness |

**Compatibilidade com o nosso fork (AGPL-3.0):**
- Código MIT pode ser incorporado; é preciso manter o aviso de copyright e a licença MIT, por exemplo em `THIRD_PARTY_NOTICES`.
- As fontes OFL podem ser empacotadas, desde que não sejam vendidas isoladamente e o arquivo de licença acompanhe.
- O snapshot da Wikipedia (CC BY-SA 4.0) exige atribuição e *share-alike* **dos dados**. Não "contamina" o código, mas qualquer derivado do JSON precisa sair sob CC BY-SA. A CC BY-SA 4.0 é compatível *one-way* com a GPLv3.

---

## 2. Stack e arquitetura relevantes para a UI

### 2.1 Dependências (`frontend/package.json`)
- **Framework e estilo:** Next.js 15.5.27 (App Router, `output: "standalone"`), React 19, Tailwind CSS 4 (`@tailwindcss/postcss`), `tailwindcss-animate` e `@tailwindcss/typography`.
- **Primitivas:** Radix (avatar, dialog, dropdown-menu, label, select, slot, tooltip). As versões shadcn ficam em `src/components/ui/`.
- **Utilitários de interface:** `next-intl` 4 (en sem prefixo, zh em `/zh`, `localePrefix: "as-needed"`), `next-themes`, `sonner` (toasts), `lucide-react` e `react-icons`.
- **Conteúdo:** `react-markdown` 10 + `remark-gfm` + `remark-math` + `rehype-katex` + `remark-cjk-friendly`, com `katex` 0.17 e `pdfjs-dist` 6.4.299.
- **Comunicação com o backend:** `jose` (JWT) e `undici`.
- **Testes:** `node:test`, com 77 arquivos `*.test.mjs`. Vários são **testes de fonte** que leem o código e impõem regras de design (seção 7.9).

### 2.2 Caminho de requisição
- **Server Components:** usam `src/lib/backend.ts`, que assina um **JWT HS256** com `BACKEND_JWT_SECRET`, issuer `bloom-frontend`, válido por 15 min.
- **Browser:** chama `/api/backend/...` (proxy em `src/lib/backend-proxy.ts`) e obtém o token em `/api/token`.
- **Agrupamento de GETs:** GETs concorrentes viram um único `POST /api/batch` com resposta **NDJSON** (`src/lib/batch.ts`, `MAX_BATCH = 12`). Se o batch falhar, volta para requisições individuais.
- **Cache:** há um cache de leitura por aba em `src/lib/read-cache.ts`.
- **SSE:** idle timeout de 120 s, connect timeout de 180 s e heartbeat a cada 10 s.
- **Registro `running`** (`src/lib/learn/running.ts`): uma stream iniciada continua mesmo se o usuário trocar de página ("começou, termina"). No backend, a geração da lição roda numa *worker thread*, então fechar a aba não perde a lição.
- **Concorrência:** uma geração por curso por vez; o backend responde **409** se houver outra.

### 2.3 Princípio "nenhuma cobrança automática"
- Chamadas de modelo só acontecem por **clique explícito**:
  - refresh de recomendações;
  - "Update map";
  - gerar a próxima lição;
  - criar curso.
- Carregar páginas é sempre só leitura. Exemplo: `loadNextData()` em `src/lib/learn/api.ts` nunca dispara um refresh.
- Dois testes impõem isso:
  - `no-auto-charge.test.mjs`;
  - `no-billing-ui.test.mjs`, que proíbe as palavras `credits`, `billing`, `pricing` e `subscri` na UI.
- **Relevância para nós:** como usaremos IA por assinatura, com cota limitada, esse princípio economiza a cota e deixa o usuário no controle.

### 2.4 Modelos
- O modelo vem só de variáveis de ambiente:
  - `LLM_MODEL` (principal);
  - `LLM_FAST_MODEL` (mapa de conhecimento, posicionamento e tradução);
  - `PDF_READING_MODEL` (visão);
  - `LLM_EXTRA_BODY`;
  - `LANGFUSE_*`, opcional, para tracing.
- O grep no frontend por `LLM_MODEL|modelPicker|selectModel` não achou nada. O comentário em `annotation-panel.tsx` sobre "seleção compacta de modelo" está obsoleto.

---

## 3. Mapa de rotas e navegação

Header sticky `h-16`, com navegação **My courses / Learn next / Knowledge map** e, à direita, links para GitHub, idioma, tema e avatar.

| Rota | Conteúdo |
|---|---|
| `/` | redirect para `/learn` |
| `/learn` | Dashboard: ContinueBanner, StatStrip e grade de cursos; `?new=topic\|project\|web\|pdf` e `?url=` abrem o diálogo de criação |
| `/learn/next` | Recomendações (3 lanes) e wishlist |
| `/learn/map` | Mapa de conhecimento |
| `/learn/clip` | Recebe captura do web clipper (`?clip=id` ou `?error=...`) |
| `/learn/course/[courseId]` | Timeline de lições, ProgressCard, CoordinateCard e resumo |
| `/learn/course/[courseId]/syllabus` | Revisão e edição do outline |
| `/learn/course/[courseId]/lesson/[lessonNum]?annotation=id` | Página de leitura |
| `/me` | Visão geral: saudação, streak, Continue, StatStrip, MiniHeatmap, notas recentes e wishlist |
| `/me/activity` | Calendário mensal, detalhe do dia e StatStrip de 5 colunas |
| `/me/notes` | Navegador de notas com busca, filtro e export Markdown |
| `/me/settings` | Perfil, Exibição, Aprendizado e Dados |
| `/me/teaching` | Estilo de ensino e registros de feedback ativos |

Navegação do `/me` (`components/me/nav.tsx`): sidebar sticky no desktop e abas roláveis horizontais no mobile.

---

## 4. (a) Fluxos de UX

### 4.1 Onboarding e primeira visita
- **Sem conta, sem login, sem tour.** A primeira tela é `/learn` com um *empty state* (`components/learn/empty-courses.tsx`).
- O empty state mostra **3 cards de "formas de começar"** (constante `WAYS`): tópico, projeto/material e web/PDF. Cada card leva ao diálogo de criação já no modo certo.
- O empty state usa `EmptyAction` (`components/learn/empty-state.tsx`): card com a curva de sino da marca, título, texto e botões. Para listas vazias secundárias existe o `EmptyHint`, de borda tracejada e uma linha.
- **Dica de primeira lição** (`components/learn/ask-hint.tsx`): aparece uma única vez, com chave `localStorage` `bloom:hint:ask-dismissed`. O texto difere entre toque ("toque e segure...") e mouse ("selecione...").
- **Erros reais:** cada mensagem de erro do backend é mapeada para um texto legível. `backend-errors.test.mjs` garante que todos estão mapeados.

### 4.2 Criar curso, ou "escolher tópico" (`components/learn/new-course-dialog.tsx`)
1. **Modo** (constante `MODES`, em grade de 2 colunas; *topic* e *pdf* ocupam a linha inteira):
   - `topic` (ícone `Lightbulb`): objetivo em texto livre;
   - `project` (`FolderOpen`): pasta de arquivos;
   - `web` (`Link2`): URL;
   - `pdf` (`ScanText`, badge **Experimental** em âmbar): leitura guiada de PDF.
2. **Objetivo:** textarea de até 2000 caracteres.
3. **Clarify** (`POST /api/courses/clarify`), que devolve `GoalAnalysis {title, summary, assumptions, questions[{question, options[]}]}`.
   - Aparece um `fieldset` com fundo `bg-accent/60` e **1 ou 2 perguntas**. Cada pergunta tem **chips de opção** (`aria-pressed`) e um textarea livre.
   - O link **"Design with what I've shared"** pula as perguntas (`skip_questions`).
   - **Timeout** do clarify: o fluxo segue com a entrada original, sem travar. **Falha**: oferece "Continue with what I entered".
   - Estilo do chip selecionado:
     ```ts
     selected ? "border-ring bg-accent text-accent-foreground"
              : "border-border bg-card hover:border-primary/40"
     ```
4. **Profundidade** (botões com dica): `simple` (8 a 10 pontos de domínio), `standard` (10 a 12) e `deep` (12 a 15).
5. **Idioma do curso:** fixado depois da criação.
6. **Materiais opcionais:**
   - drop em qualquer lugar do diálogo;
   - até 50 arquivos PDF, TXT ou MD (`MATERIAL_MAX_FILES = 50`);
   - referência colada de até 50.000 caracteres;
   - PDF reading: no máximo 5 arquivos e 100 páginas (`PDF_READING_MAX_FILES = 5`, `PDF_READING_MAX_PAGES = 100`);
   - upload em chunks com `upload_id`.
7. **CreatingDialog** (`components/learn/creating-dialog.tsx`): diálogo **bloqueante** com a curva de sino animada em loop, uma lista de etapas (feita = check, atual = ponto pulsante, futura = apagada), barra de progresso, "Waited Xs" e mensagem quando passa do tempo típico.
   ```ts
   // FLOWS (ms)
   topic:     { steps: [analyze, syllabus, finish], at: [0, 15000, 45000],  typical: 30000, slowAfter: 75000 }
   materials: { steps: [parse, merge, syllabus],    at: [0, 40000, 100000], typical: 90000, slowAfter: 200000 }
   project:   { steps: [read, finish],              at: [0, 4000],          typical: 4000,  slowAfter: 20000 }
   pdf:       { steps: [render, convert, finish],   at: [0, 5000, 50000],   typical: 50000, slowAfter: 180000 }
   // progresso: assintótico, nunca chega a 100% antes do fim real
   progress = 92 * (1 - Math.exp(-elapsed / typical))   // no upload usa a fração real enviada
   ```
8. **Cursos pendentes** (`src/lib/learn/pending-courses.ts`):
   - se o usuário sai da página, o dashboard continua acompanhando a criação;
   - polling a cada 5 s (`POLL_RUNNING_MS`); quando parece travado, a cada 60 s (`POLL_STALLED_MS`), por até 30 min (`POLL_STALLED_WINDOW_MS`);
   - pausa quando a aba está oculta;
   - esquece o pendente depois de 24 h (`PENDING_FORGET_MS`);
   - evento `bloom:pending-courses-changed` para sincronizar componentes.

### 4.3 Revisão do outline antes da primeira lição (`components/learn/syllabus.tsx`)
- Título "Shape your outline first". O syllabus é **Markdown com checkboxes**: cada `- [ ]` é um item de domínio, e há uma seção "out of scope".
- Duas formas de ajustar:
  - **editar o Markdown diretamente** (até 50.000 caracteres, `PUT /syllabus`);
  - **escrever ideias** (até 20.000 caracteres) e regenerar (`POST /syllabus/regenerate`).
- Confirmar chama `POST /first`, que gera a lição 1. Depois disso o outline **trava**.
- Jobs longos retomam depois de o usuário navegar para fora (`src/lib/learn/syllabus-job.ts`). A conclusão é sinalizada com `done-flash`, um pulso de borda.
- Checkboxes estilizados via `.syllabus-prose` em `globals.css`: preenchimento `primary` com check em SVG.

### 4.4 A aula (`components/learn/lesson.tsx`, 2467 linhas)

**Layout (desktop xl):** três colunas.
- **Esquerda:** TOC sticky, só em `xl`.
- **Centro:** prosa de 720 px, classe `.prose-bloom`, 16 px (17 px a partir de 768 px), `line-height: 1.85`, tudo multiplicado por `--text-scale`.
- **Direita:** trilho sticky (`.learn-rail`) com:
  - `LessonChatEntry` (chat sobre a lição);
  - `TeachingStyleControl`, em destaque com `border-primary/20 bg-accent`;
  - `LessonNav`, com a lista de capítulos e os grupos *questions / marks / translations*.
- Em `< lg`: o `CrumbBar` (h-14, sticky sob o header, some ao rolar para baixo) ocupa duas linhas, e o chat vira um **botão flutuante (FAB)**.

**Topo da lição:**
- `.lesson-meta`: linha pequena em fonte mono com pré-requisitos, dificuldade e tempo de leitura. O tempo usa 240 palavras/min ou 400 caracteres CJK/min (Brysbaert 2019, em `src/lib/learn/reading-time.ts`).
- Linha do plano de ensino: `{action}: {focus}`, com `border-l-2 border-ring pl-3`. A ação é `repair`, `consolidate` ou `advance`.

**Interação de leitura: o padrão mais valioso**
1. O usuário seleciona texto e aparece uma **bolha** (`src/lib/learn/bubble.ts`, `placeBubble`).
   - Pílula `bg-primary h-8` com seta, gap de 8 px, posicionada acima ou abaixo conforme o espaço.
   - Botões **Ask**, **Mark** e **Translate**. Translate só aparece se o texto estiver em idioma diferente do curso.
2. **Ask** abre um painel (`annotation-panel.tsx`) com a pergunta sobre o trecho.
   - A resposta chega por streaming SSE e permite follow-ups.
   - No mobile, o painel vira um drawer no rodapé que sobe acima do teclado (`useAboveKeyboard` via `visualViewport`).
   - Enter envia, Shift+Enter quebra linha, e a composição IME é tratada.
3. **Mark** cria um destaque persistente (nota). No hover aparece um badge para remover.
4. **Translate** devolve tradução e o "significado aqui" no contexto. Para termos curtos, inclui **raízes da palavra**:
   `in- (not) + cre (believe) + -ible (can be) → cannot be believed`. Isso é muito útil para o domínio Inglês.
5. **Pontos na margem** marcam anotações: sólido = Q&A, vazado = tradução, pulsando = em andamento. O `anchor_top` é persistido.
6. **Ancoragem sem mutar o DOM** (`src/lib/learn/highlight.ts`):
   - usa a CSS Custom Highlight API, com `::highlight(bloom-ann)`, `bloom-pending`, `bloom-active` e `bloom-translated`;
   - cores via `color-mix` de `--primary` a 24%, 40% e 52%;
   - sublinhado com `--ring`; tradução com sublinhado tracejado;
   - `locateOffsets`, `rangeFromOffsets` e `charOffset` reancoram por **offset de texto** (`position_start`/`position_end`), não por nós do DOM. Por isso sobrevivem a re-render do Markdown.

**Fim da lição** (`components/learn/lesson-feedback.tsx`):
- `h2.lesson-thoughts`: seção "perguntas de reflexão", com divisória superior. O plugin `rehypeThoughtQuestions` adiciona a nota "Reference answers will appear at the end of the next lesson...".
- `FeedbackCard`:
  - textarea de feedback livre;
  - respostas às perguntas de reflexão, recolhidas num `details`;
  - `TeachingFeedback` como filho: select de **escopo** `auto` / `next` (só a próxima lição) / `course` (curso inteiro).
- `NextStepFrame` (`border-primary/30 bg-accent/50`, eyebrow "Next step") mostra uma de três opções:
  - `GenerateStep`: "Finished reading, generate the next lesson";
  - `GoNextStep`: a próxima já existe;
  - `MarkReadStep`: só marca como lida.
- `GeneratingCard`:
  - transmite a próxima lição **inline**, na mesma página;
  - mostra um status sticky de fase (*planning → writing → saving*) com "· waited Xs";
  - a fase *saving* é detectada quando 5 s passam sem tokens novos (`SETTLE_MS = 5000`).

**Estilo de ensino** (`teaching-style-control.tsx` + `TeachingStylePanel`):
- Galeria de presets, cada um com **um exemplo do mesmo tópico** ("what is a cache?"), para comparar lado a lado:
  - `balanced` ("Step by step");
  - `socratic` ("Guided questions");
  - `analogy`;
  - `practical` ("Learning by doing");
  - `concise` ("Straight to the point");
  - `rigorous` ("Careful reasoning");
  - `custom` (até 2000 caracteres).
- Os registros de feedback ativos (`/me/teaching`) têm as ações **"I understand now"** (resolve) e **"Stop applying"** (desliga).

**Componentes de suporte na lição:**
- `ChapterList` com número em fonte mono "01", item ativo `bg-accent` e tags *source / archived / evaluation / feedback*;
- `ChapterDrawer` no mobile;
- `.scroll-fade-x`, que aplica fade nas bordas de tabelas largas por `mask-image`, controlado por `data-fade-start/end`;
- code blocks com scroll-shadow;
- `.lesson-table` e `progress-cards`, que viram cards no mobile.

### 4.5 Revisão (o que realmente existe)
- **Não há SRS, flashcards nem fila de revisão.**
- A "revisão" acontece **dentro da lição seguinte**. A partir da lição 02, o modelo começa por:
  1. revisar as respostas do aluno às perguntas de reflexão, com marca de certo, errado ou parcial e a resposta de referência;
  2. responder às marcações `???` deixadas no texto (modo CLI).
- Depois vem o conteúdo novo, e por fim 2 ou 3 novas perguntas de reflexão **sem resposta**.
- **Notas** (`/me/notes`, `notes-browser`):
  - busca, filtro por curso e visão por curso ou por data;
  - carrega até 1000 notas;
  - **export Markdown** no cliente (`src/lib/me/export.ts`), agrupado curso → lição e com cabeçalhos rebaixados.

### 4.6 Progresso, mapa e "o que aprender depois"

**Progresso do curso** (`components/learn/course.tsx`, `src/lib/learn/progress.ts`):
- `progress = mastery_covered / mastery_total`. Um item de domínio conta como coberto quando **a lição que o ensina é marcada como lida**. Os números vêm só do backend.
- Ao concluir, a UI mostra "Completed" em vez de "100%".
- `TimelineRow`:
  - círculo numerado de 36 px sobre uma linha vertical (ativo = `bg-primary`; lido = `border-ring bg-accent`; ocioso = `border-border bg-card`);
  - card de linha clicável com chevron.
- `ProgressCard` (trilho direito): percentual em fonte mono `text-4xl`, barra, a frase "Read lessons cover {covered} of {total} key points" e botões Start/Continue e View outline. No mobile vira `ProgressStrip`.

**Mapa de conhecimento** (`components/learn/knowledge-map.tsx`, `src/lib/learn/knowledge.ts`, `coordinate-map.ts`):
- **Cabeçalho:** contagens, busca e o botão **"Update map"**. É uma ação explícita: sincroniza chunk por chunk e mostra o percentual. Em 409, tenta de novo após 3, 6, 12, 24 e 48 s, por até 5 rodadas. 429, 502 e 504 contam como falha.
- **Chips das 11 áreas de topo:** Arts, Biology and health sciences, Everyday life, Geography, History, Mathematics, People, Philosophy and religion, Physical sciences, Society and social sciences, Technology.
  - `bg-primary` = tem curso lido;
  - `bg-accent` = curso posicionado;
  - `bg-muted` = vazio.
  - **Sem percentual global**, de propósito.
- **Card por área** com `Branch` recursivo (`ml-1 border-l pl-3`):
  - `compress()` funde cadeias de filho único num *trail* ("Law › Legal basics › ...");
  - pílula "N courses meet here";
  - `CourseRow` com ponto sólido = lido e vazado = não lido.
- **Painel de detalhe sticky de 288 px:** where, also in, neighbouring topics e topics studied, com **citações literais** das lições como fonte.
- **Empty state** com ícone `Sprout`.

**CoordinateCard** (`components/learn/coordinate-card.tsx`, na página do curso):
- `Band`: 11 segmentos `h-1.5 flex-1`, um por área. Área lida = `bg-primary`; área atual ainda não lida = `bg-primary/35`.
- "You are here", com breadcrumbs da taxonomia.
- "Next up", "Just covered" e direções vizinhas, cada uma com **salvar** (`Bookmark`) ou **dispensar** (`EyeOff`).
- Estados `empty`, `pending`, `failed`, `none` e `placed`. Cada nó tem `state` `encountered`, `explained` ou `applied`.

**Recomendações** (`/learn/next`, `recommendation-panel.tsx`):
- 3 *lanes*:
  - **foundation**: pré-requisitos onde o aluno travou;
  - **connect**: ligação real, por mecanismo, entre dois tópicos já aprendidos;
  - **explore**: um passo além.
- `RecommendationCard`: eyebrow da lane, dispensar/salvar, título, *rationale*, "Because you studied..." e botão Start de largura total.
- Estados `suggested`, `saved`, `started` e `dismissed`, com desfazer (DELETE) e uma wishlist.
- `src/lib/learn/recommendation-intent.ts`: o *rationale* e o *bridge* viram `LearningIntent` do novo curso, e não material de referência.

### 4.7 Fim de curso
- Quando todos os checkboxes do syllabus estão marcados, vem uma **lição de avaliação** (`<!-- eval-article -->` no modo CLI) e depois um **resumo** (`/summary`). O curso passa a "completed".

### 4.8 Modo CLI (`skills/bloom-tutor`, `skills/learn-graph`)
- Mesma didática, mas em arquivos Markdown:
  - `syllabus.md`: itens como checkboxes, "out of scope" e tabela de progresso;
  - `01.md`, `02.md`, ...;
  - `pre-summary.md` e `summary.md`;
  - `learning-log.jsonl`, só com append.
- O aluno marca dúvidas inline com `???`.
- Regras da skill:
  - uma lição por vez;
  - diálogo socrático com **no máximo 2 rodadas** de 1 ou 2 perguntas cada;
  - lição N≥2 = revisão das reflexões anteriores → respostas aos `???` → conteúdo novo → 2 ou 3 perguntas de reflexão → seção de feedback.
- `learn-graph` constrói o mapa junto com o aluno:
  - conceito, uso e relação pai/filho;
  - prioridade para nós de alto reuso;
  - ponto de entrada pelo senso comum.
- Outras skills em `skills/` são "lentes" didáticas para conversar sobre um conceito:
  - **`learn-deep`** é a entrada padrão para "quero entender X". Passa uma vez pelas cinco lentes abaixo e deixa o aluno escolher em qual aprofundar.
  - **`learn-crossover`** aproveita o que o aluno já sabe. Mostra que o conceito novo é algo já aprendido com outro nome, ou estruturalmente igual a algo conhecido. A comparação é por **estrutura**, não por nome. A promessa é "você já sabe metade".
  - **`learn-occam`** decide se vale aprender e até que profundidade. Pergunta qual problema real o aluno quer resolver, verifica se o conhecimento atual basta e estima o retorno contra a perda de validade do conhecimento. Conclui com "aprender", "não aprender" ou "só o mínimo".
  - **`learn-prototype`** parte de um protótipo mínimo que funcione, mesmo ruim. O próprio aluno aponta os defeitos e propõe hipóteses de melhoria, e o ciclo se repete. O método de melhoria vira metodologia.
  - **`learn-feynman`**: o aluno explica com as próprias palavras. O tutor faz o papel de estudante curioso e insiste nos pontos vagos ou pulados. A seguir, classifica cada lacuna como falta de pré-requisito ou raciocínio incompleto.
  - **Relevância para a meta 9:** são modos que o aluno ativa quando quer, como "me teste" (Feynman) ou "vale a pena?" (Occam), e não perguntas despejadas. Viram bons botões de "modo" no chat da aula.

---

## 5. (b) Gamificação, perfil e stats

| Recurso | Existe? | Como funciona |
|---|---|---|
| XP, níveis, ranking, conquistas | **Não** | Nenhum código ou texto relacionado |
| Streak atual e máximo | Sim | Backend (`backend/app/courses.py`, `get_global_stats`, cerca da linha 5523); ver detalhes abaixo |
| Contadores | Sim | `GlobalStats {total_courses, active_courses, completed_courses, total_lessons_read, total_annotations, total_feedback, current_streak, longest_streak, last_lesson}` |
| "Lição lida" | Sim | Conta se há evento `lesson_completed` **ou** feedback da lição (`_count_read_lessons`) |
| Heatmap | Sim | `components/me/mini-heatmap.tsx`: 26 semanas no desktop, 13 no celular (`components/me/use-heat-weeks.ts`) |
| Calendário mensal | Sim | `components/me/activity-view.tsx` + `GET /api/calendar` → `CalendarDay {date, event_count, lessons_read, annotations, courses[]}` |
| Saudação | Sim | `dayPart()` em `src/lib/me/activity.ts`: 5–11 manhã, 11–13 meio-dia, 13–18 tarde, 18–23 noite, resto madrugada |
| Perfil | Mínimo | Apelido e avatar (`InitialAvatar` = inicial sobre `bg-primary`) |
| Tokens por modelo | **Não** | Só via Langfuse no backend, fora da UI |
| Horas de estudo por dia | **Não** | Só o tempo estimado de leitura por lição |

**Regra do streak**, lida no backend:
- Pega as datas locais distintas de **qualquer** `LearningEvent`. Isso inclui `lesson_opened`, `course_created`, `annotation_answered`, `feedback_submitted`, `lesson_generated` e `project_file_edited`.
- O streak atual conta dias consecutivos que terminam **hoje ou ontem** (há "graça" de um dia).
- O streak máximo é a maior sequência de dias consecutivos.
- **Consequência:** abrir uma lição já mantém o streak. É fácil de "farmar" e não mede estudo real.

**Heatmap e calendário** (código reaproveitável):
```ts
// src/lib/me/activity.ts
level(count) = count === 0 ? 0 : count <= 2 ? 1 : count <= 4 ? 2 : count <= 7 ? 3 : 4

// components/me/mini-heatmap.tsx
const HEAT_CELL = ["bg-muted", "bg-primary/20", "bg-primary/40", "bg-primary/70", "bg-primary"];
// layout: grid grid-flow-col grid-rows-7; legenda "Less ... More";
// só pinta depois do mount, para evitar divergência de data local entre SSR e cliente

// components/me/activity-view.tsx (calendário mensal)
const CELL = ["text-subtle-foreground", "bg-primary/15 text-accent-foreground",
              "bg-primary/30 text-foreground", "bg-primary/70 text-foreground",
              "bg-primary text-primary-foreground"];
```

**Página `/me`** (`frontend/src/app/[locale]/(default)/me/page.tsx`):
- `PageHead` com `Greeting` e uma **pílula de streak** (ícone `Flame`), que mostra "{count}-day streak" ou "Study today to start a new streak".
- `ContinueCard`.
- `StatStrip` de 4 colunas: cursos ("{active} in progress · {done} completed"), lições lidas, perguntas de destaque e maior streak.
- `MiniHeatmap`, notas recentes e wishlist.
- **Cada seção falha de forma independente** (`settle()`): um erro numa delas não derruba a página.

---

## 6. (c) Integrações

| Integração | Existe? | Como funciona |
|---|---|---|
| Anki | **Não** | Nenhuma referência |
| Obsidian | **Não** | Só um comentário em `src/lib/learn/files.ts` sobre exibir nomes sem ".md, como no Obsidian" |
| Notion | **Não** | — |
| Flashcards / SRS | **Não** | — |
| Export de notas | Sim | Markdown no cliente (`src/lib/me/export.ts`), agrupado curso → lição |
| **Web clipper Chrome** | Sim | `extension/`, detalhado abaixo |
| Plugin Claude Code | Sim | `.claude-plugin/` (marketplace): `/plugin marketplace add Li-Evan/BloomTutor` e `/plugin install bloom@li-evan`. Usa `skills/bloom-tutor` e `skills/learn-graph` |
| Plugin DeepSeek Harness | Sim | `integrations/deepseek-harness`, pacote npm `bloomtutor-dsh`. `cordis.patch.yml` monta um provedor de skills sobre `skills/` |
| Importação de projeto, PDF e URL | Sim | `/api/courses/from-project`, `/from-materials` e `/from-pdf-reading` (upload em chunks); URL via backend |
| Langfuse | Opcional | Variáveis `LANGFUSE_*` no backend (tracing de chamadas) |

**Web clipper "Bloom Web Clipper"** (`extension/`, Chrome MV3, v0.1.3):
- Permissões `activeTab`, `scripting` e `storage`; atalho **Alt+Shift+S**.
- `background.js` → `capturePage` roda no **MAIN world** da página:
  - remove `<style>` e `<script>`, mas **preserva o TeX do MathJax 3** em `data-bloom-tex` e `data-bloom-display`;
  - em documentos virtualizados do Feishu/Lark, **rola o documento** coletando blocos por `data-record-id`, por até 45 s;
  - guarda o HTML em `chrome.storage.session` (`KEEP = 2` capturas, no máximo 4 MB, `MAX_CLIP_BYTES`; timeout de captura de 60 s);
  - abre `/learn/clip?clip=<id>` ou `?error=restricted|pdf|too-big|failed|bloom` (`CLIP_ERRORS`);
  - mostra o badge "..." durante a captura.
- `bridge.js`: content script injetado na **origem do Bloom**. Faz o handshake por `window.postMessage` com `CLIP_PROTOCOL = 1` e mensagens `take` e `done`.
- `build.mjs` grava `BLOOM_ORIGIN` no build.
- **Backend:** primeiro busca a URL por conta própria. Só usa o HTML capturado se a busca falhar ou cair em paywall. É uma boa ideia: a captura cobre conteúdo logado e paywalls sem depender dela quando não é necessária.

---

## 7. (d) Padrões visuais e componentes que valem copiar

### 7.1 Tokens de tema (`frontend/src/app/theme.css`)
Conceito declarado no arquivo: "um caderno de laboratório silencioso". Base neutra *stone* com um único acento esmeralda.

| Token | Light | Dark | Nota |
|---|---|---|---|
| `--background` | `#fafaf9` | `#0c0a09` | |
| `--foreground` | `#1c1917` | (claro) | |
| `--card` | `#fff` | `#1c1917` | |
| `--primary` | `#00bc7d` | — | **só preenchimento, nunca texto** |
| `--primary-hover` | `#00d492` | — | |
| `--primary-foreground` | `#0a0908` | — | texto escuro sobre o verde |
| `--primary-text` | `#007a55` | `#00d492` | **texto verde** com contraste de 5.1:1 |
| `--muted` | `#f5f5f4` | `#292524` | |
| `--muted-foreground` | `#57534e` | `#b2aca7` | |
| `--subtle-foreground` | `#78716c` | `#a39d98` | |
| `--accent` | `#ecfdf5` | `#002c22` | fundos de destaque suaves |
| `--accent-foreground` | `#007a55` | `#5ee9b5` | |
| `--destructive` | `#dc2626` | | |
| `--warning` | `#b45309` | | |
| `--border` | `#e7e5e4` | | |
| `--ring` | `#009966` | `#00d492` | foco e sublinhados |
| `--radius` | `0.75rem` | | raios sm 6 / md 8 / lg 12 / xl 16 px |
| `--shadow-sm` | `0 1px 2px rgb(28 25 23/.06)` | | **só duas sombras** (`@theme { --shadow-*: initial; }` zera o resto) |
| `--shadow-md` | `0 8px 24px -8px rgb(28 25 23/.12)` | | |
| `--header-height` | `4rem` | | |

**Lições para o nosso app:**
1. **Separar o token de preenchimento do token de texto** da cor de marca (`--primary` vs `--primary-text`) e travar isso com teste. Isso resolve contraste em light e dark de uma vez.
2. **Zerar a escala de sombras do Tailwind** e expor só os tokens permitidos. Para o cel shading, troque as duas sombras suaves por **sombras duras** (offset sólido, sem blur), por exemplo `--shadow-sm: 2px 2px 0 var(--ink)` e `--shadow-md: 4px 4px 0 var(--ink)`, e acrescente um `--ink` para contornos de 2 px. A ideia de "só N sombras" é exatamente o que mantém um visual cel shading coerente.
3. Manter o mesmo vocabulário de tokens semânticos do shadcn (`background`, `card`, `muted`, `accent`, `ring`...). Assim os componentes portam sem reescrever classes.

### 7.2 Tipografia, escala e preferências sem flash
- **Fontes** (`src/fonts/index.ts`, `next/font/local`): Outfit 400–800 (UI e títulos), Public Sans (alternativa, sem preload) e JetBrains Mono 400–500 (números e metadados).
- O atributo `data-font` (`outfit`, `public-sans` ou `system`) troca a família.
- O atributo `data-text-size` (`sm`, `md`, `lg`, `xl`, `xxl`) define `--text-scale` = 0.9, 1, 1.2, 1.4 ou 1.6, com escala separada para CJK.
- **Scripts inline pré-hidratação** (`src/lib/text-size.ts` → `TEXT_SIZE_SCRIPT`, `src/lib/font.ts` → `FONT_SCRIPT`):
  - aplicam os `data-*` a partir do `localStorage` antes do primeiro paint, sem flash;
  - sincronizam entre abas pelo evento `storage`.
- **Números sempre em `font-mono tabular-nums`** (classe `.tabular`): stats, percentuais e índices "01".
- **Foco global** (`globals.css`): `:where(:focus-visible){outline:2px solid var(--ring);outline-offset:2px}`, mais uma correção para Firefox.

### 7.3 Eyebrow, PageHead e rótulos
```ts
// components/brand/eyebrow.tsx
export const EYEBROW_CLASS = "font-mono text-sm font-normal uppercase tracking-[0.2em] ..."; // cor: text-primary-text
// prefixo de índice opcional: "01 / TÍTULO"
// LABEL_CLASS: rótulos de 13px
```
- `components/page-head.tsx` segue sempre a mesma ordem: eyebrow → h1 → descrição → ações.

### 7.4 StatStrip e StatHint (`components/learn/stat-strip.tsx`, `stat-hint.tsx`)
- Painel em grade. Em cada célula, um número grande `font-mono text-3xl tabular-nums` e um rótulo de 13 px embaixo.
- **Acessibilidade:** no DOM, `<dt>` (rótulo) vem antes de `<dd>` (valor); a ordem visual é invertida por CSS `order`. Leitor de tela lê "Lições lidas: 12".
- Dica opcional: um botão "i" com tooltip e alvo de clique de 40 px.
- Usado com 4 colunas em `/me` e 5 em `/me/activity`.

### 7.5 Esperas honestas: WorkingBar, DoneBar e CreatingDialog (`components/learn/shell.tsx`)
- `WorkingBar` (`border-primary/30 bg-accent`): spinner + título + "costuma levar ~N s" + "Waited Xs". **Rola até ficar visível.**
- `DoneBar`: círculo com check e mensagem.
- `QuietNotice`: texto de 13 px em cor muted, não bloqueante.
- `ErrorBar`: fundo `destructive/10`.
- Hooks `useWaited` (cronômetro) e `useFlash` (pulso `done-flash`).
- `CreatingDialog`: progresso assintótico `92*(1-exp(-t/typical))`, etapas temporizadas e mensagem quando `t > slowAfter`.
- **Regra de produto:** toda espera longa mostra o tempo esperado e o tempo já decorrido, e todo erro mostra o motivo real.
- **Para nós:** calibrar `typical` por modelo e tarefa a partir das nossas próprias estatísticas de latência.

### 7.6 Botões e cards (`components/ui/button.tsx`, `card.tsx`)
- **Variantes:**
  - `default`;
  - `destructive`: **borda e texto vermelhos, sem fundo vermelho**, menos agressivo;
  - `outline`, `secondary`, `ghost` e `link`;
  - `on-dark` e `outline-on-dark`, para a landing escura;
  - `cta`.
- **Tamanhos:** `sm` h-8, `default` h-10, `lg` h-12 e `icon`.
- **Prop `loading`:** aplica `aria-busy` e `aria-disabled` e mostra um spinner **mantendo a cor**. O botão não "apaga", o que evita salto visual.
- `active:scale-[0.98]` dá feedback tátil leve. No cel shading, isso vira "afundar" a sombra dura: `translate(2px,2px)` com a sombra indo a zero.
- Hover de card interativo:
  ```ts
  export const cardInteractive = "transition-[border-color,box-shadow] duration-150 hover:border-primary/40 hover:shadow-sm";
  ```
- **Card como link inteiro** (`components/learn/course-card.tsx`):
  - link esticado via `::after`;
  - menu "mais" visível só no hover em dispositivos com hover, **sempre visível no toque**;
  - badges de tipo (`components/learn/badges.tsx`): `topic`, `source`, `project`, `pdf` e `clippings`, cada um com ícone; `ExperimentalBadge` em âmbar;
  - `ProgressBar`: `h-1.5`, trilho `bg-border`, preenchimento `bg-primary`, `role="progressbar"`;
  - rodapé "N lessons · Last studied X".
- **Ordenação dos cursos:** pelo estudo mais recente (`orderCourses`, `studiedByCourse`).

### 7.7 Componentes de marca
- **Curva de sino** (`components/brand/bell-curve.tsx`):
  - SVG **computado**, não desenhado: `W=560, BASE_Y=250, SIGMA=48, AMP=168, MEAN_A=196, MEAN_B=MEAN_A+2σ`;
  - curva cinza = "classroom", verde = "tutored" (o problema 2-sigma de Bloom, 1984);
  - props `animated`, `loop`, `annotated` e `labels`;
  - animações `drawCurve` (`.curve-draw`, 1.9 s) e `drawCurveLoop` (`.curve-draw-loop`, 3.4 s, infinita, usada como indicador de espera);
  - aparece em empty states, 404, erro e na espera de criação.
  - **Ideia transferível:** um único motivo gráfico recorrente da marca, usado em todos os estados vazios e de espera. No nosso caso, pode ser uma ilustração SVG desenhada à mão, animada com `stroke-dashoffset`.
- **Logo** (`assets/logo.svg`, `logo-dark.svg`, `components/brand/logo.tsx`): flor de 6 pétalas em paths com opacidades 1, .8, .6, .7, .5 e .4, em `#059669` / `#34d399`. O teste `svg-sources.test.mjs` exige que todo path comece com `M`.
- **`grid-glow.tsx`:** grade de pontos com `radial-gradient` de 26 px em `rgba(255,255,255,.05)` mais *blobs* esmeralda borrados (landing e hero).
- **`status-view.tsx`:** layout de 404 e erro com a curva.
- **Hero** (`assets/hero.png`): landing escura; kicker em fonte mono "BLOOM'S 2-SIGMA PROBLEM · 1984"; título "From average / to the top 2%." com a segunda linha em verde; duas curvas de sino; CTA verde "Open the App".
- **Animações** (`globals.css`): `fade-late`, `fade-later`, `ann-in` (0.15 s, entrada do painel) e `done-flash`. **Todas desligadas com `prefers-reduced-motion`.**

### 7.8 Padrões de interação reaproveitáveis (resumo com caminhos)

| Padrão | Arquivo | Por que copiar |
|---|---|---|
| Bolha de seleção Ask/Mark/Translate | `src/lib/learn/bubble.ts`, `components/learn/lesson.tsx` | Interação central e não intrusiva: o aluno pergunta quando quer, sem bombardeio de perguntas |
| Ancoragem por offsets + CSS Highlight API | `src/lib/learn/highlight.ts` | Destaques que sobrevivem a re-render do Markdown, sem `<mark>` injetado |
| Pontos na margem | `lesson.tsx` | Mostram o estado das anotações sem poluir o texto |
| Drawer acima do teclado | `annotation-panel.tsx` (`useAboveKeyboard`) | Celular |
| Clarify com chips + "pular" | `new-course-dialog.tsx` | Onboarding de domínio e posicionamento com 1 ou 2 perguntas |
| Galeria de estilos com o mesmo exemplo | `teaching-style-control.tsx` | O aluno vê a diferença em vez de ler uma descrição |
| Escopo de feedback + "Stop applying" | `teaching-feedback.tsx`, `/me/teaching` | Memória de preferências editável pelo aluno |
| Geração inline com fases | `lesson-feedback.tsx` (`GeneratingCard`) | A próxima aula aparece no lugar, sem trocar de tela |
| Registro `running` | `src/lib/learn/running.ts` | Streams sobrevivem à navegação |
| Polling de pendentes | `src/lib/learn/pending-courses.ts` | Jobs longos sem bloquear a UI |
| Batch NDJSON de GETs | `src/lib/batch.ts` | Menos round-trips no Electron e no Next |
| Árvore com `compress()` | `src/lib/learn/coordinate-map.ts` | Torna legíveis hierarquias profundas: essencial para um grafo de 1000 h |
| `Band` de 11 segmentos | `coordinate-card.tsx` | Visão de cobertura por área em uma linha |
| Recomendações em 3 lanes | `recommendation-panel.tsx` | foundation / connect / explore é uma taxonomia de próximo passo excelente |
| Tradução com raízes | prompt de tradução (backend) + UI de tradução | Domínio Inglês |
| Seções que falham isoladas | `/me/page.tsx` (`settle()`) | Robustez |
| `TimelineRow` | `course.tsx` | Trilha de lições lida, atual e futura |

### 7.9 Testes que impõem design (copiar a ideia)
- `round1-front-a.test.mjs`:
  - proíbe `text-primary` como cor de texto e exige `text-primary-text` para ícones e links;
  - congela os valores da curva de sino.
- `messages.test.mjs`: os mesmos placeholders em todos os idiomas (en/zh). Regras em `docs/ui-language.md`: placeholders nomeados e plural via ICU.
- `backend-errors.test.mjs`: todo código de erro tem texto.
- `no-auto-charge.test.mjs` e `no-billing-ui.test.mjs`: veja a seção 2.3.
- `svg-sources.test.mjs`: higiene dos SVGs.
- **Para nós:** testes de fonte baratos (`grep` em `*.tsx`) que impeçam cores fora do token, sombras fora da lista, chamadas de modelo sem gesto e strings pt-BR/en desalinhadas.

### 7.10 Tipos de dados úteis como referência (`src/lib/learn/types.ts`)
```ts
Course { id, name, mode, status, learning_depth, language, is_project, lesson_count,
         mastery_progress, mastery_covered, mastery_total, source_filename,
         syllabus_content, is_clippings }
Lesson { ..., teaching_plan?: { action: "repair" | "consolidate" | "advance"; focus } }
Annotation { original_text, comment, anchor_top, position_start, position_end, pdf_position, messages }
FeedbackState { scope, exists, content, thought_answers }
GlobalStats { total_courses, active_courses, completed_courses, total_lessons_read,
              total_annotations, total_feedback, current_streak, longest_streak, last_lesson }
CalendarDay { date, event_count, lessons_read, annotations, courses[] }
Recommendation { title, rationale, bridge, source_topics, status, generation, language, course_id }
KnowledgeMap { nodes[{ id, label, summary, domain, sources[{ course_id, lesson_number, lesson_title, quote }] }],
               courses, read_lessons, pending_count, failed_count, queue }
CoordinateCard { state, needs, here{ level, crumbs, also, state }, band[{ courses, here }],
                 connect, next_item, covered, directions[{ question, reason, status }], can_save }
```

### 7.11 Esquema do grafo de conhecimento (backend, mas define a UI do mapa)
- **Tabelas `kn_*`:**
  - `KnNode`: `kind` = `section`, `article` ou `concept`; `visibility` = `public` ou `private`; `owner_uuid`;
  - `KnLabel`: `pref`, `alt` ou `hidden`, por idioma;
  - `KnEdge`;
  - `KnMatch`: SKOS `exactMatch`, `closeMatch`, `broadMatch`, `narrowMatch` e `relatedMatch`;
  - `KnRedirect`: `same_as` e `possibly_equivalent_to`;
  - `KnRelease`: major/minor.
- **`KnEdge`:**
  - tipos `contains`, `builds_towards` (pré-requisito **suave, nunca bloqueia**) e `related`;
  - `reason` obrigatório para tudo que não é `contains`;
  - `status` = `suggested`, `confirmed`, `rejected` ou `deprecated`;
  - versionamento por `valid_from` e `valid_to`;
  - **arestas geradas por modelo sempre entram como `suggested`**.
- **Cinco contratos:**
  1. IDs opacos (ULID);
  2. o lado de aprendizado guarda só `node_id`;
  3. uma única tabela de arestas com tipo, status, proveniência, versão e visibilidade;
  4. nós privados só se penduram sob nós públicos;
  5. **o modelo escolhe por número entre candidatos recuperados**, e a decisão é persistida.
- **Posicionamento de curso** (`backend/app/coordinate.py`), em 2 passos:
  1. o modelo gera termos de busca → índice local de labels → o modelo escolhe 1 nó primário e até 3 "also";
  2. direções vizinhas.
  Há lease e backoff.
- **Extração de tópicos** por chunk de lição lida, com *fingerprint*. Cada conceito fica ancorado numa **citação literal** do texto.
- **Snapshot:** release 2026.11 (snapshot de 2026-11-03), 4515 seções em 6 níveis e 49.753 artigos. Cada artigo tem `{id, title, section, qid, en, zh, en_alt, zh_alt}`.

---

## 8. (e) O que evitar

1. **`lesson.tsx` com 2467 linhas.** Concentra seleção, anotações, chat, TOC, feedback, geração e mobile. Quebre em módulos desde o início: `ReaderSurface`, `SelectionBubble`, `AnnotationLayer`, `LessonRail`, `NextStep`, `GenerationStream`.
2. **Mapa de conhecimento raso e com âncora errada.** As 11 áreas e os ~50 mil artigos da Wikipedia L5 servem de cultura geral, mas **não têm profundidade de doutorado** em Eletrônica nem em Linguística. Além disso, o mapa mostra "onde meus cursos caem", e não uma árvore de currículo de 1000 a 1500 h. Use o **esquema** de arestas e status, não o **conteúdo**.
3. **Sem seletor de modelo e sem modelo por tarefa na UI.** Tudo depende de variáveis de ambiente. Para a nossa meta 7 (assinaturas, nada fixo no código), a seleção precisa ser de primeira classe, mas a separação "modelo principal / rápido / visão" vale a pena manter.
4. **"Revisão" sem SRS.** O que chamam de revisão é só recapitulação na lição seguinte. Não há agendamento, fila nem estabilidade de memória.
5. **Streak frágil.** Qualquer evento conta, até abrir uma página ou editar um arquivo. Para XP e ranking calibrados, meça **tempo ativo** e **itens de recuperação acertados**.
6. **Gate de "Finished reading".** O progresso depende de um clique de "li". É fácil de inflar e não mede domínio.
7. **Perguntas de reflexão obrigatórias no fim de toda lição.** Isso entra em atrito com a meta 9 (sem despejar perguntas). Prefira 0 ou 1 pergunta opcional, ou recuperação dentro do texto em momentos naturais.
8. **Diálogo de criação bloqueante com progresso fictício.** O progresso assintótico é honesto sobre a incerteza, mas o diálogo é modal. Prefira um card não bloqueante (como o `WorkingBar`) e deixe o usuário navegar.
9. **Visual plano verde e esmeralda com sombras suaves.** É o oposto do cel shading com SVG desenhado à mão. Aproveite a **estrutura** (tokens, grade, ritmo tipográfico), não a **pele**.
10. **Curva de sino como único elemento de marca.** É conceitualmente forte para "2-sigma", mas fria. Para nós, um conjunto de ilustrações próprias por domínio.
11. **Usuário local único, sem stats de tokens e tempo.** Não há base para "horas por dia" nem "tokens por modelo" (meta 6).
12. **Chat por lição sem memória de longo prazo visível.** Não há um painel "o que o tutor sabe sobre mim" além dos registros de feedback.

---

## 9. Mapeamento para as 9 metas do nosso app

| Meta | O que o BloomTutor oferece | Lacuna / o que fazer |
|---|---|---|
| 1. Grafo-árvore massivo por domínio, do básico ao doutorado, com expansão procedural, livros e YouTube | Esquema `KnEdge` (tipado, versionado, `suggested` vs `confirmed`, `reason` obrigatório, escolha por número entre candidatos); UI de árvore com `compress()`; `Band`; painel de detalhe com citações; lanes foundation/connect/explore | Conteúdo raso (Wikipedia L5). Não há livros, YouTube nem Lean. Construir árvore própria por domínio, com horas estimadas por nó, e reaproveitar o **esquema** e a **UI** |
| 2. Memória de contexto SOTA | Feedback com escopo `auto/next/course` + "Stop applying"; estilo de ensino persistido; `teaching_plan` (repair/consolidate/advance); `pre-summary`/`summary` e `learning-log.jsonl` (CLI) | Não há modelo do aluno explícito nem memória vetorial. Usar o padrão "registros editáveis pelo aluno" como camada visível da memória |
| 3. Sessões separadas por domínio | O curso é a unidade isolada (lições, chat, notas); uma geração por curso | Não há agrupamento acima do curso, exceto as áreas do mapa. Para nós: domínio → trilhas → sessões |
| 4. Flashcards Anki/Obsidian | **Nada.** Só destaques (Mark) e export Markdown | Transformar "Mark" em "Criar card" na bolha de seleção; exportar para Anki e Obsidian (pesquisa separada) |
| 5. Nível/XP com ranking Monte Carlo | **Nada.** Só streak e contadores | Construir do zero. Reaproveitar `StatStrip`, a pílula de streak e o heatmap como superfícies de exibição |
| 6. Stats leves (tokens por modelo, horas por dia) | Heatmap, calendário e contadores; tempo estimado de leitura | Faltam tokens e tempo ativo. Alimentar o mesmo `level()` e `HEAT_CELL` com minutos estudados |
| 7. IA por assinaturas, sem modelo fixo | Endpoint OpenAI-compatible via env; separação principal/rápido/visão; **nenhuma chamada sem clique** (com testes) | Manter o nosso pi-agent-core. Copiar o princípio no-auto-charge e a separação de papéis de modelo, com seletor na UI |
| 8. UI clean em cel shading com SVG à mão | Sistema de tokens disciplinado, 2 sombras, raios fixos, tipografia mono para números, motivo SVG único, `prefers-reduced-motion` | Trocar a pele: contorno `--ink`, sombras duras, preenchimento em 2 tons, SVG com traço irregular |
| 9. Didática não cansativa | No máximo 1 ou 2 conceitos novos por lição (`advance`); socrático limitado a 2 rodadas; perguntas só sob demanda (Ask); estilos de ensino; leitura com tempo estimado | Remover as perguntas de reflexão obrigatórias; usar recuperação curta e opcional |

---

## 10. Itens reutilizáveis (com licença)

Todos os caminhos são relativos a `C:\Users\nicoolas\Pictures\learnharness\_refs\BloomTutor\`.

| O quê | Onde | Como reaproveitar no nosso app | Licença |
|---|---|---|---|
| Tokens de tema light/dark | `frontend/src/app/theme.css` | Mesma estrutura de nomes; trocar valores para a paleta cel shading; adicionar `--ink` e sombras duras | MIT |
| Base CSS (foco, prose, animações, reduced-motion) | `frontend/src/app/globals.css`, `learn.css` | `.prose-bloom` (line-height 1.85 × `--text-scale`), `.scroll-fade-x`, `.learn-rail`, `done-flash`, `ann-in` | MIT |
| Scripts de preferência pré-hidratação | `frontend/src/lib/text-size.ts`, `frontend/src/lib/font.ts` | Tamanho de texto e fonte sem flash, sincronizados entre abas (funciona no Electron) | MIT |
| StatStrip + StatHint | `frontend/src/components/learn/stat-strip.tsx`, `stat-hint.tsx` | Painel de XP, horas e tokens | MIT |
| MiniHeatmap + `level()` + calendário | `frontend/src/components/me/mini-heatmap.tsx`, `frontend/src/lib/me/activity.ts`, `frontend/src/components/me/activity-view.tsx`, `frontend/src/components/me/use-heat-weeks.ts` | Heatmap de minutos por dia; thresholds recalibrados | MIT |
| WorkingBar, DoneBar, ErrorBar, QuietNotice, useWaited | `frontend/src/components/learn/shell.tsx` | Toda espera de IA (gerar aula, expandir grafo) | MIT |
| Progresso assintótico com etapas | `frontend/src/components/learn/creating-dialog.tsx` | Fórmula `92*(1-exp(-t/typical))`, com `typical` medido por modelo; em card não modal | MIT |
| Bolha de seleção | `frontend/src/lib/learn/bubble.ts` | Ask / Card / Translate no leitor | MIT |
| Ancoragem de highlights | `frontend/src/lib/learn/highlight.ts` | CSS Custom Highlight API (Chromium/Electron) com offsets de texto | MIT |
| Plugins rehype da lição | `frontend/src/lib/learn/rehype-lesson.ts` | `rehypeLessonMeta`, `rehypeWrapTables`, `rehypeTaskLabels`, `rehypeScrollMath` etc. | MIT |
| Clarify com chips | `frontend/src/components/learn/new-course-dialog.tsx` | Onboarding de domínio e teste de nivelamento leve | MIT |
| Galeria de estilos + escopo de feedback | `frontend/src/components/learn/teaching-style-control.tsx`, `teaching-feedback.tsx` | Preferências didáticas como parte da memória | MIT |
| Geração inline com fases | `frontend/src/components/learn/lesson-feedback.tsx` | Streaming da próxima aula no fim da atual | MIT |
| Registro de streams `running` | `frontend/src/lib/learn/running.ts` | Streams que sobrevivem à navegação no Next/Electron | MIT |
| Batch NDJSON | `frontend/src/lib/batch.ts` | Agrupar GETs do renderer | MIT |
| Árvore comprimida + Band | `frontend/src/lib/learn/coordinate-map.ts`, `frontend/src/components/learn/coordinate-card.tsx`, `knowledge-map.tsx` | Navegação do grafo massivo | MIT |
| Recomendações em 3 lanes | `frontend/src/components/learn/recommendation-panel.tsx`, `frontend/src/lib/learn/recommendation-intent.ts` | "O que estudar depois" sem chamada automática | MIT |
| Botão com `loading` | `frontend/src/components/ui/button.tsx` | Base dos nossos botões | MIT (shadcn) |
| Eyebrow / PageHead | `frontend/src/components/brand/eyebrow.tsx`, `frontend/src/components/page-head.tsx` | Cabeçalhos de seção | MIT |
| Testes de fonte de design | `frontend/tests/*.test.mjs` (ex.: `round1-front-a`, `no-auto-charge`, `no-billing-ui`, `messages`, `svg-sources`) | Lint de design barato | MIT |
| Web clipper MV3 | `extension/src/background.js`, `bridge.js`, `frontend/src/lib/learn/clip-protocol.ts` | Captura de páginas logadas, MathJax e Feishu; adaptar `BLOOM_ORIGIN` para a origem local do Electron | MIT |
| Skills de tutor em Markdown | `skills/bloom-tutor`, `skills/learn-graph` | Regras didáticas (1 lição por vez, socrático ≤2 rodadas, `???`) como prompts do nosso agente | MIT |
| Lentes didáticas | `skills/learn-deep`, `learn-crossover`, `learn-occam`, `learn-prototype`, `learn-feynman` (`SKILL.md`, em chinês) | Traduzir e adaptar como "modos" acionáveis no chat da aula (ex.: "Me teste" = Feynman; "Já sei algo parecido?" = Crossover; "Vale a pena?" = Occam) | MIT |
| Esquema `kn_*` | `backend/app/models.py`, `backend/app/coordinate.py`, `docs/ARCHITECTURE.md` | Modelo de arestas do nosso grafo | MIT |
| Snapshot Vital Articles L5 | `backend/data/knowledge/l5-2026.11.json.gz` | No máximo como camada superior genérica (fora dos domínios-alvo) | **CC BY-SA 4.0** + CC0 |
| Fontes Outfit, Public Sans, JetBrains Mono | `frontend/src/fonts/` | Opcional: o cel shading pede fontes com mais personalidade | SIL OFL 1.1 |

---

## 11. Sugestão concreta de adaptação (resumo para o engenheiro)

1. **Design system:**
   - criar `theme.css` com a mesma estrutura de tokens;
   - acrescentar `--ink`, `--shadow-hard-sm`/`--shadow-hard-md` (offset sem blur), `--stroke: 2px` e uma paleta de 2 tons por superfície (`--card` e `--card-shade`);
   - zerar `--shadow-*` do Tailwind;
   - testes de fonte que proíbam sombras e cores fora dos tokens.
2. **Leitor de aula:**
   - portar `bubble.ts` e `highlight.ts`;
   - bolha com **Ask / Card / Translate**; Card gera um flashcard a partir do trecho, para export Anki e Obsidian;
   - pontos na margem por tipo.
3. **Didática:**
   - adotar `teaching_plan` (repair/consolidate/advance, no máximo 1 ou 2 conceitos novos);
   - galeria de estilos com exemplo do mesmo tópico;
   - escopo de feedback com "Stop applying";
   - eliminar as perguntas de reflexão obrigatórias;
   - recuperação curta e opcional, agendada por SRS.
4. **Esperas:** `WorkingBar` não modal com `typical` vindo das nossas métricas de latência por modelo, mais "Waited Xs"; geração inline da próxima aula.
5. **Stats e gamificação:**
   - `StatStrip` (XP, nível, horas hoje, tokens hoje por modelo);
   - heatmap de **minutos ativos** com `level()` recalibrado;
   - streak baseado em minutos mínimos ou revisões, e não em "qualquer evento".
6. **Grafo:**
   - esquema de arestas `contains/builds_towards/related` com `status` e `reason`;
   - arestas da IA entram como `suggested`;
   - UI de árvore com `compress()` e `Band` por subárea do domínio;
   - painel de detalhe com citações da fonte (livro, vídeo, aula).
7. **Custos:** princípio e teste no-auto-charge. Toda chamada de modelo nasce de um gesto do usuário, com exceção explícita e configurável, por exemplo uma pré-geração noturna.

---

## 12. Perguntas em aberto

- A pele cel shading vai manter as fontes OFL do BloomTutor, ou vamos escolher fontes com traço mais "desenhado"? Isso afeta a decisão de copiar `src/fonts/`.
- Queremos usar o snapshot Vital Articles (CC BY-SA 4.0) como camada genérica de "cultura geral" acima dos domínios? Se sim, os dados derivados precisam ser distribuídos sob CC BY-SA, separados do código AGPL.
- A seleção de modelo deve ser por papel (principal / rápido / visão, como o BloomTutor separa por env) ou por tarefa (aula, grafo, tradução, flashcard)? Isso define a UI do seletor.
- Como definir "dia de estudo" para o streak e o XP: minutos ativos, revisões concluídas ou ambos? O BloomTutor conta qualquer evento.
- Manter alguma forma das "perguntas de reflexão com resposta na próxima aula"? É uma técnica de recuperação válida, mas obrigatória ela cansa.
- O web clipper vale o custo de manter uma extensão no nosso cenário Electron, ou basta importar URL e PDF?
- O que vimos da UI foi lido no código, sem rodar o app (política de segurança). A única evidência visual real é `assets/hero.png`. Detalhes de espaçamento e responsividade podem diferir do esperado.
