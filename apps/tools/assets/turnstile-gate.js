/* turnstile-gate.js - Cloudflare Turnstile widget lifecycle for the admin logins.
 *
 * The worker enforces Turnstile on /api/login whenever TURNSTILE_SECRET is set
 * (see _worker.js handleLogin). A page that posts a password without a token
 * gets back "Verification failed. Please complete the challenge and retry." -
 * which reads as a rejected password even though the password was fine, and
 * points the clinician at a challenge that was never on screen.
 *
 * Both admin doors (the sign-in modal on / and the login card on /admin/) use
 * this helper so the widget behaves the same in each. The notes tools carry
 * their own equivalent inside notes-gate.js.
 *
 * Load it before the script that calls it:
 *   <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
 *   <script src="/assets/turnstile-gate.js"></script>
 */
(function () {
  "use strict";

  // Turnstile Site Keys are public - this is a client-side value and safe to commit.
  // It names the widget created for tools.nooutco.me. Set to "" to disable Turnstile
  // on these pages; the worker likewise skips verification unless TURNSTILE_SECRET
  // is set, so both sides must be configured for the check to be enforced.
  //
  // KEEP IN SYNC with TURNSTILE_SITEKEY in /assets/notes-gate.js - both name the
  // same Turnstile widget, and the two logins break differently if they drift.
  var SITEKEY = "0x4AAAAAADqSIXik1l5V3Nrd";

  // The api.js script is async/defer, so window.turnstile may not exist yet when a
  // modal opens. Poll briefly rather than racing it.
  var POLL_INTERVAL_MS = 200;
  var POLL_TRIES = 25; // 5s total

  var UNAVAILABLE_MSG =
    "The verification check could not load. Reload the page, and if it keeps " +
    "happening check that challenges.cloudflare.com is reachable.";

  function noop() {}

  /* Render a Turnstile widget into `container` and track its token.
   *
   * opts.onChange(hasToken)  - called whenever the token appears or clears, so the
   *                            caller can enable/disable its submit button.
   * opts.onUnavailable(msg)  - called once if the Turnstile script never loads.
   *
   * Returns a handle: { required, token(), reset() }. When Turnstile is disabled
   * (no site key) `required` is false, token() returns "" and onChange(true) fires
   * once so the caller's submit button is never left dead.
   */
  function mount(container, opts) {
    opts = opts || {};
    var onChange = opts.onChange || noop;
    var onUnavailable = opts.onUnavailable || noop;

    var token = "";
    var widgetId = null;

    if (!SITEKEY) {
      onChange(true); // nothing to complete - do not gate the caller's submit
      return { required: false, token: function () { return ""; }, reset: noop };
    }

    onChange(false); // hold submit until the challenge is solved

    (function render(triesLeft) {
      if (!window.turnstile || !window.turnstile.render) {
        if (triesLeft > 0) {
          setTimeout(function () { render(triesLeft - 1); }, POLL_INTERVAL_MS);
          return;
        }
        // Out of retries. Saying nothing here leaves a permanently dead submit
        // button and no reason for it, which reads as "I typed the wrong password".
        onUnavailable(UNAVAILABLE_MSG);
        return;
      }
      try {
        widgetId = window.turnstile.render(container, {
          sitekey: SITEKEY,
          callback: function (t) { token = t; onChange(true); },
          "expired-callback": function () { token = ""; onChange(false); },
          "error-callback": function () { token = ""; onChange(false); },
        });
      } catch (e) {
        onUnavailable(UNAVAILABLE_MSG);
      }
    })(POLL_TRIES);

    return {
      required: true,
      token: function () { return token; },
      // Turnstile tokens are single-use. Call this after a failed login so the
      // next attempt carries a fresh one instead of replaying a spent token.
      reset: function () {
        token = "";
        onChange(false);
        if (window.turnstile && widgetId !== null) {
          try { window.turnstile.reset(widgetId); } catch (e) {}
        }
      },
    };
  }

  window.TurnstileGate = { SITEKEY: SITEKEY, mount: mount };
})();
