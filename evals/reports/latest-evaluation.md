# Avaliação em Seis Frentes dos System Prompts e Memória — TrilhaAtlas

> Gerado automaticamente em **2026-11-21** com comparação pareada (**Prompt atual de produção − Prompt mínimo com contratos**, mesmo modelo, mesmas condições, contexto congelado, juiz cego cruzado com identidade oculta e ordem alternada).
> **Separação metodológica:** não há média geral misturando frentes incompatíveis nem metas arbitrárias. **TutorMoments** e **TeachArena** (Stage 0 e Stage 1 individuais) formam o núcleo de tutoria; **MathTutorBench** é diagnóstico complementar por habilidade; **Memória (EvalMem + LongMemEval-S)** tem placar separado; **MRBench/BEA** e **MathDial** não entram no placar principal do tutor.

## 0. Hashes SHA-256 dos Prompts Efetivos Compostos

| Componente / Condição | Tamanho (chars) | SHA-256 (16 hex) |
|---|---:|---|
| `production:teacher` | 42070 | `c8d68f9fc3951715` |
| `production:practice` | 21794 | `c10b283ef579265c` |
| `production:side-chat` | 6854 | `5d93aa74ac5c5f13` |
| `production:lesson/lesson-plan.md` | 11308 | `8353b38b8f159e8a` |
| `production:lesson/grader.md` | 2754 | `e18cbecfedb52bc6` |
| `production:memory/extract.md` | 6187 | `b585e59e3c379c8a` |
| `minimal_contract:teacher` | 178 | `147d7976474754e0` |
| `minimal_contract:practice` | 191 | `af78340ef5445bf7` |
| `minimal_contract:side-chat` | 184 | `b50415079d2ea740` |
| `minimal_contract:grader` | 306 | `d612f5c3d0299a4d` |

## Modelo: `chatgpt:gpt-6.2-sol` (Juiz cego cruzado: `chatgpt:gpt-6.2-astra`)

### Frente 1 — Tutoria e Diagnóstico (Placar Principal)

| Dimensão / Avaliação | Prompt mínimo | Prompt atual | Δ Pareado (IC 95%) | Casos (n) | Latência |
|---|---:|---:|---:|---:|---:|
| **TutorMoments (AllenAI)** · Apoio adequado | 40.0% | **100.0%** | +60.0 pp (±68.0) | 5 | 10779 ms |
| **TutorMoments (AllenAI)** · Exigência adequada | 60.0% | **100.0%** | +40.0 pp (±68.0) | 5 | 15546 ms |
| **TutorMoments (AllenAI)** · Evita excesso de ajuda | 20.0% | **90.0%** | +70.0 pp (±34.6) | 10 | 13162 ms |
| **TeachArena** · Stage 0: Tutoria Situada (individual) | 42.0% | **76.0%** | +34.0 pp (±14.2) | 10 | 15072 ms |
| **TeachArena** · Stage 1: Julgamento (checks determinísticos) | 81.6% | **87.2%** | +5.6 pp (±13.7) | 10 | 16961 ms |
| **TeachArena** · Stage 1: Julgamento (asserções NL) | 90.0% | **92.0%** | +2.0 pp (±4.5) | 10 | 16961 ms |
| **TrilhaAtlas Próprio** · Modo Ensino (nível de pista) | 41.7% | **96.7%** | +55.0 pp (±40.8) | 6 | 7113 ms |
| **TrilhaAtlas Próprio** · Modo Prática (não fecha sem pedido) | 50.0% | **100.0%** | +50.0 pp (±127.1) | 2 | 4242 ms |
| **TrilhaAtlas Próprio** · Modo Exame (zero vazamento) | 0.0% | **100.0%** | +100.0 pp (±0.0) | 2 | 3092 ms |
| **TrilhaAtlas Próprio** · Dúvida Lateral (áudio cego / exame) | 50.0% | **100.0%** | +50.0 pp (±635.3) | 2 | 6487 ms |
| **Adaptação Interna PT-BR** (inspirada em TutorMoments) | 50.0% | **81.3%** | +31.3 pp (±49.7) | 8 | 10051 ms |

