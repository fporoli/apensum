// The colorful look (organizations.settings.branding.colorful, Organization settings -> Look and feel): a color per
// navigation entry, and an icon on the buttons, chosen by what the button does. Pure, tested in colorful.test.mjs.

/** What a button does, as far as its icon goes. */
export type ButtonAction =
  | 'save' | 'cancel' | 'close' | 'delete' | 'add' | 'edit' | 'download' | 'upload' | 'send' | 'approve' | 'reject'
  | 'search' | 'print' | 'refresh' | 'copy' | 'back' | 'next' | 'view' | 'publish' | 'archive' | 'reset' | 'start'
  | 'stop' | 'login' | 'logout' | 'today' | 'settings' | 'lock' | 'unlock' | 'ai' | 'access';

/**
 * A text key's last segment (or its first word: `saveAnyway`, `runNow`, `addLabel`) says what a button with that text
 * does. Only keys whose segment is one of these count, so a heading or a status ("approved") never gives an icon.
 */
const SEGMENT_ACTIONS: Record<string, ButtonAction> = {
  save: 'save', apply: 'save', keep: 'save',
  cancel: 'cancel', discard: 'cancel', abort: 'cancel',
  close: 'close', done: 'close', dismiss: 'close', hide: 'close',
  delete: 'delete', remove: 'delete', clear: 'delete',
  add: 'add', new: 'add', create: 'add', another: 'add', invite: 'add', record: 'add',
  edit: 'edit', rename: 'edit', change: 'edit',
  download: 'download', export: 'download',
  upload: 'upload', import: 'upload', attach: 'upload',
  send: 'send', submit: 'send', forward: 'send', mail: 'send', share: 'send', resubmit: 'send', request: 'send',
  approve: 'approve', confirm: 'approve', accept: 'approve', acknowledge: 'approve', turnOn: 'approve', ok: 'approve',
  reject: 'reject', decline: 'reject', deny: 'reject', withdraw: 'reject',
  search: 'search', find: 'search',
  print: 'print', pdf: 'print',
  refresh: 'refresh', reload: 'refresh', retry: 'refresh', recalculate: 'refresh',
  copy: 'copy', duplicate: 'copy',
  back: 'back', previous: 'back', prev: 'back', toLogin: 'back',
  next: 'next', continue: 'next', forwardStep: 'next', go: 'next', goTo: 'next',
  open: 'view', show: 'view', view: 'view', inspect: 'view', preview: 'view', details: 'view',
  publish: 'publish', unpublish: 'archive',
  archive: 'archive', unarchive: 'reset',
  reset: 'reset', reopen: 'reset', restore: 'reset', undo: 'reset', resetAll: 'reset',
  start: 'start', run: 'start', play: 'start', checkIn: 'start',
  stop: 'stop', end: 'stop', checkOut: 'stop', pause: 'stop',
  login: 'login', signIn: 'login', signin: 'login',
  logout: 'logout', signOut: 'logout', signout: 'logout',
  today: 'today', thisMonth: 'today', thisWeek: 'today', thisYear: 'today',
  settings: 'settings', configure: 'settings', setUp: 'settings',
  lock: 'lock', unlock: 'unlock',
  choose: 'upload', review: 'view', shorten: 'edit',
  generate: 'ai', sectionAi: 'ai', sectionAiAgain: 'ai',
  access: 'access',
};

/** What a button labelled with this key's text does, or null. */
export function buttonActionOfKey(key: string): ButtonAction | null {
  const segment = key.slice(key.lastIndexOf('.') + 1);
  if (SEGMENT_ACTIONS[segment]) return SEGMENT_ACTIONS[segment];
  const first = /^[a-z]+/.exec(segment)?.[0];
  return first && first !== segment && SEGMENT_ACTIONS[first] ? SEGMENT_ACTIONS[first] : null;
}

/**
 * A dictionary's button texts by what they do. A text several keys share goes by most of them ("Speichern" is
 * `save` nine times and `addSession` once); a tie gets no icon.
 */
export function buttonActions(dictionary: Record<string, string>): Map<string, ButtonAction> {
  const votes = new Map<string, Map<ButtonAction, number>>();
  for (const [key, text] of Object.entries(dictionary)) {
    const action = buttonActionOfKey(key);
    if (!action || text.includes('{{')) continue;
    const label = normalizeLabel(text);
    if (!label) continue;
    const v = votes.get(label) ?? new Map<ButtonAction, number>();
    v.set(action, (v.get(action) ?? 0) + 1);
    votes.set(label, v);
  }
  const out = new Map<string, ButtonAction>();
  for (const [label, v] of votes) {
    const ranked = [...v].sort((a, b) => b[1] - a[1]);
    if (ranked.length === 1 || ranked[0][1] > ranked[1][1]) out.set(label, ranked[0][0]);
  }
  return out;
}

/** A button's text as it is looked up: trimmed, without a trailing ellipsis, case-insensitive. */
export function normalizeLabel(text: string): string {
  return text.replace(/\s*(…|\.\.\.)\s*$/, '').trim().toLowerCase();
}

/** The colors of the actions (light and dark mode alike: mid tones). */
export const ACTION_COLORS: Record<ButtonAction, string> = {
  save: '#16a34a', approve: '#16a34a', publish: '#16a34a', start: '#16a34a',
  cancel: '#64748b', close: '#64748b', back: '#64748b', logout: '#64748b',
  delete: '#dc2626', reject: '#dc2626', stop: '#dc2626',
  add: '#2563eb', send: '#2563eb', next: '#2563eb', login: '#2563eb',
  edit: '#d97706', reset: '#d97706', archive: '#a16207',
  download: '#0891b2', upload: '#0891b2', print: '#0891b2', copy: '#0891b2',
  search: '#7c3aed', view: '#7c3aed', refresh: '#7c3aed', settings: '#475569', today: '#db2777',
  lock: '#a16207', unlock: '#d97706', ai: '#9333ea', access: '#0d9488',
};

/** A color for each navigation entry, by its section; others (a new plugin's) by a hash of it. */
export const NAV_COLORS: Record<string, string> = {
  home: '#6366f1', myData: '#4f46e5', documents: '#ca8a04', notes: '#eab308',
  workTime: '#2563eb', absences: '#0d9488', timesheet: '#7c3aed', calendar: '#ef4444',
  time: '#0ea5e9', projectTimesheet: '#a855f7',
  news: '#f97316', directory: '#10b981', flows: '#3b82f6', approvals: '#22c55e', requests: '#3b82f6',
  balances: '#f59e0b', reports: '#ec4899', users: '#e11d48', invitations: '#84cc16',
  orgSettings: '#64748b', importExport: '#0f766e', audit: '#6b7280', adminWorkflows: '#d946ef',
  expenses: '#ea580c', expenseReports: '#f97316', expenseProcessing: '#c2410c', expensePayout: '#9a3412',
  billing: '#16a34a', hr: '#db2777', hrDashboard: '#be185d', hrReviews: '#c026d3', hrStatements: '#9d174d', hrplus: '#0891b2',
  roster: '#0284c7', whistle: '#dc2626', cases: '#7c3aed', casesTemplates: '#6d28d9',
};

const FALLBACK = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#84cc16'];

export function navColor(section: string): string {
  if (NAV_COLORS[section]) return NAV_COLORS[section];
  let h = 0;
  for (const ch of section) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}
