import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// His ask, 2026-10-04, on the design review of the admin pages: "a lot of buttons
// there and the order is... random." The tabs were in the order they were built:
// Passwords, PII, Non-PII, Algorithm Lab, Expert, Knowledge, Profiles. He picked
// the reorder ("All; ribbon first and then calendar upgrades" covered the admin
// list too), which groups them by what they are for:
//
//   people          Passwords, Profiles
//   what is hidden  PII, Non-PII, Algorithm Lab
//   how it judges   Expert, Knowledge
//
// Only the order moved. Every tab keeps its id, its panel and its loader, so
// nothing that opens a tab by name changes. These tests read the page rather than
// open it, so they pin the markup and need no login or Worker.

const page = readFileSync(join(__dirname, '..', 'admin', 'index.html'), 'utf8');
const nav = page.slice(page.indexOf('<nav class="tab-nav">'), page.indexOf('</nav>', page.indexOf('<nav class="tab-nav">')));
const tabs = [...nav.matchAll(/<button class="tab-btn[^"]*" data-tab="([a-z]+)">([^<]+)(?:<span[^>]*>[^<]*<\/span>)?<\/button>/g)]
  .map((m) => ({ id: m[1], label: m[2] }));

test('the tabs read people, then what is hidden, then how it judges', () => {
  expect(tabs.map((t) => t.id)).toEqual(['review', 'passwords', 'profiles', 'pii', 'nonpii', 'alglab', 'expert', 'knowledge']);
});

test('only To review was added, and the labels are the ones he knows', () => {
  expect(tabs.map((t) => t.label).sort()).toEqual(
    ['Algorithm Lab', 'Expert', 'Knowledge', 'Non-PII', 'PII', 'Passwords', 'Profiles', 'To review'],
  );
});

// His ruling, 2026-10-04: "To review first." It is the landing tab, so the page
// opens on what is waiting for him, and its counts load at login.
test('To review is first and the only tab that starts active, so the page opens on it', () => {
  expect(nav).toMatch(/<button class="tab-btn active" data-tab="review">/);
  expect((nav.match(/tab-btn active/g) || []).length).toBe(1);
  expect(page).toContain('<div id="tab-review" class="tab-panel active">');
  expect((page.match(/class="tab-panel active"/g) || []).length).toBe(1);
});

test('every tab has a panel of its own, and every panel has a tab', () => {
  const panels = [...page.matchAll(/<div id="tab-([a-z]+)" class="tab-panel/g)].map((m) => m[1]).sort();
  expect(panels).toEqual(tabs.map((t) => t.id).sort());
});

test('Profiles and Knowledge still load when they are opened', () => {
  expect(page).toMatch(/btn\.dataset\.tab === "profiles"\) loadRoster\(\)/);
  expect(page).toMatch(/btn\.dataset\.tab === "knowledge"\) loadKnowledge\(\)/);
});

test('no em dash reached the nav', () => {
  expect(nav.includes('\u2014')).toBe(false);
});

// The To review inbox: one place that says what is waiting for him, with a count
// per queue and a button that opens the tab where the work is done. It reads the
// same endpoints the tabs already read and decides nothing itself.

test('To review is a tab with a panel, a badge, and a row for each queue', () => {
  expect(page).toContain('<div id="tab-review" class="tab-panel active">');
  expect(page).toContain('id="reviewBadge"');
  for (const queue of ['pii', 'nonpii', 'suggestions', 'knowledge']) {
    expect(page).toContain(`data-review="${queue}"`);
  }
});

test('each row opens the tab that owns the queue, and counts load on login and on open', () => {
  expect(page).toContain('function loadReview()');
  expect(page).toContain('function openTab(');
  expect(page).toContain('btn.dataset.tab === "review") loadReview()');
  expect(page).toContain('loadTermQueues(); loadAlgStatus(); loadKnowledgeCount();');
});

// The counts ride on the reads the tabs already make. The first cut fetched the
// term queue three times and the suggestions twice on every login to count them.
test('counting a queue never fetches it a second time', () => {
  expect(page.split('adminFetch("/api/admin/term-queue")')).toHaveLength(2);
  expect(page.split('adminFetch("/api/admin/scrub-suggestions")')).toHaveLength(2);
  for (const queue of ['pii', 'nonpii', 'suggestions', 'knowledge']) {
    expect(page).toContain(`setReviewCount("${queue}", null)`);
  }
});
