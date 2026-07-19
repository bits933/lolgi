import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeSourceFingerprint,
  createBuildInfo,
} from './generate-build-info.mjs';

describe('generated build identity', () => {
  it('retains the exact release inputs and freezes the result', () => {
    const info = createBuildInfo({
      version: '1.0.1',
      gitCommit: '0123456789abcdef0123456789abcdef01234567',
      dirty: true,
      builtAtUtc: '2026-07-18T17:00:00.000Z',
      sourceFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });

    expect(info).toEqual({
      version: '1.0.1',
      gitCommit: '0123456789abcdef0123456789abcdef01234567',
      dirty: true,
      builtAtUtc: '2026-07-18T17:00:00.000Z',
      sourceFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(Object.isFrozen(info)).toBe(true);
  });

  it('rejects invalid timestamps', () => {
    expect(() => createBuildInfo({
      version: '1.0.1',
      gitCommit: 'unknown',
      dirty: false,
      builtAtUtc: 'not-a-date',
      sourceFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })).toThrow('valid UTC date');
    expect(() => createBuildInfo({
      version: '1.0.1',
      gitCommit: 'unknown',
      dirty: false,
      builtAtUtc: '2026-07-18T17:00:00.000Z',
      sourceFingerprint: 'not-a-sha256',
    })).toThrow('SHA-256');
  });

  it('fingerprints normalized source/config inputs and excludes generated output', () => {
    const root = mkdtempSync(join(tmpdir(), 'logi-source-fingerprint-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(join(root, 'dist'), { recursive: true });
      mkdirSync(join(root, 'release'), { recursive: true });
      mkdirSync(join(root, 'node_modules'), { recursive: true });
      writeFileSync(join(root, 'package.json'), '{"version":"1.0.1"}\n');
      writeFileSync(join(root, 'src', 'app.ts'), 'export const value = 1;\n');
      writeFileSync(join(root, 'dist', 'main.js'), 'generated one');
      writeFileSync(join(root, 'release', 'installer.exe'), 'installer one');
      writeFileSync(join(root, 'node_modules', 'dependency.js'), 'dependency one');

      const initial = computeSourceFingerprint(root);
      writeFileSync(join(root, 'dist', 'main.js'), 'generated two');
      writeFileSync(join(root, 'release', 'installer.exe'), 'installer two');
      writeFileSync(join(root, 'node_modules', 'dependency.js'), 'dependency two');
      expect(computeSourceFingerprint(root)).toBe(initial);

      writeFileSync(join(root, 'src', 'app.ts'), 'export const value = 2;\n');
      expect(computeSourceFingerprint(root)).not.toBe(initial);
      expect(initial).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
