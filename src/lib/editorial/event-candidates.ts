// Conservative, free, metadata-only hints for an editor. No automatic event merges.
export type EventSource = {
  id: string; title: string; source_name: string; source_published_at: string; url: string;
};

const entities: [string, RegExp][] = [
  ['openai', /\b(?:openai|chatgpt|gpt[- ]?\d+)\b/i],
  ['google', /\b(?:google|deepmind|gemini)\b/i],
  ['anthropic', /\b(?:anthropic|claude)\b/i],
  ['meta', /\b(?:meta|llama)\b/i],
  ['microsoft', /\b(?:microsoft|copilot)\b/i],
  ['nvidia', /\b(?:nvidia|nemotron)\b/i],
  ['huggingface', /\b(?:hugging\s?face)\b/i],
];
const actions: [string, RegExp][] = [
  ['provenance', /\b(?:watermark\w*|provenance|content.origin)\b/i],
  ['release', /\b(?:release\w*|launch\w*|unveil\w*|introduc\w*|debut\w*|roll(?:ing)? out)\b/i],
  ['update', /\b(?:update\w*|upgrade\w*|patch\w*|revis\w*)\b/i],
  ['benchmark', /\b(?:benchmark\w*|evaluat\w*|test results)\b/i],
  ['policy', /\b(?:regulat\w*|law\w*|ruling\w*|lawsuit\w*|ban\w*)\b/i],
  ['outage', /\b(?:outage\w*|downtime|service interruption)\b/i],
];
const ignore = new Set('a an and are as at be by for from in is it its of on or our the their this to with will ai llm model models new latest news report reports says said research study tool tools today developers company openai chatgpt google deepmind anthropic claude meta microsoft nvidia huggingface'.split(' '));
const versions = (title: string) => new Set((title.toLowerCase().match(/\b(?:gpt|gemini|claude|llama|qwen|grok|mistral)[- ]?\d+(?:\.\d+)?[a-z]?\b/g) || []).map(value => value.replace(/[ -]/g,'')));
const tokens = (title: string) => new Set(title.toLowerCase().match(/[a-z0-9]+/g)?.filter(word => word.length >= 2 && !ignore.has(word) && !actions.some(([,match])=>match.test(word))) || []);
const labels = (text: string, options: [string,RegExp][]) => new Set(options.filter(([,match]) => match.test(text)).map(([name]) => name));
const overlap = <T>(a: Set<T>, b: Set<T>) => [...a].some(value => b.has(value));

export function suggestRelatedCoverage(anchor: EventSource, nearby: EventSource[], excludedIds: ReadonlySet<string> = new Set()): EventSource[] {
  const start = Date.parse(anchor.source_published_at);
  if (!Number.isFinite(start)) return [];
  const anchorEntities = labels(`${anchor.title} ${anchor.source_name}`, entities);
  const anchorActions = labels(anchor.title, actions);
  if (!anchorEntities.size || !anchorActions.size) return [];
  const anchorVersions = versions(anchor.title);
  const words = tokens(anchor.title);
  return nearby.filter(candidate => {
    if (excludedIds.has(candidate.id) || candidate.id === anchor.id || candidate.url === anchor.url) return false;
    const time = Date.parse(candidate.source_published_at);
    if (!Number.isFinite(time) || Math.abs(time - start) > 72 * 60 * 60 * 1000) return false;
    if (!overlap(anchorEntities,labels(`${candidate.title} ${candidate.source_name}`,entities))) return false;
    if (!overlap(anchorActions,labels(candidate.title,actions))) return false;
    const otherVersions = versions(candidate.title);
    const sameVersion = overlap(anchorVersions,otherVersions);
    if ((anchorVersions.size || otherVersions.size) && !sameVersion) return false;
    const otherWords = tokens(candidate.title);
    const shared = [...words].filter(word => otherWords.has(word)).length;
    return shared >= 2 || (sameVersion && shared >= 1);
  }).sort((a,b) => b.source_published_at.localeCompare(a.source_published_at) || a.id.localeCompare(b.id)).slice(0,6);
}
