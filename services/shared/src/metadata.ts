/** Plain-text coin metadata. Invalid fields are dropped, not stored. */

const MAX_DESCRIPTION = 280;
const MAX_URL = 200;
const CONTROL_AND_BIDI =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

export type Socials = {
  description: string | null;
  website: string | null;
  x: string | null;
  telegram: string | null;
};

export function stripControls(value: string): string {
  return value.replace(CONTROL_AND_BIDI, "").trim();
}

export function cleanDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = stripControls(value);
  if (!text || text.length > MAX_DESCRIPTION) return null;
  return text;
}

/** https only. javascript: and data: never parse as https. */
export function httpsUrl(value: unknown, max = MAX_URL): string | null {
  if (typeof value !== "string") return null;
  const text = stripControls(value);
  if (!text || text.length > max) return null;
  if (/^\s*(javascript|data|vbscript):/i.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url.toString();
}

/** A handle or an https URL on x.com / twitter.com, normalised to https://x.com/<handle>. */
export function xUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = stripControls(value);
  if (!text || text.length > MAX_URL) return null;
  let handle = text.startsWith("@") ? text.slice(1) : text;
  if (text.includes("://") || text.startsWith("x.com") || text.startsWith("twitter.com")) {
    const candidate = text.includes("://") ? text : `https://${text}`;
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      return null;
    }
    if (url.protocol !== "https:") return null;
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "x.com" && host !== "twitter.com") return null;
    handle = url.pathname.split("/").filter(Boolean)[0] ?? "";
  }
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;
  return `https://x.com/${handle}`;
}

/** https only, same cap as a website. A t.me link must already be https. */
export function telegramUrl(value: unknown): string | null {
  const url = httpsUrl(value);
  if (!url) return null;
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (host !== "t.me" && host !== "telegram.me" && host !== "telegram.org") return null;
  return url;
}

export function cleanSocials(input: {
  description?: unknown;
  website?: unknown;
  x?: unknown;
  telegram?: unknown;
}): Socials {
  return {
    description: cleanDescription(input.description),
    website: httpsUrl(input.website),
    x: xUrl(input.x),
    telegram: telegramUrl(input.telegram),
  };
}
