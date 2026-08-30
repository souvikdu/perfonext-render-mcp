import type {
  FiberNode,
  HotCommitComponentSummary,
  HotCommitSummary,
  ParsedRenderProfile,
  RenderCommit,
  RenderComparison,
  RenderDiffEntry,
  RenderIssue,
  RenderIssueSeverity,
  RenderMeasurement,
  RenderPropagationPath,
  RenderSummaryEntry,
  RerenderCause,
  RerenderConfidence,
  RerenderEvidence,
  RerenderScoreBand,
} from './types.js';

// Share of session render self-time at which a component's frequency signals carry
// full weight. Below it the score scales down, so cost is part of the score itself
// rather than a hidden gate applied after the fact.
const COST_SATURATION_SHARE = 0.1;

// One frame at 60fps. A commit faster than this cannot drop a frame, so being 1.5x the average
// is arithmetic, not a performance problem — without this floor every healthy session reports
// spikes purely because some commit has to be above the mean.
const COMMIT_SPIKE_FLOOR_MS = 16;

function getScoreBand(score: number): RerenderScoreBand {
  if (score >= 6) {
    return 'high';
  }

  if (score >= 3) {
    return 'medium';
  }

  return 'low';
}

/** Returns true for React host (DOM/SVG) elements — first character is lowercase. */
function isHostElement(name: string): boolean {
  const first = name.charCodeAt(0);
  return first >= 97 /* a */ && first <= 122; /* z */
}

/** Returns true for unnamed/anonymous components that can't be actionably diagnosed. */
function isAnonymousComponent(name: string): boolean {
  return name === 'Anonymous' || name.startsWith('(fiber:');
}

/** Returns true for internal framework boundary markers (e.g. `__next_metadata_boundary__`)
 *  that aren't user code and can't be optimized. */
function isInternalComponent(name: string): boolean {
  return /^__.+__$/.test(name);
}

/** Returns true for named React components that appear in ranked analysis output. */
export function isAnalyzableComponent(name: string): boolean {
  return !isHostElement(name) && !isAnonymousComponent(name) && !isInternalComponent(name);
}

function getConfidence(evidenceCount: number): RerenderConfidence {
  if (evidenceCount >= 3) {
    return 'high';
  }

  if (evidenceCount >= 2) {
    return 'medium';
  }

  return 'low';
}

function getSeverityRank(severity: RenderIssueSeverity): number {
  if (severity === 'high') {
    return 3;
  }

  if (severity === 'medium') {
    return 2;
  }

  return 1;
}

function getCommitSelfDuration(measurements: RenderMeasurement[]): number {
  return measurements.reduce((sum, measurement) => sum + measurement.selfDuration, 0);
}

function getMeasurementsTotalActualDuration(measurements: RenderMeasurement[]): number {
  return measurements.reduce((sum, measurement) => sum + measurement.actualDuration, 0);
}

function getFiberNodeMap(profile: ParsedRenderProfile, rootId?: number): Map<number, FiberNode> {
  const nodes =
    rootId == null
      ? profile.fiberNodes
      : profile.fiberNodes.filter((node) => node.rootId === rootId);

  return new Map(nodes.map((node) => [node.fiberId, node]));
}

function getMeasurementMap(commit: RenderCommit): Map<number, RenderMeasurement> {
  return new Map(commit.measurements.map((measurement) => [measurement.fiberId, measurement]));
}

function getCommitTopComponents(commit: RenderCommit, limit: number): HotCommitComponentSummary[] {
  const components = new Map<string, HotCommitComponentSummary>();
  const totalCommitSelfDuration = getCommitSelfDuration(commit.measurements);

  for (const measurement of commit.measurements) {
    const existing = components.get(measurement.componentName) ?? {
      componentName: measurement.componentName,
      actualDuration: 0,
      selfDuration: 0,
      renderCount: 0,
      shareOfCommitWork: 0,
    };

    existing.actualDuration += measurement.actualDuration;
    existing.selfDuration += measurement.selfDuration;
    existing.renderCount += measurement.renderCount;
    components.set(measurement.componentName, existing);
  }

  return Array.from(components.values())
    .filter((component) => isAnalyzableComponent(component.componentName))
    .sort((left, right) => right.selfDuration - left.selfDuration)
    .slice(0, limit)
    .map((component) => ({
      ...component,
      shareOfCommitWork:
        totalCommitSelfDuration > 0 ? component.selfDuration / totalCommitSelfDuration : 0,
    }));
}

