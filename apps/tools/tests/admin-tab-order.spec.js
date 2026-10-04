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
const tabs = [...nav.matchAll(/<button class="tab-btn[^"]*" data-tab="([a-z]+)">([^<]+)<\/button>/g)]
  .map((m) => ({ id: m[1], label: m[2] }));

test('the tabs read people, then what is hidden, then how it judges', () => {
  expect(tabs.map((t) => t.id)).toEqual(['passwords', 'profiles', 'pii', 'nonpii', 'alglab', 'expert', 'knowledge']);
});

test('no tab was added or lost, and the labels are the ones he knows', () => {
  expect(tabs.map((t) => t.label).sort()).toEqual(
    ['Algorithm Lab', 'Expert', 'Knowledge', 'Non-PII', 'PII', 'Passwords', 'Profiles'],
  );
});

test('Passwords is first and the only tab that starts active, so the page opens where it did', () => {
  expect(nav).toMatch(/<button class="tab-btn active" data-tab="passwords">/);
  expect((nav.match(/tab-btn active/g) || []).length).toBe(1);
  expect(page).toMatch(/<div id="tab-passwords" class="tab-panel active">/);
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
  expect(nav.includes('—')).toBe(false);
});
