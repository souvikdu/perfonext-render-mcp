import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatMs } from '../format.js';
import { getSlowComponents } from '../parser/analysis.js';
import { requireRenderProfile } from '../store.js';

export function registerGetSlowComponents(server: McpServer): void {
  server.registerTool(
    'get_slow_components',
    {
      title: 'Get Slow Components',
      description:
        'Return the slowest components in a loaded Next.js render profile, ranked by total actual render time.',
      inputSchema: {
        profileId: z.string().describe('Profile ID from load_render_profile'),
        limit: z
          .number()
          .int()
          .positive()
          .max(25)
          .optional()
          .describe('How many components to return. Defaults to 10.'),
        sortBy: z
          .enum(['total', 'average', 'max'])
          .optional()
          .describe(
            'Sort metric: "total" = total render time (default), "average" = average per render, "max" = peak single render time.',
          ),
        minSelfDuration: z
          .number()
          .nonnegative()
          .optional()
          .describe(
            'Minimum total self duration in ms to include — the same metric the default "total" sort ranks by, excluding time spent in children. Filters sub-millisecond noise. Defaults to 0.',
          ),
      },
    },
    async ({ profileId, limit, sortBy, minSelfDuration }) => {
      const profile = requireRenderProfile(profileId);

      const slowComponents = getSlowComponents(
        profile,
        limit ?? 10,
        sortBy ?? 'total',
        minSelfDuration ?? 0,
      ).map((component, index) => ({
        rank: index + 1,
        ...component,
        totalSelfDuration: formatMs(component.totalSelfDuration),
        totalActualDuration: formatMs(component.totalActualDuration),
        averageActualDuration: formatMs(component.averageActualDuration),
        maxActualDuration: formatMs(component.maxActualDuration),
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                profileId,
                slowComponents,
                nextStep: `call get_rerender_causes with profileId "${profileId}" to see why these components are rerendering`,
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
