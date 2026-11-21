# Avaliação em Seis Frentes — TrilhaAtlas (`evals/`)

Esta estrutura organiza a avaliação real dos *system prompts* e dos subsistemas do TrilhaAtlas em **seis frentes independentes**, sem misturar métricas incompatíveis numa média única e medindo diretamente o efeito pareado do prompt (`prompt candidato / produção − prompt mínimo com contratos`, no mesmo modelo, mesmas condições e contexto congelado, com **IC 95% pareado** e **hash SHA-256** de cada prompt efetivo).

## Estrutura

| Diretório | Frente | O que avalia |
|---|---|---|
| `evals/tutoring/` | **1. Tutoria e Diagnóstico** | **TutorMoments** (AllenAI, 3 dimensões separadas: apoio adequado, exigência adequada, evita excesso de ajuda) + adaptação interna PT-BR; **TeachArena** (Stage 0 Tutoria Situada e Stage 1 Julgamento Pedagógico **reportados individualmente**); **MathTutorBench** (diagnóstico complementar por dimensão); casos próprios do TrilhaAtlas por modo (**ensino**, **prática**, **exame**, **dúvida lateral**). |
| `evals/planning/` | **2. Planejamento e Exercícios** | Avaliação inspirada no **StudentBench** (adaptada aos domínios Eletrônica e Inglês) para `teacher/10-planning.md` e para a rota estruturada `lesson/lesson-plan.md` (adequação ao diagnóstico, pré-requisitos, sequência, não-burlabilidade dos exercícios, correção de gabarito, tempo disponível). |
| `evals/grading/` | **3. Correção e Feedback** | Conjunto rotulado por especialista com 7 classes de resposta (curta correta, vocabulário equivalente, parcial, método certo + erro de unidade, resultado certo + raciocínio errado, palavras-chave sem sentido, longa convincente porém falsa), avaliando **separadamente** `module-exam.ts` (determinístico) e `lesson/grader.md` (LLM 0–3): concordância exata, MAE, aprovações indevidas (false-pass), reprovações indevidas (false-fail) e diagnóstico. |
| `evals/grounding-tools/` | **4. Fontes, PDFs e Atividades** | Cenários do protocolo `docs/impl/study-evaluation.md`: página física de PDF, recomendação de catálogo vs. trecho consultado, página indisponível, estado real de atividade interativa, figura essencial e esclarecimento em prova aberta sem vazamento (`shared/15-accuracy.md`, `teacher/23-interactive-lessons.md`). |
| `evals/memory/` | **5. Memória e Personalização (placar separado)** | Diagnóstico **EvalMem em 3 estágios** (**Registro** → **Recuperação real** → **Uso pelo tutor**) + **LongMemEval-S** + casos próprios de isolamento (preferência atualizada, dificuldade superada, afirmação do professor não contamina fatos do aluno, isolamento de região e de domínio Eletrônica ↔ Inglês, abstenção). `LoCoMo` é opcional (`--include-locomo`). |
| `evals/learning/` | **6. Aprendizagem e Retenção** | Instrumentos de pré-teste, pós-teste imediato de transferência e retenção após 7 e 28 dias (Eletrônica e Inglês), alinhados a `docs/impl/study-evaluation.md`. |
| `evals/configs/` | **Configurações** | Modelos alvo, condições (`production` vs. `minimal_contract`), sementes e papéis oficiais de cada dataset. |
| `evals/reports/` | **Relatórios auditáveis** | Saídas completas (`latest-evaluation.md` e `latest-evaluation.json`) com hashes SHA-256 dos prompts efetivos, resultados por item, diferenças pareadas e IC 95%. |

## Como executar

```bash
# 1. Camada anterior: verificações formais, auditoria estática e testes determinísticos
npm run verify:formal
npm run benchmark:harness
npm run benchmark:prompts

# 2. Avaliação ao vivo em todas as frentes (comparação pareada: produção vs. baseline mínimo)
npm run benchmark:sota

# Opções úteis:
npm run benchmark:sota -- --reset --per-suite=10
npm run benchmark:sota -- --models=chatgpt:gpt-6.2-sol,chatgpt:gpt-6.2-astra --include-locomo
npm run benchmark:sota -- --front=tutoring
npm run benchmark:sota -- --front=memory
npm run benchmark:sota -- --front=grading
```

> **Separação honesta de resultados:**
> - **MRBench / BEA 2025** não entra no placar principal do tutor; é reservado para calibração de avaliadores (`--calibrate-judge`).
> - **MathDial** não é reportado como escore de leaderboard oficial (protocolo adaptado).
> - **TutorMoments PT-BR** e **StudentBench TrilhaAtlas** são rotulados explicitamente como adaptações internas.
