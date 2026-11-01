// Backup, sync between devices, and the passphrase lock.
import { BACKUP_FORMAT, MIN_PASSPHRASE, checkPassphrase, createKey, seal, unseal } from '../core/crypto.js';
import { syncFrom } from '../core/merge.js';
import { deliver, fullDate, h, notice } from './dom.js';

const MAX_BACKUP_BYTES = 100 * 1024 * 1024;

const passwordField = (label, name, autocomplete) => h('label', null, label,
  h('input', { name, type: 'password', autocomplete, required: true }));

// A busy form says so, because stretching a passphrase takes about a second.
function securityForm(app, { id, submit, onSubmit, children }) {
  const { view } = app;
  return h('form', {
    className: 'goal-form',
    novalidate: true,
    onSubmit: async (e) => {
      e.preventDefault();
      if (view.securityBusy) return;
      const fields = new FormData(e.target);
      view.securityBusy = id;
      view.securityMessage = null;
      app.render();
      try {
        view.securityMessage = { id, kind: 'done', ...(await onSubmit(fields)) };
      } catch (err) {
        view.securityMessage = { id, kind: 'refused', title: 'Not done', text: err.message };
      }
      view.securityBusy = null;
      await app.commit();
    },
  },
  children,
  h('button', { className: 'primary', type: 'submit', disabled: Boolean(view.securityBusy) }, view.securityBusy === id ? 'Working…' : submit));
}

const message = (view, id) => {
  const m = view.securityMessage;
  return m?.id === id ? notice(m.kind, m.title, h('p', null, m.text)) : null;
};

function backupSection(app) {
  const { state, view } = app;
  const last = state.meta.lastBackupAt;
  return h('section', null,
    h('h2', null, 'Backup and sync'),
    h('p', { className: 'muted' }, last ? `Last backup: ${fullDate(new Date(last).toISOString().slice(0, 10))}` : 'No backup yet.'),
    h('p', { className: 'muted' }, 'A backup is one encrypted file. Save it to iCloud Drive, then open it on your other device to combine the two. Keep a backup somewhere safe, because this device can lose its data.'),

    h('details', { className: 'more', open: view.openBackup === 'create', onToggle: (e) => { if (e.target.open) view.openBackup = 'create'; } },
      h('summary', null, h('span', null, 'Create an encrypted backup')),
      securityForm(app, {
        id: 'backup',
        submit: 'Create backup',
        children: [
          passwordField(`Backup passphrase, at least ${MIN_PASSPHRASE} characters`, 'pass', 'new-password'),
          passwordField('Type it again', 'again', 'new-password'),
          h('p', { className: 'muted' }, 'If you lose this passphrase, the backup cannot be opened by anyone.'),
          message(view, 'backup'),
        ],
        onSubmit: async (f) => {
          const pass = f.get('pass');
          checkPassphrase(pass);
          if (pass !== f.get('again')) throw new Error('The two passphrases do not match.');
          const envelope = await seal(await createKey(pass), BACKUP_FORMAT, { ...state, meta: undefined });
          const name = `finance-${new Date().toISOString().slice(0, 10)}.finbackup`;
          view.pendingBackup = new File([JSON.stringify(envelope)], name, { type: 'application/octet-stream' });
          return { title: 'Encrypted and ready', text: `Now save ${name} somewhere safe.` };
        },
      }),
      // A separate tap, because iPhones only open the share sheet straight after one, and
      // encrypting takes too long to count.
      view.pendingBackup && h('p', null, h('button', {
        className: 'primary',
        onClick: async () => {
          if (!(await deliver(view.pendingBackup))) return; // you cancelled, so nothing is recorded
          view.pendingBackup = null;
          state.meta.lastBackupAt = Date.now();
          view.securityMessage = { id: 'backup', kind: 'done', title: 'Backup saved', text: 'It holds everything in the app, encrypted.' };
          app.commit();
        },
      }, 'Save backup file'))),

    h('details', { className: 'more', open: view.openBackup === 'restore', onToggle: (e) => { if (e.target.open) view.openBackup = 'restore'; } },
      h('summary', null, h('span', null, 'Sync or restore from a backup')),
      securityForm(app, {
        id: 'restore',
        submit: 'Open backup',
        children: [
          h('label', null, 'Backup file', h('input', { name: 'file', type: 'file', required: true })),
          passwordField('Backup passphrase', 'pass', 'current-password'),
          h('p', { className: 'muted' }, 'This combines the backup with this device. For each item the newest edit is kept, and nothing newer here is lost.'),
          message(view, 'restore'),
        ],
        onSubmit: async (f) => {
          const file = f.get('file');
          if (!file?.size) throw new Error('Please choose a backup file.');
          if (file.size > MAX_BACKUP_BYTES) throw new Error('That file is too large to be a backup.');
          let envelope;
          try {
            envelope = JSON.parse(await file.text());
          } catch {
            throw new Error('This is not a backup file this app can read.');
          }
          const { data } = await unseal(envelope, f.get('pass'), BACKUP_FORMAT);
          const { state: merged, counts } = syncFrom(state, data);
          app.state = merged;
          return { title: 'Synced', text: `${counts.added} added, ${counts.updated} updated, ${counts.removed} removed, ${counts.unchanged} already up to date.` };
        },
      })));
}

