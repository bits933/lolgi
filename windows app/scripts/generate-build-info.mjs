import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');

const sourceDirectoryRoots = Object.freeze(['resources', 'scripts', 'src']);
const sourceRootFiles = Object.freeze([
  'electron-builder.yml',
  'electron-main.js',
  'launch.ps1',
  'package-lock.json',
  'package.json',
  'run.bat',
  'tsconfig.dashboard.json',
  'tsconfig.json',
  'tsconfig.main.json',
  'tsconfig.overlay.json',
  'tsconfig.renderer.json',
  'vite.config.dashboard.ts',
  'vite.config.overlay.ts',
]);

function normalizeRelativePath(value) {
  return value.replace(/\\/g, '/');
}

function readGit(command, fallback, root = projectRoot) {
  try {
    return execFileSync('git', command, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return fallback;
  }
}

function listFilesRecursively(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = resolve(directory, entry.name);
      return entry.isDirectory() ? listFilesRecursively(entryPath) : [entryPath];
    });
}

export function listSourceFingerprintFiles(root = projectRoot) {
  return [
    ...sourceRootFiles
      .map((entry) => resolve(root, entry))
      .filter(existsSync),
    ...sourceDirectoryRoots.flatMap((entry) => listFilesRecursively(resolve(root, entry))),
  ]
    .map((absolutePath) => ({
      absolutePath,
      relativePath: normalizeRelativePath(relative(root, absolutePath)),
    }))
    .sort((left, right) => (
      left.relativePath === right.relativePath
        ? 0
        : left.relativePath < right.relativePath ? -1 : 1
    ));
}

/**
 * Hash the exact bytes and normalized relative paths of every source/config
 * input used to build or validate the app. Generated and packaged output
 * directories are intentionally outside the allowlisted roots.
 */
export function computeSourceFingerprint(root = projectRoot) {
  const hash = createHash('sha256');
  hash.update('logi-actions-ring-source-v1\0', 'utf8');
  for (const file of listSourceFingerprintFiles(root)) {
    const contents = readFileSync(file.absolutePath);
    hash.update(`${Buffer.byteLength(file.relativePath, 'utf8')}:`, 'utf8');
    hash.update(file.relativePath, 'utf8');
    hash.update(`:${contents.length}:`, 'utf8');
    hash.update(contents);
  }
  return hash.digest('hex');
}

export function createBuildInfo({
  version,
  gitCommit,
  dirty,
  builtAtUtc,
  sourceFingerprint,
}) {
  if (typeof version !== 'string' || version.trim() === '') throw new Error('Build version is required.');
  if (typeof gitCommit !== 'string' || gitCommit.trim() === '') throw new Error('Git commit is required.');
  if (typeof dirty !== 'boolean') throw new Error('Dirty flag must be boolean.');
  if (typeof builtAtUtc !== 'string' || Number.isNaN(Date.parse(builtAtUtc))) {
    throw new Error('Build timestamp must be a valid UTC date.');
  }
  if (typeof sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(sourceFingerprint)) {
    throw new Error('Source fingerprint must be a SHA-256 hex digest.');
  }
  return Object.freeze({
    version: version.trim(),
    gitCommit: gitCommit.trim(),
    dirty,
    builtAtUtc,
    sourceFingerprint: sourceFingerprint.toLowerCase(),
  });
}

export function generateBuildInfo({
  root = projectRoot,
  now = new Date(),
  commit,
  dirty,
  sourceFingerprint,
} = {}) {
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const gitCommit = commit ?? readGit(['rev-parse', 'HEAD'], 'unknown', root);
  const isDirty = dirty ?? readGit(['status', '--porcelain=v1', '--untracked-files=normal'], '', root) !== '';
  return createBuildInfo({
    version: packageJson.version,
    gitCommit,
    dirty: isDirty,
    builtAtUtc: now.toISOString(),
    sourceFingerprint: sourceFingerprint ?? computeSourceFingerprint(root),
  });
}

export function writeBuildInfo(info, root = projectRoot) {
  const output = resolve(root, 'dist', 'build-info.json');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(info, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o644,
  });
  return output;
}

function main() {
  const info = generateBuildInfo();
  const output = writeBuildInfo(info);
  const shortCommit = info.gitCommit === 'unknown' ? 'unknown' : info.gitCommit.slice(0, 12);
  console.log(
    `[build-info] v${info.version} ${shortCommit}${info.dirty ? '+dirty' : ''} `
      + `${info.builtAtUtc} source=${info.sourceFingerprint}`,
  );
  console.log(`[build-info] wrote ${output}`);
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryUrl) main();
