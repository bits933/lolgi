import React, { useState, useMemo, useCallback } from 'react';
import * as LucideIcons from 'lucide-react';
import styles from './IconPicker.module.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyIconComponent = React.ComponentType<any>;

interface IconPickerProps {
  selectedIcon: string;
  onSelect: (iconName: string) => void;
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
      onClick={() => onSelect(name)}
      title={name}
    >
      <Icon size={20} />
      <span className={styles.iconLabel}>{name}</span>
    </button>
  );
});

export function IconPicker({ selectedIcon, onSelect }: IconPickerProps): React.ReactElement {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return COMMON_ICONS;
    const q = query.toLowerCase();
    return ALL_ICON_NAMES.filter((name) => name.toLowerCase().includes(q)).slice(0, 120);
  }, [query]);

  const handleSelect = useCallback((name: string) => {
    onSelect(name);
  }, [onSelect]);

  return (
    <div className={styles.iconPicker}>
      <div className={styles.searchRow}>
        <input
          className={styles.search}
          placeholder="Search icons..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className={styles.resultCount}>
          {query.trim() === ''
            ? `${COMMON_ICONS.length} common`
            : `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`}
        </span>
      </div>
      <div className={styles.grid}>
        {filtered.length === 0 ? (
          <div className={styles.emptyState}>No icons match "{query}"</div>
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
    </div>
  );
}