function getCommitByIndex(
  profile: ParsedRenderProfile,
  commitIndex: number,
): RenderCommit | undefined {
  return profile.commits.find((commit) => commit.index === commitIndex);
}

/** One-line takeaway for where a commit's cost is concentrated, derived from the
 *  same shareOfCommitWork data already computed for topComponents. */
function getConcentrationInterpretation(topComponents: HotCommitComponentSummary[]): string {
  const topComponentShare = topComponents[0]?.shareOfCommitWork ?? 0;
  const topThreeShare = topComponents
    .slice(0, 3)
    .reduce((sum, component) => sum + component.shareOfCommitWork, 0);

  if (topComponentShare >= 0.5) {
    return 'This commit is dominated by one component, so investigate that component before the rest of the tree.';
  }
  if (topThreeShare >= 0.8) {
    return 'This commit is concentrated in a small set of components, so the spike is likely localized to one subtree.';
  }
  return 'This commit spreads work across several components, which often points to broader parent-to-child rerender propagation.';
}

export function getHotCommits(
  profile: ParsedRenderProfile,
  limit = 10,
  componentLimit = 3,
  priorityLevel?: string,
): HotCommitSummary[] {
  return profile.commits
    .filter((commit) => priorityLevel == null || commit.priorityLevel === priorityLevel)
    .map((commit) => {
      const topComponents = getCommitTopComponents(commit, componentLimit);
      return {
        commitIndex: commit.index,
        rootId: commit.rootId,
        duration: commit.duration,
        totalSelfDuration: getCommitSelfDuration(commit.measurements),
        totalActualDuration: getMeasurementsTotalActualDuration(commit.measurements),
        timestamp: commit.timestamp,
        priorityLevel: commit.priorityLevel,
        measurementCount: commit.measurements.length,
        topComponents,
        // Omitted when empty: react-scan/lite live capture never reports updaters, and an
        // empty array reads as "nothing triggered this commit" rather than "not recorded".
        ...(commit.updaterComponentNames.length > 0
          ? { updaterComponentNames: commit.updaterComponentNames }
          : {}),
        interpretation: getConcentrationInterpretation(topComponents),
      };
    })
    .sort((left, right) => {
      if (right.duration !== left.duration) {
        return right.duration - left.duration;
      }

      return right.totalActualDuration - left.totalActualDuration;
    })
    .slice(0, limit);
}

