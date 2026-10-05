"use client";

import { useState } from "react";

export function StoryImage({
  src,
  alt,
  className = "",
  priority = false,
}: {
  src?: string | null;
  alt?: string | null;
  className?: string;
  priority?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!src || failedUrl === src) return null;

  return (
    // Publisher images are loaded directly: their CDN hosts and dimensions vary.
    // Failed images leave the story's text layout intact, without placeholder art.
    <img
      className={`story-image ${className}`.trim()}
      src={src}
      alt={alt || ""}
      width={1200}
      height={675}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(src)}
    />
  );
}
