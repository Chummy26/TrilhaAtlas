# TrilhaAtlas — Arquitetura Nível Curso / Faculdade (8 Pilares)

## Visão Geral e Embasamento Científico

| # | Pilar | Evidências e Referências | Módulos Implementados |
| --- | --- | --- | --- |
| 1 | **Provas Integradoras Intercaladas (P1/P2)** | Rohrer et al. (2020, $d=0{,}83$), Brunmair & Richter (2019, $g=0{,}42$), Butler (2010), Adesope et al. (2017), Skycak/FIRe | `src/core/study/module-exam.ts`, `src/server/course.ts`, `app/api/study/module-exam/route.ts`, `components/study/module-exam-panel.tsx` |
| 2 | **Ementa (*Syllabus*) + Cronograma Realista** | Buehler et al. (1994, *Planning Fallacy*), Ariely & Wertenbroch (2002), reserva FSRS de 33% (`r7` Monte Carlo), faixa p50–p80 | `src/core/study/syllabus.ts`, `app/ementa/page.tsx`, `components/study/syllabus-view.tsx`, `app/api/study/syllabus/route.ts` |
| 3 | **Listas de Exercícios (*Problem Sets*) & Laboratório (POE/PMC)** | Shute (2008, *delayed feedback*), Bastani PNAS (2025), Finkelstein et al. (2005), Holmes & Wieman (2018, ciclo prever → medir → comparar → analisar discrepância) | `src/core/study/problem-set.ts`, `app/api/study/problem-set/route.ts`, `components/study/problem-set-panel.tsx` |
| 4 | **Nivelamento Adaptativo KST (Filtro de Partículas)** | Doignon & Falmagne (*Learning Spaces*), ALEKS *half-split* + BLIM + MCMC, Steiner & Hochweber (2026) | `src/core/study/placement.ts`, `src/server/placement.ts`, `app/api/study/placement/route.ts`, `components/study/placement-dialog.tsx` |
| 5 | **Caderno Acadêmico + Exportação Anki / Obsidian / `.apkg`** | Metcalfe (2017), Butterfield & Metcalfe (2001, hipercorreção), Karpicke & Roediger (2008), `plugins/flashcards/src/export-service.ts` | `src/core/study/notebook.ts`, `app/api/study/notebook/route.ts`, `app/api/study/flashcards/export/route.ts`, `components/study/lesson-finish.tsx` |
| 6 | **Aula Invertida (*Flipped Classroom*) com Leitura Guiada** | Freeman et al. PNAS (2014, +0,47 DP), Strelan et al. (2020, $g=0{,}50$), Novak et al. (JiTT), Kestin et al. (2025) | `src/core/study/flipped-reading.ts`, `app/api/study/flipped/route.ts`, drawer de pré-leitura em `components/study/syllabus-view.tsx` |
| 7 | **Modo Banca Examinadora / Arguição Crítica** | Huxham et al. (2012), Joughin (2010), Theobold (2021), Hardy (2026, rubrica estruturada) — ativado apenas em níveis avançados (Graduação/Pós/Pesquisa/C1–C2) | `src/core/study/tutor-pedagogy.ts` (`isAdvancedDefenseNode`), `src/server/study.ts`, `components/study/lesson-course-bar.tsx` |
| 8 | **Boletim de Retenção Real (Histórico Escolar)** | Soderstrom & Bjork (2015), Roediger & Karpicke (2006), FSRS-7 (`retrievability`), separação `attained` vs. `durable ≥24h` vs. `mastered` + alertas `R < 0.85` | `src/core/study/transcript.ts`, `app/api/study/transcript/route.ts`, `components/study/profile-view.tsx` |

## Como reproduzir validação e benchmarks de estresse

```sh
node scripts/run-tests.mjs tests/college-core.test.ts tests/college-apis-integration.test.ts tests/lesson-flow-simulation.test.ts tests/tutor-pedagogy.test.ts tests/campaign-continuity.test.ts
node --import tsx scripts/benchmark-college-stress.ts
node --import tsx scripts/benchmark-tutor-pedagogy.ts
```
