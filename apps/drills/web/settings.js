/* Settings (Command-comma), and the expert's review queue inside it.
 *
 * His ask of 2026-09-25: review what Send to the expert proposed without
 * leaving the app for the admin page. The queue is the admin page's Knowledge
 * tab, read through the same route: each staged proposal in full, with
 * "Put it in force" and "Reject". Each asks once more before it acts, and
 * nothing is decided without his click.
 *
 * Everything is built with textContent: a proposal's text is data, never markup.
 */

const CONFIRM_MS = 4000;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** A button that needs a second click within a few seconds to act. */
function confirmButton(label, confirmLabel, cls, onConfirm) {
  const b = el("button", cls, label);
  b.type = "button";
  let armed = 0;
  b.addEventListener("click", () => {
    if (b.disabled) return;
    if (!armed) {
      b.textContent = confirmLabel;
      b.classList.add("is-armed");
      armed = setTimeout(() => { armed = 0; b.textContent = label; b.classList.remove("is-armed"); }, CONFIRM_MS);
      return;
    }
    clearTimeout(armed);
    armed = 0;
    b.disabled = true;
    onConfirm();
  });
  return b;
}

/**
 * Draw the staged proposals. onDecide(proposalId, "commit" | "reject") returns
 * a promise of { ok, note }; the card goes once the site agrees.
 */
export function renderProposals(list, proposals, onDecide) {
  const rows = Array.isArray(proposals) ? proposals : [];
  if (!rows.length) {
    list.replaceChildren(el("p", "basis", "None pending."));
    return;
  }
  list.replaceChildren(...rows.map((p) => {
    const card = el("article", "proposal");
    card.dataset.proposal = String(p.proposalId || "");
    const head = el("div", "proposal-head");
    head.append(el("b", null, p.title || "(untitled)"));
    if (p.topic) head.append(el("span", "pill", p.topic));
    if (p.tier) head.append(el("span", "pill", p.tier));
    card.append(head);
    if (p.applies) card.append(el("p", "proposal-applies", "Fetched " + p.applies));
    card.append(el("p", "proposal-rule", p.rule || ""));
    if (p.rationale) card.append(el("p", "proposal-why", "Why: " + p.rationale));
    const sources = p.provenance && Array.isArray(p.provenance.sources) ? p.provenance.sources.filter(Boolean) : [];
    if (sources.length) card.append(el("p", "proposal-src", "Sources: " + sources.join("; ")));
    if (p.targetId) card.append(el("p", "proposal-src", "Replaces " + p.targetId));
    const note = el("span", "keepnote");
    const decide = (decision) => onDecide(p.proposalId, decision).then((r) => {
      if (r && r.ok) {
        card.classList.add("is-done");
        note.textContent = decision === "commit" ? "Accepted." : "Rejected.";
        setTimeout(() => card.remove(), 900);
      } else {
        note.textContent = (r && r.note) || "Not saved.";
        actions.querySelectorAll("button").forEach((b) => { b.disabled = false; });
      }
    });
    const actions = el("div", "row proposal-actions");
    actions.append(
      confirmButton("Accept", "Confirm accept", "go", () => decide("commit")),
      confirmButton("Reject", "Confirm reject", "soft", () => decide("reject")),
      note,
    );
    card.append(actions);
    return card;
  }));
}
