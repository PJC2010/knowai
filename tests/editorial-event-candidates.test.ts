import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestRelatedCoverage } from '../src/lib/editorial/event-candidates';

const source = (id:string,title:string,source_name:string,source_published_at='2026-10-05T15:00:00.000Z') => ({id,title,source_name,source_published_at,url:`https://example.test/${id}`});

test('metadata-only suggestions find a shared development but do not claim corroboration', () => {
  const original = source('vendor','Our approach to EU text provenance rules','OpenAI');
  const coverage = source('report','OpenAI will start watermarking ChatGPT text in the EU','TechCrunch','2026-10-05T20:36:00.000Z');
  const result = suggestRelatedCoverage(original,[coverage,source('same-outlet','OpenAI will watermark text in the EU','OpenAI')]);
  assert.deepEqual(result.map(item=>item.id),['report','same-outlet']);
  assert.equal(result[0].source_name,'TechCrunch');
  assert.equal(result[1].source_name,'OpenAI');
});

test('same org or headline overlap cannot conflate versions, actions or distant dates', () => {
  const anchor = source('gpt6','OpenAI releases GPT-6 for developers','OpenAI');
  const candidates = [
    source('new-version','OpenAI releases GPT-7 for developers','TechCrunch'),
    source('different-action','OpenAI updates GPT-6 for developers','TechCrunch'),
    source('old','OpenAI releases GPT-6 for developers','TechCrunch','2025-10-05T15:00:00.000Z'),
    source('other-model','Google releases Gemini 6 for developers','Google'),
    source('same','OpenAI launches GPT-6 for developers','TechCrunch','2026-10-06T00:00:00.000Z'),
  ];
  assert.deepEqual(suggestRelatedCoverage(anchor,candidates).map(item=>item.id),['same']);
});

test('generic industry terms and missing original dates never create event suggestions', () => {
  const anchor=source('a','A new AI research study appears','OpenAI');
  assert.deepEqual(suggestRelatedCoverage(anchor,[source('b','New AI research study revealed','Google')]),[]);
  assert.deepEqual(suggestRelatedCoverage(source('bad','OpenAI launches GPT-6','OpenAI','not-a-date'),[source('ok','OpenAI launches GPT-6','TechCrunch')]),[]);
});

test('an organization and launch verb alone cannot suggest unrelated releases', () => {
  const anchor=source('sora','OpenAI launches Sora video editor','OpenAI');
  const unrelated=source('atlas','OpenAI launches Atlas browser','TechCrunch');
  assert.deepEqual(suggestRelatedCoverage(anchor,[unrelated]),[]);
});

test('already grouped sources do not consume the six suggestion slots', () => {
  const anchor=source('anchor','OpenAI launches GPT-6 for developers','OpenAI');
  const grouped=Array.from({length:7},(_,i)=>source(`group-${i}`,'OpenAI releases GPT-6 for developers','TechCrunch','2026-10-05T16:00:00.000Z'));
  const outside=source('outside','OpenAI releases GPT-6 for developers','Wired');
  const excluded=new Set(grouped.map(item=>item.id));
  assert.deepEqual(suggestRelatedCoverage(anchor,[...grouped,outside],excluded).map(item=>item.id),['outside']);
});
