import { DEFAULT_ACCENT_COLOR, DEFAULT_ACCENT_FILL_COLOR, DEFAULT_BUBBLE_COLOR } from './constants';
import type { BubbleSurfaceTokens, ThemeConfig } from './types';

type RgbTuple = [number, number, number];

export interface ResolvedThemeColors {
  accent: string;
  accentHover: string;
  accentMuted: string;
  accentGlow: string;
  accentFill: string;
  textOnAccent: string;
  borderAccent: string;
  borderAccentStrong: string;
  shadowGlow: string;
  /** Bubble surface colors derived from the user's chosen bubble background. */
  bubbleSurface: BubbleSurfaceTokens;
}

function hexToRgb(hex: string): RgbTuple {
  const compact = hex.replace('#', '');
  const full = compact.length === 3
    ? compact.split('').map((character) => character + character).join('')
    : compact;
  const value = parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgba([red, green, blue]: RgbTuple, alpha: number): string {
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function darken([red, green, blue]: RgbTuple, amount = 0.13): RgbTuple {
  return [red, green, blue].map((channel) =>
    Math.max(0, Math.round(channel * (1 - amount)))) as RgbTuple;
}

function rgbCss([red, green, blue]: RgbTuple): string {
  return `rgb(${red}, ${green}, ${blue})`;
}

/**
 * Shifts a color toward white (for dark inputs) or black (for light inputs) by
 * `amount`, always increasing contrast against the base fill. This keeps bubble
 * borders and hover states visible no matter what background color the user picks.
 */
function contrastShift([red, green, blue]: RgbTuple, amount: number, towardLight: boolean): RgbTuple {
  const target = towardLight ? 255 : 0;
  return [red, green, blue].map((channel) =>
    Math.max(0, Math.min(255, Math.round(channel + (target - channel) * amount)))) as RgbTuple;
}

/** Derives the shared bubble-surface tokens from a single background color. */
export function resolveBubbleSurface(bubbleColor: string): BubbleSurfaceTokens {
  const rgb = hexToRgb(bubbleColor);
  // A light fill needs dark icons/borders; a dark fill needs light ones.
  const fillIsLight = relativeLuminance(rgb) > 0.45;
  const towardLight = !fillIsLight;
  return {
    fill: bubbleColor,
    surfaceHover: rgbCss(contrastShift(rgb, 0.1, towardLight)),
    stroke: rgbCss(contrastShift(rgb, 0.3, towardLight)),
    borderHover: rgbCss(contrastShift(rgb, 0.45, towardLight)),
    adjustmentFill: rgbCss(contrastShift(rgb, 0.18, towardLight)),
    onSurface: fillIsLight ? '#14151a' : '#f0f1f3',
  };
}

function relativeLuminance([red, green, blue]: RgbTuple): number {
  const linear = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** Resolves the persisted theme into the color tokens shared by both renderers. */
export function resolveThemeColors(theme: ThemeConfig): ResolvedThemeColors {
  const accent = theme.mode === 'custom' ? theme.accentColor : DEFAULT_ACCENT_COLOR;
  const accentFill = theme.mode === 'custom' ? theme.accentColor : DEFAULT_ACCENT_FILL_COLOR;
  const accentRgb = hexToRgb(accent);
  const fillRgb = hexToRgb(accentFill);

  return {
    accent,
    accentHover: `rgb(${darken(accentRgb).join(', ')})`,
    accentMuted: rgba(accentRgb, 0.16),
    accentGlow: rgba(accentRgb, 0.25),
    accentFill,
    textOnAccent: relativeLuminance(fillRgb) > 0.45 ? '#14151a' : '#ffffff',
    borderAccent: rgba(accentRgb, 0.4),
    borderAccentStrong: rgba(accentRgb, 0.6),
    shadowGlow: `0 0 20px ${rgba(accentRgb, 0.15)}`,
    bubbleSurface: resolveBubbleSurface(theme.bubbleColor || DEFAULT_BUBBLE_COLOR),
  };
}
