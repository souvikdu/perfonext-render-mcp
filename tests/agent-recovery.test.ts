import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { stopIngestServer } from '../src/ingest/server.js';
import { registerBeginRenderAnalysis } from '../src/tools/begin-render-analysis.js';
import { registerGetCapturedRenders } from '../src/tools/get-captured-renders.js';
import { registerRunRenderCapture } from '../src/tools/run-render-capture.js';
import { registerStopRenderCapture } from '../src/tools/stop-render-capture.js';
import { createToolHandlerStub } from './helpers/tool-stub.js';

describe('render agent recovery', () => {
  afterAll(async () => {
    await stopIngestServer();
  });

  it('no longer mentions start_render_capture in tool schemas', () => {
    const { server, schemas } = createToolHandlerStub();
    registerStopRenderCapture(server);
    registerGetCapturedRenders(server);

    expect(JSON.stringify([...schemas.entries()])).not.toContain('start_render_capture');

    const source = [
      resolve(import.meta.dirname, '../src/tools/get-captured-renders.ts'),
      resolve(import.meta.dirname, '../src/tools/stop-render-capture.ts'),
    ]
      .map((filePath) => readFileSync(filePath, 'utf-8'))
      .join('\n');
    expect(source).not.toContain('start_render_capture');
    expect(source).toContain('begin_render_analysis');
  });

  it('points a zero-commit stop at a new begin_render_analysis session', async () => {
    const { server, call } = createToolHandlerStub();
    registerBeginRenderAnalysis(server);
    registerStopRenderCapture(server);

    const begin = await call('begin_render_analysis', { approach: 'live' });
    const beginPayload = JSON.parse(begin.content[0].text as string);
    expect(beginPayload.sessionId).toBeDefined();

    const stop = await call('stop_render_capture', { sessionId: beginPayload.sessionId });
    const stopPayload = JSON.parse(stop.content[0].text as string);

    expect(stopPayload.commitCount).toBe(0);
    expect(stopPayload.nextStep).toContain('begin_render_analysis');
    expect(stopPayload.nextStep).toMatch(/Do not call stop_render_capture again/);
  });

  it('tells test-suite capture to run Playwright without --headed', async () => {
    const { server, call } = createToolHandlerStub();
    registerBeginRenderAnalysis(server);
    registerRunRenderCapture(server);

    const begin = await call('begin_render_analysis', { approach: 'live' });
    const beginPayload = JSON.parse(begin.content[0].text as string);

    const run = await call('run_render_capture', {
      sessionId: beginPayload.sessionId,
      method: 'test-suite',
    });
    const payload = JSON.parse(run.content[0].text as string);

    expect(payload.instructions).toContain('npx playwright test');
    expect(payload.instructions).not.toMatch(/--headed/);
    expect(payload.instructions).not.toMatch(/headless/i);
  });
});
