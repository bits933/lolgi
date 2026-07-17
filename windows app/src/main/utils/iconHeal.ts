import type { ActionAssignment, BubbleConfig } from '../../shared/types';
import { getConfig, getConfigStore, saveProfile } from '../store';
import { extractAppIcon, isValidImageDataUrl } from './appIcon';

/**
 * One-time startup repair for app-launch icons persisted by the old,
 * unvalidated extraction path (pre manifest-first Store extraction). Those
 * configs can hold junk/placeholder data URLs that render as a broken image
 * on the bubble. This pass re-extracts every app-launch icon through the
 * fixed pipeline and persists the result; clearly-invalid icons that cannot
 * be re-extracted are cleared so the bubble falls back to its Lucide glyph
 * instead of a broken <img>.
 *
 * Bump ICON_HEAL_VERSION whenever the extraction pipeline improves enough
 * that previously-persisted icons should be refreshed again.
 */
const ICON_HEAL_VERSION = 2;
const ICON_HEAL_KEY = 'iconHealVersion';

interface IconCarrier {
  actionType?: string;
  payload?: string;
  iconDataUrl?: string;
}

async function healCarrier(carrier: IconCarrier): Promise<boolean> {
  if (carrier.actionType !== 'app-launch' || !carrier.payload?.trim()) return false;
  const fresh = await extractAppIcon(carrier.payload.trim()).catch(() => null);
  if (fresh && fresh !== carrier.iconDataUrl) {
    carrier.iconDataUrl = fresh;
    return true;
  }
  if (!fresh && carrier.iconDataUrl && !isValidImageDataUrl(carrier.iconDataUrl)) {
    carrier.iconDataUrl = undefined;
    return true;
  }
  return false;
}

export async function healPersistedAppIcons(): Promise<void> {
  const store = getConfigStore();
  const raw = store.store as unknown as Record<string, unknown>;
  if (raw[ICON_HEAL_KEY] === ICON_HEAL_VERSION) return;

  let healed = 0;
  try {
    const config = getConfig();
    for (const profile of config.profiles) {
      let changed = false;
      for (const slot of profile.slots) {
        const assignment: ActionAssignment | null = slot.assignment;
        if (!assignment) continue;
        if (await healCarrier(assignment)) changed = true;
        for (const child of (assignment.children ?? []) as BubbleConfig[]) {
          if (await healCarrier(child)) changed = true;
        }
      }
      if (changed) {
        const result = saveProfile(profile);
        if (result.status === 'ok') healed += 1;
        else console.warn(`[iconHeal] Could not persist healed profile "${profile.name}": ${result.status}`);
      }
    }
    if (healed > 0) console.log(`[iconHeal] Refreshed app icons in ${healed} profile(s).`);
  } finally {
    // Mark done even on partial failure — extractAppIcon never throws, and a
    // boot loop of PowerShell extractions would be worse than a stale icon.
    (store as unknown as { set(key: string, value: unknown): void }).set(ICON_HEAL_KEY, ICON_HEAL_VERSION);
  }
}
