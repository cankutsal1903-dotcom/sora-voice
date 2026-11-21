/** Sora's shared blue, white and near-black color system. */
export const COLORS = {
  background: "#F3F7FC",
  surface: "#FFFFFF",
  surfaceRaised: "#EDF3FA",
  surfaceHigh: "#E4ECF6",
  surfaceSoft: "#EDF3FA",
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
  dangerSoft: "rgba(217,79,92,0.12)",
  warning: "#D97706",
  warningSoft: "rgba(217,119,6,0.14)",
  success: "#16A34A",
  successSoft: "rgba(22,163,74,0.12)",
  gold: "#EAB308",
  goldSoft: "rgba(234,179,8,0.15)",
  violet: "#7C3AED",
  violetSoft: "rgba(124,58,237,0.12)",

  gradients: {
    primary: ["#1D5FBF", "#2F80ED"],
    blue: ["#246BC7", "#5AA0F8"],
    dark: ["#0C1628", "#1A2E4D"],
    ocean: ["#0284C7", "#2F80ED"],
    warm: ["#F59E0B", "#EA580C"],
    sunset: ["#EC4899", "#8B5CF6"],
    forest: ["#10B981", "#059669"],
    gold: ["#FBBF24", "#D97706"],
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
