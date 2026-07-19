import { Tray, Menu, nativeImage, app } from 'electron';
import { join } from 'path';
import { showDashboard } from './windows';
import { getConfig, setRingEnabled } from './store';
import { registerHotkey, unregisterHotkey } from './globalShortcut';

let tray: Tray | null = null;

export function createTray(): Tray {
  // Try to load the tray icon; fall back to empty image if not found
  let icon = nativeImage.createEmpty();
  try {
    const iconPath = join(__dirname, '../src/assets/tray-icon.png');
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      // Try the resources path for packaged app
      const resourcePath = join(process.resourcesPath ?? '', 'resources/tray-icon.png');
      icon = nativeImage.createFromPath(resourcePath);
    }
  } catch {
    // Use empty icon if asset not found
  }

  tray = new Tray(icon);
  tray.setToolTip('Lolgi Action Ring');

  updateTrayMenu();

  // Double-click opens dashboard
  tray.on('double-click', () => {
    showDashboard();
  });

  return tray;
}

export function updateTrayMenu(): void {
  if (!tray) return;

  const config = getConfig();
  const isEnabled = config.ringEnabled;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Settings',
      click: () => showDashboard(),
    },
    { type: 'separator' },
    {
      label: isEnabled ? 'Disable Ring' : 'Enable Ring',
      type: 'normal',
      click: () => {
        const newValue = !isEnabled;
        if (newValue) {
          if (!registerHotkey()) return;
        } else {
          unregisterHotkey();
        }
        setRingEnabled(newValue);
        updateTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

export function getTray(): Tray | null {
  return tray;
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
