// Starts the app, switches between screens and keeps the data saved. The screens are drawn
// again from the data after every change, which is simple and quick at this size.
import { createState, migrate } from './core/model.js';
import { clearState, loadState, saveState } from './store.js';
import { h, notice, svg } from './ui/dom.js';
import { renderAccounts } from './ui/accounts.js';
import { renderGoals } from './ui/goals.js';
import { renderImport } from './ui/import.js';
import { renderOverview } from './ui/overview.js';
import { renderSpending } from './ui/spending.js';

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
  view: {}, // what is open or selected on screen, kept apart from your data
  saveError: null,

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
      SCREENS[name].render(this),
    ].flat(Infinity).filter(Boolean));
    window.scrollTo(0, scroll);
  },

  // Call after any change to the data: saves it, then redraws.
  async commit() {
    try {
      await saveState(this.state);
      this.saveError = null;
    } catch (err) {
      this.saveError = err.message;
    }
    this.render();
  },

  async reset() {
    await clearState();
    this.state = createState();
    this.view = {};
    this.render();
  },
};

window.addEventListener('hashchange', () => { window.scrollTo(0, 0); app.render(); });

try {
  app.state = migrate((await loadState()) ?? createState());
} catch (err) {
  app.state = createState();
  app.saveError = err.message;
}
// Ask the browser not to clear this data when space runs low. It may decline.
navigator.storage?.persist?.().catch(() => {});
app.render();
