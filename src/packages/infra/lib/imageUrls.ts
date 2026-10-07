// src/lib/imageUrls.ts
/**
 * Normalize a local public-asset URL to match this repo's committed files.
 *
 * Vercel (Linux) serves static files case-sensitively, while local Windows dev is
 * case-insensitive — so a case/spelling mismatch between a stored `/images/...`
 * URL and the actual file 404s only after deploy. Local assets here are committed
 * lowercase, so fold `/images/` paths to lowercase. Non-local URLs (Supabase
 * storage, external) are returned unchanged.
 */
export function normalizeLocalAssetUrl(url: string | null | undefined): string {
  if (!url) return url ?? '';
  return url.startsWith('/images/') ? url.toLowerCase() : url;
}

/**
 * Resolve a race's icon URL from its NAME, so the stored icon_url never gets out
 * of sync with the race's filename (the centaur renamed to "Centaur" issue).
 *
 * For standard local races the file is always public/images/races/<lowercase,
 * non-alphanumerics-stripped name>.png, so we derive it whenever the stored URL
 * is a local /images/ path (or missing). Non-local URLs (Supabase storage,
 * external) are kept as-is.
 */
export function raceIconFromName(raceName: string | null | undefined, storedUrl: string | null | undefined): string {
  const normalized = (raceName || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (normalized && (!storedUrl || storedUrl.startsWith('/images/'))) {
    return `/images/races/${normalized}.png`;
  }
  return normalizeLocalAssetUrl(storedUrl) || '';
}
