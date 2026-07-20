import { useEffect } from 'react';
import { resolveThemeColors } from '../../../shared/themeColors';
import { useDashboardStore } from '../store/dashboardStore';

/**
 * Applies the persisted theme to the dashboard. System mode follows the OS,
 * while accent-family tokens are shared with the overlay renderer.
 */
export function useTheme(): void {
  const theme = useDashboardStore((state) => state.config?.theme);

  useEffect(() => {
    if (!theme) return;

    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const applyPalette = () => {
      const resolved =
        theme.mode === 'light' ? 'light'
        : theme.mode === 'dark' || theme.mode === 'custom' ? 'dark'
        : media.matches ? 'dark' : 'light';
      root.dataset.theme = resolved;
    };

    const colors = resolveThemeColors(theme);
    root.style.setProperty('--accent', colors.accent);
    root.style.setProperty('--accent-hover', colors.accentHover);
    root.style.setProperty('--accent-muted', colors.accentMuted);
    root.style.setProperty('--accent-glow', colors.accentGlow);
    root.style.setProperty('--accent-fill', colors.accentFill);
    root.style.setProperty('--text-on-accent', colors.textOnAccent);
    root.style.setProperty('--border-accent-strong', colors.borderAccentStrong);
    root.style.setProperty('--shadow-glow', colors.shadowGlow);

    // Bubble surface tokens — drive the ring preview's bubble background/border/icon.
    const bubble = colors.bubbleSurface;
    root.style.setProperty('--bubble-fill', bubble.fill);
    root.style.setProperty('--bubble-stroke', bubble.stroke);
    root.style.setProperty('--bubble-icon', bubble.onSurface);
    root.style.setProperty('--bubble-adjustment-fill', bubble.adjustmentFill);

    applyPalette();

    if (theme.mode === 'system') {
      media.addEventListener('change', applyPalette);
      return () => media.removeEventListener('change', applyPalette);
    }
  }, [theme]);
}
