import { createRequire } from 'node:module';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeSourceFingerprint } from './generate-build-info.mjs';
import {
  createReleaseManifest,
  verifyReleaseManifest,
  writeReleaseManifest,
} from './release-manifest.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const temporaryDirectories = [];

function writeFixture(root, relativePath, contents) {
  const output = join(root, ...relativePath.split('/'));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, contents);
  return output;
}

async function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'lolgi-release-manifest-'));
  temporaryDirectories.push(root);
  writeFixture(root, 'package.json', '{"name":"fixture","version":"1.0.1"}\n');
  writeFixture(root, 'src/app.ts', 'export const release = "current";\n');
  const build = {
    version: '1.0.1',
    gitCommit: '0123456789abcdef0123456789abcdef01234567',
    dirty: true,
    builtAtUtc: '2026-07-18T17:00:00.000Z',
    sourceFingerprint: computeSourceFingerprint(root),
  };
  writeFixture(root, 'dist/build-info.json', `${JSON.stringify(build)}\n`);
  writeFixture(root, 'release/Lolgi Action Ring Setup 1.0.1.exe', 'fake installer bytes');

  const asarSource = join(root, 'asar-source');
  writeFixture(asarSource, 'dist/build-info.json', `${JSON.stringify(build)}\n`);
  writeFixture(asarSource, 'package.json', '{"name":"fixture","version":"1.0.1"}\n');
  const appAsarPath = join(root, 'release', 'win-unpacked', 'resources', 'app.asar');
  mkdirSync(dirname(appAsarPath), { recursive: true });
  await asar.createPackage(asarSource, appAsarPath);

  const manifest = createReleaseManifest({ root });
  const manifestPath = writeReleaseManifest(
    manifest,
    join(root, 'release', 'release-manifest.json'),
  );
  return { root, manifest, manifestPath };
}

afterEach(() => {
  for (const root of temporaryDirectories.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('release manifest', () => {
  it('binds exact build identity to installer and ASAR SHA-256 digests', async () => {
    const { root, manifestPath } = await createFixture();
    const verified = verifyReleaseManifest({ root, manifestPath });

    expect(verified).toMatchObject({
      version: '1.0.1',
      sourceFingerprint: computeSourceFingerprint(root),
    });
    expect(verified.installerSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(verified.appAsarSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects changed artifacts and changed source after packaging', async () => {
    const first = await createFixture();
    writeFixture(first.root, 'release/Lolgi Action Ring Setup 1.0.1.exe', 'tampered installer');
    expect(() => verifyReleaseManifest({
      root: first.root,
      manifestPath: first.manifestPath,
    })).toThrow(/Installer (size|SHA-256) mismatch/);

    const second = await createFixture();
    writeFixture(second.root, 'src/app.ts', 'export const release = "changed";\n');
    expect(() => verifyReleaseManifest({
      root: second.root,
      manifestPath: second.manifestPath,
    })).toThrow('Source fingerprint mismatch');
  });
});
