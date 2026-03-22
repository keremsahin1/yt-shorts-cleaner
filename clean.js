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

const SHORTS_SELECTOR = 'ytm-shorts-lockup-view-model-v2, ytd-video-renderer:has(a[href*="/shorts/"]), yt-lockup-view-model';
const REMOVE_BUTTON_SELECTOR = '.yt-list-item-view-model__container--tappable:has-text("Remove from watch history"), ytd-menu-service-item-renderer:has-text("Remove from watch history")';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

async function scrollToLoadAll(page) {
  let previousCount = 0;
  while (true) {
    const currentCount = await page.locator(SHORTS_SELECTOR).count();
    if (currentCount === previousCount) break;
    previousCount = currentCount;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  }
}

async function getMenuButton(entry) {
  const moreActions = entry.locator('button[aria-label="More actions"]').first();
  if (await moreActions.count() > 0) return moreActions;
  return entry.locator('button[aria-label="Action menu"]').first();
}

async function loadHistoryPage(page) {
  await page.goto('https://www.youtube.com/feed/history', { waitUntil: 'networkidle' });
  const shortsTab = page.locator('button[role="tab"]:has-text("Shorts")').first();
  await shortsTab.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if (await shortsTab.count() > 0) {
    await shortsTab.click();
    await page.waitForTimeout(1500);
    await page.locator('tp-yt-paper-spinner-lite').first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }
  await scrollToLoadAll(page);
}

async function deleteShorts(page) {
  let totalDeleted = 0;

  while (true) {
    await loadHistoryPage(page);

    const count = await page.locator(SHORTS_SELECTOR).count();
    if (count === 0) {
      log('No more Shorts found. Done!');
      break;
    }

    log(`Found ${count} Shorts. Deleting one by one...`);
    let deletedThisRound = 0;

    for (let i = 0; i < count; i++) {
      try {
        const entry = page.locator(SHORTS_SELECTOR).nth(i);
        const link = await entry.locator('a[href]').first().getAttribute('href', { timeout: 2000 }).catch(() => '?');

        // Open menu (handles both "More actions" and "Action menu" labels)
        const menuBtn = await getMenuButton(entry);
        await menuBtn.click({ timeout: 3000 });
        await page.waitForTimeout(800);

        // Click Remove
        const removeBtn = page.locator(REMOVE_BUTTON_SELECTOR).first();
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

if (require.main === module) {
  main().catch(err => {
    log(`❌ Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { scrollToLoadAll, SHORTS_SELECTOR, getMenuButton, REMOVE_BUTTON_SELECTOR };
