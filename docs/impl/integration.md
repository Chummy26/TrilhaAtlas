# Integration of the estudos-sota modules

This document records how the pure modules (curriculum, learner, lesson, progress, stats, domains, memory, resources) were connected to the learnharness app. It also states what is still disconnected.

## What is live

Every installed curriculum has a guided campaign on the home screen. Generated and imported trees use their levels, units and effective prerequisites. A single-level tree uses its units as chapters. Each chapter links to real skills on the map and ends with an observable task. Explicit personal targets can redirect the daily plan. Completing a chapter preserves the learner’s review history. The English domain retains its six authored CEFR chapters. The map supports independent exploration, and lessons expose optional reading and video alongside the tutor. [Campanha de inglês e percurso de teste](campanha-ingles.md)

Campaign authoring now validates stage continuity, budgets distributed practice and reserves delayed application checks. The teacher can prepare reviews for existing curriculum lessons and open editable circuit laboratories. [Campanhas, evidência e benchmarks](campanhas-e-retencao.md)

The home domain menu opens `/dominios/novo`. Its creation request runs against the selected foreground model and reports progress while the learner can keep studying. The installer validates the complete curriculum, writes its sources and ledger together, and leaves the active domain selected until the learner opens the new map. [Domain authoring](../authoring-domains.md)

The teacher receives domain history, recent graded mistakes when relevant, and passages retrieved from books linked to the current region. [Tutor behavior and research](memoria-pedagogia.md) · [Public retrieval evaluation](memory.md#retrieval-check-on-public-conversation-histories)

| Piece | Where | Behavior |
|---|---|---|
| Cel theme | `app/layout.tsx`, `components/settings/appearance.tsx`, `electron/appearance-chrome.cjs` | The graphite `cel-noite` palette is the factory setting on first paint and in the picker. Saved theme IDs and overrides take precedence. |
| Interactive lessons | [Activities, authoring and sources](aulas-interativas.md) | Selected skills open a native activity in the lesson. The teacher can also choose a circuit, timeline, comparison, sequence or diagram in a free conversation. |
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

The teacher now retrieves evidence within the session and selected curriculum branch. Its compact activities, source selection, scope checks and marathon results are documented in the [teaching evaluation](avaliacao-do-professor.md).

1. **Self-check is weak evidence.** The `#self` event updates the proficiency estimate at weight 0.5. Only externally graded evidence can supply a correct family or delayed success toward mastery. Mastery also requires full independent production after a measured interval.
2. **"Já domino" is a diagnostic placement with p = 0.9.** The node unlocks its dependents but stays `inferred`, and the planner probes it later.
3. **Spacing.** A node taught in the last 20 h is not suggested again as "new". Its consolidation comes from the delayed check the next day.
4. **XP** uses the first graded quiz check per lesson. An exact answer earns grade 3 and full lesson credit. A wrong answer or “não sei” earns grade 0 and effort credit. Later checks update the learner. A lesson without a graded check can earn credit through its self-check. XP uses the lesson's planned minutes.
5. **Tier core** is the leaves in teaching order, split into 7 stages by cumulative hours (`coreVersion = hours-7@<hash>`). Placements without an FSRS card count with R = 0.9.
6. **Minutes per day** come from the union of measured intervals across windows. The profile splits time at local midnight. Days before measurement began show zero.

## Skill tree and regional materials

The Canvas shows the full active domain from the first frame. Node coordinates are independent of selection and progress. The overview summarizes prerequisite links between groups and the detailed view draws individual dependencies. Untouched skills are gray. A teal double ring and the “Você está aqui” label locate the current lesson or the first recommended skill, a dashed outline marks work in progress, and completed skills take their area color. Columns follow the authored curriculum, with neighboring areas and units grouped by prerequisite depth. Topic branches and their skills stay together within each unit. Diagnostic placement unlocks the route without awarding a completion marker. A region completes when every core leaf completes.

The electronics release updates existing seeded curricula through their ledger. It preserves node IDs, learner evidence and local field edits. See the [pedagogical review and migration limits](auditoria-eletronica/README.md).

Hoje opens `/mapa`. Each curriculum unit owns a region. The view uses the learner's effective prerequisites and frontier, with clickable links to other regions. Starting a leaf uses the same model setup, lesson marker and evidence path as Hoje. “Continuar aula” reopens the most recent existing lesson for that leaf.

The region groups materials by title and links to precise chapters or published video timestamps. Curated links live in `content/resources/sections.json` and the study material service. Catalog-title and search matches are provisional. A YouTube key enables additional video discovery. A Wikibooks lookup searches section titles. Both run on request. Matches with specific sections or timestamps can appear in other regions of that domain. Opening a lesson includes its sources and a short book excerpt when available. Saving an available publisher PDF imports it into the existing local library.

Generated domains look up missing readings and video lessons when a region or one of its skills opens. Regional results are shared by its skills. The public YouTube results page provides a fallback when a Data API key is unavailable. Bibliographic queries retry with shorter subjects. Verified cartography chapters cover scale, contour lines, profiles and gradients. Catalog matches carry a suggestion label.

Regional PDF retrieval indexes the text of each physical page. Existing linked PDFs rebuild their search passages from the original file on first use. The tutor can request a page image to examine figures. Clicking a PDF citation in a lesson opens that page in a side panel. The panel also provides selectable extracted text and closes with Escape.

The regional bibliography reuses the curriculum's textbook, course and learner-reference anchors. It displays the cited scope and publisher link when available. Only materials linked to the selected node are included in its lesson. Other sections stay accessible under “Outros trechos da região”.

Opening an exploration saves a separate conversation and time spent. It preserves the main lesson position, exposure-driven learning estimates and the pending check on Hoje. An explicitly answered graded leaf quiz can provide evidence in the same domain. Panoramic sessions on regions do not grade the whole region. The map's position button centers the last main lesson, or the recommended starting point for a new learner.

Hoje uses the saved goal to choose a route. If an overdue prerequisite on that route also shows repeated errors, its existing review slot becomes a reinforcement before the next new skill.

## Optional reinforcement from lesson evidence

After two distinct, graded quiz mistakes on a skill within 14 days, the server checks whether a prerequisite route is already available. A later correct check clears that streak. The background research model sees the two questions, selected answers and regional curriculum. It can decline or propose one short activity. Its response contains teaching content only. The server assigns identity, region and prerequisites, validates the patch and publishes it through the domain ledger under a write lock.

Each target can receive one optional sibling. It inherits the target's entry routes, counts separately from core completion, and appears on the original skill and the daily card. The source goal and historical learner events are preserved. The shared background budget and provider permissions apply. An interrupted write is recovered from the ledger, and repeated visits reuse the same decision. Older checks remain valid learner evidence; automatic expansion uses checks with recorded question context.

## Next steps (not connected yet)
- **End-of-session flashcards.** `plugins/flashcards` already has `export-service` (AnkiConnect, Obsidian, `.apkg`). It still needs the end-of-session trigger with the domain id.
- **Model registry.** `src/core/models` (RoleSpec, resolve) is not used by the existing engines yet. Today the strong/cheap/vision slots still decide.
- **Broader procedural expansion.** Automatic regional reinforcement is connected. New domains, structural proposals, coverage-gap jobs and learner-requested extensions remain future work.

- **Lean.** `formal/` is planned as CI only; Lean is not installed locally.
- **Progress calibration.** `scripts/calibrate-progression.ts` still exits 1: the skimmer farmer reaches 0.71× (limit 0.7). This needs a rules v2 decision.
