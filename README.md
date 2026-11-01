# Personal finance app

One private place for your whole financial position, how you are tracking against your
goals, and where to optimise. It runs on your own devices, makes no model calls, and
cannot move money or place trades. Every insight is plain rules and arithmetic.

**Status: Phase 4 ready for review.** All five screens, encrypted backup and sync, the
passphrase lock and offline use all work. See `SECURITY.md` for what is and is not protected.

## Running the app

```bash
.tools/node/bin/node tools/serve.mjs
```

Then open http://localhost:8123. The server only hands files to your browser and only
listens on this Mac. Your data is saved inside whichever browser you use, so another browser
starts empty. It is only encrypted if you turn on the passphrase lock, on the Import screen.

## Using it on your iPhone

The installed app needs to be downloaded once over HTTPS, so its code (never your data) is
published on GitHub Pages. In Safari on your iPhone, open the app's address, tap Share, then
Add to Home Screen. Open it once while online, and it then works with no connection.

## Moving data between devices

There is no server, so devices share data through an encrypted file:

1. On one device, go to Import, then Create an encrypted backup, and save it to iCloud Drive.
2. On the other device, go to Import, then Sync or restore from a backup, and choose that file.

Each item merges on its own and the newest edit wins, so work on both devices survives. A
category you chose by hand beats one set by a rule. Removing a pension provider carries across.

**The trade-off, honestly:** this is manual, and it takes a few taps each time, because an
iPhone web app cannot read an iCloud folder by itself. A device only knows what you last synced.
In return there is no server or account, and Apple only ever holds encrypted data. AirDropping
the same file is a private alternative that skips the cloud altogether.

Importing on your laptop then syncing to your phone is the simplest routine.

## After changing any app file

The offline copy uses a generated list. A test fails if you forget to update it.

```bash
.tools/node/bin/node tools/update-sw.mjs
```

## What stays private

Your data never goes in this repo. These are git-ignored, and a test fails if that changes:

| Path | What it holds |
|---|---|
| `local/seed.json` | Your starting balances, your personal merchant rules and your ISA target |
| `local/banned-terms.txt` | Personal words that must never appear in the published code |
| `reference/` | The Python v1, which includes your balances |
| `node_modules/` | The pinned copy of pdf.js |
| `.tools/` | The Node toolchain, used for development only |

`seed.example.json` shows the seed file's shape using invented values. You will load your
seed once through the Import screen, so it is never part of the published app.

## Running the tests

Node 26.13.0 is installed inside `.tools/`, so nothing on your Mac changes.

```bash
.tools/node/bin/node --test
```

## Importing statements

The app reads PDF statements from Club Lloyds, Lloyds Ultra and Amex Gold, on your device.
It recognises the bank from the document itself. pdf.js (version 6.4.299, pinned) is the
one dependency, and it is bundled so nothing is fetched from the internet.

**Every statement is checked against the bank's own printed totals.** A statement that fails
is refused whole, so misread numbers cannot reach your totals.

| Statement | Checks |
|---|---|
| Club Lloyds | Money in and money out match the printed totals. The running balance agrees on every row. Opening and closing balances agree. |
| Lloyds Ultra, Amex Gold | Previous balance plus all transactions equals the new balance. |
| All | Rows were found, and none is dated after the statement. |

To try real statements on your Mac, run the command below with your own file paths. It
prints check results and counts only, never your transactions.

```bash
.tools/node/bin/node tools/check-statement.mjs statement.pdf
```

**Revolut** is balance only. Your investments and pension use manual balances for now.

## Module map

