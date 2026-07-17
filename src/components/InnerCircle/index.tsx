import React from 'react';
import { Menu, X } from 'lucide-react';
import { useRingStore } from '../../store/ringStore';
import styles from './InnerCircle.module.css';

export function InnerCircle(): React.ReactElement {
  const isOpen = useRingStore((s) => s.isOpen);
  const openRing = useRingStore((s) => s.openRing);
  const closeRing = useRingStore((s) => s.closeRing);

  const handleClick = (e: React.MouseEvent) => {
    if (isOpen) {
      closeRing();
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      openRing({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
  };

  return (
    <div className={styles.innerCircle} onClick={handleClick} data-inner-circle="true">
      <span className={`${styles.iconWrap} ${isOpen ? styles.iconWrapOpen : ''}`}>
        {isOpen ? <X size={22} color="#2d2d3a" strokeWidth={2} /> : <Menu size={22} color="#2d2d3a" strokeWidth={2} />}
      </span>
    </div>
  );
}
