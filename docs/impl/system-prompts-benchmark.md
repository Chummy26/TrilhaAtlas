# Benchmark Complexo e em Escala — System Prompts do TrilhaAtlas

> Gerado automaticamente por `scripts/benchmark-system-prompts.ts` em 2026-11-21.

## Resumo Executivo

- **Auditoria formal dos 4 agentes conversacionais (`teacher`, `prober`, `practice`, `side-chat`):** 4/4 com **Score 100/100** (**0 ferramentas fantasma**, **0 contradições**, **0 comentários vazados**, **0 frases duplicadas**).
- **Auditoria de paridade de schema (`lesson/*` e `memory/*`):** 8/8 templates aprovados.
- **Matriz de estresse pedagógico em escala:** **540/540** trajetórias multi-turno aprovadas (**100%** de acerto em 12 ms — 6 perfis de curso × 5 personas × 18 cenários adversariais/realistas).
- **SLAs de performance em escala (1.000 iterações):** 4/4 dentro do orçamento.
- **Tempo total da suíte:** 2891.49 ms.

## 1. Auditoria Formal & Eficiência de Tokens por Agente

| Agente | Chars | ~Tokens | Baseline | Delta Tokens | Ferramentas Fantasma | Contradições | Duplicações | Score | Status |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `teacher` | 39861 | 9966 | 12050 | -2084 (-17.3%) | 0 | 0 | 0 | **100/100** | PASS |
| `prober` | 16173 | 4044 | 4280 | -236 (-5.5%) | 0 | 0 | 0 | **100/100** | PASS |
| `practice` | 21116 | 5279 | 6782 | -1503 (-22.2%) | 0 | 0 | 0 | **100/100** | PASS |
| `side-chat` | 6555 | 1639 | 1621 | +18 (+1.1%) | 0 | 0 | 0 | **100/100** | PASS |

## 2. Paridade de Schema nos Prompts Estruturados (`lesson/*` e `memory/*`)

| Template | Chars | ~Tokens | Status | Verificação |
|---|---:|---:|---|---|
| `lesson/lesson-plan.md` | 10868 | 2717 | PASS | 100% paridade com schema Zod |
| `lesson/phase-render.md` | 4953 | 1239 | PASS | 100% paridade com schema Zod |
| `lesson/remediate.md` | 1851 | 463 | PASS | 100% paridade com schema Zod |
| `lesson/grader.md` | 2277 | 570 | PASS | 100% paridade com schema Zod |
| `memory/extract.md` | 5745 | 1437 | PASS | 100% paridade com schema Zod |
| `memory/consolidate.md` | 3650 | 913 | PASS | 100% paridade com schema Zod |
| `memory/observe.md` | 2194 | 549 | PASS | 100% paridade com schema Zod |
| `memory/diary.md` | 1258 | 315 | PASS | 100% paridade com schema Zod |

## 3. Matriz de Estresse Pedagógico em Escala (540 Trajetórias Multi-Turno)

| Cenário | Casos | Aprovados | Precisão |
|---|---:|---:|---:|
| `01-opening-and-adv-reading` | 30 | 30 | 100% |
| `02-greeting-not-worked-expl` | 30 | 30 | 100% |
| `03-activity-counts-as-taught` | 30 | 30 | 100% |
| `04-impasse-1-scaffold-1` | 30 | 30 | 100% |
| `05-impasse-2-scaffold-2` | 30 | 30 | 100% |
| `06-impasse-3-scaffold-3` | 30 | 30 | 100% |
| `07-mixed-ready-confusion-precedence` | 30 | 30 | 100% |
| `08-no-false-positive-materials` | 30 | 30 | 100% |
| `09-explicit-material-request` | 30 | 30 | 100% |
| `10-explicit-exam-request` | 30 | 30 | 100% |
| `11-anti-spoiler-direct-answer` | 30 | 30 | 100% |
| `12-why-simpler-unpack` | 30 | 30 | 100% |
| `13-fading-requires-formal-exam` | 30 | 30 | 100% |
| `14-exam-awaiting-no-hints` | 30 | 30 | 100% |
| `15-exam-first-verdict` | 30 | 30 | 100% |
| `16-exam-final-verdict-strict` | 30 | 30 | 100% |
| `17-adversarial-injection-resilience` | 30 | 30 | 100% |
| `18-prior-reinforcement-continuity` | 30 | 30 | 100% |

## 4. Benchmarks de Latência em Escala (p50 / p95 / p99)

| Operação | Iterações | p50 (ms) | p95 (ms) | p99 (ms) | Orçamento p95 (ms) | Status |
|---|---:|---:|---:|---:|---:|---|
| `composeInstructions('teacher')` | 1000 | 1.859 | 2.4 | 2.77 | 8 | PASS |
| `composeInstructions('practice')` | 1000 | 0.808 | 1.089 | 1.269 | 4 | PASS |
| `composeSideChatInstructions()` | 200 | 0.152 | 0.196 | 0.235 | 8 | PASS |
| `buildMissionPedagogyDirective(3 turns)` | 1000 | 0.003 | 0.005 | 0.006 | 0.5 | PASS |
