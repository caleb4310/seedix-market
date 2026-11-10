/** Browser path for a stored logo. `/logos/` is also proxied by nginx; `/api/logos/` works on the existing API location. */
export function logoSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("blob:") || url.startsWith("data:") || url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/api/logos/")) return url;
  if (url.startsWith("/logos/")) return `/api${url}`;
  return null;
}

/** Path sent to the attach endpoint. Accepts a site-relative logo URL or one prefixed with the API origin. */
export function logoAttachPath(image: string, apiUrl: string): string | null {
  const direct = logoSrc(image);
  if (image.startsWith("/api/logos/") || image.startsWith("/logos/")) return image;
  if (apiUrl && image.startsWith(apiUrl)) {
    const rest = image.slice(apiUrl.length);
    if (rest.startsWith("/logos/") || rest.startsWith("/api/logos/")) return rest;
  }
  return direct && (direct.startsWith("/api/logos/") || direct.startsWith("/logos/")) ? direct : null;
}
