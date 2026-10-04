export function siteUrl() {
  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (host ? `https://${host}` : "http://localhost:3000")
  );
}