function lockSection(app) {
  const { view } = app;
  return h('section', null,
    h('h2', null, 'Passphrase lock'),
    h('p', null, '✓ On. Your data is encrypted on this device.'),
    h('p', { className: 'muted' }, 'It locks itself after 2 minutes away or idle.'),
    h('p', null, h('button', { onClick: () => location.reload() }, 'Lock now')),
    h('details', { className: 'more' },
      h('summary', null, h('span', null, 'Change your passphrase')),
      securityForm(app, {
        id: 'change-pass',
        submit: 'Change passphrase',
        children: [
          passwordField('Current passphrase', 'current', 'current-password'),
          passwordField(`New passphrase, at least ${MIN_PASSPHRASE} characters`, 'pass', 'new-password'),
          passwordField('Type it again', 'again', 'new-password'),
          message(view, 'change-pass'),
        ],
        onSubmit: async (f) => {
          await app.verifyLock(f.get('current'));
          const pass = f.get('pass');
          checkPassphrase(pass);
          if (pass !== f.get('again')) throw new Error('The two new passphrases do not match.');
          app.lock = await createKey(pass);
          return { title: 'Passphrase changed', text: 'Backups you already made still use the passphrase they were made with.' };
        },
      })));
}

export const renderSecurity = (app) => [backupSection(app), lockSection(app)];

// The screen shown instead of the app while it is locked.
export function renderLockScreen({ onUnlock, onReset, error, busy }) {
  return [h('div', { className: 'lock-screen' },
    h('h1', null, 'Finance is locked'),
    h('form', {
      className: 'goal-form',
      novalidate: true,
      onSubmit: (e) => { e.preventDefault(); onUnlock(new FormData(e.target).get('pass')); },
    },
    h('label', null, 'Passphrase', h('input', { name: 'pass', type: 'password', autocomplete: 'current-password', autofocus: true })),
    error && h('p', { role: 'alert' }, `✕ ${error}`),
    h('button', { className: 'primary', type: 'submit', disabled: busy }, busy ? 'Unlocking…' : 'Unlock')),
    h('details', { className: 'more' },
      h('summary', null, h('span', null, 'Forgotten your passphrase?')),
      h('p', { className: 'muted' }, 'It cannot be recovered. You can delete the data on this device and restore from a backup.'),
      h('button', {
        className: 'danger',
        onClick: () => { if (window.confirm('Delete all finance data on this device? This cannot be undone.')) onReset(); },
      }, 'Delete all data')))];
}

// The first screen on a new device, or for data saved before the passphrase was required.
export function renderSetupScreen({ onCreate, error, busy }) {
  return [h('div', { className: 'lock-screen' },
    h('h1', null, 'Create your passphrase'),
    h('section', { className: 'card' },
      h('p', null, 'This encrypts your finances on this device, and you will need it each time the app opens.'),
      h('form', {
        className: 'goal-form',
        novalidate: true,
        onSubmit: (e) => { e.preventDefault(); const f = new FormData(e.target); onCreate(f.get('pass'), f.get('again')); },
      },
      passwordField(`Passphrase, at least ${MIN_PASSPHRASE} characters`, 'pass', 'new-password'),
      passwordField('Type it again', 'again', 'new-password'),
      notice('attention', 'There is no recovery', h('p', null, 'If you forget it, the data on this device is gone. Write it down somewhere safe, and keep a backup.')),
      error && h('p', { role: 'alert' }, `✕ ${error}`),
      h('button', { className: 'primary', type: 'submit', disabled: busy }, busy ? 'Encrypting…' : 'Create and continue'))))];
}
