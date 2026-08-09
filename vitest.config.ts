import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Ephemeral port — prevents EADDRINUSE when a real render-mcp instance is
    // already running on the default 7721 (e.g. inside VS Code).
    env: {
      PERFONEXT_INGEST_PORT: '0',
    },
  },
});
