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
npm run typecheck   # tsc --noEmit — this is the exhaustiveness gate
npm test            # vitest
npm run build       # tsc -> dist/
```
