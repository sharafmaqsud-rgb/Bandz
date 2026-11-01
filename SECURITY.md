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

Backups are always encrypted. The lock is optional, and encrypts your data on the device.

- AES-256-GCM, which also detects any change to the file.
- The key is stretched from your passphrase with PBKDF2-SHA256 at 600,000 rounds. Web Crypto
  has no Argon2, so **a long passphrase matters**. Several unrelated words work well.
- The key cannot be read back out of the browser, and the passphrase is never stored.

## What is not protected

| Limit | What it means |
|---|---|
| **Lost passphrase** | There is no recovery. Keep a backup, and keep its passphrase safe. |
| **Unlocked app** | The lock protects data at rest. While open, anyone holding the device can see it. |
| **App switcher** | iOS may show a snapshot of the last screen. |
| **Turning the lock on later** | The old unencrypted copy is overwritten, but may linger on disk for a while. Turn the lock on before importing, if this matters to you. |
| **Lock off** | Data is only as protected as the device. Use FileVault and an iPhone passcode. |
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

**Checked with no finding:** personal terms and balances across the full git history, inline
scripts or styles, `innerHTML` and `eval`, plaintext in backups and locked storage, requests to
any other site, and a personal email address in commits.

**Not tested:** a real iPhone, and real statements in a browser. Both are in the Phase 4 demo.
