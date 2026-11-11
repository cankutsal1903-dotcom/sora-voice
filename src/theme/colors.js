/**
 * Sora Design System - Modern Color Palette
 * Tüm uygulama boyunca tutarlı renk kullanımı için merkezi tema
 */

export const COLORS = {
  // Backgrounds
  background: '#F0F3F4',
  surface: '#FFFFFF',
  surfaceRaised: '#F7F9FA',
  raised: '#EAEEF1',
  line: '#E1E6EA',

  // Text
  text: '#11161C',
  textSecondary: '#4B5462',
  muted: '#8A93A3',
  mutedDark: '#6B7482',

  // Primary Brand
  primary: '#01D9A8',
  primaryInk: '#04211B',
  primaryDark: '#00A985',
  primaryLight: '#4FE8C4',

  // Accent Colors
  accent: '#3B9DF8',
  accentPurple: '#8B5CF6',
  accentPink: '#F0568C',

  // Status
  danger: '#E5486B',
  dangerDark: '#C2294A',
  warning: '#E0A93A',
  success: '#01D9A8',

  // Gradients
  gradients: {
    primary: ['#01D9A8', '#16C7C0'],
    purple: ['#A98BF5', '#E4DBFF'],
    ocean: ['#63C7E8', '#CFEAF6'],
    sunset: ['#FF9DB0', '#FFE0E6'],
    forest: ['#5FD6B4', '#DDF7EF'],
  },

  // Overlays
  overlay: 'rgba(12,17,22,0.45)',
  overlayLight: 'rgba(12,17,22,0.30)',
};

export const THEME = {
  borderRadius: {
    sm: 10,
    md: 14,
    lg: 18,
    xl: 24,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  typography: {
    kicker: {
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 1.6,
    },
    heading: {
      fontSize: 30,
      fontWeight: '900',
      letterSpacing: -1.1,
    },
    body: {
      fontSize: 14,
      lineHeight: 20,
    },
  },
};
