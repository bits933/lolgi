import { createRequire } from 'node:module';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareArtifactManifests,
  findForbiddenEntries,
  findUnexpectedDistEntries,
  missingCapabilityMarkers,
  verifyPackage,
} from './verify-package.mjs';
import { computeSourceFingerprint } from './generate-build-info.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');

function writeFixture(root, relativePath, contents) {
  const output = join(root, ...relativePath.split('/'));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, contents);
}

describe('package verifier', () => {
  it('rejects nested unpacked builds and installer artifacts', () => {
    expect(findForbiddenEntries([
      '\\dist\\main-bundled.js',
      '\\dist\\win-unpacked\\electron.exe',
      '\\dist\\Lolgi Action Ring Setup 1.0.0.exe',
      '\\dist\\old.blockmap',
    ])).toEqual([
      'dist/win-unpacked/electron.exe',
      'dist/Lolgi Action Ring Setup 1.0.0.exe',
      'dist/old.blockmap',
    ]);
  });

  it('accepts only the explicit dist staging allowlist', () => {
    expect(findUnexpectedDistEntries([
      '\\dist',
      '\\dist\\build-info.json',
      '\\dist\\main-bundled.js',
      '\\dist\\preload-dashboard.js',
      '\\dist\\preload-outside-click.js',
      '\\dist\\renderer\\overlay\\assets\\index.js',
      '\\dist\\builder-debug.yml',
    ])).toEqual([
      'dist/preload-outside-click.js',
      'dist/builder-debug.yml',
    ]);
  });

  it('requires Figma, focus, and fill-click capability markers', () => {
    expect(missingCapabilityMarkers(
      '"figma" "auto-layout" "quick-actions" requiresForegroundInput',
      'fill click action failed clickAction',
    )).toEqual([]);
    expect(missingCapabilityMarkers('"figma" "auto-layout"', 'clickAction')).toEqual([
      'Figma preset definitions',
      'foreground-input classification',
      'fill-click fallback',
    ]);
  });

  it('detects missing, unexpected, and stale packaged build artifacts', () => {
    expect(compareArtifactManifests(
      {
        'dist/build-info.json': 'build-current',
        'dist/main-bundled.js': 'main-current',
        'dist/preload-overlay.js': 'preload-current',
      },
      {
        'dist/build-info.json': 'build-current',
        'dist/main-bundled.js': 'main-stale',
        'dist/renderer/overlay/assets/stale.js': 'stale',
      },
    )).toEqual({
      missing: ['dist/preload-overlay.js'],
      unexpected: ['dist/renderer/overlay/assets/stale.js'],
      mismatched: ['dist/main-bundled.js'],
    });
  });

  it('hash-verifies a real ASAR and rejects a stale main bundle', async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'logi-package-verifier-'));
    const sourceRoot = join(temporaryRoot, 'source');
    const archivePath = join(temporaryRoot, 'app.asar');
    try {
      writeFixture(sourceRoot, 'package.json', JSON.stringify({
        name: 'logi-package-verifier-fixture',
        version: '1.0.1',
        main: 'dist/main-bundled.js',
      }));
      writeFixture(
        sourceRoot,
        'dist/main-bundled.js',
        '"figma" "auto-layout" "quick-actions" requiresForegroundInput',
      );
      writeFixture(sourceRoot, 'dist/preload-dashboard.js', 'dashboard preload');
      writeFixture(sourceRoot, 'dist/preload-overlay.js', 'overlay preload');
      writeFixture(
        sourceRoot,
        'dist/renderer/overlay/assets/index.js',
        'fill click action failed clickAction',
      );
      writeFixture(sourceRoot, 'dist/build-info.json', JSON.stringify({
        version: '1.0.1',
        gitCommit: '0123456789abcdef0123456789abcdef01234567',
        dirty: false,
        builtAtUtc: '2026-07-18T17:00:00.000Z',
        sourceFingerprint: computeSourceFingerprint(sourceRoot),
      }));

      await asar.createPackage(sourceRoot, archivePath);
      expect(verifyPackage(archivePath, { sourceRoot })).toMatchObject({
        version: '1.0.1',
        verifiedArtifactCount: 5,
      });

      writeFixture(sourceRoot, 'dist/main-bundled.js', 'stale after packaging');
      expect(() => verifyPackage(archivePath, { sourceRoot }))
        .toThrow(/content hash mismatch:\ndist\/main-bundled\.js/);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
