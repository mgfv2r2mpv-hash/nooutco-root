import { test, expect } from '@playwright/test';

/* The corrections pass, as marks and as the text they add up to.
 *
 * NoteDiff already knows that a sentence which left one section and arrived in
 * another was moved. What is tested here is the layer above it: which marks
 * exist, which two of them are one move, and - the part that decides what the
 * technician actually copies - what each section reads like given a set of
 * decisions.
 *
 * The default is accepted, so the first assertion in almost every case below is
 * that doing nothing ships the corrected note. That is his ruling and it is the
 * one behaviour a regression here would make invisible: an undone-by-default
 * pass looks identical on screen and ships a different note.
 */

const BT_PAGE = '/notes/bt/index.html';

const ready = async (page) => {
  await page.goto(BT_PAGE);
  await page.waitForFunction(() => !!window.NoteCorrections && !!window.NoteDiff);
};

const build = (page, before, corrections) =>
  page.evaluate(
    ([b, c]) => {
      const built = window.NoteCorrections.build({ before: b, corrections: c });
      return {
        count: built.count,
        changed: built.changed,
        types: built.marks.map((m) => m.type),
        moveIds: built.marks.map((m) => m.moveId),
        accepted: window.NoteCorrections.outputFor(built.sections, {}),
        marks: built.marks.map((m) => ({ key: m.key, type: m.type, text: m.text, from: m.from, to: m.to })),
      };
    },
    [before, corrections],
  );

const foldWith = (page, before, corrections, keys) =>
  page.evaluate(
    ([b, c, ks]) => {
      const built = window.NoteCorrections.build({ before: b, corrections: c });
      let state = {};
      ks.forEach((k) => { state = window.NoteCorrections.toggle(built.sections, state, k); });
      return {
        text: window.NoteCorrections.outputFor(built.sections, state),
        state: Object.keys(state).map((k) => k + '=' + (state[k].reverted ? 'undone' : 'kept')).sort(),
      };
    },
    [before, corrections, keys],
  );

test.describe('an added clause', () => {
  const before = { a: 'Staff redirected neutrally to the functional communication response.' };
  const after = [{
    section: 'a',
    text: 'Staff redirected neutrally to the functional communication response. Episodes ended within about a minute once the alternative was reinforced.',
    why: 'You wrote that episodes shortened once the alternative was reinforced.',
  }];

  test('is in the note before anyone clicks anything', async ({ page }) => {
    await ready(page);
    const r = await build(page, before, after);
    expect(r.types).toEqual(['ins']);
    expect(r.accepted.a).toBe(after[0].text);
  });

  test('undoing it puts the draft back exactly', async ({ page }) => {
    await ready(page);
    const built = await build(page, before, after);
    const r = await foldWith(page, before, after, [built.marks[0].key]);
    expect(r.text.a).toBe(before.a);
  });

  test('the reason the pass gave rides along with the mark', async ({ page }) => {
    await ready(page);
    const r = await build(page, before, after);
    const why = await page.evaluate(
      ([b, c]) => window.NoteCorrections.build({ before: b, corrections: c }).marks[0].why,
      [before, after],
    );
    expect(why).toContain('episodes shortened');
    expect(r.count).toBe(1);
  });
});

test.describe('a removed restatement', () => {
  const before = { a: 'Aggression occurred 2 times. Aggression was shorter than in recent sessions.' };
  const after = [{ section: 'a', text: 'Aggression was shorter than in recent sessions.', why: 'The form already carries the count.' }];

  test('is out of the note by default, and undoing it brings it back', async ({ page }) => {
    await ready(page);
    const built = await build(page, before, after);
    expect(built.types).toEqual(['del']);
    expect(built.accepted.a).toBe('Aggression was shorter than in recent sessions.');

    const undone = await foldWith(page, before, after, [built.marks[0].key]);
    expect(undone.text.a).toBe(before.a);
  });
});

