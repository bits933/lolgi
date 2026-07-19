import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import { LoaderCircle } from 'lucide-react';
import { fetchIconifyIconDataUrl, iconifyDisplayName, searchIconifyIcons } from './iconify';
import styles from './IconPicker.module.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyIconComponent = React.ComponentType<any>;

interface IconPickerProps {
  selectedIcon: string;
  onSelect: (iconName: string, iconDataUrl?: string) => void;
}

/** Debounce before an Iconify search fires — avoids a request per keystroke. */
const ICONIFY_SEARCH_DEBOUNCE_MS = 280;
/** Iconify search only runs once the query is long enough to be meaningful. */
const ICONIFY_MIN_QUERY_LENGTH = 2;

type IconifyIconStatus = 'loading' | 'ready' | 'error';
interface IconifyIconState {
  status: IconifyIconStatus;
  dataUrl?: string;
}

// Get all exported icon names from lucide-react
const ALL_ICON_NAMES: string[] = Object.keys(LucideIcons).filter(
  (key) =>
    typeof (LucideIcons as Record<string, unknown>)[key] === 'function' &&
    key !== 'createLucideIcon' &&
    /^[A-Z]/.test(key)
);

// Curated common icons shown when search is empty
const COMMON_ICONS: string[] = [
  'Volume2', 'VolumeX', 'Mic', 'MicOff', 'Camera',
  'Clipboard', 'Clock', 'Settings', 'Sun', 'Moon',
  'Play', 'Pause', 'SkipForward', 'SkipBack', 'Music',
  'Headphones', 'Monitor', 'Wifi', 'Bluetooth', 'Battery',
  'Zap', 'Heart', 'Star', 'Bell', 'BellOff',
  'Mail', 'MessageSquare', 'Phone', 'Video', 'Image',
  'Download', 'Upload', 'Search', 'Home', 'User',
  'Users', 'Lock', 'Unlock', 'Eye', 'EyeOff',
  'Trash2', 'Pencil', 'Copy', 'Save', 'FolderOpen',
  'File', 'Terminal', 'Code', 'Globe', 'Map',
  'Navigation', 'Compass', 'Layers', 'Grid3X3', 'LayoutDashboard',
  'Maximize', 'Minimize', 'RotateCw', 'RefreshCw', 'Power',
].filter((name) => name in (LucideIcons as Record<string, unknown>));

// Memoized icon cell to avoid re-renders in the grid
const IconCell = React.memo(function IconCell({
  name,
  isSelected,
  onSelect,
}: {
  name: string;
  isSelected: boolean;
  onSelect: (name: string) => void;
}) {
  const Icon = (LucideIcons as unknown as Record<string, AnyIconComponent>)[name];
  if (!Icon) return null;

  return (
    <button
      className={`${styles.iconBtn} ${isSelected ? styles.iconBtnSelected : ''}`}
      type="button"
      onClick={() => onSelect(name)}
      title={name}
      aria-pressed={isSelected}
    >
      <Icon size={20} />
      <span className={styles.iconLabel}>{name}</span>
    </button>
  );
});

// Icon cell for an Iconify result — renders the fetched-on-demand SVG (as a
// data URL, never an external <img src="https://...">) once it resolves.
const IconifyCell = React.memo(function IconifyCell({
  iconId,
  state,
  isSelected,
  onSelect,
}: {
  iconId: string;
  state: IconifyIconState | undefined;
  isSelected: boolean;
  onSelect: (iconId: string, dataUrl: string) => void;
}) {
  const status = state?.status ?? 'loading';

  return (
    <button
      className={`${styles.iconBtn} ${isSelected ? styles.iconBtnSelected : ''}`}
      type="button"
      onClick={() => state?.dataUrl && onSelect(iconId, state.dataUrl)}
      disabled={status !== 'ready'}
      title={iconId}
      aria-pressed={isSelected}
    >
      {status === 'ready' && state?.dataUrl ? (
        <img src={state.dataUrl} alt="" width={20} height={20} draggable={false} />
      ) : status === 'error' ? (
        <span className={styles.iconErrorGlyph}>?</span>
      ) : (
        <LoaderCircle size={18} className={styles.spinner} />
      )}
      <span className={styles.iconLabel}>{iconifyDisplayName(iconId)}</span>
    </button>
  );
});

