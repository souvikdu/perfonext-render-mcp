import { afterEach, describe, expect, it } from 'vitest';

import {
  clearRenderProfiles,
  getRenderProfile,
  requireRenderProfile,
  storeRenderProfile,
} from '../src/store.js';
import type { ParsedRenderProfile } from '../src/parser/types.js';

function buildProfile(id: string): ParsedRenderProfile {
  return {
    id,
    filename: id,
    version: '5',
    rendererId: 1,
    commits: [],
    fiberNodes: [],
    components: [],
    totalCommitDuration: 0,
    totalRenderDuration: 0,
    hasChangeDescriptions: false,
  };
}

describe('requireRenderProfile', () => {
  afterEach(() => {
    clearRenderProfiles();
  });

  it('returns the stored profile when found', () => {
    const profile = buildProfile('exists');
    storeRenderProfile(profile);

    expect(requireRenderProfile('exists')).toBe(profile);
  });

  it('throws a helpful error with the default label when not found', () => {
    expect(() => requireRenderProfile('missing')).toThrow(
      'Profile "missing" not found. Call get_render_summary without a profileId to list all loaded profiles.',
    );
  });

  it('uses a custom label in the error message', () => {
    expect(() => requireRenderProfile('missing', 'Base profile')).toThrow(
      'Base profile "missing" not found. Call get_render_summary without a profileId to list all loaded profiles.',
    );
  });

  it('evicts the oldest profile once the cap is exceeded', () => {
    for (let i = 0; i < 21; i++) {
      storeRenderProfile(buildProfile(`p${i}`));
    }

    expect(getRenderProfile('p0')).toBeUndefined(); // oldest, evicted
    expect(getRenderProfile('p20')).toBeDefined(); // newest, kept
  });
});