test.describe('a moved sentence', () => {
  // The whole reason the diff was taught about moves: the technician wrote this
  // sentence, and showing it as lost at one end and new at the other says they
  // did not.
  const MOVED = 'Client engaged in screaming and staff redirected neutrally to the functional communication response.';
  const before = {
    a: 'Gave a two minute warning before each transition. ' + MOVED,
    b: 'Aggression was shorter and less intense than in recent sessions.',
  };
  const after = [
    { section: 'a', text: 'Gave a two minute warning before each transition.', why: 'A response strategy is misfiled under antecedent.' },
    { section: 'b', text: 'Aggression was shorter and less intense than in recent sessions. ' + MOVED, why: 'It belongs with behaviour plan progress.' },
  ];

  test('is drawn at both ends and the two ends share one move', async ({ page }) => {
    await ready(page);
    const r = await build(page, before, after);
    expect(r.types.sort()).toEqual(['move-in', 'move-out']);
    const ids = r.moveIds.filter(Boolean);
    expect(ids.length).toBe(2);
    expect(ids[0]).toBe(ids[1]);
  });

  test('the destination knows which section it came from', async ({ page }) => {
    await ready(page);
    const r = await build(page, before, after);
    const dest = r.marks.find((m) => m.type === 'move-in');
    expect(dest.from).toBe('a');
    expect(r.marks.find((m) => m.type === 'move-out').to).toBe('b');
  });

  test('accepted, the sentence is in exactly one place', async ({ page }) => {
    await ready(page);
    const r = await build(page, before, after);
    expect(r.accepted.a).not.toContain('screaming');
    expect(r.accepted.b).toContain('screaming');
  });

  test('UNDOING EITHER END UNDOES BOTH, so the sentence is never in two places or in none', async ({ page }) => {
    await ready(page);
    const built = await build(page, before, after);
    for (const type of ['move-in', 'move-out']) {
      const key = built.marks.find((m) => m.type === type).key;
      const r = await foldWith(page, before, after, [key]);
      expect(r.text.a, `undoing the ${type} end left the origin wrong`).toContain('screaming');
      expect(r.text.b, `undoing the ${type} end left the destination wrong`).not.toContain('screaming');
      expect(r.state.every((s) => s.endsWith('undone'))).toBe(true);
    }
  });
});

test.describe('what the module refuses to do', () => {
  test('a section the pass did not name grows no marks and keeps its draft', async ({ page }) => {
    await ready(page);
    const r = await build(page, { a: 'one', b: 'two' }, [{ section: 'a', text: 'one changed', why: '' }]);
    expect(r.changed).toEqual(['a']);
    expect(r.accepted.b).toBeUndefined();
  });

  test('a correction for a section that is not in the draft is ignored', async ({ page }) => {
    // The Worker drops these too. Both layers, because either one alone would
    // let a mark render in a section the other has no text for.
    await ready(page);
    const r = await build(page, { a: 'one' }, [{ section: 'ghost', text: 'x', why: '' }]);
    expect(r.count).toBe(0);
  });

  test('an empty corrections list is a no-op, not an empty note', async ({ page }) => {
    await ready(page);
    const r = await build(page, { a: 'one' }, []);
    expect(r.count).toBe(0);
    expect(r.accepted).toEqual({});
  });

  test('the space a removed sentence leaves behind does not survive into the note', async ({ page }) => {
    await ready(page);
    const r = await build(
      page,
      { a: 'First sentence here. Second sentence here. Third sentence here.' },
      [{ section: 'a', text: 'First sentence here. Third sentence here.', why: '' }],
    );
    expect(r.accepted.a).toBe('First sentence here. Third sentence here.');
    expect(r.accepted.a).not.toMatch(/ {2}/);
  });

  test('editing a mark changes what ships without changing whether it ships', async ({ page }) => {
    await ready(page);
    const before = { a: 'Staff redirected neutrally.' };
    const after = [{ section: 'a', text: 'Staff redirected neutrally. Episodes ended within a minute.', why: '' }];
    const r = await page.evaluate(
      ([b, c]) => {
        const built = window.NoteCorrections.build({ before: b, corrections: c });
        const key = built.marks[0].key;
        const state = window.NoteCorrections.edit({}, key, ' Episodes ended quickly.');
        return {
          text: window.NoteCorrections.outputFor(built.sections, state).a,
          reverted: !!state[key].reverted,
        };
      },
      [before, after],
    );
    expect(r.text).toBe('Staff redirected neutrally. Episodes ended quickly.');
    expect(r.reverted).toBe(false);
  });
});
