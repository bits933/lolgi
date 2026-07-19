import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeSourceFingerprint } from './generate-build-info.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const fixedDistArtifacts = Object.freeze([
  'dist/build-info.json',
  'dist/main-bundled.js',
  'dist/preload-dashboard.js',
  'dist/preload-overlay.js',
]);
const rendererArtifactRoots = Object.freeze([
  'dist/renderer/dashboard',
  'dist/renderer/overlay',
]);

function normalizeArchivePath(value) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function toArchivePlatformPath(filePath) {
  return filePath.replace(/^[/\\]+/, '').split(/[\\/]/).join(sep);
}

function toPlatformPath(root, relativePath) {
  return resolve(root, ...relativePath.split('/'));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function listFilesRecursively(root, relativeDirectory) {
  const directory = toPlatformPath(root, relativeDirectory);
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      return entry.isDirectory()
        ? listFilesRecursively(root, relativePath)
        : [relativePath];
    })
    .sort();
}

function listSourceDistArtifacts(sourceRoot) {
  return [
    ...fixedDistArtifacts,
    ...rendererArtifactRoots.flatMap((root) => listFilesRecursively(sourceRoot, root)),
  ].sort();
}

function isComparableDistArtifact(entry) {
  return fixedDistArtifacts.includes(entry)
    || rendererArtifactRoots.some((root) => entry.startsWith(`${root}/`));
}

export function compareArtifactManifests(sourceManifest, packagedManifest) {
  const sourcePaths = Object.keys(sourceManifest).sort();
  const packagedPaths = Object.keys(packagedManifest).sort();
  const missing = sourcePaths.filter((entry) => !(entry in packagedManifest));
  const unexpected = packagedPaths.filter((entry) => !(entry in sourceManifest));
  const mismatched = sourcePaths.filter(
    (entry) => entry in packagedManifest && sourceManifest[entry] !== packagedManifest[entry],
  );
  return Object.freeze({ missing, unexpected, mismatched });
}

export function findForbiddenEntries(entries) {
  return entries
    .map(normalizeArchivePath)
    .filter((entry) => (
      /(^|\/)(win-unpacked|release)(\/|$)/i.test(entry)
      || /(^|\/)builder-(debug|effective-config)\.(ya?ml|json)$/i.test(entry)
      || /\.blockmap$/i.test(entry)
      || /(^|\/)Logi Actions Ring Setup .+\.exe$/i.test(entry)
      || /(^|\/)app\.asar$/i.test(entry)
    ));
}

export function findUnexpectedDistEntries(entries) {
  const allowed = [
    /^dist$/,
    /^dist\/build-info\.json$/,
    /^dist\/main-bundled\.js$/,
    /^dist\/preload-(dashboard|overlay)\.js$/,
    /^dist\/renderer$/,
    /^dist\/renderer\/(dashboard|overlay)$/,
    /^dist\/renderer\/(dashboard|overlay)\/.+$/,
  ];
  return entries
    .map(normalizeArchivePath)
    .filter((entry) => entry.startsWith('dist/') || entry === 'dist')
    .filter((entry) => !allowed.some((pattern) => pattern.test(entry)));
}

export function missingCapabilityMarkers(mainBundle, overlayBundle) {
  const requirements = [
    {
      label: 'Figma preset definitions',
      source: mainBundle,
      markers: ['"figma"', '"auto-layout"', '"quick-actions"'],
    },
    {
      label: 'foreground-input classification',
      source: mainBundle,
      markers: ['requiresForegroundInput'],
    },
    {
      label: 'fill-click fallback',
      source: overlayBundle,
      markers: ['fill click action failed', 'clickAction'],
    },
  ];
  return requirements
    .filter((requirement) => !requirement.markers.every((marker) => requirement.source.includes(marker)))
    .map((requirement) => requirement.label);
}

function extractBuffer(archivePath, filePath) {
  return asar.extractFile(archivePath, toArchivePlatformPath(filePath));
}

function extractText(archivePath, filePath) {
  return extractBuffer(archivePath, filePath).toString('utf8');
}

function verifyDistArtifactParity(archivePath, entries, sourceRoot) {
  const sourcePaths = listSourceDistArtifacts(sourceRoot);
  const missingSourcePaths = sourcePaths.filter(
    (entry) => !existsSync(toPlatformPath(sourceRoot, entry)),
  );
  if (missingSourcePaths.length > 0) {
    throw new Error(`Local build output is incomplete:\n${missingSourcePaths.join('\n')}`);
  }

  const packagedPaths = entries
    .filter(isComparableDistArtifact)
    .filter((entry) => {
      const metadata = asar.statFile(archivePath, toArchivePlatformPath(entry));
      return !('files' in metadata);
    })
    .sort();
  const sourceManifest = Object.fromEntries(
    sourcePaths.map((entry) => [
      entry,
      sha256(readFileSync(toPlatformPath(sourceRoot, entry))),
    ]),
  );
  const packagedManifest = Object.fromEntries(
    packagedPaths.map((entry) => [
      entry,
      sha256(extractBuffer(archivePath, entry)),
    ]),
  );
  const failures = compareArtifactManifests(sourceManifest, packagedManifest);
  if (
    failures.missing.length > 0
    || failures.unexpected.length > 0
    || failures.mismatched.length > 0
  ) {
    const details = [
      failures.missing.length > 0
        ? `missing from ASAR:\n${failures.missing.join('\n')}`
        : '',
      failures.unexpected.length > 0
        ? `not present in the final local build:\n${failures.unexpected.join('\n')}`
        : '',
      failures.mismatched.length > 0
        ? `content hash mismatch:\n${failures.mismatched.join('\n')}`
        : '',
    ].filter(Boolean);
    throw new Error(`Packaged build does not match dist:\n${details.join('\n')}`);
  }
  return sourcePaths.length;
}

