import type { Metadata } from "next";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "./globals.css";
import { Header, Footer } from "@/components/shell";
import { ConnectionProvider } from "@/components/connection";

export const metadata: Metadata = {
  title: { default: "knowai — A clearer view of AI", template: "%s · knowai" },
  description:
    "Make sense of AI with the latest news, plain-language model guides, and side-by-side model comparisons with transparent costs.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ConnectionProvider>
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <Header />
          <main id="main">{children}</main>
          <Footer />
        </ConnectionProvider>
      </body>
    </html>
  );
}
