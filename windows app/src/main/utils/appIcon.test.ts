import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronHarness = vi.hoisted(() => ({
  getFileIcon: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isReady: vi.fn(() => true),
    whenReady: vi.fn(async () => undefined),
    getFileIcon: electronHarness.getFileIcon,
  },
}));

vi.mock('./foregroundApp', () => ({
  runPowerShell: vi.fn(),
}));

describe('application icon cache', () => {
  beforeEach(() => {
    vi.resetModules();
    electronHarness.getFileIcon.mockReset();
    electronHarness.getFileIcon.mockImplementation(async (path: string) => ({
      isEmpty: () => false,
      resize: () => ({
        toDataURL: () => `data:image/png;base64,${Buffer.from(path.repeat(8)).toString('base64')}`,
      }),
    }));
  });

  it('evicts the least-recently-used successful icon after the entry cap', async () => {
    const { APP_ICON_CACHE_MAX_ENTRIES, extractAppIcon } = await import('./appIcon');

    for (let index = 0; index <= APP_ICON_CACHE_MAX_ENTRIES; index += 1) {
      await extractAppIcon(`C:\\Apps\\app-${index}.exe`);
    }
    expect(electronHarness.getFileIcon).toHaveBeenCalledTimes(APP_ICON_CACHE_MAX_ENTRIES + 1);

    await extractAppIcon('C:\\Apps\\app-0.exe');

    expect(electronHarness.getFileIcon).toHaveBeenCalledTimes(APP_ICON_CACHE_MAX_ENTRIES + 2);
  });
});
