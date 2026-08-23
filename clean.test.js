const { test } = require('node:test');
const assert = require('node:assert');

const {
  scrollToLoadAll, SHORTS_SELECTOR, getMenuButton, REMOVE_BUTTON_SELECTOR,
  isShortsLink, loadHistoryPage,
} = require('./clean.js');

// Minimal Playwright page stand-in for loadHistoryPage. `present` decides which
// selectors the fake page claims to have.
function mockHistoryPage({ historyBrowse = true, avatar = true, shortsTab = true } = {}) {
  const clicked = [];
  const has = (sel) => {
    if (sel.includes('page-subtype="history"')) return historyBrowse;
    if (sel.includes('#avatar-btn')) return avatar;
    if (sel.includes('has-text("Shorts")')) return shortsTab;
    return false;
  };
  const handle = (sel) => ({
    count: async () => (has(sel) ? 1 : 0),
    waitFor: async () => { if (!has(sel)) throw new Error(`no ${sel}`); },
    click: async () => { clicked.push(sel); },
    first: () => handle(sel),
  });
  return {
    clicked,
    goto: async () => {},
    evaluate: async () => {},
    waitForTimeout: async () => {},
    locator: handle,
  };
}

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

test('loadHistoryPage reports no-shorts when the tab bar is absent on a valid page', async () => {
  // YouTube drops the filter tab bar once history holds no Shorts. That is
  // success, not failure — it must not throw and must not click anything.
  const page = mockHistoryPage({ shortsTab: false });
  assert.strictEqual(await loadHistoryPage(page), 'no-shorts');
  assert.deepStrictEqual(page.clicked, []);
});

test('loadHistoryPage proceeds when the Shorts tab is present', async () => {
  const page = mockHistoryPage();
  assert.strictEqual(await loadHistoryPage(page), 'ready');
  assert.ok(page.clicked.some(sel => sel.includes('Shorts')));
});

test('loadHistoryPage refuses to continue when signed out', async () => {
  const page = mockHistoryPage({ avatar: false, shortsTab: false });
  await assert.rejects(
    () => loadHistoryPage(page),
    /refusing to touch watch history/,
  );
  assert.deepStrictEqual(page.clicked, []);
});

test('loadHistoryPage refuses to continue when the history page did not render', async () => {
  const page = mockHistoryPage({ historyBrowse: false });
  await assert.rejects(
    () => loadHistoryPage(page),
    /refusing to touch watch history/,
  );
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

/**
 * Models the real launchd failure: the masthead avatar renders ~6.6s after the
 * browse element attaches, so an instantaneous count() sees 0 even though the
 * session is perfectly valid.
 */
function mockLatePage({ avatarEverRenders = true } = {}) {
  let avatarRendered = false;
  const clicked = [];
  const has = (sel) => {
    if (sel.includes('page-subtype="history"')) return true;
    if (sel.includes('#avatar-btn')) return avatarRendered;
    if (sel.includes('has-text("Shorts")')) return false;
    return false;
  };
  const handle = (sel) => ({
    count: async () => (has(sel) ? 1 : 0),
    waitFor: async () => {
      if (sel.includes('#avatar-btn')) {
        if (!avatarEverRenders) throw new Error('timeout');
        avatarRendered = true;
        return;
      }
      if (!has(sel)) throw new Error(`no ${sel}`);
    },
    click: async () => { clicked.push(sel); },
    first: () => handle(sel),
  });
  return { clicked, goto: async () => {}, evaluate: async () => {}, waitForTimeout: async () => {}, locator: handle };
}

test('loadHistoryPage tolerates an avatar that renders late', async () => {
  // Reaches the Shorts-tab check and reports no-shorts, rather than throwing.
  assert.strictEqual(await loadHistoryPage(mockLatePage()), 'no-shorts');
});

test('loadHistoryPage still refuses when the avatar never renders', async () => {
  await assert.rejects(
    () => loadHistoryPage(mockLatePage({ avatarEverRenders: false })),
    /refusing to touch watch history/
  );
});
