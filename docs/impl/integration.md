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
| Lesson | Home → `begin(lesson)` | "Começar aula" records the exposure and creates a session with the node as `graphContext`: trail, summary, objectives, common confusions and minutes. |
| Didactics | `src/agent/prompts/teacher/22-cadence.md` | Checks happen per arc (2–4 steps), at most one question per message and three per node, with no filler. It replaces "one check per step". |
| Profile | `/profile`, `studyProfile()` | Account level and XP, tier per domain by FSRS retention, tokens per model, and minutes per day over 14 days. |

## Integration decisions (all can be revisited)

1. **Self-check is weak evidence.** It is recorded with `format: "explain"`, `graderConfidence: 0.5`, `weight: 0.5` and its own item family (`#self`). It can attain a node but never master it alone, because mastery needs at least 2 distinct families and a delayed success.
2. **"Já domino" is a diagnostic placement with p = 0.9.** The node unlocks its dependents but stays `inferred`, and the planner probes it later.
3. **Spacing.** A node taught in the last 20 h is not suggested again as "new". Its consolidation comes from the delayed check the next day.
4. **XP** is credited by `lessonCredit` only after the self-check: full credit when the grade is ≥ 2, effort credit otherwise. The credited minutes are the planned minutes, until the focus heartbeat exists.
5. **Tier core** is the leaves in teaching order, split into 7 stages by cumulative hours (`coreVersion = hours-7@<hash>`). Placements without an FSRS card count with R = 0.9.
6. **Minutes per day** are estimated from turn timestamps: the gap between turns ≤ 10 min apart, plus 2 min per turn. Days with no chat fall back to the minutes of rated lessons.

## Next steps (not connected yet)

- **Practice outcomes → Evidence.** Make in-chat `quiz` answers emit graded `Evidence` (q-vector to the session node, grade 0–3, hints, latency). They are not linked yet, which is why the Hoje card asks for a self-check.
- **Focus heartbeat.** Send `ActivityEvent` from the renderer to `stats-store` every 60 s while the window is focused, and replace the minutes estimate with it. The UsageEvent hook in the provider (`src/server/pi/*`) is also missing.
- **Context memory in turns.** `src/server/memory` (SQLite + FTS5 + e5) exists and is tested, but it is not yet injected into the tutor's context or fed by the extractor at the end of the turn.
- **Resources per node.** YouTube (Data API BYOK) and open books exist in `src/server/resources`. A UI panel on the node and keys in Settings are still needed.
- **End-of-session flashcards.** `plugins/flashcards` already has `export-service` (AnkiConnect, Obsidian, `.apkg`). It still needs the end-of-session trigger with the domain id.
- **Model registry.** `src/core/models` (RoleSpec, resolve) is not used by the existing engines yet. Today the strong/cheap/vision slots still decide.
- **Procedural expansion.** The patch ledger, `applyPatch`, `computeTriggers` and `classifyRisk` are ready, but the job that asks the `curriculum` role for patches is not connected.
- **Graph view of the curriculum (sigma).** It is not built; the home still shows the original proposition graph.
- **Lean.** `formal/` is planned as CI only; Lean is not installed locally.
- **Progress calibration.** `scripts/calibrate-progression.ts` still exits 1: the skimmer farmer reaches 0.71× (limit 0.7). This needs a rules v2 decision.
