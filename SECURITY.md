# Security

This is a plain account of what protects your data and what does not.

## What the app does

- **Your data stays on your devices.** It sits in the browser's private storage, and is never
  in this repo or on a server. The code has no way to send it: the content policy sets
  `connect-src 'none'`, and tests check for network calls.
- **No move of money.** There are no bank credentials and nothing that can pay or trade.
- **Text from statements is only ever shown as text**, so a merchant name cannot run as code.
- **PDFs are read in a separate worker**, with pdf.js's code generation switched off.
- **Backups are checked in full before use.** A bad file changes nothing.

## Encryption

Backups are always encrypted, and a passphrase is required to use the app, so your data is always encrypted on the device.

- AES-256-GCM, which also detects any change to the file.
- The key is stretched from your passphrase with PBKDF2-SHA256 at 600,000 rounds. Web Crypto
  has no Argon2, so **a long passphrase matters**. Several unrelated words work well.
- The key cannot be read back out of the browser, and the passphrase is never stored.

## What is not protected

| Limit | What it means |
|---|---|
| **Lost passphrase** | There is no recovery. Keep a backup, and keep its passphrase safe. |
| **Unlocked app** | The lock protects data at rest. While open, anyone holding the device can see it. |
| **App switcher** | The app hides its screen when in the background, but iOS may take its snapshot first. |
| **Exported reports** | PDF and Excel files are not encrypted. The app warns you before making one. |
| **Data from before the lock was required** | The old unencrypted copy is overwritten, but may linger on disk for a while. |
| **iPhone storage** | iOS can clear a web app's data. Your latest backup is the safe copy. |
| **Clipboard** | A copied Claude summary stays on the clipboard until replaced. It can name people you pay. |
| **What you paste into Claude** | Pasting a summary shares it, by your choice. |

## Trusting the published code

The installed app comes from GitHub Pages, so these are the real risks:

1. **The host and repo are a point of trust.** Anyone who can change the repo or the site could
   publish code that steals data. The content policy limits network calls, but hostile code
   could rewrite the policy, or leave by navigating to another site. Turn on two-factor sign-in
   for your GitHub account, because it protects the app itself.
2. **Update checks.** The browser checks for a new `sw.js` when the app opens. That request goes
   to GitHub, which can see your IP address and when you used the app, but no financial data.
   This is the one exception to "no requests at runtime", and the app cannot turn it off.
   Updates wait for your tap, though a hostile update could be written to skip that.
3. **Other sites on the same address.** Every GitHub Pages site under your username shares one
   browser origin, `yourname.github.io`, and pages on one origin can read each other's data.
   **This app should be the only Pages site on your account.** If you need another, turn the
   lock on, or host this app on its own address, such as a Cloudflare Pages subdomain.

## Security review, November 2026

Reviewed by reading each area of the code and testing it, not by an outside auditor.

| Finding | Severity | Status |
|---|---|---|
| Development server served `/LOCAL/seed.json`, because Mac file names ignore case | Medium, local only | Fixed |
| A malformed address crashed the development server | Low, local only | Fixed |
| Development server accepted any host name, allowing DNS rebinding | Low, local only | Fixed |
| A seed or backup could use names like `constructor` as accounts or categories | Low | Fixed |
| A backup with an impossible date could stop screens opening, every time | Medium | Fixed |
| A blank rule in a backup would have matched every transaction | Low | Fixed |
| A failure opening data led to an empty app, whose next save could overwrite your real data | High | Fixed |
| A statement saved in the repo folder could be published by `git add` | Medium | Fixed, ignored and tested |
| Shared origin on GitHub Pages | Medium | Documented above, needs your care |

Later review of the Phase 5 additions, by the same method:

| Area | Result |
|---|---|
| Excel export | Statement text is always stored as text, so a merchant name cannot run as a formula. Tested. |
| PDF export | Text is escaped, and characters the font lacks are replaced. Tested. |
| Learning from your choices | It reads only your own decisions, and the code holds no personal names. |
| Exported files | Not encrypted, so the app warns first. |
| Required passphrase | Older unencrypted data is encrypted before the app opens. Tested. |

**Checked with no finding:** personal terms and balances across the full git history, inline
scripts or styles, `innerHTML` and `eval`, plaintext in backups and locked storage, requests to
any other site, and a personal email address in commits.

**Not tested:** a real iPhone, and real statements in a browser. Both are in the Phase 4 demo.
