import type { ParsedRenderProfile } from './parser/types.js';

const profiles = new Map<string, ParsedRenderProfile>();

export function storeRenderProfile(profile: ParsedRenderProfile): void {
  profiles.set(profile.id, profile);
}

/** Test-only teardown hook — clears all stored profiles so test order can't leak state. */
export function clearRenderProfiles(): void {
  profiles.clear();
}

export function getRenderProfile(id: string): ParsedRenderProfile | undefined {
  return profiles.get(id);
}

/** Looks up a profile or throws a consistent, actionable error. `label` customizes
 *  the error for call sites juggling more than one profile id (e.g. compare_renders). */
export function requireRenderProfile(id: string, label = 'Profile'): ParsedRenderProfile {
  const profile = profiles.get(id);
  if (!profile) {
    throw new Error(
      `${label} "${id}" not found. Call get_render_summary without a profileId to list all loaded profiles.`,
    );
  }
  return profile;
}

export function listRenderProfiles(): Array<{
  id: string;
  filename: string;
  commitCount: number;
  componentCount: number;
  totalCommitDuration: number;
}> {
  return Array.from(profiles.values()).map((profile) => ({
    id: profile.id,
    filename: profile.filename,
    commitCount: profile.commits.length,
    componentCount: profile.components.length,
    totalCommitDuration: profile.totalCommitDuration,
  }));
}
