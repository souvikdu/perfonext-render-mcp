import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatMs } from '../format.js';
import { parseRenderProfile } from '../parser/react-profile.js';
import { storeRenderProfile } from '../store.js';

/**
 * Turn a raw fs/JSON/parse error into a message that says what failed and what the tool expects.
 */
export function formatLoadRenderProfileError(err: unknown, absPath: string): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') {
    return `Error: No file found at "${absPath}". load_render_profile needs the path to a React DevTools Profiler JSON export.`;
  }
  if (code === 'EISDIR') {
    return `Error: "${absPath}" is a directory. load_render_profile only accepts a single profile file path, not a directory.`;
  }
  if (err instanceof SyntaxError) {
    return `Error: "${absPath}" is not valid JSON. The file may be truncated or corrupted — try re-exporting from the React DevTools Profiler.`;
  }
  const message = err instanceof Error ? err.message : String(err);
  return `Error: Failed to load render profile from "${absPath}": ${message}`;
}

export function registerLoadRenderProfile(server: McpServer): void {
  server.registerTool(
    'load_render_profile',
    {
      title: 'Load Render Profile',
      description:
        'Load a React DevTools Profiler JSON export. ' +
        'This is the entry point for the manual profiling path: open React DevTools in the browser → Profiler tab → Record → interact → Stop → Export JSON → share the file path here. ' +
        'Returns a profileId for use with get_render_summary, get_slow_components, get_rerender_causes, and the other analysis tools.',
      inputSchema: {
        filePath: z
          .string()
          .describe('Absolute or relative path to the exported React Profiler JSON file'),
      },
    },
    async ({ filePath }) => {
      const absPath = resolve(filePath);

      try {
        const content = await readFile(absPath, 'utf-8');
        const profile = parseRenderProfile(content, absPath);
        storeRenderProfile(profile);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  profileId: profile.id,
                  filename: profile.filename,
                  version: profile.version,
                  commitCount: profile.commits.length,
                  componentCount: profile.components.length,
                  totalCommitDuration: formatMs(profile.totalCommitDuration),
                  nextStep: `call get_render_summary with profileId "${profile.id}"`,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: formatLoadRenderProfileError(err, absPath) }],
          isError: true,
        };
      }
    },
  );
}
