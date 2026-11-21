import { memo } from "react";
import Svg, { Defs, Ellipse, LinearGradient, Path, Rect, Stop } from "react-native-svg";

/**
 * Sora logo isareti (mikrofon + yorunge). Vektor oldugu icin her boyutta keskin
 * kalir ve aciktan koyu zemine kadar tek renk seti ile calisir.
 */
function SoraMarkBase({ size = 120, accessibilityLabel = "Sora sesli sohbet logosu" }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <Defs>
        <LinearGradient id="soraMarkGradient" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#7FD4FF" />
          <Stop offset="0.5" stopColor="#2F80ED" />
          <Stop offset="1" stopColor="#1D5FBF" />
        </LinearGradient>
      </Defs>

      <Ellipse
        cx="60"
        cy="58"
        rx="52"
        ry="18"
        transform="rotate(-18 60 58)"
        fill="none"
        stroke="url(#soraMarkGradient)"
        strokeWidth="4"
        strokeOpacity="0.9"
      />

      <Rect
        x="44"
        y="20"
        width="32"
        height="50"
        rx="16"
        fill="none"
        stroke="url(#soraMarkGradient)"
        strokeWidth="6"
      />

      <Path
        d="M52 40V52M60 34V58M68 40V52"
        stroke="url(#soraMarkGradient)"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <Path
        d="M32 56Q32 86 60 86Q88 86 88 56"
        fill="none"
        stroke="url(#soraMarkGradient)"
        strokeWidth="6"
        strokeLinecap="round"
      />

      <Path
        d="M60 86V95M46 98H74"
        fill="none"
        stroke="url(#soraMarkGradient)"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export const SoraMark = memo(SoraMarkBase);

export default SoraMark;
