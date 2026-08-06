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
