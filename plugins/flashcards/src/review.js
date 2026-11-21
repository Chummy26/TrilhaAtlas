// Page-bound review, using only the public plugin UI and RPC contracts.
const ratings = ["Again", "Hard", "Good", "Easy"];
const ratingKeys = ["again", "hard", "good", "easy"];
const ratingOptions = label => {
  const color = `var(--fc-rating-${label.toLowerCase()})`;
  const tint = percent => `color-mix(in srgb, ${color} ${percent}%, transparent)`;
  return { variant: "custom", colors: {
    background: tint(12), text: color, border: tint(55),
    hover: { background: tint(20), border: tint(75) },
    active: { background: tint(28), border: color },
    focusVisible: { border: color, ring: tint(50) },
  } };
};
const message = error => error instanceof Error ? error.message : String(error);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const interval = ms => {
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h`;
  return `${Math.round(ms / 86400000)}d`;
};
const formatDuration = ms => {
  const totalSec = Math.max(1, Math.round((Number.isFinite(ms) && ms > 0 ? ms : 0) / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (hrs > 0) return min === 0 ? `${hrs}h` : `${hrs}h ${min}m`;
  if (min === 0) return `${sec}s`;
  return sec === 0 ? `${min}m` : `${min}m ${sec}s`;
};
function lifetime(...parents) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const parent of parents.filter(Boolean)) {
    if (parent.aborted) abort();
    else parent.addEventListener("abort", abort, { once: true });
  }
  controller.signal.addEventListener("abort", () => {
    for (const parent of parents.filter(Boolean)) parent.removeEventListener("abort", abort);
  }, { once: true });
  // Already-aborted parents must not retain listeners on the other parents.
  if (controller.signal.aborted) for (const parent of parents.filter(Boolean)) parent.removeEventListener("abort", abort);
  return controller;
}

export function createReviewController({ ctx, signal, button, markdown, onRated }) {
  const owner = lifetime(signal, ctx.signal);
  let active = null;
  const dispose = () => { owner.abort(); active?.close(); };
  owner.signal.addEventListener("abort", () => active?.close(), { once: true });

  function present(scope, practiceCards) {
    const practice = practiceCards !== undefined;
    active?.close();
    if (owner.signal.aborted) return;
    const session = lifetime(owner.signal);
    // Progress belongs to the logical session, not a replayable presentation.
    let practiceIndex = 0;
    let sessionReviewed = 0;
    let sessionInitialTotal = 0;
    const sessionRatings = [0, 0, 0, 0];
    const sessionStartedAt = Date.now();
    let handle, closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      session.abort();
      if (active?.close === close) active = null;
      handle?.dispose();
    };
    active = { close };
    const mount = (container, hostSignal) => {
      // A host presentation may remount (including development effect replay).
      // Its lifetime is narrower than the logical review session.
      if (closed || session.signal.aborted || hostSignal.aborted) return;
      const content = lifetime(session.signal, hostSignal);
      const root = el("div", `fc-root fc-review-surface${practice ? " fc-practice-surface" : ""}`);
      root.tabIndex = -1;
      root.dataset.mode = practice ? "practice" : "review";
      const progress = el("div", "fc-review-progress");
      progress.setAttribute("aria-hidden", "true");
      const progressFill = el("div", "fc-review-progress-fill");
      progress.append(progressFill);
      const fxLayer = el("div", "fc-review-fx");
      fxLayer.setAttribute("aria-hidden", "true");
      const stage = el("div", "fc-review-stage"), title = el("h2", "fc-review-title");
      stage.tabIndex = -1;
      stage.setAttribute("role", "group");
      stage.setAttribute("aria-label", practice ? "Flashcard practice" : "Flashcard review");
      stage.setAttribute("data-plugin-initial-focus", "");
      stage.dataset.mode = practice ? "practice" : "review";
      stage.dataset.revealed = "false";
      title.hidden = true;
      const card = el("div", "fc-review-card"), footer = el("div", "fc-review-footer"), bottom = el("div", "fc-review-bottom");
      const practiceNote = practice ? el("p", "fc-review-meta fc-practice-note", "Practice mode does not change your review schedule.") : null;
      stage.append(title, card, bottom, footer);
      root.append(progress, fxLayer, stage);
      if (practiceNote) root.append(practiceNote);
      container.append(root);
      let cardScope = null, timer = null, revealAction = null, rateAction = null, advanceAction = null, revealed = false;
      const setProgress = ratio => {
        const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
        progressFill.style.width = `${Math.round(clamped * 100)}%`;
      };
      const pulseRatingFx = rating => {
        if (content.signal.aborted) return;
        const key = ratingKeys[rating - 1];
        if (!key) return;
        fxLayer.replaceChildren();
        const bloom = el("span", `fc-ease-bloom fc-ease-bloom-${key}`);
        bloom.addEventListener("animationend", () => bloom.remove(), { once: true, signal: content.signal });
        fxLayer.append(bloom);
      };
      const focusOwned = () => {
        if (!content.signal.aborted && root.contains(document.activeElement)) root.focus({ preventScroll: true });
      };
      const clearWait = () => { if (timer !== null) clearTimeout(timer); timer = null; };
      const cleanup = () => { clearWait(); cardScope?.abort(); fxLayer.replaceChildren(); root.remove(); };
      content.signal.addEventListener("abort", cleanup, { once: true });
      function reset() {
        // Move focus before removing a currently focused control, never reclaim
        // focus from outside this surface. The permanent heading survives reset.
        if (card.contains(document.activeElement) || footer.contains(document.activeElement) || title.contains(document.activeElement)) focusOwned();
        clearWait(); cardScope?.abort(); cardScope = lifetime(content.signal);
        revealAction = null; rateAction = null; advanceAction = null; revealed = false;
        stage.dataset.revealed = "false";
        title.textContent = ""; title.hidden = true;
        card.hidden = true; card.replaceChildren(); footer.replaceChildren();
        bottom.replaceChildren();
        return cardScope.signal;
      }
      function question(ticket, cs, count) {
        card.hidden = false;
        card.classList.remove("fc-card-enter");
        void card.offsetWidth;
        card.classList.add("fc-card-enter");
        markdown(card, ticket.question, cs);
        const answer = el("div", "fc-answer"), actions = el("div", "fc-actions"), error = el("p", "fc-error");
        error.setAttribute("role", "alert");
        card.append(answer); footer.append(actions, error);
        if (count !== undefined) bottom.append(el("p", "fc-review-remaining", count));
        return { answer, actions, error };
      }
      function control(parent, label, action, cs, hint, options = {}) {
        const wrapper = el("div", "fc-rating"); parent.append(wrapper);
        const handle = button(wrapper, label, action, cs, options);
        wrapper.append(el("span", "fc-shortcut", hint));
        return handle;
      }
      function renderDebrief(statusText) {
        const debrief = el("div", "fc-debrief");
        const eyebrow = el("p", "fc-debrief-eyebrow", "Session complete");
        const duration = formatDuration(Date.now() - sessionStartedAt);
        const hero = el("div", "fc-debrief-hero");
        hero.append(
          el("span", "fc-debrief-num", String(sessionReviewed)),
          el("span", "fc-debrief-unit", sessionReviewed === 1 ? "card reviewed" : "cards reviewed"),
          el("span", "fc-debrief-sep", "·"),
          el("span", "fc-debrief-num", duration),
        );
        const bar = el("div", "fc-debrief-bar");
        bar.setAttribute("role", "img");
        bar.setAttribute("aria-label", `Rating breakdown: ${ratings.map((label, index) => `${label} ${sessionRatings[index]}`).join(", ")}`);
        const grid = el("div", "fc-debrief-grid");
        ratings.forEach((label, index) => {
          const count = sessionRatings[index];
          const key = ratingKeys[index];
          const seg = el("span", `fc-debrief-seg fc-debrief-seg-${key}`);
          seg.style.width = `${sessionReviewed ? (count / sessionReviewed) * 100 : 0}%`;
          bar.append(seg);
          const cell = el("div", `fc-debrief-cell fc-debrief-cell-${key}${count === 0 ? " is-zero" : ""}`);
          cell.append(el("span", "fc-debrief-cell-n", String(count)), el("span", "fc-debrief-cell-l", label));
          grid.append(cell);
        });
        debrief.append(eyebrow, hero, bar, grid, el("p", "fc-review-meta", statusText));
        footer.append(debrief);
      }
      function nextPractice() {
        if (content.signal.aborted) return;
        // Capture this presentation's cue so an overlapping stale control cannot
        // reveal consumed material or advance the shared queue a second time.
        const cs = reset(), index = practiceIndex, cue = practiceCards[index];
        if (!cue) {
          setProgress(1);
          footer.append(el("p", "fc-review-meta fc-practice-complete", "Practice complete."));
          return;
        }
        setProgress(practiceCards.length ? index / practiceCards.length : 0);
        const remaining = practiceCards.length - index - 1;
        const { answer, actions } = question(cue, cs, `${remaining} ${remaining === 1 ? 'card' : 'cards'} remaining`);
        let revealButton;
        revealAction = () => {
          if (revealed || cs.aborted || index !== practiceIndex) return;
          focusOwned(); revealed = true;
          stage.dataset.revealed = "true";
          setProgress(practiceCards.length ? (index + 0.5) / practiceCards.length : 1);
          title.textContent = cue.propositionName; title.hidden = false;
          markdown(answer, cue.answer, cs);
          revealButton.dispose(); actions.replaceChildren();
          advanceAction = () => {
            if (cs.aborted || !revealed || index !== practiceIndex) return;
            focusOwned(); practiceIndex++; nextPractice();
          };
          control(actions, "Next", () => advanceAction?.(), cs, "Space", { variant: "outline" });
        };
        revealButton = control(actions, "Reveal answer", () => revealAction?.(), cs, "Space", { variant: "outline" });
      }
      const retry = (parent, cs) => button(parent, "Retry next card", nextReview, cs);
      async function nextReview() {
        if (content.signal.aborted) return;
        const pending = reset();
        footer.append(el("p", "fc-review-meta fc-review-loading", "Loading next card…"));
        try {
          const result = await ctx.call("next-review", scope);
          if (pending.aborted) return;
          const cs = reset();
          if (!result.ticket) {
            setProgress(sessionReviewed > 0 ? 1 : 0);
            const statusText = result.nextDue ? `No cards ready. Next due ${new Date(result.nextDue).toLocaleString()}.` : "No cards due in this selection.";
            if (sessionReviewed > 0) renderDebrief(statusText);
            else footer.append(el("p", "fc-review-meta fc-review-empty", statusText));
            if (result.nextDue) {
              const arm = () => {
                if (cs.aborted) return;
                const delay = result.nextDue - Date.now();
                timer = setTimeout(() => { timer = null; if (cs.aborted) return; if (delay > 2147483647) arm(); else void nextReview(); }, Math.min(2147483647, Math.max(100, delay)));
              };
              arm();
            }
            return;
          }
          const ticket = result.ticket;
          if (typeof result.remaining === "number") {
            const totalNow = sessionReviewed + result.remaining;
            if (totalNow > sessionInitialTotal) sessionInitialTotal = totalNow;
            setProgress(sessionInitialTotal > 0 ? sessionReviewed / sessionInitialTotal : 0);
          }
          const { answer, actions, error } = question(ticket, cs, result.remaining === undefined ? undefined : `${result.remaining} ready`);
          let revealButton, retryButton, revealBusy = false, ratingBusy = false;
          const requests = new Map();
          const failed = cause => {
            if (cs.aborted) return;
            error.textContent = message(cause);
            if (!retryButton) retryButton = retry(footer, cs);
          };
          revealAction = async () => {
            if (revealBusy || revealed || cs.aborted) return;
            focusOwned();
            revealBusy = true; revealButton.update({ disabled: true });
            try {
              const result = await ctx.call("reveal-review", { ticketId: ticket.id });
              if (cs.aborted) return;
              revealed = true; error.textContent = "";
              stage.dataset.revealed = "true";
              title.textContent = ticket.propositionName; title.hidden = false;
              markdown(answer, result.answer, cs);
              focusOwned();
              revealButton.dispose(); actions.replaceChildren();
              actions.classList.add("fc-actions-ratings");
              const ratingButtons = [];
              rateAction = async rating => {
                if (ratingBusy || cs.aborted) return;
                focusOwned();
                ratingBusy = true;
                ratingButtons.forEach(handle => handle.update({ disabled: true }));
                if (!requests.has(rating)) requests.set(rating, crypto.randomUUID());
                let accepted = false;
                try {
                  // Do not cancel accepted work when the view closes. A transport
                  // retry of the same rating uses the exact same request identity.
                  await ctx.call("rate-review", { ticketId: ticket.id, rating, requestId: requests.get(rating) });
                  accepted = true;
                } catch (cause) {
                  failed(cause);
                  return;
                } finally {
                  ratingBusy = false;
                  if (!cs.aborted && !accepted) ratingButtons.forEach(handle => handle.update({ disabled: false }));
                }
                sessionReviewed++;
                if (rating >= 1 && rating <= 4) sessionRatings[rating - 1]++;
                pulseRatingFx(rating);
                // Refresh is independent of whether this surface still exists.
                try { void Promise.resolve(onRated?.()).catch(() => {}); } catch { /* A refresh cannot undo an accepted grade. */ }
                if (!cs.aborted) await nextReview();
              };
              ratings.forEach((label, index) => {
                const handle = control(actions, `${label} · ${interval(result.intervals[index + 1])}`, () => rateAction?.(index + 1), cs, String(index + 1), ratingOptions(label));
                const wrapper = actions.lastElementChild;
                if (wrapper) {
                  wrapper.dataset.rating = ratingKeys[index];
                  if (index === 2) wrapper.dataset.default = "true";
                }
                ratingButtons.push(handle);
              });
            } catch (cause) { failed(cause); }
            finally {
              revealBusy = false;
              if (!cs.aborted && !revealed) {
                revealButton.update({ disabled: false });
              }
            }
          };
          revealButton = control(actions, "Reveal answer", () => revealAction?.(), cs, "Space", { variant: "outline" });
        } catch (cause) {
          if (pending.aborted) return;
          const cs = reset();
          const error = el("p", "fc-error", message(cause)); error.setAttribute("role", "alert"); footer.append(error);
          retry(footer, cs);
        }
      }
      const keydown = event => {
        const target = event.target;
        if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || target?.closest?.("input,textarea,select,a,[contenteditable]:not([contenteditable=false])")) return;
        const space = event.code === "Space" || event.key === " ";
        // No Space chord may activate our scheduled rating controls, including
        // modified or repeated events. Editors and IME retain their own keys.
        if (!practice && revealed && space && target?.closest?.(".fc-rating")) { event.preventDefault(); return; }
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        // Unmodified scheduled Space reveals only, never rates.
        if (!practice && revealed && space) { event.preventDefault(); return; }
        if (event.repeat || target?.closest?.("button")) return;
        if (space) {
          event.preventDefault();
          if (!revealed) void revealAction?.();
          else if (practice) advanceAction?.();
        } else if (!practice && revealed && /^[1-4]$/.test(event.key)) {
          event.preventDefault(); void rateAction?.(Number(event.key));
        }
      };
      root.addEventListener("keydown", keydown);
      content.signal.addEventListener("abort", () => root.removeEventListener("keydown", keydown), { once: true });
      if (practice) nextPractice(); else void nextReview();
      return () => content.abort();
    };
    try {
      // Capture the active page now, never after awaiting a review RPC. Content
      // can mount either during this call or later; it owns starting the request.
      handle = ctx.ui.openSurface({ title: practice ? "Flashcard practice" : "Flashcard review", background: "dimmed", content: mount, onClose: close }, { signal: session.signal });
      if (closed) handle.dispose();
    } catch (cause) { close(); throw cause; }
  }
  return { open: scope => present(scope), openPractice: cards => present(undefined, cards), dispose };
}
