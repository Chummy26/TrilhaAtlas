# Integration of the estudos-sota modules

This document records how the pure modules (curriculum, learner, lesson, progress, stats, domains, memory, resources) were connected to the learnharness app. It also states what is still disconnected.

## What is live

| Piece | Where | Behavior |
|---|---|---|
| Cel theme | `app/layout.tsx`, `components/settings/appearance.tsx`, `electron/appearance-chrome.cjs` | `data-theme-family` is set on `<html>` in SSR and on live theme changes. The factory default theme is `cel-papel`; `cel-noite` is in the picker. |
| Domain accent | `app/layout.tsx` | `data-domain=<active>` is set on `<html>`, so `--cel-accent` follows the active world (volt for Electronics, coral for English). |
| Study worlds | `config.ts`, `src/server/study.ts`, `app/api/domains` | `PATHS.chats`, `PATHS.graph`, `PATHS.jobs`, `LEDGER_FILES` and `GRAPH_FILES` are getters that resolve the active domain on every call (`<data>/domains/<id>/…`). The choice is cached on `globalThis` and persisted in `profile/active-domain.json`. |
| "Geral" | (no active domain) | The original learnharness world, byte-for-byte the old paths. Nothing is migrated or moved. The tests run in this world. |
| Switching | `POST /api/domains {active}` | Returns 409 while a turn or job runs. Emits `domain-changed`. The UI reloads (`components/study/domain-switcher.tsx`). |
| Curriculum | `loadCurriculum` | On first open, the seeds in `content/curricula/<id>/*.json` go through `applySeedFiles` (schema, R1–R3, rank certificate). The result is persisted as ledger entry 0 (`curriculum/ledger.jsonl`) plus `snapshot.json`. Electronics has 809 leaves (~1,916 h); English has 771 leaves (~1,510 h). |
| Projection | `src/core/study/projection.ts` | `learnerViewOf(snapshot)` builds the LearnerGraphView from the effective clauses. Node order follows teaching order; depth uses the cheapest alternative. `nodeBrief` returns the node summary used by the card and the lesson. |
| Learner | `learner/events.jsonl` | Append-only log. The snapshot is a pure fold recomputed on each read. Orphaned events (left by a curriculum change) are filtered out, never fatal. |
| "Hoje" | `GET /api/study/today`, `components/study/today-card.tsx` | Shows one suggestion from `planDay`, the pending post-lesson self-check, and a light progress line. |
| Lesson | Home → `begin(lesson)` → `POST /api/chats` | "Começar aula" binds the exposure to the created chat and saves the curriculum node as its graph context. |
| Quiz checks | `src/server/chat-handler.ts`, `src/server/study.ts`, `src/server/study-log.ts` | The server grades the exact selection against the saved check. Each answered occurrence emits one MCQ evidence event for the curriculum node. Predict and dismissed cards do not count. A pending event is recovered from the durable chat on the next learner read or write. |
| Didactics | `src/agent/prompts/teacher/22-cadence.md` | Checks happen per arc (2–4 steps), at most one question per message and three per node, with no filler. It replaces "one check per step". |
| Profile | `/profile`, `studyProfile()` | Account level and XP, tier per domain by FSRS retention, focused study minutes for the last 14 days, and all-time tokens by model. |
| Study time | `StudyHeartbeat`, `POST /api/stats/activity` | The home graph, chats and flashcard review send up to 60 seconds per heartbeat. Losing focus or leaving the page flushes the partial interval. After 120 seconds without input, counting pauses until the next interaction. Playing video counts while the page has focus. |
| Model usage | `src/server/study-usage.ts`, `profile/stats/usage-YYYY-MM.jsonl` | Each provider call records its model, domain at dispatch, operation and reported token counters. This includes tool rounds, side questions, compaction and background agents. Historical chat steps still contribute when they have no corresponding stats entry. |
| Tutor memory | `src/server/memory/tutor.ts`, `src/server/chat-handler.ts` | Domain turns receive a bounded learner snapshot and relevant evidence from that domain's SQLite file. After a teaching turn is saved, its visible conversation is ingested and consolidated in the background. Practice reads the context. Geral keeps its original conversation flow. |

## Integration decisions (all can be revisited)

1. **Self-check is weak evidence.** It is recorded with `format: "explain"`, `graderConfidence: 0.5`, `weight: 0.5` and its own item family (`#self`). It can attain a node but never master it alone, because mastery needs at least 2 distinct families and a delayed success.
2. **"Já domino" is a diagnostic placement with p = 0.9.** The node unlocks its dependents but stays `inferred`, and the planner probes it later.
3. **Spacing.** A node taught in the last 20 h is not suggested again as "new". Its consolidation comes from the delayed check the next day.
4. **XP** uses the first graded quiz check per lesson. An exact answer earns grade 3 and full lesson credit. A wrong answer or “não sei” earns grade 0 and effort credit. Later checks update the learner. A lesson without a graded check can earn credit through its self-check. XP uses the lesson's planned minutes.
5. **Tier core** is the leaves in teaching order, split into 7 stages by cumulative hours (`coreVersion = hours-7@<hash>`). Placements without an FSRS card count with R = 0.9.
6. **Minutes per day** come from the union of measured intervals across windows. The profile splits time at local midnight. Days before measurement began show zero.

## Skill tree and regional materials

The Canvas shows the full active domain from the first frame. Node coordinates are independent of selection and progress. The overview summarizes prerequisite links between groups and the detailed view draws individual dependencies. Amber marks work in progress. Green marks directly attained skills or passed summative checkpoints. Diagnostic placement unlocks the route without awarding a completion marker. A region completes when every leaf completes.

The electronics release updates existing seeded curricula through their ledger. It preserves node IDs, learner evidence and local field edits. See the [pedagogical review and migration limits](auditoria-eletronica/README.md).

Hoje opens `/mapa`. Each curriculum unit owns a region. The view uses the learner's effective prerequisites and frontier, with clickable links to other regions. Starting a leaf uses the same model setup, lesson marker and evidence path as Hoje. “Continuar aula” reopens the most recent existing lesson for that leaf.

The region groups materials by title and links to precise chapters or published video timestamps. Curated links live in `content/resources/sections.json` and the study material service. Catalog-title and search matches are provisional. A YouTube key enables additional video discovery. A Wikibooks lookup searches section titles. Both run on request. Matches with specific sections or timestamps can appear in other regions of that domain. Opening a lesson includes its sources and a short book excerpt when available. Saving an available publisher PDF imports it into the existing local library.

The regional bibliography reuses the curriculum's textbook, course and learner-reference anchors. It displays the cited scope and publisher link when available. Only materials linked to the selected node are included in its lesson. Other sections stay accessible under “Outros trechos da região”.

## Next steps (not connected yet)
- **End-of-session flashcards.** `plugins/flashcards` already has `export-service` (AnkiConnect, Obsidian, `.apkg`). It still needs the end-of-session trigger with the domain id.
- **Model registry.** `src/core/models` (RoleSpec, resolve) is not used by the existing engines yet. Today the strong/cheap/vision slots still decide.
- **Procedural expansion.** The patch ledger, `applyPatch`, `computeTriggers` and `classifyRisk` are ready, but the job that asks the `curriculum` role for patches is not connected.

- **Lean.** `formal/` is planned as CI only; Lean is not installed locally.
- **Progress calibration.** `scripts/calibrate-progression.ts` still exits 1: the skimmer farmer reaches 0.71× (limit 0.7). This needs a rules v2 decision.
