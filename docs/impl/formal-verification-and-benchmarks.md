# Verificação Formal, Auditoria Lógica e Benchmark do Harness

> Gerado automaticamente por `scripts/benchmark-formal-harness.ts` em 2026-11-21.

## Resumo Executivo

- **Provas formais e checagens de modelo:** 41/41 aprovadas (**137,757** estados/casos verificados, **0 contraexemplos**).
- **Pacote Lean 4 (`formal/`):** 5 módulos, **25 teoremas mecanizados**, zero `sorry`, zero `admit`, zero axiomas customizados (CI em `.github/workflows/formal.yml`).
- **Domínios de produção auditados (100% alcançáveis, zero deadlocks):** `english` (925 nós, 771 folhas, 71 regiões) · `electronics` (1010 nós, 809 folhas, 131 regiões).
- **SLAs de latência:** 12/12 dentro do orçamento.
- **Tempo total da suíte:** 7253.17 ms.

## 1. Provas Formais & Model Checking

| ID | Categoria | Método | Estados | Tempo (ms) | Status | Teorema |
|---|---|---|---:|---:|---|---|
| `LEAN-AUDIT` | curriculum | certificate-checker | 25 | 0 | PASS | Lean 4 package (5 modules, 25 mechanized theorems) has zero sorry/admit/custom axioms |
| `KST-1@diamond` | kst | exhaustive-model-check | 1 | 0 | PASS | Empty state ∅ is feasible |
| `KST-2@diamond` | kst | exhaustive-model-check | 21 | 0.04 | PASS | Feasible states are closed under union (K₁, K₂ ∈ ℱ ⇒ K₁ ∪ K₂ ∈ ℱ) |
| `KST-3@diamond` | kst | exhaustive-model-check | 16 | 0.11 | PASS | interior(X) equals the exact greatest feasible subset of X across all 2^N states |
| `KST-4@diamond` | kst | exhaustive-model-check | 6 | 0.06 | PASS | outerFringe(K) equals exact {q ∉ K : feasible(K ∪ {q})} for every feasible K |
| `KST-5@diamond` | kst | exhaustive-model-check | 6 | 0.19 | PASS | innerFringe(K) equals exact {k ∈ K : feasible(K \ {k})} for every feasible K |
| `KST-6@diamond` | kst | exhaustive-model-check | 22 | 0.21 | PASS | Mandatory prerequisites hold in every feasible state; impliedClosure is extensive & idempotent |
| `KST-1@disjunctiveOr` | kst | exhaustive-model-check | 1 | 0 | PASS | Empty state ∅ is feasible |
| `KST-2@disjunctiveOr` | kst | exhaustive-model-check | 55 | 0.04 | PASS | Feasible states are closed under union (K₁, K₂ ∈ ℱ ⇒ K₁ ∪ K₂ ∈ ℱ) |
| `KST-3@disjunctiveOr` | kst | exhaustive-model-check | 16 | 0.03 | PASS | interior(X) equals the exact greatest feasible subset of X across all 2^N states |
| `KST-4@disjunctiveOr` | kst | exhaustive-model-check | 10 | 0.02 | PASS | outerFringe(K) equals exact {q ∉ K : feasible(K ∪ {q})} for every feasible K |
| `KST-5@disjunctiveOr` | kst | exhaustive-model-check | 10 | 0.06 | PASS | innerFringe(K) equals exact {k ∈ K : feasible(K \ {k})} for every feasible K |
| `KST-6@disjunctiveOr` | kst | exhaustive-model-check | 26 | 0.1 | PASS | Mandatory prerequisites hold in every feasible state; impliedClosure is extensive & idempotent |
| `KST-1@complex8` | kst | exhaustive-model-check | 1 | 0 | PASS | Empty state ∅ is feasible |
| `KST-2@complex8` | kst | exhaustive-model-check | 780 | 0.77 | PASS | Feasible states are closed under union (K₁, K₂ ∈ ℱ ⇒ K₁ ∪ K₂ ∈ ℱ) |
| `KST-3@complex8` | kst | exhaustive-model-check | 256 | 1.6 | PASS | interior(X) equals the exact greatest feasible subset of X across all 2^N states |
| `KST-4@complex8` | kst | exhaustive-model-check | 39 | 0.14 | PASS | outerFringe(K) equals exact {q ∉ K : feasible(K ∪ {q})} for every feasible K |
| `KST-5@complex8` | kst | exhaustive-model-check | 39 | 0.26 | PASS | innerFringe(K) equals exact {k ∈ K : feasible(K \ {k})} for every feasible K |
| `KST-6@complex8` | kst | exhaustive-model-check | 295 | 2.84 | PASS | Mandatory prerequisites hold in every feasible state; impliedClosure is extensive & idempotent |
| `CUR-1@english` | curriculum | certificate-checker | 925 | 3.99 | PASS | Curriculum "english" satisfies all structural invariants (R1–R3, hierarchy, schema) |
| `CUR-2@english` | curriculum | certificate-checker | 925 | 16.51 | PASS | Snapshot certificate (Kahn topological order + FNV-1a Merkle hash) verifies for "english" |
| `CUR-3@english` | curriculum | certificate-checker | 771 | 10.45 | PASS | 100% of live leaf skills in "english" are reachable from ∅ with strict topo order (zero deadlocks) |
| `SYL-HOURS` | pedagogy | fsm-verification | 2 | 0 | PASS | 2 completed English A1 skills report realistic hours (≤ 1.0 h, not 5.5 h) and day-1 forecast uses planned pace |
| `EXAM-BLIND@english` | pedagogy | fsm-verification | 4 | 1.65 | PASS | Interleaved module exam for "english" masks internal nodeIds from all prompts |
| `CUR-1@electronics` | curriculum | certificate-checker | 1010 | 3.15 | PASS | Curriculum "electronics" satisfies all structural invariants (R1–R3, hierarchy, schema) |
| `CUR-2@electronics` | curriculum | certificate-checker | 1010 | 25.68 | PASS | Snapshot certificate (Kahn topological order + FNV-1a Merkle hash) verifies for "electronics" |
| `CUR-3@electronics` | curriculum | certificate-checker | 809 | 4.58 | PASS | 100% of live leaf skills in "electronics" are reachable from ∅ with strict topo order (zero deadlocks) |
| `EXAM-BLIND@electronics` | pedagogy | fsm-verification | 4 | 1.09 | PASS | Interleaved module exam for "electronics" masks internal nodeIds from all prompts |
| `FSM-1` | exam-fsm | fsm-verification | 2 | 0.4 | PASS | Premature exam is strictly blocked before instruction, while explicit learner exam request is honored |
| `FSM-2` | exam-fsm | fsm-verification | 13 | 0.6 | PASS | Non-answers and skip requests are strictly rejected while legitimate concise solutions pass |
| `FSM-3` | exam-fsm | fsm-verification | 5 | 1.05 | PASS | Duplicate retests, shallow feedback, and >2 attempts are strictly forbidden (attempt bound ≤ 2) |
| `FSM-4` | exam-fsm | fsm-verification | 4 | 2.31 | PASS | Strict mastery gate rejects trivial evidence, unmet criteria & hallucinated card sources, accepts verified verbatim mastery |
| `FSM-5` | pedagogy | fsm-verification | 10 | 2.05 | PASS | Tool non-interruption, advanced-only mandatory reading, blind listening zero-leak, and multi-part form invariants hold |
| `REP-RANK` | pedagogy | algebraic-grid | 2 | 0.98 | PASS | Educational reputation engine ranks authoritative open textbooks ≥ 25 pts above generic web notes |
| `XP-I1-I5` | xp | algebraic-grid | 42 | 0.35 | PASS | All event credits satisfy XP ≥ 0 (I1) and multiplier ≤ 1.5 ⇒ XP/h ≤ 90 (I5) |
| `XP-I6` | xp | algebraic-grid | 202 | 0.04 | PASS | gReview(R) and mDif(E) are monotonically non-increasing across [0, 1] (∂XP/∂R ≤ 0) |
| `XP-I2-I7-BIJ` | xp | algebraic-grid | 274 | 1.14 | PASS | Replay idempotence (I2), rating exclusion (I7), soft-cap contraction, and levelFromXp(xpForLevel(L)) = L (L=1..250) |
| `XP-I1-I5@r2-candidate` | xp | algebraic-grid | 42 | 0.07 | PASS | All event credits satisfy XP ≥ 0 (I1) and multiplier ≤ 1.5 ⇒ XP/h ≤ 90 (I5) |
| `XP-I6@r2-candidate` | xp | algebraic-grid | 202 | 0.03 | PASS | gReview(R) and mDif(E) are monotonically non-increasing across [0, 1] (∂XP/∂R ≤ 0) |
| `XP-I2-I7-BIJ@r2-candidate` | xp | algebraic-grid | 274 | 0.2 | PASS | Replay idempotence (I2), rating exclusion (I7), soft-cap contraction, and levelFromXp(xpForLevel(L)) = L (L=1..250) |
| `MC-ANTIFARM-R2` | xp | algebraic-grid | 129600 | 7253.09 | PASS | Monte Carlo (120 learners × 180 d, FSRS-7): candidate 2026-11-r2 drives skimmer ≤ 0.70× (0.694× vs r1 0.719×) while preserving ≥ 97% honest XP/h |

