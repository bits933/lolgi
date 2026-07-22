import { app } from 'electron';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';

const LEGACY_USER_DATA_DIRECTORY = 'logi-actions-ring';
const MIGRATABLE_FILES = [
  'config.json',
  join('diagnostics', 'recent.json'),
];

/**
 * Preserve existing local profiles and diagnostics when the package name moves
 * from the previous application identifier to the Lolgi identifier.
 */
export function migrateLegacyUserData(): void {
  const currentDirectory = app.getPath('userData');
  const legacyDirectory = join(app.getPath('appData'), LEGACY_USER_DATA_DIRECTORY);
  if (resolve(currentDirectory) === resolve(legacyDirectory)) return;

  let copiedAnyFile = false;
  for (const relativePath of MIGRATABLE_FILES) {
    const sourcePath = join(legacyDirectory, relativePath);
    const destinationPath = join(currentDirectory, relativePath);
    if (!existsSync(sourcePath) || existsSync(destinationPath)) continue;
    mkdirSync(dirname(destinationPath), { recursive: true });
    copyFileSync(sourcePath, destinationPath);
    copiedAnyFile = true;
  }

  if (copiedAnyFile) {
    console.info('[main] Migrated existing local Lolgi data from the legacy app directory.');
  }
}
