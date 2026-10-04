import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of use",
  description:
    "Practical guidance for using knowai’s news, model information, and OpenRouter comparison playground.",
};

export default function TermsPage() {
  return (
    <div className="page-container legal-page">
      <header className="page-heading">
        <Link href="/" className="small-link">
          Back to the newsroom
        </Link>
        <span className="eyebrow">Using knowai</span>
        <h1>A few things to know.</h1>
        <p>Understand the information, the model responses, and the costs.</p>
      </header>
      <div className="legal-content">
        <section className="legal-section">
          <h2>The three-depth briefing</h2>
          <p>
            Stories in the three-depth format are AI-assisted editorial
            summaries approved by a knowai editor. Each version is an
            interpretation of the linked reporting, not a substitute for the
            original source. Source publication dates and knowai publication
            dates may differ. A short summary necessarily leaves out details;
            use the whole picture and original source when the distinction
            matters.
          </p>
        </section>
        <section className="legal-section">
          <h2>Information for learning</h2>
          <p>
            knowai brings together public AI news, introductory guides, model
            information, and a comparison playground. News excerpts link to
            their original publishers. Model listings, prices, and availability
            can change, and cached or saved information may be out of date.
            Check the original source before relying on it.
          </p>
        </section>
        <section className="legal-section">
          <h2>Model responses need your judgment</h2>
          <p>
            Models can produce incorrect, incomplete, or misleading answers.
            Compare responses thoughtfully and verify important claims with
            reliable sources. The playground is for exploration; a response is
            not professional medical, legal, or financial advice, and a single
            comparison is not a performance benchmark.
          </p>
        </section>
        <section className="legal-section">
          <h2>Your account and usage costs</h2>
          <p>
            You connect your own OpenRouter account or API key and pay
            OpenRouter for model usage. API keys themselves are free; usage
            credits are purchased on OpenRouter. knowai does not sell keys,
            collect payment, or set provider prices. Review{" "}
            <a
              href="https://openrouter.ai/terms"
              target="_blank"
              rel="noreferrer"
            >
              OpenRouter’s terms
            </a>{" "}
            and the terms that apply to your selected providers.
          </p>
          <p>
            The playground labels estimated and reported costs. Estimates may
            differ from actual charges because of token counts, reasoning,
            caching, routing, or price changes. Credit purchase fees are
            separate. Stopped, failed, or timed out requests may still incur
            charges that do not appear in the comparison. Your OpenRouter
            account is the place to verify billing.
          </p>
        </section>
        <section className="legal-section">
          <h2>Keep control of your key</h2>
          <p>
            Use only an account or key you are authorized to use, set a spending
            limit you are comfortable with, and keep your key private. Submit
            content you have permission to share and follow applicable laws and
            provider policies. You can disconnect in knowai and revoke a key in
            OpenRouter’s settings.
          </p>
        </section>
        <section className="legal-section">
          <h2>External services and availability</h2>
          <p>
            News publishers, OpenRouter, and model providers operate their own
            services. Their content, policies, pricing, and availability may
            change. knowai cannot guarantee uninterrupted access or the accuracy
            of external content. Prompts are shared with OpenRouter and the
            selected providers, as described in the{" "}
            <Link href="/privacy">privacy notice</Link>.
          </p>
        </section>
        <p>
          Start with the <Link href="/learn">AI 101 guides</Link> or open the{" "}
          <Link href="/playground">playground</Link>.
        </p>
      </div>
    </div>
  );
}
