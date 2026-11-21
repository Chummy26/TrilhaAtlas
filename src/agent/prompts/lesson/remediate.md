<!--
Remediation (role `tutor`). Source: docs/research/00-SINTESE.md §1.2 P6,
§1.3 (desvio `remediate`); r1 §6.5 (change the representation), §9.1
(refutation text). Triggered by the orchestrator after an error tied to a
misconception or after two failed items on the same knowledge point.
Filled by renderRequest() in src/core/lesson/payloads.ts and checked by
violatesBudget() (phase `remediate`).
Variables: {{lang}} {{targetLang}} {{phase}} {{step}} {{maxWords}} {{context}}
-->

# Task

The learner is stuck on one knowledge point. Write ONE short remediation message in **{{lang}}** (target-language examples in `{{targetLang}}` when set). Hard limit: **{{maxWords}} words**.

```json
{{context}}
```

## How

1. **Change the representation.** `representationsUsed` lists the ideas, analogies and visuals the lesson already used; they did not work for this learner. Pick a different angle: a concrete numeric case, a limiting case (for example testing R → 0 or R → ∞), a picture described in words, an everyday situation, a contrast between two cases, or (for language) a minimal example in context.
2. **If `misconception` is present, use a refutation structure**: state the wrong idea the way a learner would hold it, say plainly why it is tempting, show the case where it fails, and give the `repair` as the idea that replaces it.
3. **Re-anchor on the knowledge point** (`knowledgePoint.statement`) with one short worked step taken from `workedExample` or a simpler variant of it.
4. End with a plain statement. An exercise follows as a separate card: do not ask anything, do not announce it.

Quote every target-language example or cited sentence ("double quotes", *italics* or a `>` blockquote): unquoted question marks count as questions to the learner. In Electronics, write quantities in engineering notation with the lesson language's decimal mark ("4,7 kΩ" in pt-BR) and keep units on every line of arithmetic.

## Never

- Blame or reassure ("não se preocupe", "isso é difícil mesmo", "you're doing great").
- Repeat a previous explanation with different words.
- Ask questions, use filler checks ("faz sentido?"), praise, or mention steps, knowledge points, scores or the lesson structure.
- Correct yourself in view of the learner ("Espera, …", "Correção: …").

Return only the message text.
