#!/usr/bin/env node
/**
 * Run once to save your Google session.
 * Uses stealth mode so Google won't block the automated browser.
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

const path = require('path');
const readline = require('readline');

const SESSION_DIR = path.join(__dirname, 'session');

async function main() {
  console.log('Opening browser for Google sign-in (stealth mode)...\n');

  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    args: ['--no-sandbox'],
    viewport: { width: 1280, height: 900 },
  });

  const page = browser.pages()[0] || await browser.newPage();
  await page.goto('https://accounts.google.com/signin', { waitUntil: 'networkidle' });

  console.log('👉 Sign into your Google/YouTube account in the browser window.');
  console.log('   When fully signed in, press Enter here to save the session.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question('Press Enter once signed in... ', resolve));
  rl.close();

  await page.goto('https://www.youtube.com', { waitUntil: 'networkidle' });
  const loggedIn = await page.locator('button#avatar-btn').count() > 0;

  if (loggedIn) {
    console.log('\n✅ Session saved! Run clean.js for headless cleanups going forward.\n');
  } else {
    console.log('\n⚠️  Not logged in yet — try again.\n');
  }

  await browser.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
