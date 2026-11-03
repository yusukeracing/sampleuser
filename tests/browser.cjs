const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = new URL(process.env.SITE_TEST_URL || 'http://127.0.0.1:8100/');
const projectRoot = path.resolve(__dirname, '..');
const targets = ['index.html', 'demos/cafe.html', 'demos/builder.html', 'demos/athlete.html'];
const results = [];
const checks = [];
const errors = [];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function monitor(page) {
  page.on('pageerror', error => errors.push(`Page error: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`Console error: ${message.text()}`);
  });
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
}

async function load(page, target, capture = true) {
  const url = new URL(target, baseUrl);
  if (capture) url.searchParams.set('capture', '1');
  const response = await page.goto(url.href);
  check(response?.ok(), `Failed to load ${target}`);
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const image of document.images) image.loading = 'eager';
    await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
  });
}

async function runCheck(name, operation) {
  try {
    await operation();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false });
    errors.push(`${name}: ${error.message}`);
  }
}

async function openMenu(page) {
  const menu = page.locator('.menu');
  await menu.click();
  check(await menu.getAttribute('aria-expanded') === 'true', 'Menu did not expand');
  check(await page.locator('#nav').isVisible(), 'Expanded navigation is hidden');
}

async function checkPricingNavigation(page, width) {
  if (width <= 768) await openMenu(page);
  await page.locator('#nav a[href="#pricing"]').click();
  await page.waitForFunction(() => location.hash === '#pricing');
  if (width <= 768) {
    check(await page.locator('.menu').getAttribute('aria-expanded') === 'false',
      'Menu remained open after following the pricing link');
  }
  const position = await page.evaluate(() => {
    const heading = document.querySelector('#pricing h2').getBoundingClientRect();
    const header = document.querySelector('.header').getBoundingClientRect();
    return { headingTop: heading.top, headerBottom: header.bottom, viewport: innerHeight };
  });
  check(position.headingTop >= position.headerBottom - 2 && position.headingTop < position.viewport,
    'The pricing heading is hidden under the header or outside the viewport');
}

async function inspectLayouts(browser) {
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
    monitor(page);
    for (const target of targets) {
      await load(page, target);
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        broken: [...document.images].filter(image => !image.complete || !image.naturalWidth).map(image => image.src),
        capture: document.body.classList.contains('capture'),
      }));
      check(!state.overflow, `${target} at ${width}px has horizontal overflow`);
      check(state.broken.length === 0, `${target} at ${width}px has broken images: ${state.broken.join(', ')}`);
      check(state.capture, `Capture mode is inactive for ${target}`);
      for (const anchor of await page.locator('a[href^="#"]').all()) {
        const href = await anchor.getAttribute('href');
        if (href !== '#') check(await page.locator(href).count(), `Missing anchor ${href} in ${target}`);
      }
      if (width <= 768) {
        await runCheck(`menu / ${target} / ${width}px`, async () => {
          await openMenu(page);
          await page.keyboard.press('Escape');
          check(await page.locator('.menu').getAttribute('aria-expanded') === 'false', 'Escape did not close the menu');
          check(await page.locator('.menu').evaluate(element => document.activeElement === element),
            'Keyboard focus did not return to the menu button');
        });
      }
      await page.evaluate(() => document.activeElement.blur());
      const screenshotName = `${target.replace('demos/', '').replace('.html', '')}-${width}.png`;
      await page.screenshot({ path: path.join(projectRoot, 'screenshots', screenshotName), fullPage: true });
      results.push({ path: target, width, ...state });
      if (target === 'index.html') {
        await runCheck(`pricing navigation / ${width}px`, () => checkPricingNavigation(page, width));
      }
    }
    await page.close();
  }
}

async function inspectInteractions(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  monitor(page);
  await load(page, 'index.html');

  await runCheck('unset consultation link stays local and opens an accessible dialog', async () => {
    check(await page.evaluate(() => !window.SITE_CONFIG.coconalaUrl), 'This check expects an unset Coconala URL');
    const initialUrl = page.url();
    const requests = [];
    const recordRequest = request => requests.push(request.url());
    page.on('request', recordRequest);
    try {
      for (const button of await page.locator('.consult').all()) {
        await button.click();
        check(await page.locator('dialog').isVisible(), 'Consultation dialog did not open');
        check((await page.locator('#dialog-content').innerText()).trim().length > 0,
          'Consultation instructions are empty');
        check(page.url() === initialUrl, 'The unset consultation URL caused navigation');
        await page.keyboard.press('Escape');
        check(!await page.locator('dialog').isVisible(), 'Escape did not close the dialog');
        check(await button.evaluate(element => document.activeElement === element),
          'Dialog did not restore focus to the consultation button');
      }
      check(requests.length === 0, `Consultation triggered network requests: ${requests.join(', ')}`);
    } finally {
      page.off('request', recordRequest);
    }
  });

  await runCheck('FAQ answers can be opened and closed', async () => {
    for (const details of await page.locator('#faq details').all()) {
      const summary = details.locator('summary');
      await summary.click();
      check(await details.getAttribute('open') !== null, 'FAQ answer did not open');
      check(await details.locator('p').isVisible(), 'Open FAQ answer is hidden');
      await summary.click();
      check(await details.getAttribute('open') === null, 'FAQ answer did not close');
    }
  });

  for (const [target, group, filter, count] of [
    ['cafe', 'cafe-menu', 'drink', 2],
    ['builder', 'project-list', 'renew', 1],
    ['athlete', 'journal-list', 'race', 1],
  ]) {
    await runCheck(`category filtering / ${target}`, async () => {
      await load(page, `demos/${target}.html`);
      const total = await page.locator(`#${group} > article`).count();
      const control = page.locator(`[data-filter="${filter}"]`);
      await control.click();
      check(await control.getAttribute('aria-pressed') === 'true', 'Filter is not marked as selected');
      check(await page.locator(`#${group} > article:visible`).count() === count, 'Filter shows incorrect results');
      await page.locator('[data-filter="all"]').click();
      check(await page.locator(`#${group} > article:visible`).count() === total, 'Reset filter did not restore all items');
    });
  }

  await runCheck('demo form validates, renders input as text, clears it, and never sends', async () => {
    await load(page, 'demos/builder.html');
    const requests = [];
    const recordRequest = request => requests.push(request.url());
    page.on('request', recordRequest);
    try {
      await page.locator('form button').click();
      check(!await page.locator('dialog').isVisible(), 'Empty required input opened confirmation');
      check(!await page.locator('form').evaluate(form => form.checkValidity()), 'Empty required input was accepted');
      const input = '<img src=x onerror="window.__demoInjected=true">';
      await page.locator('[name=name]').fill(input);
      await page.locator('[name=message]').fill('架空の相談です。');
      await page.locator('form button').click();
      check(await page.locator('dialog').isVisible(), 'Form confirmation did not open');
      check((await page.locator('#dialog-content').innerText()).includes(input), 'Input was not preserved as literal text');
      check(await page.locator('#dialog-content img, #dialog-content script').count() === 0, 'Input was interpreted as HTML');
      check(!await page.evaluate(() => window.__demoInjected), 'Input executed code');
      await page.getByText('デモを完了して入力を消去').click();
      check(await page.locator('[name=name]').inputValue() === '', 'Name was not reset');
      check(await page.locator('[name=message]').inputValue() === '', 'Message was not reset');
      check(requests.length === 0, `Form triggered network requests: ${requests.join(', ')}`);
      await page.keyboard.press('Escape');
    } finally {
      page.off('request', recordRequest);
    }
  });

  for (const [target, notice] of [['cafe', 'reservation'], ['athlete', 'social'], ['athlete', 'support']]) {
    await runCheck(`local demo notice / ${notice}`, async () => {
      await load(page, `demos/${target}.html`);
      const initialUrl = page.url();
      await page.locator(`[data-notice="${notice}"]`).first().click();
      check(await page.locator('dialog').isVisible(), 'Demo notice did not open');
      check(page.url() === initialUrl, 'Demo notice navigated away');
      await page.locator('.close-dialog').click();
      check(!await page.locator('dialog').isVisible(), 'Close button did not close the demo notice');
    });
  }
  await page.close();
}

(async () => {
  await fs.mkdir(path.join(projectRoot, 'screenshots'), { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    await inspectLayouts(browser);
    await inspectInteractions(browser);
  } catch (error) {
    errors.push(error.stack || error.message);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ results, checks, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
})();
