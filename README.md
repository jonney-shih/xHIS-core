# xHIS-core

Core module for xHIS (extensible Hospital Information System). The first
piece scaffolded here is a **static execution core**: a deterministic engine
over a closed, compile-time-known instruction set — no `eval`, no runtime
plugin loading, and a compiler-checked guarantee that every instruction has
exactly one handler. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for
the design and the TypeScript-specific rules that keep that guarantee real.

## Getting started

```sh
npm install
npm run lint        # eslint . — includes a custom rule, see below
npm run typecheck   # tsc --noEmit (the exhaustiveness gate) + tsc -p tsconfig.typecheck.json (src + tests)
npm test            # vitest
npm run build       # tsc -> dist/
```

`npm install` also sets up a `pre-commit` git hook (via
[husky](https://typicode.github.io/husky/), configured in
[`.husky/pre-commit`](.husky/pre-commit)) that runs
`npm run lint && npm run typecheck && npm test` before every commit —
version-controlled, so every clone gets it automatically, not just
whoever set it up first. `eslint.config.js` and
[`eslint-rules/no-commit-without-fresh-read.js`](eslint-rules/no-commit-without-fresh-read.js)
are this project's own custom lint rule, added after the same
"trusted-a-stale-snapshot-instead-of-reading-latest-state" mistake was
found and fixed twice in real code — see
[`docs/DETERMINISTIC_CORE_PATTERN.md`](docs/DETERMINISTIC_CORE_PATTERN.md)'s
"Resolved: a lint rule enforces the readLatest()-before-commit()
discipline" for the full story, including why the rule checks
*presence*, not ordering.

## Contributing

`master` is a protected branch — no direct pushes, every change lands
through a pull request whose `verify` check has passed. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the actual workflow.
