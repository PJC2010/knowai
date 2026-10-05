import { getPublishedStories } from '@/lib/editorial/published';
import { renderBriefRss } from '@/lib/brief-rss';
import { siteUrl } from '@/lib/site-url';

export async function GET() {
  try {
    return new Response(renderBriefRss(await getPublishedStories(), siteUrl()), {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        // The existing publication reader owns the five-minute, tag-invalidated
        // data cache. Do not add another stale copy at the browser/CDN layer.
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('The published briefing feed is temporarily unavailable.', {
      status: 503,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': '300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
}