export function getRenderSummary(
  profile: ParsedRenderProfile,
  limit = 10,
): {
  profileId: string;
  filename: string;
  version: string;
  rendererId: number | null;
  commitCount: number;
  componentCount: number;
  totalCommitDuration: number;
  totalRenderDuration: number;
  topComponents: RenderSummaryEntry[];
  hotCommits: HotCommitSummary[];
  issues: RenderIssue[];
  warnings: string[];
  dataQuality: 'heuristic' | 'exact';
} {
  const anonymousNames = profile.components
    .filter((c) => isAnonymousComponent(c.componentName))
    .map((c) => c.componentName);
  const uniqueAnonymous = [...new Set(anonymousNames)];

  const analyzableNames = profile.components
    .map((c) => c.componentName)
    .filter((name) => isAnalyzableComponent(name));
  // 1-2 letter names are the signature of a production build mangling displayName —
  // real components essentially never end up this short on their own.
  const minifiedNames = analyzableNames.filter((name) => /^[A-Za-z]{1,2}$/.test(name));

  const warnings: string[] = [];
  if (uniqueAnonymous.length > 0) {
    warnings.push(
      `${uniqueAnonymous.length} unnamed component${uniqueAnonymous.length > 1 ? 's' : ''} found (e.g. "Anonymous"). ` +
        `These are excluded from analysis. Add a displayName or convert arrow functions to named function expressions to get actionable results.`,
    );
  }
  if (analyzableNames.length >= 3 && minifiedNames.length / analyzableNames.length >= 0.3) {
    warnings.push(
      `${minifiedNames.length} of ${analyzableNames.length} component names look minified (e.g. "${minifiedNames[0]}"). ` +
        'This is expected when capturing against `next build --profile` — production minification strips ' +
        "displayName info regardless of the profiling flag, so findings naming these components aren't " +
        "actionable as-is. If you don't need production-accurate timings, capture against `next dev` instead " +
        'for real names; otherwise re-run the capture with `includeFiberSource: true` (see begin_render_analysis), ' +
        "which populates each entry's `source` field so minified names can be mapped back to a file.",
    );
  }

  return {
    profileId: profile.id,
    filename: profile.filename,
    version: profile.version,
    rendererId: profile.rendererId,
    commitCount: profile.commits.length,
    componentCount: profile.components.filter((c) => isAnalyzableComponent(c.componentName)).length,
    totalCommitDuration: profile.totalCommitDuration,
    totalRenderDuration: profile.totalRenderDuration,
    hotCommits: getHotCommits(profile, Math.min(3, profile.commits.length), 3),
    topComponents: getSlowComponents(profile, limit),
    issues: detectRenderIssues(profile, 5),
    warnings,
    dataQuality: profile.hasChangeDescriptions ? 'exact' : 'heuristic',
  };
}

export function getSlowComponents(
  profile: ParsedRenderProfile,
  limit = 10,
  sortBy: 'total' | 'average' | 'max' = 'total',
  minSelfDuration = 0,
): RenderSummaryEntry[] {
  const entries: RenderSummaryEntry[] = profile.components
    .filter(
      (component) =>
        isAnalyzableComponent(component.componentName) &&
        // A component that cost nothing measurable should not occupy a ranked slot
        (component.totalSelfDuration > 0 || component.totalActualDuration > 0) &&
        component.totalSelfDuration >= minSelfDuration,
    )
    .map((component) => ({
      componentName: component.componentName,
      renderCount: component.renderCount,
      mountCount: component.mountCount,
      updateCount: component.updateCount,
      nestedUpdateCount: component.nestedUpdateCount,
      totalActualDuration: component.totalActualDuration,
      totalSelfDuration: component.totalSelfDuration,
      averageActualDuration:
        component.renderCount > 0 ? component.totalActualDuration / component.renderCount : 0,
      maxActualDuration: component.maxActualDuration,
      commitCount: component.commitIndices.length,
      ...(component.source ? { source: component.source } : {}),
    }));

  if (sortBy === 'average') {
    entries.sort((a, b) => b.averageActualDuration - a.averageActualDuration);
  } else if (sortBy === 'max') {
    entries.sort((a, b) => b.maxActualDuration - a.maxActualDuration);
  } else {
    entries.sort((a, b) => b.totalSelfDuration - a.totalSelfDuration);
  }

  return entries.slice(0, limit);
}

