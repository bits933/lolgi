import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const paths = vi.hoisted(() => ({
  appData: '',
  userData: '',
}));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => name === 'appData' ? paths.appData : paths.userData,
  },
}));

const temporaryDirectories: string[] = [];

beforeEach(async () => {
  vi.resetModules();
  const root = await mkdtemp(join(tmpdir(), 'lolgi-legacy-data-'));
  temporaryDirectories.push(root);
  paths.appData = root;
  paths.userData = join(root, 'lolgi-actions-ring');
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('legacy user-data migration', () => {
  it('copies existing settings and diagnostics into the Lolgi data directory once', async () => {
    const legacy = join(paths.appData, 'logi-actions-ring');
    await mkdir(join(legacy, 'diagnostics'), { recursive: true });
    await writeFile(join(legacy, 'config.json'), '{"hotkey":"Ctrl+Space"}', 'utf8');
    await writeFile(join(legacy, 'diagnostics', 'recent.json'), '{"events":[]}', 'utf8');

    const { migrateLegacyUserData } = await import('./legacyUserData');
    migrateLegacyUserData();
    migrateLegacyUserData();

    await expect(readFile(join(paths.userData, 'config.json'), 'utf8')).resolves.toContain('Ctrl+Space');
    await expect(readFile(join(paths.userData, 'diagnostics', 'recent.json'), 'utf8')).resolves.toContain('events');
  });

  it('never overwrites an existing Lolgi configuration', async () => {
    const legacy = join(paths.appData, 'logi-actions-ring');
    await mkdir(legacy, { recursive: true });
    await mkdir(paths.userData, { recursive: true });
    await writeFile(join(legacy, 'config.json'), '{"hotkey":"Legacy"}', 'utf8');
    await writeFile(join(paths.userData, 'config.json'), '{"hotkey":"Current"}', 'utf8');

    const { migrateLegacyUserData } = await import('./legacyUserData');
    migrateLegacyUserData();

    await expect(readFile(join(paths.userData, 'config.json'), 'utf8')).resolves.toContain('Current');
  });
});
