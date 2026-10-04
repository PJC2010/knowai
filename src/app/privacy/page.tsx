import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How knowai handles your OpenRouter key, prompts, browser storage, and public news feeds.",
};

export default function PrivacyPage() {
  return (
    <div className="page-container legal-page">
      <header className="page-heading">
        <Link href="/" className="small-link">
          Back to the newsroom
        </Link>
        <span className="eyebrow">Your information</span>
        <h1>Privacy, explained.</h1>
        <p>
          What stays in your browser, what gets shared, and what you control.
        </p>
      </header>
      <div className="legal-content">
        <section className="legal-section">
          <h2>Your OpenRouter key</h2>
          <p>
            knowai keeps your connected API key in page memory. It does not save
            the key in cookies or browser storage, or send it to knowai’s
            server. Refreshing the page or disconnecting clears the connected
            key from the app. Disconnecting does not revoke the key on
            OpenRouter; you can manage or revoke it in your{" "}
            <a
              href="https://openrouter.ai/settings/keys"
              target="_blank"
              rel="noreferrer"
            >
              OpenRouter key settings
            </a>
            .
          </p>
        </section>
        <section className="legal-section">
          <h2>Connecting your account</h2>
          <p>
            Account connection temporarily saves a verification secret, a random
            state value, and a timestamp in your browser’s session storage.
            These let knowai verify the return from OpenRouter. The app removes
            this record when it handles the return, and rejects connections more
            than ten minutes old. If you leave connection unfinished, the record
            can remain until the tab’s browser session ends.
          </p>
        </section>
        <section className="legal-section">
          <h2>Prompts and model responses</h2>
          <p>
            Playground requests travel directly from your browser to OpenRouter.
            OpenRouter receives your prompt, chosen model, output limit, API
            key, and knowai’s site address. It routes your prompt and request
            settings to model providers. OpenRouter and the providers process
            the information they receive under their own policies.
          </p>
          <p>
            knowai keeps the current prompt and comparison results in page
            memory, without a saved conversation history. Review{" "}
            <a
              href="https://openrouter.ai/privacy"
              target="_blank"
              rel="noreferrer"
            >
              OpenRouter’s privacy policy
            </a>{" "}
            and your selected provider’s data policies before sending personal
            or confidential information.
          </p>
        </section>
        <section className="legal-section">
          <h2>Browsing knowai</h2>
          <p>
            The app does not include analytics trackers, advertising trackers,
            or tracking cookies. Its server fetches and caches public news feeds
            and model listings; those caches do not contain your playground
            prompts or API key.
          </p>
          <p>
            The hosting service may keep normal request logs, including IP
            addresses, requested URLs, timestamps, and browser information.
            Opening an article or another external link takes you to a service
            with its own privacy practices.
          </p>
        </section>
        <section className="legal-section">
          <h2>Payments stay with OpenRouter</h2>
          <p>
            Credit purchases and payment details are handled on OpenRouter.
            knowai does not collect card details. You can manage your account,
            credits, key limits, and provider preferences there.
          </p>
        </section>
        <p>
          Read the <Link href="/terms">terms of use</Link> or return to the{" "}
          <Link href="/playground">playground</Link>.
        </p>
      </div>
    </div>
  );
}
