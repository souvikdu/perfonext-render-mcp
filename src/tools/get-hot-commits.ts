import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatMs, formatPct } from '../format.js';
import { getHotCommits } from '../parser/analysis.js';
import { requireRenderProfile } from '../store.js';

export function registerGetHotCommits(server: McpServer): void {
  server.registerTool(
    'get_hot_commits',
    {
      title: 'Get Hot Commits',
      description:
        'Rank the most expensive commits in a loaded render profile and show the top components inside each spike.',
      inputSchema: {
        profileId: z.string().describe('Profile ID from load_render_profile'),
        limit: z
          .number()
          .int()
          .positive()
          .max(25)
          .optional()
          .describe('How many commits to include. Defaults to 10.'),
        componentLimit: z
          .number()
          .int()
          .positive()
          .max(10)
          .optional()
          .describe('How many top components to include per commit. Defaults to 3.'),
        priorityLevel: z
          .string()
          .optional()
          .describe(
            'Filter to commits with this priority level only. Common values: "Immediate" (synchronous, input-blocking), "Normal" (async, e.g. API responses). Omit to include all priorities.',
          ),
      },
    },
    async ({ profileId, limit, componentLimit, priorityLevel }) => {
      const profile = requireRenderProfile(profileId);

      const hotCommits = getHotCommits(
        profile,
        limit ?? 10,
        componentLimit ?? 3,
        priorityLevel,
      ).map((commit) => {
        // Omit when empty — react-scan/lite live capture never populates this field;
        // only the React DevTools manual-export path can report real updater names.
        const { updaterComponentNames, ...rest } = commit;
        return {
          ...rest,
          duration: formatMs(commit.duration),
          totalSelfDuration: formatMs(commit.totalSelfDuration),
          totalActualDuration: formatMs(commit.totalActualDuration),
          topComponents: commit.topComponents.map((component) => ({
            ...component,
            actualDuration: formatMs(component.actualDuration),
            selfDuration: formatMs(component.selfDuration),
            shareOfCommitWork: formatPct(component.shareOfCommitWork),
          })),
          ...(updaterComponentNames.length > 0 ? { updaterComponentNames } : {}),
        };
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                profileId,
                timestampNote:
                  'timestamp values are milliseconds since the profiling session started, not Unix epoch',
                measurementCountNote:
                  'measurementCount is the total fiber renders in this commit (all components, before ranking) — not the count of topComponents below',
                hotCommits,
                nextStep: `call get_slow_components with profileId "${profileId}" to rank components across the whole session, not just this commit`,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