export function getRerenderCauses(
  profile: ParsedRenderProfile,
  limit = 10,
  minActualDuration = 0,
): RerenderCause[] {
  const commitCount = profile.commits.length;
  // A component present in a majority of commits indicates sustained rerender
  // pressure rather than a one-off spike. Scale to session length so a 3-of-3
  // commit profile doesn't trip the same threshold as a 3-of-40 commit one —
  // capped at commitCount so very short sessions (1-2 commits) can still trigger
  // on "every commit" instead of never reaching a fixed floor of 3.
  const wideSpreadThreshold = Math.min(commitCount, Math.max(3, Math.ceil(commitCount * 0.6)));

  const causes = profile.components
    .filter(
      (component) =>
        isAnalyzableComponent(component.componentName) &&
        (component.updateCount > 0 || component.nestedUpdateCount > 0) &&
        component.totalActualDuration >= minActualDuration,
    )
    .map((component) => {
      const evidence: RerenderEvidence[] = [];
      const selfToActualRatio =
        component.totalActualDuration > 0
          ? component.totalSelfDuration / component.totalActualDuration
          : 0;

      // ── Exact path: use changeDescription data when available ──────────────
      const cc = component.changeCauses;
      const hasExactCauses = cc != null;
      if (hasExactCauses && cc) {
        const parts: string[] = [];
        if (cc.props.length > 0) parts.push(`props changed: ${cc.props.join(', ')}`);
        if (cc.stateChanged) parts.push('state changed');
        if (cc.contextChanged) parts.push('context changed');
        if (cc.hooks.length > 0) parts.push(`hooks fired: ${cc.hooks.join(', ')}`);
        if (cc.parentTriggered && parts.length === 0)
          parts.push('parent re-rendered (no own prop/state change)');

        if (parts.length > 0) {
          evidence.push({
            signal: 'exact-change-description',
            observed: parts.join('; '),
            threshold: 'n/a',
            detail:
              `${component.componentName} re-rendered because: ${parts.join('; ')}.` +
              (cc.parentTriggered && parts.length > 1
                ? ' Also triggered by parent re-renders.'
                : ''),
          });
        }
      }

      if (component.updateCount >= 2) {
        const updatePct =
          component.renderCount > 0
            ? Math.round((component.updateCount / component.renderCount) * 100)
            : 0;
        const mountPct = 100 - updatePct;

        let advice: string;
        if (updatePct >= 80) {
          advice =
            'It almost never remounts fresh, staying alive and re-rendering in place — check for inline object/array/function props, unstable callback references, or a context value that changes on every parent render.';
        } else if (updatePct >= 40) {
          advice =
            'Mixed mount/update pattern — investigate whether key changes are intentional; conditional rendering could be replaced with CSS visibility to avoid remount cost.';
        } else {
          advice =
            'Mostly mounting rather than updating — check for unstable list keys, a parent conditionally unmounting/recreating this component, or a component type defined inline inside a render function.';
        }

        evidence.push({
          signal: 'repeated-update-phases',
          observed: component.updateCount,
          threshold: 2,
          detail: `${component.componentName} entered the update phase ${component.updateCount} of ${component.renderCount} times (${updatePct}% updates, ${mountPct}% mounts) across ${component.commitIndices.length} commit${component.commitIndices.length === 1 ? '' : 's'}. ${advice}`,
        });
      }

      if (component.nestedUpdateCount > 0) {
        evidence.push({
          signal: 'nested-update-propagation',
          observed: component.nestedUpdateCount,
          threshold: 1,
          detail: `${component.nestedUpdateCount} of ${component.componentName}'s renders were nested updates (self-triggered as an updater for its own commit) — a strong indicator of a render-then-setState loop, an effect with missing/incorrect dependencies, or a context provider updating its value during render.`,
        });
      }

      if (selfToActualRatio >= 0.9) {
        const selfPct = Math.round(selfToActualRatio * 100);
        evidence.push({
          signal: 'self-intensive-render',
          observed: Number(selfToActualRatio.toFixed(2)),
          threshold: 0.9,
          detail: `Self duration is ${selfPct}% of actual duration for ${component.componentName} — the component's own body (not children) does most of the work, likely expensive JSX construction, inline computations, or formatting. Wrap with React.memo and move expensive calculations into useMemo.`,
        });
      }

      if (component.commitIndices.length >= wideSpreadThreshold) {
        const spreadPct =
          commitCount > 0 ? Math.round((component.commitIndices.length / commitCount) * 100) : 0;
        const commitList =
          component.commitIndices.slice(0, 5).join(', ') +
          (component.commitIndices.length > 5
            ? ` … (+${component.commitIndices.length - 5} more)`
            : '');
        evidence.push({
          signal: 'wide-commit-spread',
          observed: component.commitIndices.length,
          threshold: wideSpreadThreshold,
          detail: `${component.componentName} shows up across ${component.commitIndices.length} of ${commitCount} commits (${spreadPct}%) (${commitList}) — sustained rerender pressure rather than a one-off spike. Likely an unstable context value, a subscription/timer triggering frequent updates, or a prop carrying a new reference every parent render.`,
        });
      }

      if (evidence.length === 0) {
        evidence.push({
          signal: 'limited-export-evidence',
          observed: component.commitIndices.length,
          threshold: 'n/a',
          detail: `${component.componentName} rendered ${component.updateCount} time${component.updateCount === 1 ? '' : 's'} in update phase, but signals are below the thresholds for specific heuristics. React Profiler exports lack prop/state diffs — use why-did-you-render or React DevTools to find the exact trigger.`,
        });
      }

      // How avoidable the rerenders look, on its own spanning the full 0-10 range.
      const frequencyScore =
        Math.min(3, component.updateCount) +
        Math.min(3, component.nestedUpdateCount * 1.5) +
        (component.commitIndices.length >= wideSpreadThreshold
          ? 2
          : component.commitIndices.length >= Math.max(2, wideSpreadThreshold - 1)
            ? 1
            : 0) +
        (selfToActualRatio >= 0.9 ? 2 : selfToActualRatio >= 0.75 ? 1 : 0);

      // Scaled by what those rerenders cost, so frequency alone cannot rank a cheap
      // component above an expensive one. profile.totalRenderDuration sums self time.
      const costWeight =
        profile.totalRenderDuration > 0
          ? Math.min(
              1,
              component.totalSelfDuration / profile.totalRenderDuration / COST_SATURATION_SHARE,
            )
          : 1;

      const score = Number(Math.min(10, frequencyScore * costWeight).toFixed(1));

      const result: RerenderCause = {
        componentName: component.componentName,
        renderCount: component.renderCount,
        updateCount: component.updateCount,
        nestedUpdateCount: component.nestedUpdateCount,
        totalActualDuration: component.totalActualDuration,
        score,
        scoreBand: getScoreBand(score),
        confidence: getConfidence(
          evidence.filter((item) => item.signal !== 'limited-export-evidence').length,
        ),
        evidence,
      };
      if (component.source) result.source = component.source;
      return result;
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.totalActualDuration - left.totalActualDuration;
    });

  return causes.slice(0, limit);
}