| File | What it does |
|---|---|
| `src/core/money.js` | Converts text to whole pence and pence to display text. Never uses floats. |
| `src/core/dates.js` | Converts bank date formats to ISO `yyyy-mm-dd`, rejecting impossible dates. |
| `src/core/csv.js` | Reads CSV files, for investment exports later. No bank uses it at the moment. |
| `src/core/pdf-text.js` | Pulls positioned text out of a PDF using pdf.js. |
| `src/core/pdf-statements.js` | Rebuilds each bank's table from that text, checks it, and imports it. |
| `src/core/analysis.js` | Monthly totals, changes, net worth and data gaps. |
| `src/core/insights.js` | Goal measures and every optimisation rule. |
| `src/core/summary.js` | The plain-text summary to paste into a Claude chat. |
| `src/core/crypto.js` | Passphrase encryption for backups and the lock. |
| `src/core/merge.js` | Checks a backup is valid, then combines it with this device's data. |
| `src/store.js` | Saves the data in the browser's private storage. |
| `src/pwa.js`, `sw.js`, `manifest.webmanifest` | Make the app installable and offline. `sw.js` holds code only, never your data. |
| `SECURITY.md` | What is protected, what is not, and the security review. |
| `src/app.js` | Starts the app, switches screens and saves after each change. |
| `src/ui/*.js` | One file per screen, plus `dom.js` helpers that insert all text safely. |
| `src/ui/styles.css` | Layout and the light and dark colours. |
| `vendor/pdfjs/` | The bundled copy of pdf.js. A test checks it matches the pinned package. |
| `tools/serve.mjs` | The development server. It refuses to serve your private folders. |
| `tests/analysis.test.js`, `tests/insights.test.js` | Tests for the numbers shown on the screens. |
| `tests/security.test.js` | Tests for encryption, sync, bad backups and the offline list. |
| `tools/update-sw.mjs` | Regenerates the offline file list in `sw.js`. |
| `src/core/defaults.js` | Starting categories, generic merchant rules, accounts and thresholds. |
| `src/core/categorise.js` | Matches descriptions to categories, and derives a short merchant name. |
| `src/core/model.js` | The data itself: transactions, balances, rules, goals and duplicate-safe import. |
| `tests/core.test.js` | Logic tests. Names starting `v1:` are ported from the Python tests. |
| `tests/statements.test.js` | Import tests on invented PDFs, including the monthly reconciliation. |
| `tests/mask.test.js` | Tests the masking below. |
| `tests/privacy.test.js` | Checks that nothing personal can be committed. |
| `tests/fixtures/` | Invented statements in the real page layouts. |
| `tools/mask.js`, `tools/pdf-layout.mjs` | Print a statement's layout with all its contents masked. |
| `tools/check-statement.mjs` | Tries the importers on real PDFs and prints no personal content. |

## Rules that matter

- **Money** is always a whole number of pence, so sums are exact.
- **Sign:** negative is money out and positive is money in, on every account.
- **Category kinds:** `income`, `spend`, `saving` (ISA, investing, cash savings) and
  `transfer`. Essential categories count towards your cash buffer.
- **No double counting:** card repayments and transfers between your own accounts are
  `transfer`, which is excluded from spending. Only the original card purchase counts.
- **Rule matching:** whole-word and case-insensitive. A trailing `*` matches a word prefix
  (`NANDO*`), the longest matching pattern wins, and categories you set by hand are never
  overwritten.
- **Re-importing is safe:** a transaction's fingerprint is its account, date, description,
  amount and currency, plus a count of identical rows within that file. Two identical
  purchases in one file are both kept, and importing the file again adds nothing.
- **Card balances:** type what you owe as a positive number. It is stored as negative.
- **Statement balances:** importing records the closing balance, unless you already entered
  one for that account on that date.
- **Card repayment pairing:** a card's payment received is matched to an uncategorised
  current-account payment of exactly the same amount within 10 days. That row then counts as
  a transfer, whatever wording the bank used. Known shop purchases are never claimed.
- **Dates on cards:** the transaction date is used, not the date the bank processed it. Card
  rows print no year, so it comes from the statement date.
- **Foreign card spending:** the sterling amount the bank charged is used.

### How payments get filed

Each payment goes through these steps, strongest evidence first, and records its reason. There
is no AI model, only rules that run on your device.

| Step | Example | Confidence |
|---|---|---|
| Your rules, then the standard rules | `TESCO`, or a merchant you have categorised | High |
| A list of well-known UK merchants | `OCTOPUS ENERGY` | High |
| Your own past choices about similar names | You filed `BLUEWATER WIDGETS`, so `BLUEWATER GADGETS` follows | Medium |
| The bank's payment type | `CHG` is a fee | Medium |
| Words in the name | `THE ROSE TAVERN` | Medium |
| Patterns | Money back on a card is a refund. A large payment in every month is salary. | Medium |
| Small unknown card purchases under £30, up to £100 per merchant | Filed under Other spend without asking | Low |

**It asks you** when nothing fits and the amount matters: unknown Direct Debits and transfers,
money in from an unknown source, and repeating payments to an unknown payee. It offers a
suggestion, and your answer applies to future payments and teaches similar ones. It also shows
you large automatic filings, and purchases far above your usual for that category.

Other spend is listed separately under an optional tidy-up, so that a catch-all cannot hide
things. Your hand-set choices are never replaced. Learning must fit the direction of the money,
so a payment out cannot become income by sharing a word with your employer.

### Known limits of duplicate detection

Both come from the v1 fingerprint:

- If two identical purchases on the same day arrive in *separate* files, the second is
  treated as already imported.
- If a bank changes a description between exports, that row is imported again. The
  duplicate-charge insight is there to help you spot this.

## How complete a month is

