import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compareRenders,
  getHotCommits,
  getRenderSummary,
  getRerenderCauses,
  getSlowComponents,
} from '../src/parser/analysis.js';
import { parseRenderProfile } from '../src/parser/react-profile.js';
import type { ComponentStats, ParsedRenderProfile } from '../src/parser/types.js';

const fixturePath = resolve(import.meta.dirname, 'fixtures/sample-render-profile.json');
const dataForRootsFixturePath = resolve(
  import.meta.dirname,
  'fixtures/sample-render-profile-dataforroots.json',
);

describe('render profile parser', () => {
  it('parses a valid React DevTools profiler export', async () => {
    const content = await readFile(fixturePath, 'utf-8');
    const profile = parseRenderProfile(content, 'sample-render-profile.json');

    expect(profile.filename).toBe('sample-render-profile.json');
    expect(profile.version).toBe('5');
    expect(profile.commits).toHaveLength(3);
    expect(profile.components.length).toBeGreaterThan(0);
    expect(profile.totalCommitDuration).toBeCloseTo(26.4, 1);
  });

  it('rejects invalid JSON payloads', () => {
    expect(() => parseRenderProfile('{', 'bad.json')).toThrow('Invalid render profile JSON');
    expect(() => parseRenderProfile('{}', 'bad.json')).toThrow('Invalid render profile format');
  });

  it('parses profiles that store commits under dataForRoots', async () => {
    const content = await readFile(dataForRootsFixturePath, 'utf-8');
    const profile = parseRenderProfile(content, 'sample-render-profile-dataforroots.json');

    expect(profile.commits).toHaveLength(2);
    expect(profile.components.length).toBe(2);
    expect(profile.components[0].componentName).toBe('SearchResults');
  });
});

