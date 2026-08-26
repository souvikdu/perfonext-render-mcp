# Changelog

All notable changes to `@perfonext/render-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.1] - 2026-08-27

### Changed

- README setup instructions now cover VS Code, Claude Desktop, Claude Code, and other MCP-compatible clients, with macOS and nvm troubleshooting for missing `npx` or `node` paths.

## [0.4.0] - 2026-08-16

### Added

- `get_hot_commits` entries now include an `interpretation` field summarizing where a commit's cost is concentrated (dominated by one component, a small set, or spread across several) — the useful part of the never-wired-up `getCommitBreakdown` function, folded into the tool that already returns everything else needed to compute it.

### Changed

- Loaded/captured render profiles are now capped at 20 in memory; the oldest is evicted once a new one pushes past the cap, preventing unbounded memory growth over a long-running session.

### Removed

- The standalone `getCommitBreakdown` implementation and its `CommitBreakdown`/`CommitBreakdownComponentSummary` types. Its useful concentration summary is now folded into `get_hot_commits` instead of being exposed as a separate tool.

## [0.3.4] - 2026-08-14

### Added

- `nextStep` breadcrumbs on `load_render_profile`, `get_render_summary`, `get_slow_components`, `get_hot_commits`, `get_rerender_causes`, and `compare_renders`, matching the multi-step agent-flow contract already used by the live-capture tools.
- `get_render_summary` now warns when a majority of ranked component names look minified (e.g. `"V"`, `"O"`) — expected when capturing against `next build --profile`, since production minification strips displayName info regardless of the profiling flag. Points at `next dev` for real names when production-accurate timing isn't required.
- `begin_render_analysis` (live) now returns a `preconditions` field naming the two undocumented requirements that previously caused a silent `commitCount: 0`, and clarifies the tradeoff between the two working build flavors: `next dev` (real names, dev-mode timing) vs. `next build --profile` + `next start` (production-accurate timing, minified names). `instrument()` must also run as a static top-level import, not inside a mounted component or `useEffect`.

### Changed

- `get_rerender_causes` no longer returns a separate `likelyCauses` array alongside `evidence` — the actionable guidance is now folded directly into each `evidence[].detail`, removing the duplicated terse/prose pairing and shrinking the response.
- Internal framework boundary components (e.g. `__next_metadata_boundary__`) are now excluded from all ranked output and `componentCount`, alongside the existing host-element and anonymous-component filtering.
- `get_hot_commits` now omits `updaterComponentNames` from its output when empty (always the case for react-scan/lite live capture) instead of returning a dead `[]`, and documents `measurementCount` inline.

### Fixed

- `stop_render_capture`'s zero-commit warning previously recommended aliasing `react-dom` to `react-dom/profiling`, which doesn't apply to this instrumentation path. It now names the actual causes: a plain `next build`/`next start`, or `instrument()` running after React initializes.
- The five duplicated "profile not found" guards across `get_render_summary`, `get_slow_components`, `get_hot_commits`, `get_rerender_causes`, and `compare_renders` are now a single `requireRenderProfile()` helper in `store.ts`, with a consistent error message.

## [0.3.3] - 2026-08-10

### Fixed

- Rerender-cause scoring no longer labels a high-frequency, negligible-cost component as `high` severity: `scoreBand` now requires a minimum absolute `totalActualDuration` in addition to the frequency-based score, so a component with a handful of milliseconds of total render cost caps out at `medium` even if it renders on every commit.
- The "self-intensive-render" signal could previously report a self/actual duration ratio above 100% (e.g. 112%), since `selfBaseDuration` is measured independently of `actualDuration` and can exceed it. `selfDuration` is now clamped to `actualDuration` at ingestion, so the ratio is always between 0 and 1.
- Commit duration is now the sum of all depth-0 fibers in a commit instead of only the first one found, fixing cases where a commit reported multiple independent root subtrees and silently dropped the rest of the committed work from `totalCommitDuration` and commit-spike detection.
- The `wide-commit-spread` rerender signal now scales its threshold to the profile's total commit count (`min(commitCount, max(3, ceil(commitCount * 0.6)))`) instead of a fixed `3`, so a component present in 3 of 3 commits is no longer treated the same as one present in 3 of 40; the threshold is also capped at the profile's own commit count so very short sessions (1-2 commits) can still trigger on "every commit" instead of never reaching a fixed floor. Evidence now reports the spread as "N of M commits".
- `dataQuality`/`hasChangeDescriptions` now count a parent-triggered-only rerender (`changeDescription.parent`) as exact data, matching the same signal already used for `changeCauses.parentTriggered`.
- Wire-format `actualDuration`/`selfBaseDuration` values are now coerced to finite, non-negative numbers, so a malformed `NaN`/`Infinity`/negative value from react-scan/lite can no longer propagate into duration totals or ratios.
- Ingest server hardening: the test suite now binds to an OS-assigned ephemeral port (`PERFONEXT_INGEST_PORT=0`) instead of the fixed default 7721, so `npm test` no longer fails with `EADDRINUSE` when a render-mcp instance is already running.
- `createCaptureSession` no longer races to bind the ingest port twice when called concurrently before the server has started.
- The ingest server now rejects request bodies over 20MB with `413` instead of buffering them unbounded.
- Malformed percent-encoding in the ingest URL (`decodeURIComponent`) now returns `400` instead of crashing the request handler; a top-level guard and a `clientError` handler protect against other malformed requests.
- `Access-Control-Allow-Origin` is now scoped to `localhost`/`127.0.0.1` origins (with `Vary: Origin`) instead of a wildcard `*`.

### Changed

- Publish workflow migrated to npm trusted publishing (OIDC) with `npm publish --provenance`, removing the `NPM_TOKEN` secret. npm is upgraded to latest before publishing to support OIDC authentication.

## [0.3.2] - 2026-08-02

### Added

- ESLint 9 flat config and Prettier tooling, with `lint`, `lint:fix`, `format`, and `format:check` npm scripts.
- Lint and format checks wired into the pull-request CI workflow.
- Pull request, release, bug report, and feature request templates, plus Dependabot config and release-note categories.
- `.nvmrc` pinning the Node version for contributors.

### Changed

- README rewritten: installation, quick start, VS Code MCP setup, tool reference, and troubleshooting.
- Source and test files reformatted with Prettier (no functional changes).
- Build script now runs `shx chmod +x dist/index.js` so `npm run build` works on Windows as well as Unix.

### Fixed

- Removed unused imports and other ESLint-reported issues in parsers and tools.
- Added missing trailing newlines to workflow files.

## [0.3.1] - 2026-06-24

### Added

- Exact rerender-cause attribution — when live capture provides `changeDescription` data, `get_rerender_causes` reports the specific props, state, context, and hooks that changed, with an `exact-change-description` evidence signal (heuristics remain the documented fallback).
- `dataQuality: "exact" | "heuristic"` field on `stop_render_capture`, `get_render_summary`, and `get_rerender_causes`.
- Source locations (`source.fileName`, `source.lineNumber`) on ranked components.

### Changed

- Ranked output and `componentCount` now exclude DOM host elements and unnamed components; anonymous components are reported via `warnings[]`.
- Rerender scoring now factors in average render duration.
- `run_render_capture` test-suite guidance now requires running headed (headless disables React profiling hooks, yielding heuristic-only data).

## [0.3.0] - 2026-06-12

### Added

- Live render capture via react-scan/lite — `begin_render_analysis` replaces `start_render_capture` as the entry point, asking whether to use live capture or a manual DevTools export before proceeding.
- `run_render_capture` now asks whether to navigate the app manually or run a test suite, rather than deciding autonomously.
- Ingest server now runs on a fixed port (7721).

### Fixed

- Port conflicts now fail fast with a clear message instead of silently breaking.
- `PERFONEXT_INGEST_PORT` environment variable is validated at startup.
- Capture sessions are deleted from memory after analysis completes.

## [0.2.0] - 2026-06-05

### Added

- `compare_renders` tool — compares two loaded React Profiler exports, ranking components by absolute delta (slower/faster/appeared/disappeared).
- `issues` field in `get_render_summary` — surfaces up to 5 detected issues (commit spikes, rerender storms) with severity and evidence.
- `priorityLevel` filter for `get_hot_commits` (`"Immediate"` for input-blocking commits, `"Normal"` for async).

### Fixed

- Components mounted after profiling starts no longer collapse render path analysis to a single node.
- Zero-delta components no longer appear in `compare_renders` output.

## [0.1.0] - 2026-05-31

### Added

- Initial release of `@perfonext/render-mcp` — loads and analyzes exported React DevTools Profiler JSON captured from Next.js apps.
- `load_render_profile`, `get_render_summary`, `get_hot_commits`, `get_slow_components`, `get_rerender_causes` tools.
