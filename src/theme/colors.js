/**
 * Sora Design System - Modern Color Palette
 * Tüm uygulama boyunca tutarlı renk kullanımı için merkezi tema
 */

export const COLORS = {
  // Backgrounds
  background: '#090A12',
  surface: '#10111C',
  surfaceRaised: '#1A1C29',
  raised: '#242735',
  line: '#303344',

  // Text
  text: '#F7F7FB',
  textSecondary: '#C5C7D3',
  muted: '#9699AC',
  mutedDark: '#73778B',

  // Primary Brand
  primary: '#7AF6A5',
  primaryInk: '#172117',
  primaryDark: '#6DAF48',
  primaryLight: '#B5FF78',

  // Accent Colors
  accent: '#3B82F6',
  accentPurple: '#8B5CF6',
  accentPink: '#EC4899',

  // Status
  danger: '#FF7BA7',
  dangerDark: '#FF9FBA',
  warning: '#F4D168',
  success: '#7AF6A5',

  // Gradients
  gradients: {
    primary: ['#7AF6A5', '#8CE958'],
    purple: ['#6647B9', '#262044'],
    ocean: ['#167A91', '#273D79'],
    sunset: ['#B85B69', '#5B294C'],
    forest: ['#2B806F', '#23443F'],
  },

  // Overlays
  overlay: 'rgba(4,5,9,0.72)',
  overlayLight: 'rgba(5,6,11,0.64)',
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
