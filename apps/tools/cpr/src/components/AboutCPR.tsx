import { useState } from 'react';

const REFS = [
  { authors: 'Anderson, C. M., & Long, E. S. (2002).', title: 'Use of a structured descriptive assessment methodology to identify variables affecting problem behavior.', journal: 'Journal of Applied Behavior Analysis, 35', pages: '137–154.', doi: 'https://doi.org/10.1901/jaba.2002.35-137' },
  { authors: 'Call, N. A., Pabico, R. S., Findley, A. J., & Valentino, A. L. (2024).', title: 'A systematic review of descriptive assessment methodology.', journal: 'Journal of Applied Behavior Analysis, 57', pages: '288–313.', doi: 'https://doi.org/10.1002/jaba.1045' },
  { authors: 'Camp, E. M., Iwata, B. A., Hammond, J. L., & Bloom, S. E. (2009).', title: 'Antecedent versus consequent events as predictors of problem behavior.', journal: 'Journal of Applied Behavior Analysis, 42', pages: '469–483.', doi: 'https://doi.org/10.1901/jaba.2009.42-469' },
  { authors: 'Contreras, B. P., Vargo, K. K., & Rooker, G. W. (2023).', title: 'Review of the conditional probability record in applied research.', journal: 'Journal of Applied Behavior Analysis, 56', pages: '758–774.', doi: 'https://doi.org/10.1002/jaba.958' },
  { authors: 'Vollmer, T. R., Borrero, J. C., Wright, C. S., Van Camp, C., & Lalli, J. S. (2001).', title: 'Identifying possible contingencies during descriptive analyses of severe behavior disorders.', journal: 'Journal of Applied Behavior Analysis, 34', pages: '269–287.', doi: 'https://doi.org/10.1901/jaba.2001.34-269' },
] as const;

export function AboutCPR() {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 bg-gray-50 dark:bg-gray-800/50
          hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
      >
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          About the Conditional Probability Record (CPR)
        </span>
        <span className="text-gray-400 dark:text-gray-500 text-xs">{open ? '▲ Hide' : '▼ Show'}</span>
      </button>
      {open && (
        <div className="px-5 py-4 space-y-4 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900">

          <div>
            <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">What is the CPR?</h3>
            <p>
              The Conditional Probability Record is a descriptive assessment tool for analyzing the relationship
              between behavior and its environmental context using interval recording. For each observation interval,
              the observer codes whether the target behavior occurred, whether motivating conditions (EOs) were present,
              and which consequences naturally followed the behavior. Conditional probabilities are then computed to
              identify potential behavioral functions.
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Originally described by Vollmer et al. (2001) for consequence analysis; extended by Camp et al. (2009)
              to include antecedent (EO) analysis and Lag-1 scoring.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-blue-100 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-950/20 p-3">
              <h4 className="font-semibold text-blue-800 dark:text-blue-300 mb-1">Consequence Analysis</h4>
              <p className="text-xs">
                Computes <strong>P(Bx|C+)</strong> (how often behavior occurs when a consequence is observed to
                naturally follow) versus <strong>P(Bx|C−)</strong> when it is absent. The Contingency Value
                (CV = P(Bx|C+) − P(Bx|C−)) reflects the strength of the behavior–consequence relationship for each
                functional category (attention, tangible, escape, sensory).
              </p>
            </div>
            <div className="rounded-lg border border-orange-100 dark:border-orange-900/40 bg-orange-50 dark:bg-orange-950/20 p-3">
              <h4 className="font-semibold text-orange-700 dark:text-orange-300 mb-1">Antecedent Analysis</h4>
              <p className="text-xs">
                Computes <strong>P(Bx|A+)</strong> (how often behavior occurs when the Establishing Operation (EO)
                is active) versus <strong>P(Bx|A−)</strong> when it is absent. The Antecedent CV
                (ACV = P(Bx|A+) − P(Bx|A−)) reflects whether the EO evokes the behavior, providing convergent
                evidence alongside consequence data.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-green-100 dark:border-green-900/40 bg-green-50 dark:bg-green-950/20 p-3">
              <h4 className="font-semibold text-green-800 dark:text-green-300 mb-1">✓ Clinical Benefits</h4>
              <ul className="text-xs space-y-1 list-disc list-inside text-gray-700 dark:text-gray-300">
                <li>Non-intrusive: conducted in natural environments without manipulation</li>
                <li>Can identify multiple co-occurring functions simultaneously</li>
                <li>Antecedent CV reveals EO-driven stimulus control</li>
                <li>Lag-1 scoring reduces artifacts of interval boundary effects</li>
                <li>Synthesized conditions capture naturalistic consequence mixtures</li>
                <li>Low observer burden relative to experimental functional analysis</li>
              </ul>
            </div>
            <div className="rounded-lg border border-red-100 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 p-3">
              <h4 className="font-semibold text-red-700 dark:text-red-300 mb-1">⚠ Limitations</h4>
              <ul className="text-xs space-y-1 list-disc list-inside text-gray-700 dark:text-gray-300">
                <li>Descriptive only: cannot establish experimental control or prove causality</li>
                <li>Results may reflect correlations, not functional relationships</li>
                <li>Low-rate behavior yields small cell counts and unstable probability estimates</li>
                <li>Observer bias and inconsistent interval timing reduce reliability</li>
                <li>Should be confirmed with functional analysis (FA) before treatment design</li>
                <li>Co-varying conditions may produce spurious CVs</li>
              </ul>
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-1.5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Further Reading</p>
            <ul className="text-xs space-y-1">
              {REFS.map(ref => (
                <li key={ref.doi} className="text-gray-500 dark:text-gray-400">
                  {ref.authors} {ref.title} <em>{ref.journal}</em>, {ref.pages}{' '}
                  <a href={ref.doi} target="_blank" rel="noreferrer"
                    className="text-indigo-500 dark:text-indigo-400 underline hover:text-indigo-700 dark:hover:text-indigo-300 whitespace-nowrap">
                    doi ↗
                  </a>
                </li>
              ))}
            </ul>
          </div>

        </div>
      )}
    </section>
  );
}