export function traceRenderPropagation(
  profile: ParsedRenderProfile,
  commitIndex: number,
  limit = 10,
): RenderPropagationPath[] {
  const commit = getCommitByIndex(profile, commitIndex);
  if (!commit) {
    return [];
  }

  const fiberNodeMap = getFiberNodeMap(profile, commit.rootId);
  const measurementMap = getMeasurementMap(commit);
  const renderedFiberIds = new Set(measurementMap.keys());
  const updaterNames = new Set(commit.updaterComponentNames);

  // ---------------------------------------------------------------------------
  // Fallback: infer parent-child links for orphan fibers.
  //
  // Orphan fibers are fibers that rendered in this commit but have no entry in
  // the snapshot tree. This happens when components mount *after* profiling
  // starts — React DevTools only snapshots the tree as it existed at session
  // start, so any later-mounted subtree is invisible to the snapshot.
  //
  // Strategy: sort all rendered fibers by actualDuration descending, then for
  // each orphan pick the tightest candidate parent — the rendered fiber with
  // the smallest actualDuration that is still larger than the orphan's and has
  // enough remaining "child budget" (actualDuration − selfDuration) to absorb
  // it.  Subtract the orphan's cost from the chosen parent's budget so
  // subsequent orphans are assigned correctly.
  // ---------------------------------------------------------------------------
  const remainingBudget = new Map<number, number>();
  const sortedRendered = Array.from(renderedFiberIds)
    .map((id) => ({ id, m: measurementMap.get(id)! }))
    .sort((a, b) => b.m.actualDuration - a.m.actualDuration);

  for (const { id, m } of sortedRendered) {
    remainingBudget.set(id, m.actualDuration - m.selfDuration);
  }

  // orphanParentMap: orphanFiberId → inferred parent fiberId (or null = root entry)
  const orphanParentMap = new Map<number, number | null>();
  // orphanChildrenMap: parentFiberId → list of orphan children assigned to it
  const orphanChildrenMap = new Map<number, number[]>();

  for (const { id, m } of sortedRendered) {
    if (fiberNodeMap.has(id)) {
      continue; // has a real snapshot link — skip
    }

    let bestParentId: number | null = null;
    let bestParentDuration = Infinity;

    for (const { id: candidateId, m: candidateM } of sortedRendered) {
      if (candidateId === id) {
        continue;
      }

      if (candidateM.actualDuration <= m.actualDuration) {
        continue; // parent must have larger actualDuration
      }

      const budget = remainingBudget.get(candidateId) ?? 0;
      if (budget >= m.actualDuration - 0.1 /* floating-point tolerance */) {
        if (candidateM.actualDuration < bestParentDuration) {
          bestParentDuration = candidateM.actualDuration;
          bestParentId = candidateId;
        }
      }
    }

    orphanParentMap.set(id, bestParentId);

    if (bestParentId !== null) {
      remainingBudget.set(
        bestParentId,
        (remainingBudget.get(bestParentId) ?? 0) - m.actualDuration,
      );
      const siblings = orphanChildrenMap.get(bestParentId) ?? [];
      siblings.push(id);
      orphanChildrenMap.set(bestParentId, siblings);
    }
  }

  const entryFiberIds = Array.from(renderedFiberIds)
    .filter((fiberId) => {
      const node = fiberNodeMap.get(fiberId);
      if (node != null) {
        // Real snapshot node: entry if its parent did not render in this commit.
        return node.parentFiberId == null || !renderedFiberIds.has(node.parentFiberId);
      }

      // Orphan fiber: entry only if its inferred parent also did not render.
      const inferredParent = orphanParentMap.get(fiberId);
      return inferredParent == null || !renderedFiberIds.has(inferredParent);
    })
    .sort((left, right) => {
      const leftMeasurement = measurementMap.get(left);
      const rightMeasurement = measurementMap.get(right);
      return (rightMeasurement?.actualDuration ?? 0) - (leftMeasurement?.actualDuration ?? 0);
    });

  const paths: RenderPropagationPath[] = [];

  const visit = (
    fiberId: number,
    fiberPath: number[],
    componentPath: string[],
    totalActualDuration: number,
  ): void => {
    const measurement = measurementMap.get(fiberId);
    if (!measurement) {
      return;
    }

    const node = fiberNodeMap.get(fiberId);
    const componentName = node?.componentName ?? `(fiber:${fiberId})`;

    const nextFiberPath = [...fiberPath, fiberId];
    const nextComponentPath = [...componentPath, componentName];
    const nextTotalActualDuration = totalActualDuration + measurement.actualDuration;

    // Snapshot children that rendered + any orphans inferred to live under this fiber.
    const snapshotChildren = node
      ? node.childFiberIds.filter((childId) => renderedFiberIds.has(childId))
      : [];
    const orphanChildren = (orphanChildrenMap.get(fiberId) ?? []).filter((childId) =>
      renderedFiberIds.has(childId),
    );
    const renderedChildren = [...snapshotChildren, ...orphanChildren];

    if (renderedChildren.length === 0) {
      paths.push({
        commitIndex: commit.index,
        rootId: commit.rootId,
        fiberPath: nextFiberPath,
        componentPath: nextComponentPath,
        depth: nextComponentPath.length,
        totalActualDuration: nextTotalActualDuration,
        leafActualDuration: measurement.actualDuration,
        includesUpdater: nextComponentPath.some((name) => updaterNames.has(name)),
      });
      return;
    }

    for (const childId of renderedChildren) {
      visit(childId, nextFiberPath, nextComponentPath, nextTotalActualDuration);
    }
  };

  for (const fiberId of entryFiberIds) {
    visit(fiberId, [], [], 0);
  }

  return paths
    .sort((left, right) => {
      if (right.totalActualDuration !== left.totalActualDuration) {
        return right.totalActualDuration - left.totalActualDuration;
      }

      return right.depth - left.depth;
    })
    .slice(0, limit);
}

