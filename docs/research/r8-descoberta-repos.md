# R8 — Descoberta de repositórios open-source para o fork do learnharness

> **Data da coleta:** 2026-11-18. **Autor:** pesquisa automatizada (tarefa `r-repo-discovery`).
> **Escopo:** repositórios públicos no GitHub, e alguns fora dele, relacionados às 9 metas do app. Ficam de fora os que já estão em `_refs/` (learnharness, open-mastery, BloomTutor, OpenMAIC e DeepTutor).
> **Método:**
> - Descoberta com `gh search repos` (palavra-chave e `--topic`).
> - Metadados com `gh api repos/OWNER/REPO`: estrelas, `license.spdx_id`, linguagem, `pushed_at` e `archived`.
> - Leitura do README e do `LICENSE` quando o SPDX vinha `NOASSERTION` ou ambíguo.
> - Leitura da árvore de arquivos (`git/trees?recursive=1`) dos candidatos principais, para citar caminhos reais.
>
> Nenhum código de terceiros foi clonado, instalado ou executado.

**Limitações conhecidas**

- As estrelas e o "último push" são de 2026-11-18. O campo usado é `pushed_at`, não `updated_at`, que muda a cada nova estrela.
- Os números de benchmark (memória, PDF, SRS) são **autodeclarados** pelos mantenedores, salvo quando indicado. Cada sistema mede com protocolo, modelo-juiz e orçamento de tokens diferentes, então os números **não são diretamente comparáveis**.
- O orçamento de WebSearch desta sessão acabou no meio da pesquisa. Itens que dependeriam de busca web adicional ficam marcados como **"verificar"**, por exemplo a documentação atual do LearnLM e o resultado do AML Cycle 2.
- A ferramenta `search_arxiv` do servidor paper-search devolveu apenas papers recentes sem relação com a consulta, e `search_google_scholar` voltou vazia. Por isso os papers citados vêm dos próprios READMEs, com links primários.

---

## 0. TL;DR: o que clonar primeiro

Coluna "Compat." = compatibilidade da licença com AGPL-3.0 (ver §0.1).

