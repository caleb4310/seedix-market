import { darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { dark, light, radius, type as typeScale } from "./tokens";

type SeedixTheme = ReturnType<typeof lightTheme>;
type Palette = { [K in keyof typeof light]: string };

function paint(base: SeedixTheme, palette: Palette): SeedixTheme {
  return {
    ...base,
    colors: {
      ...base.colors,
      accentColor: palette.accent,
      accentColorForeground: palette.accentInk,
      actionButtonBorder: palette.line,
      actionButtonBorderMobile: palette.line,
      actionButtonSecondaryBackground: palette.bg,
      closeButton: palette.inkSoft,
      closeButtonBackground: palette.line,
      connectButtonBackground: palette.bgRaised,
      connectButtonBackgroundError: palette.warnBg,
      connectButtonInnerBackground: palette.bg,
      connectButtonText: palette.ink,
      connectButtonTextError: palette.warnInk,
      connectionIndicator: palette.success,
      downloadBottomCardBackground: palette.bg,
      downloadTopCardBackground: palette.bgRaised,
      error: palette.danger,
      generalBorder: palette.line,
      generalBorderDim: palette.line,
      menuItemBackground: palette.bg,
      modalBackground: palette.bgRaised,
      modalBorder: palette.line,
      modalText: palette.ink,
      modalTextDim: palette.inkSoft,
      modalTextSecondary: palette.inkSoft,
      profileAction: palette.bg,
      profileActionHover: palette.line,
      profileForeground: palette.bgRaised,
      selectedOptionBorder: palette.accent,
      standby: palette.warn,
    },
    fonts: { body: typeScale.sans },
    radii: {
      actionButton: radius.md,
      connectButton: radius.md,
      menuButton: radius.md,
      modal: radius.lg,
      modalMobile: radius.lg,
    },
    shadows: {
      ...base.shadows,
      connectButton: palette.shadow,
      dialog: palette.shadow,
      selectedWallet: palette.shadow,
    },
  };
}

export const seedixRainbowLight = paint(lightTheme({ overlayBlur: "none", borderRadius: "small" }), light);
export const seedixRainbowDark = paint(darkTheme({ overlayBlur: "none", borderRadius: "small" }), dark);
