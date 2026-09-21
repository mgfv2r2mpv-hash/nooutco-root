/* Capture what the page writes to the clipboard, in every engine.
 *
 * DO NOT REACH FOR grantPermissions HERE. It throws outright on two of the
 * three engines we ship against:
 *
 *   firefox  Unknown permission: clipboard-read
 *   webkit   Unknown permission: clipboard-write
 *
 * That has already cost this suite twice. Two tests in changes-drawer.spec.js
 * failed in both engines from the day they landed and nobody saw it, because CI
 * was dying of its own accord at the time. Two more arrived with the author-aid
 * work and failed the same way on their first CI run against firefox and
 * webkit, having only ever been run on chromium by hand.
 *
 * Capturing the write keeps the assertion those tests exist for - what Copy
 * puts on the clipboard is what reaches the EHR - and it needs no permission at
 * all, so nothing can refuse it and no refusal can surface as a pageerror. The
 * page still takes its normal path: engine.jsx calls navigator.clipboard
 * .writeText and nothing else.
 *
 * Call it BEFORE page.goto, because it installs an init script.
 */
export const captureClipboard = (page) => page.addInitScript(() => {
  const written = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text) => { written.push(String(text)); return Promise.resolve(); },
      readText: () => Promise.resolve(written.length ? written[written.length - 1] : ''),
    },
  });
});
