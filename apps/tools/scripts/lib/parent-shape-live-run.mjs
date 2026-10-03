/* The browser half of the live parent note test. It never runs from here:
 * scripts/build-parent-shape-live.mjs writes this function's source into
 * scripts/parent-shape-live.js with the fixture's cases and the checker beside
 * it, and Kaleb pastes that file into the console on the parent tool page.
 *
 * It drafts each case the way engine.jsx draftNote does: the same scrub
 * (without ticking the screen list's note counter), the same user prompt, his
 * style card, his voice block and a sentence shape target, through the same
 * NotesGate.generateConversation call, then engine.jsx finalize's steps in its
 * order (restore, hollow hints, normalizeOutput, absence strip, recast).
 *
 * It skips selfRevise. That pass rewrites rhythm only, under "change nothing
 * about the clinical content", so the checks here read the same facts either
 * way, and its thresholds live inside the engine where a console cannot reach
 * them. Answers go out in #229's Q:/A: form, the form the plan targets.
 *
 * Kept free of imports and of anything outside the page, because its source is
 * pasted as is. */
export async function runParentShapeLive(CASES, checkParentDraft) {
  const tool = (window.NOTE_TOOLS || []).find((t) => t.id === 'parent');
  if (!tool) throw new Error('Open the BCBA notes page with Parent Training loaded first.');
  if (!window.NotesGate || !window.NotesGate.isLoggedIn()) throw new Error('Log in first.');
  const gate = window.NotesGate;
  const HEADER = '\n\nTHE TECHNICIAN ADDED, ANSWERING FOLLOW-UP QUESTIONS (each A: answers the Q: above it, so write it where that question points; treat as part of the notes above):\n';
  const keys = tool.formSections.filter((s) => s.kind !== 'facts').map((s) => s.key || s.group);
  const narrative = tool.formSections.filter((s) => s.kind === 'narrative').map((s) => s.key || s.group);
  const card = gate.styleCard ? await gate.styleCard.get().catch(() => null) : null;
  const styleBlock = (card && card.block) || '';

  const finalize = (parsed, map) => {
    const restored = window.NotesScrub.restoreOutput(parsed, map);
    const hollow = window.NoteHollow;
    const misplaced = hollow && tool.strategyOwnership ? hollow.misplaced(restored, tool.strategyOwnership) : [];
    const gaps = hollow && hollow.effectUnstated && tool.strategyOwnership ? hollow.effectUnstated(restored, tool.strategyOwnership) : [];
    const injected = misplaced.concat(gaps);
    const withHints = injected.length
      ? { ...restored, hints: (Array.isArray(restored.hints) ? restored.hints : []).concat(injected) }
      : restored;
    const normalized = tool.normalizeOutput(withHints);
    const stripped = window.NoteAbsence ? window.NoteAbsence.scrubNote(normalized).output : normalized;
    return hollow ? hollow.passNote(stripped, narrative).output : stripped;
  };

  const draftCase = async (c) => {
    const answers = (c.answers || []).map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n');
    const rev = await window.NotesScrub.review({ freeText: `${c.intake}\n${answers}`, seen: [], newNote: false });
    const scrub = (s) => window.NotesScrub.applyMap(String(s || ''), rev.map);
    const extra = scrub(answers).trim();
    const userMsg = tool.buildUserPrompt({ sessionNotes: scrub(c.intake) }) + (extra ? HEADER + extra : '');
    const shaped = gate.styleCard
      ? await gate.styleCard.get({ tool: tool.id, seed: `${tool.id}:shape-live:${c.id}:${Date.now()}` }).catch(() => null)
      : null;
    const voiceBlock = window.IntakeVoice ? window.IntakeVoice.block(`${scrub(c.intake)}${extra ? `\n${extra}` : ''}`) : '';
    const block = styleBlock + voiceBlock + ((shaped && shaped.shapeBlock) || '');
    const r = await gate.generateConversation({
      ...(tool.draftKind ? { promptKind: tool.draftKind } : {}),
      systemSuffix: block,
      messages: [{ role: 'user', content: userMsg }],
      tool: tool.id,
      maxTokens: tool.maxTokens || 3000,
      expectKeys: keys,
      responseSchema: tool.responseSchema || null,
    });
    if (!r || !r.parsed) throw new Error('the draft came back without a note');
    return { draft: finalize(r.parsed, rev.map), voice: Boolean(styleBlock || voiceBlock) };
  };

  const results = [];
  const drafts = {};
  for (const c of CASES) {
    try {
      const { draft, voice } = await draftCase(c);
      drafts[c.id] = draft;
      const fails = checkParentDraft(c, draft);
      results.push({ case: c.id, pass: fails.length === 0, voice, fails: fails.join(' | ') || '-' });
    } catch (err) {
      results.push({ case: c.id, pass: false, voice: Boolean(styleBlock), fails: `draft failed: ${err && err.message}` });
    }
  }

  console.table(results);
  const report = { at: new Date().toISOString(), styleCard: Boolean(styleBlock), results, drafts };
  const json = JSON.stringify(report, null, 2);
  try {
    copy(json);
    console.log('The results and the four drafts are on your clipboard.');
  } catch (e) {
    console.log(json);
  }
  return report;
}
