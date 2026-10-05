"use client";
import { useEffect, useState } from "react";
import type { DeskResult } from "@/lib/editorial/desk-types";

export type StoryImageSelection = { url: string | null; alt: string; source: "source" | "upload" | "none" };
export type ImageRequest = { source: StoryImageSelection["source"]; url: string | null; alt: string; file: File | null };

export function StoryImageSelector({ initial, sourceUrl, disabled, onChange, onSave, onRefresh }: {
  initial: StoryImageSelection; sourceUrl: string | null; disabled: boolean;
  onChange: (selection: StoryImageSelection, dirty: boolean) => void;
  onSave: (request: ImageRequest) => Promise<DeskResult>;
  onRefresh: () => Promise<DeskResult>;
}) {
  const [saved, setSaved] = useState(initial);
  const [source, setSource] = useState(initial.source);
  const [alt, setAlt] = useState(initial.alt);
  const [articleUrl, setArticleUrl] = useState(sourceUrl);
  const [selectedArticleUrl, setSelectedArticleUrl] = useState(initial.source === "source" ? initial.url : sourceUrl);
  const [file, setFile] = useState<File | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const url = source === "none" ? null : source === "source" ? selectedArticleUrl : localUrl || (saved.source === "upload" ? saved.url : null);
  const dirty = source !== saved.source || (source !== "none" && (alt !== saved.alt || url !== saved.url)) || !!file;
  const locked = disabled || pending;
  useEffect(() => {
    if (!file) { setLocalUrl(null); return; }
    const objectUrl = URL.createObjectURL(file);
    setLocalUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  useEffect(() => { onChange({ url, alt: source === "none" ? "" : alt, source }, dirty); }, [url, alt, source, dirty, onChange]);

  function accept(result: DeskResult) {
    if (!result.ok) { setError(result.message); return; }
    const next: StoryImageSelection = { url: result.imageUrl ?? null, alt: result.imageAlt || "", source: result.imageSource || "none" };
    setSaved(next); setSource(next.source); setAlt(next.alt); setFile(null);
    setSelectedArticleUrl(next.source === "source" ? next.url : result.sourceImageUrl ?? articleUrl);
    if (result.sourceImageUrl !== undefined) setArticleUrl(result.sourceImageUrl);
    setMessage(result.message);
  }
  async function save() {
    setPending(true); setError(""); setMessage("");
    try { accept(await onSave({ source, url, alt: source === "none" ? "" : alt.trim(), file })); }
    catch { setError("The image could not be saved. Your selection is still here; try again."); }
    finally { setPending(false); }
  }
  return <section className="desk-image-selector" aria-labelledby="story-image-heading">
    <h2 id="story-image-heading">Story image</h2>
    <p className="desk-hint">Choose the image readers see in the story box. Changes appear in The Brief after you publish this revision.</p>
    <fieldset className="desk-image-options" disabled={locked}>
      <legend className="sr-only">Image selection</legend>
      <label><input type="radio" name="story-image" checked={source === "source"} disabled={!articleUrl} onChange={() => { setSource("source"); setSelectedArticleUrl(articleUrl); setFile(null); setError(""); }} />Article image</label>
      <label><input type="radio" name="story-image" checked={source === "none"} onChange={() => { setSource("none"); setFile(null); setError(""); }} />No image</label>
      <label><input type="radio" name="story-image" checked={source === "upload"} onChange={() => { setSource("upload"); setError(""); }} />Upload an image</label>
    </fieldset>
    {!articleUrl && <p className="desk-hint">No article image has been found. Check the source again or upload an image.</p>}
    {source === "upload" && <label className="desk-image-upload">Choose image<input key={saved.url || "new-image"} type="file" accept="image/jpeg,image/png,image/webp" disabled={locked} aria-describedby="image-upload-help" onChange={event => {
      const selected = event.target.files?.[0];
      if (!selected) return;
      if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type) || selected.size > 3 * 1024 * 1024 || !selected.size) {
        setError("Choose a JPG, PNG, or WebP image up to 3 MB."); event.target.value = ""; return;
      }
      setFile(selected); setError(""); setMessage("");
    }} /><span id="image-upload-help" className="desk-hint">JPG, PNG, or WebP · up to 3 MB</span></label>}
    <div className="desk-image-preview">
      {url && failedUrl !== url ? <img src={url} alt={alt || "Selected story image preview"} onError={() => setFailedUrl(url)} referrerPolicy="no-referrer" /> : <p>{url ? "This image could not load. Try another image or upload a replacement." : source === "upload" ? "Choose a file to preview it here." : "This story will appear without an image."}</p>}
    </div>
    {source !== "none" && <label className="desk-image-description">Image description<input type="text" value={alt} maxLength={300} disabled={locked} onChange={event => setAlt(event.target.value)} aria-describedby="image-description-help" /><span className="desk-hint" id="image-description-help">Describe what is shown for readers using a screen reader. Leave blank for a decorative image.</span></label>}
    <div className="desk-card-actions"><button className="button secondary" disabled={locked || !dirty || (source !== "none" && !url)} onClick={() => void save()}>{pending ? "Saving image…" : "Save image"}</button><button className="text-button" disabled={locked || dirty} onClick={async () => {
      setPending(true); setError(""); setMessage("");
      try { accept(await onRefresh()); }
      catch { setError("The article image could not be checked. Try again or upload an image."); }
      finally { setPending(false); }
    }}>Find article image</button></div>
    {dirty && <p className="desk-hint">Save your image selection before final review.</p>}
    {error && <p className="desk-invalid" role="alert">{error}</p>}
    <p className="desk-hint" role="status">{!error && message}</p>
  </section>;
}
