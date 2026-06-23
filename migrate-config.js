/* ════════════════════════════════════════════════════════════════════
   migrate-config.js — shared config versioning + migration
   Device-local only. Never transmits. Never throws (a failed migration
   must never wipe a user's saved configuration).

   Usage (per game, early in boot, before loadSettings reads storage):
     NooutcoConfig.migrate();                    // baseline: stamp version
     NooutcoConfig.migrate([                      // future: ordered transforms
       { from: '0.1.0', to: '0.2.0', run: function () { ...rename keys... } }
     ]);

   The shared design tokens already gave each game `?? default` fallbacks, so
   *new* fields are absorbed automatically. Migrations here exist for the harder
   cases — renamed, removed, or restructured keys — so a version bump never
   silently drops or corrupts a saved config.
   ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var APP_VERSION = global.APP_VERSION || '0.1.0';
  var VERSION_KEY = 'nooutco:configVersion';

  function getStoredVersion() {
    try { return global.localStorage.getItem(VERSION_KEY); }
    catch (e) { return null; }
  }

  function stampVersion(v) {
    try { global.localStorage.setItem(VERSION_KEY, v); }
    catch (e) { /* storage unavailable — non-fatal */ }
  }

  /**
   * Run any migrations whose `from` matches the currently stored version,
   * walking forward to APP_VERSION, then stamp the new version.
   * @param {Array<{from:string,to:string,run:Function}>} [migrations]
   */
  function migrate(migrations) {
    var stored = getStoredVersion();
    if (stored === APP_VERSION) return;

    var steps = migrations || [];
    // Apply in declared order; each step decides relevance by its `from`.
    for (var i = 0; i < steps.length; i++) {
      var step = steps[i];
      if (stored && step.from && step.from !== stored) continue;
      try {
        step.run();
        stored = step.to || stored;
      } catch (e) {
        // Preserve existing config; abandon further migration this load.
        return;
      }
    }
    stampVersion(APP_VERSION);
  }

  global.NooutcoConfig = {
    APP_VERSION: APP_VERSION,
    VERSION_KEY: VERSION_KEY,
    storedVersion: getStoredVersion,
    migrate: migrate
  };
})(window);
