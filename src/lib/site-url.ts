export function siteUrl() {
  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  const configured = (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (host ? `https://${host}` : "http://localhost:3000")
  ).trim();
  const url = new URL(configured);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Configure the public site URL as an HTTP or HTTPS origin.",
    );
  // An origin has no trailing slash, path, query, or fragment. In particular,
  // a copied Vercel URL ending in '/' must not produce '//editor/callback'.
  return url.origin;
}
