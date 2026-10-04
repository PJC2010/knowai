"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Search,
  X,
  Plus,
  Check,
  Image,
  Type,
  ChevronDown,
  ExternalLink,
  SlidersHorizontal,
} from "@/components/icons";
import type { Model, ModelsData } from "@/lib/types";
import { featuredModels } from "@/lib/models-client";
import { formatPrice, formatContext, dateLabel } from "@/lib/format";
import { ModelMark, providerName } from "./model-mark";

export function ModelLibrary({ data }: { data: ModelsData }) {
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("search") || "");
  const [provider, setProvider] = useState("All providers");
  const [sort, setSort] = useState("featured");
  const [onlyFree, setOnlyFree] = useState(false);
  const [limit, setLimit] = useState(12);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<Model | null>(null);
  const featured = featuredModels(data.models).map((m) => m.id);
  const filtered = data.models
    .filter(
      (m) =>
        `${m.name} ${m.id}`.toLowerCase().includes(search.toLowerCase()) &&
        (provider === "All providers" || m.provider === provider) &&
        (!onlyFree || (m.inputPrice === 0 && m.outputPrice === 0)),
    )
    .sort((a, b) =>
      sort === "price"
        ? a.inputPrice - b.inputPrice
        : sort === "newest"
          ? b.created - a.created
          : (featured.includes(b.id) ? 1 : 0) -
              (featured.includes(a.id) ? 1 : 0) || a.name.localeCompare(b.name),
    );
  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 3
          ? [...prev, id]
          : prev,
    );
  }
  return (
    <div className="page-container library-page">
      <div className="page-heading">
        <span className="eyebrow">The model library</span>
        <h1>
          Find your kind of <span className="text-green">intelligence.</span>
        </h1>
        <p>Meet the models. Understand the tradeoffs. Decide for yourself.</p>
      </div>
      <div className="library-explainer">
        <span>
          <strong>{data.models.length}</strong> models for text
        </span>
        <span>
          <strong>One account.</strong> Plenty of possibilities.
        </span>
        <span className="catalog-status">
          {data.fallback ? "Saved catalog" : "Live OpenRouter catalog"} ·{" "}
          {dateLabel(data.fetchedAt)}
        </span>
      </div>
      {data.fallback && (
        <p className="notice">
          Live prices are unavailable. These are saved prices from{" "}
          {dateLabel(data.fetchedAt)}; check OpenRouter before running a paid
          request.
        </p>
      )}
      <div className="library-controls">
        <div className="search-field">
          <Search size={18} />
          <input
            aria-label="Search models"
            placeholder="Search models or providers…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(12);
            }}
          />
          {search && (
            <button
              className="icon-button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
            >
              <X size={16} />
            </button>
          )}
        </div>
        <label className="select-control">
          <span className="sr-only">Filter provider</span>
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setLimit(12);
            }}
          >
            <option>All providers</option>
            {[...new Set(data.models.map((m) => m.provider))]
              .sort()
              .map((p) => (
                <option value={p} key={p}>
                  {providerName(p)}
                </option>
              ))}
          </select>
        </label>
        <label className="select-control">
          <SlidersHorizontal size={15} />
          <span className="sr-only">Sort models</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="featured">Featured first</option>
            <option value="price">Lowest input price</option>
            <option value="newest">Newest first</option>
          </select>
        </label>
      </div>
      <div className="results-heading">
        <span>{filtered.length} models to explore</span>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={onlyFree}
            onChange={(e) => {
              setOnlyFree(e.target.checked);
              setLimit(12);
            }}
          />{" "}
          Free models only
        </label>
      </div>
      <div className="model-grid">
        {filtered.slice(0, limit).map((model) => (
          <article
            className={`model-card ${selected.includes(model.id) ? "selected" : ""}`}
            key={model.id}
          >
            <div className="model-card-top">
              <ModelMark provider={model.provider} />
              <button
                className={`select-model ${selected.includes(model.id) ? "selected" : ""}`}
                disabled={!selected.includes(model.id) && selected.length >= 3}
                aria-label={`${selected.includes(model.id) ? "Remove" : "Compare"} ${model.name}`}
                aria-pressed={selected.includes(model.id)}
                onClick={() => toggle(model.id)}
              >
                {selected.includes(model.id) ? (
                  <Check size={17} />
                ) : (
                  <Plus size={17} />
                )}
              </button>
            </div>
            <span className="provider-name">
              {providerName(model.provider)}
            </span>
            <h2>
              <button
                className="model-name-button"
                onClick={() => setDetail(model)}
              >
                {model.name}
              </button>
            </h2>
            <p className="model-description">
              {model.description ||
                "A model for text available through OpenRouter. Open its details to learn more."}
            </p>
            <div className="modality-tags">
              <span>
                <Type size={13} /> Text
              </span>
              {model.modalities.includes("image") && (
                <span>
                  <Image size={13} /> Vision
                </span>
              )}
              <span>{formatContext(model.contextLength)} context</span>
            </div>
            <div className="model-pricing">
              <div>
                <span>Input / 1M tokens</span>
                <strong>{formatPrice(model.inputPrice)}</strong>
              </div>
              <div>
                <span>Output / 1M tokens</span>
                <strong>{formatPrice(model.outputPrice)}</strong>
              </div>
            </div>
            <Link
              className="model-try"
              href={`/playground?models=${encodeURIComponent(model.id)}`}
            >
              Try this model <Plus size={15} />
            </Link>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <Search size={30} />
          <h2>No models found</h2>
          <p>Try a different name or remove a filter.</p>
          <button
            className="button secondary"
            onClick={() => {
              setSearch("");
              setProvider("All providers");
              setOnlyFree(false);
            }}
          >
            Reset filters
          </button>
        </div>
      )}
      {filtered.length > limit && (
        <button
          className="button secondary load-more"
          onClick={() => setLimit(limit + 12)}
        >
          Load more models <ChevronDown size={16} />
        </button>
      )}
      <p className="source-note">
        Base prices per one million tokens, in USD. A token is roughly a piece
        of a word. Provider routing, caching and context length can affect final
        charges. Descriptions are supplied by model providers via OpenRouter.
      </p>
      {selected.length > 0 && (
        <div className="compare-tray">
          <div>
            <strong>{selected.length} of 3 models selected</strong>
            <span>
              {selected
                .map((id) => data.models.find((m) => m.id === id)?.name)
                .join(" · ")}
            </span>
          </div>
          <button className="text-button" onClick={() => setSelected([])}>
            Clear
          </button>
          <Link
            className="button primary"
            href={`/playground?models=${encodeURIComponent(selected.join(","))}`}
          >
            Compare models
          </Link>
        </div>
      )}
      <Dialog.Root
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content model-dialog">
            <Dialog.Close
              className="icon-button dialog-close"
              aria-label="Close model details"
            >
              <X size={20} />
            </Dialog.Close>
            {detail && (
              <>
                <ModelMark provider={detail.provider} />
                <Dialog.Title>{detail.name}</Dialog.Title>
                <Dialog.Description className="model-full-description">
                  {detail.description ||
                    "A model for text available through OpenRouter."}
                </Dialog.Description>
                <dl className="detail-stats">
                  <div>
                    <dt>Context window</dt>
                    <dd>{detail.contextLength.toLocaleString()} tokens</dd>
                  </div>
                  <div>
                    <dt>Input / 1M tokens</dt>
                    <dd>{formatPrice(detail.inputPrice)}</dd>
                  </div>
                  <div>
                    <dt>Output / 1M tokens</dt>
                    <dd>{formatPrice(detail.outputPrice)}</dd>
                  </div>
                  <div>
                    <dt>Input capabilities</dt>
                    <dd>{detail.modalities.join(", ")}</dd>
                  </div>
                </dl>
                <a
                  className="small-link"
                  href={`https://openrouter.ai/${detail.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Full model card on OpenRouter <ExternalLink size={13} />
                </a>
                <Link
                  className="button primary full"
                  href={`/playground?models=${encodeURIComponent(detail.id)}`}
                >
                  Try in the playground
                </Link>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
