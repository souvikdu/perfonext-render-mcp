# perfonext-render-mcp

> Analyze React render behavior in Next.js apps and apply fixes in the editor.

[![npm](https://img.shields.io/npm/v/@perfonext/render-mcp)](https://www.npmjs.com/package/@perfonext/render-mcp)
[![npm downloads](https://img.shields.io/npm/dt/@perfonext/render-mcp)](https://www.npmjs.com/package/@perfonext/render-mcp)
[![license](https://img.shields.io/npm/l/@perfonext/render-mcp)](https://www.npmjs.com/package/@perfonext/render-mcp)

`perfonext-render-mcp` is a Model Context Protocol (MCP) server that gives GitHub Copilot, Claude Desktop,
Claude Code, and other MCP clients structured, machine-readable React render analysis for Next.js performance
work. It turns live capture sessions and React DevTools Profiler exports into component costs, exact rerender
causes, and regression diffs — evidence an MCP client can act on directly.

## Quick Start

`perfonext-render-mcp` is a standard MCP stdio server, so it works with any MCP-compatible client
(GitHub Copilot in VS Code, Claude Desktop, Claude Code, Cursor, and others). Run it directly with `npx`:

```bash
npx -y @perfonext/render-mcp
```

Or install globally:

```bash
npm install -g @perfonext/render-mcp
```

The executable command remains `perfonext-render-mcp` after installation.

### VS Code

Add the server to `.vscode/mcp.json` (the workspace MCP configuration file):

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

Reload the VS Code window and run **MCP: List Servers** to start it, or accept the trust prompt when it appears.

### Claude Desktop

Add the server to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "perfonext-render": {
      "command": "npx",
      "args": ["-y", "@perfonext/render-mcp"]
    }
  }
}
```

Restart Claude Desktop to pick up the new server.

### Claude Code

Add the server with the CLI:

```bash
claude mcp add perfonext-render -- npx -y @perfonext/render-mcp
```

Or add the same `mcpServers` entry to `.mcp.json`.

### Other MCP clients

Any client that supports stdio MCP servers can launch `npx -y @perfonext/render-mcp`. Consult your
client's documentation for its MCP server configuration format.

For a locally-built checkout, point `command`/`args` at `node` and the repo's `dist/index.js` instead.

## Troubleshooting

### `spawn npx ENOENT` / `spawn node ENOENT` on macOS with nvm

If the server fails to start with this error, your GUI MCP client likely cannot see nvm. GUI apps on
macOS do not load shell config (`.zshrc`/`.bashrc`), so nvm-installed `npx`/`node` are not on `PATH`.
Use an absolute `npx` path and include the same Node directory in `PATH`:

```json
{
  "servers": {
    "perfonext-render": {
      "type": "stdio",
      "command": "/Users/YOU/.nvm/versions/node/v<version>/bin/npx",
      "args": ["-y", "@perfonext/render-mcp"],
      "env": {
        "PATH": "/Users/YOU/.nvm/versions/node/v<version>/bin:/usr/bin:/bin"
      }
    }
  }
}
```

Merge these fields into your client's server entry, under `servers` for VS Code or `mcpServers` for
Claude Desktop/Code. Then ask your assistant: _"Run a render analysis on my app."_

## What It Does

`perfonext-render-mcp` is the **agent companion** to React DevTools Profiler and `react-scan` — best at
machine-readable summaries, exact rerender-cause attribution, source-aware follow-up, and diffing. The loop is
**collect → analyze → fix**, all locally:

- **collect** — choose live capture (react-scan/lite streams events in real time) or manual DevTools export
- **analyze** — the MCP returns structured, machine-readable evidence: component costs, rerender causes, commit breakdowns, and regressions
- **fix** — your MCP client uses that evidence to propose and apply concrete code changes

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
- keeps profiles in memory so an MCP client can iterate without re-loading

## Tools

### Entry point

| Tool                    | Description                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `begin_render_analysis` | Entry point. Accepts `approach: "live" \| "manual"`. For `live`: starts a capture session and returns the instrumentation snippet. For `manual`: returns React DevTools Profiler export steps. |

### Live capture

| Tool                   | Description                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run_render_capture`   | Called after instrumentation is wired up. Accepts `method: "manual-interaction" \| "test-suite"`. Returns focused instructions for whichever method the user picks. |
| `stop_render_capture`  | Stop the session, finalize buffered events into a profile, and return a `profileId` plus `dataQuality` (`exact` \| `heuristic`) for analysis                        |
| `get_captured_renders` | Optional diagnostic: peek at session progress without stopping (commit count, unknown events). Only call if something seems wrong.                                  |

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

Ask your assistant: _"Run a render analysis on my app."_

Your MCP client calls `begin_render_analysis` and asks you to choose:

**Option A — Live capture (recommended)**

Your MCP client will:

1. Start a capture session (ingest server on `127.0.0.1:7721`)
2. Install `react-scan` as a devDependency if not present
3. Write `instrumentation-client.js` at your project root with the session snippet
4. Import it from your app's client-side entry point
5. Ask whether you want to interact manually or run a test suite (`run_render_capture`)
6. Stop the session and run analysis

> Running a test suite? Use `npx playwright test` as usual. `react-scan/lite` installs
> `__REACT_DEVTOOLS_GLOBAL_HOOK__` itself, so a visible window and the React DevTools extension are not
> required. The run still yields `changeDescription` data and `dataQuality: "exact"`.

> **Two preconditions commonly cause a silent `commitCount: 0`:**
>
> - **Build flavor.** A plain `next build`/`next start` compiles out React's profiling hooks entirely.
>   Choose one of:
>   - `next dev` — real component names, but dev-mode overhead means render timings and proportions
>     may not match what real users experience in production.
>   - `next build --profile` then `next start` — production-accurate timings, but component names get
>     minified to 1-2 letters (e.g. `"V"`) by production minification, regardless of the profiling flag.
>     `get_render_summary` surfaces a warning when this is detected.
> - **Instrumentation timing.** `instrument()` must run before React initializes — a static top-level import
>   (as shown in the generated snippet) works; mounting it as a React component, or calling it inside a
>   `useEffect`, runs too late and silently captures nothing.

The ingest server runs on a **fixed port (7721)**. Only the `sessionId` line in `instrumentation-client.js` changes between sessions — the file does not need to be re-wired each time.

**Option B — Manual DevTools export**

1. Open React DevTools in the browser → Profiler tab → Record
2. Interact with the app
3. Export the JSON and share the file path
4. Your MCP client calls `load_render_profile({ filePath: "..." })`

## Example Prompts

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
