import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseJudgeScore } from '../../src/rubric/judge-types.js';
import { routingProxy, routingJudge } from '../../src/rubric/routing.judge.js';
import { memorabilityJudge } from '../../src/rubric/memorability.judge.js';
import { diningFitJudge } from '../../src/rubric/dining_fit.judge.js';
import type { Artifact } from '../../src/predicates/types.js';

describe('parseJudgeScore', () => {
  it('returns 0.5 for null input (no API key)', () => {
    expect(parseJudgeScore(null, 'x')).toBe(0.5);
  });

  it('parses 0-1 decimal', () => {
    expect(parseJudgeScore('0.75', 'x')).toBe(0.75);
  });

  it('normalizes 0-100 to 0-1', () => {
    expect(parseJudgeScore('80', 'x')).toBe(0.8);
  });

  it('returns 0.5 for unparseable', () => {
    expect(parseJudgeScore('not a number', 'x')).toBe(0.5);
  });
});

describe('routingProxy', () => {
  it('returns 1.0 for fully bridged artifact', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'dining' },
        { node_type: 'transit' },
        { node_type: 'core_experience' },
      ],
    };
    expect(routingProxy(artifact)).toBe(1.0);
  });

  it('returns 0.0 for no bridges', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'dining' },
        { node_type: 'core_experience' },
      ],
    };
    expect(routingProxy(artifact)).toBe(0.0);
  });

  it('returns 0.5 for half bridged', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'dining' },
        { node_type: 'transit' },
        { node_type: 'core_experience' },
        { node_type: 'dining' },
      ],
    };
    // pairs: (0,1) bridged, (1,2) bridged, (2,3) not bridged → 2/3
    expect(routingProxy(artifact)).toBeCloseTo(2/3, 2);
  });
});

describe('judge rubrics (no API key, degraded)', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('routingJudge returns neutral 0.5 score when no API key', async () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ node_type: 'dining' }, { node_type: 'core_experience' }],
    };
    const result = await routingJudge({ artifact, dim: 'routing', weight: 0.25 });
    expect(result.dim).toBe('routing');
    expect(result.mode).toBe('proxy+judge');
    expect(result.score).toBe(0.5); // neutral fallback
    expect(result.proxy_value).toBe(0.0); // proxy still computed
  });

  it('memorabilityJudge returns neutral 0.5 when no API key', async () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ node_type: 'dining', action: 'breakfast' }],
    };
    const result = await memorabilityJudge({ artifact, dim: 'memorability', weight: 0.25 });
    expect(result.score).toBe(0.5);
    expect(result.mode).toBe('judge');
  });

  it('diningFitJudge returns neutral 0.5 when no API key', async () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ node_type: 'dining', action: 'breakfast' }],
    };
    const result = await diningFitJudge({ artifact, dim: 'dining_fit', weight: 0.15 });
    expect(result.score).toBe(0.5);
    expect(result.mode).toBe('judge');
  });
});