describe('render profile analysis', () => {
  it('returns a summary sorted by total self duration', async () => {
    const content = await readFile(fixturePath, 'utf-8');
    const profile = parseRenderProfile(content, 'sample-render-profile.json');
    const summary = getRenderSummary(profile, 3);

    expect(summary.commitCount).toBe(3);
    expect(summary.topComponents[0].componentName).toBe('ProductList');
    expect(summary.topComponents[0].totalSelfDuration).toBeGreaterThanOrEqual(
      summary.topComponents[1].totalSelfDuration,
    );
    expect(summary.hotCommits[0].commitIndex).toBe(0);
    expect(summary.hotCommits[0].topComponents.length).toBeGreaterThan(0);
    expect(summary.hotCommits[0].topComponents[0].componentName).toBe('ProductList');
    expect(Array.isArray(summary.issues)).toBe(true);
  });

  it('finds slow components and rerender signals', async () => {
    const content = await readFile(fixturePath, 'utf-8');
    const profile = parseRenderProfile(content, 'sample-render-profile.json');

    const slowComponents = getSlowComponents(profile, 2);
    const causes = getRerenderCauses(profile, 5);

    expect(slowComponents.map((component) => component.componentName)).toContain('ProductList');
    expect(causes.length).toBeGreaterThan(0);
    expect(causes.map((cause) => cause.componentName)).toContain('SearchResults');
    expect(causes[0].evidence.length).toBeGreaterThan(0);
    expect(causes[0].evidence[0].detail.length).toBeGreaterThan(0);
    expect(['low', 'medium', 'high']).toContain(causes[0].confidence);
    expect(['low', 'medium', 'high']).toContain(causes[0].scoreBand);
  });

  it('ranks hot commits with top components inside each commit', async () => {
    const content = await readFile(fixturePath, 'utf-8');
    const profile = parseRenderProfile(content, 'sample-render-profile.json');
    const hotCommits = getHotCommits(profile, 2, 2);

    expect(hotCommits).toHaveLength(2);
    expect(hotCommits[0].duration).toBeGreaterThanOrEqual(hotCommits[1].duration);
    expect(hotCommits[0].topComponents).toHaveLength(2);
    expect(hotCommits[0].topComponents[0].shareOfCommitWork).toBeGreaterThan(0);
    expect(Array.isArray(hotCommits[0].updaterComponentNames)).toBe(true);
    expect(typeof hotCommits[0].interpretation).toBe('string');
    expect(hotCommits[0].interpretation.length).toBeGreaterThan(0);
  });

  it('labels a commit dominated by one component vs. one spread across several', async () => {
    const content = await readFile(fixturePath, 'utf-8');
    const profile = parseRenderProfile(content, 'sample-render-profile.json');
    const hotCommits = getHotCommits(profile, profile.commits.length, 5);

    for (const commit of hotCommits) {
      const topShare = commit.topComponents[0]?.shareOfCommitWork ?? 0;
      if (topShare >= 0.5) {
        expect(commit.interpretation).toContain('dominated by one component');
      }
    }
  });

  it('satisfies share of commit work invariants', async () => {
    const content = await readFile(fixturePath, 'utf-8');
    const profile = parseRenderProfile(content, 'sample-render-profile.json');
    const hotCommits = getHotCommits(profile, profile.commits.length, 10);

    for (const commit of hotCommits) {
      const totalShare = commit.topComponents.reduce((sum, c) => sum + c.shareOfCommitWork, 0);
      expect(totalShare).toBeCloseTo(1, 4);
    }
  });

  it('compares two render profiles and reports regressions', () => {
    const baseProfile = parseRenderProfile(
      JSON.stringify({
        version: 5,
        dataForRoots: [
          {
            commitData: [
              {
                duration: 5,
                fiberActualDurations: [
                  [1, 5],
                  [2, 2],
                ],
                fiberSelfDurations: [
                  [1, 2],
                  [2, 2],
                ],
                priorityLevel: 'Normal',
                timestamp: 100,
              },
            ],
            displayName: 'App',
            initialTreeBaseDurations: [
              [1, 3],
              [2, 2],
            ],
            rootID: 1,
            snapshots: [
              [1, { displayName: 'App', children: [2] }],
              [2, { displayName: 'List', children: [] }],
            ],
          },
        ],
      }),
      'base.json',
    );

    const currentProfile = parseRenderProfile(
      JSON.stringify({
        version: 5,
        dataForRoots: [
          {
            commitData: [
              {
                duration: 9,
                fiberActualDurations: [
                  [1, 9],
                  [2, 6],
                  [3, 4],
                ],
                fiberSelfDurations: [
                  [1, 3],
                  [2, 6],
                  [3, 4],
                ],
                priorityLevel: 'Normal',
                timestamp: 100,
              },
            ],
            displayName: 'App',
            initialTreeBaseDurations: [
              [1, 3],
              [2, 2],
              [3, 1],
            ],
            rootID: 1,
            snapshots: [
              [1, { displayName: 'App', children: [2, 3] }],
              [2, { displayName: 'List', children: [] }],
              [3, { displayName: 'FilterBar', children: [] }],
            ],
          },
        ],
      }),
      'current.json',
    );

    const comparison = compareRenders(baseProfile, currentProfile, 10, 0);

    expect(comparison.regressions.some((entry) => entry.componentName === 'App')).toBe(true);
    expect(comparison.regressions.some((entry) => entry.componentName === 'List')).toBe(true);
    expect(comparison.added.some((entry) => entry.componentName === 'FilterBar')).toBe(true);
  });

  it('counts nested updates from commit updaters field', () => {
    const profileWithUpdaters = JSON.stringify({
      version: 5,
      dataForRoots: [
        {
          commitData: [
            {
              duration: 5,
              fiberActualDurations: [
                [1, 5],
                [2, 3],
              ],
              fiberSelfDurations: [
                [1, 2],
                [2, 3],
              ],
              priorityLevel: 'Normal',
              timestamp: 100,
              updaters: null,
            },
            {
              duration: 4,
              fiberActualDurations: [
                [1, 4],
                [2, 2],
              ],
              fiberSelfDurations: [
                [1, 2],
                [2, 2],
              ],
              priorityLevel: 'Normal',
              timestamp: 200,
              updaters: [{ id: 2, displayName: 'Button', key: null, type: 5 }],
            },
          ],
          displayName: 'App',
          initialTreeBaseDurations: [
            [1, 3],
            [2, 2],
          ],
          rootID: 1,
          snapshots: [
            [1, { displayName: 'App', children: [2] }],
            [2, { displayName: 'Button', children: [] }],
          ],
        },
      ],
    });

    const profile = parseRenderProfile(profileWithUpdaters, 'updaters-test.json');
    const button = profile.components.find((c) => c.componentName === 'Button');
    expect(button?.nestedUpdateCount).toBe(1);
    const app = profile.components.find((c) => c.componentName === 'App');
    expect(app?.nestedUpdateCount).toBe(0);
    expect(profile.commits[1].updaterComponentNames).toContain('Button');
  });

  it('assigns globally sequential commit indices across multiple roots', () => {
    const multiRootProfile = JSON.stringify({
      version: 5,
      dataForRoots: [
        {
          commitData: [
            {
              duration: 3,
              fiberActualDurations: [[1, 3]],
              fiberSelfDurations: [[1, 3]],
              priorityLevel: null,
              timestamp: 10,
            },
            {
              duration: 4,
              fiberActualDurations: [[1, 4]],
              fiberSelfDurations: [[1, 4]],
              priorityLevel: null,
              timestamp: 20,
            },
          ],
          displayName: 'RootA',
          initialTreeBaseDurations: [],
          rootID: 1,
          snapshots: [[1, { displayName: 'CompA', children: [] }]],
        },
        {
          commitData: [
            {
              duration: 5,
              fiberActualDurations: [[2, 5]],
              fiberSelfDurations: [[2, 5]],
              priorityLevel: null,
              timestamp: 30,
            },
          ],
          displayName: 'RootB',
          initialTreeBaseDurations: [],
          rootID: 2,
          snapshots: [[2, { displayName: 'CompB', children: [] }]],
        },
      ],
    });

    const profile = parseRenderProfile(multiRootProfile, 'multi-root.json');
    expect(profile.commits).toHaveLength(3);
    expect(profile.commits.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it('filters components by minDuration in getRerenderCauses', async () => {
    const content = await readFile(fixturePath, 'utf-8');
    const profile = parseRenderProfile(content, 'sample-render-profile.json');

    const all = getRerenderCauses(profile, 10, 0);
    const filtered = getRerenderCauses(profile, 10, 50);
    expect(filtered.length).toBeLessThanOrEqual(all.length);
    expect(filtered.every((c) => c.totalActualDuration >= 50)).toBe(true);
  });

  it('sorts slow components by average duration when sortBy=average', async () => {
    const content = await readFile(fixturePath, 'utf-8');
    const profile = parseRenderProfile(content, 'sample-render-profile.json');

    const byAvg = getSlowComponents(profile, 10, 'average');
    for (let i = 1; i < byAvg.length; i++) {
      expect(byAvg[i - 1].averageActualDuration).toBeGreaterThanOrEqual(
        byAvg[i].averageActualDuration,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// getRerenderCauses — severity banding and commit-spread threshold scaling
// ---------------------------------------------------------------------------

/** Builds a minimal profile with `totalCommits` commits, where the tracked component
 *  renders in the first `appearances` of them (defaults to every commit). */
function buildSyntheticProfile(
  totalCommits: number,
  totalActualDuration: number,
  appearances: number = totalCommits,
) {
  if (appearances < 1) {
    throw new Error('buildSyntheticProfile requires appearances >= 1');
  }
  const perRenderDuration = totalActualDuration / appearances;
  const commits = Array.from({ length: totalCommits }, (_, index) => ({
    index,
    rootId: 1,
    duration: index < appearances ? perRenderDuration : 0,
    timestamp: index * 100,
    priorityLevel: 'Normal',
    measurements:
      index < appearances
        ? [
            {
              fiberId: 1,
              rootId: 1,
              componentName: 'Chatty',
              phase: 'update',
              actualDuration: perRenderDuration,
              selfDuration: perRenderDuration,
              startTime: index * 100,
              commitTime: index * 100,
              renderCount: 1,
              commitIndex: index,
              isNestedUpdate: false,
            },
          ]
        : [],
    updaterComponentNames: [],
  }));

  return {
    id: 'synthetic',
    filename: 'synthetic',
    version: '5',
    rendererId: 1,
    commits,
    fiberNodes: [],
    components: [
      {
        componentName: 'Chatty',
        renderCount: appearances,
        mountCount: 0,
        updateCount: appearances,
        nestedUpdateCount: 0,
        totalActualDuration,
        totalSelfDuration: totalActualDuration,
        maxActualDuration: perRenderDuration,
        commitIndices: commits.slice(0, appearances).map((c) => c.index),
      },
    ],
    totalCommitDuration: commits.reduce((s, c) => s + c.duration, 0),
    totalRenderDuration: totalActualDuration,
    hasChangeDescriptions: false,
  };
}

describe('getRerenderCauses — severity tied to absolute cost', () => {
  it('does not label a high-frequency, negligible-cost component as high severity', () => {
    // 15 renders, 100% updates, present in every commit, but only 3.3ms total —
    // the exact shape that previously scored ~7.0/"high" on frequency alone.
    const profile = buildSyntheticProfile(15, 3.3);
    const [cause] = getRerenderCauses(profile, 1);

    expect(cause.score).toBeGreaterThanOrEqual(6); // frequency signals still score high
    expect(cause.scoreBand).not.toBe('high'); // but absolute cost is too small for "high"
  });

  it('labels a high-frequency, high-cost component as high severity', () => {
    const profile = buildSyntheticProfile(15, 17.4);
    const [cause] = getRerenderCauses(profile, 1);

    expect(cause.scoreBand).toBe('high');
  });

  it('scales the wide-commit-spread threshold to the profile commit count', () => {
    const small = buildSyntheticProfile(3, 20);
    const large = buildSyntheticProfile(40, 20, 3); // same 3 appearances, but 40 total commits

    const [smallCause] = getRerenderCauses(small, 1);
    const [largeCause] = getRerenderCauses(large, 1);

    const smallSpread = smallCause.evidence.find((e) => e.signal === 'wide-commit-spread');
    const largeSpread = largeCause.evidence.find((e) => e.signal === 'wide-commit-spread');

    // Present in 3 of 3 commits still trips the floor threshold (3).
    expect(smallSpread?.threshold).toBe(3);
    // Present in only 3 of 40 commits should NOT trip a threshold scaled to commit count.
    expect(largeSpread).toBeUndefined();
  });

  it('still triggers wide-commit-spread on a very short session (fewer than 3 commits)', () => {
    // With a fixed floor of 3 this could never fire for a 2-commit capture,
    // even when the component rendered in every single commit.
    const profile = buildSyntheticProfile(2, 10);
    const [cause] = getRerenderCauses(profile, 1);

    const spread = cause.evidence.find((e) => e.signal === 'wide-commit-spread');
    expect(spread?.threshold).toBe(2);
    expect(spread?.observed).toBe(2);
  });

  it('rejects an appearances count below 1 rather than producing NaN/Infinity', () => {
    expect(() => buildSyntheticProfile(5, 10, 0)).toThrow('appearances >= 1');
  });
});

// ---------------------------------------------------------------------------
// getSlowComponents — internal-component filtering
// ---------------------------------------------------------------------------

function buildComponent(
  name: string,
  totalActualDuration: number,
  commitIndices: number[],
): ComponentStats {
  return {
    componentName: name,
    renderCount: commitIndices.length,
    mountCount: 0,
    updateCount: commitIndices.length,
    nestedUpdateCount: 0,
    totalActualDuration,
    totalSelfDuration: totalActualDuration,
    maxActualDuration: totalActualDuration / commitIndices.length,
    commitIndices,
  };
}

function buildMultiComponentProfile(components: ComponentStats[]): ParsedRenderProfile {
  return {
    id: 'synthetic-multi',
    filename: 'synthetic-multi',
    version: '5',
    rendererId: 1,
    commits: [],
    fiberNodes: [],
    components,
    totalCommitDuration: 0,
    totalRenderDuration: components.reduce((s, c) => s + c.totalActualDuration, 0),
    hasChangeDescriptions: false,
  };
}

describe('getSlowComponents — internal filtering', () => {
  it('excludes internal framework boundary components like __next_metadata_boundary__', () => {
    const profile = buildMultiComponentProfile([
      buildComponent('__next_metadata_boundary__', 5, [0]),
      buildComponent('RealComponent', 10, [0]),
    ]);

    const slow = getSlowComponents(profile, 10);
    expect(slow.map((entry) => entry.componentName)).toEqual(['RealComponent']);
  });
});

describe('getRenderSummary — minified-name detection', () => {
  it('warns when most component names look minified (production build)', () => {
    const profile = buildMultiComponentProfile([
      buildComponent('O', 10, [0]),
      buildComponent('P', 10, [0]),
      buildComponent('R', 10, [0]),
      buildComponent('LineChart', 10, [0]),
    ]);

    const summary = getRenderSummary(profile);
    expect(summary.warnings.some((w) => w.includes('look minified'))).toBe(true);
  });

  it('does not warn when component names look normal', () => {
    const profile = buildMultiComponentProfile([
      buildComponent('TrailExplorer', 10, [0]),
      buildComponent('SearchInput', 10, [0]),
      buildComponent('RegionSelect', 10, [0]),
    ]);

    const summary = getRenderSummary(profile);
    expect(summary.warnings.some((w) => w.includes('look minified'))).toBe(false);
  });

  it('does not warn on a small component count even if all names are short', () => {
    const profile = buildMultiComponentProfile([buildComponent('O', 10, [0])]);

    const summary = getRenderSummary(profile);
    expect(summary.warnings.some((w) => w.includes('look minified'))).toBe(false);
  });
});
