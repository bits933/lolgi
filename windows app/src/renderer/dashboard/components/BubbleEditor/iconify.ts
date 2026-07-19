/**
 * Thin client for the public Iconify API (https://api.iconify.design) — the
 * "search every icon on the internet" tier of the icon picker. No SDK, no
 * bundled icon data: everything is fetched on demand and cached in memory
 * for the life of the dashboard session.
 *
 * This module is dashboard-only. The overlay never imports it and never
 * makes network requests — see IconPicker.tsx and the dashboard CSP for the
 * `connect-src` allowance that scopes this to api.iconify.design.
 */

const SEARCH_URL = 'https://api.iconify.design/search';
const ICON_URL = 'https://api.iconify.design';

/** Matches the bubble's default `--bubble-icon` token so fetched glyphs read correctly on the dark surface. */
export const ICONIFY_ICON_COLOR = '#f0f1f3';

const searchCache = new Map<string, string[]>();
const svgCache = new Map<string, string>();

/**
 * Searches Iconify's full catalog (200k+ open-source icons aggregated from
 * many icon sets, each under its own license — see Iconify's licensing page
 * per-set if redistribution matters) and returns "prefix:name" ids.
 */
export async function searchIconifyIcons(query: string, limit = 48): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const cacheKey = `${trimmed.toLowerCase()}::${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const url = `${SEARCH_URL}?query=${encodeURIComponent(trimmed)}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Iconify search failed (${response.status})`);

  const data = (await response.json()) as { icons?: unknown };
  const icons = Array.isArray(data.icons)
    ? data.icons.filter((icon): icon is string => typeof icon === 'string')
    : [];

  searchCache.set(cacheKey, icons);
  return icons;
}

/**
 * Strips anything in a fetched SVG that could execute script or reach the
 * network before it is turned into a data URL: <script> elements, "on*"
 * event-handler attributes (any quoting style), javascript: URIs in
 * href/xlink:href, and <foreignObject> (can smuggle HTML/script content).
 *
 * Belt-and-suspenders: rendering via `data:image/svg+xml` inside an <img>
 * already prevents SVG script execution per spec, but we sanitize anyway
 * since a future change could inline this SVG into the DOM instead.
 */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s"'>]+/gi, '')
    .replace(/(href|xlink:href)\s*=\s*"\s*javascript:[^"]*"/gi, '$1="#"')
    .replace(/(href|xlink:href)\s*=\s*'\s*javascript:[^']*'/gi, "$1='#'");
}

/** Recolors `currentColor` fills/strokes and encodes the SVG as a data URL. */
export function svgToDataUrl(svg: string, color: string = ICONIFY_ICON_COLOR): string {
  const recolored = svg.replace(/currentColor/g, color);
  return `data:image/svg+xml,${encodeURIComponent(recolored)}`;
}

/**
 * Fetches and caches a single icon's SVG as a ready-to-render data URL.
 * Throws on network failure or a response that doesn't look like an SVG —
 * callers should catch and fall back gracefully (see IconPicker.tsx).
 */
export async function fetchIconifyIconDataUrl(iconId: string): Promise<string> {
  const cached = svgCache.get(iconId);
  if (cached) return cached;

  const [prefix, ...rest] = iconId.split(':');
  const name = rest.join(':');
  if (!prefix || !name) throw new Error(`Invalid Iconify icon id: "${iconId}"`);

  const url = `${ICON_URL}/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Iconify SVG fetch failed (${response.status})`);

  const rawSvg = await response.text();
  if (!/<svg[\s>]/i.test(rawSvg)) throw new Error(`Iconify response was not an SVG for "${iconId}"`);

  const dataUrl = svgToDataUrl(sanitizeSvg(rawSvg));
  svgCache.set(iconId, dataUrl);
  return dataUrl;
}

/** Splits "mdi:home" into its display name ("home") for labels/tooltips. */
export function iconifyDisplayName(iconId: string): string {
  const idx = iconId.indexOf(':');
  return idx === -1 ? iconId : iconId.slice(idx + 1);
}
