# perfonext-render-mcp

> Analyze React render behavior in Next.js apps and apply fixes in the editor.

[![npm](https://img.shields.io/npm/v/@perfonext/render-mcp)](https://www.npmjs.com/package/@perfonext/render-mcp)
[![npm downloads](https://img.shields.io/npm/dt/@perfonext/render-mcp)](https://www.npmjs.com/package/@perfonext/render-mcp)
[![license](https://img.shields.io/npm/l/@perfonext/render-mcp)](https://www.npmjs.com/package/@perfonext/render-mcp)

`perfonext-render-mcp` is a Model Context Protocol (MCP) server that gives GitHub Copilot, Claude Desktop,
Claude Code, and other MCP clients structured, machine-readable React render analysis for Next.js performance
work. It turns live capture sessions and React DevTools Profiler exports into component costs, exact rerender
causes, and regression diffs — evidence Copilot can act on directly.

## Quick Start

Run directly with `npx`:

```bash
npx -y @perfonext/render-mcp
```

Or install globally:

```bash
npm install -g @perfonext/render-mcp
```

The executable command remains `perfonext-render-mcp` after installation.

Add the server to VS Code in `.vscode/mcp.json` (the workspace MCP configuration file):

```json
{
  "servers": {
    "perfonext-render": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@perfonext/render-mcp"]
    }
  }
}
```

Then reload the VS Code window and run **MCP: List Servers** to start it, or accept the trust prompt when it appears. For a locally-built checkout, point `command`/`args` at `node` and the repo's `dist/index.js` instead.

Then ask Copilot: _"Run a render analysis on my app."_

## What It Does

`perfonext-render-mcp` is the **agent companion** to React DevTools Profiler and `react-scan` — best at
machine-readable summaries, exact rerender-cause attribution, source-aware follow-up, and diffing. The loop is
**collect → analyze → fix**, all locally:

- **collect** — choose live capture (react-scan/lite streams events in real time) or manual DevTools export
- **analyze** — the MCP returns structured, machine-readable evidence: component costs, rerender causes, commit breakdowns, and regressions
- **fix** — Copilot uses that evidence to propose and apply concrete code changes

> **Note:** while a live capture session is active, React DevTools Timeline Profiler will not receive events
> (react-scan/lite takes over the profiling channel). Calling `stop_render_capture` restores it.

Capabilities:

- **live capture** — streams per-commit fiber events from a running React app directly into the MCP over a local HTTP endpoint; no manual export required
- **manual export** — loads exported React DevTools Profiler JSON files as an alternative input path
- summarizes commits, the most expensive components, and detected render issues in one call
- ranks the hottest commits and shows the top components inside each spike
- identifies the slowest components by total render cost
- highlights components with repeated rerenders, reporting the **exact** changed props/state/hooks when live
  capture provides `changeDescription` data, and falling back to deterministic heuristics otherwise
- annotates ranked components with their source file and line when available
- filters DOM host elements (`div`, `span`, …) and unnamed components out of ranked output so findings stay actionable
- compares two render profiles to surface regressions and improvements
- keeps profiles in memory so Copilot can iterate without re-loading

## Tools

### Entry point

| Tool                    | Description                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `begin_render_analysis` | Entry point. Accepts `approach: "live" \| "manual"`. For `live`: starts a capture session and returns the instrumentation snippet. For `manual`: returns React DevTools Profiler export steps. |

### Live capture

| Tool                   | Description                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `run_render_capture`   | Called after instrumentation is wired up. Accepts `method: "manual-interaction" \| "test-suite"`. Returns focused instructions for whichever method the user picks. Test suites must run **headed** (e.g. `playwright test --headed`) so React profiling hooks activate. |
| `stop_render_capture`  | Stop the session, finalize buffered events into a profile, and return a `profileId` plus `dataQuality` (`exact` \| `heuristic`) for analysis                                                                                                                             |
| `get_captured_renders` | Optional diagnostic: peek at session progress without stopping (commit count, unknown events). Only call if something seems wrong.                                                                                                                                       |

### Analysis

| Tool                  | Description                                                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load_render_profile` | Parse and load an exported React DevTools Profiler JSON file from disk (manual path entry point)                                                                                                     |
| `get_render_summary`  | Summarize a loaded profile: top components by render cost, hottest commits, and detected render issues                                                                                               |
| `get_hot_commits`     | Rank the most expensive commits and show the top components inside each spike                                                                                                                        |
| `get_slow_components` | Rank the slowest components by total actual render time                                                                                                                                              |
| `get_rerender_causes` | Explain rerender causes with evidence, confidence, and a risk score. Reports exact changed props/state/hooks when `changeDescription` data is present (`dataQuality: "exact"`), heuristics otherwise |
| `compare_renders`     | Diff two loaded render profiles and rank regressions, improvements, additions, and removals                                                                                                          |

## Usage Walkthrough

Ask Copilot: _"Run a render analysis on my app."_

Copilot calls `begin_render_analysis` and asks you to choose:

**Option A — Live capture (recommended)**

Copilot will:

1. Start a capture session (ingest server on `127.0.0.1:7721`)
2. Install `react-scan` as a devDependency if not present
3. Write `instrumentation-client.js` at your project root with the session snippet
4. Import it from your app's client-side entry point
5. Ask whether you want to interact manually or run a test suite (`run_render_capture`)
6. Stop the session and run analysis

> Running a test suite? Launch it **headed** (e.g. `playwright test --headed`). A headless browser does not
> expose the React DevTools profiling channel, so `changeDescription` data is unavailable and causes fall back
> to heuristics (`dataQuality: "heuristic"`).

The ingest server runs on a **fixed port (7721)**. Only the `sessionId` line in `instrumentation-client.js` changes between sessions — the file does not need to be re-wired each time.

**Option B — Manual DevTools export**

1. Open React DevTools in the browser → Profiler tab → Record
2. Interact with the app
3. Export the JSON and share the file path
4. Copilot calls `load_render_profile({ filePath: "..." })`

## Example Copilot Prompts

- "Run a render analysis on my app."
- "Stop the capture and show me the slowest components."
- "Which components are re-rendering the most and why?"
- "Compare this run to the profile I captured before the refactor."
- "I already have a React DevTools export — load it and tell me what's slow."
- "Show me the hottest commits and which components dominated each spike."

## Related Perfonext Tools

- [perfonext-profiler-mcp](https://github.com/souvikdu/perfonext-profiler-mcp) — CPU profiling (V8/Chrome) for Next.js servers
- [perfonext-build-mcp](https://github.com/souvikdu/perfonext-build-mcp) — Next.js bundle/build analysis

## Development

```bash
npm install
npm run build
npm test
```

Sample fixtures live under `tests/fixtures/`.

## License

MIT
