import { describe, expect, it } from 'vitest';
import { isBuildInfo } from './buildInfo';

describe('build identity validation', () => {
  it('accepts generated immutable build metadata', () => {
    expect(isBuildInfo({
      version: '1.0.1',
      gitCommit: '0123456789abcdef0123456789abcdef01234567',
      dirty: false,
      builtAtUtc: '2026-07-18T17:00:00.000Z',
      sourceFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })).toBe(true);
  });

  it('rejects incomplete metadata', () => {
    expect(isBuildInfo({ version: '1.0.1', dirty: false })).toBe(false);
    expect(isBuildInfo({
      version: '1.0.1',
      gitCommit: '0123456789abcdef0123456789abcdef01234567',
      dirty: false,
      builtAtUtc: '2026-07-18T17:00:00.000Z',
      sourceFingerprint: 'not-a-sha256',
    })).toBe(false);
  });
});