export function verifyPackage(archivePath, { sourceRoot = projectRoot } = {}) {
  if (!existsSync(archivePath)) throw new Error(`Packaged app not found: ${archivePath}`);

  const entries = asar.listPackage(archivePath);
  const normalizedEntries = entries.map(normalizeArchivePath);
  const forbidden = findForbiddenEntries(entries);
  if (forbidden.length > 0) {
    throw new Error(`ASAR contains nested release artifacts:\n${forbidden.slice(0, 20).join('\n')}`);
  }

  const unexpectedDistEntries = findUnexpectedDistEntries(entries);
  if (unexpectedDistEntries.length > 0) {
    throw new Error(`ASAR contains files outside the dist allowlist:\n${unexpectedDistEntries.slice(0, 20).join('\n')}`);
  }

  for (const required of [
    'package.json',
    ...fixedDistArtifacts,
  ]) {
    if (!normalizedEntries.includes(required)) throw new Error(`ASAR is missing ${required}`);
  }

  const verifiedArtifactCount = verifyDistArtifactParity(
    archivePath,
    normalizedEntries,
    sourceRoot,
  );
  const packageJson = JSON.parse(extractText(archivePath, 'package.json'));
  const buildInfo = JSON.parse(extractText(archivePath, 'dist/build-info.json'));
  if (packageJson.version !== buildInfo.version) {
    throw new Error(`Version mismatch: package=${packageJson.version}, build=${buildInfo.version}`);
  }
  if (
    typeof buildInfo.gitCommit !== 'string'
    || typeof buildInfo.dirty !== 'boolean'
    || typeof buildInfo.builtAtUtc !== 'string'
    || Number.isNaN(Date.parse(buildInfo.builtAtUtc))
    || typeof buildInfo.sourceFingerprint !== 'string'
    || !/^[a-f0-9]{64}$/i.test(buildInfo.sourceFingerprint)
  ) {
    throw new Error('Packaged build-info.json is incomplete or invalid.');
  }
  const currentSourceFingerprint = computeSourceFingerprint(sourceRoot);
  if (buildInfo.sourceFingerprint.toLowerCase() !== currentSourceFingerprint) {
    throw new Error(
      `Source fingerprint mismatch: package=${buildInfo.sourceFingerprint} current=${currentSourceFingerprint}`,
    );
  }

  const overlayEntry = normalizedEntries.find(
    (entry) => /^dist\/renderer\/overlay\/assets\/.+\.js$/.test(entry),
  );
  if (!overlayEntry) throw new Error('ASAR is missing the overlay JavaScript bundle.');
  const mainBundle = extractText(archivePath, 'dist/main-bundled.js');
  const overlayBundle = extractText(archivePath, overlayEntry);
  const missingMarkers = missingCapabilityMarkers(mainBundle, overlayBundle);
  if (missingMarkers.length > 0) {
    throw new Error(`Packaged capabilities are missing: ${missingMarkers.join(', ')}`);
  }

  return Object.freeze({
    archivePath,
    version: buildInfo.version,
    gitCommit: buildInfo.gitCommit,
    dirty: buildInfo.dirty,
    builtAtUtc: buildInfo.builtAtUtc,
    sourceFingerprint: buildInfo.sourceFingerprint,
    entryCount: entries.length,
    verifiedArtifactCount,
  });
}

function main() {
  const requestedPath = process.argv[2];
  const archivePath = requestedPath
    ? resolve(projectRoot, requestedPath)
    : resolve(projectRoot, 'release', 'win-unpacked', 'resources', 'app.asar');
  const result = verifyPackage(archivePath);
  const shortCommit = result.gitCommit === 'unknown' ? 'unknown' : result.gitCommit.slice(0, 12);
  console.log(
    `[verify-package] OK v${result.version} ${shortCommit}${result.dirty ? '+dirty' : ''} `
      + `(${result.entryCount} entries; ${result.verifiedArtifactCount} build artifacts hash-matched)`,
  );
  console.log(`[verify-package] source SHA-256 ${result.sourceFingerprint}`);
  console.log(`[verify-package] ${result.archivePath}`);
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryUrl) {
  try {
    main();
  } catch (error) {
    console.error(`[verify-package] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
