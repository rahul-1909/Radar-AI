"use client";

interface RadarLogoProps {
  size?: number;
  className?: string;
  color?: string;
  bgColor?: string;
  showBg?: boolean;
}

/**
 * Mathematically precise vector Radar logo
 * Replicates the clean concentric radar scan design with 0 jagged edges or artifacts.
 */
export default function RadarLogo({
  size = 36,
  className = "",
  color = "#ffffff",
  bgColor = "transparent",
  showBg = false,
}: RadarLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      {showBg && (
        <rect width="100" height="100" rx="24" fill={bgColor} />
      )}

      {/* Outer Enclosing Circle */}
      <circle
        cx="50"
        cy="50"
        r="42"
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
      />

      {/* Ring 3 (Outer-mid arc: ~260 degrees from 8 o'clock clockwise to 5 o'clock) */}
      <path
        d="M 20 62 A 33 33 0 1 1 54 82.5"
        stroke={color}
        strokeWidth="3.2"
        strokeLinecap="round"
      />

      {/* Ring 2 (Mid-inner arc: ~240 degrees from 9 o'clock clockwise to 4 o'clock) */}
      <path
        d="M 27 50 A 23 23 0 1 1 61 70"
        stroke={color}
        strokeWidth="3.2"
        strokeLinecap="round"
      />

      {/* Ring 1 (Innermost arc: ~210 degrees from 10 o'clock clockwise to 3 o'clock) */}
      <path
        d="M 37 42 A 14 14 0 1 1 63 56"
        stroke={color}
        strokeWidth="3.2"
        strokeLinecap="round"
      />

      {/* Center Hub Circle */}
      <circle
        cx="50"
        cy="50"
        r="4.5"
        stroke={color}
        strokeWidth="3"
        fill="transparent"
      />

      {/* Radar Sweep Needle (Points northeast at 45°) */}
      <line
        x1="53.5"
        y1="46.5"
        x2="74.5"
        y2="25.5"
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
