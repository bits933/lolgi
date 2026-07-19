import { describe, expect, it } from 'vitest';
import * as LucideIcons from 'lucide-react';
import { ACTION_CATALOG } from './actionCatalog';
import { APP_ACTION_CATALOG } from './defaultProfiles';

/**
 * Guards against L-01: an action referencing a Lucide icon name that is not
 * exported by the installed lucide-react version silently falls back to a
 * generic shape. ACTION_CATALOG already spreads in APP_ACTION_CATALOG, but both
 * are listed for clarity.
 */
describe('catalog icons resolve in installed lucide-react', () => {
  const icons = LucideIcons as unknown as Record<string, unknown>;
  const iconNames = [...new Set(
    [...ACTION_CATALOG, ...APP_ACTION_CATALOG]
      .map((definition) => definition.iconName)
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
  )];

  it.each(iconNames)('icon "%s" is exported', (name) => {
    expect(icons[name], `Lucide icon "${name}" is not exported`).toBeTruthy();
  });
});
