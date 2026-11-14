/** Sora's shared blue, white and near-black color system. */
export const COLORS = {
  background: "#F3F7FC",
  surface: "#FFFFFF",
  surfaceRaised: "#EDF3FA",
  surfaceHigh: "#E4ECF6",
  raised: "#EDF3FA",
  line: "#D9E3EF",
  lineSoft: "#EAF0F7",

  text: "#111820",
  textSecondary: "#46596F",
  muted: "#8190A2",
  mutedDark: "#617287",

  primary: "#2F80ED",
  primaryInk: "#FFFFFF",
  primaryDark: "#1D5FBF",
  primaryLight: "#78B1FF",
  primarySoft: "rgba(47,128,237,0.14)",

  accent: "#1D5FC4",
  accentPurple: "#5878B4",
  accentPink: "#4B82D5",
  pink: "#4B82D5",
  purple: "#5878B4",

  danger: "#D94F5C",
  dangerDark: "#B93E4A",
  warning: "#3976C7",
  success: "#2F80ED",

  gradients: {
    primary: ["#1C5FB8", "#2F80ED"],
    blue: ["#246BC7", "#6AA8F8"],
    dark: ["#101820", "#1D2E43"],
    ocean: ["#1C5FB8", "#2F80ED"],
    warm: ["#246BC7", "#6AA8F8"],
    sunset: ["#1C5FB8", "#2F80ED"],
    forest: ["#1D4F91", "#347AD0"],
  },

  overlay: "rgba(9,18,30,0.52)",
  overlayLight: "rgba(9,18,30,0.30)",
};

export const THEME = {
  borderRadius: { sm: 10, md: 14, lg: 18, xl: 24, pill: 100 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  typography: {
    kicker: { fontSize: 10, fontWeight: "900", letterSpacing: 1.6, textTransform: "uppercase" },
    heading: { fontSize: 30, fontWeight: "900", letterSpacing: -1.1 },
    body: { fontSize: 14, lineHeight: 20 },
  },
};