export function detectRenderIssues(profile: ParsedRenderProfile, limit = 10): RenderIssue[] {
  const issues: RenderIssue[] = [];
  const averageCommitDuration =
    profile.commits.length > 0 ? profile.totalCommitDuration / profile.commits.length : 0;

  for (const cause of getRerenderCauses(profile, profile.components.length, 0)) {
    if (cause.scoreBand === 'low') {
      continue;
    }

    issues.push({
      type: 'rerender-storm',
      severity: cause.scoreBand,
      title: `${cause.componentName} rerenders frequently`,
      summary:
        cause.evidence[0]?.detail ?? `${cause.componentName} shows repeated rerender pressure.`,
      componentName: cause.componentName,
      evidence: cause.evidence,
    });
  }

  for (const commit of getHotCommits(profile, Math.min(5, profile.commits.length), 3)) {
    if (
      averageCommitDuration > 0 &&
      commit.duration >= COMMIT_SPIKE_FLOOR_MS &&
      commit.duration >= averageCommitDuration * 1.5
    ) {
      const topShare = commit.topComponents[0]?.shareOfCommitWork ?? 0;
      issues.push({
        type: 'commit-spike',
        severity: commit.duration >= averageCommitDuration * 2 ? 'high' : 'medium',
        title: `Commit ${commit.commitIndex} is a render spike`,
        summary: `Commit ${commit.commitIndex} took ${commit.duration.toFixed(2)}ms, versus an average commit duration of ${averageCommitDuration.toFixed(2)}ms. ${topShare >= 0.5 ? 'One component dominates this spike.' : 'The spike is spread across several components.'}`,
        commitIndex: commit.commitIndex,
        evidence: [
          {
            signal: 'commit-duration-spike',
            observed: Number(commit.duration.toFixed(2)),
            threshold: Number(
              Math.max(COMMIT_SPIKE_FLOOR_MS, averageCommitDuration * 1.5).toFixed(2),
            ),
            detail: `Commit ${commit.commitIndex} exceeded the average commit duration by ${Number((commit.duration / averageCommitDuration).toFixed(2))}x.`,
          },
        ],
      });
    }

    const cascadingPath = traceRenderPropagation(profile, commit.commitIndex, 5).find(
      (path) => path.depth >= 3,
    );

    if (cascadingPath) {
      issues.push({
        type: 'cascading-render',
        severity: cascadingPath.includesUpdater ? 'high' : 'medium',
        title: `Commit ${commit.commitIndex} shows cascading subtree work`,
        summary: `A rendered path of depth ${cascadingPath.depth} was observed (${cascadingPath.componentPath.join(' -> ')}), which suggests parent-to-child rerender propagation rather than isolated component work.`,
        commitIndex: commit.commitIndex,
        evidence: [
          {
            signal: 'deep-render-propagation',
            observed: cascadingPath.depth,
            threshold: 3,
            detail: `Rendered path ${cascadingPath.componentPath.join(' -> ')} accumulated ${cascadingPath.totalActualDuration.toFixed(2)}ms of work in a single commit.`,
          },
        ],
      });
    }
  }

  return issues
    .sort((left, right) => {
      const severityDelta = getSeverityRank(right.severity) - getSeverityRank(left.severity);
      if (severityDelta !== 0) {
        return severityDelta;
      }

      return (
        (left.commitIndex ?? Number.MAX_SAFE_INTEGER) -
        (right.commitIndex ?? Number.MAX_SAFE_INTEGER)
      );
    })
    .slice(0, limit);
}

