// Starts the app, switches between screens and keeps the data saved. The screens are drawn
// again from the data after every change, which is simple and quick at this size.
import { LOCK_FORMAT, isEnvelope, seal, unseal } from './core/crypto.js';
import { createState, migrate } from './core/model.js';
import { applyUpdate, registerServiceWorker } from './pwa.js';
import { clearState, loadState, saveState } from './store.js';
import { h, notice, svg } from './ui/dom.js';
import { renderAccounts } from './ui/accounts.js';
import { renderGoals } from './ui/goals.js';
import { renderImport } from './ui/import.js';
import { renderOverview } from './ui/overview.js';
import { renderLockScreen } from './ui/security.js';
import { renderSpending } from './ui/spending.js';

const AUTO_LOCK_MS = 5 * 60 * 1000;

const icon = (...paths) => svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
  paths.map((d) => svg('path', { d })));

const SCREENS = {
  overview: { title: 'Overview', render: renderOverview, icon: () => icon('M4 11l8-7 8 7', 'M6 10v10h12V10') },
  spending: { title: 'Spending', render: renderSpending, icon: () => icon('M5 20V10', 'M12 20V4', 'M19 20v-7') },
  goals: { title: 'Goals', render: renderGoals, icon: () => icon('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z') },
  accounts: { title: 'Accounts', render: renderAccounts, icon: () => icon('M3 6h18v13H3z', 'M3 10h18') },
  import: { title: 'Import', render: renderImport, icon: () => icon('M12 4v11', 'M7 11l5 5 5-5', 'M4 20h16') },
};

const screenEl = document.getElementById('screen');
const tabsEl = document.getElementById('tabs');
const currentScreen = () => {
  const name = location.hash.slice(1);
  return SCREENS[name] ? name : 'overview';
};

const app = {
  state: null,
  lock: null,    // the key while unlocked, held in memory only. null means the lock is off.
  view: {},      // what is open or selected on screen, kept apart from your data
  saveError: null,
  update: null,  // a newer version of the app waiting to be applied
  saving: Promise.resolve(),

  render() {
    const name = currentScreen();
    document.title = `${SCREENS[name].title} · Finance`;
    tabsEl.replaceChildren(...Object.entries(SCREENS).map(([key, s]) => h('a', {
      href: `#${key}`,
      'aria-current': key === name ? 'page' : null,
    }, s.icon(), s.title)));
    const scroll = window.scrollY;
    screenEl.replaceChildren(...[
      this.saveError && notice('refused', 'Not saved', h('p', null, `Your latest change could not be stored on this device: ${this.saveError}`)),
      this.update && notice('done', 'An update is ready', h('p', null, h('button', { onClick: () => applyUpdate(this.update) }, 'Update now'))),
      SCREENS[name].render(this),
    ].flat(Infinity).filter(Boolean));
    window.scrollTo(0, scroll);
  },

  // Call after any change to the data: saves it, then redraws. Saves run strictly one after
  // another, because encrypting takes time and an older copy must not land last.
  commit() {
    this.saving = this.saving.then(async () => {
      try {
        await saveState(this.lock ? await seal(this.lock, LOCK_FORMAT, this.state) : this.state);
        this.saveError = null;
      } catch (err) {
        this.saveError = err.message;
      }
    });
    return this.saving.then(() => this.render());
  },

  // Throws if this is not the passphrase of the stored data.
  async verifyLock(passphrase) {
    await unseal(await loadState(), passphrase, LOCK_FORMAT);
  },

  async reset() {
    await clearState();
    this.state = createState();
    this.lock = null;
    this.view = {};
    this.render();
  },
};

function start() {
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); app.render(); });
  app.render();
}

// Clears the unlocked data and key from memory by reloading, once away or idle for too long.
function startAutoLock() {
  let lastActive = Date.now();
  const touch = () => { lastActive = Date.now(); };
  for (const type of ['pointerdown', 'keydown', 'scroll']) window.addEventListener(type, touch, { passive: true });
  const check = () => { if (app.lock && Date.now() - lastActive > AUTO_LOCK_MS) location.reload(); };
  // A hidden page's timers may not run, so check again when it comes back too.
  document.addEventListener('visibilitychange', check);
  setInterval(check, 15000);
}

function showLockScreen(record) {
  tabsEl.replaceChildren();
  const draw = (props) => screenEl.replaceChildren(...renderLockScreen({
    ...props,
    onUnlock: async (passphrase) => {
      draw({ busy: true });
      try {
        const { data, handle } = await unseal(record, passphrase, LOCK_FORMAT);
        app.state = migrate(data);
        app.lock = handle;
        start();
      } catch (err) {
        draw({ error: err.message });
      }
    },
    onReset: async () => { await clearState(); location.reload(); },
  }).flat(Infinity).filter(Boolean));
  draw({});
}

// This app is never meant to run inside another site's page.
if (window.top !== window.self) {
  screenEl.replaceChildren('This app cannot run inside another page.');
} else {
  registerServiceWorker((reg) => { app.update = reg; if (app.state) app.render(); });
  // Ask the browser not to clear this data when space runs low. It may decline.
  navigator.storage?.persist?.().catch(() => {});
  startAutoLock();
  try {
    const record = await loadState();
    if (isEnvelope(record, LOCK_FORMAT)) showLockScreen(record);
    else {
      app.state = migrate(record ?? createState());
      start();
    }
  } catch (err) {
    // Never fall back to an empty app here: the next save would overwrite your real data.
    screenEl.replaceChildren(...notice('refused', 'Your data could not be opened', h('p', null, err.message)).childNodes);
  }
}