export function IconPicker({ selectedIcon, onSelect }: IconPickerProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [iconifyIds, setIconifyIds] = useState<string[]>([]);
  const [iconifyStates, setIconifyStates] = useState<Map<string, IconifyIconState>>(new Map());
  const [iconifyLoading, setIconifyLoading] = useState(false);
  const [iconifyError, setIconifyError] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  const filtered = useMemo(() => {
    if (!query.trim()) return COMMON_ICONS;
    const q = query.toLowerCase();
    return ALL_ICON_NAMES.filter((name) => name.toLowerCase().includes(q)).slice(0, 120);
  }, [query]);

  // Debounced Iconify search — runs alongside the (always-available, offline)
  // Lucide search above so a slow/missing connection never blocks it.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < ICONIFY_MIN_QUERY_LENGTH) {
      setIconifyIds([]);
      setIconifyStates(new Map());
      setIconifyLoading(false);
      setIconifyError(null);
      return undefined;
    }

    const generation = ++requestGeneration.current;
    setIconifyLoading(true);
    setIconifyError(null);

    const timer = setTimeout(() => {
      searchIconifyIcons(trimmed)
        .then((ids) => {
          if (requestGeneration.current !== generation) return; // stale — a newer search superseded this one
          setIconifyIds(ids);
          setIconifyLoading(false);
          setIconifyStates(new Map(ids.map((id) => [id, { status: 'loading' as const }])));

          ids.forEach((id) => {
            fetchIconifyIconDataUrl(id)
              .then((dataUrl) => {
                if (requestGeneration.current !== generation) return;
                setIconifyStates((prev) => {
                  const next = new Map(prev);
                  next.set(id, { status: 'ready', dataUrl });
                  return next;
                });
              })
              .catch(() => {
                if (requestGeneration.current !== generation) return;
                setIconifyStates((prev) => {
                  const next = new Map(prev);
                  next.set(id, { status: 'error' });
                  return next;
                });
              });
          });
        })
        .catch(() => {
          if (requestGeneration.current !== generation) return;
          setIconifyLoading(false);
          setIconifyIds([]);
          setIconifyStates(new Map());
          setIconifyError('Couldn’t reach the online icon library. Check your connection — Lucide search below still works offline.');
        });
    }, ICONIFY_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = useCallback((name: string) => {
    onSelect(name);
  }, [onSelect]);

  const handleSelectIconify = useCallback((iconId: string, dataUrl: string) => {
    onSelect(iconId, dataUrl);
  }, [onSelect]);

  const showIconifySection = query.trim().length >= ICONIFY_MIN_QUERY_LENGTH;

  return (
    <div className={styles.iconPicker}>
      <div className={styles.searchRow}>
        <input
          className={styles.search}
          placeholder="Search icons…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search icons"
        />
        <span className={styles.resultCount}>
          {query.trim() === ''
            ? `${COMMON_ICONS.length} common`
            : `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`}
        </span>
      </div>
      <div className={styles.sectionLabel}>{query.trim() === '' ? 'Common' : 'Lucide (offline)'}</div>
      <div className={styles.grid}>
        {filtered.length === 0 ? (
          <div className={styles.emptyState}>No icons match &ldquo;{query}&rdquo;. Try a shorter search.</div>
        ) : (
          filtered.map((name) => (
            <IconCell
              key={name}
              name={name}
              isSelected={selectedIcon === name}
              onSelect={handleSelect}
            />
          ))
        )}
      </div>

      {showIconifySection && (
        <>
          <div className={styles.sectionLabel}>
            <span>Online library (Iconify — 200k+ icons)</span>
            {iconifyLoading && <LoaderCircle size={12} className={styles.spinner} />}
          </div>
          {iconifyError ? (
            <div className={styles.emptyState}>{iconifyError}</div>
          ) : !iconifyLoading && iconifyIds.length === 0 ? (
            <div className={styles.emptyState}>No online results for &ldquo;{query}&rdquo;.</div>
          ) : (
            <div className={styles.grid}>
              {iconifyIds.map((iconId) => (
                <IconifyCell
                  key={iconId}
                  iconId={iconId}
                  state={iconifyStates.get(iconId)}
                  isSelected={selectedIcon === iconId}
                  onSelect={handleSelectIconify}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
