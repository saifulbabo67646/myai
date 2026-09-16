# myai

myai is a local-first AI workspace for doing work with AI agents on your own files. It runs on
your machine, talks to the model providers you configure, and keeps your workspaces, skills, and
automations on disk.

The desktop app is the workspace: chat on your files, skills, browser automation, scheduled
automations, and Anthropic-compatible plugins. A self-hosted **myai server** is planned for teams
that want sign-in, membership and roles, and a shared workspace registry on infrastructure they
control — see [`docs/myai-plan.md`](./docs/myai-plan.md), the single source of truth for product,
licensing, and phasing.

## What is in this repository

| Path | What lives there |
| --- | --- |
| `apps/app` | the React UI of the desktop app |
| `apps/desktop` | the Electron shell (windows, menus, updater, packaging) |
| `apps/server` | `openwork-server`, the local runtime the app talks to |
| `packages/` | shared core packages |
| `evals/` | executable test specs built on `@openwork/testkit` |
| `worlds/` | declarative dev/test environment definitions for `pnpm world` |
| `docs/` | operator, feature, and release docs |

## Getting started

Prerequisites:

- **Node 24** — pinned in [`.nvmrc`](./.nvmrc) (`nvm use` picks it up).
- **pnpm 11** — pinned in `package.json` (`packageManager`); run `corepack enable` to use the
  pinned version. Never use npm or yarn.
- **Bun 1.3** — some eval specs and desktop tests run under `bun`.
- **Git with DCO sign-off** — every commit needs a `Signed-off-by` trailer (`git commit -s`).
  See [CONTRIBUTING.md](./CONTRIBUTING.md).

```bash
git clone https://github.com/saifulbabo67646/myai.git
cd myai
corepack enable
pnpm install
pnpm dev   # launches the Electron desktop app with hot reload
```

`pnpm typecheck` type-checks the app, and `pnpm build` produces the desktop bundle.

### Testing

All executable coverage lives in `evals/specs/**/*.test.ts`; app-driving journeys use
`.e2e.test.ts`.

```bash
pnpm --dir evals install --frozen-lockfile   # once
pnpm evals:pr specs/<name>.test.ts           # app-less PR-lane spec
pnpm evals:e2e <name> --local                # app-driving E2E journey, run locally
```

Runtime-observable changes need test evidence on the PR. [`AGENTS.md`](./AGENTS.md) describes the
verification contract and vocabulary.

### Sending a pull request

1. Branch from `main` and open your PR against `main`. Every change lands through a PR.
2. Sign off every commit: `git commit -s`.
3. Keep the diff as small as possible, and include or update test evidence for runtime-observable
   changes.
4. CI (`.github/workflows/myai-ci.yml`) must be green: it installs both workspaces, runs
   `pnpm typecheck`, and runs the repository guards plus the PR-lane specs.

Read [CONTRIBUTING.md](./CONTRIBUTING.md) for the DCO and licensing rules.

## Headless web (no Electron)

To run the UI in a browser against a local `openwork-server`:

```bash
pnpm world up dev-headless --detach
```

Read `tmp/headless-server.json` for the URL and tokens. Stop it with
`pnpm world down dev-headless`.

## Translations

README translations live in [`translated_readmes/`](./translated_readmes/). See
[TRANSLATIONS.md](./TRANSLATIONS.md) to add a language.

## License and attribution

myai is released under the MIT license — see [LICENSE](./LICENSE).

myai is derived from OpenWork (https://github.com/different-ai/openwork); the imported portions
are Copyright (c) 2026-present Different AI, Inc. and remain under the MIT license. See
[NOTICE](./NOTICE) and [PROVENANCE.md](./PROVENANCE.md) for the origin record.

This repository contains no code from OpenWork Enterprise Edition, and myai is not affiliated
with or endorsed by Different AI. "OpenWork" and "Different AI" are trademarks of their owner
and are used here only to attribute the origin of the imported code.
