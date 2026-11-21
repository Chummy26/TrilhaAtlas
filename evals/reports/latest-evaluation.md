# Avaliação em Seis Frentes dos System Prompts e Memória — TrilhaAtlas

> Gerado automaticamente em **2026-11-21** com comparação pareada (**Prompt atual de produção − Prompt mínimo com contratos**, mesmo modelo, mesmas condições, contexto congelado, juiz cego cruzado com identidade oculta e ordem alternada).
> **Separação metodológica:** não há média geral misturando frentes incompatíveis nem metas arbitrárias. **TutorMoments** e **TeachArena** (Stage 0 e Stage 1 individuais) formam o núcleo de tutoria; **MathTutorBench** é diagnóstico complementar por habilidade; **Memória (EvalMem + LongMemEval-S)** tem placar separado; **MRBench/BEA** e **MathDial** não entram no placar principal do tutor.

## 0. Hashes SHA-256 dos Prompts Efetivos Compostos

| Componente / Condição | Tamanho (chars) | SHA-256 (16 hex) |
|---|---:|---|
| `production:teacher` | 40786 | `b451efeb12c6fda1` |
| `production:practice` | 21280 | `bf30faa3056c600d` |
| `production:side-chat` | 6555 | `5849c1fa70a32b7e` |
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
| **TutorMoments (AllenAI)** · Apoio adequado | 33.3% | **100.0%** | +66.7 pp (±143.4) | 3 | 15556 ms |
| **TutorMoments (AllenAI)** · Exigência adequada | 66.7% | **100.0%** | +33.3 pp (±143.4) | 3 | 10698 ms |
| **TutorMoments (AllenAI)** · Evita excesso de ajuda | 33.3% | **66.7%** | +33.3 pp (±85.7) | 6 | 13127 ms |
| **TeachArena** · Stage 0: Tutoria Situada (individual) | 45.0% | **65.8%** | +20.8 pp (±19.8) | 6 | 20054 ms |
| **TeachArena** · Stage 1: Julgamento (checks determinísticos) | 76.6% | **74.6%** | -1.9 pp (±9.9) | 6 | 14550 ms |
| **TeachArena** · Stage 1: Julgamento (asserções NL) | 83.3% | **83.3%** | +0.0 pp (±13.3) | 6 | 14550 ms |
| **TrilhaAtlas Próprio** · Modo Ensino (nível de pista) | 50.0% | **100.0%** | +50.0 pp (±127.1) | 2 | 3661 ms |
| **TrilhaAtlas Próprio** · Modo Prática (não fecha sem pedido) | 30.0% | **80.0%** | +50.0 pp (±127.1) | 2 | 3641 ms |
| **TrilhaAtlas Próprio** · Modo Exame (zero vazamento) | 0.0% | **100.0%** | +100.0 pp (±0.0) | 2 | 3396 ms |
| **TrilhaAtlas Próprio** · Dúvida Lateral (áudio cego / exame) | 50.0% | **100.0%** | +50.0 pp (±635.3) | 2 | 5577 ms |
| **Adaptação Interna PT-BR** (inspirada em TutorMoments) | 25.0% | **100.0%** | +75.0 pp (±45.9) | 4 | 6650 ms |

#### Diagnóstico Complementar — MathTutorBench (separado por habilidade, sem nota única)

| Habilidade Pedagógica (eth-lre/mathtutorbench) | Prompt mínimo | Prompt atual | Δ Pareado (IC 95%) | Casos (n) | Latência |
|---|---:|---:|---:|---:|---:|
| Correção matemática | 100.0% | **100.0%** | +0.0 pp (±0.0) | 6 | 4597 ms |
| Localização do erro | 100.0% | **100.0%** | +0.0 pp (±0.0) | 6 | 4597 ms |
| Apoio socrático | 0.0% | **100.0%** | +100.0 pp (±0.0) | 6 | 4597 ms |
| Tato sem revelar resposta | 0.0% | **100.0%** | +100.0 pp (±0.0) | 6 | 4597 ms |

### Frente 2 — Planejamento e Criação de Exercícios (Adaptação StudentBench)

| Rota Avaliada | Prompt mínimo | Prompt atual | Δ Pareado (IC 95%) | Casos (n) | Latência |
|---|---:|---:|---:|---:|---:|
| Planejamento conversacional (`teacher/10-planning.md`) | 81.8% | **100.0%** | +18.2 pp (±0.0) | 2 | 29713 ms |
| Plano estruturado JSON (`lesson/lesson-plan.md`) | 42.9% | **100.0%** | +57.1 pp (±363.0) | 2 | 126386 ms |

### Frente 3 — Correção e Feedback (Corretores Separados · 14 casos rotulados)

| Corretor | Concordância exata | ±1 nota | MAE (0–3) | Aprovação indevida (false-pass) | Reprovação indevida (false-fail) | Diagnóstico de erro | Erros de formato |
|---|---:|---:|---:|---:|---:|---:|---:|
| `module-exam.ts` (determinístico) | 21.4% | 64.3% | 1.36 | 87.5% | 16.7% | N/A | 0 |
| `lesson/grader.md` (prompt mínimo) | 85.7% | 100.0% | 0.14 | 0.0% | 0.0% | 100.0% | 0 |
| **`lesson/grader.md` (prompt atual)** | **85.7%** | **100.0%** | **0.14** | **0.0%** | **33.3%** | **100.0%** | 0 |

### Frente 4 — Fontes, PDFs e Atividades Interativas

| Avaliação | Prompt mínimo | Prompt atual | Δ Pareado (IC 95%) | Casos (n) | Latência |
|---|---:|---:|---:|---:|---:|
| Citações de página física, catálogo vs. lido, atividades e prova | 75.0% | **91.7%** | +16.7 pp (±42.9) | 6 | 5624 ms |

### Frente 5 — Memória e Personalização (Placar Separado · EvalMem 3 Estágios + LongMemEval-S)

- **EvalMem Estágio 2 — Recuperação real (`tutorMemoryText` + isolamento de domínio/região):** **100.0%** (6 casos determinísticos)

| Estágio / Dataset de Memória | Prompt mínimo | Prompt atual | Δ Pareado (IC 95%) | Casos (n) | Latência |
|---|---:|---:|---:|---:|---:|
| EvalMem Estágio 1 · Registro/Extração (`memory/extract.md`) | 100.0% | **100.0%** | +0.0 pp (±0.0) | 6 | 13024 ms |
| EvalMem Estágio 3 · Uso pelo tutor (isolamento e atualização) | 100.0% | **100.0%** | +0.0 pp (±0.0) | 6 | 3530 ms |
| **LongMemEval-S** (`xiaowu0162/longmemeval-cleaned`) | 83.3% | **83.3%** | +0.0 pp (±0.0) | 6 | 4931 ms |

## Frente 6 — Aprendizagem e Retenção (Protocolo Empírico com Alunos)

Instrumentos estruturados de pré-teste, pós-teste de transferência imediata e retenção em D+7 e D+28 disponíveis em `evals/learning/retention-instruments.json` (alinhados a `docs/impl/study-evaluation.md`).
