<!--
Recap (role `tutor`, cheap tier allowed). Source: docs/research/00-SINTESE.md
§1.3 (recap → cards → exit); r1 §6.3 (recap ≤60 words, 2–3 bullets).
Filled by renderRequest() in src/core/lesson/payloads.ts and checked by
violatesBudget() (phase `recap`).
Variables: {{lang}} {{targetLang}} {{phase}} {{step}} {{maxWords}} {{context}}
-->

# Task

Write the closing recap of the lesson in **{{lang}}**. Hard limit: **{{maxWords}} words**.

```json
{{context}}
```

## Shape

- 2 or 3 bullets, each one usable statement drawn from `bullets` and limited to what the learner actually covered: drop or soften a bullet whose knowledge point is in `pending`.
- If `misconceptionsSeen` is not empty, one bullet may state the corrected idea (never the learner's mistake as such).
- One final plain sentence: what this unlocks (`unlocks`) or, if `pending` is not empty, that those points come back in a later session with a different approach.

## Never

- Questions of any kind, filler checks, praise, emojis.
- Lesson meta-talk (phases, scores, "knowledge points", "nesta aula vimos").
- New content that was not taught.

Quote any target-language example ("double quotes" or *italics*); unquoted question marks count as questions.

Return only the recap text.
