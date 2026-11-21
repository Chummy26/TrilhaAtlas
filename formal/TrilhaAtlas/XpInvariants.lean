/-!
  TrilhaAtlas Formal Kernel — XP & Anti-Farming Invariants (I1, I2, I5, I6).
  Mirrors `src/core/progress/rules.ts` and `src/core/progress/xp.ts`.

  Modeled in exact scaled integer arithmetic (basis points: 100 = 1.00, 150 = 1.50 = MAX_MULTIPLIER)
  to keep proofs exact, constructive, and independent of floating-point rounding quirks.
-/

namespace TrilhaAtlas.XpInvariants

/-- Maximum multiplier in basis points (150 = 1.50×, matching `MAX_MULTIPLIER = 1.5`). -/
def maxMultiplierBp : Nat := 150

/-- Clamp a natural number into `[lo, hi]`. -/
def clampNat (x lo hi : Nat) : Nat :=
  min hi (max lo x)

/--
  Scaled XP for an event: `xpScaled = minutes * multiplierBp` (so `100` units = `1.00 XP`).
  A multiplier is valid when `multiplierBp ≤ maxMultiplierBp`.
-/
def eventXpScaled (minutes multiplierBp : Nat) : Nat :=
  minutes * multiplierBp

/-- Theorem 1 (I1 — Non-negativity): Every credited event grants non-negative XP. -/
theorem xp_nonneg (minutes multiplierBp : Nat) :
    0 ≤ eventXpScaled minutes multiplierBp :=
  Nat.zero_le _

/--
  Theorem 2 (I5 — Hard Hourly Rate Ceiling):
  For any valid multiplier `≤ 150` (1.5×), 60 focused minutes can NEVER exceed `9000`
  scaled units (`= 90.00 XP/hour`).
-/
theorem xp_hourly_cap (multiplierBp : Nat) (hBound : multiplierBp ≤ maxMultiplierBp) :
    eventXpScaled 60 multiplierBp ≤ 9000 := by
  unfold eventXpScaled maxMultiplierBp at *
  have h := Nat.mul_le_mul_left 60 hBound
  exact h

/--
  Review multiplier `gReview` in basis points as a function of retrievability `rBp ∈ [0, 100]`
  and desired retention `drBp < 100`: `clamp(((100 - rBp) * 100) / (100 - drBp), 10, 150)`.
-/
def gReviewBp (rBp drBp : Nat) : Nat :=
  clampNat (((100 - rBp) * 100) / (100 - drBp)) 10 maxMultiplierBp

/-- Lemma: `clampNat` is monotone in its first argument. -/
theorem clampNat_mono {a b lo hi : Nat} (h : a ≤ b) :
    clampNat a lo hi ≤ clampNat b lo hi := by
  unfold clampNat
  have hMax : max lo a ≤ max lo b := by
    by_cases h1 : lo ≤ a
    · have h2 : lo ≤ b := Nat.le_trans h1 h
      rw [Nat.max_eq_right h1, Nat.max_eq_right h2]
      exact h
    · rw [Nat.max_eq_left (Nat.le_of_not_le h1)]
      exact Nat.le_max_left lo b
  by_cases h3 : hi ≤ max lo b
  · rw [Nat.min_eq_left h3]
    exact Nat.min_le_left hi (max lo a)
  · rw [Nat.min_eq_right (Nat.le_of_not_le h3)]
    exact Nat.le_trans (Nat.min_le_right hi (max lo a)) hMax

/--
  Theorem 3 (I6 — Anti-Early-Review Monotonicity, ∂XP/∂R ≤ 0):
  Higher retrievability `r₁ ≤ r₂` NEVER earns a higher review multiplier.
-/
theorem gReview_antitone {r1 r2 drBp : Nat} (hR : r1 ≤ r2) :
    gReviewBp r2 drBp ≤ gReviewBp r1 drBp := by
  unfold gReviewBp
  apply clampNat_mono
  apply Nat.div_le_div_right
  apply Nat.mul_le_mul_right
  exact Nat.sub_le_sub_left hR 100

/-- Soft cap factor (in percent: 100 = 1.0×, 50 = 0.5×, 25 = 0.25×) for daily credited minutes. -/
def softCapFactorPct (minutesSoFar : Nat) : Nat :=
  if minutesSoFar < 240 then 100
  else if minutesSoFar < 360 then 50
  else 25

/-- Theorem 4: Soft cap factor never exceeds 100% (only reduces). -/
theorem softCap_le_100 (m : Nat) : softCapFactorPct m ≤ 100 := by
  unfold softCapFactorPct
  split
  · exact Nat.le_refl 100
  · split
    · decide
    · decide

/-- Theorem 5: Soft cap factor is non-increasing in daily credited minutes. -/
theorem softCap_antitone {m1 m2 : Nat} (h : m1 ≤ m2) :
    softCapFactorPct m2 ≤ softCapFactorPct m1 := by
  unfold softCapFactorPct
  by_cases h1 : m1 < 240
  · rw [if_pos h1]
    split
    · exact Nat.le_refl 100
    · split <;> decide
  · rw [if_neg h1]
    have h2 : ¬ m2 < 240 := fun hlt => h1 (Nat.lt_of_le_of_lt h hlt)
    rw [if_neg h2]
    by_cases h3 : m1 < 360
    · rw [if_pos h3]
      split <;> decide
    · rw [if_neg h3]
      have h4 : ¬ m2 < 360 := fun hlt => h3 (Nat.lt_of_le_of_lt h hlt)
      rw [if_neg h4]
      exact Nat.le_refl 25

/-- Idempotent credit step: an already-seen `eventId` always adds `0` XP (I2). -/
def creditIfNew (seen : Bool) (deltaXp : Nat) : Nat :=
  if seen then 0 else deltaXp

/-- Theorem 6 (I2 — Replay Idempotence): Replaying an already-credited event adds 0 XP. -/
theorem replay_idempotent (deltaXp : Nat) : creditIfNew true deltaXp = 0 := rfl

end TrilhaAtlas.XpInvariants
