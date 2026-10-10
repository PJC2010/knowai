import { Fragment } from "react";
import { termById, type GlossarySegment } from "@/lib/glossary";

export function GlossaryText({
  segments,
  scope,
}: {
  segments: GlossarySegment[];
  scope: string;
}): React.JSX.Element {
  return (
    <>
      {segments.map((segment, index) => {
        if (typeof segment === "string") return <Fragment key={index}>{segment}</Fragment>;
        const term = termById(segment.termId);
        if (!term) return <Fragment key={index}>{segment.text}</Fragment>;
        const id = `${scope}-term-${term.id}`;
        return (
          <Fragment key={index}>
            <button type="button" className="glossary-term" popoverTarget={id}>
              {segment.text}
            </button>
            <span popover="auto" id={id} className="glossary-pop">
              <strong>{term.term}</strong> {term.definition}{" "}
              <a href={`/learn#term-${term.id}`}>More in the AI 101 glossary</a>
            </span>
          </Fragment>
        );
      })}
    </>
  );
}
