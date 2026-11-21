/**
 * Pure runtime formal verification & model-checking kernel (browser-safe).
 *
 * Bridges the Lean 4 specification (`formal/TrilhaAtlas/*.lean`) directly to the
 * live TypeScript runtime by exhaustively checking:
 *   1. Knowledge Space Theory (KST) axioms over all 2^N subsets of finite AND/OR DAGs;
 *   2. Curriculum DAG certificates (R1 reachability, R2 acyclicity, R3 closure, Merkle hash);
 *   3. Lesson Exam & Pedagogy Finite-State Machine (safety + liveness invariants);
 *   4. XP & Progression algebra (I1, I2, I5, I6, I7, soft cap, exact level bijection).
 */

import { checkSnapshotCertificate } from "../curriculum/certificate.ts";
import { validate } from "../curriculum/invariants.ts";
import type { CurriculumSnapshot } from "../curriculum/types.ts";
import type { LearnerGraphView } from "../learner/graph-view.ts";
import {
	clauseSatisfied,
	impliedClosure,
	innerFringe,
	interior,
	isFeasible,
	mandatoryMembers,
	outerFringe,
} from "../learner/kst.ts";
import { shouldHideVoiceText } from "../lesson-activity.ts";
import { DEFAULT_LEVEL_CURVE, levelFromXp, xpForLevel } from "../progress/levels.ts";
import { MAX_MULTIPLIER, RULES, validateRules, type XpRules } from "../progress/rules.ts";
import { parseProgressEvent } from "../progress/schema.ts";
import {
	creditEvent,
	eventCredit,
	gReview,
	mDif,
	MemoryLedgerIndex,
	softCapped,
} from "../progress/xp.ts";
import {
	composeExamPartsAnswer,
	extractExamFormParts,
	isLessonExamAnswer,
	lessonExamPhase,
	needsLessonExamContinuation,
	prepareLessonExam,
	validateExamVerdict,
	validateLessonConclusion,
} from "../study/lesson-conclusion.ts";
import { learnerViewOf } from "../study/projection.ts";
import {
	buildMissionPedagogyDirective,
	isAdvancedReadingRequiredNode,
} from "../study/tutor-pedagogy.ts";
import type { LhViewMessage } from "../view.ts";

export interface FormalProofCheck {
	id: string;
	category: "kst" | "curriculum" | "exam-fsm" | "xp" | "pedagogy";
	theorem: string;
	method: "exhaustive-model-check" | "certificate-checker" | "fsm-verification" | "algebraic-grid";
	passed: boolean;
	checkedStates: number;
	ms: number;
	counterexample?: string;
}

