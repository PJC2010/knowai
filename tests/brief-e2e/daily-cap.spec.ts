import {test, expect, type BrowserContext, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function login(context: BrowserContext) {
  const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'editor@example.test',email_confirmed_at:'2026-10-04T00:00:00Z'};
  const token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:user.id,aud:'authenticated',role:'authenticated',exp:4102444800})}.editor-fixture-signature`;
  await context.addCookies([{name:'sb-127-auth-token',value:`base64-${encode({access_token:token,refresh_token:'fixture-refresh',expires_at:4102444800,expires_in:3600,token_type:'bearer',user})}`,domain:'127.0.0.1',path:'/'}]);
}

test.beforeEach(async({context,request})=>{
  expect((await request.post('http://127.0.0.1:4310/_fixture/reset')).ok()).toBe(true);
  await login(context);
});

test('daily cap is configurable with explicit increase consent and persists without changing automatic drafting',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/editor?view=sources');
  const limit=page.getByRole('spinbutton',{name:'Daily model attempt limit',exact:true});
  await expect(limit).toHaveValue('10');
  await expect(limit).toHaveAttribute('min','1');
  await expect(limit).toHaveAttribute('max','1000');
  await limit.fill('25');
  await page.getByRole('button',{name:'Save daily limit',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Increase daily model limit?'});
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('25');
  await expect(dialog.getByRole('button',{name:'Confirm limit increase',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.reload();
  await expect(limit).toHaveValue('10');
  await limit.fill('25');
  await page.getByRole('button',{name:'Save daily limit',exact:true}).click();
  await dialog.getByLabel('I understand a higher limit may increase model charges.').check();
  await dialog.getByRole('button',{name:'Confirm limit increase',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.desk-status-line')).toContainText('0 / 25 attempts today');
  await page.reload();
  await expect(limit).toHaveValue('25');
  await page.locator('#daily-limit').screenshot({path:testInfo.outputPath('phone-daily-limit.png')});
  expect((await new AxeBuilder({page}).include('.editor-desk').analyze()).violations).toEqual([]);
  await expect(page.getByRole('switch',{name:'Automatic drafting',exact:true})).not.toBeChecked();
  await limit.fill('5');
  await page.getByRole('button',{name:'Save daily limit',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.desk-status-line')).toContainText('0 / 5 attempts today');
  await page.reload();
  await expect(limit).toHaveValue('5');
});

test('raising an exhausted cap re-enables selected generation without resetting attempts',async({page,request},testInfo)=>{
  expect((await request.post('http://127.0.0.1:4310/_fixture/attempts',{data:{count:10}})).ok()).toBe(true);
  await page.goto('/editor');
  await page.getByRole('button',{name:'Select story',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Generate selected drafts',exact:true})).toBeDisabled();
  const notice=page.getByRole('status').filter({hasText:'Daily limit reached.'});
  await expect(notice).toContainText('00:00 UTC');
  await notice.getByRole('link',{name:'Change daily limit',exact:true}).click();
  await page.getByRole('spinbutton',{name:'Daily model attempt limit',exact:true}).fill('25');
  await page.getByRole('button',{name:'Save daily limit',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('I understand a higher limit may increase model charges.').check();
  await dialog.getByRole('button',{name:'Confirm limit increase',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await page.goto('/editor?status=selected');
  await expect(page.locator('.desk-status-line')).toContainText('10 / 25 attempts today');
  await expect(page.getByRole('button',{name:'Generate selected drafts',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Generate selected drafts',exact:true}).click();
  await expect(dialog).toContainText('10 of 25 model attempts used');
  await expect(dialog).toContainText('15 remaining');
  await page.screenshot({path:testInfo.outputPath('raised-limit-generation.png')});
  await dialog.getByLabel('I understand this may incur model charges.').check();
  await expect(dialog.getByRole('button',{name:'Confirm generation',exact:true})).toBeEnabled();
  // Deliberately do not fund a model call. The fixture has no provider key.
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.goto('/editor?view=drafts&id=10000000-0000-4000-8000-000000000001');
  await page.getByRole('button',{name:'Generate a new draft',exact:true}).click();
  await expect(dialog).toContainText('10 of 25 model attempts used');
  await dialog.getByLabel('I understand this may incur a model charge.').check();
  await expect(dialog.getByRole('button',{name:'Confirm generation',exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:/Suggest a rewrite/}).first().click();
  await expect(dialog).toContainText('10 of 25 model attempts used');
  await dialog.getByLabel('I understand this suggestion may incur a model charge.').check();
  await expect(dialog.getByRole('button',{name:'Generate suggestion',exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.goto('/editor?view=sources');
  await page.getByRole('spinbutton',{name:'Daily model attempt limit',exact:true}).fill('5');
  await page.getByRole('button',{name:'Save daily limit',exact:true}).click();
  await expect(page.locator('.desk-status-line')).toContainText('10 / 5 attempts today');
  await expect(page.locator('.desk-status-line')).toContainText('0 remaining');
  await page.goto('/editor?status=selected');
  await expect(page.getByRole('button',{name:'Generate selected drafts',exact:true})).toBeDisabled();
  await page.goto('/editor?view=drafts&id=10000000-0000-4000-8000-000000000001');
  await page.getByRole('button',{name:'Generate a new draft',exact:true}).click();
  await expect(dialog).toContainText('10 of 5 model attempts used');
  await dialog.getByLabel('I understand this may incur a model charge.').check();
  await expect(dialog.getByRole('button',{name:'Confirm generation',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:/Suggest a rewrite/}).first().click();
  await dialog.getByLabel('I understand this suggestion may incur a model charge.').check();
  await expect(dialog.getByRole('button',{name:'Generate suggestion',exact:true})).toBeDisabled();
});

// Gate the real action request rather than relying on a timer or a fabricated response.
async function holdLimitSave(page: Page, fail = false) {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pattern = '**/editor?view=sources';
  await page.route(pattern, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    calls++;
    await gate;
    return fail ? route.abort('failed') : route.continue();
  });
  return {
    calls: () => calls,
    release,
    async dispose() { release(); await page.unrouteAll({behavior:'wait'}); },
  };
}

test('pending limit increase disables all controls, blocks dismissal and submits only once',async({page})=>{
  await page.goto('/editor?view=sources');
  const input=page.locator('#daily-attempt-limit');
  const save=page.locator('#daily-limit form button');
  await input.fill('25');
  await save.click();
  const dialog=page.getByRole('dialog',{name:'Increase daily model limit?'});
  const consent=dialog.getByLabel('I understand a higher limit may increase model charges.');
  await consent.check();
  const held=await holdLimitSave(page);
  try {
    await dialog.getByRole('button',{name:'Confirm limit increase',exact:true}).click();
    await expect.poll(held.calls).toBe(1);
    await expect(input).toBeDisabled();
    await expect(save).toBeDisabled();
    await expect(consent).toBeDisabled();
    const saving=dialog.getByRole('button',{name:'Saving limit…',exact:true});
    await expect(saving).toBeDisabled();
    await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeDisabled();
    await expect(dialog.getByRole('button',{name:'Close dialog',exact:true})).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.locator('.desk-dialog-overlay').click({position:{x:5,y:5},force:true});
    await expect(dialog).toBeVisible();
    // Native repeated input must not queue another action behind the held one.
    await saving.click({force:true});
    await page.keyboard.press('Enter');
    await expect(page.locator('.desk-status-line')).toContainText('0 / 10 attempts today');
    expect(held.calls()).toBe(1);
    held.release();
    await expect(dialog).toHaveCount(0);
    await expect(input).toBeEnabled();
    await expect(save).toBeEnabled();
    await expect(page.locator('.desk-status-line')).toContainText('0 / 25 attempts today');
    // Next dispatches actions serially: drain the queue before checking duplicates.
    await page.waitForLoadState('networkidle');
    expect(held.calls()).toBe(1);
  } finally { await held.dispose(); }
  await page.reload();
  await expect(input).toHaveValue('25');
});

test('pending limit decrease prevents duplicate form submissions and keeps the old receipt until saved',async({page})=>{
  await page.goto('/editor?view=sources');
  const input=page.getByRole('spinbutton',{name:'Daily model attempt limit',exact:true});
  const save=page.getByRole('button',{name:'Save daily limit',exact:true});
  await input.fill('5');
  const held=await holdLimitSave(page);
  try {
    await save.click();
    await expect.poll(held.calls).toBe(1);
    await expect(input).toBeDisabled();
    await expect(save).toBeDisabled();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.desk-status-line')).toContainText('0 / 10 attempts today');
    await save.click({force:true});
    // Exercises the synchronous pending guard even if a submit event is dispatched.
    await page.locator('#daily-limit form').evaluate((form:HTMLFormElement)=>form.requestSubmit());
    held.release();
    await expect(input).toBeEnabled();
    await expect(save).toBeEnabled();
    await expect(page.locator('.desk-status-line')).toContainText('0 / 5 attempts today');
    await page.waitForLoadState('networkidle');
    expect(held.calls()).toBe(1);
  } finally { await held.dispose(); }
  await page.reload();
  await expect(input).toHaveValue('5');
});

test('failed pending limit increase restores controls without reporting a saved higher allowance',async({page})=>{
  await page.goto('/editor?view=sources');
  const input=page.locator('#daily-attempt-limit');
  const save=page.locator('#daily-limit form button');
  await input.fill('25');
  await save.click();
  const dialog=page.getByRole('dialog',{name:'Increase daily model limit?'});
  const consent=dialog.getByLabel('I understand a higher limit may increase model charges.');
  await consent.check();
  const held=await holdLimitSave(page,true);
  try {
    await dialog.getByRole('button',{name:'Confirm limit increase',exact:true}).click();
    await expect.poll(held.calls).toBe(1);
    await expect(input).toBeDisabled();
    await expect(consent).toBeDisabled();
    held.release();
    await expect(dialog.getByRole('alert')).toContainText('Could not complete the request. Check your connection and try again.');
    await expect(dialog).toBeVisible();
    await expect(input).toBeEnabled();
    await expect(save).toBeEnabled();
    await expect(consent).toBeEnabled();
    await expect(dialog.getByRole('button',{name:'Confirm limit increase',exact:true})).toBeEnabled();
    await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeEnabled();
    await expect(dialog.getByRole('button',{name:'Close dialog',exact:true})).toBeEnabled();
    await expect(page.locator('.desk-status-line')).toContainText('0 / 10 attempts today');
    expect(held.calls()).toBe(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  } finally { await held.dispose(); }
  await page.reload();
  await expect(input).toHaveValue('10');
});

test('daily-limit inputs reject invalid values and failed saves never report success',async({page})=>{
  await page.goto('/editor?view=sources');
  const input=page.getByRole('spinbutton',{name:'Daily model attempt limit',exact:true});
  for(const value of ['0','1001','2.5','']){
    await input.fill(value);
    await page.getByRole('button',{name:'Save daily limit',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await input.evaluate((node:HTMLInputElement)=>node.validity.valid)).toBe(false);
    await expect(page.locator('.desk-status-line')).toContainText('0 / 10 attempts today');
  }
  await page.route('**/editor?view=sources',async route=>{
    if(route.request().method()==='POST')return route.abort('failed');
    return route.continue();
  });
  await input.fill('5');
  await page.getByRole('button',{name:'Save daily limit',exact:true}).click();
  await expect(page.locator('#daily-limit [role=alert]')).toContainText('Could not complete the request. Check your connection and try again.');
  await expect(input).toHaveValue('5');
  await expect(page.locator('.desk-status-line')).toContainText('0 / 10 attempts today');
  await page.unroute('**/editor?view=sources');
  await page.reload();
  await expect(input).toHaveValue('10');
});
