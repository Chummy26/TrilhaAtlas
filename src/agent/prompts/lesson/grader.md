<!--
Open-answer grader (role `rubric`). Source: docs/research/00-SINTESE.md
§1.2 P7, §2.4(c) item 4; r1 §6.7, §9.1 (misconception attribution). Used only
for items that deterministic grading cannot settle (explain, short answers
outside the accepted forms, speaking without ASR). Filled by graderRequest()
in src/core/lesson/payloads.ts; the output is validated by parseLlmGrade()
(src/core/lesson/grading.ts, LlmGradeSchema).
Variables: {{lang}} {{context}}
-->

# Task

Grade ONE learner response against the reference and rubric below. Output a single JSON object and nothing else (no code fence, no commentary).

```json
{{context}}
```

## Rubric (0–3)

- **3**: correct and complete; meets every rubric criterion. Wording may differ from the reference; spelling slips that do not change meaning are fine.
- **2**: essentially correct; one minor omission or imprecision that does not reveal a wrong idea.
- **1**: partially correct; a relevant piece is there, but a key criterion is missing or a wrong idea is mixed in.
- **0**: incorrect, off-topic, empty, "não sei", or contradicts the reference.

Grade the idea, not the style. A response that reaches the right result for a wrong reason gets at most 1. Do not reward length. If the response is in a different language than expected, grade its content anyway.

## Misconceptions and attribution

- If the response matches the `diagnosticSignal` of one of the listed `misconceptions`, set `misconceptionId` to that id.
- If it shows a clear wrong idea that is NOT listed, describe it in one sentence in `newMisconception` (in {{lang}}), and leave `misconceptionId` null.
- `attributions`: which node(s) in `relatedNodes` the error comes from, with `blame` weights in [0,1] summing to about 1 (e.g. an arithmetic slip in a prerequisite skill blames that prerequisite). Use an empty list for a correct response.

## Output

```
{
  "grade": 0 | 1 | 2 | 3,
  "confidence": number between 0 and 1 (how sure you are of the grade),
  "correct": true when grade >= 2, else false,
  "misconceptionId": "<listed id>" | null,
  "newMisconception": "<one sentence>" | null,
  "attributions": [ { "nodeId": "<id from relatedNodes>", "blame": 0..1, "misconceptionId": "<listed id>" | null } ],
  "rationale": "<at most two sentences in {{lang}}, citing the rubric criterion that decided the grade>"
}
```

Use exactly these keys. Never include the reference answer in `rationale`.
