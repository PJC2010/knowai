import glossaryData from "../data/glossary.json";

export type GlossaryTerm = {
  id: string;
  term: string;
  aliases: string[];
  definition: string;
};

export type GlossarySegment = string | { termId: string; text: string };

export const glossary: GlossaryTerm[] = glossaryData;

export function termById(id: string): GlossaryTerm | undefined {
  return glossary.find((term) => term.id === id);
}

export function annotateSections(
  sections: string[],
  terms: GlossaryTerm[] = glossary,
): GlossarySegment[][] {
  const aliases = terms.flatMap((term) => term.aliases.map((alias) => ({ alias, termId: term.id })));
  if (aliases.length === 0) return sections.map((section) => [section]);

  aliases.sort((a, b) => b.alias.length - a.alias.length);
  const pattern = aliases.map(({ alias }) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const regex = new RegExp(`(?<![\\p{L}\\p{N}])(${pattern})(?![\\p{L}\\p{N}])`, "giu");
  const seen = new Set<string>();

  return sections.map((section) => {
    const segments: GlossarySegment[] = [];
    let cursor = 0;
    for (const match of section.matchAll(regex)) {
      const matchedText = match[0];
      const entry = aliases.find(({ alias }) => alias.toLowerCase() === matchedText.toLowerCase());
      if (!entry || (entry.alias === entry.alias.toUpperCase() && matchedText !== entry.alias) || seen.has(entry.termId)) {
        continue;
      }
      if (match.index > cursor) segments.push(section.slice(cursor, match.index));
      segments.push({ termId: entry.termId, text: matchedText });
      seen.add(entry.termId);
      cursor = match.index + matchedText.length;
    }
    if (cursor < section.length || segments.length === 0) segments.push(section.slice(cursor));
    return segments;
  });
}
