import Link from "next/link";
import {
  BookOpen,
  MessageCircle,
  Coins,
  Layers,
  BrainCircuit,
  ShieldCheck,
  Plus,
  FlaskConical,
  ExternalLink,
} from "lucide-react";
export const metadata = { title: "AI 101 — Plain-English Guides" };
const lessons = [
  {
    id: "llms",
    icon: BrainCircuit,
    number: "01",
    tag: "THE BASICS",
    title: "What actually is an LLM?",
    lead: "Think of it as a very well-read pattern finder.",
    text: "A large language model (LLM) learns patterns from enormous amounts of text. When you give it a prompt, it generates an answer one piece at a time, based on those patterns and the conversation you supply.",
    takeaway:
      "It can write, explain, and reason through tasks. A confident answer can still be wrong: fluency is not the same as truth.",
  },
  {
    id: "prompts",
    icon: MessageCircle,
    number: "02",
    tag: "BETTER QUESTIONS",
    title: "A good prompt is a good brief.",
    lead: "Tell the model what you need, who it’s for, and what “good” looks like.",
    text: "Instead of “explain climate change,” try “explain climate change to a 12-year-old in three short paragraphs. Include an everyday analogy and distinguish what is well established from what is uncertain.” Add context, specify a format, and refine the answer with follow-up instructions.",
    takeaway:
      "Clear instructions help. They do not guarantee accuracy. Check important claims against trusted sources.",
  },
  {
    id: "tokens",
    icon: Coins,
    number: "03",
    tag: "THE PRICE TAG",
    title: "Tokens: small pieces, small prices.",
    lead: "Models count pieces of words, not just whole words.",
    text: "A token can be a word, part of a word, or punctuation. For English, one token is roughly four characters, but this varies by language and model. Input tokens are what you send. Output tokens are what the model generates. Providers usually price them separately.",
    takeaway:
      "At $1 per million input tokens and $3 per million output tokens, a request with 500 input tokens and 200 output tokens costs about $0.0011. This is an illustrative example, not a live model price.",
  },
  {
    id: "context",
    icon: Layers,
    number: "04",
    tag: "THE BIGGER PICTURE",
    title: "A context window is working space.",
    lead: "It’s how much information a model can consider at once.",
    text: "The context window is a token budget for the material a model works with: instructions, messages, documents, and its response. A larger window can fit more information, but it does not guarantee the model will notice every detail or give a better answer.",
    takeaway:
      "Start with the information that matters. Longer prompts can cost more and take longer to process.",
  },
  {
    id: "choose",
    icon: FlaskConical,
    number: "05",
    tag: "FIND YOUR FIT",
    title: "There’s no single “best” model.",
    lead: "The right model depends on the job.",
    text: "A small, inexpensive model may be enough for rewriting an email. A harder reasoning task may benefit from a more capable model. Compare the same prompt across models and look at correctness, clarity, style, response time, and cost. One example is useful, but it is not a benchmark.",
    takeaway:
      "Test a few representative tasks. A model that sounds better may not be more accurate.",
  },
  {
    id: "privacy",
    icon: ShieldCheck,
    number: "06",
    tag: "STAY IN CONTROL",
    title: "Your key. Your credits. Your choices.",
    lead: "An API key is a password that lets an app use a service.",
    text: "OpenRouter connects you to different model providers through one account. You create a key and buy usage credits on OpenRouter. In knowai, your key stays in page memory and requests go directly from your browser to OpenRouter. Refreshing or disconnecting clears the key from knowai.",
    takeaway:
      "Set a spending limit on your OpenRouter key. Prompts are shared with OpenRouter and the selected providers, so review their data policies and avoid sharing sensitive information.",
  },
];
export default function LearnPage() {
  return (
    <div className="page-container learn-page">
      <div className="page-heading">
        <span className="eyebrow">
          AI 101 · NO TECHNICAL BACKGROUND REQUIRED
        </span>
        <h1>
          A little knowledge.
          <br />
          <span className="text-green">A lot more possibility.</span>
        </h1>
        <p>Six simple ideas to help you feel at home with AI.</p>
      </div>
      <div className="learn-layout">
        <aside className="lesson-nav">
          <span className="eyebrow">YOUR FIELD GUIDE</span>
          {lessons.map((l) => (
            <a href={`#${l.id}`} key={l.id}>
              <span>{l.number}</span>
              {l.title}
            </a>
          ))}
          <div className="learn-aside-note">
            <BookOpen size={24} />
            <p>
              Start anywhere.
              <br />
              Stay curious.
            </p>
          </div>
        </aside>
        <div className="lessons">
          {lessons.map((l) => (
            <article id={l.id} key={l.id} className="lesson">
              <div className="lesson-top">
                <span className="lesson-icon">
                  <l.icon size={24} />
                </span>
                <span className="eyebrow">
                  {l.number} / {l.tag}
                </span>
              </div>
              <h2>{l.title}</h2>
              <p className="lesson-lead">{l.lead}</p>
              <p>{l.text}</p>
              <div className="takeaway">
                <span>THE THING TO REMEMBER</span>
                <p>{l.takeaway}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
      <section className="playground-banner">
        <div className="banner-icon">
          <FlaskConical size={30} />
        </div>
        <div>
          <span className="eyebrow">LEARN BY DOING</span>
          <h2>Ready for a little experiment?</h2>
          <p>Try the same question with two models. See what you notice.</p>
        </div>
        <Link href="/playground" className="button lime">
          Open the playground <Plus size={17} />
        </Link>
      </section>
      <p className="source-note">
        Further reading:{" "}
        <a
          href="https://openrouter.ai/docs/quickstart"
          target="_blank"
          rel="noreferrer"
        >
          OpenRouter’s getting started guide <ExternalLink size={12} />
        </a>{" "}
        ·{" "}
        <a
          href="https://openrouter.ai/docs/guides/overview/models"
          target="_blank"
          rel="noreferrer"
        >
          Models and pricing
        </a>
      </p>
    </div>
  );
}
