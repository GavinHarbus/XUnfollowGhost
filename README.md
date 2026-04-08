<div align="center">
  <img src="icon.png" width="180" alt="XUnfollowGhost Logo">

  # XUnfollowGhost

  **Find out who unfollowed you on X (Twitter) — and spot the blue-verified ones.**

  ![Chrome](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
  ![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853)
  ![License](https://img.shields.io/badge/License-MIT-yellow)
  ![No API Key](https://img.shields.io/badge/X_API_Key-Not_Required-1DA1F2)

  <br/>

  > *"Someone unfollowed you? XUnfollowGhost knows who — even if they had the blue checkmark."*

</div>

---

## Features

- **Detect Unfollowers** — Compares follower snapshots to find who left
- **Blue Verified Badge** — Highlights unfollowers who are X Premium (blue checkmark) subscribers
- **Manual Scan** — You control when to scan, no background activity
- **Rich Dashboard** — Dark-themed UI matching X's design, with stats, avatars, and profile links
- **Scan History** — Full history of all scans with follower counts and changes
- **CSV Export** — Export your unfollower data for further analysis
- **No API Key Required** — Reads the rendered page directly, zero configuration
- **Privacy First** — All data stored locally in your browser. Nothing is sent to any server.

## Screenshots

<div align="center">

| Dashboard | Unfollower List | Settings |
|:---------:|:---------------:|:--------:|
| Stats overview with follower count, unfollower count, and scan history | Unfollower cards with avatar, name, blue-V badge, and detection time | CSV export, and data management |

</div>

## Quick Start

### Installation (Developer Mode)

1. **Download** this repository:
   ```bash
   git clone https://github.com/YourUsername/XUnfollowGhost.git
   ```

2. Open **Chrome** and navigate to:
   ```
   chrome://extensions
   ```

3. Enable **Developer mode** (toggle in the top right corner)

4. Click **"Load unpacked"** and select the `extension/` folder inside the project

5. The XUnfollowGhost icon will appear in your Chrome toolbar

### First Use

1. **Visit [x.com](https://x.com)** and make sure you are logged in
2. **Click the extension icon** in the toolbar to open the popup
3. **Click "Scan Now"** — The extension auto-navigates to your followers page, scrolls through it, and builds a baseline snapshot
4. **Click "Scan Now" again later** — The extension compares the new snapshot against the previous one and shows who unfollowed you

> **Note:** The first scan only establishes a baseline. Unfollowers will be detected starting from the second scan.

## How It Works

```
┌──────────────────────────────────────────────────────────┐
│                      Your Browser                         │
│                                                           │
│  ┌──────────────┐                 ┌───────────────────┐  │
│  │   x.com tab  │  postMessage    │  Content Script   │  │
│  │              │ ──────────────> │  (ISOLATED world) │  │
│  │  ┌────────┐  │                 │  message bridge    │  │
│  │  │ Page   │  │                 └────────┬──────────┘  │
│  │  │Scanner │  │                          │ chrome       │
│  │  │(MAIN)  │  │                          │ .runtime     │
│  │  │        │  │                 ┌────────▼──────────┐  │
│  │  │ 1.Navigate to              │  Service Worker    │  │
│  │  │   /followers │              │  (Background)      │  │
│  │  │ 2.Parse DOM  │  ┌────────┐ │                    │  │
│  │  │ 3.Scroll ↓   │  │ Popup  │ │  1. Store followers│  │
│  │  │ 4.Repeat     │  │ (UI)   │<│> 2. Save snapshot  │  │
│  │  └────────┘  │  └────────┘ │  3. Diff with prev │  │
│  └──────────────┘              │  4. Find ghosts!   │  │
│                                └────────┬──────────┘  │
│                                         │              │
│                                ┌────────▼──────────┐  │
│                                │    IndexedDB       │  │
│                                │  (Local Storage)   │  │
│                                └───────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### DOM-Parse Approach

XUnfollowGhost does **not** call any X API. Instead, it:

1. **Navigates** to your `/{screenName}/followers` page automatically
2. **Parses the rendered DOM** — reads `[data-testid="UserCell"]` elements to extract screen name, display name, avatar, and verified badge
3. **Scrolls down** to trigger X's infinite scroll, loading more followers
4. **Uses MutationObserver** to detect when new content appears (with a 5-second timeout fallback)
5. **Stops** after 5 consecutive scroll rounds with no new users

This means the extension is resilient to API changes — it reads what you see on the page.

### The Snapshot Diff Algorithm

1. **Snapshot** — Each scan collects your complete follower list and saves it as a sorted array of screen names
2. **Diff** — A two-pointer merge algorithm compares the previous and current snapshots in O(n+m) time
3. **Result** — Screen names in the previous snapshot but not in the current one = **unfollowers**

## Tech Stack

| Component | Technology |
|-----------|------------|
| Extension Format | Chrome Manifest V3 |
| Background | Service Worker (ES Modules) |
| Storage | IndexedDB (snapshots, followers, unfollowers, scan history) + chrome.storage (settings & scan state) |
| Content Scripts | Page scanner (MAIN world) + message bridge (ISOLATED world) |
| UI | Vanilla HTML/CSS/JS, X dark theme |
| Data Source | Rendered DOM of x.com followers page |
| Build | None — zero dependencies, no bundler |

## Project Structure

```
XUnfollowGhost/
├── icon.png                              # Project logo
├── extension/                            # Chrome extension (load this folder)
│   ├── manifest.json                     # Extension manifest (MV3)
│   ├── assets/icons/                     # Extension icons (16/48/128px)
│   └── src/
│       ├── background/
│       │   └── service-worker.js         # Scan orchestration & data processing
│       ├── content/
│       │   ├── content-script.js         # Message bridge (isolated world)
│       │   └── page-scanner.js           # DOM parser + scroll pagination (main world)
│       ├── popup/
│       │   ├── popup.html                # Popup structure
│       │   ├── popup.css                 # X dark theme styles
│       │   └── popup.js                  # UI logic & rendering
│       └── lib/
│           ├── constants.js              # DB config & storage keys
│           ├── messages.js               # Message type definitions
│           ├── db.js                     # IndexedDB v2 wrapper (screenName-keyed)
│           └── diff-engine.js            # Snapshot comparison (two-pointer merge)
└── README.md
```

## FAQ

<details>
<summary><b>Is this safe to use? Will my account get banned?</b></summary>

The extension does not make any API calls. It only reads the rendered page content in your browser — the same content you see when browsing your followers page manually. No external requests are made.
</details>

<details>
<summary><b>Why can't I see unfollowers after the first scan?</b></summary>

The first scan creates a baseline snapshot. The extension needs two snapshots to compare — unfollowers are detected starting from the second scan.
</details>

<details>
<summary><b>How long does a scan take?</b></summary>

It depends on your follower count. The extension scrolls through the followers page and parses ~20 users per scroll. A short pause between scrolls keeps things smooth. Rough estimates: 100 followers ≈ 15 seconds, 1K followers ≈ 2 minutes.
</details>

<details>
<summary><b>Can someone be falsely detected as an unfollower?</b></summary>

Yes, if a user changes their screen name. Since the extension identifies followers by screen name (not user ID — which is unavailable from the DOM), a renamed account will appear as an unfollower while the new name appears as a new follower.
</details>

<details>
<summary><b>Where is my data stored?</b></summary>

All data is stored locally in your browser using IndexedDB and chrome.storage. Nothing is sent to any external server. You can export your data as CSV or clear it entirely from the Settings panel.
</details>

<details>
<summary><b>What if X changes their page structure?</b></summary>

The extension relies on `data-testid` attributes in X's DOM (e.g. `UserCell`, `cellInnerDiv`). If X significantly changes these, the parser may need updating. This is an inherent trade-off of the DOM-parse approach.
</details>

## Contributing

Contributions are welcome! Feel free to submit issues and pull requests.

## Disclaimer

This project is for educational and personal use. It is not affiliated with, endorsed by, or associated with X Corp. Use it responsibly and at your own risk. The extension reads rendered page content which may change without notice.

## License

[MIT](LICENSE)

---

<div align="center">
  <sub>Built with curiosity. If this tool helped you, give it a star!</sub>
</div>
