import { useRef, useEffect } from 'react';

export interface MousePosition {
  x: number;
  y: number;
}

// Ref instead of state so mousemove never triggers a re-render
export function useMousePosition(): React.RefObject<MousePosition> {
  const positionRef = useRef<MousePosition>({ x: 0, y: 0 });

  useEffect(() => {
    function handleMouseMove(e: MouseEvent): void {
      positionRef.current = { x: e.clientX, y: e.clientY };
    }
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return positionRef;
}
