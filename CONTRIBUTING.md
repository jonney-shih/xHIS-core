# Contributing

## Workflow

`master` is a protected branch: direct pushes are rejected, and every
change has to land through a pull request whose `verify` check has
passed.

```sh
git checkout -b your-branch-name
# make changes
git commit -m "..."          # runs lint, typecheck, and test locally via .husky/pre-commit
git push -u origin your-branch-name
gh pr create                 # or open one on github.com
# wait for the "verify" check to pass, then merge
```

No approving review is required — the gate is the `verify` check
itself (`npm run lint && npm run typecheck && npm test`, the same
script `.husky/pre-commit` runs locally and
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs in CI), not
a human sign-off. See [`README.md`](README.md) for what `verify`
actually checks and why, and
[`docs/DETERMINISTIC_CORE_PATTERN.md`](docs/DETERMINISTIC_CORE_PATTERN.md)'s
"Resolved: a lint rule enforces the readLatest()-before-commit()
discipline" for the specific mistake this whole chain — hook, CI,
branch protection — exists to stop from ever landing on `master`
silently again.