Card statements rarely end on the last day of a month. A month's figures only include what
has been imported, so the app says "Incomplete" and names where each statement stops.
Importing the next statement fills the gap.

## Differences from v1

- **PDF import replaces CSV import.** Your banks' statements are read as PDFs, and each one
  must now reconcile with the bank's totals before it is accepted.
- **Personal rules moved out.** Your employer and personal merchants are in `local/seed.json`,
  because this code will be published.
- **New rule:** `INTEREST CHARGED` is a cost. In v1, card interest would have matched
  `INTEREST` and counted as income.
- **Overdrafts:** non-card balances keep the sign you type. v1 always made them positive.
- **Revolut:** balance only, with no statement import. Payments from Lloyds to Revolut count
  as internal transfers, so anything spent from Revolut does not appear in Spending.
- **Targets:** none are set by default. Your ISA target comes from your seed file.
- **ISA accounts:** each account has an `isIsa` setting, off for Trading 212 until you
  change it.

## Metric definitions

Each is labelled "calculated" or "estimate" in the app. Until you set a target, a measure is
shown with no pass or fail.

| Metric | Definition | Label |
|---|---|---|
| Income | Money in, in `income` categories, plus uncategorised money in | Calculated |
| Spend | Money out in `spend` categories, net of refunds, plus uncategorised money out | Calculated |
| Saved | Payments to `saving` categories | Calculated |
| Left over | Income minus spend minus saved. Negative means more went out than came in. | Calculated |
| Essential spending | Spend in categories marked essential | Calculated |
| Share of spending | One category divided by the month's total spend | Calculated |
| Change on last month | This month's category total minus the calendar month before. Left out when that month has no data. | Calculated |
| Savings and investing rate | Saved divided by income. Payroll pension contributions never reach your bank, so they are not included. | Calculated |
| Cash buffer | (Cash balances minus card balances owed) divided by average monthly essential spend over this month and up to two before it. Uncategorised spending is not essential, so categorise first or this reads high. | Calculated |
| ISA contributions | Payments categorised `ISA contribution` since 6 April, plus anything you enter as paid before your first import | Calculated |
| Monthly amount to use the allowance | Allowance left divided by full months left before 5 April | Calculated |
| ISA paid in by 5 April at your target | Paid so far plus your monthly target for each full month left | Estimate |
| Net worth trend | Net worth on each date a balance was recorded, carrying other accounts forward. An account joins from its first balance, so adding one shows as a rise. | Calculated |
| Net worth | Latest balance of every account, added together, with card balances counting as negative. Accounts with no balance are listed as missing, not counted as zero. | Calculated |
| Investments | Investment and crypto accounts together | Calculated |
| Recurring charge | Same merchant at a steady amount (within 15%) in at least 3 of the last 6 months | Estimate |
| Annualised cost | Monthly recurring amount times 12 | Estimate |

### Optimisation rules

These thresholds are the same as v1's and are held in `src/core/defaults.js`.

| Insight | Rule | Label |
|---|---|---|
| Biggest categories | The top three spend categories this month | Calculated |
| Change on last month | Total spend and the three largest category moves against the previous calendar month | Calculated |
| Above your recent average | At least 30% and £50 above the category's average over up to three previous months. A category with no history is not flagged. | Calculated |
| Recurring charges | Same merchant, within 15% of its typical amount, in at least 3 of the last 6 months, at most twice a month, and seen this month or last | Estimate |
| Possible duplicates | Same account, merchant and amount of at least £5, within 2 days | Calculated |
| Unusually large purchases | At least £75 and three times the typical purchase in that category over 6 months, once the category has 5 past purchases | Calculated |
| Fees and interest | The `Fees & interest` category this month | Calculated |
| Small purchases add up | At least 8 non-essential purchases of £15 or less | Calculated |
| Cash buffer shortfall | Your target months times essential spend, minus cash after cards | Calculated |
| ISA allowance pace | Projected total at your target against the allowance | Estimate |

## Pension providers

Add as many as you need under Accounts. Each has its own balance history, and they add up to
the Pension total, with each provider listed under it on Overview. Names stay on your device.
Removing a provider also removes its balance history.

## ISA accounts

Tick "This is an ISA" under Accounts for Vanguard or Trading 212. Payments into a ticked
account count towards the allowance, including past statements.

## Summary for Claude

"Prepare summary for Claude" on Spending creates plain text for you to copy and paste into a
chat yourself. It holds totals, category names and merchant names. It leaves out account
numbers, pension provider names and full statement descriptions. The app never calls a model.

The three statement types above are all in sterling, so nothing is currently excluded for
being in another currency. If a non-GBP source is added later, its rows will be left out of
totals and reported as a count.
