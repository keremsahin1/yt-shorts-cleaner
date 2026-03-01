#!/usr/bin/env node
/**
 * YouTube Shorts History Cleaner
 * Iterates through all visible Shorts one by one, then reloads for the next batch.
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

const path = require('path');
const fs = require('fs');

const LOG_FILE = path.join(__dirname, 'cleaner.log');
const SESSION_DIR = path.join(__dirname, 'session');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

async function loadHistoryPage(page) {
  await page.goto('https://www.youtube.com/feed/history', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const shortsTab = page.locator('button[role="tab"]:has-text("Shorts")').first();
  if (await shortsTab.count() > 0) {
    await shortsTab.click();
    await page.waitForTimeout(1500);
  }
}

async function deleteShorts(page) {
  let totalDeleted = 0;

  while (true) {
    await loadHistoryPage(page);

    const count = await page.locator('ytm-shorts-lockup-view-model-v2').count();
    if (count === 0) {
      log('No more Shorts found. Done!');
      break;
    }

    log(`Found ${count} Shorts. Deleting one by one...`);
    let deletedThisRound = 0;

    for (let i = 0; i < count; i++) {
      try {
        const entry = page.locator('ytm-shorts-lockup-view-model-v2').nth(i);
        const link = await entry.locator('a[href*="/shorts/"]').first().getAttribute('href').catch(() => '?');

        // Open 3-dot menu
        await entry.locator('button[aria-label="More actions"]').first().click({ timeout: 3000 });
        await page.waitForTimeout(800);

        // Click Remove
        const removeBtn = page.locator('.yt-list-item-view-model__container--tappable:has-text("Remove from watch history")').first();
        await removeBtn.waitFor({ state: 'visible', timeout: 5000 });
        await removeBtn.click();
        await page.waitForTimeout(1000);

        totalDeleted++;
        deletedThisRound++;
        log(`Deleted Short #${totalDeleted}: ${link}`);
      } catch (e) {
        log(`⚠️ Skipped entry ${i}: ${e.message}`);
        await page.keyboard.press('Escape').catch(() => null);
        await page.waitForTimeout(300);
      }
    }

    log(`Round done. Deleted ${deletedThisRound}/${count} this round (${totalDeleted} total). Reloading...`);

    if (deletedThisRound === 0) {
      log('No progress. Stopping.');
      break;
    }
  }

  return totalDeleted;
}

async function main() {
  const headless = process.argv.includes('--headless');
  log(`Starting YouTube Shorts cleaner (headless=${headless})...`);

  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless,
    args: ['--no-sandbox'],
    viewport: { width: 1280, height: 900 },
  });

  const page = browser.pages()[0] || await browser.newPage();
  const total = await deleteShorts(page);
  log(`✅ Done. Deleted ${total} Shorts total.`);

  await page.close();
  await browser.close();
}

main().catch(err => {
  log(`❌ Error: ${err.message}`);
  process.exit(1);
});
