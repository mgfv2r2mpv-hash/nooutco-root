import { test, expect } from '@playwright/test';

// The whole exchange has to stay reachable.
//
// The panel body was a flex column with `justify-content: flex-end` and
// `overflow-y: auto`. That combination puts content overflowing the TOP outside
// the scrollable range: it is rendered, it is clipped, and no amount of
// scrolling gets to it. So a long conversation kept growing downward and the
// earliest turns became permanently unreadable, which is what he reported.
//
// The fix is an auto top margin on the first child instead. Same look, whole
// history in reach. These tests fail against the old rule.

function tokenFor() {
  const payload = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.not-a-real-signature`;
}

// Put a long exchange in the panel directly. Driving 30 real revisions through
// the model would test the mock, not the scrolling.
async function openWithHistory(page, turns) {
  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.reload();
  await page.waitForSelector('#root h1', { timeout: 45000 });
  await page.locator('.revision-fab').click();
  await expect(page.locator('.revision-panel')).toBeVisible();

  await page.evaluate((n) => {
    const body = document.querySelector('.revision-panel-body');
    body.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;justify-content:flex-start;margin-bottom:8px';
      const b = document.createElement('div');
      b.setAttribute('data-turn', String(i));
      b.textContent = `turn ${i} ` + 'x'.repeat(60);
      b.style.cssText = 'max-width:88%;padding:8px 11px;border-radius:10px;background:white;border:1px solid #ddecd0';
      wrap.appendChild(b);
      body.appendChild(wrap);
    }
  }, turns);
}

test('a long exchange overflows and can be scrolled', async ({ page }) => {
  await openWithHistory(page, 40);

  const m = await page.evaluate(() => {
    const b = document.querySelector('.revision-panel-body');
    return { scrollH: b.scrollHeight, clientH: b.clientHeight, top: b.scrollTop };
  });
  expect(m.scrollH, 'the exchange must actually overflow for this to mean anything')
    .toBeGreaterThan(m.clientH + 50);
});

test('the earliest turn is reachable, not clipped above the scroll range', async ({ page }) => {
  await openWithHistory(page, 40);

  // Scroll to the very top and check the first turn is really on screen. Under
  // the old rule scrollTop could not move above 0 while content sat above it,
  // so turn 0 was rendered at a negative offset and unreachable.
  const first = page.locator('[data-turn="0"]');
  await page.evaluate(() => { document.querySelector('.revision-panel-body').scrollTop = 0; });

  const inView = await first.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const body = document.querySelector('.revision-panel-body').getBoundingClientRect();
    return box.top >= body.top - 1 && box.bottom <= body.bottom + 1;
  });
  expect(inView, 'the first turn must be visible after scrolling to the top').toBe(true);
});

test('nothing sits above the scroll range', async ({ page }) => {
  await openWithHistory(page, 40);

  // The direct measurement of the bug: with justify-content flex-end, the first
  // child's offsetTop goes negative relative to the scroller's content box.
  const offset = await page.evaluate(() => {
    const b = document.querySelector('.revision-panel-body');
    return b.firstElementChild.offsetTop - b.offsetTop;
  });
  expect(offset, 'content above offsetTop 0 cannot be scrolled to').toBeGreaterThanOrEqual(0);
});

test('a short exchange still sits at the bottom', async ({ page }) => {
  // The reason flex-end was there in the first place: two lines anchored to the
  // top left a tall blank column that read as broken. That must not regress.
  await openWithHistory(page, 2);

  const gap = await page.evaluate(() => {
    const b = document.querySelector('.revision-panel-body');
    const last = b.lastElementChild.getBoundingClientRect();
    return b.getBoundingClientRect().bottom - last.bottom;
  });
  expect(gap, 'a short exchange should hug the composer, not float at the top')
    .toBeLessThan(40);
});
