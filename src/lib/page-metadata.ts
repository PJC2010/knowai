import type { Metadata } from "next";

/** Keep search, Open Graph, and Twitter copy in sync for public destinations. */
export function pageMetadata(title: string, description: string, path: string): Metadata {
  const images = [{ url: "/images/editorial.png", alt: "Green glass ribbons, an editorial illustration for knowai." }];
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", title: `${title} · knowai`, description, url: path, siteName: "knowai", images },
    twitter: { card: "summary_large_image", title: `${title} · knowai`, description, images },
  };
}
