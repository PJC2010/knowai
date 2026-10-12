import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePublisherUrl, resolvePublisherArticle } from './publisher-catalog';

/** A disabled schedule does not forbid explicit import; missing access approval does. */
export async function requireSourceAccess(db:SupabaseClient,input:string) {
  const definition=resolvePublisherArticle(input);
  if(!definition)throw new Error('Choose an article URL from a configured publisher.');
  const canonicalUrl=normalizePublisherUrl(input,definition,'article');
  const publisher=await db.from('brief_publishers').select('id,access_status').eq('catalog_key',definition.key).single();
  if(publisher.error || !publisher.data)throw new Error('The publisher access review configuration is unavailable.');
  if(publisher.data.access_status!=='approved')throw new Error('This publisher needs access review and approval before its articles can be fetched.');
  return {id:publisher.data.id as string,definition,canonicalUrl};
}
