import { useEffect } from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import type { AppConfig } from '../../../shared/types';

/**
 * Load config on mount and expose typed selectors.
 * Returns the config (or null while loading) and a boolean loading flag.
 */
export function useConfig(): { config: AppConfig | null; isLoading: boolean } {
  const config = useDashboardStore((s) => s.config);
  const isLoading = useDashboardStore((s) => s.isLoading);
  const loadConfig = useDashboardStore((s) => s.loadConfig);

  useEffect(() => {
    if (!config && !isLoading) {
      loadConfig();
    }
  }, [config, isLoading, loadConfig]);

  return { config, isLoading };
}
