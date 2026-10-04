/**
 * The Horae Zone route table (plan §3.6). Each route names its checks, run
 * before any handler:
 *   open    - a POST of a JSON object; the handler owns everything else
 *             (sign-up, sign-in and links a device follows before it has a key)
 *   device  - also a registered, not removed device id
 *   signed  - also a device signature over a fresh single-use nonce
 *   admin   - signed, and the device's account holds the admin role
 * A route with no handler answers not-built, only after its checks pass.
 */
import { issueNonce } from "./checks.js";
import { startSignup, verifySignup } from "./signup.js";
import { signIn } from "./signin.js";
import { registerDevice, removeDevice } from "./devices.js";

export const ROUTES = Object.freeze({
  "/account": { checks: "open", handler: startSignup },
  "/account/email/verify": { checks: "open", handler: verifySignup },
  "/signin": { checks: "open", handler: signIn },
  // A device has no key registered yet, so it cannot sign: the handler
  // requires the single-use ticket /signin handed out instead.
  "/device/register": { checks: "open", handler: registerDevice },
  "/device/remove": { checks: "signed", handler: removeDevice },
  "/nonce": { checks: "device", handler: issueNonce },
  "/otp/enrol": { checks: "signed" },
  "/unlock/start": { checks: "signed" },
  "/unlock/finish": { checks: "signed" },
  "/unlock/reopen": { checks: "open" },
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
