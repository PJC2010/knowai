import type { Metadata } from "next";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "./globals.css";
import "./brief.css";
import { Header, Footer } from "@/components/shell";
import { ConnectionProvider } from "@/components/connection";
import { ScrollReveals } from "@/components/reveal";

const deploymentHost =
  process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (deploymentHost ? `https://${deploymentHost}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "knowai — AI knowledge everyone can understand", template: "%s · knowai" },
  description:
    "Make sense of AI with the latest news, clear model guides, and model comparisons with transparent costs.",
  openGraph: {
    title: "knowai — AI knowledge everyone can understand",
    description:
      "AI news, explained. Explore the models and compare their answers and costs.",
    type: "website",
    images: [
      {
        url: "/images/editorial.png",
        alt: "Green glass ribbons, an editorial illustration for knowai.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "knowai — AI knowledge everyone can understand",
    description:
      "AI news, explained. Explore the models and compare their answers and costs.",
    images: [
      {
        url: "/images/editorial.png",
        alt: "Green glass ribbons, an editorial illustration for knowai.",
      },
    ],
  },
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* Keep feed discovery in the initial head, even on pages with streamed metadata. */}
        <link rel="alternate" type="application/rss+xml" title="knowai — The Brief" href={new URL("/feed.xml", siteUrl).href} />
      </head>
      <body>
        <ConnectionProvider>
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <Header />
          <main id="main">{children}</main>
          <Footer />
          <ScrollReveals />
        </ConnectionProvider>
      </body>
    </html>
  );
}
