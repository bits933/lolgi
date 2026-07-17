import React, { useState } from 'react';
import { ActionsRing } from './components/ActionsRing/index';
import { Toast } from './components/Toast/index';
import { useOverlayBridge } from './hooks/useOverlayBridge';

export function App(): React.ReactElement {
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Connect IPC events to store
  useOverlayBridge();

  return (
    <>
      <ActionsRing />
      <Toast message={toastMessage} />
    </>
  );
}
