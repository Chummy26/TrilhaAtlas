# Melhoria do professor e continuidade de curso na campanha

## Embasamento em benchmarks e pesquisas atuais

| Benchmark / Estudo | Achado principal | Aplicação no TrilhaAtlas |
| --- | --- | --- |
| **TutorBench** (Scale AI) | Modelos de fronteira pontuam abaixo de 56% em tutoria real; os gargalos são explicação adaptativa, feedback acionável e apoio ativo sem entregar a resposta antes da hora. | Controlador determinístico em `src/core/study/tutor-pedagogy.ts` que injeta diretivas específicas por fase, bloqueia spoilers precoces no nível 1 de apoio e exige avaliação critério a critério em `conclude_lesson`. |
| **MathTutorBench** (ETH Zurich, EMNLP) | Capacidade de resolver não equivale a ensinar; em diálogos longos, prompts estáticos sofrem *drift* e entregam soluções ou caem em loops repetitivos. | A plataforma computa o estado real da aula a cada turno (`opening`, `scaffolding`, `repair`, `fading`, `exam-ready`, `exam-awaiting`, `exam-first-verdict`, `exam-final-verdict`) e injeta diretivas curtas (~120–180 tokens) em vez de depender só de prompt estático. |
| **MRBench** (MBZUAI e colab.) | Taxonomia de 8 dimensões pedagógicas com foco em identificação de erro, localização do passo divergente e orientação acionável. | Diagnóstico explícito em 3 movimentos (preservar acertos → localizar o primeiro passo divergente → nomear a misconception) em `20-teaching.md` e nas diretivas de `repair` e `exam-first-verdict`. |
| **LearnLM** (Google DeepMind) | *Pedagogical instruction following*: instruções curtas, estruturadas e ligadas ao momento pedagógico elevam adesão em carga cognitiva, aprendizagem ativa e metacognição. | Diretiva dinâmica por turno via `buildMissionPedagogyDirective`, preservando ferramentas formativas (`study_activity`, `quiz`, `explain`) durante `teaching` e restringindo-as apenas durante a prova formal. |
| **Adaptive Scaffolding Needs Contingency** (Hou et al., 2026) | Scaffolding adaptativo precisa ser contingente ao *uptake* do aluno, preservando demanda metacognitiva e escalando/retirando apoio em degraus. | Escada contingente de 3 níveis (`impasseCount`: 1 = pista focalizada; 2 = passo parcialmente resolvido cedendo o último passo; 3 = solução completa explicada + caso análogo novo) e *fading* imediato após acerto. |
| **Rethinking Scaffolding in LLM Tutors** (Neagu et al., ICML Workshop 2026) | Alunos reais frequentemente querem dirigir seu ritmo (pular revisão conhecida ou ir direto à prática/prova); scripts rígidos geram atrito. | Detecção explícita de iniciativa (`askedForExam`, `askedWhyOrSimpler`) para honrar pedidos de ir direto à prova ou aprofundar um passo intermediário. |
| **SAFETUTORS** (2026) & **Mitton et al.** (2026) | Risco pedagógico de reforçar *misconceptions* por bajulação (*sycophancy*) e importância do diagnóstico explícito da causa do erro no diálogo. | Regra anti-bajulação explícita (*never validate an incorrect premise*), injeção das confusões comuns do currículo e da lacuna de reforço anterior na abertura da aula. |

## Consertos e continuidade de curso online na campanha

1. **Fim do travamento por chat excluído (`pendingCheck` órfão):** `studyToday()` verifica se sessões `chat_*` ainda existem em disco antes de manter o estado de aula em andamento, eliminando links 404 que bloqueavam a campanha por até 3 dias.
2. **Retentativa imediata após reforço sem travar por 20h:** quando uma prova fecha com `reinforce`, `finishStudyLesson` devolve `retry` (sem conceder XP nem desbloquear dependentes) e `studyToday()` mantém o nó elegível como reforço com a lacuna diagnosticada (`reinforceHint`), evitando o beco sem saída de "Por hoje é isso".
3. **Coesão de módulo/unidade na campanha:** tanto em `campaign.ts` quanto em `english-campaign.ts` (preservando os 6 capítulos autorais, a entrada, os 3 marcos e a missão final de Inglês), habilidades intermediárias mantêm continuidade dentro do módulo em andamento antes de saltar para outra unidade.
4. **Experiência contínua de fim de nó:**
   - Barra de posição no curso (`components/study/lesson-course-bar.tsx`) no topo das aulas de campanha (`Campanha › Capítulo · Módulo · Aula X/Y`).
   - Conclusão de aula (`components/study/lesson-finish.tsx`) sem redirecionamento forçado de 4,5 s, persistente mesmo após recarregar a página, mostrando critérios, XP, progresso do módulo e do capítulo, marcos de conclusão de módulo/capítulo e botão direto **"Próxima aula →"** (ou **"Praticar novamente este tópico"** em reforço).
   - Card **Hoje** (`components/study/today-card.tsx`) com progresso do módulo atual, checklist ordenada das aulas do módulo e fila **"A seguir na trilha"**.
5. **Robustez e rigidez na prova e na finalização de nós:**
   - `prepareLessonExam` bloqueia apresentar prova antes de ensinar (salvo pedido explícito do aluno) e rejeita retestes quase idênticos (sobreposição de tokens ≥ 88%) ou feedback raso (< 20 chars).
   - `isLessonExamAnswer` recusa confirmações conversacionais e pedidos de pulo (`"já entendi tudo"`, `"eu entendi"`, `"pode avançar"`, `"pula"`, etc.) como entrega de prova.
   - `validateExamVerdict` exige evidência literal substancial por critério na aprovação (`grade: 3`), bloqueando fragmentos triviais (como artigos ou letras isoladas) enquanto aceita respostas curtas legítimas; `validateLessonConclusion` aceita flashcards baseados também no feedback corretivo da segunda tentativa.
   - `studyToday()` considera exposições mais antigas de um nó superadas assim que uma tentativa mais recente daquele mesmo nó é encerrada, evitando ressuscitar aulas inacabadas antigas.
6. **Livros, leitura extensa e vídeos quando há dificuldade:** em `repair` (a partir do nível 2 de impasse ou dúvida conceitual/pedido de material), na falha da 1ª tentativa da prova e no encerramento em `reinforce`, o controlador pedagógico instrui o professor a chamar `attach_study_materials` e sugerir tanto uma leitura extensa (livro/capítulo) quanto uma aula em vídeo com ponto de foco concreto.

## Reproduzir verificação

```sh
node scripts/run-tests.mjs tests/lesson-flow-simulation.test.ts tests/tutor-pedagogy.test.ts tests/campaign-continuity.test.ts tests/teacher-lesson-completion.test.ts tests/english-campaign.test.ts tests/campaign-review-flow.test.ts tests/study-quiz.test.ts tests/study-view-cache.test.ts tests/practice-agents.test.ts
node --import tsx scripts/benchmark-tutor-pedagogy.ts
node --import tsx scripts/benchmark-study-marathon.ts
```
