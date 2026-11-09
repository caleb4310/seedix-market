/** Design tokens. CSS variables in globals.css mirror these names and values. */

export const type = {
  sans: '"Instrument Sans", "Avenir Next", "Segoe UI", sans-serif',
  mono: '"IBM Plex Mono", "ui-monospace", monospace',
  scale: {
    micro: { size: "11px", line: "14px", weight: 500, tracking: "0.08em" },
    caption: { size: "12px", line: "16px", weight: 450, tracking: "0" },
    body: { size: "15px", line: "22px", weight: 450, tracking: "0" },
    bodyStrong: { size: "15px", line: "22px", weight: 560, tracking: "0" },
    title: { size: "20px", line: "26px", weight: 560, tracking: "-0.015em" },
    display: { size: "34px", line: "38px", weight: 560, tracking: "-0.03em" },
  },
} as const;

export const space = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80] as const;

export const radius = { sm: "2px", md: "4px", lg: "8px" } as const;

export const motion = {
  fast: "80ms",
  base: "160ms",
  slow: "280ms",
  ease: "cubic-bezier(0.2, 0.8, 0.2, 1)",
} as const;

export const light = {
  bg: "#f3f1ea",
  bgRaised: "#faf8f3",
  ink: "#1c1b16",
  inkSoft: "#5e5a50",
  line: "#e3ded2",
  accent: "#0e6b4f",
  accentInk: "#f3f7f4",
  success: "#1c7a46",
  warn: "#8a5810",
  danger: "#8d2e2a",
  focus: "#0e6b4f",
} as const;

export const dark = {
  bg: "#121410",
  bgRaised: "#1b1e19",
  ink: "#eceae3",
  inkSoft: "#a8a396",
  line: "#2e332c",
  accent: "#9ee0bf",
  accentInk: "#102119",
  success: "#9ee0bf",
  warn: "#e6c98a",
  danger: "#f0b0aa",
  focus: "#9ee0bf",
} as const;

export const fees = {
  startPips: 800_000,
  endPips: 10_000,
  decaySeconds: 10,
  platformPips: 10_000,
  lpPips: 1_000,
  pips: 1_000_000,
} as const;

export function hookPips(elapsedSeconds: number): number {
  const t = Math.max(0, Math.floor(elapsedSeconds));
  if (t >= fees.decaySeconds) return fees.endPips;
  return fees.startPips - ((fees.startPips - fees.endPips) * t) / fees.decaySeconds;
}