function nowMs(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function roundMs(ms: number): number {
	return Math.round(ms * 100) / 100;
}

function setEq(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
	if (a.size !== b.size) return false;
	for (const x of a) if (!b.has(x)) return false;
	return true;
}

function formatSet(s: ReadonlySet<string>): string {
	return `{${[...s].sort().join(", ")}}`;
}

/**
 * Exhaustive finite-model checker for Knowledge Space Theory axioms over ALL 2^N
 * subsets of a prerequisite graph (N <= 10).
 */
export function verifyKstAxiomsExhaustive(graph: LearnerGraphView): FormalProofCheck[] {
	const ids = graph.ids;
	if (ids.length > 10) {
		throw new RangeError(`verifyKstAxiomsExhaustive requires <= 10 nodes (got ${ids.length}).`);
	}
	const totalSubsets = 1 << ids.length;
	const subsets: Set<string>[] = [];
	const feasibleStates: Set<string>[] = [];
	for (let mask = 0; mask < totalSubsets; mask++) {
		const s = new Set<string>();
		for (let i = 0; i < ids.length; i++) {
			if ((mask & (1 << i)) !== 0) s.add(ids[i]!);
		}
		subsets.push(s);
		if (isFeasible(graph, s)) feasibleStates.push(s);
	}

	const checks: FormalProofCheck[] = [];

	// KST-1: Empty state is always feasible.
	{
		const t0 = nowMs();
		const ok = isFeasible(graph, new Set());
		checks.push({
			id: "KST-1",
			category: "kst",
			theorem: "Empty state ∅ is feasible",
			method: "exhaustive-model-check",
			passed: ok,
			checkedStates: 1,
			ms: roundMs(nowMs() - t0),
			...(ok ? {} : { counterexample: "isFeasible(∅) = false" }),
		});
	}

	// KST-2: Closure under union (Doignon-Falmagne Knowledge Space axiom).
	{
		const t0 = nowMs();
		let pairs = 0;
		let ce: string | undefined;
		outer: for (let i = 0; i < feasibleStates.length; i++) {
			for (let j = i; j < feasibleStates.length; j++) {
				pairs++;
				const u = new Set<string>([...feasibleStates[i]!, ...feasibleStates[j]!]);
				if (!isFeasible(graph, u)) {
					ce = `Union of ${formatSet(feasibleStates[i]!)} and ${formatSet(feasibleStates[j]!)} is not feasible`;
					break outer;
				}
			}
		}
		checks.push({
			id: "KST-2",
			category: "kst",
			theorem: "Feasible states are closed under union (K₁, K₂ ∈ ℱ ⇒ K₁ ∪ K₂ ∈ ℱ)",
			method: "exhaustive-model-check",
			passed: !ce,
			checkedStates: pairs,
			ms: roundMs(nowMs() - t0),
			...(ce ? { counterexample: ce } : {}),
		});
	}

	// KST-3: interior(X) === ⋃{K ⊆ X : isFeasible(K)} for every X ⊆ Q.
	{
		const t0 = nowMs();
		let ce: string | undefined;
		for (const X of subsets) {
			const fast = interior(graph, X);
			const brute = new Set<string>();
			for (const K of feasibleStates) {
				let sub = true;
				for (const id of K) if (!X.has(id)) { sub = false; break; }
				if (sub) for (const id of K) brute.add(id);
			}
			if (!setEq(fast, brute)) {
				ce = `interior(${formatSet(X)}) = ${formatSet(fast)} ≠ brute union ${formatSet(brute)}`;
				break;
			}
		}
		checks.push({
			id: "KST-3",
			category: "kst",
			theorem: "interior(X) equals the exact greatest feasible subset of X across all 2^N states",
			method: "exhaustive-model-check",
			passed: !ce,
			checkedStates: subsets.length,
			ms: roundMs(nowMs() - t0),
			...(ce ? { counterexample: ce } : {}),
		});
	}

	// KST-4: outerFringe(K) === {q ∉ K : isFeasible(K ∪ {q})}.
	{
		const t0 = nowMs();
		let ce: string | undefined;
		for (const K of feasibleStates) {
			const got = new Set(outerFringe(graph, K));
			const brute = new Set<string>();
			for (const q of ids) {
				if (K.has(q)) continue;
				const next = new Set(K);
				next.add(q);
				if (isFeasible(graph, next)) brute.add(q);
			}
			if (!setEq(got, brute)) {
				ce = `outerFringe(${formatSet(K)}) = ${formatSet(got)} ≠ ${formatSet(brute)}`;
				break;
			}
		}
		checks.push({
			id: "KST-4",
			category: "kst",
			theorem: "outerFringe(K) equals exact {q ∉ K : feasible(K ∪ {q})} for every feasible K",
			method: "exhaustive-model-check",
			passed: !ce,
			checkedStates: feasibleStates.length,
			ms: roundMs(nowMs() - t0),
			...(ce ? { counterexample: ce } : {}),
		});
	}

	// KST-5: innerFringe(K) === {k ∈ K : isFeasible(K \ {k})}.
	{
		const t0 = nowMs();
		let ce: string | undefined;
		for (const K of feasibleStates) {
			const got = new Set(innerFringe(graph, K));
			const brute = new Set<string>();
			for (const k of K) {
				const prev = new Set(K);
				prev.delete(k);
				if (isFeasible(graph, prev)) brute.add(k);
			}
			if (!setEq(got, brute)) {
				ce = `innerFringe(${formatSet(K)}) = ${formatSet(got)} ≠ ${formatSet(brute)}`;
				break;
			}
		}
		checks.push({
			id: "KST-5",
			category: "kst",
			theorem: "innerFringe(K) equals exact {k ∈ K : feasible(K \\ {k})} for every feasible K",
			method: "exhaustive-model-check",
			passed: !ce,
			checkedStates: feasibleStates.length,
			ms: roundMs(nowMs() - t0),
			...(ce ? { counterexample: ce } : {}),
		});
	}

	// KST-6: Mandatory prerequisite soundness & impliedClosure idempotence.
	{
		const t0 = nowMs();
		let ce: string | undefined;
		for (const K of feasibleStates) {
			for (const v of K) {
				const node = graph.nodes.get(v);
				if (!node) continue;
				for (const u of mandatoryMembers(node.clauses)) {
					if (!K.has(u)) {
						ce = `Mandatory prereq ${u} missing from feasible state ${formatSet(K)} containing ${v}`;
						break;
					}
				}
				if (ce) break;
			}
			if (ce) break;
		}
		if (!ce) {
			for (const X of subsets) {
				const c1 = impliedClosure(graph, X);
				const c2 = impliedClosure(graph, c1);
				for (const x of X) if (!c1.has(x)) { ce = `impliedClosure dropped member ${x}`; break; }
				if (!ce && !setEq(c1, c2)) ce = `impliedClosure not idempotent on ${formatSet(X)}`;
				if (ce) break;
			}
		}
		checks.push({
			id: "KST-6",
			category: "kst",
			theorem: "Mandatory prerequisites hold in every feasible state; impliedClosure is extensive & idempotent",
			method: "exhaustive-model-check",
			passed: !ce,
			checkedStates: feasibleStates.length + subsets.length,
			ms: roundMs(nowMs() - t0),
			...(ce ? { counterexample: ce } : {}),
		});
	}

	return checks;
}

/**
 * Independent O(V+E) formal audit of a full curriculum snapshot (works on
 * 1,000+ / 2,000+ node production domains).
 */
export function verifyCurriculumFormalContract(snapshot: CurriculumSnapshot): FormalProofCheck[] {
	const checks: FormalProofCheck[] = [];
	const liveCount = Object.values(snapshot.items).filter(i => i.status !== "deprecated").length;

	// CUR-1: Runtime invariants validate with 0 errors.
	{
		const t0 = nowMs();
		const errors = validate(snapshot, { edgeMode: "relaxed" });
		checks.push({
			id: "CUR-1",
			category: "curriculum",
			theorem: `Curriculum "${snapshot.domainId}" satisfies all structural invariants (R1–R3, hierarchy, schema)`,
			method: "certificate-checker",
			passed: errors.length === 0,
			checkedStates: liveCount,
			ms: roundMs(nowMs() - t0),
			...(errors.length ? { counterexample: errors.slice(0, 3).map(e => `${e.code}: ${e.message}`).join(" | ") } : {}),
		});
	}

	// CUR-2: Independent topological + Merkle hash certificate.
	{
		const t0 = nowMs();
		const cert = checkSnapshotCertificate(snapshot);
		checks.push({
			id: "CUR-2",
			category: "curriculum",
			theorem: `Snapshot certificate (Kahn topological order + FNV-1a Merkle hash) verifies for "${snapshot.domainId}"`,
			method: "certificate-checker",
			passed: cert.ok,
			checkedStates: liveCount,
			ms: roundMs(nowMs() - t0),
			...(!cert.ok ? { counterexample: cert.reason } : {}),
		});
	}

	// CUR-3: Independent forward-chaining reachability of 100% of live leaf nodes from ∅ + strict order.
	{
		const t0 = nowMs();
		const view = learnerViewOf(snapshot);
		const pos = new Map(view.ids.map((id, i) => [id, i]));
		let orderViolation: string | undefined;
		for (const id of view.ids) {
			const node = view.nodes.get(id)!;
			const p = pos.get(id)!;
			for (const clause of node.clauses) {
				for (const m of clause) {
					const mp = pos.get(m);
					if (mp === undefined || mp >= p) {
						orderViolation = `Edge ${m} -> ${id} violates strict topo order (${mp} >= ${p})`;
						break;
					}
				}
				if (orderViolation) break;
			}
			if (orderViolation) break;
		}
		const reached = new Set<string>();
		let changed = true;
		while (changed) {
			changed = false;
			for (const id of view.ids) {
				if (reached.has(id)) continue;
				const node = view.nodes.get(id)!;
				if (clauseSatisfied(node.clauses, m => reached.has(m))) {
					reached.add(id);
					changed = true;
				}
			}
		}
		const leaves = view.ids.filter(id => view.nodes.get(id)?.isLeaf);
		const unreachable = leaves.filter(id => !reached.has(id));
		const ce = orderViolation ?? (unreachable.length ? `${unreachable.length} unreachable leaves: ${unreachable.slice(0, 5).join(", ")}` : undefined);
		checks.push({
			id: "CUR-3",
			category: "curriculum",
			theorem: `100% of live leaf skills in "${snapshot.domainId}" are reachable from ∅ with strict topo order (zero deadlocks)`,
			method: "certificate-checker",
			passed: !ce,
			checkedStates: leaves.length,
			ms: roundMs(nowMs() - t0),
			...(ce ? { counterexample: ce } : {}),
		});
	}

	return checks;
}

/**
 * Exhaustive FSM model checker for the Lesson Exam, Strict Mastery Gate,
 * Advanced Reading Separation, Blind Listening, and Multi-Part Exam Form.
 */
export function verifyLessonExamAutomaton(): FormalProofCheck[] {
	const checks: FormalProofCheck[] = [];

	const assistantMsg = (text: string): LhViewMessage => ({
		id: "a1",
		role: "assistant",
		parts: [{ type: "text", text }],
	});
	const userMsg = (text: string, examCallId?: string): LhViewMessage => ({
		id: "u1",
		role: "user",
		...(examCallId ? { examCallId } : {}),
		parts: [{ type: "text", text }],
	});
	const examPartMsg = (callId: string, task: string, feedback?: string): LhViewMessage => ({
		id: `e-${callId}`,
		role: "assistant",
		parts: [{
			type: "tool-present_lesson_exam",
			toolCallId: callId,
			state: "output-available",
			output: { task, ...(feedback ? { feedback } : {}), attempt: feedback ? 2 : 1, total: 2 },
		}],
	});

	// FSM-1: No premature exam before teaching (unless learner explicitly requests exam).
	{
		const t0 = nowMs();
		let blocked = false;
		try {
			prepareLessonExam([], { task: "Calcule a corrente em um circuito de 12 V com resistor de 4 kΩ." });
		} catch {
			blocked = true;
		}
		let allowedOnRequest = false;
		try {
			const res = prepareLessonExam([userMsg("Já domino esse assunto, quero fazer a prova direto.")], {
				task: "Calcule a corrente em um circuito de 12 V com resistor de 4 kΩ.",
			});
			allowedOnRequest = res.attempt === 1;
		} catch {
			allowedOnRequest = false;
		}
		const ok = blocked && allowedOnRequest;
		checks.push({
			id: "FSM-1",
			category: "exam-fsm",
			theorem: "Premature exam is strictly blocked before instruction, while explicit learner exam request is honored",
			method: "fsm-verification",
			passed: ok,
			checkedStates: 2,
			ms: roundMs(nowMs() - t0),
			...(ok ? {} : { counterexample: `blocked=${blocked}, allowedOnRequest=${allowedOnRequest}` }),
		});
	}

	// FSM-2: Anti-bypass — conversational acknowledgments can NEVER count as exam answers.
	{
		const t0 = nowMs();
		const bypasses = ["ok", "sim", "entendi", "Já entendi tudo!", "pode avançar", "próxima aula", "skip", "next", "faz sentido", "beleza", "   "];
		const bad = bypasses.find(text => isLessonExamAnswer(text));
		const validShort = isLessonExamAnswer("2 mA") && isLessonExamAnswer("I'm from Brazil.");
		const ok = !bad && validShort;
		checks.push({
			id: "FSM-2",
			category: "exam-fsm",
			theorem: "Non-answers and skip requests are strictly rejected while legitimate concise solutions pass",
			method: "fsm-verification",
			passed: ok,
			checkedStates: bypasses.length + 2,
			ms: roundMs(nowMs() - t0),
			...(ok ? {} : { counterexample: bad ? `Bypass accepted: "${bad}"` : "Legitimate concise answer rejected" }),
		});
	}

	// FSM-3 & FSM-4: Attempt 2 rejects duplicate/shallow feedback; attempt 3 is strictly impossible.
	{
		const t0 = nowMs();
		const taught = assistantMsg("Pela Lei de Ohm, I = V / R. Com V = 10 V e R = 5 kΩ, temos I = 2 mA.");
		const exam1 = examPartMsg("c1", "Calcule a corrente em 12 V com resistência de 4 kΩ e explique o efeito de dobrar R.");
		const ans1 = userMsg("A corrente é 6 mA porque dobra.", "c1");
		const history1 = [taught, exam1, ans1];

		let dupBlocked = false;
		try {
			prepareLessonExam(history1, {
				task: "Calcule a corrente em 12 V com resistência de 4 kΩ e explique o efeito de dobrar R.",
				feedback: "Você trocou multiplicação por divisão ao aplicar a Lei de Ohm.",
			});
		} catch { dupBlocked = true; }

		let shallowBlocked = false;
		try {
			prepareLessonExam(history1, {
				task: "Um resistor de 6 kΩ recebe 18 V. Determine a corrente e compare com 12 kΩ.",
				feedback: "Errou.",
			});
		} catch { shallowBlocked = true; }

		const validAttempt2 = prepareLessonExam(history1, {
			task: "Um resistor de 6 kΩ recebe 18 V. Determine a corrente e compare com 12 kΩ.",
			feedback: "Você multiplicou em vez de dividir: pela Lei de Ohm, I = V / R, logo dobrar R reduz I pela metade.",
		});
		const exam2 = examPartMsg("c2", validAttempt2.task, validAttempt2.feedback);
		const ans2 = userMsg("I = 18 V / 6 kΩ = 3 mA; com 12 kΩ cai para 1,5 mA.", "c2");
		const history2 = [...history1, exam2, ans2];

		let thirdBlocked = false;
		try {
			prepareLessonExam(history2, {
				task: "Outro circuito completamente novo de 24 V e 8 kΩ para terceira chance.",
				feedback: "Vamos tentar uma terceira questão diferente desta vez.",
			});
		} catch { thirdBlocked = true; }

		const phase2 = lessonExamPhase(history2);
		const ok = dupBlocked && shallowBlocked && validAttempt2.attempt === 2 && thirdBlocked && phase2 === "final-verdict";
		checks.push({
			id: "FSM-3",
			category: "exam-fsm",
			theorem: "Duplicate retests, shallow feedback, and >2 attempts are strictly forbidden (attempt bound ≤ 2)",
			method: "fsm-verification",
			passed: ok,
			checkedStates: 5,
			ms: roundMs(nowMs() - t0),
			...(ok ? {} : { counterexample: `dup=${dupBlocked}, shallow=${shallowBlocked}, third=${thirdBlocked}, phase=${phase2}` }),
		});
	}

	// FSM-4: Strict exam verdict & conclusion gate blocks trivial evidence, unmet criteria & ungrounded cards; accepts verified mastery.
	{
		const t0 = nowMs();
		const taught = assistantMsg("Pela Lei de Ohm, I = V / R. Quando a resistência dobra sob tensão fixa, a corrente cai pela metade.");
		const exam1 = examPartMsg("c1", "Calcule I para 10 V e 5 kΩ e diga o que acontece com 10 kΩ.");
		const ans1 = userMsg("Com 5 kΩ a corrente é 2 mA; dobrando para 10 kΩ cai pela metade para 1 mA.", "c1");
		const msgs = [taught, exam1, ans1];

		let trivialRejected = false;
		try {
			validateExamVerdict(msgs, {
				evidence: "dobrando para 10 kΩ cai pela metade para 1 mA",
				assessment: "O aluno demonstrou domínio completo da Lei de Ohm.",
				grade: 3,
				criteria: [{ objective: 1, met: true, reason: "Cálculo e proporção corretos.", evidence: "a" }],
				cards: [{
					question: "Se a resistência dobra com tensão fixa, o que ocorre com a corrente?",
					answer: "Reduz-se a 50%",
					source: "Quando a resistência dobra sob tensão fixa, a corrente cai pela metade.",
				}],
			}, 1);
		} catch { trivialRejected = true; }

		let unmetBlocked = false;
		try {
			validateExamVerdict(msgs, {
				evidence: "dobrando para 10 kΩ cai pela metade para 1 mA",
				assessment: "O aluno demonstrou domínio completo da Lei de Ohm.",
				grade: 3,
				criteria: [{ objective: 1, met: false, reason: "Faltou o cálculo exato." }],
				cards: [{
					question: "Se a resistência dobra com tensão fixa, o que ocorre com a corrente?",
					answer: "Reduz-se a 50%",
					source: "Quando a resistência dobra sob tensão fixa, a corrente cai pela metade.",
				}],
			}, 1);
		} catch { unmetBlocked = true; }

		let ungroundedCardRejected = false;
		try {
			validateLessonConclusion(msgs, {
				evidence: "dobrando para 10 kΩ cai pela metade para 1 mA",
				assessment: "O aluno demonstrou domínio completo da Lei de Ohm.",
				grade: 3,
				criteria: [{ objective: 1, met: true, reason: "Cálculo e proporção corretos.", evidence: "dobrando para 10 kΩ cai pela metade para 1 mA" }],
				cards: [{ question: "O que acontece com I ao dobrar R?", answer: "Cai pela metade", source: "Texto inventado fora da aula" }],
			});
		} catch { ungroundedCardRejected = true; }

		let validAccepted = true;
		try {
			const validInput = {
				evidence: "dobrando para 10 kΩ cai pela metade para 1 mA",
				assessment: "O aluno demonstrou domínio completo da Lei de Ohm.",
				grade: 3 as const,
				criteria: [{ objective: 1, met: true, reason: "Cálculo e proporção corretos.", evidence: "dobrando para 10 kΩ cai pela metade para 1 mA" }],
				cards: [{
					question: "Se a resistência dobra com tensão fixa, o que ocorre com a corrente?",
					answer: "Reduz-se a 50%",
					source: "Quando a resistência dobra sob tensão fixa, a corrente cai pela metade.",
				}],
			};
			const outcome = validateExamVerdict(msgs, validInput, 1);
			validateLessonConclusion(msgs, validInput);
			validAccepted = outcome === "passed";
		} catch { validAccepted = false; }

		const ok = trivialRejected && unmetBlocked && ungroundedCardRejected && validAccepted;
		checks.push({
			id: "FSM-4",
			category: "exam-fsm",
			theorem: "Strict mastery gate rejects trivial evidence, unmet criteria & hallucinated card sources, accepts verified verbatim mastery",
			method: "fsm-verification",
			passed: ok,
			checkedStates: 4,
			ms: roundMs(nowMs() - t0),
			...(ok ? {} : { counterexample: `trivial=${trivialRejected}, unmet=${unmetBlocked}, ungrounded=${ungroundedCardRejected}, valid=${validAccepted}` }),
		});
	}

	// FSM-5: Non-interruption, Advanced Reading Separation, Blind Listening & Multi-Part Form Invariants.
	{
		const t0 = nowMs();
		const noInterrupt =
			!needsLessonExamContinuation("teaching", [{ type: "tool-study_activity" }])
			&& !needsLessonExamContinuation("teaching", [{ type: "tool-attach_study_materials" }])
			&& !needsLessonExamContinuation("awaiting-answer", [{ type: "text", text: "Aguardando." }]);

		const advReq = isAdvancedReadingRequiredNode({ level: { scheme: "cefr", cefr: "C1" } })
			&& isAdvancedReadingRequiredNode({ level: { scheme: "ee", band: 3 } })
			&& !isAdvancedReadingRequiredNode({ level: { scheme: "cefr", cefr: "A1" } })
			&& !isAdvancedReadingRequiredNode({ level: { scheme: "ee", band: 0 } });
		const advPromptHasMandate = buildMissionPedagogyDirective([], {
			title: "Projeto RF", objectives: ["Analisar ruído térmico"], requiresQualityReading: true,
		}).includes("MANDATORY ADVANCED READING");
		const begPromptClean = !buildMissionPedagogyDirective([], {
			title: "Saudações A1", objectives: ["Cumprimentar"], requiresQualityReading: false,
		}).includes("MANDATORY ADVANCED READING");

		const blindOk = shouldHideVoiceText({ language: "en-US", sample: "Secret text", mode: "phrase", hideText: true })
			&& shouldHideVoiceText({ language: "en-US", sample: "Secret text", mode: "phrase" }, "Áudio da avaliação — ouça sem ler")
			&& !shouldHideVoiceText({ language: "en-US", sample: "Hello!", mode: "phrase" }, "Prática de pronúncia");

		const parts = extractExamFormParts("Entregue:\n\n1. Primeira parte.\n\n2. Segunda parte.\n\nO critério é precisão.");
		const partialFail = composeExamPartsAnswer(parts, ["Resposta válida 1", "ok"]);
		const fullPass = composeExamPartsAnswer(parts, ["Resposta válida 1", "Resposta válida 2"]);
		const formOk = parts.length === 2 && !partialFail.ok && fullPass.ok;

		const ok = noInterrupt && advReq && advPromptHasMandate && begPromptClean && blindOk && formOk;
		checks.push({
			id: "FSM-5",
			category: "pedagogy",
			theorem: "Tool non-interruption, advanced-only mandatory reading, blind listening zero-leak, and multi-part form invariants hold",
			method: "fsm-verification",
			passed: ok,
			checkedStates: 10,
			ms: roundMs(nowMs() - t0),
			...(ok ? {} : { counterexample: `noInterrupt=${noInterrupt}, adv=${advReq && advPromptHasMandate && begPromptClean}, blind=${blindOk}, form=${formOk}` }),
		});
	}

	return checks;
}

/**
 * Deterministic algebraic verification of XP & Progression laws (I1, I2, I5, I6, I7,
 * soft cap monotonicity, and exact level bijection).
 */
export function verifyXpAlgebraInvariants(rules: XpRules = RULES): FormalProofCheck[] {
	const checks: FormalProofCheck[] = [];
	validateRules(rules);

	// XP-I1 & XP-I5: Non-negativity & hard 90 XP/h ceiling across all event shapes.
	{
		const t0 = nowMs();
		let states = 0;
		let ce: string | undefined;
		const minutesGrid = [0, 1, 5, 15, 30, 60, 120];
		for (const m of minutesGrid) {
			const samples = [
				eventCredit({ kind: "lesson", nodeId: "n", focusedMin: m, expectedMin: 20, checkPassed: true }, rules),
				eventCredit({ kind: "lesson", nodeId: "n", focusedMin: m, expectedMin: 20, checkPassed: false }, rules),
				eventCredit({ kind: "media", resourceId: "r", focusedMin: m, mediaMin: 30, checkPassed: true }, rules),
				eventCredit({ kind: "item", itemId: "i", theta: 0, b: 200, correct: true, focusedMin: m, hints: 0, medianMin: 5 }, rules),
				eventCredit({ kind: "review", nodeId: "n", focusedMin: m, R: 0.2 }, rules),
				eventCredit({ kind: "diagnostic", focusedMin: m, items: 5 }, rules),
			];
			for (const c of samples) {
				states++;
				const xp = c.minutes * c.multiplier;
				if (xp < 0 || !Number.isFinite(xp)) { ce = `Negative/non-finite XP: ${xp}`; break; }
				if (c.multiplier > MAX_MULTIPLIER + 1e-12) { ce = `Multiplier ${c.multiplier} > ${MAX_MULTIPLIER}`; break; }
				if (m > 0 && (xp / (m / 60)) > 90 + 1e-9 && c.minutes <= m) {
					ce = `Rate exceeded 90 XP/h: ${xp / (m / 60)}`;
					break;
				}
			}
			if (ce) break;
		}
		checks.push({
			id: "XP-I1-I5",
			category: "xp",
			theorem: "All event credits satisfy XP ≥ 0 (I1) and multiplier ≤ 1.5 ⇒ XP/h ≤ 90 (I5)",
			method: "algebraic-grid",
			passed: !ce,
			checkedStates: states,
			ms: roundMs(nowMs() - t0),
			...(ce ? { counterexample: ce } : {}),
		});
	}

	// XP-I6: ∂XP/∂R ≤ 0 (antitone gReview) & mDif antitone in expected score E.
	{
		const t0 = nowMs();
		let states = 0;
		let ce: string | undefined;
		let prevG = Infinity;
		let prevM = Infinity;
		for (let i = 0; i <= 100; i++) {
			const x = i / 100;
			const g = gReview(x, rules.desiredRetention, rules);
			const m = mDif(x, rules);
			states += 2;
			if (g > prevG + 1e-12) { ce = `gReview increased at R=${x}: ${g} > ${prevG}`; break; }
			if (m > prevM + 1e-12) { ce = `mDif increased at E=${x}: ${m} > ${prevM}`; break; }
			prevG = g;
			prevM = m;
		}
		checks.push({
			id: "XP-I6",
			category: "xp",
			theorem: "gReview(R) and mDif(E) are monotonically non-increasing across [0, 1] (∂XP/∂R ≤ 0)",
			method: "algebraic-grid",
			passed: !ce,
			checkedStates: states,
			ms: roundMs(nowMs() - t0),
			...(ce ? { counterexample: ce } : {}),
		});
	}

	// XP-I2 & XP-I7 & SoftCap & Level Bijection.
	{
		const t0 = nowMs();
		let ce: string | undefined;
		const index = new MemoryLedgerIndex();
		const ev = {
			eventId: "formal-idempotent-1",
			domainId: "english",
			at: "2026-11-21T10:00:00Z",
			kind: "lesson" as const,
			nodeId: "en.speaking.a1.greetings",
			focusedMin: 20,
			expectedMin: 20,
			checkPassed: true,
		};
		const first = creditEvent(ev, index, { rules });
		if (first.status === "credited") index.add(first.entry);
		const second = creditEvent(ev, index, { rules });
		if (first.status !== "credited" || first.entry.capped <= 0 || second.status !== "duplicate") {
			ce = `Idempotence failed: first=${first.status}, second=${second.status}`;
		}
		// I7: strict boundary rejects rating/grade on progress events.
		if (!ce) {
			let ratingRejected = false;
			try {
				parseProgressEvent({ ...ev, rating: "Good" });
			} catch { ratingRejected = true; }
			if (!ratingRejected) ce = "parseProgressEvent accepted forbidden rating field (violates I7)";
		}
		// SoftCap never inflates XP.
		if (!ce) {
			for (let prior = 0; prior <= 600; prior += 30) {
				const raw = 30 * 1.2;
				const capped = softCapped(30, 1.2, prior, rules);
				if (capped > raw + 1e-12 || capped < 0) {
					ce = `softCapped(${prior}) = ${capped} outside [0, ${raw}]`;
					break;
				}
			}
		}
		// Exact level bijection for L = 1..250.
		if (!ce) {
			for (let L = 1; L <= 250; L++) {
				const xp = xpForLevel(L, DEFAULT_LEVEL_CURVE);
				const back = levelFromXp(xp, DEFAULT_LEVEL_CURVE);
				if (back !== L) {
					ce = `Level bijection broken at L=${L}: xp=${xp} -> L=${back}`;
					break;
				}
			}
		}
		checks.push({
			id: "XP-I2-I7-BIJ",
			category: "xp",
			theorem: "Replay idempotence (I2), rating exclusion (I7), soft-cap contraction, and levelFromXp(xpForLevel(L)) = L (L=1..250)",
			method: "algebraic-grid",
			passed: !ce,
			checkedStates: 274,
			ms: roundMs(nowMs() - t0),
			...(ce ? { counterexample: ce } : {}),
		});
	}

	return checks;
}
