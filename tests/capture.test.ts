import { afterAll, describe, expect, it } from 'vitest';

import {
  createCaptureSession,
  getCaptureSession,
  getServerPort,
  stopCaptureSession,
  stopIngestServer,
} from '../src/ingest/server.js';
import { adaptReactScanEvents } from '../src/parser/react-scan-lite.js';

// ---------------------------------------------------------------------------
// Helpers — native react-scan/lite endpoint wire format
// { message, data: { tree, rendererId, ... }, sessionId, timestamp }
// ---------------------------------------------------------------------------

interface NativeTree {
  fiberId?: number;
  name: string;
  depth: number;
  tag?: number;
  actualDuration: number;
  actualStartTime?: number;
  selfBaseDuration: number;
  treeBaseDuration?: number;
  changeDescription?: {
    isFirstMount: boolean;
    props: string[] | null;
    state: boolean;
    context: boolean;
    hooks: number[];
    parent: boolean;
  } | null;
  source?: { fileName: string; lineNumber: number; columnNumber: number } | null;
  ownerName?: string | null;
}

interface NativeCommitBody {
  message: 'commit';
  sessionId: string;
  timestamp: number;
  data: {
    rendererId?: number;
    priorityName?: string;
    laneLabels?: string[];
    tree: NativeTree[];
  };
}

function makeCommit(
  overrides: Partial<{
    sessionId: string;
    commitIndex: number;
    timestamp: number;
    rendererId: number;
    priorityName: string;
    tree: NativeTree[];
  }> = {},
): NativeCommitBody {
  return {
    message: 'commit',
    sessionId: overrides.sessionId ?? 'test-session',
    timestamp: overrides.timestamp ?? 1000,
    data: {
      rendererId: overrides.rendererId ?? 1,
      priorityName: overrides.priorityName ?? 'Normal',
      laneLabels: [],
      tree: overrides.tree ?? [
        {
          fiberId: 1,
          name: 'Button',
          depth: 0,
          tag: 0,
          actualDuration: 8,
          actualStartTime: 100,
          selfBaseDuration: 3,
          treeBaseDuration: 8,
          changeDescription: {
            isFirstMount: false,
            props: ['onClick'],
            state: false,
            context: false,
            hooks: [],
            parent: false,
          },
          source: { fileName: 'src/Button.tsx', lineNumber: 10, columnNumber: 5 },
          ownerName: null,
        },
        {
          fiberId: 2,
          name: 'Icon',
          depth: 1,
          tag: 0,
          actualDuration: 5,
          actualStartTime: 105,
          selfBaseDuration: 5,
          treeBaseDuration: 5,
          changeDescription: {
            isFirstMount: true,
            props: null,
            state: false,
            context: false,
            hooks: [],
            parent: false,
          },
          source: null,
          ownerName: 'Button',
        },
      ],
    },
  };
}

