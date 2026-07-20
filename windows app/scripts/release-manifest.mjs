import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeSourceFingerprint } from './generate-build-info.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const PRODUCT_NAME = 'Lolgi Action Ring';
const MANIFEST_SCHEMA_VERSION = 1;

function defaultReleaseRoot(root) {
  return root === projectRoot ? resolve(root, '..', 'release') : resolve(root, 'release');
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is unreadable or invalid: ${message}`);
  }
}

function normalizeBuildIdentity(value, label) {
  if (!value || typeof value !== 'object') throw new Error(`${label} is missing.`);
  const candidate = value;
  if (
    typeof candidate.version !== 'string'
    || candidate.version.trim() === ''
    || typeof candidate.gitCommit !== 'string'
    || candidate.gitCommit.trim() === ''
    || typeof candidate.dirty !== 'boolean'
    || typeof candidate.builtAtUtc !== 'string'
    || Number.isNaN(Date.parse(candidate.builtAtUtc))
    || typeof candidate.sourceFingerprint !== 'string'
    || !/^[a-f0-9]{64}$/i.test(candidate.sourceFingerprint)
  ) {
    throw new Error(`${label} is incomplete or invalid.`);
  }
  return Object.freeze({
    version: candidate.version.trim(),
    gitCommit: candidate.gitCommit.trim(),
    dirty: candidate.dirty,
    builtAtUtc: candidate.builtAtUtc,
    sourceFingerprint: candidate.sourceFingerprint.toLowerCase(),
  });
}

function sameBuildIdentity(left, right) {
  return (
    left.version === right.version
    && left.gitCommit === right.gitCommit
    && left.dirty === right.dirty
    && left.builtAtUtc === right.builtAtUtc
    && left.sourceFingerprint === right.sourceFingerprint
  );
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function artifactRecord(path, releaseRoot) {
  const relativePath = relative(releaseRoot, path).replace(/\\/g, '/');
  return Object.freeze({
    file: relativePath,
    sha256: hashFile(path),
    sizeBytes: statSync(path).size,
  });
}

function findInstaller(releaseRoot, version) {
  const expectedName = `${PRODUCT_NAME} Setup ${version}.exe`;
  const expectedPath = resolve(releaseRoot, expectedName);
  if (existsSync(expectedPath)) return expectedPath;
  const candidates = readdirSync(releaseRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
    .map((entry) => entry.name);
  throw new Error(
    `Expected installer ${expectedName} was not found. Available installers: ${candidates.join(', ') || 'none'}`,
  );
}

function resolveArtifactPath(releaseRoot, file) {
  if (typeof file !== 'string' || file.trim() === '') throw new Error('Release artifact path is invalid.');
  const artifactPath = resolve(releaseRoot, ...file.split('/'));
  const normalizedRoot = `${resolve(releaseRoot).toLowerCase()}${sep}`;
  if (!artifactPath.toLowerCase().startsWith(normalizedRoot)) {
    throw new Error(`Release artifact escapes the release directory: ${file}`);
  }
  return artifactPath;
}

function validateArtifactRecord(record, label) {
  if (
    !record
    || typeof record !== 'object'
    || typeof record.file !== 'string'
    || typeof record.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(record.sha256)
    || !Number.isSafeInteger(record.sizeBytes)
    || record.sizeBytes < 0
  ) {
    throw new Error(`${label} record is incomplete or invalid.`);
  }
}

function readAsarBuildIdentity(appAsarPath) {
  const archivePath = ['dist', 'build-info.json'].join(sep);
  try {
    return normalizeBuildIdentity(
      JSON.parse(asar.extractFile(appAsarPath, archivePath).toString('utf8')),
      'Packaged ASAR build identity',
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Packaged ASAR build identity')) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Packaged ASAR build identity is unreadable: ${message}`);
  }
}

