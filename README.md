# YouTube Shorts History Cleaner

Automatically removes all YouTube Shorts from your watch history using browser automation. Useful when someone else uses your YouTube account and their Shorts viewing contaminates your recommendations.

## How it works

1. Opens a browser session using your saved Google login
2. Navigates to YouTube Watch History → Shorts filter
3. Iterates through all visible Shorts and removes each one
4. Reloads the page after each batch to get fresh entries
5. Repeats until no Shorts remain

## Setup

### 1. Install dependencies

```bash
npm install
npx playwright install chromium
```

### 2. Log in once

```bash
node login.js
```

This opens a browser window. Sign into your Google account, then press Enter in the terminal. Your session is saved locally to `session/` and reused for all future runs.

### 3. Run the cleaner

```bash
node clean.js
```

To run headlessly (no window):

```bash
node clean.js --headless
```

## Schedule daily runs

To run every night at 3 AM via cron:

```bash
crontab -e
```

Add:

```
0 3 * * * cd /path/to/yt-shorts-cleaner && node clean.js --headless >> cleaner.log 2>&1
```

## Notes

- **Session data** (`session/`) contains your browser cookies and is excluded from git. Never commit it.
- YouTube's UI occasionally changes — if the script breaks, the selectors in `clean.js` may need updating.
- The script only removes Shorts, not regular videos or podcasts from your history.

## Requirements

- Node.js 18+
- macOS / Linux (Windows untested)
