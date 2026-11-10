/** Design tokens. CSS variables in globals.css mirror these names and values. */

export const type = {
  sans: '"Instrument Sans", "Avenir Next", "Segoe UI", sans-serif',
  mono: '"IBM Plex Mono", "ui-monospace", monospace',
  scale: {
    micro: { size: "11px", line: "14px", weight: 500, tracking: "0.08em" },
    caption: { size: "12px", line: "16px", weight: 450, tracking: "0" },
    body: { size: "15px", line: "22px", weight: 450, tracking: "0" },
    bodyStrong: { size: "15px", line: "22px", weight: 560, tracking: "0" },
    title: { size: "20px", line: "26px", weight: 650, tracking: "-0.02em" },
    display: { size: "40px", line: "44px", weight: 700, tracking: "-0.035em" },
    hero: { size: "64px", line: "64px", weight: 700, tracking: "-0.045em" },
  },
} as const;

export const space = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80] as const;

export const radius = { sm: "8px", md: "12px", lg: "16px", card: "18px", pill: "999px" } as const;

export const motion = {
  fast: "80ms",
  base: "160ms",
  slow: "280ms",
  ease: "cubic-bezier(0.2, 0.8, 0.2, 1)",
} as const;

export const light = {
  bg: "#f3f1ec",
  bgRaised: "#ffffff",
  ink: "#161513",
  inkSoft: "#6d685e",
  line: "#e4e0d6",
  accent: "#d9ff3f",
  accentInk: "#161513",
  success: "#1c7a46",
  warn: "#8a5810",
  danger: "#8d2e2a",
  focus: "#d9ff3f",
  shadow: "0 1px 2px rgba(22, 21, 19, 0.06)",
  shadowLift: "0 12px 28px rgba(22, 21, 19, 0.1)",
  warnBg: "#fff1e4",
  warnInk: "#6a3114",
  warnLine: "#e2b48a",
  modeKeep: "#1c7a46",
  modeKick: "#1f7a45",
  modeBurn: "#c4552a",
  badgeKick: "#1f7a45",
  badgeKickInk: "#f4fff6",
  badgeBurn: "#c4552a",
  badgeBurnInk: "#fff7f2",
  toastBg: "#161513",
  toastInk: "#f3f1ec",
  pillOn: "#e4e0d6",
  pillOnInk: "#161513",
} as const;

export const dark = {
  bg: "#141311",
  bgRaised: "#1e1c19",
  ink: "#f3f1ec",
  inkSoft: "#b7b2a6",
  line: "#34312b",
  accent: "#d9ff3f",
  accentInk: "#161513",
  success: "#b6f27c",
  warn: "#e6c98a",
  danger: "#ffb4a8",
  focus: "#d9ff3f",
  shadow: "0 1px 2px rgba(0, 0, 0, 0.45)",
  shadowLift: "0 12px 28px rgba(0, 0, 0, 0.45)",
  warnBg: "#3a2118",
  warnInk: "#f6e2c8",
  warnLine: "#8a4b2a",
  modeKeep: "#b6f27c",
  modeKick: "#8ee0a8",
  modeBurn: "#ffb08a",
  badgeKick: "#1f7a45",
  badgeKickInk: "#f4fff6",
  badgeBurn: "#c4552a",
  badgeBurnInk: "#fff7f2",
  toastBg: "#f3f1ec",
  toastInk: "#161513",
  pillOn: "#3a362f",
  pillOnInk: "#f3f1ec",
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
    `--shadow-lift: ${theme.shadowLift}`,
    `--warn-bg: ${theme.warnBg}`,
    `--warn-ink: ${theme.warnInk}`,
    `--warn-line: ${theme.warnLine}`,
    `--mode-keep: ${theme.modeKeep}`,
    `--mode-kick: ${theme.modeKick}`,
    `--mode-burn: ${theme.modeBurn}`,
    `--badge-kick: ${theme.badgeKick}`,
    `--badge-kick-ink: ${theme.badgeKickInk}`,
    `--badge-burn: ${theme.badgeBurn}`,
    `--badge-burn-ink: ${theme.badgeBurnInk}`,
    `--toast-bg: ${theme.toastBg}`,
    `--toast-ink: ${theme.toastInk}`,
    `--pill-on: ${theme.pillOn}`,
    `--pill-on-ink: ${theme.pillOnInk}`,
  ].join(";");
}

/** Runtime CSS variables. Component styles only reference these names. */
export const tokenCss = `:root{${vars(light)};--sans:${type.sans};--mono:${type.mono};--fs-micro:${type.scale.micro.size};--lh-micro:${type.scale.micro.line};--fs-caption:${type.scale.caption.size};--lh-caption:${type.scale.caption.line};--fs-body:${type.scale.body.size};--lh-body:${type.scale.body.line};--fs-title:${type.scale.title.size};--lh-title:${type.scale.title.line};--fs-display:${type.scale.display.size};--lh-display:${type.scale.display.line};--fs-hero:${type.scale.hero.size};--lh-hero:${type.scale.hero.line};--space-1:${space[1]}px;--space-2:${space[2]}px;--space-3:${space[3]}px;--space-4:${space[4]}px;--space-5:${space[5]}px;--space-6:${space[6]}px;--space-8:${space[7]}px;--space-10:${space[8]}px;--space-12:${space[9]}px;--space-16:${space[10]}px;--r-sm:${radius.sm};--r-md:${radius.md};--r-lg:${radius.lg};--r-card:${radius.card};--r-pill:${radius.pill};--hair:1px;--focus-w:2px;--tap:44px;--page:1240px;--panel:320px;--toast-w:380px;--ls-tight:-0.03em;--ls-wide:0.08em;--dur-fast:${motion.fast};--dur:${motion.base};--dur-slow:${motion.slow};--ease:${motion.ease};color-scheme:light} :root[data-theme="dark"]{${vars(dark)};color-scheme:dark}`;

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