export function createReleaseManifest({
  root = projectRoot,
  releaseRoot = defaultReleaseRoot(root),
} = {}) {
  const packageJson = readJson(resolve(root, 'package.json'), 'package.json');
  const build = normalizeBuildIdentity(
    readJson(resolve(root, 'dist', 'build-info.json'), 'dist/build-info.json'),
    'Generated build identity',
  );
  if (packageJson.version !== build.version) {
    throw new Error(`Version mismatch: package=${packageJson.version}, build=${build.version}`);
  }
  const currentSourceFingerprint = computeSourceFingerprint(root);
  if (currentSourceFingerprint !== build.sourceFingerprint) {
    throw new Error(
      `Source fingerprint changed after build identity generation: `
        + `build=${build.sourceFingerprint} current=${currentSourceFingerprint}`,
    );
  }

  const installerPath = findInstaller(releaseRoot, build.version);
  const appAsarPath = resolve(releaseRoot, 'win-unpacked', 'resources', 'app.asar');
  if (!existsSync(appAsarPath)) throw new Error(`Packaged app.asar not found: ${appAsarPath}`);

  return Object.freeze({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    productName: PRODUCT_NAME,
    build,
    artifacts: Object.freeze({
      installer: artifactRecord(installerPath, releaseRoot),
      appAsar: artifactRecord(appAsarPath, releaseRoot),
    }),
  });
}

export function writeReleaseManifest(
  manifest,
  output = resolve(projectRoot, '..', 'release', 'release-manifest.json'),
) {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return output;
}

export function verifyReleaseManifest({
  root = projectRoot,
  releaseRoot = defaultReleaseRoot(root),
  manifestPath = resolve(releaseRoot, 'release-manifest.json'),
} = {}) {
  const manifest = readJson(manifestPath, 'Release manifest');
  if (
    manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION
    || manifest.productName !== PRODUCT_NAME
    || !manifest.artifacts
    || typeof manifest.artifacts !== 'object'
  ) {
    throw new Error('Release manifest header is incomplete or invalid.');
  }
  const manifestBuild = normalizeBuildIdentity(manifest.build, 'Release manifest build identity');
  const generatedBuild = normalizeBuildIdentity(
    readJson(resolve(root, 'dist', 'build-info.json'), 'dist/build-info.json'),
    'Generated build identity',
  );
  if (!sameBuildIdentity(manifestBuild, generatedBuild)) {
    throw new Error('Release manifest build identity does not match dist/build-info.json.');
  }
  const currentSourceFingerprint = computeSourceFingerprint(root);
  if (currentSourceFingerprint !== manifestBuild.sourceFingerprint) {
    throw new Error(
      `Source fingerprint mismatch: manifest=${manifestBuild.sourceFingerprint} `
        + `current=${currentSourceFingerprint}`,
    );
  }

  for (const [key, label] of [
    ['installer', 'Installer'],
    ['appAsar', 'app.asar'],
  ]) {
    const record = manifest.artifacts[key];
    validateArtifactRecord(record, label);
    const artifactPath = resolveArtifactPath(releaseRoot, record.file);
    if (!existsSync(artifactPath)) throw new Error(`${label} is missing: ${artifactPath}`);
    const actualSize = statSync(artifactPath).size;
    if (actualSize !== record.sizeBytes) {
      throw new Error(`${label} size mismatch: manifest=${record.sizeBytes} actual=${actualSize}`);
    }
    const actualHash = hashFile(artifactPath);
    if (actualHash !== record.sha256.toLowerCase()) {
      throw new Error(`${label} SHA-256 mismatch: manifest=${record.sha256} actual=${actualHash}`);
    }
  }

  const appAsarPath = resolveArtifactPath(releaseRoot, manifest.artifacts.appAsar.file);
  const packagedBuild = readAsarBuildIdentity(appAsarPath);
  if (!sameBuildIdentity(manifestBuild, packagedBuild)) {
    throw new Error('Release manifest build identity does not match packaged app.asar.');
  }
  return Object.freeze({
    manifestPath,
    version: manifestBuild.version,
    gitCommit: manifestBuild.gitCommit,
    dirty: manifestBuild.dirty,
    builtAtUtc: manifestBuild.builtAtUtc,
    sourceFingerprint: manifestBuild.sourceFingerprint,
    installerSha256: manifest.artifacts.installer.sha256.toLowerCase(),
    appAsarSha256: manifest.artifacts.appAsar.sha256.toLowerCase(),
  });
}

function main() {
  const manifest = createReleaseManifest();
  const output = writeReleaseManifest(manifest);
  const verified = verifyReleaseManifest({ manifestPath: output });
  console.log(`[release-manifest] OK v${verified.version} source=${verified.sourceFingerprint}`);
  console.log(`[release-manifest] installer SHA-256 ${verified.installerSha256}`);
  console.log(`[release-manifest] app.asar SHA-256 ${verified.appAsarSha256}`);
  console.log(`[release-manifest] ${verified.manifestPath}`);
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryUrl) {
  try {
    main();
  } catch (error) {
    console.error(`[release-manifest] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
