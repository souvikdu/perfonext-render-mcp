import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ingest/server.js', () => ({
  createCaptureSession: vi.fn(),
}));

import { createCaptureSession } from '../src/ingest/server.js';
import { registerBeginRenderAnalysis } from '../src/tools/begin-render-analysis.js';
import { createToolHandlerStub } from './helpers/tool-stub.js';

describe('begin_render_analysis port conflict', () => {
  beforeEach(() => {
    vi.mocked(createCaptureSession).mockReset();
  });

  it('returns a structured error when the ingest port is already in use', async () => {
    vi.mocked(createCaptureSession).mockRejectedValue(
      new Error(
        'Ingest server port 7721 is already in use. Free the port or set PERFONEXT_INGEST_PORT to a different value.',
      ),
    );

    const { server, call } = createToolHandlerStub();
    registerBeginRenderAnalysis(server);

    const result = await call('begin_render_analysis', { approach: 'live' });
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.error).toContain('already in use');
    expect(payload.error).toContain('7721');
  });
});