function createDiffEntry(
  componentName: string,
  baseComponent: ParsedRenderProfile['components'][number] | undefined,
  currentComponent: ParsedRenderProfile['components'][number] | undefined,
): RenderDiffEntry {
  const baseTotalActualDuration = baseComponent?.totalActualDuration ?? 0;
  const currentTotalActualDuration = currentComponent?.totalActualDuration ?? 0;
  const baseAverageActualDuration =
    baseComponent != null && baseComponent.renderCount > 0
      ? baseComponent.totalActualDuration / baseComponent.renderCount
      : 0;
  const currentAverageActualDuration =
    currentComponent != null && currentComponent.renderCount > 0
      ? currentComponent.totalActualDuration / currentComponent.renderCount
      : 0;
  const totalActualDurationDelta = currentTotalActualDuration - baseTotalActualDuration;

  let changeType: RenderDiffEntry['changeType'];
  if (!baseComponent && currentComponent) {
    changeType = 'added';
  } else if (baseComponent && !currentComponent) {
    changeType = 'removed';
  } else if (totalActualDurationDelta >= 0) {
    changeType = 'regression';
  } else {
    changeType = 'improvement';
  }

  return {
    componentName,
    changeType,
    baseTotalActualDuration,
    currentTotalActualDuration,
    totalActualDurationDelta,
    averageActualDurationDelta: currentAverageActualDuration - baseAverageActualDuration,
    maxActualDurationDelta:
      (currentComponent?.maxActualDuration ?? 0) - (baseComponent?.maxActualDuration ?? 0),
    renderCountDelta: (currentComponent?.renderCount ?? 0) - (baseComponent?.renderCount ?? 0),
    commitCountDelta:
      (currentComponent?.commitIndices.length ?? 0) - (baseComponent?.commitIndices.length ?? 0),
    percentChange:
      baseTotalActualDuration > 0
        ? (totalActualDurationDelta / baseTotalActualDuration) * 100
        : currentTotalActualDuration > 0
          ? 100
          : null,
  };
}

