import { test, expect } from '@playwright/test';
import { CPR_REFERENCES } from '../cpr/src/utils/references.ts';

// The About panel's Further Reading list. A review found two
// entries whose DOI resolved to a different paper from the one printed beside
// it. Each entry below is what its DOI resolves to on Crossref and PubMed,
// checked on 2026-10-09:
//   10.1002/jaba.958  Contreras, Tate, Morris & Kahng (2023), JABA 56(1), 146-165,
//                     PMID 36409837. The page printed "Contreras, Vargo & Rooker,
//                     Review of the conditional probability record in applied
//                     research, 56, 758-774", which no index holds.
//   10.1002/jaba.1045 Call, Bernstein, O'Brien et al. (2024), "A comparative
//                     effectiveness trial of functional behavioral assessment
//                     methods", JABA 57(1), 166-183. The page printed "Call,
//                     Pabico, Findley & Valentino, A systematic review of
//                     descriptive assessment methodology, 57, 288-313", which no
//                     index holds either; the review it describes is the Contreras
//                     one above, so the entry is dropped rather than repointed.

const byDoi = Object.fromEntries(CPR_REFERENCES.map((r) => [r.doi, r]));

test('jaba.958 is printed as the paper it resolves to', () => {
  const ref = byDoi['https://doi.org/10.1002/jaba.958'];
  expect(ref).toBeTruthy();
  expect(ref.authors).toBe('Contreras, B. P., Tate, S. A., Morris, S. L., & Kahng, S. (2023).');
  expect(ref.title).toBe('A systematic review of the correspondence between descriptive assessment and functional analysis.');
  expect(ref.journal).toBe('Journal of Applied Behavior Analysis, 56');
  expect(ref.pages).toBe('146-165.');
});

test('jaba.1045 and the review no index holds are gone', () => {
  expect(byDoi['https://doi.org/10.1002/jaba.1045']).toBeUndefined();
  const all = JSON.stringify(CPR_REFERENCES);
  expect(all).not.toContain('Pabico');
  expect(all).not.toContain('Vargo');
  expect(all).not.toContain('Review of the conditional probability record');
  expect(all).not.toContain('A systematic review of descriptive assessment methodology');
});

test('every entry has its own DOI link and pages that read as a range', () => {
  expect(new Set(CPR_REFERENCES.map((r) => r.doi)).size).toBe(CPR_REFERENCES.length);
  for (const r of CPR_REFERENCES) {
    expect(r.doi).toMatch(/^https:\/\/doi\.org\/10\.(1901|1002)\/jaba\./);
    expect(r.pages).toMatch(/^\d+-\d+\.$/);
    expect(r.authors).toMatch(/\(\d{4}\)\.$/);
  }
});

test('the About panel on the built page lists the corrected references', async ({ page }) => {
  await page.goto('/cpr/dist/');
  await page.getByRole('button', { name: /About the Conditional Probability Record/ }).click();
  const links = page.locator('a[href^="https://doi.org/"]');
  await expect(links).toHaveCount(CPR_REFERENCES.length);
  const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual(CPR_REFERENCES.map((r) => r.doi));
  await expect(page.getByText('A systematic review of the correspondence between descriptive assessment and functional analysis.', { exact: false })).toBeVisible();
  await expect(page.getByText('Pabico', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Vargo', { exact: false })).toHaveCount(0);
});