#### Diagnóstico Complementar — MathTutorBench (separado por habilidade, sem nota única)

| Habilidade Pedagógica (eth-lre/mathtutorbench) | Prompt mínimo | Prompt atual | Δ Pareado (IC 95%) | Casos (n) | Latência |
|---|---:|---:|---:|---:|---:|
| Correção matemática | 100.0% | **100.0%** | +0.0 pp (±0.0) | 10 | 4460 ms |
| Localização do erro | 100.0% | **100.0%** | +0.0 pp (±0.0) | 10 | 4460 ms |
| Apoio socrático | 10.0% | **100.0%** | +90.0 pp (±22.6) | 10 | 4460 ms |
| Tato sem revelar resposta | 0.0% | **100.0%** | +100.0 pp (±0.0) | 10 | 4460 ms |

### Frente 2 — Planejamento e Criação de Exercícios (Adaptação StudentBench)

| Rota Avaliada | Prompt mínimo | Prompt atual | Δ Pareado (IC 95%) | Casos (n) | Latência |
|---|---:|---:|---:|---:|---:|
| Planejamento conversacional (`teacher/10-planning.md`) | 81.8% | **100.0%** | +18.2 pp (±0.0) | 2 | 28587 ms |
| Plano estruturado JSON (`lesson/lesson-plan.md`) | 42.9% | **100.0%** | +57.1 pp (±363.0) | 2 | 126835 ms |

### Frente 3 — Correção e Feedback (Corretores Separados · 18 casos rotulados)

| Corretor | Concordância exata | ±1 nota | MAE (0–3) | Aprovação indevida (false-pass) | Reprovação indevida (false-fail) | Diagnóstico de erro | Erros de formato |
|---|---:|---:|---:|---:|---:|---:|---:|
| `module-exam.ts` (determinístico) | 16.7% | 66.7% | 1.33 | 83.3% | 16.7% | N/A | 0 |
| `lesson/grader.md` (prompt mínimo) | 77.8% | 100.0% | 0.22 | 8.3% | 0.0% | 100.0% | 0 |
| **`lesson/grader.md` (prompt atual)** | **100.0%** | **100.0%** | **0.00** | **0.0%** | **0.0%** | **100.0%** | 0 |

### Frente 4 — Fontes, PDFs e Atividades Interativas

| Avaliação | Prompt mínimo | Prompt atual | Δ Pareado (IC 95%) | Casos (n) | Latência |
|---|---:|---:|---:|---:|---:|
| Citações de página física, catálogo vs. lido, atividades e prova | 65.0% | **95.0%** | +30.0 pp (±30.2) | 10 | 6761 ms |

### Frente 5 — Memória e Personalização (Placar Separado · EvalMem 3 Estágios + LongMemEval-S)

- **EvalMem Estágio 2 — Recuperação real (`tutorMemoryText` + isolamento de domínio/região):** **100.0%** (10 casos determinísticos)

| Estágio / Dataset de Memória | Prompt mínimo | Prompt atual | Δ Pareado (IC 95%) | Casos (n) | Latência |
|---|---:|---:|---:|---:|---:|
| EvalMem Estágio 1 · Registro/Extração (`memory/extract.md`) | 100.0% | **100.0%** | +0.0 pp (±0.0) | 10 | 16095 ms |
| EvalMem Estágio 3 · Uso pelo tutor (isolamento e atualização) | 100.0% | **100.0%** | +0.0 pp (±0.0) | 10 | 4031 ms |
| **LongMemEval-S** (`xiaowu0162/longmemeval-cleaned`) | 90.0% | **90.0%** | +0.0 pp (±0.0) | 10 | 4732 ms |

## Frente 6 — Aprendizagem e Retenção (Protocolo Empírico com Alunos)

Instrumentos estruturados de pré-teste, pós-teste de transferência imediata e retenção em D+7 e D+28 disponíveis em `evals/learning/retention-instruments.json` (alinhados a `docs/impl/study-evaluation.md`).
