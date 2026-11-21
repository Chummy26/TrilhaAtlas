/-!
  TrilhaAtlas Formal Kernel — Strict Lesson Exam & Mastery Gate Soundness.
  Mirrors `src/core/study/lesson-conclusion.ts` and `src/core/study/transcript.ts`.

  Proves:
    1. No learner passes a node (grade 3) unless EVERY selected objective is met with evidence.
    2. Exam attempts are strictly bounded (`≤ 2`); reinforcement (`grade < 3`) never unlocks mastery.
    3. Durable mastery (delayed recall ≥ 24h) is always a subset of attained mastery.
-/

namespace TrilhaAtlas.LessonExam

/-- Verdict for a single curriculum objective inside `conclude_lesson`. -/
structure CriterionVerdict where
  objective : Nat
  met : Bool
  hasVerbatimEvidence : Bool

/-- Lesson exam conclusion payload. -/
structure Conclusion where
  grade : Nat
  criteria : List CriterionVerdict
  attemptsUsed : Nat
  hasIndependentAnswer : Bool

/--
  Admissibility predicate matching `validateLessonConclusion` in `src/core/study/lesson-conclusion.ts`:
  - `attemptsUsed` is in `[1, 2]` and an independent exam answer was submitted;
  - `grade ≤ 3`;
  - Passing (`grade = 3`) requires non-empty criteria with EVERY criterion having `met = true`
    and `hasVerbatimEvidence = true`.
-/
def ValidConclusion (c : Conclusion) : Prop :=
  1 ≤ c.attemptsUsed ∧
  c.attemptsUsed ≤ 2 ∧
  c.hasIndependentAnswer = true ∧
  c.grade ≤ 3 ∧
  (c.grade = 3 →
    c.criteria ≠ [] ∧
    ∀ v, v ∈ c.criteria → v.met = true ∧ v.hasVerbatimEvidence = true)

/-- Node unlock predicate: only a valid conclusion with `grade = 3` unlocks mastery. -/
def UnlocksNode (c : Conclusion) : Prop :=
  ValidConclusion c ∧ c.grade = 3

/-- Theorem 1: A node can NEVER unlock without an independent exam answer and bounded attempts. -/
theorem unlock_requires_independent_answer {c : Conclusion} (h : UnlocksNode c) :
    c.hasIndependentAnswer = true ∧ 1 ≤ c.attemptsUsed ∧ c.attemptsUsed ≤ 2 := by
  rcases h with ⟨⟨hMin, hMax, hAns, _, _⟩, _⟩
  exact ⟨hAns, hMin, hMax⟩

/-- Theorem 2: Passing (`UnlocksNode`) implies every criterion was met with verbatim evidence. -/
theorem unlock_requires_all_criteria_met {c : Conclusion} (h : UnlocksNode c) :
    c.criteria ≠ [] ∧ ∀ v, v ∈ c.criteria → v.met = true ∧ v.hasVerbatimEvidence = true := by
  rcases h with ⟨⟨_, _, _, _, hPass⟩, hGrade⟩
  exact hPass hGrade

/-- Theorem 3: Reinforcement (`grade < 3`) NEVER unlocks the node. -/
theorem reinforcement_never_unlocks {c : Conclusion} (hReinforce : c.grade < 3) :
    ¬ UnlocksNode c := by
  intro ⟨_, hEq⟩
  rw [hEq] at hReinforce
  exact Nat.lt_irrefl 3 hReinforce

/--
  Mastery state for one node: durable mastery requires BOTH initial attainment AND
  a delayed independent recall (`≥ 24 h`).
-/
structure NodeMastery where
  attained : Bool
  delayedRecallPassed : Bool

def IsAttained (m : NodeMastery) : Prop := m.attained = true
def IsDurable (m : NodeMastery) : Prop := m.attained = true ∧ m.delayedRecallPassed = true

/-- Theorem 4: Durable mastery is strictly contained in attained mastery (`durable ⊆ attained`). -/
theorem durable_implies_attained (m : NodeMastery) (h : IsDurable m) : IsAttained m :=
  h.1

end TrilhaAtlas.LessonExam
