import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSourceImage, extractFeedImage } from '../src/lib/editorial/source';
import { safeImageUrl, validateImageUpload, MAX_IMAGE_BYTES, validFeaturedWeek } from '../src/lib/editorial/images';

test('article image selection prioritizes publisher metadata and resolves safe relative URLs', () => {
 const base = 'https://openai.com/news/story';
 assert.equal(extractSourceImage('<meta property="og:image" content="/assets/hero.jpg"><article><img src="/inline.jpg"></article>',base),'https://openai.com/assets/hero.jpg');
 assert.equal(extractSourceImage('<meta property="og:image" content="javascript:alert(1)"><meta name="twitter:image" content="https://cdn.example.com/hero.png">',base),'https://cdn.example.com/hero.png');
 assert.equal(extractSourceImage('<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","image":{"url":"/hero.webp"}}]}</script>',base),'https://openai.com/hero.webp');
 assert.equal(extractSourceImage('<article><img data-src="//cdn.example.com/image.jpg"></article>',base),'https://cdn.example.com/image.jpg');
 assert.equal(extractSourceImage('<header><img src="/logo.png"></header>',base),null);
 for (const url of ['javascript:alert(1)','data:image/png;base64,x','http://example.com/x','https://127.0.0.1/x','https://[::1]/x','https://localhost/x','https://host.internal/x','https://user:pass@example.com/x','https://example.com:444/x']) assert.equal(safeImageUrl(url),null,url);
});

test('feed image selection supports media, image enclosures, and article HTML without selecting audio', () => {
 const base='https://openai.com/news/story';
 assert.equal(extractFeedImage({'media:content':{'@_url':'https://cdn.example.com/main.jpg','@_medium':'image'}},base),'https://cdn.example.com/main.jpg');
 assert.equal(extractFeedImage({enclosure:[{'@_type':'audio/mpeg','@_url':'https://cdn.example.com/audio.mp3'},{'@_type':'image/png','@_url':'/image.png'}]},base),'https://openai.com/image.png');
 assert.equal(extractFeedImage({'content:encoded':'<p>Story</p><img src="/hero.png">'},base),'https://openai.com/hero.png');
 assert.equal(extractFeedImage({enclosure:{'@_type':'audio/mpeg','@_url':'https://cdn.example.com/audio.mp3'}},base),null);
 assert.equal(extractFeedImage({'media:content':{'@_type':'video/mp4','@_url':'https://cdn.example.com/video.mp4'},'media:thumbnail':{'@_url':'/video-poster.jpg'}},base),'https://openai.com/video-poster.jpg');
});

test('uploads require bounded raster bytes and matching MIME, and featured weeks must be real Mondays', async () => {
 const png=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
 assert.equal((await validateImageUpload(new File([png],'photo.png',{type:'image/png'}))).extension,'png');
 await assert.rejects(validateImageUpload(new File(['<svg onload="alert(1)"/>'],'photo.png',{type:'image/png'})),/valid JPEG/);
 await assert.rejects(validateImageUpload(new File([png],'photo.jpg',{type:'image/jpeg'})),/valid JPEG/);
 await assert.rejects(validateImageUpload(new File([new Uint8Array(MAX_IMAGE_BYTES+1)],'large.png',{type:'image/png'})),/3 MB/);
 assert.equal(validFeaturedWeek('2026-10-05'),true);assert.equal(validFeaturedWeek(null),true);
 for (const date of ['2026-10-04','2026-02-30','2026-10-05T00:00:00Z','']) assert.equal(validFeaturedWeek(date),false);
});
