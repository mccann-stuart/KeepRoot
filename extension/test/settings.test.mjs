import { describe, expect, it } from 'vitest';
import { normalizeWorkerUrl } from '../src/shared/settings.js';

describe('normalizeWorkerUrl', () => {
  it('returns the Worker origin only', () => {
    expect(normalizeWorkerUrl('https://example.workers.dev/bookmarks?foo=bar')).toBe('https://example.workers.dev');
  });

  it('rejects invalid URLs', () => {
    expect(() => normalizeWorkerUrl('ftp://example.workers.dev')).toThrow(/Worker URL must start/);
    expect(() => normalizeWorkerUrl('not-a-url')).toThrow(/valid Worker root URL/);
  });
});
