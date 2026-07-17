import { useEffect, useRef, type RefObject } from 'react';
import { useRingStore } from '../store/ringStore';
import type { MousePosition } from './useMousePosition';

export function useTrigger(mousePositionRef: RefObject<MousePosition>): void {
  const mode = useRingStore((s) => s.mode);
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const currentMode = modeRef.current;
      const store = useRingStore.getState();

      if (e.key === 'Escape') {
        if (store.isOpen) store.closeRing();
        return;
      }

      const pos = mousePositionRef.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };

      if (currentMode === 'A' && e.ctrlKey && e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        if (!store.isOpen) store.openRing(pos);
      }

      if (currentMode === 'B' && e.code === 'Space' && !e.repeat) {
        // preventDefault must be in keydown, not keyup
        e.preventDefault();
        if (!store.isOpen) store.openRing(pos);
      }
    }

    function handleKeyUp(e: KeyboardEvent): void {
      if (modeRef.current !== 'B' || e.code !== 'Space') return;
      const store = useRingStore.getState();
      if (!store.isOpen) return;

      const { hoveredIndex } = store;
      if (hoveredIndex !== null) {
        import('../utils/actions').then(({ ACTIONS }) => {
          ACTIONS[hoveredIndex].execute();
          store.closeRing();
        });
      } else {
        store.closeRing();
      }
    }

    // mousedown fires before onClick on bubbles — check target before dismissing
    function handleMouseDown(e: MouseEvent): void {
      if (modeRef.current !== 'A') return;
      const store = useRingStore.getState();
      if (!store.isOpen) return;
      if (!(e.target as HTMLElement).closest('[data-bubble]')) store.closeRing();
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);
}
