// Sends one plain-text email through Resend. Moved from JanusMirror's
// gatekeeper/src/mailer.mjs: the engine copy holds no address, reads no
// Keychain and writes no event wording, so the caller names the sender, the
// recipient, the words and how the key is read. The key is read at send time,
// passed to fetch in a header and never kept or logged. A send that fails is
// logged without the key, the address or the text and never throws, since the
// caller's state must hold even when the email cannot go out.
export const RESEND_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 15_000;
const LINK_TOKEN = /^[A-Za-z0-9_-]+$/;

const nonEmpty = (v) => typeof v === 'string' && v.length > 0;

// The failure line names only the kind of failure. An error's own message is
// never logged, since a key reader or a transport can put the key or the
// address in it.
function failureOf(err) {
  if (err?.status) return `answered ${err.status}`;
  return 'transport or key read failed';
}

export function createMailer({ from, readKey, fetchImpl = (...a) => globalThis.fetch(...a), log = () => {} } = {}) {
  if (!nonEmpty(from)) throw new Error('mailer: from is required');
  if (typeof readKey !== 'function') throw new Error('mailer: readKey is required');
  return async function send(message) {
    if (!message || !nonEmpty(message.to) || !nonEmpty(message.subject) || !nonEmpty(message.text)) return false;
    try {
      const key = await readKey();
      const res = await fetchImpl(RESEND_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) throw Object.assign(new Error('refused'), { status: res.status });
      return true;
    } catch (err) {
      log(`mailer: email not sent: ${failureOf(err)}`);
      return false;
    }
  };
}

// Builds a link whose token rides only in the fragment, which a browser never
// sends to a server, so the token stays out of every request line, access log
// and referrer. The base must be https with no query or fragment of its own.
export function fragmentLink(base, token) {
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error('fragmentLink: link base is not a URL');
  }
  if (url.protocol !== 'https:' || url.search !== '' || url.hash !== '' || base.includes('?') || base.includes('#')) {
    throw new Error('fragmentLink: link base must be https with no query or fragment');
  }
  if (typeof token !== 'string' || !LINK_TOKEN.test(token)) throw new Error('fragmentLink: link token must be base64url');
  return `${url.origin}${url.pathname}#${token}`;
}
