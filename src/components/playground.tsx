"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Markdown from "react-markdown";
import {
  Plus,
  X,
  Sparkles,
  Play,
  Copy,
  Check,
  LoaderCircle,
  Square,
  KeyRound,
  Info,
  MessageSquare,
  Wallet,
  ChevronDown,
} from "lucide-react";
import type { ModelsData, ComparisonResult } from "@/lib/types";
import { complete, estimateCost } from "@/lib/openrouter";
import { formatPrice, dateLabel } from "@/lib/format";
import { ModelMark, providerName } from "./model-mark";
import { useConnection } from "./connection";

const prompts = [
  {
    label: "Explain something",
    value:
      "Explain how a large language model works to a curious 12-year-old. Use one everyday analogy and keep it under 150 words.",
  },
  {
    label: "Get creative",
    value:
      "Write a 100-word opening to a story where a houseplant discovers it can hear people’s thoughts. Make it warm and a little funny.",
  },
  {
    label: "Solve a problem",
    value:
      "I have 3 hours every week to learn a new language. Create a realistic weekly plan for a complete beginner and explain why each activity helps.",
  },
  {
    label: "Compare ideas",
    value:
      "Compare solar and wind energy for a small town. Explain the main tradeoffs in plain English, and name the local information needed before choosing.",
  },
];
export function Playground({ data }: { data: ModelsData }) {
  const params = useSearchParams();
  const { apiKey, connected, openConnect } = useConnection();
  const [ids, setIds] = useState<string[]>(() => {
    const chosen = [...new Set((params.get("models") || "").split(","))]
      .filter((id) => data.models.some((m) => m.id === id))
      .slice(0, 3);
    return chosen.length
      ? chosen
      : [
          ...new Set(
            ["openai/gpt-4o-mini", "google/gemini-2.5-flash"]
              .filter((id) => data.models.some((m) => m.id === id))
              .concat(data.models.slice(0, 2).map((m) => m.id)),
          ),
        ].slice(0, 2);
  });
  const [prompt, setPrompt] = useState("");
  const [maxTokens, setMaxTokens] = useState(1024);
  const [results, setResults] = useState<ComparisonResult[]>([]);
  const [runPrompt, setRunPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");
  const controller = useRef<AbortController | null>(null);
  const chosen = ids
    .map((id) => data.models.find((m) => m.id === id))
    .filter((m) => !!m);
  const sorted = [...data.models].sort((a, b) => a.name.localeCompare(b.name));
  const estimate = chosen.reduce(
    (sum, m) =>
      sum +
      estimateCost(m, prompt, Math.min(maxTokens, m.maxOutput || maxTokens)),
    0,
  );
  const knownResults = results.filter((r) => r.cost !== undefined);
  const total = knownResults.reduce((sum, r) => sum + (r.cost || 0), 0);
  useEffect(() => () => controller.current?.abort(), []);

  async function run() {
    if (!connected) {
      openConnect();
      return;
    }
    if (!prompt.trim() || !chosen.length || running) return;
    setNotice("");
    setRunning(true);
    setRunPrompt(prompt.trim());
    const abort = new AbortController();
    controller.current = abort;
    setResults(
      chosen.map((m) => ({
        modelId: m.id,
        modelName: m.name,
        status: "waiting",
      })),
    );
    await Promise.allSettled(
      chosen.map(async (model) => {
        let result: ComparisonResult;
        try {
          result = await complete(
            apiKey,
            model,
            prompt.trim(),
            maxTokens,
            AbortSignal.any([abort.signal, AbortSignal.timeout(120000)]),
          );
        } catch (e) {
          const aborted = abort.signal.aborted;
          result = {
            modelId: model.id,
            modelName: model.name,
            status: "error",
            error: aborted
              ? "Request stopped. The provider may still charge for work already completed."
              : e instanceof Error && e.name === "TimeoutError"
                ? "The provider took too long. You can try again; the original request may still incur a charge."
                : e instanceof Error && e.name !== "TypeError"
                  ? e.message
                  : "Could not reach the model. Check your connection and try again.",
          };
        }
        setResults((prev) =>
          prev.map((r) => (r.modelId === model.id ? result : r)),
        );
      }),
    );
    setRunning(false);
    controller.current = null;
  }
  async function copy(result: ComparisonResult) {
    try {
      await navigator.clipboard.writeText(result.text || "");
      setCopied(result.modelId);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setNotice(
        "Copy is unavailable in this browser. You can select the response text to copy it.",
      );
    }
  }
  return (
    <div className="page-container playground-page">
      <div className="page-heading playground-heading">
        <div>
          <span className="eyebrow">THE PLAYGROUND</span>
          <h1>
            One prompt. <span className="text-green">A fresh perspective.</span>
          </h1>
          <p>
            Put up to three models side by side. See the difference for
            yourself.
          </p>
        </div>
        <span className="playground-status">
          <span className={connected ? "status-dot connected" : "status-dot"} />
          {connected ? "OpenRouter connected" : "Your curiosity. Your API key."}
        </span>
      </div>
      {!connected && (
        <div className="connection-banner">
          <div className="connection-banner-icon">
            <KeyRound size={21} />
          </div>
          <div>
            <strong>Bring your key. We’ll bring the possibilities.</strong>
            <p>
              Connect OpenRouter to try real models. You pay OpenRouter directly
              for usage.
            </p>
          </div>
          <button className="button secondary" onClick={openConnect}>
            Connect OpenRouter
          </button>
        </div>
      )}
      {data.fallback && (
        <p className="notice">
          Using saved model prices from {dateLabel(data.fetchedAt)}. Check
          current rates on OpenRouter before running.
        </p>
      )}
      <section className="prompt-panel">
        <div className="panel-heading">
          <h2>
            <span className="step-number">01</span> Pick your models
          </h2>
          <Link href="/models" className="small-link">
            Browse the model library
          </Link>
        </div>
        <div
          className="model-select-grid"
          style={{ "--model-count": ids.length } as React.CSSProperties}
        >
          {ids.map((id, index) => {
            const model = data.models.find((m) => m.id === id)!;
            return (
              <div className="model-select-card" key={index}>
                <ModelMark provider={model.provider} small />
                <div className="model-select-inner">
                  <label htmlFor={`model-${index}`}>
                    Model {String.fromCharCode(65 + index)}
                  </label>
                  <div className="model-select-wrap">
                    <select
                      id={`model-${index}`}
                      aria-label={`Model ${String.fromCharCode(65 + index)}`}
                      value={id}
                      disabled={running}
                      onChange={(e) =>
                        setIds(
                          ids.map((item, i) =>
                            i === index ? e.target.value : item,
                          ),
                        )
                      }
                    >
                      {sorted.map((m) => (
                        <option
                          disabled={ids.includes(m.id) && m.id !== id}
                          value={m.id}
                          key={m.id}
                        >
                          {m.name} · {providerName(m.provider)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} />
                  </div>
                  <span>
                    {formatPrice(model.inputPrice)} in ·{" "}
                    {formatPrice(model.outputPrice)} out / 1M tokens
                  </span>
                </div>
                {ids.length > 1 && (
                  <button
                    className="icon-button remove-model"
                    disabled={running}
                    aria-label={`Remove model ${String.fromCharCode(65 + index)}`}
                    onClick={() => setIds(ids.filter((_, i) => i !== index))}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            );
          })}
          {ids.length < 3 && (
            <button
              className="add-model"
              disabled={running}
              onClick={() => {
                const next =
                  data.models.find(
                    (m) => !ids.includes(m.id) && m.provider === "anthropic",
                  ) || data.models.find((m) => !ids.includes(m.id));
                if (next) setIds([...ids, next.id]);
              }}
            >
              <Plus size={20} />
              <span>Add a model</span>
            </button>
          )}
        </div>
        <div className="panel-heading prompt-title">
          <h2>
            <span className="step-number">02</span> Give them something to think
            about
          </h2>
          <span className="subtle">Same prompt, every model.</span>
        </div>
        <label className="sr-only" htmlFor="prompt">
          Your prompt
        </label>
        <textarea
          id="prompt"
          placeholder="What are you curious about? Ask a question, try an idea, or give the models a challenge…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={running}
          maxLength={16000}
        />
        <div className="prompt-suggestions">
          <span>
            <Sparkles size={14} /> Need a spark?
          </span>
          {prompts.map((p) => (
            <button
              disabled={running}
              key={p.label}
              onClick={() => setPrompt(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="prompt-actions">
          <div className="output-control">
            <label htmlFor="max-tokens">
              Output limit <Info size={13} />
            </label>
            <select
              id="max-tokens"
              value={maxTokens}
              disabled={running}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
            >
              {[256, 512, 1024, 2048, 4096].map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()} tokens / model
                </option>
              ))}
            </select>
          </div>
          <div className="run-controls">
            <div className="cost-estimate">
              <span>Approx. at output limit</span>
              <strong>
                {formatPrice(estimate)} <small>total</small>
              </strong>
            </div>
            {running ? (
              <button
                className="button secondary"
                onClick={() => controller.current?.abort()}
              >
                <Square size={15} /> Stop
              </button>
            ) : (
              <button
                className="button primary"
                disabled={connected && !prompt.trim()}
                onClick={run}
              >
                {connected ? <Play size={15} /> : <KeyRound size={15} />}{" "}
                {connected
                  ? ids.length > 1
                    ? "Compare models"
                    : "Run model"
                  : "Connect to compare"}
              </button>
            )}
          </div>
        </div>
        <p className="estimate-note">
          Estimates use about 4 characters per input token and the selected
          output limit. Actual charges vary with tokenization, reasoning,
          caching and provider pricing. OpenRouter credit-purchase fees are
          separate.
        </p>
      </section>
      <section
        className="comparison-section"
        aria-live="polite"
        aria-busy={running}
      >
        <div className="section-heading">
          <div className="section-title">
            <MessageSquare size={20} />
            <h2>See the difference.</h2>
          </div>
          {results.length > 0 && (
            <span className="comparison-total">
              Known{" "}
              {knownResults.some((r) => r.costType === "estimated")
                ? "estimated "
                : ""}
              cost{" "}
              <strong>
                {knownResults.length ? formatPrice(total) : "Not yet available"}
              </strong>
            </span>
          )}
        </div>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {!results.length ? (
          <div className="comparison-empty">
            <div className="empty-model-icons">
              {chosen.map((m) => (
                <ModelMark key={m.id} provider={m.provider} />
              ))}
            </div>
            <h3>Let curiosity do its thing.</h3>
            <p>
              Your model responses will appear here, side by side,
              <br />
              with tokens, response time, and the cost of each run.
            </p>
            <span>No subscriptions to juggle. Just pay for what you try.</span>
          </div>
        ) : (
          <>
            <div className="run-prompt">
              <span>YOUR PROMPT</span>
              <p>{runPrompt}</p>
            </div>
            <div
              className="comparison-grid"
              style={
                { "--result-count": results.length } as React.CSSProperties
              }
            >
              {results.map((result, index) => (
                <article className="response-card" key={result.modelId}>
                  <div className="response-heading">
                    <ModelMark provider={result.modelId.split("/")[0]} small />
                    <div>
                      <span>MODEL {String.fromCharCode(65 + index)}</span>
                      <h3>{result.modelName}</h3>
                    </div>
                    {result.text && (
                      <button
                        className="icon-button"
                        onClick={() => copy(result)}
                        aria-label={`Copy ${result.modelName} response`}
                      >
                        {copied === result.modelId ? (
                          <Check size={16} />
                        ) : (
                          <Copy size={16} />
                        )}
                      </button>
                    )}
                  </div>
                  {result.status === "waiting" ? (
                    <div className="response-waiting">
                      <LoaderCircle className="spin" size={24} />
                      <p>Thinking it through…</p>
                      <span>Some models take a little longer.</span>
                    </div>
                  ) : result.error ? (
                    <div className="response-error">
                      <Info size={22} />
                      <h4>This model couldn’t finish.</h4>
                      <p>{result.error}</p>
                    </div>
                  ) : (
                    <div className="response-body">
                      <Markdown
                        components={{
                          img: () => null,
                          a: ({ children, href }) => (
                            <a href={href} target="_blank" rel="noreferrer">
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {result.text || ""}
                      </Markdown>
                      {result.truncated && (
                        <p className="truncation-note">
                          Output limit reached; this response may be incomplete.
                        </p>
                      )}
                    </div>
                  )}
                  <div className="response-stats">
                    <div>
                      <span>
                        {result.costType === "estimated"
                          ? "Estimated cost"
                          : "Reported cost"}
                      </span>
                      <strong>
                        {result.cost !== undefined
                          ? formatPrice(result.cost)
                          : "Unavailable"}
                      </strong>
                    </div>
                    <div>
                      <span>Input / output tokens</span>
                      <strong>
                        {result.inputTokens?.toLocaleString() ?? "—"} /{" "}
                        {result.outputTokens?.toLocaleString() ?? "—"}
                      </strong>
                    </div>
                    <div>
                      <span>Time</span>
                      <strong>
                        {result.duration
                          ? `${result.duration.toFixed(1)}s`
                          : "—"}
                      </strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <p className="source-note">
              Reported costs come from OpenRouter. Estimates are labeled when
              cost data is absent. Known cost includes charges received from
              OpenRouter. Failed or stopped requests may incur additional
              charges that are not reported here. Verify statements before
              relying on AI responses.
            </p>
          </>
        )}
      </section>
      <div className="playground-bottom-note">
        <Wallet size={16} />
        <span>Need more room to explore?</span>
        <a
          href="https://openrouter.ai/settings/credits"
          target="_blank"
          rel="noreferrer"
        >
          Add credits on OpenRouter
        </a>
        <span className="bottom-separator">·</span>
        <Link href="/learn#tokens">How does pricing work?</Link>
      </div>
    </div>
  );
}
