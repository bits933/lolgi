import { useEffect } from 'react';
import { useOverlayStore } from '../store/overlayStore';
import type { BubbleConfig } from '../../../shared/types';

/**
 * Listens to IPC events from main process and syncs them into the overlay store.
 * Must be called once at the root component level.
 */
export function useOverlayBridge(): void {
  const openRing = useOverlayStore((s) => s.openRing);
  const closeRing = useOverlayStore((s) => s.closeRing);
  const updateSystemState = useOverlayStore((s) => s.updateSystemState);

  useEffect(() => {
    // ring:open — main sends bubble configs and system state
    const unsubOpen = window.electronAPI.onRingOpen((payload) => {
      openRing(payload);
    });

    // ring:close — main forces close (e.g. Escape from hotkey)
    const unsubClose = window.electronAPI.onRingClose(() => {
      closeRing();
    });

    // config:updated — bubble config changed while ring is open
    const unsubConfig = window.electronAPI.onConfigUpdated((bubbles: BubbleConfig[]) => {
      // Update bubbles in store without closing the ring
      useOverlayStore.setState({ bubbles });
    });

    const unsubSystemState = window.electronAPI.onSystemStateUpdated((state) => {
      updateSystemState(state);
    });

    return () => {
      unsubOpen();
      unsubClose();
      unsubConfig();
      unsubSystemState();
    };
  }, [openRing, closeRing, updateSystemState]);
}
