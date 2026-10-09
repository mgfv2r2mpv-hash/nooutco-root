// The Further Reading list on the About panel.
//
// Every entry is checked against its DOI on Crossref and PubMed before it goes
// in: authors, year, title, volume, issue and pages are the ones the DOI
// resolves to. `tests/cpr-references.spec.js` pins each one, because a review
// found two entries whose DOI pointed at a different paper from
// the authors and title printed beside it.

export interface CprReference {
  authors: string;
  title: string;
  journal: string;
  pages: string;
  doi: string;
}

export const CPR_REFERENCES: readonly CprReference[] = [
  {
    authors: 'Anderson, C. M., & Long, E. S. (2002).',
    title: 'Use of a structured descriptive assessment methodology to identify variables affecting problem behavior.',
    journal: 'Journal of Applied Behavior Analysis, 35',
    pages: '137-154.',
    doi: 'https://doi.org/10.1901/jaba.2002.35-137',
  },
  {
    authors: 'Camp, E. M., Iwata, B. A., Hammond, J. L., & Bloom, S. E. (2009).',
    title: 'Antecedent versus consequent events as predictors of problem behavior.',
    journal: 'Journal of Applied Behavior Analysis, 42',
    pages: '469-483.',
    doi: 'https://doi.org/10.1901/jaba.2009.42-469',
  },
  {
    authors: 'Contreras, B. P., Tate, S. A., Morris, S. L., & Kahng, S. (2023).',
    title: 'A systematic review of the correspondence between descriptive assessment and functional analysis.',
    journal: 'Journal of Applied Behavior Analysis, 56',
    pages: '146-165.',
    doi: 'https://doi.org/10.1002/jaba.958',
  },
  {
    authors: 'Vollmer, T. R., Borrero, J. C., Wright, C. S., Van Camp, C., & Lalli, J. S. (2001).',
    title: 'Identifying possible contingencies during descriptive analyses of severe behavior disorders.',
    journal: 'Journal of Applied Behavior Analysis, 34',
    pages: '269-287.',
    doi: 'https://doi.org/10.1901/jaba.2001.34-269',
  },
];
