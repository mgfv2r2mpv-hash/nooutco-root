# Vendored browser libraries

The note tools compile JSX in the browser, so React, ReactDOM and Babel are not
optional extras on those pages: they **are** the page. Loaded from unpkg, a slow
or failed request left a technician looking at a nav bar above an empty white
rectangle, with no error message and nothing to retry. That is not theoretical.
A full parallel Playwright run reproduced it more than once, with React arriving
and `@babel/standalone` silently not:

```
CDN dependencies missing on sap: {"react":true,"reactDom":true,"babel":false}
```

These files are byte-for-byte what unpkg served on 2026-08-04, committed so the
pages depend on nothing but this project.

| File | Source |
|---|---|
| `react-18.3.1.production.min.js` | `https://unpkg.com/react@18.3.1/umd/react.production.min.js` |
| `react-dom-18.3.1.production.min.js` | `https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js` |
| `babel-standalone-7.29.8.min.js` | `https://unpkg.com/@babel/standalone@7.29.8/babel.min.js` |

## Updating

Pinned deliberately. The pages used to ask for `react@18` and
`@babel/standalone@7`, which meant the code running in front of a clinician
could change because someone else published a release. To move a version,
download the new file, add it here under its full version number, point the two
`notes/*/index.html` pages at it, and delete the old one in the same commit so
the filename never lies about its contents.

`tests/no-cdn-dependency.spec.js` blocks every third-party request and then
loads each page, so a reintroduced CDN script tag fails the suite rather than
waiting to fail in a session.

## What is still third party

Turnstile (`challenges.cloudflare.com`) has to be, it is the bot check itself.
The Atkinson Hyperlegible webfont is still Google-hosted; when it fails the page
falls back through the font stack and stays perfectly usable, which is why it
was left alone.
