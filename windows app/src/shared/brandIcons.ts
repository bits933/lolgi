function svgDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const AI_BRAND_ICONS = {
  chatgpt: svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="none" stroke="#f0f1f3" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M31 9a13 13 0 0 1 22 10v13L42 38 31 32V19"/><path d="M53 24a13 13 0 0 1-1 25l-11 6-11-6V37"/><path d="M47 50a13 13 0 0 1-21 11L15 55V42l11-6"/><path d="M21 55A13 13 0 0 1 10 35l11-6 11 6v13"/><path d="M10 40A13 13 0 0 1 11 15l11-6 11 6v12"/><path d="M17 14A13 13 0 0 1 39 4l11 6v13l-11 6"/></g></svg>`),
  gemini: svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="8" y1="56" x2="56" y2="8"><stop stop-color="#4b8bf5"/><stop offset=".52" stop-color="#9b72f2"/><stop offset="1" stop-color="#f06aa7"/></linearGradient></defs><path fill="url(#g)" d="M32 3c1.8 16.6 12.4 27.2 29 29-16.6 1.8-27.2 12.4-29 29C30.2 44.4 19.6 33.8 3 32 19.6 30.2 30.2 19.6 32 3Z"/></svg>`),
  claude: svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="#d97757"><path d="M29 3h6l1 19 8-17 6 3-9 17 16-10 3 6-17 9 19-1v6l-19 1 17 8-3 6-17-9 10 16-6 3-9-17-1 19h-6l-1-19-8 17-6-3 9-17-16 10-3-6 17-9-19 1v-6l19-1-17-8 3-6 17 9-10-16 6-3 9 17z"/><circle cx="32" cy="32" r="9"/></g></svg>`),
} as const;

export const AI_PROVIDERS = [
  { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com' },
  { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com' },
  { id: 'claude', label: 'Claude', url: 'https://claude.ai' },
  { id: 'custom', label: 'Custom...', url: '' },
] as const;

export type AiProviderId = (typeof AI_PROVIDERS)[number]['id'];
