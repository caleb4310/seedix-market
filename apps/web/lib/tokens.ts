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

export const radius = { sm: "2px", md: "4px", lg: "8px", pill: "999px" } as const;

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
  shadow: "0 1px 0 rgba(28, 27, 22, 0.04)",
  warnBg: "#fff1e4",
  warnInk: "#6a3114",
  warnLine: "#e2b48a",
  modeKeep: "#1c7a46",
  modeKick: "#3d5a8a",
  modeBurn: "#9a5b2f",
  toastBg: "#1c1b16",
  toastInk: "#f3f1ea",
} as const;

export const dark = {
  bg: "#121410",
  bgRaised: "#1b1e19",
  ink: "#eceae3",
  inkSoft: "#c2bdb0",
  line: "#2e332c",
  accent: "#9ee0bf",
  accentInk: "#102119",
  success: "#9ee0bf",
  warn: "#e6c98a",
  danger: "#f0b0aa",
  focus: "#9ee0bf",
  shadow: "0 1px 0 rgba(0, 0, 0, 0.4)",
  warnBg: "#3a2118",
  warnInk: "#f6e2c8",
  warnLine: "#8a4b2a",
  modeKeep: "#9ee0bf",
  modeKick: "#b7c7ea",
  modeBurn: "#e2b08a",
  toastBg: "#eceae3",
  toastInk: "#121410",
} as const;

function vars(theme: { [K in keyof typeof light]: string }): string {
  return [
    `--bg: ${theme.bg}`,
    `--bg-raised: ${theme.bgRaised}`,
    `--ink: ${theme.ink}`,
    `--ink-soft: ${theme.inkSoft}`,
    `--line: ${theme.line}`,
    `--accent: ${theme.accent}`,
    `--accent-ink: ${theme.accentInk}`,
    `--success: ${theme.success}`,
    `--warn: ${theme.warn}`,
    `--danger: ${theme.danger}`,
    `--focus: ${theme.focus}`,
    `--shadow: ${theme.shadow}`,
    `--warn-bg: ${theme.warnBg}`,
    `--warn-ink: ${theme.warnInk}`,
    `--warn-line: ${theme.warnLine}`,
    `--mode-keep: ${theme.modeKeep}`,
    `--mode-kick: ${theme.modeKick}`,
    `--mode-burn: ${theme.modeBurn}`,
    `--toast-bg: ${theme.toastBg}`,
    `--toast-ink: ${theme.toastInk}`,
  ].join(";");
}

/** Runtime CSS variables. Component styles only reference these names. */
export const tokenCss = `:root{${vars(light)};--sans:${type.sans};--mono:${type.mono};--fs-micro:${type.scale.micro.size};--lh-micro:${type.scale.micro.line};--fs-caption:${type.scale.caption.size};--lh-caption:${type.scale.caption.line};--fs-body:${type.scale.body.size};--lh-body:${type.scale.body.line};--fs-title:${type.scale.title.size};--lh-title:${type.scale.title.line};--fs-display:${type.scale.display.size};--lh-display:${type.scale.display.line};--space-1:${space[1]}px;--space-2:${space[2]}px;--space-3:${space[3]}px;--space-4:${space[4]}px;--space-5:${space[5]}px;--space-6:${space[6]}px;--space-8:${space[7]}px;--space-10:${space[8]}px;--space-12:${space[9]}px;--space-16:${space[10]}px;--r-sm:${radius.sm};--r-md:${radius.md};--r-lg:${radius.lg};--r-pill:${radius.pill};--hair:1px;--focus-w:2px;--tap:44px;--page:1120px;--panel:280px;--toast-w:420px;--ls-tight:-0.03em;--ls-wide:0.08em;--dur-fast:${motion.fast};--dur:${motion.base};--dur-slow:${motion.slow};--ease:${motion.ease};color-scheme:light} :root[data-theme="dark"]{${vars(dark)};color-scheme:dark}`;

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
