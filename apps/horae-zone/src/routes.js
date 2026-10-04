/**
 * The Horae Zone route table (plan §3.6). Each route names its checks, run
 * before any handler:
 *   open    - a POST of a JSON object; the handler owns everything else
 *             (sign-up, sign-in and links a device follows before it has a key)
 *   device  - also a registered, not removed device id
 *   signed  - also a device signature over a fresh single-use nonce
 *   admin   - signed, and the device's account holds the admin role
 *   signable - open, but a request that names a device (x-hz-device) passes
 *             every signed check, and the handler gets that device; a bad
 *             signature is refused, never treated as unsigned
 * A route with no handler answers not-built, only after its checks pass.
 * pendingOk marks the routes a pending device (an account has a code the
 * device has not proved yet, A5) may reach; every other route refuses it.
 */
import { issueNonce } from "./checks.js";
import { startSignup, verifySignup } from "./signup.js";
import { signIn } from "./signin.js";
import { registerDevice, removeDevice } from "./devices.js";
import { enrolOtp } from "./otp.js";
import { startUnlock, finishUnlock, reopenUnlock } from "./unlock.js";

export const ROUTES = Object.freeze({
  "/account": { checks: "open", handler: startSignup },
  "/account/email/verify": { checks: "open", handler: verifySignup },
  // Signed by a registered device of the account, a sign-in skips the
  // per-address bucket (security review H2).
  "/signin": { checks: "signable", handler: signIn },
  // A device has no key registered yet, so it cannot sign: the handler
  // requires the single-use ticket /signin handed out instead.
  "/device/register": { checks: "open", handler: registerDevice },
  "/device/remove": { checks: "signed", handler: removeDevice },
  "/nonce": { checks: "device", handler: issueNonce, pendingOk: true },
  "/otp/enrol": { checks: "signed", handler: enrolOtp },
  "/unlock/start": { checks: "signed", handler: startUnlock, pendingOk: true },
  "/unlock/finish": { checks: "signed", handler: finishUnlock, pendingOk: true },
  // The emailed link, opened before any device can sign for it.
  "/unlock/reopen": { checks: "open", handler: reopenUnlock },
  "/pin/verify": { checks: "signed" },
  "/pin/set": { checks: "signed" },
  "/pin/reset": { checks: "signed" },
  "/pin/review": { checks: "signed" },
  "/reverify": { checks: "signed" },
  "/pair/offer": { checks: "signed" },
  "/pair/take": { checks: "signed" },
  "/recover": { checks: "open" },
  "/vault/switch": { checks: "signed" },
  "/admin/unlock-pins": { checks: "admin" },
  "/admin/unlock-account": { checks: "admin" },
});