| # | Repo | ★ | Licença | Compat. | O que extrair (resumo) |
|---|---|---|---|---|---|
| 1 | [miuuyy/Clew](https://github.com/miuuyy/Clew) | 270 | MIT | ✅ | O mais próximo do nosso produto: Electron + grafo de pré-requisitos + **propostas de expansão revisáveis** (`contracts/graph_patch.schema.json`). Traz também validador, snapshots reversíveis e **"Sign in with ChatGPT" oficial** (OAuth PKCE + registro dinâmico), com catálogo de modelos vindo de `GET /v1/models` (sem hardcode). |
| 2 | [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | 879 | MIT | ✅ | Agendador FSRS em TS. A **v6.0.0 (2026-10-28) usa FSRS-7 por padrão**. Inclui o otimizador `@open-spaced-repetition/binding`, que treina parâmetros pelo revlog e roda em Node ≥24, compatível com o Electron 44 do LH. |
| 3 | [chuma-beep/mathua](https://github.com/chuma-beep/mathua) | 425 | MIT | ✅ | Motor "estilo Math Academy" em Go + Next.js. Inclui DAG verificado de 3015 conceitos, *mastery gating*, FSRS-6 + **FIRe** (repetição implícita fracionária), **economia de XP com ledger e "accountability"**, ligas semanais, níveis, diagnóstico CAT e governança de expansão em "waves". |
| 4 | [ArnaudGuiovanna/tutor-mcp](https://github.com/ArnaudGuiovanna/tutor-mcp) | 104 | MIT | ✅ | "Ensino generativo, pedagogia determinística": BKT individualizado, FSRS, *gates* de pré-requisito, FSM de fases, seletor de conceito, OLM (*open learner model*), motivação e *nudges* (Go). Portar para TS. |
| 5 | [vectorize-io/hindsight](https://github.com/vectorize-io/hindsight) | 61.7k | MIT | ✅ | Memória de agente líder em LongMemEval-S (94,6%, autodeclarado e reproduzido por terceiros segundo o README). Organiza a memória em **banks**, que mapeiam bem para "um bank por domínio". Operações `retain`/`recall`/`reflect`, mais *observations* e *mental models*. Tem cliente Node e um endpoint MCP por bank. |
| 6 | [GeminiLight/gen-mentor](https://github.com/GeminiLight/gen-mentor) | 137 | CC0-1.0 | ✅ | Implementação do paper WWW'25. Pipeline multiagente objetivo → *skill gap* → trilha → conteúdo → quiz → perfil, em Next.js/TS, com prompts do paper (`app/src/lib/agents/*.ts`) e `model-catalog.ts`. Licença CC0, ou seja, domínio público. |
| 7 | [jacomyal/sigma.js](https://github.com/jacomyal/sigma.js) + [graphology](https://github.com/graphology/graphology) | 12.2k / 1.8k | MIT | ✅ | Renderização WebGL do "grafo massivo" (v4.0.6 em 2026-11-10). O graphology serve como estrutura de dados e oferece algoritmos de DAG, layout e métricas. |
| 8 | [LuanRT/YouTube.js](https://github.com/LuanRT/YouTube.js) | 5.4k | MIT | ✅ | Cliente InnerTube em TS: busca, `getTranscript()` (`TranscriptInfo`) e trilhas de legenda com `translation_languages`, o que dá legendas PT traduzidas automaticamente. Combinar com [LuanRT/BgUtils](https://github.com/LuanRT/BgUtils) (MIT) para PO tokens. |
| 9 | [repeat-space/anki-apkg-export](https://github.com/repeat-space/anki-apkg-export) | 183 | MIT | ✅ | Gera `.apkg` em Node e no browser (v5, sql.js/WASM): básico, invertido, **cloze**, tipos de nota próprios, mídia e `noteId` estável para reexportar sem duplicar. |
| 10 | [Bowen7/react-rough-fiber](https://github.com/Bowen7/react-rough-fiber) + [fskpf/svg2roughjs](https://github.com/fskpf/svg2roughjs) + [rough-stuff/rough](https://github.com/rough-stuff/rough) | 446 / 220 / 21.4k | MIT | ✅ | Converte **qualquer SVG** (ícones Lucide/Tabler, nós do React Flow) em traço "desenhado à mão", com seed estável. É a base do visual cel/sketch. |
| 11 | [philihp/openskill.js](https://github.com/philihp/openskill.js) | 262 | MIT | ✅ | Rating Weng-Lin (TrueSkill-like, ~20× mais rápido) em TS. Serve para calibrar a dificuldade de itens (aluno × item) e alimentar rankings simulados por Monte Carlo. |
| 12 | [unjs/unpdf](https://github.com/unjs/unpdf) / [run-llama/liteparse](https://github.com/run-llama/liteparse) | 1.3k / 13.1k | MIT / Apache-2.0 | ✅ | Extração de PDF **sem Python** dentro do Electron. O unpdf é baseado em pdf.js (texto, metadados e outline). O LiteParse é Rust com builds npm e WASM e cuida do layout. Ambos servem para mapear capítulos de livros a regiões do grafo. |
| 13 | [pfalstad/circuitjs1](https://github.com/pfalstad/circuitjs1) | 2.5k | GPL-2.0-**or-later** | ✅ (via GPL-3) | Simulador de circuitos no browser, **agora em TypeScript** (`ts/*.ts`, Vite). Pode ser embutido nas aulas de Eletrônica. |
| 14 | [dubzzz/fast-check](https://github.com/dubzzz/fast-check) (+ [quint-co/quint](https://github.com/quint-co/quint), [mathlib4](https://github.com/leanprover-community/mathlib4)) | 5.3k | MIT | ✅ | Testes de propriedade em TS que espelham os teoremas de Lean 4 sobre o grafo: aciclicidade, fechamento descendente dos estados de conhecimento e monotonicidade da expansão. |

### 0.1 Legenda de compatibilidade com AGPL-3.0

- ✅ **Compatível para copiar código:** MIT, ISC, BSD-2/3, Apache-2.0 (exige preservar o NOTICE), CC0, Unlicense, GPL-3.0, AGPL-3.0 e GPL-2.0-*or-later*. Os "or later" podem ser usados sob GPL-3, que combina com AGPL-3 pela seção 13.
- 📄 **Só dados/conteúdo, com atribuição:** CC-BY, CC-BY-SA (o conteúdo derivado herda a SA) e OFL (fontes).
- ⚠️ **Restrições:**
  - CC-BY-NC / NC-SA: não comercial.
  - OpenRAIL-M (pesos do Marker/Surya): restrito acima de US$ 5M de funding ou receita.
  - "MinerU Open Source License": Apache-2.0 + atribuição obrigatória em serviços online + limites de MAU/receita.
  - Licenças "community" próprias (PageLM).
  - tldraw: exige chave de licença em produção.
- ❌ **Não copiar código:**
  - Repositórios **sem LICENSE**, que ficam com todos os direitos reservados: Mr. Ranedeer, srs-benchmark, kg-gen, MathTutorBench, SocraticLM, Agent4Edu, LectureBank e AML leaderboard.
  - roadmap.sh, com licença proprietária explícita.
  - OpenAI *Sign in with ChatGPT DevKit*, com licença **não comercial**.
  - Nesses casos dá para ler ideias e números, nunca copiar código ou texto.

---

## 1. Tutores com IA e adaptive learning

| Repo | ★ | Licença | Ling. | Último push | Compat. | O que aproveitar |
|---|---|---|---|---|---|---|
| [miuuyy/Clew](https://github.com/miuuyy/Clew) | 270 | MIT | TS (frontend/Electron) + Python (backend) | 2026-11-16 | ✅ | Ver §1.1. É o "irmão" do nosso app. |
| [GeminiLight/gen-mentor](https://github.com/GeminiLight/gen-mentor) | 137 | CC0-1.0 | TS (Next.js) | 2026-10-23 | ✅ | Agentes do paper GenMentor ([arXiv 2501.15749](https://arxiv.org/abs/2501.15749)), ver §1.2. |
| [ArnaudGuiovanna/tutor-mcp](https://github.com/ArnaudGuiovanna/tutor-mcp) | 104 | MIT | Go | 2026-11-17 | ✅ | Ver §1.3. A camada pedagógica determinística mais completa que encontrei. |
| [chuma-beep/mathua](https://github.com/chuma-beep/mathua) | 425 | MIT | Go + TS (Next.js) | 2026-11-18 | ✅ | Ver §2.1 e §9.1. |
| [nagisanzenin/engram](https://github.com/nagisanzenin/engram) | 1.5k | MIT | Python (skills/plugin) | 2026-08-27 | ✅ | "Sistema de aprendizagem para o humano": currículos *first-principles*, **verificação por *free recall* com "recibos"**, examinador cego (0/258 inflações de nota no gold set) e FSRS-4.5. Roda como plugin de Claude Code, Codex, OpenCode e Pi. Vale extrair a rubrica de avaliação cega e o *selftest* anti-inflação. |
| [CAHLR/OATutor](https://github.com/CAHLR/OATutor) | 282 | MIT | JS (React) | 2026-11-17 | ✅ | ITS clássico com **BKT** (CHI'23). O conteúdo em JSON vem de livros OpenStax, com *hints* e *scaffolds* ([OATutor-Content](https://github.com/CAHLR/OATutor-Content)). Útil como formato de problema com andaimes. |
| [plastic-labs/tutor-gpt](https://github.com/plastic-labs/tutor-gpt) | 936 | GPL-3.0 | TS (Next.js) | 2026-02-20 | ✅ | Tutor com "Theory of Mind" e prompts autoatualizáveis, sobre o Honcho (memória de usuário). Serve de ideia para um "modelo do aluno" separado do tutor. |
| [Khan/perseus](https://github.com/Khan/perseus) | 1.6k | MIT | TS | 2026-11-18 | ✅ | Renderizador e editor de exercícios da Khan Academy em pacotes (`perseus`, `perseus-score`, `math-input`, `kmath`, `perseus-linter`). Bom para widgets de exercício: gráficos interativos, *number line*, expressões. |
| [oaknational/oak-ai-lesson-assistant](https://github.com/oaknational/oak-ai-lesson-assistant) | 35 | MIT | TS (Turborepo/Next.js) | 2026-11-18 | ✅ | Aila, da Oak National Academy. Monorepo `packages/{aila,rag,teaching-materials,lesson-adapters,core}`: plano de aula em schema estruturado, moderação e RAG sobre currículo. Referência de produção para "aula gerada com schema". |
| [HugeCatLab/ChatTutor](https://github.com/HugeCatLab/ChatTutor) | 1.3k | AGPL-3.0 | Vue | 2026-01-09 | ✅ | Tutor com **quadro branco** (Math Canvas) controlado pela IA. Ideia para explicações visuais passo a passo, sem "parede de texto". |
| [molly554/whiteboard-ai-tutor](https://github.com/molly554/whiteboard-ai-tutor) | 225 | MIT | HTML/JS | 2026-11-17 | ✅ | Aulas animadas em quadro branco com *playback*. Alternativa MIT ao ChatTutor. |
| [artcc/freelingo](https://github.com/artcc/freelingo) | 291 | AGPL-3.0 | Python | 2026-11-17 | ✅ | **Domínio Inglês**: currículo A1–C2 com unidades, competências e pré-requisitos, placement adaptativo determinístico, plano de 4–16 semanas, tutor de voz, 50 role-plays, XP e *streaks*. A pasta `specs/*.instructions.md` documenta os jogos e a prática gramatical. |
| [zuhairhalawa/studyai](https://github.com/zuhairhalawa/studyai) | 249 | MIT | TS | 2026-10-24 | ✅ | **Checagem de saída da IA**: cada citação é conferida no slide real e cada questão de prova é validada no dispositivo. Também gera "study packs" usando a assinatura do Claude Code. Padrão útil contra alucinação nas aulas. |
| [zijinz456/OpenTutor](https://github.com/zijinz456/OpenTutor) | 181 | MIT | Python + TS | 2026-11-17 | ✅ | Workspace "por blocos", local-first, com FSRS, grafo e "detecção de carga cognitiva". Vale ler as heurísticas de carga para a meta 9. |
| [nichochar/ari](https://github.com/nichochar/ari) | 222 | MIT | TS | 2026-11-12 | ✅ | Estudo com papel e caneta + IA (foto do caderno). Ideia de baixo atrito. |
| [24kchengYe/human-skill-tree](https://github.com/24kchengYe/human-skill-tree) | 599 | AGPL-3.0 (LICENSE) | TS | 2026-03-25 | ✅ | 33 *skills* de agente para mais de 800 assuntos. Cita evidências: Bastani et al. 2025 (PNAS) mostra que tutor com *guardrails* (dicas em vez de respostas) evita a dependência. |
| [vanderbilt-data-science/knowledge-spaces](https://github.com/vanderbilt-data-science/knowledge-spaces) | 30 | MIT | Python (skills) | 2026-02-13 | ✅ | Pipeline completo de **Knowledge Space Theory** em 10 skills de Claude Code. É a ponte teórica para o §8. |
| [JushBJJ/Mr.-Ranedeer-AI-Tutor](https://github.com/JushBJJ/Mr.-Ranedeer-AI-Tutor) | 29.5k | **sem licença** | prompt | 2025-09-30 | ❌ | Só inspiração: parâmetros de personalização (profundidade, estilo, tom) num único prompt. Não copiar o texto. |
| [CaviraOSS/PageLM](https://github.com/CaviraOSS/PageLM) | 2.1k | "PageLM Community License" | TS | 2026-11-15 | ⚠️ | "NotebookLM educacional": quizzes, flashcards e podcasts. Licença própria, então só referência. |
| [Miaotofu01/Study-Mate](https://github.com/Miaotofu01/Study-Mate) | 1.5k | MIT | JS | 2026-11-17 | ✅ | Plugin para "DeepSeek Harness" (em chinês) com rota, explicação e projeto. O próprio autor admite que a documentação está inchada. Prioridade baixa. |
| [GarethManning/education-agent-skills](https://github.com/GarethManning/education-agent-skills) | 996 | CC-BY-SA-4.0 | TS/MD | 2026-11-03 | 📄 | 165 skills pedagógicas "evidence-grounded". Usáveis como **conteúdo** com atribuição e SA. |
| [eth-lre/mathtutorbench](https://github.com/eth-lre/mathtutorbench) | 49 | sem licença | Python | 2026-08-27 | ❌ (ler) | Benchmark de pedagogia de tutores LLM (EMNLP 2025 Oral, [arXiv 2502.18940](https://arxiv.org/abs/2502.18940)). Conclusão útil: **saber resolver não implica saber ensinar**. Usar o *protocolo* (não o código) para avaliar nossos prompts. |
| [kaushal0494/UnifyingAITutorEvaluation](https://github.com/kaushal0494/UnifyingAITutorEvaluation) | 35 | sem licença | — | 2026-03-02 | ❌ (ler) | MRBench: taxonomia de 8 dimensões pedagógicas para avaliar respostas de tutor. Usar como rubrica de *LLM-as-judge* para a meta 9. |

**LearnLM.** Não existe repositório oficial do LearnLM. O trabalho está em relatórios técnicos: [arXiv 2412.16429](https://arxiv.org/abs/2412.16429) (dez/2024) e [arXiv 2505.24477](https://arxiv.org/abs/2505.24477) (2025, *side-by-side* com professores). No `google-gemini/cookbook` atual, `gh search code learnlm` só encontra referências em `tools/config.py`, então os notebooks de LearnLM parecem ter sido removidos ou absorvidos pelo Gemini 2.5. **Verificar** a página atual (goo.gle/learnlm) antes de citar instruções específicas.

### 1.1 Clew em detalhe (MIT, criado em 2026-04-02)

Arquitetura (ver `docs/ARCHITECTURE.md` e as ADRs `docs/adr/0001…0008`):

- **Garantias de produto**, quase idênticas às nossas:
  - o grafo é a fonte da verdade;
  - o modelo só **propõe**, e apenas o "Apply" do usuário muda o grafo;
  - cada mudança aceita gera um **snapshot reversível**;
  - a conclusão de um tópico segue regras determinísticas de quiz e pré-requisitos.
- **Contratos** em `contracts/graph_patch.schema.json` (envelope `GraphProposalEnvelope`) e `contracts/clew_tools.schema.json`:
  - O envelope tem `base_graph_version` (concorrência otimista), `mode`, `intent`, `source_bundle`, `assumptions`, `warnings`, `open_questions`, `operations[]` e `provenance`.
  - `GraphOperation.op` ∈ {`upsert_topic`, `upsert_edge`, `upsert_zone`}, com `depends_on[]`, `rationale` e `status` (`proposed|reviewed|rejected|applied`).
  - Estados de domínio: `not_started|learning|shaky|solid|mastered|needs_review`.
  - `ProposalEdge.relation` ∈ {`requires`, `supports`, `bridges`, `extends`, `reviews`}, com `weight`.
- **Validação** em `backend/app/services/proposal_validator.py` + `proposal_normalizer.py`. O validador rejeita:
  - referências desconhecidas;
  - **ilhas desconectadas**;
  - URLs de recurso inseguras;
  - tópicos novos que se declaram já dominados.

  O erro volta ao modelo para autocorreção, sem "reparo silencioso".
- **Ferramentas do agente:** `read_graph`, `read_topic`, `propose_ingest`, `propose_expand`, `ask_question`, `present_quiz` e `create_closure_quiz`.
  - Os *cards* de pergunta encerram o turno (`awaiting_answer`) e a resposta abre um novo turno com dados estruturados.
  - Esse padrão evita o modelo que "explica rápido e despeja perguntas" (meta 9): a pergunta é um evento de UI, não texto solto.
- **Sign in with ChatGPT** (ADR 0006, aceita em 2026-10-02):
  - OAuth 2.0 + PKCE + nonce OIDC, com registro dinâmico de cliente (`dynamic_agent_client`) e redirect *loopback*.
  - Escopos `offline_access` e `chatgpt.tokens.use.direct`.
  - Tokens apenas no cofre do SO (`keyring`), sem fallback em texto plano.
  - Chamadas a `https://api.openai.com/v1/responses` com `store:false`.
  - **Modelos vêm de `GET /v1/models`** (`visibility: list`), e o primeiro é o padrão do plano. É exatamente a meta 7, sem hardcode.
  - Só planos Plus e Pro; os limites por app são definidos pelo usuário em ChatGPT → Settings → Usage.
  - Código em `backend/app/agent/chatgpt_auth.py`, `chatgpt_api.py` e `runtime.py`.
  - A ADR registra que o *DevKit* oficial ([openai/sign-in-with-chatgpt-devkit](https://github.com/openai/sign-in-with-chatgpt-devkit)) tem **licença não comercial**. Por isso o Clew reimplementou o protocolo, e nós devemos fazer o mesmo, em TS e a partir da documentação.
- **Frontend:** `frontend/src/components/GraphCanvas.tsx`, `graphCanvasCore.ts`, `Graph3DCanvas.tsx` (three.js) e `graphCanvasInteractions.ts`, mais os temas "Midnight" e "Paper". Exporta e importa Obsidian (`backend/app/services/obsidian_export.py`).
- **Extrair:**
  1. o schema de proposta, convertido para Zod (o LH já usa `zod` 4);
  2. as regras do validador;
  3. o fluxo de *snapshot + receipt* numa transação;
  4. o fluxo OAuth reimplementado em TS no processo principal do Electron (`safeStorage`/keytar no lugar de `keyring`);
  5. o padrão "card encerra o turno".

### 1.2 GenMentor (CC0)

- **Rotas:**
  - `app/src/app/api/{refine-goal,identify-skill-gap,profile,schedule-path,explore-knowledge,draft-knowledge,integrate-document,generate-quiz,simulate-feedback,tutor}/route.ts`
  - lógica em `app/src/lib/agents/{goal,path,profile,knowledge,quiz,feedback,tutor,run}.ts`
  - catálogo de modelos em `app/src/lib/llm/model-catalog.ts`
- Os prompts são os do paper. O git tag `prompts-baseline` preserva a versão verbatim, e há `scripts/eval-prompts.sh` para comparar edições.
- **Extrair** o "Learner Feedback Simulator", que faz um aluno simulado criticar trilha e conteúdo antes de mostrar ao usuário real. Ele serve de *gate* de qualidade barato para aulas geradas na hora, e de agente para Monte Carlo (§9).

### 1.3 tutor-mcp (MIT, Go)

Arquivos de motor:

| Grupo | Arquivos |
|---|---|
| Algoritmos | `algorithms/{bkt.go, individual_bkt.go, fsrs.go}` |
| Seleção e gates | `engine/{gate.go, concept_selector.go, action_selector.go}` |
| Fases | `engine/{phase_fsm.go, phase_config.go}` |
| Política e calibração | `engine/{bkt_policy.go, calibration_policy.go}` |
| Evidência | `engine/{evidence.go, evidence_controller.go}` |
| Metacognição e motivação | `engine/{metacognition.go, motivation.go, nudge_planner.go}` |
| Modelo do aluno | `engine/{olm.go, olm_global.go}` |
| Qualidade do grafo | `engine/graph_quality.go` |
| Persistência | `db/bkt_calibration*.go` |

- O README mostra um limiar de roteamento de **0,85 de maestria** antes de liberar sondas Feynman e de transferência.
- **Extrair:** a separação explícita entre "conhecimento estimado", "aprendizado retido" e "habilidade demonstrada" (três sinais diferentes no perfil do aluno), além do `graph_quality.go`, cujas heurísticas de qualidade do grafo gerado por IA são úteis para a expansão procedural.

---

## 2. Grafos de conhecimento, currículo e roadmaps

| Repo | ★ | Licença | Ling. | Último push | Compat. | O que aproveitar |
|---|---|---|---|---|---|---|
| [chuma-beep/mathua](https://github.com/chuma-beep/mathua) | 425 | MIT | Go + TS | 2026-11-18 | ✅ | **DAG verificado** (`internal/concepts/{dag.go,loader.go,mastery_units.go}`, `cmd/validate-mastery-units`). Conceitos são fragmentados em 3 subgoals cada (9045 exemplos trabalhados). Ver §2.1. |
| [miuuyy/Clew](https://github.com/miuuyy/Clew) | 270 | MIT | TS + Py | 2026-11-16 | ✅ | Ver §1.1: proposta, validação e *snapshot* do grafo. |
| [metacademy/metacademy-content](https://github.com/metacademy/metacademy-content) | 91 | **CC-BY-SA 3.0 US** (conteúdo) | dados | 2017-05-14 (descontinuado) | 📄 | 393 conceitos de ML/estatística. Ver §2.2: o **formato** é a melhor referência para ligar recursos a regiões do grafo. |
| [metacademy/metacademy-application](https://github.com/metacademy/metacademy-application) | 686 | GPL-3.0 | JS/Py | 2023-05-01 (**arquivado**) | ✅ (ler) | Algoritmo de "learning plan": fecho transitivo dos pré-requisitos do alvo, depois ordenação topológica e estimativa de tempo. É simples o bastante para reescrever. |
| [xiaoyang111222/cn-math-taxonomy](https://github.com/xiaoyang111222/cn-math-taxonomy) | 8.5k | **CC BY-NC 4.0** | Python/dados | 2026-11-16 | ⚠️ | 1644 pontos de conhecimento, 2403 arestas de pré-requisito e 6723 itens, com **diagnóstico adaptativo que retrocede pelas arestas** (do ensino médio até o fundamental). Inglês fica num grafo separado. Bom modelo de "diagnóstico por retrocesso". Licença não comercial. |
| [vellvient/obsidian-learning-engine](https://github.com/vellvient/obsidian-learning-engine) | 10 | MIT | Python stdlib | 2026-08-03 | ✅ | Sistema "Math Academy" sobre Obsidian: grafo de pré-requisitos + FSRS v6 + FIRe. Pequeno e fácil de ler, com ponte para a meta 4. |
| [nilbuild/developer-roadmap](https://github.com/nilbuild/developer-roadmap) (ex-`kamranahmedse/developer-roadmap`, roadmap.sh) | 372k | **Proprietária** ("uso pessoal") | TS | 2026-11-18 | ❌ | Só referência de UX: roadmaps clicáveis com status por nó. O LICENSE proíbe reutilizar conteúdo, imagens e arquivos. |
| [THU-KEG/MOOCCubeX](https://github.com/THU-KEG/MOOCCubeX) | 204 | GPL-3.0 | Python/dados | 2023-12-27 | ✅ | Repositório de conhecimento de MOOCs com conceitos, relações de pré-requisito e vídeos. Útil como dataset de treino e avaliação de "detecção de pré-requisito". |
| [AuvaLab/itext2kg](https://github.com/AuvaLab/itext2kg) | 980 | Apache-2.0 | Python | 2026-09-04 | ✅ | Construção incremental de KG a partir de texto, com resolução de entidades. Útil para extrair conceitos de capítulos de livro. |
| [stair-lab/kg-gen](https://github.com/stair-lab/kg-gen) | 1.3k | sem licença | Python | 2026-03-24 | ❌ (ler) | KG a partir de texto (NeurIPS'25). Ler o método de *clustering* de entidades, mas não copiar. |
| [microsoft/graphrag](https://github.com/microsoft/graphrag) / [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG) | 36.7k / 40.8k | MIT | Python | 2026-11 | ✅ | RAG sobre grafo para "aulas fundamentadas em livros". O LightRAG é mais leve. |
| [sagefy/sagefy](https://github.com/sagefy/sagefy) | 120 | Apache-2.0 | JS | 2024-06-18 | ✅ | Plataforma "open-content" com unidades e pré-requisitos e escolha do próximo passo. Projeto antigo, com ideias de *crowd-content*. |
| [Yale-LILY/LectureBank](https://github.com/Yale-LILY/LectureBank) | 136 | sem licença | dados | 2023-11-06 | ❌ (ler) | Dataset de relações de pré-requisito (NLP/ML). Serve só para avaliação interna. |

### 2.1 Mathua: o que portar para TS

- **Grafo:** `internal/concepts/dag.go` (verificação de aciclicidade e carga), `mastery_units.go` (ADR-050: "unidade de maestria é uma partição nomeada") e `labels.go`.
- **Maestria como máquina de estados:** `internal/mastery/{machine.go,evidence.go,status.go,scaffold.go}`, com as ADRs:
  - ADR-037: "mastery is an exit and decay is…";
  - ADR-038: maestria decidida por evidência;
  - ADR-046: a avaliação verifica evidência e não a cria;
  - ADR-008: o *placement* nunca destrói maestria.

  Essas regras viram **invariantes formais** para o §8.
- **Repetição:** `internal/repetition/{advance.go,allocate.go,credit.go}` e `internal/fire/mode.go`. O FIRe (*Fractional Implicit Repetition*) dá crédito parcial de revisão aos pré-requisitos quando o aluno pratica um tópico avançado. É essencial para um grafo de 1000–1500 h não explodir em revisões.
- **Velocidade:** acerto lento conta como maestria fraca (limiar de segundos por conceito).
- **Governança da expansão:** `docs/expansion-waves/wave-N-{candidates,proposal,review}.md` mostra um processo em três etapas para adicionar conceitos: candidatos, proposta e revisão. É o análogo humano do nosso "algoritmo pede à IA para expandir".

### 2.2 Formato Metacademy (para ligar livros e vídeos a regiões)

Cada conceito tem uma pasta `concepts/<tag>/` com os arquivos:

- `title.txt`, `summary.txt`, `id.txt`, `topics.txt`, `flags.txt`, `see-also.txt`;
- `dependencies.txt`: blocos `tag:` + `reason:`, com a justificativa da aresta;
- `resources.txt`: blocos `source:` + `location:`, por exemplo "part 2 (from 100-105…)" ou "section …".

Na raiz ficam `resources.txt` (catálogo de fontes), `time_estimates/` e `shortcuts`, que são versões "rasas" de um conceito para quem só precisa do básico.

**Proposta:** adotar o modelo `Resource{sourceId, location:{kind:'chapter'|'pages'|'timestamp', …}, coversNodes[]}`, em que um livro cobre um **conjunto** de nós (uma região) e um vídeo cobre poucos. Adotar também `shortcut` como nó "versão leve".

---

## 3. Spaced repetition e knowledge tracing

| Repo | ★ | Licença | Ling. | Último push | Compat. | O que aproveitar |
|---|---|---|---|---|---|---|
| [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | 879 | MIT | TS | 2026-11-17 (v6.0.0 em 2026-10-28) | ✅ | **Dependência direta.** `DefaultScheduler()` usa FSRS-7 (intervalos fracionários), com `preview()` dos 4 resultados e `review()`. O otimizador `@open-spaced-repetition/binding` (FSRS-6/7) oferece `computeParameters` e `convertCsvToFsrsItems`, com build WASI para browser. Requer Node ≥24. Guia de migração v5→v6 no site. |
| [open-spaced-repetition/fsrs-rs](https://github.com/open-spaced-repetition/fsrs-rs) | 463 | BSD-3 | Rust | 2026-11-18 | ✅ | Otimizador + **simulador** (`simulate_with_cost_adr_policy`, `CostAdrPolicy`). O padrão simula 1825 dias com 10k cartas. Serve para o Monte Carlo de carga diária (§9). |
| [open-spaced-repetition/fsrs-browser](https://github.com/open-spaced-repetition/fsrs-browser) | 59 | BSD-3 | Rust→WASM | 2026-06-14 | ✅ | Otimizador e agendador no browser. É uma alternativa ao `binding`. |
| [open-spaced-repetition/fsrs4anki](https://github.com/open-spaced-repetition/fsrs4anki) | 4.1k | MIT | Notebook | 2026-08-14 | ✅ | Documentação do algoritmo (wiki) e *helper* de Anki. |
| [open-spaced-repetition/srs-benchmark](https://github.com/open-spaced-repetition/srs-benchmark) | 289 | **sem LICENSE** | Notebook | 2026-10-24 | ❌ (ler) | Benchmark com ~727M revisões de 10k usuários do Anki. Ver números abaixo. |
| [open-spaced-repetition/py-fsrs](https://github.com/open-spaced-repetition/py-fsrs) / [fsrs-optimizer](https://github.com/open-spaced-repetition/fsrs-optimizer) | 533 / 113 | MIT / BSD-3 | Python | 2026 | ✅ | Referência e ferramentas offline. |
| [open-spaced-repetition/awesome-fsrs](https://github.com/open-spaced-repetition/awesome-fsrs) | 772 | CC0 | lista | 2026-11-18 | ✅ | Índice de implementações e papers. |
| [duolingo/halflife-regression](https://github.com/duolingo/halflife-regression) | 585 | MIT | Python | 2026-11-10 | ✅ | HLR, o modelo clássico da Duolingo. Serve de *baseline* para vocabulário de Inglês. |
| [pykt-team/pykt-toolkit](https://github.com/pykt-team/pykt-toolkit) | 462 | MIT | Python (PyTorch) | 2026-10-18 | ✅ | Biblioteca padrão de **Deep Knowledge Tracing**: DKT, SAKT, AKT, simpleKT, entre outros, com pré-processamento padronizado de mais de 7 datasets. Usar offline para escolher e validar o modelo de KT. Para runtime, preferir BKT/IRT leves em TS. |
| [CAHLR/pyBKT](https://github.com/CAHLR/pyBKT) | 292 | MIT | C++/Python | 2026-11-02 | ✅ | BKT e extensões, como KT-IDEM e KT-PPS. Portar as equações (são 4 parâmetros por skill) para TS. |
| [HFUT-LEC/EduStudio](https://github.com/HFUT-LEC/EduStudio) | 83 | MIT | Python | 2026-11-13 | ✅ | Biblioteca unificada de *cognitive modeling*, com KT e diagnóstico cognitivo (Frontiers of CS 2025). |
| [bigdata-ustc/EduKTM](https://github.com/bigdata-ustc/EduKTM) / [EduCDM](https://github.com/bigdata-ustc/EduCDM) | 268 / 206 | Apache-2.0 | Python | 2024 | ✅ | Zoológico de modelos de KT e de diagnóstico cognitivo (IRT, MIRT, NCD). Ambos parados desde 2024. |
| [andymatuschak/orbit](https://github.com/andymatuschak/orbit) | 1.8k | NOASSERTION (verificar) | TS | 2026-10-20 | ⚠️ | "Prosa mnemônica": prompts de revisão embutidos no texto da aula. Boa ideia para a meta 9. |

**Números atuais do srs-benchmark** (README de 2026-10). Métricas: LogLoss↓, RMSE(bins)↓ e AUC↑.

| Algoritmo | Parâm. | Sem revisões no mesmo dia | Com revisões no mesmo dia |
|---|---|---|---|
| LSTM | 8869 | 0.3332 / 0.0538 / 0.7329 | **0.3140** / 0.0520 / **0.7622** |
| GRU | 503 | **0.3328** / 0.0549 / 0.7324 | 0.3141 / 0.0536 / 0.7606 |
| FSRS-7 recency | 34 | 0.3370 / 0.0593 / 0.7220 | 0.3178 / 0.0572 / 0.7522 |
| FSRS-7 | 34 | 0.3401 / 0.0634 / 0.7167 | 0.3206 / 0.0615 / 0.7475 |
| FSRS-6 | 21 | 0.3460 / 0.0653 / 0.7034 | 0.3842 / 0.0985 / 0.6830 |
| FSRS-7 (parâmetros padrão) | 0 | 0.3620 / 0.0910 / 0.7029 | 0.3399 / 0.0895 / 0.7283 |

**Leitura:**

- FSRS-7 com otimização por usuário fica a ~1% de LogLoss das RNNs, com 34 parâmetros em vez de 8869.
- O ganho do FSRS-7 sobre o FSRS-6 é grande **quando há revisões no mesmo dia**, que é o caso típico de sessões longas de estudo.
- **Recomendação:** ts-fsrs v6 (FSRS-7) + otimização periódica com `binding` a partir do revlog local. Os parâmetros ficam **separados por domínio**, o que atende à meta 3.

---

## 4. Memória de agentes

> Este tema provavelmente tem um relatório próprio. Aqui o foco é **descoberta, licença e atividade**.

| Repo | ★ | Licença | Ling. | Último push | Compat. | Destaques |
|---|---|---|---|---|---|---|
| [mem0ai/mem0](https://github.com/mem0ai/mem0) | 69.2k | Apache-2.0 | Python (+SDK TS `mem0ai`) | 2026-11-18 | ✅ | Algoritmo novo: **LoCoMo 92,5 / LongMemEval 94,4 / BEAM-1M 64,1 / BEAM-10M 48,6**, com ~7K tokens. Ressalva do próprio README: são números da **plataforma gerenciada**, que tem otimizações proprietárias ausentes no OSS. O framework de avaliação ([mem0ai/memory-benchmarks](https://github.com/mem0ai/memory-benchmarks)) é aberto. |
| [vectorize-io/hindsight](https://github.com/vectorize-io/hindsight) | 61.7k | MIT | Python (+cliente Node `@vectorize-io/hindsight-client`, Go, CLI) | 2026-11-18 | ✅ | [benchmarks.hindsight.vectorize.io](https://benchmarks.hindsight.vectorize.io/): **LongMemEval-S 94,6%**, LoCoMo10 92%, PersonaMem-32K 86,6%, BEAM 100K/500K/1M/10M = 75 / 71,1 / 73,9 / 64,1%. O README diz que foi reproduzido pelo Sanghani Center (Virginia Tech) e pelo Washington Post. Tem *banks*, MCP por bank, Postgres ou "pg0" embutido e modelos próprios abertos (hs-decide, hs-rerank, hs-embed, lançados em 2026-11-03). Paper: [arXiv 2512.12818](https://arxiv.org/abs/2512.12818). |
| [volcengine/OpenViking](https://github.com/volcengine/OpenViking) | 42.4k | AGPL-3.0 | Python (+SDK TS) | 2026-11-18 | ✅ | "Context database" que unifica memória, RAG e skills. LoCoMo 80–83% nas integrações. A AGPL é compatível com o fork. |
| [topoteretes/cognee](https://github.com/topoteretes/cognee) | 33.4k | Apache-2.0 | Python (+SDK TS) | 2026-11-18 | ✅ | Memória como grafo e vetor, com avaliação BEAM (ver `cognee/eval_framework/beam/REPORT.md`). |
| [getzep/graphiti](https://github.com/getzep/graphiti) | 32.9k | Apache-2.0 | Python (+SDK TS/Go via Zep) | 2026-11-17 | ✅ | **KG temporal bi-temporal**: fatos com validade no tempo. Modela bem "o ponto fraco X foi superado em tal data". |
| [supermemoryai/supermemory](https://github.com/supermemoryai/supermemory) | 31.7k | MIT | TS | 2026-11-18 | ✅/⚠️ | Diz ser "#1" em LongMemEval, LoCoMo e ConvoMem, com Recall@15 de 95% e ~720 tokens de contexto. Publica o MemoryBench aberto. O motor "local" é instalado por script de supermemory.ai, então **verificar** se o core está no repositório. |
| [letta-ai/letta](https://github.com/letta-ai/letta) | 25.5k | Apache-2.0 | (Python/TS) | 2026-10-18 | ✅ | Agentes *stateful* com memória editável (blocos *core* e *archival*) e Agent SDK em TS. |
| [MemTensor/MemOS](https://github.com/MemTensor/MemOS) | 12.4k | Apache-2.0 | TS | 2026-11-18 | ✅ | LoCoMo 88,83, LongMemEval 89,20, BEAM-10M 56,75 (autodeclarado em 2026-07). Plugin local em npm (`@memtensor/memos-local-plugin`, FTS5 + vetor). Ficou em 2º no AML Cycle 1 comercial. |
| [EverMind-AI/EverOS](https://github.com/EverMind-AI/EverOS) | 13.9k | Apache-2.0 | Python | 2026-11-18 | ✅ | Memória local-first e Markdown-native. Reprodução de benchmarks em `benchmarks/README.md`. |
| [NevaMind-AI/memU](https://github.com/NevaMind-AI/memU) | 14.6k | Apache-2.0 (LICENSE) | Python | 2026-11-18 | ✅ | Core de ~500 linhas, um "LLM wiki" compartilhado. Fácil de ler. |
| [plastic-labs/honcho](https://github.com/plastic-labs/honcho) | 8.2k | AGPL-3.0 | Python (+SDK TS) | 2026-11-17 | ✅ | Modelagem de *identidade* do usuário (theory of mind). Base do tutor-gpt. |
| [basicmachines-co/basic-memory](https://github.com/basicmachines-co/basic-memory) | 4.6k | AGPL-3.0 | Python | 2026-11-17 | ✅ | Memória em Markdown com MCP. Integra com Obsidian. |
| [Mirix-AI/MIRIX](https://github.com/Mirix-AI/MIRIX) | 3.5k | Apache-2.0 | Python | 2026-11-11 | ✅ | Seis tipos de memória (*core*, episódica, semântica, procedural, *resource*, *knowledge vault*). |
| [memodb-io/memobase](https://github.com/memodb-io/memobase) | 3.0k | Apache-2.0 | Python | 2026-01-11 | ✅ | Memória baseada em **perfil de usuário** (slots). Bom para "perfil do aluno". |
| [langchain-ai/langmem](https://github.com/langchain-ai/langmem) | 1.8k | MIT | Python | 2026-11-16 | ✅ | Primitivas de memória *semantic*, *episodic* e *procedural*. |
| [agiresearch/A-mem](https://github.com/agiresearch/A-mem) / [WujiangXu/A-mem](https://github.com/WujiangXu/A-mem) | 1.2k / 1.0k | MIT | Python | 2025-12 / 2026-10 | ✅ | A-MEM (NeurIPS 2025): notas Zettelkasten com *links* evolutivos. |
| [AML-memory/agent-memory-leaderboard](https://github.com/AML-memory/agent-memory-leaderboard) | 1.1k | sem licença | Python | 2026-11-02 | ❌ (ler) | **Leaderboard independente** com contrato fixo (Add/Search). No Cycle 1 (2026-08-12), o melhor open-source em memória textual foi InvMem (45,06) e o comercial foi MemoraX v0.5 (58,02), seguido do MemOS v2.0.1 (45,89). O Cycle 2 tem divulgação prevista para meados de nov/2026 (**verificar**). |
| [xiaowu0162/LongMemEval](https://github.com/xiaowu0162/LongMemEval) / [snap-research/locomo](https://github.com/snap-research/locomo) | 1.2k / 1.3k | MIT / NOASSERTION | Python | 2026-05 / 2024-08 | ✅ / ⚠️ | Os benchmarks em si. Úteis para montar um **mini-benchmark próprio** de "memória do aluno". |
| Outros com licença ambígua | | | | | | [MemoriLabs/Memori](https://github.com/MemoriLabs/Memori) (17.6k, NOASSERTION), [TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) (31.0k, NOASSERTION) e [memvid/memvid](https://github.com/memvid/memvid) (17.4k, Apache, Rust, último push em 2026-07). |

**Recomendação de descoberta:**

- **hindsight** (MIT) é o candidato a "SOTA open-source integrável": um *bank* por domínio, `reflect` para gerar o resumo "onde o aluno está e para onde vai", e cliente Node.
- **graphiti** (Apache) vem como camada temporal de "pontos fracos".
- O próprio **grafo de conhecimento do app** é a memória estruturada principal (estado de maestria por nó). A memória do agente guarda o **episódico e o qualitativo**: erros típicos, preferências e o que funcionou didaticamente.

---

## 5. Recursos: YouTube, PDFs e livros abertos

### 5.1 YouTube (busca, legendas, tradução e dublagem)

| Repo | ★ | Licença | Ling. | Último push | Compat. | Uso |
|---|---|---|---|---|---|---|
| [LuanRT/YouTube.js](https://github.com/LuanRT/YouTube.js) (`youtubei.js`) | 5.4k | MIT | TS | 2026-11-11 | ✅ | **Principal.** `Innertube.search()` (`src/parser/youtube/Search.ts`) e `VideoInfo.getTranscript()` (`src/core/mixins/MediaInfo.ts` → `TranscriptInfo.ts`). As trilhas ficam em `PlayerCaptionsTracklist` (`src/parser/classes/PlayerCaptionsTracklist.ts`), que expõe `translation_languages`: basta pedir a trilha EN com tradução automática para PT. Roda em Node, Deno e browser. Exemplo em `examples/transcript/index.ts`. |
| [LuanRT/BgUtils](https://github.com/LuanRT/BgUtils) | 350 | MIT | TS | 2026-10-23 | ✅ | Gera PO tokens (BotGuard) quando o YouTube exigir, para *streams* e algumas legendas. |
| [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) | 208.8k | Unlicense | Python | 2026-11-17 | ✅ | Fallback robusto via binário (`--write-auto-subs --sub-langs "pt.*,en.*" --skip-download -J`). Precisa de runtime JS externo ([yt-dlp/ejs](https://github.com/yt-dlp/ejs), Unlicense) para os desafios do YouTube. Empacotar o binário oficial e **não** executar código de fontes não confiáveis. |
| [ericmmartin/youtube-transcript-plus](https://github.com/ericmmartin/youtube-transcript-plus) | 169 | MIT | TS | 2026-11-14 | ✅ | API mínima `fetchTranscript(id, {lang, videoFetch, playerFetch, transcriptFetch})`, com *fetchers* injetáveis para usar o `net.fetch` do Electron e cache. |
| [jdepoix/youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api) | 8.6k | MIT | Python | 2026-11-09 | ✅ | Referência madura (inclui `translate()`). Ler a lógica, não usar em runtime. |
| [Kakulukian/youtube-transcript](https://github.com/Kakulukian/youtube-transcript) | 590 | sem licença | TS | 2026-04-25 | ❌ | Evitar por falta de licença. |
| [Huanshere/VideoLingo](https://github.com/Huanshere/VideoLingo) | 19.3k | Apache-2.0 | Python | 2026-11-13 | ✅ | Legenda "nível Netflix": corte, tradução, alinhamento e **dublagem**. Fica como pipeline offline opcional para vídeos EN sem dublagem PT. |
| [krillinai/OpenCreator](https://github.com/krillinai/OpenCreator) (ex-KrillinAI) | 14.4k | Apache-2.0 | TS | 2026-11-18 | ✅ | Tradução e dublagem em mais de 120 idiomas. É uma alternativa ao VideoLingo. |
| [iv-org/invidious](https://github.com/iv-org/invidious) / [TeamNewPipe/NewPipeExtractor](https://github.com/TeamNewPipe/NewPipeExtractor) | 26.1k / 2.1k | AGPL / GPL-3 | Crystal / Java | 2026-11 | ✅ | Referências de extração sem API oficial. Úteis quando o YouTube muda o InnerTube. |

**Pipeline sugerido (meta 1):**

1. Busca:
   - `youtubei.js` `search(query, {type:'video'})`, filtrando por duração e idioma;
   - ranqueamento por LLM com base no título, na descrição e nos **primeiros minutos da transcrição**.
2. Alinhamento:
   - transcrição dividida em segmentos, depois *embedding*;
   - mapeamento segmento → nó do grafo (`Resource.location = {kind:'timestamp', start, end}`).
3. Legendas: se o vídeo for EN, tentar a trilha manual EN com `tlang=pt`, depois a automática. A dublagem fica como "job" opcional.

### 5.2 PDF e livros

| Repo | ★ | Licença | Ling. | Último push | Compat. | Uso |
|---|---|---|---|---|---|---|
| [mozilla/pdf.js](https://github.com/mozilla/pdf.js) | 54.2k | Apache-2.0 | JS | 2026-11-17 | ✅ | O LH já usa `pdfjs-dist` 6.3. `getOutline()` fornece o sumário e os capítulos (a "região" do livro). |
| [unjs/unpdf](https://github.com/unjs/unpdf) | 1.3k | MIT | TS | 2026-11-15 | ✅ | Wrapper do pdf.js para qualquer runtime: `extractText`, `getDocumentProxy`, metadados e imagens. Simplifica o processo principal do Electron. |
| [run-llama/liteparse](https://github.com/run-llama/liteparse) | 13.1k | Apache-2.0 | Rust (+npm `@llamaindex/liteparse`, `-wasm`) | 2026-11-17 | ✅ | Parser rápido com layout, sem Python. |
| [datalab-to/marker](https://github.com/datalab-to/marker) | 41.0k | **Código Apache-2.0; pesos OpenRAIL-M modificado** | Python | 2026-11-14 | ⚠️ | Melhor qualidade autodeclarada no OmniParseBench: "Marker vllm" 85,9; "Marker fast" (CPU) 71,0 contra docling 67,5. Pesos livres só para pesquisa, uso pessoal e startups abaixo de US$ 5M. Bom para um job opcional local, controlado pelo usuário. |
| [docling-project/docling](https://github.com/docling-project/docling) (+ [docling-ts](https://github.com/docling-project/docling-ts)) | 70.7k / 37 | MIT | Python / TS | 2026-11-18 | ✅ | Conversão estruturada (DoclingDocument). O `docling-ts` tem tipos e cliente TS. |
| [opendatalab/MinerU](https://github.com/opendatalab/MinerU) | 83.9k | Apache-2.0 + termos extras | Python | 2026-11-18 | ⚠️ | Alta qualidade em livros científicos (fórmulas). Exige atribuição se usado como serviço e tem limites de MAU/receita. |
| [pymupdf/pymupdf4llm](https://github.com/pymupdf/pymupdf4llm) | 2.3k | AGPL-3.0 | Python | 2026-11-18 | ✅ | Markdown "LLM-ready" muito rápido. Compatível com AGPL. |
| [opendataloader-project/opendataloader-pdf](https://github.com/opendataloader-project/opendataloader-pdf) | 30.3k | Apache-2.0 | Java | 2026-11-18 | ✅ | Alternativa em JVM. |
| [microsoft/markitdown](https://github.com/microsoft/markitdown) | 196.3k | MIT | Python | 2026-11-07 | ✅ | Converte qualquer formato para Markdown (qualidade básica). |

**Livros abertos verificados:**

- **Eletrônica:**
  - Tony Kuphaldt, *Modular Electronics Learning (MEL) Project* ([ibiblio.org/kuphaldt/socratic/model](https://www.ibiblio.org/kuphaldt/socratic/model/)), **CC-BY 4.0** (confirmado na página). Os módulos já trazem tutoriais em múltiplos níveis e problemas "socráticos", um encaixe perfeito com o grafo.
  - *Lessons In Electric Circuits* ([ibiblio.org/kuphaldt/electricCircuits](https://www.ibiblio.org/kuphaldt/electricCircuits/)), sob Design Science License.
- **OpenStax:**
  - O conteúdo CNXML fica em `openstax/osbooks-*`, por exemplo [osbooks-university-physics-bundle](https://github.com/openstax/osbooks-university-physics-bundle), com `collections/*.collection.xml` (sumário) e `modules/` (seções).
  - **Atenção:** o `LICENSE` desse bundle diz **CC BY-NC-SA 4.0**. Verificar livro a livro na página da OpenStax antes de redistribuir.
  - O [CAHLR/OATutor-Content](https://github.com/CAHLR/OATutor-Content) traz problemas OpenStax com *hints*.
- **Inglês** (ver §10.2): CEFR-J, Words-CEFR, Tatoeba e Wiktionary.

---

## 6. Anki e Obsidian

| Repo | ★ | Licença | Ling. | Último push | Compat. | Uso |
|---|---|---|---|---|---|---|
| [repeat-space/anki-apkg-export](https://github.com/repeat-space/anki-apkg-export) | 183 | MIT | TS | 2026-10-21 | ✅ | **Exportar `.apkg` offline.** API: `AnkiExport.create(deck, {kind:'basic'|'reversed'|'cloze'})`, `addCard(front, back, {noteId, tags})`, `addMedia`, `save({type:'blob'})`. Arquivos: `src/{exporter,schema,template,types}.ts`. Requer Node ≥22.12. O `noteId` estável permite **reexportar sem duplicar**. |
| AnkiConnect ([git.sr.ht/~foosoft/anki-connect](https://git.sr.ht/~foosoft/anki-connect)) | (GitHub: 2.1k, **arquivado**) | GPL-3 (verificar) | Python (add-on) | commits há 2 dias no sourcehut | ✅ | O repositório no GitHub foi **arquivado e movido para o sourcehut**, onde continua ativo. É a API HTTP local (porta 8765) para sincronizar ao vivo com o Anki aberto (`addNotes`, `findNotes`, `updateNoteFields`, `guiBrowse`). |
| [ankimcp/anki-mcp-server](https://github.com/ankimcp/anki-mcp-server) (+ [addon](https://github.com/ankimcp/anki-mcp-server-addon)) | 567 / 103 | MIT / NOASSERTION | TS / Python | 2026-11 | ✅ / ⚠️ | 53 ferramentas MCP (42 essenciais e 11 de GUI). O add-on roda o MCP **dentro do Anki**, sem AnkiConnect. Como o LH já tem `@modelcontextprotocol/sdk`, dá para plugar direto. |
| [ankitects/anki](https://github.com/ankitects/anki) | 32.9k | **AGPL-3.0-or-later** | Rust/Python/TS | 2026-11-18 | ✅ | Formato oficial (`collection.anki21b`: zstd + protobuf) e *rslib*. Licença idêntica à nossa, então é possível estudar e até reaproveitar trechos. |
| [kerrickstaley/genanki](https://github.com/kerrickstaley/genanki) | 2.8k | MIT | Python | 2024-12-30 | ✅ | Referência madura de geração de `.apkg` (GUIDs e modelos), mas parada. |
| [st3v3nmw/obsidian-spaced-repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) | 2.6k | MIT | TS | 2026-11-16 | ✅ | **Sintaxe de cards em Markdown** (`::`, `:::`, `?`, `??`, cloze `==…==`/`**…**`) e o parser. Exportar notas de sessão no **formato que esse plugin lê** dá compatibilidade de graça. |
| [open-spaced-repetition/obsidian-spaced-repetition-recall](https://github.com/open-spaced-repetition/obsidian-spaced-repetition-recall) | 211 | MIT | TS | 2026-11-07 | ✅ | Fork com **FSRS (ts-fsrs)**, agenda num `tracked_files.json` separado (sem sujar a nota) e exportação de `ob-revlog.csv` para o otimizador. Agora é mantido pela org open-spaced-repetition. |
| [reuseman/flashcards-obsidian](https://github.com/reuseman/flashcards-obsidian) | 1.1k | MIT | TS | 2026-10-31 | ✅ | Obsidian → Anki via AnkiConnect, com IDs gravados na nota. |
| [ObsidianToAnki/Obsidian_to_Anki](https://github.com/ObsidianToAnki/Obsidian_to_Anki) | 2.1k | GPL-3.0 | Python | 2024-06-16 | ✅ (parado) | Regex de formatos de card. Útil como referência, mas sem atividade. |
| [debanjandhar12/logseq-anki-sync](https://github.com/debanjandhar12/logseq-anki-sync) | 589 | AGPL-3.0 | TS | 2026-11-07 | ✅ | Sincronização sofisticada com *image occlusion*, direção de card e *incremental cards*. Licença igual à nossa. |
| [dscherdi/decks](https://github.com/dscherdi/decks) | 77 | AGPL-3.0 | TS | 2026-11-14 | ✅ | Plugin de flashcards para Obsidian (AGPL). |
| [thiswillbeyourgithub/AnkiAIUtils](https://github.com/thiswillbeyourgithub/AnkiAIUtils) | 896 | AGPL-3.0 | Python | 2026-11-17 | ✅ | IA para explicar, criar mnemônicos e ilustrar cards que o aluno erra. Ideia de "reforço automático de cards difíceis". |
| [dobladov/youtube2Anki](https://github.com/dobladov/youtube2Anki) | 94 | GPL-3.0 | JS | 2026-11-15 | ✅ | Transcrição do YouTube → cards. Útil para o domínio Inglês (*sentence mining*). |

**Decisão sugerida (meta 4):**

1. **Fonte da verdade:** os cards ficam dentro do app, agendados pelo ts-fsrs (FSRS-7) e separados por domínio.
2. **Ao fim de cada sessão,** o app oferece três opções:
   - (a) sync ao vivo com o Anki via AnkiConnect ou o add-on AnkiMCP, se o Anki estiver aberto;
   - (b) exportar um `.apkg` (anki-apkg-export) com `noteId` = id do card no app;
   - (c) escrever `.md` no vault Obsidian com a sintaxe do *obsidian-spaced-repetition*.
3. **Revlog:** importar o revlog do Anki (CSV) para o `binding` otimizar os parâmetros. Assim o FSRS do app continua calibrado mesmo quando o aluno revisa fora dele.

---

## 7. Visual: hand-drawn, cel shading e grafos WebGL

### 7.1 Traço desenhado à mão e estética cel

| Repo | ★ | Licença | Ling. | Último push | Compat. | Uso |
|---|---|---|---|---|---|---|
| [rough-stuff/rough](https://github.com/rough-stuff/rough) | 21.4k | MIT | JS (~9 KB) | 2024-07-28 | ✅ | Primitivas *sketchy* em Canvas e SVG (`roughness`, `bowing`, `fillStyle:'hachure'|'zigzag'|'cross-hatch'|'dots'`, **`seed`** para forma estável por id de nó). Estável, ainda que pouco ativo. |
| [Bowen7/react-rough-fiber](https://github.com/Bowen7/react-rough-fiber) | 446 | MIT | TS | 2025-04-28 | ✅ | **Renderer React**: qualquer `<svg>` filho é redesenhado com rough.js. Embrulhar os ícones e os nós do React Flow (já presente no LH) num `<RoughSVG>`. |
| [fskpf/svg2roughjs](https://github.com/fskpf/svg2roughjs) | 220 | MIT | TS | 2026-06-12 | ✅ | Converte SVG → SVG rough **em build**, para gerar um *icon set* "desenhado à mão" a partir de Lucide (o LH usa `lucide-react`) ou Tabler (MIT, mais de 6500 ícones). |
| [steveruizok/perfect-freehand](https://github.com/steveruizok/perfect-freehand) | 5.8k | MIT | TS | 2026-04-13 | ✅ | Traços com pressão: anotações do aluno, sublinhado animado e "tinta" dos ícones. |
| [steveruizok/perfect-arrows](https://github.com/steveruizok/perfect-arrows) | 2.8k | MIT | TS | 2023-01-07 | ✅ | Setas curvas bonitas para arestas de pré-requisito em vistas locais. |
| [rough-stuff/rough-notation](https://github.com/rough-stuff/rough-notation) | 9.8k | MIT | TS | 2024-03-18 | ✅ | Destaques animados (sublinhar, circular, marcador) nas explicações da IA. Dá ênfase visual sem texto extra (meta 9). |
| [jwilber/roughViz](https://github.com/jwilber/roughViz) | 7.2k | MIT | JS | 2024-04-26 | ✅ | Gráficos *sketchy* para as stats do perfil (meta 6). |
| [rough-stuff/wired-elements](https://github.com/rough-stuff/wired-elements) | 10.9k | MIT | TS (web components) | 2023-10-07 | ✅ | Botões, inputs e cards hand-drawn. Melhor usar como **referência** e reimplementar em React/Tailwind. |
| [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) (+ [excalidraw-libraries](https://github.com/excalidraw/excalidraw-libraries), [virgil](https://github.com/excalidraw/virgil)) | 135.9k | MIT (+ OFL-1.1 nas fontes) | TS | 2026-11-18 | ✅ | Pode ser embutido como "quadro" da aula (`@excalidraw/excalidraw`). As bibliotecas comunitárias têm assets (Eletrônica tem libs de componentes). Fontes Virgil e Excalifont sob OFL. |
| [ekmas/neobrutalism-components](https://github.com/ekmas/neobrutalism-components) | 5.7k | MIT | TS (registro **shadcn**) | 2026-11-15 | ✅ | **A forma mais rápida de chegar ao "cel shading" em UI 2D**: borda grossa de "tinta", sombra dura deslocada e cores chapadas. Está no formato shadcn, que o LH já usa (`components.json`). |
| [chr15m/DoodleCSS](https://github.com/chr15m/DoodleCSS) / [papercss/papercss](https://github.com/papercss/papercss) | 1.2k / 4.2k | MIT / ISC | CSS | 2026-04 / 2025-07 | ✅ | Bordas irregulares via `border-radius` assimétrico e `border-image` desenhado. Bons para extrair truques de CSS. |
| [oreo-design/doodle-icons](https://github.com/oreo-design/doodle-icons) | 153 | MIT | TS | 2026-11-04 | ✅ | 197 ícones hand-drawn que **se desenham e "tremem"** (SVG animado e React). É um bom ponto de partida para ícones próprios. |
| [Fantomiald/sketchyicons](https://github.com/Fantomiald/sketchyicons) | 5 | MIT | TS | 2026-08-04 | ✅ | 1756 ícones "sketchy" derivados da geometria do Lucide. Mostra o pipeline Lucide → sketchy (projeto pequeno). |
| [tldraw/tldraw](https://github.com/tldraw/tldraw) | 51.5k | **licença própria** (chave em produção) | TS | 2026-11-18 | ⚠️ | Evitar e preferir Excalidraw. |

**Receita de cel shading para UI** (síntese, aplicável a Tailwind v4, que o LH usa):

- **Tinta:**
  - `--ink: oklch(0.2 0.02 270)`;
  - contorno de 2–3 px em todos os cards, botões e nós;
  - `box-shadow: 4px 4px 0 var(--ink)`, a sombra dura do neobrutalism.
- **Duas tonalidades (o "cel"):** gradiente com parada dura, `background: linear-gradient(170deg, var(--c) 0 60%, var(--c-shade) 60% 100%)`. A cor de sombra sai de `oklch` com L −0,08 e o mesmo matiz.
- **Linha viva:** um filtro SVG global `<filter id="wobble"><feTurbulence baseFrequency="0.02" numOctaves="2" seed="3"/><feDisplacementMap scale="2"/></filter>` aplicado só a contornos e ícones. Fica estático, sem animar, para não cansar.
- **Ícones:** desenhar à mão em SVG (*stroke* 2 px, `stroke-linecap:round`) ou gerar com `svg2roughjs` a partir do Lucide, com `seed` fixa por ícone. Animar o "auto-desenho" com `stroke-dasharray`, como faz o doodle-icons.

### 7.2 Grafos grandes (WebGL)

| Repo | ★ | Licença | Ling. | Último push | Compat. | Quando usar |
|---|---|---|---|---|---|---|
| [jacomyal/sigma.js](https://github.com/jacomyal/sigma.js) + [graphology](https://github.com/graphology/graphology) + [sim51/react-sigma](https://github.com/sim51/react-sigma) | 12.2k / 1.8k / 240 | MIT | TS | 2026-11 (sigma **4.0.6**) | ✅ | **Vista "galáxia" do domínio inteiro** (milhares a dezenas de milhares de nós). O graphology traz `graphology-dag` (topological sort, `hasCycle`), `graphology-layout-forceatlas2` (WebWorker) e `graphology-communities-louvain` (regiões automáticas). *Programs* de nó customizáveis, inclusive ícones como textura (verificar as APIs na v4). |
| [cosmosgl/graph](https://github.com/cosmosgl/graph) (ex-cosmograph-org/cosmos, `@cosmos.gl/graph`) | 1.3k | MIT | TS | 2026-11-18 | ✅ | Layout de força **na GPU** (*shaders*): "centenas de milhares de pontos e links" em tempo real. Usar se o grafo passar de ~50k nós. Depende do luma.gl ~9.3. |
| [reaviz/reagraph](https://github.com/reaviz/reagraph) | 1.1k | Apache-2.0 | TS | 2026-06-25 | ✅ | React + WebGL (three.js) com *clusters*, expandir/colapsar e *path finding*. É o mais "pronto" para React. |
| [vasturiano/force-graph](https://github.com/vasturiano/force-graph) / [3d-force-graph](https://github.com/vasturiano/3d-force-graph) / [react-force-graph](https://github.com/vasturiano/react-force-graph) | 2.2k / 6.6k / 3.4k | MIT | JS | 2026-09–11 | ✅ | Canvas 2D e 3D rápidos (o Clew usa three.js num modo parecido). |
| [antvis/G6](https://github.com/antvis/G6) | 12.4k | MIT | TS | 2026-11-13 | ✅ | Framework completo (v5 com renderer WebGL, *combos* e layouts hierárquicos). Mais pesado. |
| [xyflow/xyflow](https://github.com/xyflow/xyflow) | 39.1k | MIT | TS | 2026-11-18 | ✅ | **Já está no LH** (`@xyflow/react` 12). Ideal para a **vizinhança local** (≤200 nós) com nós React ricos em estilo rough. |
| [dagrejs/dagre](https://github.com/dagrejs/dagre) / [kieler/elkjs](https://github.com/kieler/elkjs) | 5.9k / 2.9k | MIT / EPL-2.0 (verificar) | TS/JS | 2026-10/11 | ✅ / ⚠️ | Layout **em camadas** (níveis = "altura" do conceito no DAG), para a vista "árvore". |
| [anvaka/ngraph.graph](https://github.com/anvaka/ngraph.graph) | 584 | BSD-3 | JS | 2026-11-17 | ✅ | Estruturas e layouts muito rápidos (base do VivaGraph). |
| [markmap/markmap](https://github.com/markmap/markmap) | 13.3k | MIT | TS | 2026-11-15 | ✅ | Mapa mental a partir de Markdown, para "resumo da região" e sumário de capítulo. |

**Arquitetura de visualização sugerida:**

| Zoom | Ferramenta | O que mostra |
|---|---|---|
| Domínio (galáxia) | sigma v4 + graphology | Nós agregados por **zona/região** (Louvain ou zonas definidas pela IA) com nível de detalhe por zoom. |
| Região | ELK/dagre em camadas | Altura do DAG = "nível". |
| Vizinhança | React Flow | Nós com `react-rough-fiber` e arestas `perfect-arrows`. |

Os estados de maestria aparecem como **duas tonalidades de cel**: preenchimento = maestria e sombra = "vencido para revisão".

---

## 8. Lean 4, formalização de grafos e ordens, e verificação de currículo

Não existe (2026-11) repositório público que verifique currículos em Lean. O caminho é **modelar a lógica de evolução do grafo com a teoria de ordens do mathlib** e espelhar os teoremas como testes de propriedade em TS.

| Repo | ★ | Licença | Ling. | Último push | Uso |
|---|---|---|---|---|---|
| [leanprover-community/mathlib4](https://github.com/leanprover-community/mathlib4) | 4.5k | Apache-2.0 | Lean | 2026-11-18 | Teoria de ordens e grafos (arquivos abaixo). |
| [leanprover/lean4](https://github.com/leanprover/lean4) / [batteries](https://github.com/leanprover-community/batteries) | 10.0k / 435 | Apache-2.0 | Lean | 2026-11-18 | Linguagem e stdlib estendida. |
| [PatrickMassot/leanblueprint](https://github.com/PatrickMassot/leanblueprint) | 402 | Apache-2.0 | Python (plasTeX) | 2025-12-23 | **Grafo de dependências de definições e lemas** com status (pronto, provado, bloqueado), via `\uses{}`/`\lean{}`. É o análogo exato de um "grafo de currículo com fronteira estudável". Copiar o *modelo visual*. |
| [icarm/animate-blueprint-depgraph](https://github.com/icarm/animate-blueprint-depgraph) | 6 | Apache-2.0 | Python | 2026-07-12 | Anima a história do grafo de dependências, o que lembra um "replay de evolução do aluno". |
| [leanprover-community/import-graph](https://github.com/leanprover-community/import-graph) | 30 | Apache-2.0 | Lean | 2026-11-16 | Análise de grafos de import (fecho transitivo, redução). |
| [leanprover-community/lean4web](https://github.com/leanprover-community/lean4web) | 167 | Apache-2.0 | TS | 2026-11-09 | Editor Lean web, se um dia quisermos mostrar as provas no app. |
| [lean-dojo/LeanDojo](https://github.com/lean-dojo/LeanDojo) | 853 | MIT | Python | 2026-01-18 | Interação programática com Lean (extração e checagem em CI). |
| [quint-co/quint](https://github.com/quint-co/quint) (+ [apalache](https://github.com/apalache-mc/apalache)) | 2.1k / 628 | Apache-2.0 | TS / Scala | 2026-11 | **Especificação executável (TLA) com sintaxe próxima de TS.** Modela a máquina de estados *proposta → validação → aplicação → snapshot → decaimento* e verifica invariantes por model checking. |
| [dubzzz/fast-check](https://github.com/dubzzz/fast-check) | 5.3k | MIT | TS | 2026-11-17 | Testes de propriedade em TS que **espelham os teoremas** (gera DAGs e operações aleatórias e checa invariantes). |
| [tlaplus/tlaplus](https://github.com/tlaplus/tlaplus) | 3.3k | MIT | Java | 2026-11-15 | Alternativa clássica ao Quint. |

**Arquivos do mathlib4 relevantes** (confirmados na árvore de `Mathlib/Order` e `Mathlib/Combinatorics`):

| Arquivo | Conceito | Papel no app |
|---|---|---|
| `Mathlib/Order/Extension/Linear.lean` | Extensão linear de ordem parcial (Szpilrajn) | Existe uma **ordem de estudo** (topological sort) compatível com os pré-requisitos. |
| `Mathlib/Order/UpperLower/*` | `LowerSet` / `UpperSet` | **Estado de conhecimento = conjunto fechado para baixo**: se domino X, domino seus pré-requisitos. |
| `Mathlib/Order/Birkhoff.lean` | Representação de Birkhoff | Os *quasi-ordinal knowledge spaces* da KST (Doignon & Falmagne) correspondem às pré-ordens, e os estados formam um reticulado distributivo. |
| `Mathlib/Order/Antichain.lean`, `Mathlib/Order/Minimal.lean` | Anticadeias e minimais | **"Fronteira externa"** (ALEKS): elementos minimais do complemento = "pronto para aprender". |
| `Mathlib/Order/Cover.lean` | Relação de cobertura (`⋖`) | Arestas diretas = **redução transitiva**, para remover arestas redundantes geradas pela IA. |
| `Mathlib/Order/Height.lean`, `Mathlib/Order/Grade.lean` | Altura e ordens graduadas | **Nível** de um conceito (do básico ao doutorado). |
| `Mathlib/Order/WellFounded.lean`, `Mathlib/Order/RelSeries.lean` | Boa fundação e cadeias | Aciclicidade ⇔ boa fundação; cadeias = trilhas de estudo. |
| `Mathlib/Order/Closure.lean` | Operador de fecho | O fecho de pré-requisitos de um alvo é um operador de fecho (idempotente, monótono e extensivo). |
| `Mathlib/Combinatorics/Digraph/{Basic,Orientation}.lean` | Digrafos | Modelo do grafo bruto antes de validar. |

**Teoremas-alvo** (provar em Lean, testar em TS com fast-check, modelar a dinâmica em Quint):

1. **Inserção segura.** `addNode v (preds ⊆ V)` sem arestas de saída preserva a aciclicidade. Em geral, adicionar a aresta `u→v` preserva a aciclicidade se e só se `¬ reach v u`.
2. **Expansão conservativa.** Uma expansão nunca remove um estado de conhecimento válido: o novo nó começa `not_started` e todo `LowerSet` antigo continua `LowerSet`. Isso corresponde à ADR-008 do Mathua, "*placement* nunca destrói maestria".
3. **Fronteira bem definida.** Toda fronteira é anticadeia, e se `K ≠ V` então a fronteira é não vazia (sempre há o que estudar).
4. **Monotonicidade do XP:** o XP só muda via ledger, com eventos idempotentes por chave (§9.1).
5. **Decaimento.** "Maestria" só cai para `needs_review` por evento de decaimento FSRS. Nunca existe estado inconsistente do tipo "dominado X sem dominar um pré-requisito", salvo se houver flag de *shortcut*.

---

## 9. Gamificação: XP, níveis, ligas e calibração por Monte Carlo

| Repo | ★ | Licença | Ling. | Último push | Compat. | Uso |
|---|---|---|---|---|---|---|
| [chuma-beep/mathua](https://github.com/chuma-beep/mathua) | 425 | MIT | Go | 2026-11-18 | ✅ | **XP com ledger e "accountability"**: `internal/xp/{policy.go,accountability.go}`, documentado em `docs/architecture/xp-accountability.md`. Ligas Bronze → Diamante com promoção de 2 por semana: `internal/leaderboard/{leagues.go,compute.go,period.go}`. Níveis: `internal/levels/levels.go`. Quiz de maestria de 50 XP. |
| [NationalSecurityAgency/skills-service](https://github.com/NationalSecurityAgency/skills-service) | 701 | Apache-2.0 | Groovy + Vue | 2026-11-17 | ✅ | **SkillTree**: plataforma de gamificação de microlearning com *skills*, subjects, níveis, pontos, badges, ranking e visualizações cliente prontas. Boa referência de modelo de dados. |
| [philihp/openskill.js](https://github.com/philihp/openskill.js) | 262 | MIT | TS | 2026-11-17 | ✅ | `rating()`, `rate()`, `ordinal()` (μ−3σ) em Weng-Lin (Plackett-Luce, Bradley-Terry, Thurstone-Mosteller). Cerca de 62k ops/s no Bradley-Terry Full, contra ~3k do TrueSkill. Modelar **aluno × item** como partida calibra a dificuldade dos itens e a habilidade por domínio, tudo em TS puro. |
| [mmai/glicko2js](https://github.com/mmai/glicko2js) | 160 | MIT | JS | 2026-10-29 | ✅ | Alternativa Glicko-2 (tem RD, a incerteza que diminui com prática). |
| [HabitRPG/habitica](https://github.com/HabitRPG/habitica) | 14.3k | Código GPL-3.0; **assets CC-BY-NC-SA 3.0** | JS | 2026-11-17 | ✅ (código) | Curvas de XP e nível, *streaks* e "dano" por hábito perdido. Ler as fórmulas, **não** copiar arte. |
| [dohsimpson/HabitTrove](https://github.com/dohsimpson/HabitTrove) | 695 | AGPL-3.0 | TS (Next.js) | 2026-03-07 | ✅ | Gamificação em Next.js com moedas e recompensas. Mesma stack e mesma licença. |
| [artcc/freelingo](https://github.com/artcc/freelingo) | 291 | AGPL-3.0 | Python | 2026-11-17 | ✅ | XP do plano, *streaks*, *skill scores* e testes de fim de nível (domínio Inglês). |
| [ActiDoo/gamification-engine](https://github.com/ActiDoo/gamification-engine) | 479 | MIT | Python | 2023-02-15 | ✅ | Motor genérico de regras, conquistas e níveis (antigo). |
| [open-spaced-repetition/fsrs-rs](https://github.com/open-spaced-repetition/fsrs-rs) (simulador) | 463 | BSD-3 | Rust | 2026-11-18 | ✅ | Simulação de carga e retenção por anos, que alimenta o Monte Carlo de "horas/dia → XP/dia". |
| [bigdata-ustc/EduSim](https://github.com/bigdata-ustc/EduSim) | 31 | MIT | Python | 2021-08-01 | ✅ | Ambientes de simulação de aprendiz para políticas adaptativas (antigo, mas as ideias de "aluno sintético" servem). |
| [bigdata-ustc/Agent4Edu](https://github.com/bigdata-ustc/Agent4Edu) | 103 | sem licença | Python | 2026-09-29 | ❌ (ler) | Alunos simulados por LLM (AAAI 2025). Serve para validar a didática com agentes, sem copiar código. |

### 9.1 Esboço de calibração por Monte Carlo (síntese dos repos acima)

1. **População sintética.** N = 10k alunos com:
   - horas/dia ~ LogNormal (moda de 2–4 h);
   - aderência ~ Beta;
   - habilidade inicial ~ Normal;
   - parâmetros FSRS amostrados do *prior* do FSRS-7.
2. **Simulação de 365 dias:**
   - o aluno sintético percorre o DAG real do domínio (fronteira → estudo → quiz);
   - os acertos seguem IRT/OpenSkill (habilidade × dificuldade do item);
   - as revisões seguem o FSRS, como no simulador do fsrs-rs.
3. **Saída:**
   - distribuição de XP/dia e de nós dominados por mês;
   - **thresholds de nível** = quantis, por exemplo nível *n* no quantil que dá progressão ~logarítmica;
   - **ligas** = percentis semanais.
4. **Regras anti-farm:**
   - ganho ponderado pelo nível atual e pela dificuldade relativa (`xp = base · f(dificuldade − habilidade)`);
   - a accountability do Mathua (penalidade por desempenho muito abaixo do esperado e "proteção de dificuldade genuína");
   - ledger idempotente.
5. **Recalibração:** recalibrar mensalmente com dados reais do próprio aluno (*bootstrap*). Como o app é monousuário, o "ranking" compara o aluno com a população simulada e com o seu próprio histórico.

---

## 10. Bônus: recursos por domínio

### 10.1 Eletrônica

| Repo | ★ | Licença | Ling. | Último push | Compat. | Uso |
|---|---|---|---|---|---|---|
| [pfalstad/circuitjs1](https://github.com/pfalstad/circuitjs1) | 2.5k | GPL-2.0-or-later (cabeçalho dos `.ts`) | **TS** (Vite) | 2026-11-18 | ✅ | Simulador de circuitos interativo, portado de GWT para TS (`ts/*Elm.ts`). Carrega circuitos por URL/texto, então a IA pode gerar o *netlist* do exemplo da aula. O fork antigo [sharpie7/circuitjs1](https://github.com/sharpie7/circuitjs1) (Java/GWT) está parado desde 2024. |
| [eelab-dev/EEcircuit](https://github.com/eelab-dev/EEcircuit) + [EEcircuit-engine](https://github.com/eelab-dev/EEcircuit-engine) | 190 / 16 | MIT | TS (ngspice→WASM) | 2026-10/11 | ✅ | **SPICE real no browser.** Útil para níveis avançados (análise AC, transiente e modelos de transistor). |
| [tilk/digitaljs](https://github.com/tilk/digitaljs) | 787 | BSD-2 | JS | 2026-02-10 | ✅ | Simulador **digital didático** (portas, FSMs; aceita netlist do Yosys). |
| [hneemann/Digital](https://github.com/hneemann/Digital) | 6.2k | GPL-3.0 | Java | 2026-10-08 | ✅ | Referência de conteúdo digital (desktop). |
| [wavedrom/wavedrom](https://github.com/wavedrom/wavedrom) | 3.5k | MIT | JS | 2026-10-25 | ✅ | Diagramas de tempo a partir de JSON (WaveJSON), que um LLM gera bem. |
| [nturley/netlistsvg](https://github.com/nturley/netlistsvg) | 844 | MIT | JS | 2024-01-25 | ✅ | Esquemático SVG a partir de netlist JSON. Combina com o estilo rough. |
| [cdelker/schemdraw](https://github.com/cdelker/schemdraw) | 288 | MIT | Python | 2026-10-31 | ✅ | Esquemáticos de qualidade de livro (geração offline de assets). |

### 10.2 Inglês

| Repo / fonte | ★ | Licença | Uso |
|---|---|---|---|
| [Maximax67/Words-CEFR-Dataset](https://github.com/Maximax67/Words-CEFR-Dataset) | 111 | MIT | Palavra → nível CEFR (base CEFR-J), com lemas e POS. Serve para níveis de nós de vocabulário. |
| [openlanguageprofiles/olp-en-cefrj](https://github.com/openlanguageprofiles/olp-en-cefrj) | 228 | (termos CEFR-J; verificar) | Wordlist e gramática CEFR-J (A1–B2). |
| [tatuylonen/wiktextract](https://github.com/tatuylonen/wiktextract) | 1.3k | código (verificar); dados do Wiktionary CC-BY-SA | Definições, IPA, exemplos e traduções EN↔PT (dumps em kaikki.org). |
| [Tatoeba/tatoeba2](https://github.com/Tatoeba/tatoeba2) | 900 | código AGPL; frases CC-BY 2.0 FR | Frases paralelas EN–PT para cards cloze. |
| [languagetool-org/languagetool](https://github.com/languagetool-org/languagetool) | 15.3k | LGPL-2.1 | Correção gramatical local (servidor Java) para exercícios de escrita, sem gastar tokens. |
| [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) | 55.3k | MIT | ASR local para pronúncia e listening. |
| [hexgrad/kokoro](https://github.com/hexgrad/kokoro) (+ kokoro-js via [transformers.js](https://github.com/huggingface/transformers.js)) | 10.2k | Apache-2.0 | TTS local de alta qualidade (82M parâmetros) para áudio de cards e diálogos. |

---

## 11. Mapa metas → repositórios

| Meta | Repos principais (ordem de prioridade) |
|---|---|
| 1. Grafo massivo + aulas + expansão procedural | Clew (propostas e validador), Mathua (DAG, *waves*, FIRe), Metacademy-content (formato recurso↔região), GenMentor (agentes de trilha e conteúdo), YouTube.js + BgUtils, unpdf/LiteParse, sigma + graphology, cosmos.gl |
| 2. Memória SOTA | hindsight (banks/reflect), graphiti (temporal), mem0 (TS SDK), MemOS; AML leaderboard + LongMemEval para avaliar |
| 3. Sessões por domínio | hindsight *banks* (1 por domínio), parâmetros FSRS por domínio (ts-fsrs `binding`), grafos separados (cn-math-taxonomy separa Inglês de Matemática pelo mesmo motivo) |
| 4. Flashcards Anki/Obsidian | ts-fsrs, anki-apkg-export, AnkiConnect (sourcehut) e AnkiMCP, obsidian-spaced-repetition(-recall) |
| 5. Nível/XP/rankings Monte Carlo | Mathua (ledger, ligas, níveis), openskill.js, simulador do fsrs-rs, SkillTree |
| 6. Stats leves | roughViz (gráficos sketchy). O `tokenlens` já está no LH para tokens. |
| 7. IA por assinatura sem hardcode | Clew ADR-0006 (Sign in with ChatGPT; modelos de `/v1/models`), GenMentor `model-catalog.ts`. O pi-agent-core do LH ([earendil-works/pi](https://github.com/earendil-works/pi), MIT, 122.7k★) já cobre OAuth de assinaturas. **Não** vendorizar o DevKit da OpenAI (licença não comercial). |
| 8. UI cel shading + SVG hand-drawn | neobrutalism-components (shadcn), react-rough-fiber, svg2roughjs, rough.js, perfect-freehand, rough-notation, doodle-icons, Excalidraw (fontes OFL) |
| 9. Didática não cansativa | padrão "card encerra o turno" (Clew), avaliação cega anti-inflação (engram), *gates* determinísticos (tutor-mcp, Mathua), rubricas MRBench e MathTutorBench (só protocolo), quadro branco (ChatTutor/whiteboard-ai-tutor), rough-notation para ênfase sem texto |

---

## 12. Plano de extração dos 14 primeiros

> **Segurança.** Todos são dados não confiáveis. Clonar **somente para leitura** em `_refs/` (ex.: `git clone --depth 1 <url> _refs/<nome>`) e nunca rodar `npm/pnpm/pip install`, builds ou scripts deles. Portar à mão, copiando apenas trechos de licença compatível, com cabeçalho de atribuição e preservando os `NOTICE` de projetos Apache-2.0.

1. **Clew:**
   - `contracts/graph_patch.schema.json`, convertido para um schema Zod `GraphProposal`;
   - regras de `backend/app/services/proposal_validator.py` (ilhas, refs, URLs, maestria falsa) → `validateProposal()` em TS;
   - fluxo de `proposal_service.py` (revisão → snapshot + receipt na mesma transação);
   - `backend/app/agent/chatgpt_auth.py` como especificação para o OAuth PKCE no `main` do Electron com `safeStorage`;
   - o padrão de *tools* `ask_question`/`present_quiz` com `awaiting_answer`.
2. **ts-fsrs:** dependência direta (`ts-fsrs@6`, `@open-spaced-repetition/binding`). Ler o guia v5→v6. Guardar `card`/`revlog` por domínio.
3. **Mathua:**
   - portar `internal/concepts/dag.go`, `internal/mastery/machine.go`, `internal/repetition/credit.go` + `internal/fire/mode.go` (FIRe), `internal/xp/{policy,accountability}.go` e `internal/leaderboard/leagues.go`;
   - ler as ADRs 008, 037, 038, 046 e 050 e o processo `docs/expansion-waves/`.
4. **tutor-mcp:**
   - portar `algorithms/{bkt,individual_bkt}.go`, `engine/{gate,concept_selector,phase_fsm,evidence_controller,olm,graph_quality,motivation,nudge_planner}.go`;
   - adotar a tripla "estimado / retido / demonstrado" no perfil.
5. **hindsight:**
   - integrar via cliente Node (`@vectorize-io/hindsight-client`) ou MCP (`/mcp/{bank_id}/`);
   - um *bank* por domínio;
   - ler a pipeline `retain` (extração de fatos, entidades e tempo) e os *mental models* para o "resumo do aluno".
6. **GenMentor:** ler `app/src/lib/agents/{path,profile,knowledge,quiz,feedback}.ts` e reaproveitar os prompts (CC0) do "Skill Gap Identifier", do "Learning Path Scheduler" e do "Learner Feedback Simulator".
7. **sigma.js v4 + graphology:** dependências diretas para a vista galáxia (`graphology-dag` para validar ciclos no cliente).
8. **YouTube.js + BgUtils:** busca, transcrição, trilhas com `translation_languages`. Usar o `examples/transcript/index.ts` como ponto de partida.
9. **anki-apkg-export:** usar `src/exporter.ts` e `src/template.ts` (modelos cloze e reversed). Mapear `noteId` ↔ id do card.
10. **react-rough-fiber + svg2roughjs + rough.js:** criar `<RoughIcon>` e `<RoughNode>`, gerar o icon set em build a partir do Lucide e fixar `seed` por id.
11. **openskill.js:** dependência direta para o rating aluno × item e o simulador Monte Carlo (§9.1).
12. **unpdf / LiteParse:** extração de texto e *outline* → capítulos → `Resource` ligados a regiões.
13. **circuitjs1:** embutir via `iframe` (build próprio) ou portar o *core* de simulação (GPL-2.0-or-later, usado como GPL-3 dentro do AGPL).
14. **fast-check + Quint + mathlib:**
    - propriedades: inserção segura, `LowerSet` preservado e fronteira não vazia;
    - spec Quint da máquina de estados de expansão;
    - provas em Lean citando os arquivos do §8.

---

## 13. Fontes (primárias)

- **Metadados:** `gh api repos/<owner>/<repo>` para cada repo citado (coleta em 2026-11-18). READMEs e LICENSEs lidos via `gh api repos/<owner>/<repo>/readme` e `/contents/LICENSE`.
- **Clew:**
  - [README](https://github.com/miuuyy/Clew)
  - [docs/ARCHITECTURE.md](https://github.com/miuuyy/Clew/blob/main/docs/ARCHITECTURE.md)
  - [ADR 0006](https://github.com/miuuyy/Clew/blob/main/docs/adr/0006-sign-in-with-chatgpt-agent-runtime.md)
  - [graph_patch.schema.json](https://github.com/miuuyy/Clew/blob/main/contracts/graph_patch.schema.json)
- **Sign in with ChatGPT:**
  - [learn.chatgpt.com/docs/sign-in-with-chatgpt](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)
  - [cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
  - [DevKit (licença não comercial)](https://github.com/openai/sign-in-with-chatgpt-devkit)
- **FSRS:**
  - [ts-fsrs README](https://github.com/open-spaced-repetition/ts-fsrs)
  - [binding README](https://github.com/open-spaced-repetition/ts-fsrs/tree/main/packages/binding)
  - [srs-benchmark README](https://github.com/open-spaced-repetition/srs-benchmark)
  - [fsrs-rs README](https://github.com/open-spaced-repetition/fsrs-rs)
- **Mathua:**
  - [README](https://github.com/chuma-beep/mathua)
  - [xp-accountability.md](https://github.com/chuma-beep/mathua/blob/main/docs/architecture/xp-accountability.md)
- **tutor-mcp:** [README](https://github.com/ArnaudGuiovanna/tutor-mcp)
- **GenMentor:** [README](https://github.com/GeminiLight/gen-mentor) e [arXiv 2501.15749](https://arxiv.org/abs/2501.15749)
- **Memória:**
  - [hindsight README](https://github.com/vectorize-io/hindsight), [benchmarks.hindsight.vectorize.io](https://benchmarks.hindsight.vectorize.io/) e [arXiv 2512.12818](https://arxiv.org/abs/2512.12818)
  - [mem0 README](https://github.com/mem0ai/mem0)
  - [MemOS README](https://github.com/MemTensor/MemOS)
  - [supermemory README](https://github.com/supermemoryai/supermemory)
  - [OpenViking README](https://github.com/volcengine/OpenViking)
  - [AML leaderboard README](https://github.com/AML-memory/agent-memory-leaderboard) e [agentmemoryleaderboard.ai](https://agentmemoryleaderboard.ai/leaderboard/industry/textual)
- **PDF:**
  - [marker README (licença de código e de pesos; OmniParseBench)](https://github.com/datalab-to/marker)
  - [MinerU LICENSE](https://github.com/opendatalab/MinerU/blob/master/LICENSE.md)
- **Roadmap.sh:** [LICENSE](https://github.com/nilbuild/developer-roadmap/blob/master/license)
- **AnkiConnect:** [git.sr.ht/~foosoft/anki-connect](https://git.sr.ht/~foosoft/anki-connect) (o README do GitHub aponta a mudança)
- **Anki:** [LICENSE (AGPL-3.0-or-later)](https://github.com/ankitects/anki/blob/main/LICENSE)
- **Metacademy:** [metacademy-content (CC-BY-SA 3.0 US)](https://github.com/metacademy/metacademy-content)
- **circuitjs1:** [cabeçalhos GPL-2.0-or-later](https://github.com/pfalstad/circuitjs1/blob/master/ts/ACRailElm.ts)
- **Kuphaldt MEL (CC-BY 4.0):** [ibiblio.org/kuphaldt/socratic/model](https://www.ibiblio.org/kuphaldt/socratic/model/)
- **cosmos.gl:** [README](https://github.com/cosmosgl/graph)
- **sigma.js:** [README](https://github.com/jacomyal/sigma.js)
- **openskill.js:** [README](https://github.com/philihp/openskill.js)
- **Avaliação de tutores:**
  - [MathTutorBench, arXiv 2502.18940](https://arxiv.org/abs/2502.18940)
  - [LearnLM tech report, arXiv 2412.16429](https://arxiv.org/abs/2412.16429)
  - [LearnLM 2025, arXiv 2505.24477](https://arxiv.org/abs/2505.24477)
  - [TeachLM, arXiv 2510.05087](https://arxiv.org/abs/2510.05087)
- **mathlib4:** árvore `Mathlib/Order` e `Mathlib/Combinatorics/Digraph` em [leanprover-community/mathlib4](https://github.com/leanprover-community/mathlib4)