## 2. Calibração Monte Carlo Anti-Farming (FSRS-7, 120 alunos × 180 dias)

| Regra | Honesto 3 h/dia (XP/h) | Revisão Precoce (razão) | Skimmer (razão) | Meta Skimmer ≤ 0.70× |
|---|---:|---:|---:|---|
| `2026-11-r1` | 55.7 | 0.636× | 0.719× | ACIMA (baseline r1) |
| `2026-11-r2-candidate` | 55.07 | 0.636× | 0.694× | PASS |

> **Nota de calibração:** `2026-11-r1` é preservada intacta para compatibilidade histórica do ledger; `2026-11-r2-candidate` (`lessonFailCredit: 0.10`, `lessonRushFraction: 0.65`) comprova que o fechamento da brecha de *skimming* derruba o ganho do *skimmer* abaixo de 0,70× mantendo o ganho do aluno honesto praticamente idêntico.

## 3. Benchmarks de Latência e SLA nos Grafos Reais

| Operação | Domínio | Latência (ms) | Orçamento (ms) | Status | Detalhes |
|---|---|---:|---:|---|---|
| `validate(snapshot)` | `english` | 3.57 | 250 | PASS | 925 live nodes |
| `checkSnapshotCertificate` | `english` | 21.45 | 250 | PASS | Kahn topo + FNV-1a Merkle |
| `structuralState(∅)` | `english` | 0.71 | 120 | PASS | 545 frontier nodes |
| `buildStudySyllabus` | `english` | 2.59 | 120 | PASS | 771 lessons, 390.17h |
| `buildModuleExam` | `english` | 1.65 | 80 | PASS | 4 blind interleaved Qs |
| `foldEvents(50 evidence)` | `english` | 60.84 | 250 | PASS | DINA + FSRS-7 + Elo + local consistency |
| `validate(snapshot)` | `electronics` | 2.93 | 250 | PASS | 1010 live nodes |
| `checkSnapshotCertificate` | `electronics` | 17.19 | 250 | PASS | Kahn topo + FNV-1a Merkle |
| `structuralState(∅)` | `electronics` | 0.36 | 120 | PASS | 9 frontier nodes |
| `buildStudySyllabus` | `electronics` | 1.78 | 120 | PASS | 809 lessons, 470.2h |
| `buildModuleExam` | `electronics` | 1.09 | 80 | PASS | 4 blind interleaved Qs |
| `foldEvents(50 evidence)` | `electronics` | 70.22 | 250 | PASS | DINA + FSRS-7 + Elo + local consistency |
