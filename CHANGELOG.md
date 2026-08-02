# Changelog

All notable changes to `@perfonext/render-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
