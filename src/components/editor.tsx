"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  editorialAction,
  loginEditor,
  type EditorActionState,
} from "@/app/editor/actions";
import { BriefFeed } from "./brief-feed";
import {
  characterCount,
  validateTiers,
  wordCount,
  type BriefStory,
  type Revision,
  type Tiers,
} from "@/lib/brief";
const initial: EditorActionState = { ok: false, message: "" };

export function EditorLogin() {
  const [state, action, pending] = useActionState(loginEditor, initial);
  return (
    <form action={action} className="editor-login">
      <label>
        Editor email
        <input type="email" name="email" required autoComplete="email" />
      </label>
      <button className="button primary" disabled={pending}>
        {pending ? "Sending…" : "Send a sign-in link"}
      </button>
      <p role="status">{state.message}</p>
    </form>
  );
}
export function EditorJobAction({
  storyId,
  importStarters = false,
}: {
  storyId?: string;
  importStarters?: boolean;
}) {
  const [state, action, pending] = useActionState(editorialAction, initial);
  const router = useRouter();
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="editor-job-action">
      <input
        type="hidden"
        name="intent"
        value={importStarters ? "import" : storyId ? "regenerate" : "refresh"}
      />
      {storyId && (
        <>
          <input type="hidden" name="id" value={storyId} />
          <label className="editor-check">
            <input type="checkbox" name="confirmCharge" value="yes" required />{" "}
            Generate a new draft; this may incur another charge.
          </label>
        </>
      )}
      <button className="button secondary" disabled={pending}>
        {pending
          ? "Preparing drafts…"
          : importStarters
            ? "Import four starter drafts"
            : storyId
              ? "Queue regeneration"
              : "Refresh sources and prepare drafts"}
      </button>
      <p role="status">{state.message}</p>
    </form>
  );
}
export function RevisionEditor({
  revision,
  story,
}: {
  revision: Revision;
  story: Omit<
    BriefStory,
    | "one_liner"
    | "short_version"
    | "whole_picture"
    | "why_it_matters"
    | "published_at"
    | "updated_at"
    | "edition_date"
  >;
}) {
  const [content, setContent] = useState<Tiers>(revision.content);
  const [sourceChecked, setSourceChecked] = useState(false);
  const [tiersChecked, setTiersChecked] = useState(false);
  const [preview, setPreview] = useState(false);
  const [state, action, pending] = useActionState(editorialAction, initial);
  const router = useRouter();
  const dirty = JSON.stringify(content) !== JSON.stringify(revision.content);
  const errors = validateTiers(content, revision.source_text);
  const editable = revision.state === "needs_review";
  useEffect(() => {
    if (state.ok) {
      if (state.revisionId) router.push(`/editor?id=${state.revisionId}`);
      else router.refresh();
    }
  }, [state, router]);
  function change<K extends keyof Tiers>(key: K, value: Tiers[K]) {
    setContent((previous) => ({ ...previous, [key]: value }));
    setSourceChecked(false);
    setTiersChecked(false);
  }
  const date = new Date(revision.created_at).toISOString().slice(0, 10);
  const previewStory: BriefStory = {
    ...story,
    one_liner: content.oneLiner,
    short_version: content.shortVersion,
    whole_picture: content.wholePicture,
    why_it_matters: content.whyItMatters,
    published_at: revision.created_at,
    updated_at: revision.created_at,
    edition_date: date,
  };
  return (
    <div className="revision-editor">
      <div className="editor-section-heading">
        <div>
          <span className="eyebrow">
            {revision.state.replaceAll("_", " ")} · Revision version{" "}
            {revision.version}
          </span>
          <h2>Make every version earn its place.</h2>
        </div>
        <button
          className="button secondary"
          onClick={() => setPreview(!preview)}
        >
          {preview ? "Close preview" : "Preview reading depths"}
        </button>
      </div>
      {preview && (
        <div className="editor-preview">
          <BriefFeed stories={[previewStory]} preview />
        </div>
      )}
      <div className="editor-columns">
        <aside className="editor-source">
          <h3>Source material</h3>
          <a href={story.source_url} target="_blank" rel="noreferrer">
            Open {story.source_name} original ↗
          </a>
          <p>
            Captured evidence belongs to this revision. Check the original for
            updates before publishing.
          </p>
          <div className="source-capture">{revision.source_text}</div>
        </aside>
        <form action={action} className="editor-form">
          <input type="hidden" name="id" value={revision.id} />
          <input type="hidden" name="version" value={revision.version} />
          <input
            type="hidden"
            name="evidence"
            value={JSON.stringify(content.evidence)}
          />
          <label>
            The one-liner{" "}
            <span>{characterCount(content.oneLiner)} / 140 characters</span>
            <textarea
              name="oneLiner"
              value={content.oneLiner}
              readOnly={!editable}
              onChange={(e) => change("oneLiner", e.target.value)}
              rows={3}
            />
          </label>
          <label>
            The short version{" "}
            <span>{wordCount(content.shortVersion)} words · 40–80</span>
            <textarea
              name="shortVersion"
              value={content.shortVersion}
              readOnly={!editable}
              onChange={(e) => change("shortVersion", e.target.value)}
              rows={5}
            />
          </label>
          <label>
            The whole picture{" "}
            <span>
              {wordCount(content.wholePicture.join(" "))} words · 150–300; blank
              line between paragraphs
            </span>
            <textarea
              name="wholePicture"
              value={content.wholePicture.join("\n\n")}
              readOnly={!editable}
              onChange={(e) =>
                change("wholePicture", e.target.value.split(/\n\s*\n/))
              }
              rows={12}
            />
          </label>
          <label>
            Why it matters{" "}
            <span>{characterCount(content.whyItMatters)} / 240 characters</span>
            <textarea
              name="whyItMatters"
              value={content.whyItMatters}
              readOnly={!editable}
              onChange={(e) => change("whyItMatters", e.target.value)}
              rows={3}
            />
          </label>
          <fieldset className="editor-evidence">
            <legend>Evidence · private review notes</legend>
            {content.evidence.map((item, index) => (
              <div key={index}>
                <label>
                  Claim {index + 1}
                  <input
                    value={item.claim}
                    readOnly={!editable}
                    onChange={(e) =>
                      change(
                        "evidence",
                        content.evidence.map((v, i) =>
                          i === index ? { ...v, claim: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Exact source excerpt
                  <textarea
                    value={item.quote}
                    readOnly={!editable}
                    onChange={(e) =>
                      change(
                        "evidence",
                        content.evidence.map((v, i) =>
                          i === index ? { ...v, quote: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </label>
                {editable && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      change(
                        "evidence",
                        content.evidence.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove evidence {index + 1}
                  </button>
                )}
              </div>
            ))}
            {editable && content.evidence.length < 8 && (
              <button
                className="button secondary"
                type="button"
                onClick={() =>
                  change("evidence", [
                    ...content.evidence,
                    { claim: "", quote: "" },
                  ])
                }
              >
                Add supporting evidence
              </button>
            )}
          </fieldset>
          {errors.length > 0 && (
            <div className="notice">
              <strong>Before publication</strong>
              <ul>
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}
          {editable ? (
            <>
              <label className="editor-check">
                <input
                  type="checkbox"
                  name="sourceChecked"
                  value="yes"
                  checked={sourceChecked}
                  onChange={(e) => setSourceChecked(e.target.checked)}
                />{" "}
                I checked the original source and the factual claims.
              </label>
              <label className="editor-check">
                <input
                  type="checkbox"
                  name="tiersChecked"
                  value="yes"
                  checked={tiersChecked}
                  onChange={(e) => setTiersChecked(e.target.checked)}
                />{" "}
                I reviewed all three standalone versions, including the
                one-liner’s tone.
              </label>
              <p className="source-note">
                {dirty
                  ? "Save your changes before approving. Saving does not publish."
                  : "Publish approves the saved version. Rejection leaves any existing publication unchanged."}
              </p>
              <div className="editor-actions">
                <button
                  className="button secondary"
                  name="intent"
                  value="save"
                  disabled={pending || !dirty}
                >
                  Save draft
                </button>
                <button
                  className="button primary"
                  name="intent"
                  value="publish"
                  disabled={
                    pending ||
                    dirty ||
                    errors.length > 0 ||
                    !sourceChecked ||
                    !tiersChecked
                  }
                >
                  Approve and publish
                </button>
                <button
                  className="text-button"
                  name="intent"
                  value="reject"
                  disabled={pending}
                >
                  Reject draft
                </button>
              </div>
            </>
          ) : (
            <button
              className="button primary"
              name="intent"
              value="fork"
              disabled={pending}
            >
              Create an editable revision
            </button>
          )}
          <p role="status">
            {pending ? "Saving your editorial decision…" : state.message}
          </p>
        </form>
      </div>
    </div>
  );
}
