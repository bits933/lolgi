import { ipcRenderer } from 'electron';
import { OVERLAY_OUTSIDE_CLICK } from '../shared/ipcChannels';

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('mousedown', (event) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    ipcRenderer.send(OVERLAY_OUTSIDE_CLICK);
  }, true);
});
