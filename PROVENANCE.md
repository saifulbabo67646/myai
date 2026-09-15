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
   provably EE-free and publishable at any time. All merges happen in the
   private tracking fork; this repo receives **stripped tree snapshots only**.
2. Sync ritual (vendor-branch, executed in the tracking fork):
   1. Fork: `git switch myai-main` (product-truth branch; bootstrap once from
      `branding`), rsync the public repo's current tree over it (exclude
      `.git`), commit `import myai@<public-sha>`.
   2. Fork: `git fetch upstream && git merge upstream/dev` — resolve conflicts
      here, where full 3-way context exists.
   3. Fork: `node scripts/strip-ee.mjs` (removes everything the merge
      reintroduced), commit.
   4. Public repo: rsync the fork's `myai-main` tree in (exclude `.git`), run
      guard tests + typecheck + build, commit `sync: upstream <sha>`, push,
      and update `UPSTREAM_BASE` in this file.
3. Licensing red lines and clean-room rules: docs/myai-plan.md §1.
4. Agent execution model (work packages, ownership, exit criteria):
   docs/myai-plan.md §9.
