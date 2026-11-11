/**
 * Sora Design System — Clubhouse-inspired Color Palette
 * Cream/warm white backgrounds, near-black text, yellow accent.
 */

export const COLORS = {
  // Backgrounds
  background: "#F9F6F1",
  surface: "#FFFFFF",
  surfaceRaised: "#F4F1EC",
  raised: "#EDE9E2",
  line: "#E8E3DC",
  lineSoft: "#F0EDE8",

  // Text
  text: "#1A1410",
  textSecondary: "#5C5047",
  muted: "#9C9088",
  mutedDark: "#7A706A",

  // Primary Brand — warm yellow (Clubhouse-style)
  primary: "#F5C842",
  primaryInk: "#1A1410",
  primaryDark: "#D4A820",
  primaryLight: "#FAD96A",

  // Accent Colors
  accent: "#3A85F5",
  accentPurple: "#7C5CBF",
  accentPink: "#E05C7A",

  // Status
  danger: "#D94F4F",
  dangerDark: "#B53030",
  warning: "#E0943A",
  success: "#4CA96A",

  // Gradients
  gradients: {
    primary: ["#1A1410", "#2D2520"],
    warm: ["#F5C842", "#E8A020"],
    ocean: ["#167A91", "#273D79"],
    sunset: ["#B85B69", "#5B294C"],
    forest: ["#2B806F", "#23443F"],
  },

  // Overlays
  overlay: "rgba(26,20,16,0.48)",
  overlayLight: "rgba(26,20,16,0.28)",
};

export const THEME = {
  borderRadius: {
    sm: 10,
    md: 14,
    lg: 18,
    xl: 24,
    pill: 100,
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
      fontWeight: "900",
      letterSpacing: 1.6,
      textTransform: "uppercase",
    },
    heading: {
      fontSize: 30,
      fontWeight: "900",
      letterSpacing: -1.1,
    },
    body: {
      fontSize: 14,
      lineHeight: 20,
    },
  },
};
