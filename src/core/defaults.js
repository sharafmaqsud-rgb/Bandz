// Starting configuration, ported from v1's defaults/ folder. This file ships in a
// public repo, so it holds only generic merchants. Your employer, personal merchants,
// balances and targets belong in the git-ignored local/seed.json (see model.applySeed).

// kind: income | spend | saving | transfer. essential counts towards the cash buffer.
export const CATEGORIES = {
  'Salary': { kind: 'income', essential: false },
  'Commission & bonus': { kind: 'income', essential: false },
  'Interest & cashback': { kind: 'income', essential: false },
  'Other income': { kind: 'income', essential: false },
  'Groceries': { kind: 'spend', essential: true },
  'Transport': { kind: 'spend', essential: true },
  'Bills & phone': { kind: 'spend', essential: true },
  'Family & household': { kind: 'spend', essential: true },
  'Eating out & takeaway': { kind: 'spend', essential: false },
  'Travel & holidays': { kind: 'spend', essential: false },
  'Subscriptions': { kind: 'spend', essential: false },
  'Shopping': { kind: 'spend', essential: false },
  'Health & fitness': { kind: 'spend', essential: false },
  'Entertainment': { kind: 'spend', essential: false },
  'Gifts & charity': { kind: 'spend', essential: false },
  'Fees & interest': { kind: 'spend', essential: false },
  'Other spend': { kind: 'spend', essential: false },
  'ISA contribution': { kind: 'saving', essential: false },
  'Investing & crypto': { kind: 'saving', essential: false },
  'Cash savings': { kind: 'saving', essential: false },
  'Internal transfer': { kind: 'transfer', essential: false },
  'Card repayment': { kind: 'transfer', essential: false },
};

const byCategory = {
  'Groceries': ['TESCO', 'SAINSBURY*', 'ASDA', 'ALDI', 'LIDL', 'WAITROSE', 'CO-OP', 'M&S SIMPLY FOOD', 'OCADO'],
  'Transport': ['TFL', 'TRAINLINE*', 'UBER', 'BOLT', 'SHELL', 'BP', 'ESSO', 'NATIONAL RAIL'],
  'Eating out & takeaway': ['DELIVEROO', 'JUST EAT', 'UBER EATS', 'STARBUCKS', 'PRET', 'NANDO*', 'MCDONALD*', 'GREGGS', 'COSTA'],
  'Subscriptions': ['NETFLIX', 'SPOTIFY', 'APPLE.COM/BILL', 'ICLOUD', 'AMAZON PRIME', 'DISNEY PLUS'],
  'Health & fitness': ['GYM', 'BOOTS'],
  'Shopping': ['AMAZON', 'AMZNMKTP*', 'ASOS', 'ZARA', 'EBAY'],
  'Bills & phone': ['VODAFONE', 'EE LIMITED', 'O2', 'THREE', 'GIFFGAFF'],
  'Travel & holidays': ['AIRBNB*', 'BOOKING.COM', 'RYANAIR*', 'EASYJET*', 'BRITISH AIRWAYS'],
  'Entertainment': ['CINEMA*', 'ODEON', 'VUE'],
  'Salary': ['SALARY'],
  'ISA contribution': ['VANGUARD*'],
  'Investing & crypto': ['TRADING 212', 'TRADING212', 'COINBASE*'],
  'Card repayment': ['AMERICAN EXPRESS', 'AMEX PAYMENT', 'PAYMENT RECEIVED', 'PAYMENT - THANK YOU', 'LLOYDS BANK CREDIT CARD', 'LLOYDS ULTRA'],
  'Internal transfer': ['REVOLUT', 'TOP-UP'],
  'Interest & cashback': ['INTEREST', 'CASHBACK'],
  // INTEREST CHARGED is new in this port: without it, card interest would match
  // INTEREST above and be filed as income rather than as a cost.
  'Fees & interest': ['FOREIGN TRANSACTION FEE', 'NON-STERLING', 'OVERDRAFT', 'LATE PAYMENT', 'FEE', 'INTEREST CHARGED'],
};

export const RULES = Object.entries(byCategory).flatMap(([category, patterns]) =>
  patterns.map((pattern) => ({ pattern, category })));

// class: cash | credit | investment | crypto | pension.
// isIsa decides whether payments count towards the ISA allowance; change it per account in-app.
export const ACCOUNTS = {
  'lloyds-club': { name: 'Club Lloyds current account', class: 'cash', hasStatements: true, isIsa: false },
  'revolut': { name: 'Revolut', class: 'cash', hasStatements: false, isIsa: false },
  'lloyds-ultra': { name: 'Lloyds Ultra credit card', class: 'credit', hasStatements: true, isIsa: false },
  'amex-gold': { name: 'Amex Gold', class: 'credit', hasStatements: true, isIsa: false },
  'vanguard-isa': { name: 'Vanguard ISA', class: 'investment', hasStatements: false, isIsa: true },
  'trading212': { name: 'Trading 212', class: 'investment', hasStatements: false, isIsa: false },
  'coinbase': { name: 'Coinbase', class: 'crypto', hasStatements: false, isIsa: false },
  'lg-pension': { name: 'L&G pension', class: 'pension', hasStatements: false, isIsa: false },
};

// The rule wording for payments into an account, used when you mark it as an ISA or not.
export const FUNDING_PATTERNS = {
  'vanguard-isa': ['VANGUARD*'],
  'trading212': ['TRADING 212', 'TRADING212'],
};

// Analysis thresholds, unchanged from v1 apart from being held in pence.
export const SETTINGS = {
  isaAllowancePence: 2000000,
  isaPaidBeforeImportByTaxYear: {},
  smallSpendThresholdPence: 1500,
  smallSpendMinCount: 8,
  anomalyMinPence: 7500,
  anomalyMultiple: 3,
  overshootRatio: 1.3,
  overshootMinPence: 5000,
  duplicateWindowDays: 2,
};

// null = not set: the app shows the measure without any pass/fail.
export const GOALS = {
  monthlyIsaTargetPence: null,
  savingsRateTarget: null,
  monthlySpendCapPence: null,
  bufferMonthsTarget: null,
  netWorthTargetPence: null,
};
