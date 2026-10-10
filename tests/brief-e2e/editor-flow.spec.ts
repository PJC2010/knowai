import { test, expect, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function editorLogin(context: BrowserContext) {
  const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'editor@example.test',email_confirmed_at:'2026-10-04T00:00:00Z'};
  const token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:user.id,aud:'authenticated',role:'authenticated',exp:4102444800})}.editor-fixture-signature`;
  await context.addCookies([{name:'sb-127-auth-token',value:`base64-${encode({access_token:token,refresh_token:'fixture-refresh',expires_at:4102444800,expires_in:3600,token_type:'bearer',user})}`,domain:'127.0.0.1',path:'/'}]);
}

test.beforeEach(async({request,context})=>{
  await request.post('http://127.0.0.1:4310/_fixture/reset');
  await editorLogin(context);
});

test('authenticated editorial inbox and working screens fit phone and desktop widths',async({page},testInfo)=>{
  await page.goto('/editor');
  await expect(page.getByRole('link',{name:/Inbox/}).first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Connect OpenRouter',exact:true})).toHaveCount(0);
  for(const width of [320,390,430,768,1440]){
    await page.setViewportSize({width,height:900});
    for(const path of ['/editor','/editor?view=sources','/editor?view=drafts&id=10000000-0000-4000-8000-000000000001']){
      await page.goto(path);
      await expect(page.getByRole('heading',{level:1}).first()).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(width===390||width===1440){
        await page.screenshot({path:testInfo.outputPath(`editor-${width}-${path.includes('id=')?'write':path.includes('sources')?'sources':'inbox'}.png`),fullPage:true});
      }
    }
  }
});

test('phone inbox keeps a complete first story within reach without shrinking touch targets',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/editor');
  const card=page.locator('.desk-story').first();
  await expect(card).toBeVisible();
  const bounds=await card.boundingBox();
  expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(844);
  for(const element of await page.locator('.desk-filters button,.desk-filters summary,.desk-navigation a').all()) {
    expect((await element.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test('inbox selections survive navigation and dismissal can be undone',async({page})=>{
  await page.goto('/editor');
  const card=page.locator('.desk-story').first();
  const title=await card.getByRole('heading').innerText();
  await card.getByRole('button',{name:'Select story',exact:true}).click();
  await expect(page.getByRole('button',{name:/Generate selected drafts/})).toBeVisible();
  await expect(page.getByRole('region',{name:'Selected stories'})).toContainText('200-story selection limit');
  await page.goto('/editor?status=selected');
  const selected=page.locator('.desk-story').filter({has:page.getByRole('heading',{name:title,exact:true})});
  await expect(selected.getByRole('button',{name:'Deselect',exact:true})).toHaveAttribute('aria-pressed','true');
  await selected.getByRole('button',{name:'Dismiss',exact:true}).click();
  await expect(page.getByRole('button',{name:/Undo/})).toBeVisible();
  await page.getByRole('button',{name:/Undo/}).click();
  await expect(page.locator('.desk-story').filter({hasText:title})).toBeVisible();
  await page.reload();
  await expect(page.locator('.desk-story').filter({hasText:title}).getByRole('button',{name:'Deselect',exact:true})).toBeVisible();
});

test('source preview returns focus on Escape and pagination reaches stories beyond the first hundred',async({page})=>{
  await page.goto('/editor?page=5');
  await expect(page.getByRole('navigation',{name:'Story pages'})).toContainText('101–125 of 135');
  const trigger=page.getByRole('button',{name:/Source preview/}).first();
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('autosave persists edits and a concurrent editor conflict keeps local text',async({page,context})=>{
  const path='/editor?view=drafts&id=10000000-0000-4000-8000-000000000001';
  await page.goto(path);
  const other=await context.newPage();
  await other.goto(path);
  await expect(other.getByRole('textbox',{name:'Why it matters',exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'Why it matters',exact:true}).fill('First editor saved this private change.');
  await expect(page.locator('.desk-work-actions')).toContainText('Version 2');
  await expect(page.locator('.desk-work-actions')).toContainText('All changes saved');
  await other.getByRole('textbox',{name:'Why it matters',exact:true}).fill('Second editor has unsaved text to keep.');
  await expect(other.locator('.desk-save-error[role=alert]')).toContainText('A newer version was saved elsewhere.');
  await expect(other.getByRole('textbox',{name:'Why it matters',exact:true})).toHaveValue('Second editor has unsaved text to keep.');
  await expect(other.getByRole('button',{name:'Approve and publish',exact:true})).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('textbox',{name:'Why it matters',exact:true})).toHaveValue('First editor saved this private change.');
  await other.close();
});

test('evidence links highlight exact text and edits invalidate final review',async({page})=>{
  await page.goto('/editor?view=drafts&id=10000000-0000-4000-8000-000000000001');
  await page.getByRole('tab',{name:/Evidence/}).click();
  await page.getByRole('button',{name:/Show excerpt/}).first().click();
  await expect(page.getByRole('dialog').locator('mark[data-current="true"]')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Text matching does not verify factual accuracy.');
  await page.keyboard.press('Escape');
  await page.getByRole('tab',{name:'Preview',exact:true}).click();
  await page.getByRole('button',{name:'Deep',exact:true}).click();
  await expect(page.locator('.brief-full')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('knowai-reader'))).toBeNull();
  await expect(page.locator('.brief-new, .brief-read')).toHaveCount(0);
  await page.getByRole('button',{name:'Start final review',exact:true}).click();
  const source=page.getByLabel('I checked the original source and the factual claims.');
  const tiers=page.getByLabel('I reviewed all three standalone versions, including the one-liner’s tone.');
  await source.check(); await tiers.check();
  await expect(page.getByRole('button',{name:'Approve and publish',exact:true})).toBeEnabled();
  await page.getByRole('tab',{name:'Write',exact:true}).click();
  await page.getByRole('textbox',{name:'Why it matters',exact:true}).fill('A new edit must receive a fresh source review.');
  await expect(source).not.toBeChecked(); await expect(tiers).not.toBeChecked();
  await expect(page.getByRole('button',{name:'Approve and publish',exact:true})).toBeDisabled();
  await expect(page.locator('.desk-work-actions')).toContainText('All changes saved');
});

test('publisher controls persist and automatic drafting requires explicit charge consent',async({page})=>{
  await page.goto('/editor?view=sources');
  const publisher=page.locator('.desk-publisher').filter({has:page.getByRole('heading',{name:'OpenAI',exact:true})});
  await publisher.getByRole('switch').click();
  await expect(publisher.getByRole('switch')).not.toBeChecked();
  await page.reload();
  await expect(publisher.getByRole('switch')).not.toBeChecked();
  const automatic=page.getByRole('switch',{name:'Automatic drafting',exact:true});
  await expect(automatic).not.toBeChecked();
  await automatic.click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('button',{name:'Enable automatic drafting',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(automatic).not.toBeChecked();
  await automatic.click();
  await dialog.getByLabel('I understand this may incur model charges.').check();
  await dialog.getByRole('button',{name:'Enable automatic drafting',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(automatic).toBeChecked();
  await automatic.click();
  await expect(automatic).not.toBeChecked();
  await page.getByRole('textbox',{name:'Article URL',exact:true}).fill('https://127.0.0.1/private');
  await page.getByRole('button',{name:'Import to inbox',exact:true}).click();
  await expect(page.locator('.desk-feedback[role=alert]')).toBeVisible();
});

test('draft fields stay read-only until hydration and preserve the first edit',async({page})=>{
  let releaseScripts!:()=>void;
  const scriptsReady=new Promise<void>(resolve=>{releaseScripts=resolve;});
  let heldScripts=0;
  await page.route('**/_next/static/**/*.js',async route=>{
    heldScripts++;
    await scriptsReady;
    await route.continue();
  });
  const why=page.getByRole('textbox',{name:'Why it matters',exact:true});
  try {
    await page.goto('/editor?view=drafts&id=10000000-0000-4000-8000-000000000001',{waitUntil:'commit'});
    await expect(why).toBeVisible();
    await expect.poll(()=>heldScripts).toBeGreaterThan(0);
    await expect(why).not.toBeEditable();
  } finally {
    releaseScripts();
  }
  await expect(why).toBeEditable();
  await why.fill('The first edit after hydration must replace the original text.');
  await expect(why).toHaveValue('The first edit after hydration must replace the original text.');
  await expect(page.locator('.desk-work-actions')).toContainText('Version 2');
  await page.reload();
  await expect(why).toHaveValue('The first edit after hydration must replace the original text.');
});

test('history shows the latest save and restores it as a new private draft',async({page})=>{
  await page.goto('/editor?view=drafts&id=10000000-0000-4000-8000-000000000001');
  const why=page.getByRole('textbox',{name:'Why it matters',exact:true});
  await why.fill('A first correction worth preserving in revision history.');
  await expect(why).toHaveValue('A first correction worth preserving in revision history.');
  await expect(page.locator('.desk-work-actions')).toContainText('Version 2');
  await expect(why).toHaveValue('A first correction worth preserving in revision history.');
  await why.fill('A second correction for comparison.');
  await expect(why).toHaveValue('A second correction for comparison.');
  await expect(page.locator('.desk-work-actions')).toContainText('Version 3');
  const publicBefore=await (await page.request.get('/api/brief')).text();
  await page.getByRole('button',{name:'Revision history',exact:true}).click();
  const entry=page.getByRole('dialog').locator('details').filter({hasText:/Version 2 ·/});
  await entry.locator('summary').click();
  await expect(entry).toContainText('A first correction worth preserving in revision history.');
  await expect(entry).toContainText('A second correction for comparison.');
  await entry.getByRole('button',{name:'Restore as new draft',exact:true}).click();
  await expect(page).not.toHaveURL(/id=10000000-0000-4000-8000-000000000001/);
  await expect(why).toHaveValue('A first correction worth preserving in revision history.');
  expect(await (await page.request.get('/api/brief')).text()).toBe(publicBefore);
});

test('failed saves retain text and prevent leaving until the editor chooses to discard',async({page,request})=>{
  await page.goto('/editor?view=drafts&id=10000000-0000-4000-8000-000000000001');
  await request.post('http://127.0.0.1:4310/_fixture/save-behavior',{data:{failure:'network'}});
  const why=page.getByRole('textbox',{name:'Why it matters',exact:true});
  await why.fill('Private work must survive a failed save.');
  await expect(page.locator('.desk-save-error')).toContainText('Draft not saved.');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByRole('button',{name:'← Back to queue',exact:true}).click();
  await expect(why).toHaveValue('Private work must survive a failed save.');
  await request.post('http://127.0.0.1:4310/_fixture/save-behavior',{data:{failure:'none'}});
  await page.getByRole('button',{name:'Retry save',exact:true}).click();
  await expect(page.locator('.desk-work-actions')).toContainText('All changes saved');
  await page.reload();
  await expect(why).toHaveValue('Private work must survive a failed save.');
});

test('discarding changes cancels a pending autosave while navigation is delayed',async({page})=>{
  const path='/editor?view=drafts&id=10000000-0000-4000-8000-000000000001';
  await page.goto(path);
  const why=page.getByRole('textbox',{name:'Why it matters',exact:true});
  const original=await why.inputValue();
  await page.route('**/editor?view=drafts&*',async route=>{
    if(new URL(route.request().url()).searchParams.has('id')) return route.continue();
    await new Promise(resolve=>setTimeout(resolve,1600));
    await route.continue();
  });
  const clockTime=new Date();
  await page.clock.install({time:clockTime});
  // Installation starts the clock ticking; pause at a future instant, not
  // the already elapsed installation time. All edits happen after this pause.
  await page.clock.pauseAt(new Date(clockTime.getTime()+60_000));
  await why.fill('This text is intentionally discarded.');
  page.once('dialog',async dialog=>{expect(dialog.type()).toBe('confirm');await dialog.accept();});
  await page.getByRole('button',{name:'← Back to queue',exact:true}).click();
  await page.clock.runFor(1200);
  await expect(page).toHaveURL(/view=drafts(?!.*id=)/);
  await page.clock.resume();
  await expect(page.getByRole('heading',{name:'Make it worth reading.',exact:true})).toBeVisible();
  await page.unrouteAll({behavior:'wait'});
  await page.goto(path);
  await expect(why).toHaveValue(original);
});

test('generation consent does not claim a paid attempt when configuration is missing',async({page})=>{
  await page.goto('/editor');
  await page.getByRole('button',{name:'Select story',exact:true}).first().click();
  await page.getByRole('button',{name:'Generate selected drafts',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('button',{name:'Confirm generation',exact:true})).toBeDisabled();
  await dialog.getByLabel('I understand this may incur model charges.').check();
  await dialog.getByRole('button',{name:'Confirm generation',exact:true}).click();
  await expect(dialog).toContainText('Set the dedicated editorial OpenRouter key');
  await expect(dialog).toContainText('0 of 10 model attempts used');
});

test('editor inbox and source settings pass automated accessibility checks',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  for(const path of ['/editor','/editor?view=sources','/editor?view=drafts&id=10000000-0000-4000-8000-000000000001']){
    await page.goto(path);
    await expect(page.getByRole('heading',{level:1}).first()).toBeVisible();
    const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
  }
});
