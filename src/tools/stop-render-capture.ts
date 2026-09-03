import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { deleteCaptureSession, getCaptureSession, stopCaptureSession } from '../ingest/server.js';
import { isAnalyzableComponent } from '../parser/analysis.js';
import { adaptReactScanEvents } from '../parser/react-scan-lite.js';
import { storeRenderProfile } from '../store.js';
import { formatMs } from '../format.js';

export function registerStopRenderCapture(server: McpServer): void {
  server.registerTool(
    'stop_render_capture',
    {
      title: 'Stop Render Capture',
      description:
        'Stop a live render-capture session, finalize the buffered events into a render profile, ' +
        'and return a profileId you can use with get_render_summary, get_slow_components, ' +
        'get_rerender_causes, and compare_renders.',
      inputSchema: {
        sessionId: z.string().describe('The sessionId returned by begin_render_analysis'),
      },
    },
    async ({ sessionId }) => {
      const session = getCaptureSession(sessionId);

      if (!session) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: `Session "${sessionId}" not found` }, null, 2),
            },
          ],
          isError: true,
        };
      }

      if (session.status === 'stopped') {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: `Session "${sessionId}" is already stopped` }, null, 2),
            },
          ],
          isError: true,
        };
      }

      // Mark stopped before processing so no new events are accepted.
      stopCaptureSession(sessionId);

      const commitCount = session.commits.length;

      if (commitCount === 0) {
        const warning =
          session.profilingAvailable === false
            ? 'No commits captured. The app reported profiling-hooks-status: false — ' +
              "this means the app is running a plain production build. React's profiling hooks are only " +
              'compiled in by `next dev`, or `next build --profile` followed by `next start` — a plain ' +
              '`next build`/`next start` will not work.'
            : 'No commits captured, even though profiling hooks were available. The most common cause is ' +
              'timing: instrument() must run before React initializes (a static top-level import in your ' +
              'client entry module), not inside a useEffect or a mounted component — by the time a component ' +
              'mounts, React has already decided whether to install its hooks. Also confirm you interacted ' +
              'with the app while the session was active.';

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  warning,
                  sessionId,
                  commitCount: 0,
                  nextStep:
                    'Do not call stop_render_capture again. Fix the named prerequisite, then start a new begin_render_analysis session.',
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const profile = adaptReactScanEvents(session.commits, sessionId);
      storeRenderProfile(profile);
      // Session data is no longer needed — free memory.
      deleteCaptureSession(sessionId);

      const result = {
        profileId: profile.id,
        sessionId,
        commitCount: profile.commits.length,
        componentCount: profile.components.filter((c) => isAnalyzableComponent(c.componentName))
          .length,
        totalCommitDuration: formatMs(profile.totalCommitDuration),
        profilingAvailable: session.profilingAvailable,
        dataQuality: profile.hasChangeDescriptions ? 'exact' : 'heuristic',
        nextStep: `call get_render_summary with profileId "${profile.id}"`,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
