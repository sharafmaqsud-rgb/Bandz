# Personal finance app

One private place for your whole financial position, how you are tracking against your
goals, and where to optimise. It runs on your own devices, makes no model calls, and
cannot move money or place trades. Every insight is plain rules and arithmetic.

**Status: Phase 2 ready for review.** The Overview, Spending, Accounts and Import screens
work on this Mac. Goals and insights come in Phase 3, and installing on your phone in Phase 4.

## Running the app

```bash
.tools/node/bin/node tools/serve.mjs
```

Then open http://localhost:8123. The server only hands files to your browser and only
listens on this Mac. Your data is saved inside whichever browser you use, so another browser
starts empty. It is not encrypted until the passphrase lock arrives in Phase 4.

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
| `src/core/analysis.js` | Every number: monthly totals, changes, net worth, data gaps. Goals and insights arrive in Phase 3. |
| `src/store.js` | Saves the data in the browser's private storage. |
| `src/app.js` | Starts the app, switches screens and saves after each change. |
| `src/ui/*.js` | One file per screen, plus `dom.js` helpers that insert all text safely. |
| `src/ui/styles.css` | Layout and the light and dark colours. |
| `vendor/pdfjs/` | The bundled copy of pdf.js. A test checks it matches the pinned package. |
| `tools/serve.mjs` | The development server. It refuses to serve your private folders. |
| `tests/analysis.test.js` | Tests for the numbers shown on the screens. |
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

Each is labelled "calculated" or "estimate" in the app. Cash buffer, ISA contributions and
recurring charges are defined here and arrive on screen in Phase 3.

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
| Cash buffer | (Cash balances minus card balances owed) divided by average monthly essential spend over the last three months | Calculated |
| ISA contributions | Payments categorised `ISA contribution` since 6 April, plus anything you enter as paid before your first import | Calculated |
| Net worth | Latest balance of every account, added together, with card balances counting as negative. Accounts with no balance are listed as missing, not counted as zero. | Calculated |
| Investments | Investment and crypto accounts together | Calculated |
| Recurring charge | Same merchant at a steady amount (within 15%) in at least 3 of the last 6 months | Estimate |
| Annualised cost | Monthly recurring amount times 12 | Estimate |

The three statement types above are all in sterling, so nothing is currently excluded for
being in another currency. If a non-GBP source is added later, its rows will be left out of
totals and reported as a count.
