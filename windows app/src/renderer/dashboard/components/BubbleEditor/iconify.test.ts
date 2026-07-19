import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchIconifyIconDataUrl,
  iconifyDisplayName,
  sanitizeSvg,
  searchIconifyIcons,
  svgToDataUrl,
} from './iconify';

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number; text?: string } = {}): void {
  const ok = init.ok ?? true;
  const status = init.status ?? 200;
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(init.text ?? ''),
  }) as unknown as typeof fetch;
}

describe('sanitizeSvg', () => {
  it('strips <script> elements', () => {
    const svg = '<svg><script>alert(1)</script><path d="M0 0"/></svg>';
    expect(sanitizeSvg(svg)).not.toContain('<script');
    expect(sanitizeSvg(svg)).toContain('<path');
  });

  it('strips inline event-handler attributes regardless of quoting', () => {
    const svg = `<svg onload="evil()"><path onclick='evil()' onmouseover=evil() d="M0 0"/></svg>`;
    const cleaned = sanitizeSvg(svg);
    expect(cleaned).not.toMatch(/on\w+\s*=/i);
  });

  it('strips foreignObject blocks', () => {
    const svg = '<svg><foreignObject><body>hi</body></foreignObject><circle r="1"/></svg>';
    const cleaned = sanitizeSvg(svg);
    expect(cleaned).not.toContain('foreignObject');
    expect(cleaned).toContain('<circle');
  });

  it('neutralizes javascript: URIs in href/xlink:href', () => {
    const svg = `<svg><a href="javascript:evil()"><path xlink:href='javascript:evil()' d="M0 0"/></a></svg>`;
    const cleaned = sanitizeSvg(svg);
    expect(cleaned).not.toContain('javascript:');
  });

  it('leaves benign SVG content untouched', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M1 2"/></svg>';
    expect(sanitizeSvg(svg)).toBe(svg);
  });
});

describe('svgToDataUrl', () => {
  it('recolors currentColor and encodes as a data URL', () => {
    const svg = '<svg><path fill="currentColor" stroke="currentColor" d="M0 0"/></svg>';
    const url = svgToDataUrl(svg, '#f0f1f3');
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(url.slice('data:image/svg+xml,'.length))).toContain('#f0f1f3');
    expect(decodeURIComponent(url)).not.toContain('currentColor');
  });

  it('defaults to the bubble icon color token value', () => {
    const url = svgToDataUrl('<svg fill="currentColor"></svg>');
    expect(decodeURIComponent(url)).toContain('#f0f1f3');
  });
});

describe('iconifyDisplayName', () => {
  it('returns the name portion after the prefix', () => {
    expect(iconifyDisplayName('mdi:home-outline')).toBe('home-outline');
  });

  it('returns the whole id when there is no prefix separator', () => {
    expect(iconifyDisplayName('home')).toBe('home');
  });
});

describe('searchIconifyIcons', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns icon ids from a successful search', async () => {
    mockFetchOnce({ icons: ['mdi:home', 'lucide:home'] });
    const ids = await searchIconifyIcons('home-unique-query-1');
    expect(ids).toEqual(['mdi:home', 'lucide:home']);
  });

  it('filters out non-string entries defensively', async () => {
    mockFetchOnce({ icons: ['mdi:home', 42, null] });
    const ids = await searchIconifyIcons('home-unique-query-2');
    expect(ids).toEqual(['mdi:home']);
  });

  it('returns an empty array for a blank query without calling fetch', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const ids = await searchIconifyIcons('   ');
    expect(ids).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws when the network response is not ok (caller handles the offline fallback)', async () => {
    mockFetchOnce({}, { ok: false, status: 500 });
    await expect(searchIconifyIcons('home-unique-query-3')).rejects.toThrow();
  });
});

describe('fetchIconifyIconDataUrl', () => {
  it('fetches, sanitizes, and recolors the icon SVG into a data URL', async () => {
    mockFetchOnce(undefined, { text: '<svg><script>evil()</script><path fill="currentColor" d="M0 0"/></svg>' });
    const dataUrl = await fetchIconifyIconDataUrl('mdi:home-unique-icon-1');
    expect(dataUrl.startsWith('data:image/svg+xml,')).toBe(true);
    const decoded = decodeURIComponent(dataUrl);
    expect(decoded).not.toContain('<script');
    expect(decoded).toContain('#f0f1f3');
  });

  it('rejects an invalid icon id shape', async () => {
    await expect(fetchIconifyIconDataUrl('no-colon-here-unique')).rejects.toThrow();
  });

  it('rejects a non-SVG response instead of caching garbage', async () => {
    mockFetchOnce(undefined, { text: '<html>not an icon</html>' });
    await expect(fetchIconifyIconDataUrl('mdi:not-svg-unique')).rejects.toThrow();
  });
});
