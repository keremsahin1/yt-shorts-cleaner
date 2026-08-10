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

// Every clause must be anchored to a /shorts/ link. `yt-lockup-view-model` is
// YouTube's *generic* video lockup — unconstrained it matches ordinary videos
// too, which silently shredded 368 real history entries between Jun–Jul 2026.
const SHORTS_SELECTOR = [
  'ytm-shorts-lockup-view-model-v2',
  'ytd-video-renderer:has(a[href*="/shorts/"])',
  'yt-lockup-view-model:has(a[href*="/shorts/"])',
].join(', ');
const REMOVE_BUTTON_SELECTOR = '[role="menuitem"]:has-text("Remove from watch history"), tp-yt-paper-item:has-text("Remove from watch history"), .yt-list-item-view-model__container--tappable:has-text("Remove from watch history"), ytd-menu-service-item-renderer:has-text("Remove from watch history")';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  // Only echo to stdout interactively — under a scheduler stdout is redirected
  // into LOG_FILE, so echoing there would write every line twice.
  if (process.stdout.isTTY) console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function isShortsLink(href) {
  return typeof href === 'string' && href.includes('/shorts/');
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

  // The Shorts tab is a hard precondition, not best-effort. Without it we are
  // looking at the unfiltered history feed, and anything we delete there is
  // ordinary watch history. Abort rather than operate on the wrong page.
  const shortsTab = page.locator('button[role="tab"]:has-text("Shorts")').first();
  const tabVisible = await shortsTab
    .waitFor({ state: 'visible', timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (!tabVisible) {
    throw new Error(
      'Shorts tab not found on the history page — refusing to run against unfiltered history'
    );
  }

  await shortsTab.click();
  await page.waitForTimeout(1500);
  await page.locator('tp-yt-paper-spinner-lite').first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);

  await scrollToLoadAll(page);
}

async function deleteShorts(page, { dryRun = false } = {}) {
  let totalDeleted = 0;
  let skippedNonShorts = 0;

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
        const hrefs = await entry.locator('a[href]').evaluateAll(
          els => els.map(el => el.getAttribute('href'))
        ).catch(() => []);
        const link = hrefs.find(isShortsLink);

        // Final guard before a destructive click: if this entry carries no
        // /shorts/ link, it is not a Short and must not be removed.
        if (!link) {
          skippedNonShorts++;
          log(`↷ Skipped non-Shorts entry ${i}: ${hrefs[0] || '(no link)'}`);
          continue;
        }

        if (dryRun) {
          totalDeleted++;
          deletedThisRound++;
          log(`[dry-run] Would delete Short #${totalDeleted}: ${link}`);
          continue;
        }

        // Scroll entry into view and open menu
        await entry.scrollIntoViewIfNeeded();
        const menuBtn = await getMenuButton(entry);
        await menuBtn.click({ timeout: 3000 });
        await page.waitForTimeout(800);

        // Click Remove — use evaluate to find the first *visible* match,
        // avoiding stale hidden popup elements that confuse .first()
        const removed = await page.evaluate(() => {
          const sels = ['[role="menuitem"]', 'tp-yt-paper-item',
            'ytd-menu-service-item-renderer',
            '.yt-list-item-view-model__container--tappable'];
          for (const sel of sels) {
            for (const el of document.querySelectorAll(sel)) {
              if (el.offsetParent !== null &&
                  el.textContent.includes('Remove from watch history')) {
                el.click();
                return true;
              }
            }
          }
          return false;
        });
        if (!removed) throw new Error('Remove from watch history button not found');
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

    if (dryRun) {
      log(`[dry-run] Single pass complete: ${deletedThisRound}/${count} matched entries would be deleted. Nothing was changed.`);
      break;
    }

    log(`Round done. Deleted ${deletedThisRound}/${count} this round (${totalDeleted} total). Reloading...`);

    if (deletedThisRound === 0) {
      log('No progress. Stopping.');
      break;
    }
  }

  if (skippedNonShorts > 0) {
    log(`Note: skipped ${skippedNonShorts} matched entries that carried no /shorts/ link.`);
  }

  return totalDeleted;
}

async function main() {
  const headless = process.argv.includes('--headless');
  const dryRun = process.argv.includes('--dry-run');
  log(`Starting YouTube Shorts cleaner (headless=${headless}, dryRun=${dryRun})...`);

  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless,
    args: ['--no-sandbox'],
    viewport: { width: 1280, height: 900 },
  });

  const page = browser.pages()[0] || await browser.newPage();
  const total = await deleteShorts(page, { dryRun });
  log(dryRun
    ? `✅ Dry run complete. ${total} Shorts would have been deleted.`
    : `✅ Done. Deleted ${total} Shorts total.`);

  await page.close();
  await browser.close();
}

if (require.main === module) {
  main().catch(err => {
    log(`❌ Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { scrollToLoadAll, SHORTS_SELECTOR, getMenuButton, REMOVE_BUTTON_SELECTOR, isShortsLink };
