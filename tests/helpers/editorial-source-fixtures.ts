// Synthetic metadata for local tests only. No publisher text or permissions are implied.
export const fixturePublishedAt='2026-10-01T12:00:00.000Z';
export const addedSourceFixtures=[
 {key:'microsoft-research',name:'Microsoft Research',kind:'research',feed:'https://www.microsoft.com/en-us/research/feed/',url:'https://www.microsoft.com/en-us/research/blog/fixture-ai-research/'},
 {key:'nvidia',name:'NVIDIA',kind:'company',feed:'https://blogs.nvidia.com/feed/',url:'https://blogs.nvidia.com/blog/fixture-ai-computing/'},
 {key:'aws-ml',name:'AWS Machine Learning',kind:'company',feed:'https://aws.amazon.com/blogs/machine-learning/feed/',url:'https://aws.amazon.com/blogs/machine-learning/fixture-ai-deployment/'},
 {key:'mistral',name:'Mistral',kind:'company',feed:'https://mistral.ai/news/rss',url:'https://mistral.ai/news/fixture-ai-model/'},
 {key:'bair',name:'Berkeley BAIR',kind:'research',feed:'https://bair.berkeley.edu/blog/feed.xml',url:'https://bair.berkeley.edu/blog/2026/10/01/fixture-ai-research/'},
 {key:'ars-technica',name:'Ars Technica',kind:'journalism',feed:'https://arstechnica.com/feed/',url:'https://arstechnica.com/ai/2026/10/fixture-ai-report/'},
 {key:'the-verge',name:'The Verge',kind:'journalism',feed:'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',url:'https://www.theverge.com/ai-artificial-intelligence/99999/fixture-ai-report'},
 {key:'mit-tech-review',name:'MIT Technology Review',kind:'journalism',feed:'https://www.technologyreview.com/topic/artificial-intelligence/feed/',url:'https://www.technologyreview.com/2026/10/01/999999/fixture-ai-report/'},
 {key:'the-decoder',name:'The Decoder',kind:'journalism',feed:'https://the-decoder.com/feed/',url:'https://the-decoder.com/fixture-ai-report/'},
 {key:'anthropic',name:'Anthropic',kind:'company',feed:'https://www.anthropic.com/news',url:'https://www.anthropic.com/news/fixture-claude-release'},
] as const;
export const newsroomListing=(urls:readonly string[])=>`<html><body><main><h1>Newsroom</h1><div class="PublicationList-module-scss-module__test__root"><ul class="PublicationList-module-scss-module__test__list">${urls.map(url=>`<li><a class="PublicationList-module-scss-module__test__listItem" href="${url}">Fixture Claude release</a></li>`).join('')}</ul></div></main></body></html>`;
export const newsroomArticle=(url:string)=>`<html><head><title>Fixture Claude release</title><link rel="canonical" href="${url}"><meta property="og:title" content="Fixture Claude release"><meta property="article:published_time" content="${fixturePublishedAt}"><script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',url,headline:'Fixture Claude release',datePublished:fixturePublishedAt,mainEntityOfPage:{'@id':url}})}</script></head><body><main><h1>Fixture Claude release</h1>Transient synthetic body. Do not persist.</main></body></html>`;
export const syntheticSourceResponses:Record<string,string>=Object.fromEntries(addedSourceFixtures.flatMap<[string,string]>(source=>{
 if(source.key==='anthropic')return [[source.feed,newsroomListing([source.url])],[source.url,newsroomArticle(source.url)]];
 const title=`Fixture AI news from ${source.name}`;
 if(source.key==='the-verge')return [[source.feed,`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>${title}</title><link rel="self" href="${source.feed}"/><link rel="alternate" type="text/html" href="${source.url}"/><published>${fixturePublishedAt}</published><updated>2026-10-11T12:00:00Z</updated></entry></feed>`]];
 const articleUrl=source.key==='bair'?source.url.replace('https:','http:'):source.url;
 return [[source.feed,`<rss><channel><item><title>${title}</title><link>${articleUrl}</link><pubDate>${fixturePublishedAt}</pubDate><description>Transient feed content. Do not persist.</description></item></channel></rss>`]];
}));
