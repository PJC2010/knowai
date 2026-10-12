import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const fixture='http://127.0.0.1:4310';
const actor='11111111-1111-4111-8111-111111111111';
const consoleErrors=new WeakMap<Page,string[]>();
async function login(page:Page) {
 const expires=Math.floor(Date.now()/1000)+3600;
 const token=Buffer.from(JSON.stringify({access_token:`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:actor,email:'editor@example.test',role:'authenticated',aud:'authenticated',exp:expires})).toString('base64url')}.editor-fixture-signature`,refresh_token:'fixture-refresh',expires_at:expires,expires_in:3600,token_type:'bearer',user:{id:actor,email:'editor@example.test'}})).toString('base64url');
 await page.context().addCookies([{name:'sb-127-auth-token',value:`base64-${token}`,domain:'127.0.0.1',path:'/'}]);
 const errors:string[]=[];consoleErrors.set(page,errors);page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(`console.error: ${message.text()}`);});
}
async function scenario(page:Page,name='normal',keys?:string[]) {
 const response=await page.request.post(fixture+'/_fixture/discovery',{data:{scenario:name,keys}});expect(response.ok()).toBe(true);
}
async function stats(page:Page) {return (await page.request.get(fixture+'/_fixture/discovery-stats')).json();}
async function noOverflow(page:Page) {expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
async function screenshot(page:Page,name:string) {
 const folder='.unlazy/knowai-sources/screenshots';await mkdir(folder,{recursive:true});await page.screenshot({path:`${folder}/${name}.png`,fullPage:false});
}
for(const width of [1440,390])test.describe(`expanded sources ${width}px`,()=>{
 test.use({viewport:{width,height:900},hasTouch:width===390});
 test.beforeEach(async({page})=>{await login(page);});
 test.afterEach(async({page})=>{expect(consoleErrors.get(page)||[]).toEqual([]);});
 test('catalog exposes truthful newsroom links and non-bypassable review states',async({page})=>{
  await scenario(page,'review');await page.goto('/editor?view=sources');
  await expect(page.getByRole('article')).toHaveCount(17);
  const anthropic=page.getByRole('article',{name:'Anthropic',exact:true});
  await expect(anthropic.getByRole('link',{name:/^Newsroom / })).toHaveAttribute('href','https://www.anthropic.com/news');
  await expect(anthropic.getByRole('link',{name:/feed/i})).toHaveCount(0);
  await expect(anthropic.getByRole('switch')).not.toBeChecked();await expect(anthropic.getByRole('switch')).toBeDisabled();
  await expect(anthropic.getByRole('button',{name:'Refresh Anthropic',exact:true})).toBeDisabled();
  await expect(anthropic).toContainText('Not checked');await expect(anthropic).toContainText(/review/i);
  await expect(page.getByRole('article',{name:'The Decoder',exact:true})).toContainText(/blocked/i);
  await expect(page.getByRole('switch',{name:'Automatic drafting'})).not.toBeChecked();
  await noOverflow(page);await anthropic.scrollIntoViewIfNeeded();await screenshot(page,`sources-review-${width}`);
 });
 test('provenance explanations open by keyboard and pointer or touch',async({page})=>{
  await scenario(page,'review');await page.goto('/editor?view=sources');
  for(const [name,caveat] of [
   ['Anthropic','First-party company news, not independent corroboration.'],
   ['Microsoft Research','Research from a lab or institution, not necessarily peer-reviewed.'],
   ['The Decoder','Reporting and analysis. Check the original article and its sources.'],
  ]) {
   const card=page.getByRole('article',{name,exact:true});
   const summary=card.locator('summary.desk-source-kind');
   const explanation=card.locator('.desk-source-provenance > p');
   await expect(explanation).toHaveText(caveat);await expect(explanation).toBeHidden();
   await summary.focus();await page.keyboard.press('Shift+Tab');await expect(summary).not.toBeFocused();
   await page.keyboard.press('Tab');await expect(summary).toBeFocused();
   await page.keyboard.press('Enter');await expect(explanation).toBeVisible();
   await page.keyboard.press('Space');await expect(explanation).toBeHidden();
   if(width===390)await summary.tap();else await summary.click();
   await expect(explanation).toBeVisible();await noOverflow(page);
   if(width===390)await summary.tap();else await summary.click();
   await expect(explanation).toBeHidden();
  }
 });
 test('one source refresh persists metadata, deduplicates, and respects enabled state without drafting',async({page})=>{
  await scenario(page,'normal',['anthropic','mistral']);const before=await stats(page);await page.goto('/editor?view=sources');
  const anthropic=page.getByRole('article',{name:'Anthropic',exact:true});
  await anthropic.getByRole('button',{name:'Refresh Anthropic',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:/1 new stor.*discovered/})).toBeVisible();
  await expect(anthropic).toContainText(/New.*1|1.*new/i);
  let after=await stats(page);expect(after.sources-before.sources).toBe(1);expect(after.requests.every((u:string)=>u.startsWith('https://www.anthropic.com/news'))).toBe(true);
  await anthropic.getByRole('button',{name:'Refresh Anthropic',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:/0 new stories discovered/})).toBeVisible();
  after=await stats(page);expect(after.sources-before.sources).toBe(1);expect(after.requests.filter((u:string)=>u==='https://www.anthropic.com/news/fixture-ai-news')).toHaveLength(1);
  for(const key of ['jobs','revisions','publications'])expect(after[key]).toBe(before[key]);
  const mistral=page.getByRole('article',{name:'Mistral',exact:true});await mistral.getByRole('switch').uncheck();
  await expect.poll(async()=> (await stats(page)).publishers.find((p:{catalog_key:string})=>p.catalog_key==='mistral').enabled).toBe(false);
  await expect(mistral.getByRole('button',{name:'Refresh Mistral',exact:true})).toBeDisabled();
  await anthropic.scrollIntoViewIfNeeded();await noOverflow(page);await screenshot(page,`sources-health-${width}`);
 });
 test('refresh all filters by source type and publisher across direct URLs, reloads, navigation and preview',async({page})=>{
  const expectResearchStories=async()=>{
   await expect(page).toHaveURL(/sourceKind=research/);await expect(page.getByRole('combobox',{name:'Source type',exact:true})).toHaveValue('research');
   await expect(page.locator('.desk-story')).toHaveCount(2);await expect(page.getByRole('navigation',{name:'Story pages'})).toContainText('of 2');
   await expect(page.getByRole('heading',{name:'Fixture AI news from Microsoft Research'})).toBeVisible();await expect(page.getByRole('heading',{name:'Fixture AI news from Berkeley BAIR'})).toBeVisible();
  };
  await scenario(page);const before=await stats(page);await page.goto('/editor');
  await page.getByRole('button',{name:'Refresh sources',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'10 new stories discovered'})).toBeVisible();
  await page.getByText('Filters',{exact:true}).click();await page.getByRole('combobox',{name:'Source type',exact:true}).selectOption('research');
  await page.getByRole('button',{name:'Apply filters'}).click();await expectResearchStories();
  await page.goto('/editor?view=inbox&sourceKind=research');await expectResearchStories();
  await page.reload();await expectResearchStories();
  await page.getByRole('combobox',{name:'Publisher',exact:true}).selectOption({label:'Microsoft Research'});await page.getByRole('button',{name:'Apply filters'}).click();
  await expect(page.locator('.desk-story')).toHaveCount(1);await expect(page).toHaveURL(/sourceKind=research/);
  const publisher=await page.getByRole('combobox',{name:'Publisher',exact:true}).inputValue();expect(publisher).not.toBe('');
  const navigation=page.getByRole('navigation',{name:'Editorial navigation'});
  await navigation.getByRole('link',{name:'Sources',exact:true}).click();
  await expect(page).toHaveURL(url=>url.searchParams.get('view')==='sources'&&url.searchParams.get('sourceKind')==='research'&&url.searchParams.get('publisher')===publisher);
  await expect(page.getByRole('heading',{name:'Publisher settings',exact:true})).toBeVisible();
  await navigation.getByRole('link',{name:/^Inbox/}).click();
  await expect(page).toHaveURL(url=>url.searchParams.get('view')==='inbox'&&url.searchParams.get('sourceKind')==='research'&&url.searchParams.get('publisher')===publisher);
  await expect(page.getByRole('combobox',{name:'Source type',exact:true})).toHaveValue('research');await expect(page.getByRole('combobox',{name:'Publisher',exact:true})).toHaveValue(publisher);
  await expect(page.locator('.desk-story')).toHaveCount(1);await expect(page.getByRole('navigation',{name:'Story pages'})).toContainText('of 1');
  await expect(page.getByRole('heading',{name:'Fixture AI news from Microsoft Research'})).toBeVisible();
  await page.getByRole('button',{name:'Source preview'}).click();const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('link',{name:/Read original source/})).toHaveAttribute('href','https://www.microsoft.com/en-us/research/blog/fixture-ai-research/');
  await expect(dialog).toContainText('2026-10-01');await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(page).toHaveURL(/sourceKind=research/);
  await page.getByRole('button',{name:'Select story',exact:true}).click();await expect(page.getByRole('region',{name:'Selected stories'})).toContainText('1 story selected');
  const after=await stats(page);expect(after.sources-before.sources).toBe(10);for(const key of ['jobs','revisions','publications'])expect(after[key]).toBe(before[key]);
  await noOverflow(page);await screenshot(page,`sources-filter-${width}`);
 });
 for(const failure of ['throttled','malformed'])test(`${failure} newsroom is visibly unavailable, not a healthy empty result`,async({page})=>{
  await scenario(page,failure,['anthropic']);await page.goto('/editor?view=sources');
  const anthropic=page.getByRole('article',{name:'Anthropic',exact:true});await anthropic.getByRole('button',{name:'Refresh Anthropic',exact:true}).click();
  await expect(anthropic).toContainText(/unavailable/i);
  const after=await stats(page);const row=after.publishers.find((p:{catalog_key:string})=>p.catalog_key==='anthropic');expect(row.last_result.outcome).toBe('unavailable');expect(row.last_error).toBeTruthy();
  if(failure==='throttled')expect(new Date(row.retry_after).getTime()).toBeGreaterThan(Date.now());
  await anthropic.scrollIntoViewIfNeeded();await noOverflow(page);await screenshot(page,`sources-${failure}-${width}`);
 });
});