async function postEvents(sessionId: string, events: NativeCommitBody[]): Promise<Response> {
  const port = getServerPort();
  return fetch(`http://127.0.0.1:${port}/ingest/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(events),
  });
}

/** Asserts the ingest server has started before using its port in a request URL. */
function requireServerPort(): number {
  const port = getServerPort();
  expect(port).not.toBeNull();
  return port as number;
}

// ---------------------------------------------------------------------------
// Ingest server — session lifecycle
// ---------------------------------------------------------------------------

describe('ingest server — session lifecycle', () => {
  it('creates a session with active status and a valid endpoint', async () => {
    const session = await createCaptureSession();

    expect(session.status).toBe('active');
    expect(session.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(session.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/ingest\//);
    expect(session.commits).toHaveLength(0);
    expect(session.profilingAvailable).toBeNull();
  });

  it('getCaptureSession returns the same session object', async () => {
    const session = await createCaptureSession();
    const fetched = getCaptureSession(session.sessionId);
    expect(fetched).toBe(session);
  });

  it('stopCaptureSession marks the session as stopped', async () => {
    const session = await createCaptureSession();
    stopCaptureSession(session.sessionId);
    expect(session.status).toBe('stopped');
  });

  it('getCaptureSession returns undefined for unknown session', () => {
    expect(getCaptureSession('does-not-exist')).toBeUndefined();
  });

  it('binds to an OS-assigned ephemeral port, not the default 7721', async () => {
    await createCaptureSession();
    const port = getServerPort();
    expect(port).toBeGreaterThan(0);
    expect(port).not.toBe(7721);
  });

  it('handles concurrent createCaptureSession calls without EADDRINUSE', async () => {
    const [a, b] = await Promise.all([createCaptureSession(), createCaptureSession()]);
    expect(a.status).toBe('active');
    expect(b.status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Ingest server — HTTP endpoint
// ---------------------------------------------------------------------------

describe('ingest server — HTTP endpoint', () => {
  it('accepts a native commit event, normalizes it, and appends it to the session', async () => {
    const session = await createCaptureSession();
    const commit = makeCommit({ sessionId: session.sessionId });

    const res = await postEvents(session.sessionId, [commit]);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { ok: boolean; received: number };
    expect(body.ok).toBe(true);
    expect(body.received).toBe(1);
    expect(session.commits).toHaveLength(1);
    // Verify normalization: self time derived from the tree, state boolean → ['state']
    const stored = session.commits[0];
    expect(stored.fibers).toHaveLength(2);
    expect(stored.fibers[0].selfDuration).toBe(3); // Button 8 - Icon 5
    expect(stored.fibers[0].changeDescription?.isFirstMount).toBe(false);
    expect(stored.duration).toBe(8); // root fiber (depth=0) actualDuration
  });

  it('accepts a native profiling-hooks-status event and updates profilingAvailable', async () => {
    const session = await createCaptureSession();
    const port = getServerPort();

    // Native format: { message: 'profiling-hooks-status', data: { available }, sessionId, timestamp }
    const res = await fetch(`http://127.0.0.1:${port}/ingest/${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'profiling-hooks-status',
        sessionId: session.sessionId,
        timestamp: Date.now(),
        data: { available: false },
      }),
    });
    expect(res.status).toBe(200);
    expect(session.profilingAvailable).toBe(false);
  });

  it('silently ignores unknown event formats (received: 0)', async () => {
    const session = await createCaptureSession();
    const port = getServerPort();

    const res = await fetch(`http://127.0.0.1:${port}/ingest/${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'profiling-hooks-status', available: true }),
    });
    const body = (await res.json()) as { ok: boolean; received: number };
    expect(res.status).toBe(200);
    expect(body.received).toBe(0);
    expect(session.commits).toHaveLength(0);
    expect(session.profilingAvailable).toBeNull(); // unchanged
  });

  it('accepts a batch of multiple events in one POST', async () => {
    const session = await createCaptureSession();
    const commits = [
      makeCommit({ sessionId: session.sessionId }),
      makeCommit({ sessionId: session.sessionId }),
    ];

    const res = await postEvents(session.sessionId, commits);
    expect(res.status).toBe(200);
    expect(session.commits).toHaveLength(2);
  });

  it('returns 410 when posting to a stopped session', async () => {
    const session = await createCaptureSession();
    stopCaptureSession(session.sessionId);

    const res = await postEvents(session.sessionId, [makeCommit()]);
    expect(res.status).toBe(410);
  });

  it('returns 404 for an unknown sessionId', async () => {
    // Ensure server is running by creating any session first.
    await createCaptureSession();
    const port = getServerPort();

    const res = await fetch(`http://127.0.0.1:${port}/ingest/no-such-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid JSON', async () => {
    const session = await createCaptureSession();
    const port = getServerPort();

    const res = await fetch(`http://127.0.0.1:${port}/ingest/${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 413 when the request body exceeds the size cap', async () => {
    const session = await createCaptureSession();
    const port = getServerPort();

    const oversized = 'x'.repeat(21 * 1024 * 1024); // over the 20MB cap
    const res = await fetch(`http://127.0.0.1:${port}/ingest/${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: oversized,
    });
    expect(res.status).toBe(413);
  });

  it('returns 400 for a malformed percent-encoded session id', async () => {
    await createCaptureSession();
    const port = getServerPort();

    const res = await fetch(`http://127.0.0.1:${port}/ingest/%E0%A4%A`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[]',
    });
    expect(res.status).toBe(400);
  });

  it('handles CORS preflight with 204 and echoes a localhost origin', async () => {
    await createCaptureSession();
    const port = getServerPort();

    const res = await fetch(`http://127.0.0.1:${port}/ingest/any`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(res.headers.get('vary')).toBe('Origin');
  });

  it('omits Access-Control-Allow-Origin for a non-localhost origin', async () => {
    await createCaptureSession();
    const port = getServerPort();

    const res = await fetch(`http://127.0.0.1:${port}/ingest/any`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('vary')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ingest server — hardening of the locally exposed HTTP surface
// ---------------------------------------------------------------------------

describe('ingest server — request hardening', () => {
  it('rejects origins that merely embed a loopback hostname', async () => {
    await createCaptureSession();
    const port = getServerPort();

    for (const origin of [
      'http://localhost.evil.example',
      'http://127.0.0.1.evil.example',
      'http://evil.example/?x=http://localhost',
      'null',
    ]) {
      const res = await fetch(`http://127.0.0.1:${port}/ingest/any`, {
        method: 'OPTIONS',
        headers: { Origin: origin },
      });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });

  it('accepts only POST on a valid ingest path', async () => {
    const session = await createCaptureSession();
    const port = getServerPort();

    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(`http://127.0.0.1:${port}/ingest/${session.sessionId}`, { method });
      expect(res.status).toBe(404);
    }
  });

  it('does not route paths outside the single ingest route', async () => {
    const session = await createCaptureSession();
    const port = getServerPort();

    for (const path of [
      '/',
      '/ingest',
      `/ingest/${session.sessionId}/extra`,
      `/ingest/${session.sessionId}%2Fextra`,
      '/../../etc/passwd',
    ]) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '[]',
      });
      expect(res.status).toBe(404);
    }
  });

  it('attributes commits to the session in the URL, never the one claimed in the body', async () => {
    const target = await createCaptureSession();
    const other = await createCaptureSession();

    const res = await postEvents(target.sessionId, [
      makeCommit({ sessionId: other.sessionId, timestamp: 1 }),
    ]);
    expect(res.status).toBe(200);

    expect(getCaptureSession(target.sessionId)?.commits).toHaveLength(1);
    expect(getCaptureSession(target.sessionId)?.commits[0].sessionId).toBe(target.sessionId);
    expect(getCaptureSession(other.sessionId)?.commits).toHaveLength(0);
  });

  it('refuses further events once a session is stopped', async () => {
    const session = await createCaptureSession();
    stopCaptureSession(session.sessionId);

    const res = await postEvents(session.sessionId, [makeCommit({ timestamp: 1 })]);
    expect(res.status).toBe(410);
    expect(getCaptureSession(session.sessionId)?.commits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// react-scan-lite adapter — tested through the full HTTP → session → adapt path
// ---------------------------------------------------------------------------

async function captureAndAdapt(
  bodies: NativeCommitBody[],
): Promise<ReturnType<typeof adaptReactScanEvents>> {
  const session = await createCaptureSession();
  const port = getServerPort();
  await fetch(`http://127.0.0.1:${port}/ingest/${session.sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodies),
  });
  stopCaptureSession(session.sessionId);
  return adaptReactScanEvents(session.commits, session.sessionId);
}

describe('adaptReactScanEvents', () => {
  it('produces a ParsedRenderProfile with correct counts', async () => {
    const profile = await captureAndAdapt([
      makeCommit({ timestamp: 1000 }),
      makeCommit({ timestamp: 2000 }),
    ]);

    expect(profile.filename).toMatch(/^react-scan-session:/);
    expect(profile.version).toBe('5');
    expect(profile.commits).toHaveLength(2);
    // Duration is derived from root fiber (depth=0) actualDuration = 8
    expect(profile.commits[0].duration).toBe(8);
    expect(profile.commits[1].duration).toBe(8);
    expect(profile.totalCommitDuration).toBe(16);
  });

  it('maps fiber events to measurements with correct phase', async () => {
    const profile = await captureAndAdapt([makeCommit()]);

    const m0 = profile.commits[0].measurements[0];
    const m1 = profile.commits[0].measurements[1];

    expect(m0.componentName).toBe('Button');
    expect(m0.phase).toBe('update'); // isFirstMount: false
    expect(m0.actualDuration).toBe(8);
    expect(m0.selfDuration).toBe(3); // Button 8 - Icon 5

    expect(m1.componentName).toBe('Icon');
    expect(m1.phase).toBe('mount'); // isFirstMount: true
    expect(m1.actualDuration).toBe(5);
  });

  it('reports totalRenderDuration as real work, never more than the time committed', async () => {
    const profile = await captureAndAdapt([makeCommit(), makeCommit()]);

    // Self times partition each commit, so the session total cannot exceed the
    // time React actually spent committing — inclusive durations would double-count
    // every ancestor and report a multiple of it.
    expect(profile.totalRenderDuration).toBe(profile.totalCommitDuration);
  });

  it('deduplicates fiberNodes across commits', async () => {
    const profile = await captureAndAdapt([
      makeCommit(),
      makeCommit(), // same fiberIds 1 and 2
    ]);
    const ids = profile.fiberNodes.map((f) => f.fiberId);
    expect(ids).toHaveLength(new Set(ids).size);
    expect(ids).toHaveLength(2);
  });

  it('builds component stats aggregated across commits', async () => {
    const profile = await captureAndAdapt([makeCommit(), makeCommit()]);

    const button = profile.components.find((c) => c.componentName === 'Button');
    expect(button).toBeDefined();
    expect(button!.renderCount).toBe(2);
    expect(button!.totalActualDuration).toBeCloseTo(16);
    expect(button!.commitIndices).toEqual([0, 1]);
  });

  it('handles empty commits array gracefully', () => {
    const profile = adaptReactScanEvents([], 'empty-session');
    expect(profile.commits).toHaveLength(0);
    expect(profile.components).toHaveLength(0);
    expect(profile.totalCommitDuration).toBe(0);
  });

  it('maps state:boolean and hooks:number[] from wire format to internal model', async () => {
    const session = await createCaptureSession();
    const port = getServerPort();

    await fetch(`http://127.0.0.1:${port}/ingest/${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'commit',
        sessionId: session.sessionId,
        timestamp: 1000,
        data: {
          rendererId: 1,
          tree: [
            {
              fiberId: 10,
              name: 'Counter',
              depth: 0,
              actualDuration: 4,
              selfBaseDuration: 4,
              changeDescription: {
                isFirstMount: false,
                props: null,
                state: true, // boolean in real API
                context: false,
                hooks: [0, 2], // indices in real API
                parent: false,
              },
              source: null,
            },
          ],
        },
      }),
    });

    // Assert on the normalized session commit — state:true → ['state'], hooks:[0,2] → ['hook[0]','hook[2]']
    const fiber = session.commits[0].fibers[0];
    expect(fiber.name).toBe('Counter');
    expect(fiber.selfDuration).toBe(4); // leaf root: all of its actualDuration is self time
    expect(fiber.changeDescription?.state).toEqual(['state']); // true → ['state']
    expect(fiber.changeDescription?.hooks).toEqual(['hook[0]', 'hook[2]']); // indices → names
    expect(fiber.changeDescription?.context).toBeNull(); // false → null
    expect(fiber.changeDescription?.props).toBeNull();
  });

  it('derives self time from the fiber tree so self durations partition the commit', async () => {
    const session = await createCaptureSession();
    const port = requireServerPort();

    await fetch(`http://127.0.0.1:${port}/ingest/${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'commit',
        sessionId: session.sessionId,
        timestamp: 1000,
        data: {
          rendererId: 1,
          // App(12) -> [ List(7) -> [ Row(3) -> [ Deep(2) ] ], Footer(1), Stale(50) ]
          // Deep is reported at depth 4, not 3: depth is the depth in the full tree.
          // Stale bailed out — its actualStartTime predates the render pass, so its
          // actualDuration is left over from an earlier commit and must be ignored.
          // selfBaseDuration is deliberately wrong here — it is an unmemoized base
          // estimate, so summing it would report 24ms of work in a 12ms commit.
          tree: [
            { fiberId: 20, name: 'App', depth: 0, actualDuration: 12, actualStartTime: 100, selfBaseDuration: 11 }, // prettier-ignore
            { fiberId: 21, name: 'List', depth: 1, actualDuration: 7, actualStartTime: 101, selfBaseDuration: 7 }, // prettier-ignore
            { fiberId: 22, name: 'Row', depth: 2, actualDuration: 3, actualStartTime: 102, selfBaseDuration: 3 }, // prettier-ignore
            { fiberId: 23, name: 'Deep', depth: 4, actualDuration: 2, actualStartTime: 103, selfBaseDuration: 2 }, // prettier-ignore
            { fiberId: 24, name: 'Footer', depth: 1, actualDuration: 1, actualStartTime: 104, selfBaseDuration: 1 }, // prettier-ignore
            { fiberId: 25, name: 'Stale', depth: 1, actualDuration: 50, actualStartTime: 5, selfBaseDuration: 50 }, // prettier-ignore
          ],
        },
      }),
    });

    const commit = session.commits[0];
    const selfByName = Object.fromEntries(commit.fibers.map((f) => [f.name, f.selfDuration]));
    expect(selfByName).toEqual({ App: 4, List: 4, Row: 1, Deep: 2, Footer: 1, Stale: 0 });
    expect(commit.fibers.reduce((sum, f) => sum + (f.selfDuration ?? 0), 0)).toBe(commit.duration);
  });

  it('sums all depth-0 fibers into commit duration instead of using only the first', async () => {
    const session = await createCaptureSession();
    const port = requireServerPort();

    await fetch(`http://127.0.0.1:${port}/ingest/${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'commit',
        sessionId: session.sessionId,
        timestamp: 1000,
        data: {
          rendererId: 1,
          tree: [
            { fiberId: 30, name: 'RootA', depth: 0, actualDuration: 6, selfBaseDuration: 6 },
            { fiberId: 31, name: 'RootB', depth: 0, actualDuration: 4, selfBaseDuration: 4 },
          ],
        },
      }),
    });

    expect(session.commits[0].duration).toBe(10); // 6 + 4, not just the first root's 6
  });

  it('coerces non-finite or negative wire durations to 0 instead of propagating them', async () => {
    const session = await createCaptureSession();
    const port = requireServerPort();

    await fetch(`http://127.0.0.1:${port}/ingest/${session.sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'commit',
        sessionId: session.sessionId,
        timestamp: 1000,
        data: {
          rendererId: 1,
          tree: [
            {
              fiberId: 40,
              name: 'BadData',
              depth: 0,
              actualDuration: Number.NaN,
              selfBaseDuration: -5,
            },
          ],
        },
      }),
    });

    const fiber = session.commits[0].fibers[0];
    expect(fiber.actualDuration).toBe(0);
    expect(fiber.selfDuration).toBe(0);
  });
});

describe('adaptReactScanEvents — data quality', () => {
  it('marks hasChangeDescriptions true for a parent-only rerender with no own diff', () => {
    const profile = adaptReactScanEvents(
      [
        {
          type: 'commit',
          sessionId: 'test-session',
          commitIndex: 0,
          rootId: 1,
          duration: 4,
          timestamp: 1000,
          fibers: [
            {
              fiberId: 1,
              name: 'Child',
              depth: 0,
              actualDuration: 4,
              selfDuration: 4,
              changeDescription: {
                isFirstMount: false,
                props: null,
                state: null,
                context: null,
                hooks: null,
                parent: true,
              },
              source: null,
              parentId: null,
            },
          ],
        },
      ],
      'test-session',
    );

    expect(profile.hasChangeDescriptions).toBe(true);
  });
});

afterAll(async () => {
  await stopIngestServer();
});
