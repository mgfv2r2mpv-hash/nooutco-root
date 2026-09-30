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

export const ROUTES = Object.freeze({
  "/account": { checks: "open" },
  "/account/email/verify": { checks: "open" },
  "/signin": { checks: "open" },
  // A4 adds the sign-in ticket this route will require; a device has no key
  // registered yet, so it cannot sign.
  "/device/register": { checks: "open" },
  "/device/remove": { checks: "signed" },
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
