/-!
  TrilhaAtlas Formal Kernel — Knowledge Space Theory (KST) over AND/OR clauses.
  Mirrors `src/core/learner/kst.ts` (SÍNTESE §2.6 & §2.13, Doignon-Falmagne KST).

  Every theorem here is proved purely in Lean 4 core (zero `sorry`, zero external axioms).
-/

namespace TrilhaAtlas.Kst

/-- A knowledge state is a predicate on node identifiers `α`. -/
abbrev State (α : Type) := α → Prop

/-- Subset relation on knowledge states. -/
def Subset {α : Type} (A B : State α) : Prop :=
  ∀ x, A x → B x

/-- Empty knowledge state `∅`. -/
def EmptyState {α : Type} : State α := fun _ => False

/-- Union of two knowledge states `A ∪ B`. -/
def UnionState {α : Type} (A B : State α) : State α :=
  fun x => A x ∨ B x

/-- Inserting a single node `q` into state `K`. -/
def InsertState {α : Type} (K : State α) (q : α) : State α :=
  fun x => K x ∨ x = q

/-- A single AND-clause is satisfied when every member is in `K`. -/
def ClauseHeld {α : Type} (c : List α) (K : State α) : Prop :=
  ∀ m, m ∈ c → K m

/--
  An AND/OR clause system (`clauses : α → List (List α)`) is satisfied at `q`
  when `q` is an entry item (`clauses q = []`) or some alternative clause is held in `K`.
  Matches `clauseSatisfied` in `src/core/learner/kst.ts`.
-/
def ClausesSatisfied {α : Type} (clauses : α → List (List α)) (q : α) (K : State α) : Prop :=
  clauses q = [] ∨ ∃ c, c ∈ clauses q ∧ ClauseHeld c K

/-- A state `K` is feasible (a knowledge state) iff every `q ∈ K` has its clauses satisfied in `K`. -/
def Feasible {α : Type} (clauses : α → List (List α)) (K : State α) : Prop :=
  ∀ q, K q → ClausesSatisfied clauses q K

/-- Outer fringe `K^O`: nodes outside `K` whose prerequisite clauses are already satisfied by `K`. -/
def OuterFringe {α : Type} (clauses : α → List (List α)) (K : State α) (q : α) : Prop :=
  ¬ K q ∧ ClausesSatisfied clauses q K

/-- A prerequisite `u` is mandatory for `v` iff `v` has at least one clause and `u` appears in every clause of `v`. -/
def Mandatory {α : Type} (clauses : α → List (List α)) (u v : α) : Prop :=
  clauses v ≠ [] ∧ ∀ c, c ∈ clauses v → u ∈ c

/-- Theorem 1: Monotonicity of AND-clause satisfaction. -/
theorem clauseHeld_mono {α : Type} {c : List α} {A B : State α}
    (hSub : Subset A B) (hHeld : ClauseHeld c A) : ClauseHeld c B := by
  intro m hm
  exact hSub m (hHeld m hm)

/-- Theorem 2: Monotonicity of AND/OR clause satisfaction. -/
theorem clausesSatisfied_mono {α : Type} {clauses : α → List (List α)} {q : α} {A B : State α}
    (hSub : Subset A B) (hSat : ClausesSatisfied clauses q A) : ClausesSatisfied clauses q B := by
  cases hSat with
  | inl hEmpty => exact Or.inl hEmpty
  | inr hExists =>
      rcases hExists with ⟨c, hcMem, hcHeld⟩
      exact Or.inr ⟨c, hcMem, clauseHeld_mono hSub hcHeld⟩

/-- Theorem 3: The empty state `∅` is always feasible. -/
theorem feasible_empty {α : Type} (clauses : α → List (List α)) :
    Feasible clauses EmptyState := by
  intro q hq
  exact False.elim hq

/-- Theorem 4 (KST Knowledge Space Axiom): Feasible states are closed under union. -/
theorem feasible_union {α : Type} {clauses : α → List (List α)} {A B : State α}
    (hA : Feasible clauses A) (hB : Feasible clauses B) :
    Feasible clauses (UnionState A B) := by
  intro q hq
  cases hq with
  | inl hqA =>
      exact clausesSatisfied_mono (fun x hx => Or.inl hx) (hA q hqA)
  | inr hqB =>
      exact clausesSatisfied_mono (fun x hx => Or.inr hx) (hB q hqB)

/-- Theorem 5: Adding any node from the outer fringe preserves feasibility. -/
theorem outerFringe_preserves_feasible {α : Type} {clauses : α → List (List α)} {K : State α} {q : α}
    (hK : Feasible clauses K) (hq : OuterFringe clauses K q) :
    Feasible clauses (InsertState K q) := by
  intro x hx
  have hSub : Subset K (InsertState K q) := fun y hy => Or.inl hy
  cases hx with
  | inl hxK => exact clausesSatisfied_mono hSub (hK x hxK)
  | inr hxEq =>
      subst hxEq
      exact clausesSatisfied_mono hSub hq.2

/--
  Theorem 6 (Soundness of Implicit Credit / FIRe Unlocking):
  If `u` is mandatory in every clause of `v`, then any feasible state containing `v` must also contain `u`.
-/
theorem mandatory_in_feasible {α : Type} {clauses : α → List (List α)} {K : State α} {u v : α}
    (hK : Feasible clauses K) (hMand : Mandatory clauses u v) (hv : K v) : K u := by
  have hSat := hK v hv
  cases hSat with
  | inl hEmpty => exact False.elim (hMand.1 hEmpty)
  | inr hExists =>
      rcases hExists with ⟨c, hcMem, hcHeld⟩
      exact hcHeld u (hMand.2 c hcMem)

/--
  The exact KST interior of any state `X`: the union of all feasible subsets of `X`.
  Matches `interior` in `src/core/learner/kst.ts`.
-/
def Interior {α : Type} (clauses : α → List (List α)) (X : State α) : State α :=
  fun q => ∃ K, Feasible clauses K ∧ Subset K X ∧ K q

/-- Theorem 7: `Interior X ⊆ X`. -/
theorem interior_subset {α : Type} (clauses : α → List (List α)) (X : State α) :
    Subset (Interior clauses X) X := by
  intro q ⟨K, _, hSub, hq⟩
  exact hSub q hq

/-- Theorem 8: `Interior X` is itself feasible. -/
theorem interior_feasible {α : Type} (clauses : α → List (List α)) (X : State α) :
    Feasible clauses (Interior clauses X) := by
  intro q ⟨K, hFeas, hSub, hq⟩
  have hKSubInt : Subset K (Interior clauses X) := fun y hy => ⟨K, hFeas, hSub, hy⟩
  exact clausesSatisfied_mono hKSubInt (hFeas q hq)

/-- Theorem 9: `Interior X` is the GREATEST feasible subset of `X`. -/
theorem interior_greatest {α : Type} {clauses : α → List (List α)} {X K : State α}
    (hFeas : Feasible clauses K) (hSub : Subset K X) :
    Subset K (Interior clauses X) := by
  intro q hq
  exact ⟨K, hFeas, hSub, hq⟩

/-- Theorem 10: `Interior` is monotone (`X ⊆ Y → Interior X ⊆ Interior Y`). -/
theorem interior_mono {α : Type} {clauses : α → List (List α)} {X Y : State α}
    (hXY : Subset X Y) : Subset (Interior clauses X) (Interior clauses Y) := by
  intro q ⟨K, hFeas, hKX, hq⟩
  exact ⟨K, hFeas, fun z hz => hXY z (hKX z hz), hq⟩

end TrilhaAtlas.Kst
