import { nativeImage, net } from 'electron';

const ICON_SIZE = 64;
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

function parseHostname(rawUrl: string): string | null {
  try {
    const value = rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`;
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function validPngDataUrl(value: string): boolean {
  if (!value.startsWith('data:image/png;base64,')) return false;
  try {
    return Buffer.from(value.slice('data:image/png;base64,'.length), 'base64').length >= 100;
  } catch {
    return false;
  }
}

async function fetchImage(url: string, minimumBytes: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await net.fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < minimumBytes) return null;
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return null;
    const dataUrl = image.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: 'best' }).toDataURL();
    return validPngDataUrl(dataUrl) ? dataUrl : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchUncached(hostname: string): Promise<string | null> {
  const encodedHost = encodeURIComponent(hostname);
  return await fetchImage(`https://www.google.com/s2/favicons?domain=${encodedHost}&sz=${ICON_SIZE}`, 200)
    ?? await fetchImage(`https://icons.duckduckgo.com/ip3/${encodedHost}.ico`, 100);
}

export async function fetchUrlIcon(rawUrl: string): Promise<string | null> {
  const hostname = parseHostname(rawUrl.trim());
  if (!hostname) return null;
  const cached = cache.get(hostname);
  if (cached) return cached;
  const running = inFlight.get(hostname);
  if (running) return running;

  const request = fetchUncached(hostname)
    .then((result) => {
      if (result) cache.set(hostname, result);
      return result;
    })
    .finally(() => inFlight.delete(hostname));
  inFlight.set(hostname, request);
  return request;
}
