/**
 * An in-memory GitHub Contents + Git-Data API, enough of it to run `worker.js`
 * for real.
 *
 * The Worker's admin endpoints are almost entirely GitHub choreography — read
 * the ref, read some files, post blobs, post a tree, fast-forward the branch.
 * Asserting on the pieces separately proves very little; what matters is the
 * commit that comes out the other end. So this fakes the API instead of the
 * Worker, which lets a test POST to `worker.fetch()` exactly as AdminTools does
 * and then read the resulting tree back as files.
 *
 * It is deliberately strict about the things that have actually gone wrong:
 *
 *  • `PATCH git/refs` with `force: false` returns 422 when the parent is not the
 *    current head, so the Worker's CONFLICT retry is exercised rather than
 *    assumed.
 *  • Every path is stored exactly as the Worker sent it, so a `REPO_SUBDIR`
 *    that gets applied twice shows up as a literal `apps/games/apps/games/…`
 *    key rather than silently resolving.
 *  • An unknown route throws instead of returning an empty 200.
 */

const b64encode = (bytes) => Buffer.from(bytes).toString('base64');
const b64decode = (text) => Buffer.from(text, 'base64');

export class FakeGitHub {
  /** @param {Record<string, Buffer|string>} files repo path -> contents */
  constructor(files = {}) {
    this.blobs = new Map();     // sha -> Buffer
    this.trees = new Map();     // sha -> Map(path -> Buffer)
    this.commits = new Map();   // sha -> { tree, parents }
    this.requests = [];         // every call, for assertions about the wire
    this.treeEntryPaths = [];   // every path the Worker asked to write/delete
    this.commitMessages = [];
    this.failures = [];         // queued sabotage: shift()ed per PATCH git/refs

    const snapshot = new Map(
      Object.entries(files).map(([p, v]) => [p, Buffer.isBuffer(v) ? v : Buffer.from(v)]),
    );
    const treeSha = this.#put(this.trees, snapshot);
    this.head = this.#put(this.commits, { tree: treeSha, parents: [] });
  }

  #counter = 0;
  #put(store, value) {
    const sha = `sha${(this.#counter += 1).toString(16).padStart(8, '0')}`;
    store.set(sha, value);
    return sha;
  }

  /** The repo as it stands on the branch. */
  files() {
    return this.trees.get(this.commits.get(this.head).tree);
  }

  read(repoPath) {
    const bytes = this.files().get(repoPath);
    return bytes === undefined ? null : bytes;
  }

  readJson(repoPath) {
    const bytes = this.read(repoPath);
    return bytes === null ? null : JSON.parse(bytes.toString('utf8'));
  }

  /** Land a commit of someone else's, so the next Worker PATCH conflicts. */
  landConcurrentCommit(repoPath, contents) {
    const next = new Map(this.files());
    next.set(repoPath, Buffer.isBuffer(contents) ? contents : Buffer.from(contents));
    const treeSha = this.#put(this.trees, next);
    this.head = this.#put(this.commits, { tree: treeSha, parents: [this.head] });
  }

  /** A `fetch` implementation to install as `globalThis.fetch`. */
  fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    // Everything after /repos/<owner>/<repo>/
    const route = parsed.pathname.replace(/^\/repos\/[^/]+\/[^/]+\//, '');
    this.requests.push({ method, route, body });

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

    if (method === 'GET' && route.startsWith('contents/')) {
      const repoPath = decodeURIComponent(route.slice('contents/'.length));
      const bytes = this.read(repoPath);
      if (bytes === null) return json({ message: 'Not Found' }, 404);
      return json({ path: repoPath, content: b64encode(bytes), encoding: 'base64' });
    }

    if (method === 'GET' && route.startsWith('git/ref/heads/')) {
      return json({ object: { sha: this.head } });
    }

    if (method === 'GET' && route.startsWith('git/commits/')) {
      const commit = this.commits.get(route.slice('git/commits/'.length));
      if (!commit) return json({ message: 'Not Found' }, 404);
      return json({ tree: { sha: commit.tree } });
    }

    if (method === 'POST' && route === 'git/blobs') {
      return json({ sha: this.#put(this.blobs, b64decode(body.content)) });
    }

    if (method === 'POST' && route === 'git/trees') {
      const base = this.trees.get(body.base_tree);
      if (!base) return json({ message: 'base_tree not found' }, 422);
      const next = new Map(base);
      for (const entry of body.tree) {
        this.treeEntryPaths.push(entry.path);
        if (entry.sha === null) next.delete(entry.path);
        else next.set(entry.path, this.blobs.get(entry.sha));
      }
      return json({ sha: this.#put(this.trees, next) });
    }

    if (method === 'POST' && route === 'git/commits') {
      this.commitMessages.push(body.message);
      return json({ sha: this.#put(this.commits, { tree: body.tree, parents: body.parents }) });
    }

    if (method === 'PATCH' && route.startsWith('git/refs/heads/')) {
      const forced = this.failures.shift();
      if (forced) return json({ message: forced.message || 'sabotage' }, forced.status);
      const commit = this.commits.get(body.sha);
      if (!commit) return json({ message: 'commit not found' }, 422);
      // force:false is a fast-forward check — the parent must still be head.
      if (!body.force && commit.parents[0] !== this.head) {
        return json({ message: 'Update is not a fast forward' }, 422);
      }
      this.head = body.sha;
      return json({ object: { sha: this.head } });
    }

    throw new Error(`FakeGitHub: unhandled ${method} ${route}`);
  };
}

/** The admin bearer token for a secret — sha256 hex, as `requireAdmin` expects. */
export async function adminToken(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const adminRequest = (path, payload, token) =>
  new Request(`https://games.nooutco.me${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