export function compareRenders(
  baseProfile: ParsedRenderProfile,
  currentProfile: ParsedRenderProfile,
  limit = 10,
  minDelta = 0,
): RenderComparison {
  const baseComponents = new Map(
    baseProfile.components.map((component) => [component.componentName, component]),
  );
  const currentComponents = new Map(
    currentProfile.components.map((component) => [component.componentName, component]),
  );
  const allComponentNames = new Set([...baseComponents.keys(), ...currentComponents.keys()]);

  const entries = Array.from(allComponentNames)
    .map((componentName) =>
      createDiffEntry(
        componentName,
        baseComponents.get(componentName),
        currentComponents.get(componentName),
      ),
    )
    .filter((entry) => {
      if (entry.changeType === 'added' || entry.changeType === 'removed') {
        return true;
      }

      return (
        Math.abs(entry.totalActualDurationDelta) > 0 &&
        Math.abs(entry.totalActualDurationDelta) >= minDelta
      );
    })
    .sort(
      (left, right) =>
        Math.abs(right.totalActualDurationDelta) - Math.abs(left.totalActualDurationDelta),
    )
    .slice(0, limit);

  return {
    baseProfileId: baseProfile.id,
    currentProfileId: currentProfile.id,
    regressions: entries.filter(
      (entry) => entry.changeType === 'regression' && entry.totalActualDurationDelta > 0,
    ),
    improvements: entries.filter(
      (entry) => entry.changeType === 'improvement' && entry.totalActualDurationDelta < 0,
    ),
    added: entries.filter((entry) => entry.changeType === 'added'),
    removed: entries.filter((entry) => entry.changeType === 'removed'),
  };
}
