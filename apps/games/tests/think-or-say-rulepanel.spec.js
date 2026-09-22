// @ts-check
/**
 * Think or Say? - the Level 1 rule strip, compact.
 *
 * The strip states the rule for the whole Level 1 trial (think-or-say-review
 * pins that). On a 390px phone it used to stack one question per line and ran
 * to about 573px, pushing the card most of a screen down. These specs pin the
 * compact form without letting it change a word:
 *   * at 390x844 the strip is at most 330px tall (whole pills, never split mid-question, cost ~20px over the 307px split-pill layout) and causes no sideways scroll;
 *   * every question pill, and the always banner, carries the Why-ladder icon
 *     of the dimension it tests, derived from the branch's own `when.is`;
 *   * the words on screen are exactly the level data's words, in order.
 */
import { test, expect } from '@playwright/test';

const URL = '/think-or-say/';

async function startLevel1(page) {
  await page.goto(URL);
  await expect(page.locator('#sel-category option').first()).toHaveText('All categories');
  await page.locator('#sel-level').selectOption('1');
  await page.locator('#btn-play').click();
  await expect(page.locator('#rule-panel')).toBeVisible();
}

/** What the data says the strip should show, icons included. */
const expected = page => page.evaluate(() => {
  const rule = window.__thinkOrSay.level(1).rule;
  const WHY = window.ThinkOrSayModel.WHY;
  const iconOf = b => WHY[Object.keys(b.when.is)[0]].icon;
  return {
    title: rule.title,
    lead: rule.lead,
    tip: rule.tip,
    always: rule.always.test + ' ' + rule.always.note,
    alwaysIcon: iconOf(rule.always),
    think: rule.branches.filter(b => b.answer === 'think').map(b => ({ text: b.test, icon: iconOf(b) })),
    say: rule.branches.filter(b => b.answer === 'say').map(b => ({ text: b.test, icon: iconOf(b) })),
  };
});

/** What the strip actually shows, read the way a person sees it. */
const shown = page => page.evaluate(() => {
  const panel = document.getElementById('rule-panel');
  const pill = li => ({
    text: li.textContent,
    icon: li.dataset.icon || '',
    drawn: getComputedStyle(li, '::before').content,
  });
  const rows = Array.from(panel.querySelectorAll('.rule-row'));
  const rowOf = answer => rows.find(r => r.querySelector('.tag-' + answer));
  const always = panel.querySelector('.rule-always-text');
  return {
    title: document.getElementById('rule-title').textContent,
    lead: document.getElementById('rule-lead').textContent,
    tip: document.getElementById('rule-tip').textContent,
    always: always.textContent,
    alwaysIcon: always.dataset.icon || '',
    alwaysDrawn: getComputedStyle(always, '::before').content,
    think: Array.from(rowOf('think').querySelectorAll('.rule-list li')).map(pill),
    say: Array.from(rowOf('say').querySelectorAll('.rule-list li')).map(pill),
    height: panel.getBoundingClientRect().height,
    scrollW: document.documentElement.scrollWidth,
  };
});

test.describe('the Level 1 rule strip is compact and speaks the ladder', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('on a 390px phone the strip fits in 330px with no sideways scroll', async ({ page }) => {
    await startLevel1(page);
    const s = await shown(page);
    expect(s.height, 'the strip no longer stacks one question per line').toBeLessThanOrEqual(330);
    expect(s.scrollW, 'no horizontal page scroll').toBeLessThanOrEqual(390);
  });

  // Chromium and WebKit resolve a ::before `content: attr(data-icon)` to the
  // icon itself; Firefox reports the specified value, attr(data-icon), even
  // though it draws the icon. Either form means the pill draws its data-icon.
  const drawsIcon = (drawn, icon) => drawn.includes(icon) || /attr\(data-icon\)/.test(drawn);

  test('every pill carries the icon of the Why-ladder dimension it tests', async ({ page }) => {
    await startLevel1(page);
    const want = await expected(page);
    const s = await shown(page);
    for (const answer of ['think', 'say']) {
      expect(s[answer].length, `${answer} row renders every branch`).toBe(want[answer].length);
      s[answer].forEach((p, i) => {
        expect(p.icon, `"${p.text}" has its ladder icon`).toBe(want[answer][i].icon);
        expect(drawsIcon(p.drawn, want[answer][i].icon), `"${p.text}" draws its icon`).toBe(true);
      });
    }
    expect(s.alwaysIcon, 'the always banner carries the override icon').toBe(want.alwaysIcon);
    expect(drawsIcon(s.alwaysDrawn, want.alwaysIcon)).toBe(true);
  });

  test('the words on screen are exactly the level data, unchanged', async ({ page }) => {
    await startLevel1(page);
    const want = await expected(page);
    const s = await shown(page);
    expect(s.title).toBe(want.title);
    expect(s.lead).toBe(want.lead);
    expect(s.tip).toBe(want.tip);
    expect(s.always).toBe(want.always);
    expect(s.think.map(p => p.text)).toEqual(want.think.map(p => p.text));
    expect(s.say.map(p => p.text)).toEqual(want.say.map(p => p.text));
  });
});
