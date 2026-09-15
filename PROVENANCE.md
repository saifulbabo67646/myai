# Provenance

Machine-readable origin record for this repository. Update `UPSTREAM_BASE` on
every upstream sync (see docs/myai-plan.md §2).

| Field | Value |
|---|---|
| Product | myai |
| Derived from | `different-ai/openwork` — MIT-licensed portions only |
| Import method | `git archive` snapshot (no upstream git history imported; this repo's history starts EE-free) |
| Import date | 2026-09-16 |
| Snapshot source | tracking fork `branding` branch @ `a94ad71e982ead3c08f1dcb1795ddebef7b8151d` |
| UPSTREAM_BASE | `03664d1f04b26a2e8539e33319840baa9a87a5a9` (upstream/dev commit the fork was last synced to) |
| Upstream tip at import | `fa97054588a0ab12519fafc50cbea6d510f42130` (catch-up pending, ~670 commits) |
| EE strip tool | `scripts/strip-ee.mjs` (run at import; must be re-run after every sync) |
| Tracking fork | `/Users/saiful/Desktop/work/openwork` (private; `dev` mirrors `upstream/dev`) |
| Tracking fork remotes | upstream `https://github.com/different-ai/openwork.git` · origin `https://github.com/saifulbabo67646/myai-old.git` (renamed 2026-09-16; to be archived) |
| This repo's origin | `https://github.com/saifulbabo67646/myai.git` (public, branch `main`, pushed 2026-09-16; GitHub Actions + Dependabot disabled until CI is curated) |

## Rules

1. This repo never gets an `upstream` remote and never merges upstream git
   history: EE blobs must not exist anywhere in `.git`, so the repo stays
   provably EE-free and publishable at any time.
2. Syncs are patch-based through the tracking fork:
   `git -C <tracking-fork> diff <UPSTREAM_BASE>..upstream/dev -- . ':(exclude)ee'`
   → apply 3-way here → re-run `scripts/strip-ee.mjs` → run guard tests →
   update `UPSTREAM_BASE` in this file.
3. Licensing red lines and clean-room rules: docs/myai-plan.md §1.
