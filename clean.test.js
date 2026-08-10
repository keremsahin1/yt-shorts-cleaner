const { test } = require('node:test');
const assert = require('node:assert');

const { scrollToLoadAll, SHORTS_SELECTOR, getMenuButton, REMOVE_BUTTON_SELECTOR, isShortsLink } = require('./clean.js');

test('scrollToLoadAll stops scrolling when count stabilizes', async () => {
  const counts = [5, 10, 15, 15];
  let callIndex = 0;
  let scrollCalls = 0;

  const mockPage = {
    evaluate: async () => { scrollCalls++; },
    waitForTimeout: async () => {},
    locator: () => ({ count: async () => counts[Math.min(callIndex++, counts.length - 1)] }),
  };

  await scrollToLoadAll(mockPage);

  // Stabilized after 3rd scroll (counts went 5→10→15→15), so scrolled 3 times
  assert.strictEqual(scrollCalls, 3);
});

test('scrollToLoadAll does not scroll when already empty', async () => {
  let scrollCalls = 0;

  const mockPage = {
    evaluate: async () => { scrollCalls++; },
    waitForTimeout: async () => {},
    locator: () => ({ count: async () => 0 }),
  };

  await scrollToLoadAll(mockPage);

  assert.strictEqual(scrollCalls, 0);
});

test('SHORTS_SELECTOR covers all three Shorts entry types', () => {
  assert.ok(SHORTS_SELECTOR.includes('ytm-shorts-lockup-view-model-v2'));
  assert.ok(SHORTS_SELECTOR.includes('ytd-video-renderer'));
  assert.ok(SHORTS_SELECTOR.includes('yt-lockup-view-model'));
});

test('every generic SHORTS_SELECTOR clause is anchored to a /shorts/ link', () => {
  // Regression guard: an unconstrained `yt-lockup-view-model` clause matches
  // ordinary videos in the history feed and deletes real watch history.
  const clauses = SHORTS_SELECTOR.split(',').map(c => c.trim());
  for (const clause of clauses) {
    const isShortsSpecificTag = clause.startsWith('ytm-shorts-');
    assert.ok(
      isShortsSpecificTag || clause.includes('a[href*="/shorts/"]'),
      `clause "${clause}" matches non-Shorts entries`
    );
  }
});

test('isShortsLink accepts only /shorts/ hrefs', () => {
  assert.ok(isShortsLink('/shorts/04eDk8brFL4'));
  assert.ok(isShortsLink('https://www.youtube.com/shorts/2unN8bVOMcE'));
  // These are ordinary videos that the old selector was deleting.
  assert.ok(!isShortsLink('/watch?v=R9CElS2DeKQ&t=457s'));
  assert.ok(!isShortsLink('/watch?v=AxiB8wAf7tI&t=1485s'));
  assert.ok(!isShortsLink(undefined));
  assert.ok(!isShortsLink(null));
});

test('getMenuButton returns More actions button when present', async () => {
  const mockEntry = {
    locator: (sel) => ({
      first: () => ({ count: async () => sel.includes('More actions') ? 1 : 0 }),
    }),
  };

  const btn = await getMenuButton(mockEntry);
  assert.ok(btn !== null);
});

test('REMOVE_BUTTON_SELECTOR matches both yt-list-item and ytd-menu-service-item-renderer', () => {
  assert.ok(REMOVE_BUTTON_SELECTOR.includes('yt-list-item-view-model__container--tappable'));
  assert.ok(REMOVE_BUTTON_SELECTOR.includes('ytd-menu-service-item-renderer'));
  assert.ok(REMOVE_BUTTON_SELECTOR.includes('Remove from watch history'));
});

test('getMenuButton falls back to Action menu button', async () => {
  let selectedSelector = null;
  const mockEntry = {
    locator: (sel) => ({
      first: () => ({
        count: async () => sel.includes('Action menu') ? 1 : 0,
        // capture which selector was ultimately used for click
        click: async () => { selectedSelector = sel; },
      }),
    }),
  };

  const btn = await getMenuButton(mockEntry);
  await btn.click();
  assert.ok(selectedSelector.includes('Action menu'));
});
