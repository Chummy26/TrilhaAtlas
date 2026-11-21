/-!
  TrilhaAtlas Formal Kernel — Curriculum DAG & Runtime Certificate Soundness (R1, R2).
  Mirrors `src/core/curriculum/certificate.ts` and `src/core/curriculum/invariants.ts`.

  Proves that the O(V+E) topological certificate checked at runtime guarantees:
    1. Global acyclicity (R2): no directed cycle can exist.
    2. Global reachability (R1): every live node is reachable from `∅` via feasible states.
-/

import TrilhaAtlas.Kst

namespace TrilhaAtlas.Curriculum

open TrilhaAtlas.Kst

/-- Non-empty directed path in a prerequisite graph `Edge u v` ("`u` precedes `v`"). -/
inductive Path {α : Type} (Edge : α → α → Prop) : α → α → Prop where
  | single {u v : α} : Edge u v → Path Edge u v
  | step {u v w : α} : Edge u v → Path Edge v w → Path Edge u w

/-- A topological rank certificate assigns a natural-number position strictly increasing along every edge. -/
def ValidTopoCert {α : Type} (Edge : α → α → Prop) (pos : α → Nat) : Prop :=
  ∀ u v, Edge u v → pos u < pos v

/-- Lemma: A valid topological certificate increases strictly along every non-empty directed path. -/
theorem topoCert_path_lt {α : Type} {Edge : α → α → Prop} {pos : α → Nat}
    (hCert : ValidTopoCert Edge pos) {u v : α} (hPath : Path Edge u v) :
    pos u < pos v := by
  induction hPath with
  | single hEdge => exact hCert _ _ hEdge
  | step hEdge _ ih => exact Nat.lt_trans (hCert _ _ hEdge) ih

/--
  Theorem 1 (R2 Certificate Soundness):
  If a graph admits a valid topological certificate, it has NO directed cycles.
-/
theorem topoCert_implies_acyclic {α : Type} {Edge : α → α → Prop} {pos : α → Nat}
    (hCert : ValidTopoCert Edge pos) : ∀ u, ¬ Path Edge u u := by
  intro u hCycle
  have hLt := topoCert_path_lt hCert hCycle
  exact Nat.lt_irrefl (pos u) hLt

/--
  Clause-order certificate: for every node `v`, either `clauses v = []` or there exists
  an alternative clause whose members all sit strictly earlier in `pos`.
-/
def ValidClauseCert {α : Type} (clauses : α → List (List α)) (pos : α → Nat) : Prop :=
  ∀ v, clauses v = [] ∨ ∃ c, c ∈ clauses v ∧ ∀ u, u ∈ c → pos u < pos v

/-- Prefix state `{x : pos x < k}` induced by a topological order `pos`. -/
def PrefixState {α : Type} (pos : α → Nat) (k : Nat) : State α :=
  fun x => pos x < k

/-- Every prefix state of a valid clause certificate is feasible. -/
theorem prefixState_feasible {α : Type} {clauses : α → List (List α)} {pos : α → Nat}
    (hCert : ValidClauseCert clauses pos) (k : Nat) :
    Feasible clauses (PrefixState pos k) := by
  intro v hv
  cases hCert v with
  | inl hEmpty => exact Or.inl hEmpty
  | inr hExists =>
      rcases hExists with ⟨c, hcMem, hcLt⟩
      refine Or.inr ⟨c, hcMem, ?_⟩
      intro u hu
      exact Nat.lt_trans (hcLt u hu) hv

/--
  Theorem 2 (R1 Global Reachability):
  Under a valid clause-order certificate, EVERY node `v` belongs to a feasible state
  (specifically `PrefixState pos (pos v + 1)`), proving zero deadlocked or unreachable skills.
-/
theorem clauseCert_implies_all_reachable {α : Type} {clauses : α → List (List α)} {pos : α → Nat}
    (hCert : ValidClauseCert clauses pos) (v : α) :
    ∃ K, Feasible clauses K ∧ K v := by
  refine ⟨PrefixState pos (pos v + 1), prefixState_feasible hCert (pos v + 1), ?_⟩
  exact Nat.lt_succ_self (pos v)

end TrilhaAtlas.Curriculum
