[README.md](https://github.com/user-attachments/files/29525284/README.md)
# StdWork — Standardized Work Studio

Industrial time study tool for TMOs, supervisors, and operators. Runs in any modern browser — no install required.

**Current version:** [StdWorkv3.1.html](StdWorkv3.1.html)

Older versions (`StdWorkv3.0.html`, etc.) are kept in the repo for rollback.

---

## Quick start

### On GitHub Pages (recommended)

1. Open your published URL, e.g. `https://yourname.github.io/your-repo/StdWorkv3.1.html`
2. Log in with your role (TMO, Admin, or Operator)
3. Start a new study or open a saved one from **My Studies**

### Locally

1. Clone or download this folder
2. Open `StdWorkv3.1.html` in Chrome, Safari, or Edge
3. For full PDF download, use a local server or GitHub Pages (some browsers block CDN scripts from `file://`)

---

## Add to home screen (iPhone / Android)

StdWork v3.1 includes basic PWA support (`manifest.json` + service worker).

### iPhone (Safari)

1. Open `StdWorkv3.1.html` on GitHub Pages
2. Tap **Share** → **Add to Home Screen**
3. Name it **StdWork** and tap **Add**
4. Launch from the home screen icon for a full-screen app experience

### Android (Chrome)

1. Open the app URL in Chrome
2. Tap the menu (⋮) → **Install app** or **Add to Home screen**
3. Confirm install

> **Tip:** Set your GitHub Pages default document to `StdWorkv3.1.html`, or add a simple `index.html` redirect so teammates can bookmark a shorter URL.

---

## Roles

| Role | Access |
|------|--------|
| **ADMIN** | Full access — all areas, manage users, audit log, line reporting |
| **TMO** | Create/edit studies in assigned cell only |
| **OPERATOR** | Read-only — browse standards, no edits |

---

## Key workflows

1. **Define Elements** — split work into timed elements with observations
2. **Time Cycles** — record full cycles; use **Element Lap** for per-element splits in hybrid mode
3. **Standardization Document** — preview and **Download PDF** from capture view or studies list
4. **Exports** — CSV / JSON from studies list; Kaizen export from element table

---

## Sharing with other TMOs

1. Deploy this folder to GitHub Pages (Settings → Pages → branch `main` / root)
2. Share the link to `StdWorkv3.1.html`
3. Each TMO logs in with their assigned cell
4. Studies are stored in **browser localStorage** on each device — use JSON export to back up or transfer

---

## Files (v3.1)

| File | Purpose |
|------|---------|
| `StdWorkv3.1.html` | UI shell, styles, modals |
| `stdwork-v3.1.js` | App logic |
| `manifest.json` | PWA install metadata |
| `sw.js` | Offline app-shell cache |
| `icons/` | Home screen icons |

---

## Versioning

New features ship as new versioned files — e.g. `StdWorkv3.2.html` + `stdwork-v3.2.js`. Previous versions are never overwritten.

---

## Support

Built for shop-floor time studies. Test timer and PDF download on your actual phone before relying on them in production.
