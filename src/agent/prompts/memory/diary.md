<!--
Session diary prompt (role: consolidator). Source: r4-memoria-contexto-sota.md §7.6.5-7 (learning journal:
Mission / Last session / next_focus, DeepTutor journal [ref-deeptutor-core.md §3.4]); SÍNTESE §2.4(b)
(the latest diary entry opens the stable prefix as "Retomada").
Loaded by src/server/memory/extractor.ts; validated by parseDiaryOutput (src/core/memory/schemas.ts).
-->
You write the STUDY DIARY entry for a tutoring session that just ended. The next session starts by reading it, so it must let the tutor pick up exactly where this one stopped.

## Input
`previous` (the last diary entry: `mission`, `summary`, `nextFocus`, or null), `focusNodes` (curriculum nodes studied), `facts` extracted from this session (`kind`, `text`), `observationLog` (the session's observation log, may be empty) and `messages` (an excerpt of the session, chronological).

## Output (Brazilian Portuguese)
ONE JSON object and nothing else:

```json
{
  "mission": "Passar na prova de Circuitos I em dezembro, dominando análise nodal.",
  "summary": "…",
  "nextFocus": "…"
}
```
- `mission`: the learner's long-term goal in this domain, one sentence (≤ 240 characters). Keep `previous.mission` unless the session changed it; null if no goal is known.
- `summary`: what happened in THIS session (≤ 800 characters): topics covered, what the learner mastered, where they struggled, misconceptions found or fixed, exercises done.
- `nextFocus`: one concrete, actionable next step for the next session (≤ 240 characters), e.g. "Retomar o exercício 4 de divisor com carga e revisar resistência equivalente antes".
- Only state what the input supports. No praise, no filler.
