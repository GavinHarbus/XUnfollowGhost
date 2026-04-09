<div align="center">

  # Who Unfollowed Me · X

  **Find out who unfollowed you on X (Twitter) — no API key, no login, one click.**

  ![Chrome](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
  ![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853)
  ![License](https://img.shields.io/badge/License-MIT-yellow)
  ![No API Key](https://img.shields.io/badge/API_Key-Not_Required-1DA1F2)

  <br/>

  > *"Someone unfollowed you? This extension knows who — even if they had the blue checkmark."*

</div>

---

## Why This Extension?

X (Twitter) doesn't tell you when someone unfollows you. Third-party services either require your API key, charge a subscription, or get blocked by X's rate limits.

**Who Unfollowed Me** takes a different approach — it reads your followers page directly, just like you would. No API, no tokens, no external servers. Everything runs locally in your browser.

## Features

- **One-Click Scan** — Click "Scan Now" and it handles everything: navigates to your followers page, scrolls through the list, and collects every follower
- **Detect Unfollowers** — Compares follower snapshots to find who left
- **Blue Verified Badge** — Highlights unfollowers who are X Premium subscribers
- **Completeness Check** — Cross-references with X's reported follower count to ensure no one is missed
- **Side Panel UI** — Dashboard stays open while scanning, won't disappear during page navigation
- **Dark Theme** — Matches X's native dark design
- **Scan History** — Full history of all scans with follower counts and changes
- **CSV Export** — Export your unfollower data
- **Privacy First** — All data stored locally in your browser. Nothing is sent to any server

## Quick Start

### Install from Chrome Web Store

> Coming soon

### Install Manually (Developer Mode)

1. **Download** this repository:
   ```bash
   git clone https://github.com/YourUsername/XUnfollowGhost.git
   ```

2. Open Chrome and go to `chrome://extensions`

3. Enable **Developer mode** (top right toggle)

4. Click **"Load unpacked"** and select the `extension/` folder

5. Pin the extension icon in your toolbar

### How to Use

1. **Open [x.com](https://x.com)** and make sure you're logged in
2. **Click the extension icon** — a side panel opens on the right
3. **Click "Scan Now"** — the extension navigates to your followers page and scans automatically
4. **Scan again later** — it compares snapshots and shows who unfollowed you

> **First scan** establishes a baseline. Unfollowers are detected starting from the second scan.

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                     Your Browser                        │
│                                                         │
│  ┌──────────────┐              ┌──────────────────┐    │
│  │   x.com tab  │  postMessage │  Content Script  │    │
│  │              │ ───────────> │  (message bridge) │    │
│  │  ┌────────┐  │              └────────┬─────────┘    │
│  │  │ Page   │  │                       │ chrome       │
│  │  │Scanner │  │                       │ .runtime     │
│  │  │(MAIN)  │  │              ┌────────▼─────────┐    │
│  │  │        │  │  ┌────────┐  │  Service Worker  │    │
│  │  │ Parse  │  │  │ Side   │  │                  │    │
│  │  │ DOM &  │  │  │ Panel  │<>│ Store followers  │    │
│  │  │ Scroll │  │  │ (UI)   │  │ Snapshot & diff  │    │
│  │  └────────┘  │  └────────┘  │ Detect ghosts!   │    │
│  └──────────────┘              └────────┬─────────┘    │
│                                ┌────────▼─────────┐    │
│                                │    IndexedDB      │    │
│                                │  (Local Storage)  │    │
│                                └──────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### DOM-Parse Approach

This extension does **not** call any X API. Instead:

1. **Navigates** to your `/{screenName}/followers` page
2. **Parses the rendered DOM** — reads `UserCell` elements to extract screen name, display name, avatar, and verified badge
3. **Scrolls** to trigger X's infinite scroll and load more followers
4. **Verifies completeness** — reads X's internal state to confirm all followers were captured; runs extra rounds if needed
5. **Diffs snapshots** — a two-pointer merge algorithm compares sorted screen name arrays in O(n+m) time

The extension reads what you see on the page — nothing more.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Extension | Chrome Manifest V3 |
| Background | Service Worker (ES Modules) |
| Storage | IndexedDB + chrome.storage.local |
| Content Scripts | DOM parser (MAIN world) + message bridge (ISOLATED world) |
| UI | Side Panel, Vanilla HTML/CSS/JS, X dark theme |
| Build | None — zero dependencies, no bundler |

## Project Structure

```
extension/
├── manifest.json
├── assets/icons/
└── src/
    ├── background/
    │   └── service-worker.js      # Scan orchestration & snapshot diff
    ├── content/
    │   ├── page-scanner.js        # DOM parser + scroll pagination
    │   └── content-script.js      # Message bridge
    ├── popup/
    │   ├── popup.html             # Side panel layout
    │   ├── popup.css              # X dark theme
    │   └── popup.js               # UI logic
    └── lib/
        ├── constants.js           # Config
        ├── messages.js            # Message types
        ├── db.js                  # IndexedDB wrapper
        └── diff-engine.js         # Snapshot comparison
```

## FAQ

<details>
<summary><b>Is this safe? Will my X account get banned?</b></summary>

The extension makes zero API calls. It only reads the page content in your browser — the same content you see when manually scrolling your followers page. No external requests are made.
</details>

<details>
<summary><b>Why no unfollowers after the first scan?</b></summary>

The first scan creates a baseline snapshot. The extension needs two snapshots to compare — unfollowers show up from the second scan onward.
</details>

<details>
<summary><b>How long does a scan take?</b></summary>

Depends on your follower count. ~100 followers takes about 15 seconds, ~1K about 2 minutes. The extension scrolls through and parses ~20 users per round.
</details>

<details>
<summary><b>Can someone be falsely detected?</b></summary>

If a user changes their screen name, the old name appears as an unfollower and the new name as a new follower. This is a known limitation of DOM-based tracking (user IDs aren't available from the rendered page).
</details>

<details>
<summary><b>Where is my data stored?</b></summary>

Entirely in your browser — IndexedDB and chrome.storage. Nothing leaves your machine. Export as CSV or clear everything from Settings.
</details>

<details>
<summary><b>What if X changes their page layout?</b></summary>

The extension relies on X's `data-testid` DOM attributes. If X significantly changes these, the parser may need updating. This is a trade-off of the DOM-parse approach vs. API interception.
</details>

## Contributing

Issues and PRs welcome.

## Disclaimer

Not affiliated with X Corp. For personal use. Use responsibly and at your own risk.

## License

[MIT](LICENSE)

---

<div align="center">
  <sub>If this helped you, give it a star!</sub>
</div>
