'use strict';

// UI logic. File work happens in the main process; this draws state and sends changes.
let state = null;
let rulesDraft = null;
let sourcesDraft = null;

const $ = (id) => document.getElementById(id);

const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/>',
  rules: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
};

function icon(name) {
  return `<span class="icon"><svg viewBox="0 0 24 24">${ICONS[name]}</svg></span>`;
}

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text == null ? '' : String(text);
  return d.innerHTML;
}

function baseName(p) { return p.split(/[\\/]/).pop(); }
function parentOf(p) { return p.replace(/[\\/][^\\/]*$/, ''); }

function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

function showPage(name) {
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === name));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
}

document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => showPage(b.dataset.page)));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => showPage(b.dataset.goto)));

// Put the icons into the nav buttons once.
document.querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = icon(el.dataset.icon); });

// Counts moves that have not been undone and happened at or after `sinceMs`.
function movedSince(sinceMs) {
  return state.recent.filter((e) => !e.undone && new Date(e.time).getTime() >= sinceMs).length;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function renderHome() {
  const watched = state.sources.filter((s) => s.enabled).length;
  const paused = state.paused;

  $('status-dot').classList.toggle('paused', paused);
  $('status-label').textContent = paused ? 'Paused' : 'Watching';

  $('hero-kicker').textContent = paused ? 'Paused' : 'Active';
  $('hero-kicker').classList.toggle('paused', paused);
  $('hero-title').textContent = paused ? 'Nothing is being moved' : `Watching ${plural(watched, 'folder')}`;
  $('hero-meta').textContent = state.settings.dryRun
    ? 'Dry run is on. Moves are shown but not made.'
    : `Files move ${Math.round(state.settings.delaySeconds / 60)} min after they arrive.`;
  $('pause-btn').textContent = paused ? 'Resume' : 'Pause';

  $('stat-today').textContent = movedSince(startOfToday());
  $('stat-week').textContent = movedSince(Date.now() - 7 * 24 * 60 * 60 * 1000);
  $('stat-rules').textContent = state.rules.filter((r) => r.enabled).length;

  const recent = state.recent.slice(0, 5);
  $('recent-list').innerHTML = recent.length
    ? recent.map((e) => `
        <li class="row-item">
          <span class="file-badge">${icon('file')}</span>
          <div class="row-main">
            <div class="row-title">${esc(baseName(e.to))}</div>
            <div class="row-sub">Moved to ${esc(parentOf(e.to))}</div>
          </div>
          ${e.undone
            ? '<span class="tag-undone">Undone</span>'
            : `<button class="btn btn-outline" data-undo="${esc(e.id)}">${icon('undo')}Undo</button>`}
        </li>`).join('')
    : '<li class="empty">No moves yet. New downloads will show up here.</li>';
}

// Shows where a file saved today would land, e.g. "…\Pictures\2026\10".
function subExample(r) {
  if (!r.subfolders) return '';
  const now = new Date();
  const parts = [baseName(r.destination || '') || 'Folder', String(now.getFullYear())];
  if (r.subfolders === 'month') parts.push(String(now.getMonth() + 1).padStart(2, '0'));
  return `e.g. ${parts.join('\\')}`;
}

function ruleCard(r, i) {
  const noDest = !r.destination;
  return `
    <div class="card rule" data-index="${i}">
      <div class="rule-top">
        <input type="text" class="rule-name" value="${esc(r.name)}" aria-label="Rule name">
        <label class="switch-label">
          <input type="checkbox" class="switch rule-enabled" ${r.enabled ? 'checked' : ''} aria-label="Enabled">
        </label>
        <div class="rule-actions">
          <button class="btn btn-ghost move-up" title="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
          <button class="btn btn-ghost move-down" title="Move down" ${i === rulesDraft.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
          <button class="btn btn-ghost btn-danger delete-rule" title="Delete rule">${icon('trash')}</button>
        </div>
      </div>
      <div class="rule-body">
        <div class="field">
          <span class="field-label">File types</span>
          <input type="text" class="input rule-ext" value="${esc(r.extensions.join(', '))}" placeholder=".pdf, .docx">
        </div>
        <div class="field">
          <span class="field-label">Name contains <span class="optional">(optional)</span></span>
          <input type="text" class="input rule-pattern" value="${esc(r.namePattern || '')}" placeholder="invoice">
        </div>
        <div class="field field-full">
          <span class="field-label">Move to</span>
          <div class="dest">
            <span class="dest-path ${noDest ? 'none' : ''}">${noDest ? 'No folder chosen. This rule does nothing yet.' : esc(r.destination)}</span>
            <button class="btn btn-outline choose-dest">${icon('folder')}${noDest ? 'Choose folder' : 'Change'}</button>
          </div>
        </div>
        <div class="field field-full">
          <span class="field-label">Then sort into</span>
          <div class="sub-row">
            <div class="segmented" role="radiogroup" aria-label="Dated subfolders">
              ${[['', 'Just that folder'], ['year', 'Year'], ['month', 'Year and month']].map(([v, label]) => `
                <label><input type="radio" class="rule-sub" name="sub-${i}" value="${v}" ${(r.subfolders || '') === v ? 'checked' : ''}><span>${label}</span></label>`).join('')}
            </div>
            <span class="sub-example">${esc(subExample(r))}</span>
          </div>
        </div>
      </div>
    </div>`;
}

function renderRules() {
  rulesDraft = rulesDraft || structuredClone(state.rules);
  $('rules-list').innerHTML = rulesDraft.length
    ? rulesDraft.map(ruleCard).join('')
    : '<div class="card empty">No rules yet. Add one to start sorting.</div>';
  runTest();
}

// Pull what is on screen back into the draft, so reorders and edits are not lost.
function readRulesFromDom() {
  document.querySelectorAll('.rule').forEach((card, i) => {
    const r = rulesDraft[i];
    r.name = card.querySelector('.rule-name').value.trim() || r.name;
    r.enabled = card.querySelector('.rule-enabled').checked;
    r.extensions = card.querySelector('.rule-ext').value
      .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
      .map((e) => (e.startsWith('.') ? e : `.${e}`));
    r.namePattern = card.querySelector('.rule-pattern').value.trim();
    r.subfolders = card.querySelector('.rule-sub:checked')?.value || '';
  });
}

function runTest() {
  const name = $('test-name').value.trim();
  const out = $('test-result');
  out.className = 'test-result';
  if (!name) { out.textContent = 'Type a file name to see where it would go.'; return; }
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  const hit = (rulesDraft || state.rules).find((r) => r.enabled && r.extensions.includes(ext) &&
    (!r.namePattern || name.toLowerCase().includes(r.namePattern.toLowerCase())));
  if (!hit) {
    out.classList.add('miss');
    out.textContent = 'No rule matches this file. It will be left alone.';
  } else if (!hit.destination) {
    out.classList.add('miss');
    out.textContent = `Matches "${hit.name}", but no folder is chosen yet.`;
  } else {
    out.classList.add('hit');
    const sub = hit.subfolders ? ` ${subExample(hit).replace('e.g. ', '(into ')})` : '';
    out.textContent = `Would move to ${hit.destination}${sub} (rule: ${hit.name})`;
  }
}

function renderHistory() {
  $('history-body').innerHTML = state.recent.length
    ? state.recent.map((e) => `
        <tr>
          <td class="muted">${esc(new Date(e.time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</td>
          <td class="name" title="${esc(baseName(e.to))}">${esc(baseName(e.to))}</td>
          <td class="muted">${esc(parentOf(e.to))}</td>
          <td class="action">${e.undone
            ? '<span class="tag-undone">Undone</span>'
            : `<button class="btn btn-outline" data-undo="${esc(e.id)}">${icon('undo')}Undo</button>`}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="empty">No moves yet.</td></tr>';
}

// What the update row says for each updater status.
const UPDATE_TEXT = {
  unavailable: 'Updates only work in the installed app.',
  idle: 'Not checked yet.',
  checking: 'Checking for updates…',
  'up-to-date': "You're on the latest version.",
  downloading: 'Downloading version {v}…',
  ready: 'Version {v} is ready to install.',
  error: "Couldn't check for updates. Try again later.",
};

function renderUpdate() {
  const { status, version, current } = state.update;
  $('update-version').textContent = `Folder Tidy ${current}`;
  $('update-status').textContent = UPDATE_TEXT[status].replace('{v}', version || '');
  const btn = $('update-btn');
  btn.textContent = status === 'ready' ? 'Restart and update' : 'Check for updates';
  btn.disabled = ['unavailable', 'checking', 'downloading'].includes(status);
}

$('update-btn').addEventListener('click', async () => {
  if (state.update.status === 'ready') return window.folderTidy.installUpdate();
  state = await window.folderTidy.checkUpdates();
  renderUpdate();
});

const NOTIFY_HELP = {
  each: 'A pop-up every time a file moves.',
  daily: 'One pop-up a day with what moved and anything that needs a look.',
  off: 'No pop-ups. Everything is still in History.',
};

function notifyMode() {
  return document.querySelector('[name="s-notify"]:checked')?.value || 'daily';
}

function renderNotifyHelp() {
  $('notify-help').textContent = NOTIFY_HELP[notifyMode()];
  $('digest-time-row').classList.toggle('hidden', notifyMode() !== 'daily');
}

document.querySelectorAll('[name="s-notify"]').forEach((r) => r.addEventListener('change', renderNotifyHelp));

function renderSettings() {
  $('s-login').checked = state.settings.startWithWindows;
  $('s-dry').checked = state.settings.dryRun;
  $('s-update').checked = state.settings.autoUpdate;
  document.querySelectorAll('[name="s-notify"]').forEach((r) => { r.checked = r.value === state.settings.notifications; });
  $('s-digest-time').value = state.settings.digestTime;
  renderNotifyHelp();
  renderUpdate();
  $('s-delay').value = state.settings.delaySeconds;
  $('s-delay-label').textContent = `${Math.round(state.settings.delaySeconds / 60)} min`;

  sourcesDraft = sourcesDraft || structuredClone(state.sources);
  $('sources-list').innerHTML = sourcesDraft.length
    ? sourcesDraft.map((s, i) => `
        <li class="folder-row">
          <span class="file-badge">${icon('folder')}</span>
          <div class="row-main">
            <div class="row-title">${esc(baseName(s.path))}</div>
            <div class="row-sub">${esc(s.path)}</div>
          </div>
          <input type="checkbox" class="switch src-enabled" data-index="${i}" ${s.enabled ? 'checked' : ''} aria-label="Watch this folder">
          <button class="btn btn-ghost btn-danger remove-source" data-index="${i}" title="Stop watching">${icon('x')}</button>
        </li>`).join('')
    : '<li class="empty">No folders are watched. Add one below.</li>';
}

function renderAll() {
  renderHome();
  renderRules();
  renderHistory();
  renderSettings();
  renderCheck();
}

async function refresh() {
  state = await window.folderTidy.getState();
  rulesDraft = null;
  sourcesDraft = null;
  renderAll();
  if (!state.settings.setupDone && !setup) openSetup();
}

// ---------- First-run setup ----------

// Three steps: folders to watch, where things go, then a safe start. Nothing is saved
// until Finish, and it ends on a Check so you see what would happen straight away.
let setup = null;

const SETUP_STEPS = [
  { title: 'Which folders should I keep tidy?', sub: 'New files that land here get sorted. Subfolders are always left alone.' },
  { title: 'Where should things go?', sub: 'Pick a folder for each type, or turn off the ones you don\'t need. You can change these later in Rules.' },
  { title: 'Start safely', sub: 'Nothing is ever deleted, and every move can be undone.' },
];

function openSetup() {
  setup = {
    step: 0,
    sources: structuredClone(state.sources),
    rules: structuredClone(state.rules),
    dryRun: true,
    startWithWindows: true,
  };
  $('setup').hidden = false;
  renderSetup();
}

function setupRow(iconName, title, sub, control) {
  return `
    <li class="row-item">
      <span class="file-badge">${icon(iconName)}</span>
      <div class="row-main">
        <div class="row-title">${esc(title)}</div>
        <div class="row-sub" title="${esc(sub)}">${esc(sub)}</div>
      </div>
      ${control}
    </li>`;
}

function renderSetup() {
  const { step } = setup;
  $('setup-steps').innerHTML = SETUP_STEPS.map((_, i) => `<span class="${i <= step ? 'on' : ''}"></span>`).join('');
  $('setup-title').textContent = SETUP_STEPS[step].title;
  $('setup-sub').textContent = SETUP_STEPS[step].sub;
  $('setup-back').classList.toggle('invisible', step === 0);
  $('setup-next').textContent = step === SETUP_STEPS.length - 1 ? 'Finish and check my folders' : 'Next';

  if (step === 0) {
    $('setup-body').innerHTML = `<ul class="rows">${setup.sources.map((s, i) => setupRow('folder', baseName(s.path), s.path,
      `<input type="checkbox" class="switch setup-src" data-i="${i}" ${s.enabled ? 'checked' : ''} aria-label="Watch ${esc(baseName(s.path))}">`)).join('')}</ul>
      <button id="setup-add-src" class="btn btn-outline">${icon('plus')}Add folder</button>`;
  } else if (step === 1) {
    $('setup-body').innerHTML = `<ul class="rows">${setup.rules.map((r, i) => `
      <li class="row-item setup-rule">
        <input type="checkbox" class="switch setup-rule-on" data-i="${i}" ${r.enabled ? 'checked' : ''} aria-label="Use ${esc(r.name)}">
        <div class="row-main">
          <div class="row-title">${esc(r.name)} <span class="muted">${esc(r.extensions.slice(0, 4).join(' '))}${r.extensions.length > 4 ? ' …' : ''}</span></div>
          <div class="row-sub" title="${esc(r.destination)}">${r.destination ? esc(r.destination) : 'No folder yet'}</div>
        </div>
        <button class="btn btn-light setup-dest" data-i="${i}">${r.destination ? 'Change' : 'Choose'}</button>
      </li>`).join('')}</ul>`;
  } else {
    $('setup-body').innerHTML = `
      <label class="choice"><input type="radio" name="setup-mode" value="dry" ${setup.dryRun ? 'checked' : ''}>
        <span><strong>Dry run first</strong> (recommended)<small>For now it only shows what it would move. Turn it off in Settings when you're happy.</small></span></label>
      <label class="choice"><input type="radio" name="setup-mode" value="live" ${setup.dryRun ? '' : 'checked'}>
        <span><strong>Start tidying now</strong><small>New files move a few minutes after they arrive.</small></span></label>
      <label class="setting"><span><strong>Start with Windows</strong><small>Runs quietly in the tray when you sign in.</small></span>
        <input type="checkbox" class="switch" id="setup-login" ${setup.startWithWindows ? 'checked' : ''}></label>`;
  }
}

$('setup-body').addEventListener('change', (e) => {
  const t = e.target;
  if (t.classList.contains('setup-src')) setup.sources[Number(t.dataset.i)].enabled = t.checked;
  if (t.classList.contains('setup-rule-on')) setup.rules[Number(t.dataset.i)].enabled = t.checked;
  if (t.name === 'setup-mode') setup.dryRun = t.value === 'dry';
  if (t.id === 'setup-login') setup.startWithWindows = t.checked;
});

$('setup-body').addEventListener('click', async (e) => {
  if (e.target.closest('#setup-add-src')) {
    const folder = await window.folderTidy.pickFolder('Choose a folder to keep tidy');
    if (folder && !setup.sources.some((s) => s.path.toLowerCase() === folder.toLowerCase())) {
      setup.sources.push({ path: folder, enabled: true });
    }
    renderSetup();
  }
  const dest = e.target.closest('.setup-dest');
  if (dest) {
    const r = setup.rules[Number(dest.dataset.i)];
    const folder = await window.folderTidy.pickFolder(`Choose where "${r.name}" go`);
    if (folder) { r.destination = folder; r.enabled = true; }
    renderSetup();
  }
});

$('rerun-setup').addEventListener('click', openSetup);

$('setup-back').addEventListener('click', () => { setup.step -= 1; renderSetup(); });

$('setup-next').addEventListener('click', async () => {
  if (setup.step < SETUP_STEPS.length - 1) { setup.step += 1; renderSetup(); return; }
  $('setup-next').disabled = true;
  await window.folderTidy.saveSources(setup.sources);
  await window.folderTidy.saveRules(setup.rules);
  await window.folderTidy.saveSettings({ dryRun: setup.dryRun, startWithWindows: setup.startWithWindows, setupDone: true });
  $('setup').hidden = true;
  $('setup-next').disabled = false;
  await refresh();
  await runCheck();
});

// ---------- Home ----------

$('pause-btn').addEventListener('click', async () => {
  state = await window.folderTidy.setPaused(!state.paused);
  renderHome();
});

// ---------- Rules ----------

$('add-rule').addEventListener('click', () => {
  readRulesFromDom();
  rulesDraft.push({ id: `rule-${Date.now()}`, name: 'New rule', enabled: true, extensions: [], namePattern: '', destination: '' });
  renderRules();
  const last = document.querySelectorAll('.rule-name');
  last[last.length - 1]?.focus();
});

$('rules-list').addEventListener('click', async (e) => {
  const card = e.target.closest('.rule');
  if (!card) return;
  const i = Number(card.dataset.index);
  const btn = e.target.closest('button');
  if (!btn) return;
  readRulesFromDom();

  if (btn.classList.contains('delete-rule')) {
    rulesDraft.splice(i, 1);
  } else if (btn.classList.contains('move-up') && i > 0) {
    [rulesDraft[i - 1], rulesDraft[i]] = [rulesDraft[i], rulesDraft[i - 1]];
  } else if (btn.classList.contains('move-down') && i < rulesDraft.length - 1) {
    [rulesDraft[i + 1], rulesDraft[i]] = [rulesDraft[i], rulesDraft[i + 1]];
  } else if (btn.classList.contains('choose-dest')) {
    const folder = await window.folderTidy.pickFolder(`Choose where "${rulesDraft[i].name}" files go`);
    if (!folder) return;
    rulesDraft[i].destination = folder;
  } else {
    return;
  }
  renderRules();
});

$('rules-list').addEventListener('input', (e) => {
  readRulesFromDom();
  if (e.target.classList.contains('rule-sub')) {
    const card = e.target.closest('.rule');
    card.querySelector('.sub-example').textContent = subExample(rulesDraft[Number(card.dataset.index)]);
  }
  runTest();
});

// ---------- Drag a file onto a rule ----------

// Dropping a file on a rule adds its type to that rule (unsaved until "Save rules").
// Dropping it on "Try a file name" fills in the name. Either way the test shows where it goes.
function droppedName(e) {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return null;
  return baseName(window.folderTidy.pathForFile(file) || file.name);
}

function dropTarget(e) {
  return e.target.closest?.('#rules .rule, #rules .test-card');
}

document.addEventListener('dragover', (e) => {
  e.preventDefault(); // Stops Electron opening the file in the window.
  document.querySelectorAll('.drop-over').forEach((el) => el.classList.remove('drop-over'));
  dropTarget(e)?.classList.add('drop-over');
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.querySelectorAll('.drop-over').forEach((el) => el.classList.remove('drop-over'));
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  document.querySelectorAll('.drop-over').forEach((el) => el.classList.remove('drop-over'));
  const target = dropTarget(e);
  const name = droppedName(e);
  if (!target || !name) return;

  if (target.classList.contains('rule')) {
    readRulesFromDom();
    const i = Number(target.dataset.index);
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
    if (ext && !rulesDraft[i].extensions.includes(ext)) rulesDraft[i].extensions.push(ext);
    renderRules();
    document.querySelector(`.rule[data-index="${i}"]`)?.classList.add('just-added');
  }
  $('test-name').value = name;
  runTest();
});

$('save-rules').addEventListener('click', async () => {
  readRulesFromDom();
  state = await window.folderTidy.saveRules(rulesDraft);
  rulesDraft = null;
  renderRules();
  renderHome();
});

$('test-name').addEventListener('input', () => {
  readRulesFromDom();
  runTest();
});

// ---------- History ----------

document.body.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-undo]');
  if (!btn) return;
  const result = await window.folderTidy.undo(btn.dataset.undo);
  if (!result.ok) alert(result.reason);
  await refresh();
});

// ---------- Settings ----------

$('s-delay').addEventListener('input', () => {
  $('s-delay-label').textContent = `${Math.round($('s-delay').value / 60)} min`;
});

$('add-source').addEventListener('click', async () => {
  const folder = await window.folderTidy.pickFolder('Choose a folder to watch');
  if (!folder) return;
  if (sourcesDraft.some((s) => s.path.toLowerCase() === folder.toLowerCase())) return;
  sourcesDraft.push({ path: folder, enabled: true });
  renderSettings();
});

$('sources-list').addEventListener('click', (e) => {
  const btn = e.target.closest('.remove-source');
  if (!btn) return;
  sourcesDraft.splice(Number(btn.dataset.index), 1);
  renderSettings();
});

$('save-settings').addEventListener('click', async () => {
  document.querySelectorAll('.src-enabled').forEach((cb) => {
    sourcesDraft[Number(cb.dataset.index)].enabled = cb.checked;
  });
  await window.folderTidy.saveSources(sourcesDraft);
  state = await window.folderTidy.saveSettings({
    startWithWindows: $('s-login').checked,
    dryRun: $('s-dry').checked,
    autoUpdate: $('s-update').checked,
    notifications: notifyMode(),
    digestTime: $('s-digest-time').value || '18:00',
    delaySeconds: Number($('s-delay').value),
  });
  await refresh();
});

// ---------- Check ----------

let check = null;          // the last check, from the main process
let moveResults = null;    // what happened when "Move these" was pressed, by file path
let binResults = null;     // what happened when "Send to Recycle Bin" was pressed, by file path

const CLUTTER_KINDS = { duplicate: 'Duplicate', installer: 'Old installer', partial: 'Unfinished' };

function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Short labels for why a file was left. "fixable" ones can be sorted out with a rule change.
const REASONS = {
  'no-rule': { label: 'No rule', fixable: true },
  'no-extension': { label: 'No file type' },
  'no-destination': { label: 'No folder set', fixable: true },
  'rule-off': { label: 'Rule off', fixable: true },
  'name-mismatch': { label: 'Name filter', fixable: true },
  'already-there': { label: 'Already sorted' },
  downloading: { label: 'Downloading' },
  'too-new': { label: 'Just changed' },
  locked: { label: 'In use' },
  protected: { label: 'Protected' },
  unreadable: { label: 'Unreadable' },
};

// Fixable reasons first, so the files you can do something about are at the top.
function reasonOrder(r) {
  return REASONS[r.reason]?.fixable ? 0 : 1;
}

function renderCheck() {
  $('check-empty').hidden = !!check;
  $('check-results').hidden = !check;
  if (!check) return;

  const when = new Date(check.time).toLocaleTimeString([], { timeStyle: 'short' });
  $('check-meta').textContent = `Checked at ${when}. ${plural(check.toMove.length, 'file')} ready to move, ${check.skipped.length} left alone.`
    + (check.dryRun ? ' Dry run is on, so nothing will actually move.' : '');

  $('move-title').textContent = `Ready to move (${check.toMove.length})`;
  $('move-list').innerHTML = check.toMove.length
    ? check.toMove.map((r) => {
        const done = moveResults?.[r.file];
        const status = !done ? ''
          : done.ok ? `<span class="result-ok">${done.dryRun ? 'Would move' : 'Moved'}</span>`
          : `<span class="result-fail">${esc(done.message)}</span>`;
        return `
          <li class="row-item">
            <label class="check-row">
              <input type="checkbox" class="move-pick" value="${esc(r.file)}" ${done ? 'disabled' : 'checked'}>
              <span class="file-badge">${icon('file')}</span>
              <div class="row-main">
                <div class="row-title">${esc(baseName(r.file))}</div>
                <div class="row-sub">${esc(r.message)}</div>
              </div>
            </label>
            ${status}
          </li>`;
      }).join('')
    : '<li class="empty">Nothing to move right now.</li>';
  updateMoveButton();

  $('clutter-card').hidden = check.clutter.length === 0;
  const clutterSize = check.clutter.reduce((sum, c) => sum + c.size, 0);
  $('clutter-title').textContent = `Old clutter (${check.clutter.length}, ${formatSize(clutterSize)})`;
  $('clutter-list').innerHTML = check.clutter.map((c) => {
    const done = binResults?.[c.file];
    const status = !done ? `<span class="kind-tag">${CLUTTER_KINDS[c.kind]}</span>`
      : done.ok ? `<span class="result-ok">${done.dryRun ? 'Would bin' : 'Binned'}</span>`
      : `<span class="result-fail">${esc(done.message)}</span>`;
    return `
      <li class="row-item">
        <label class="check-row">
          <input type="checkbox" class="bin-pick" value="${esc(c.file)}" ${done ? 'disabled' : 'checked'}>
          <span class="file-badge">${icon('file')}</span>
          <div class="row-main">
            <div class="row-title" title="${esc(c.file)}">${esc(baseName(c.file))}</div>
            <div class="row-sub">${esc(c.message)} · ${formatSize(c.size)}</div>
          </div>
        </label>
        ${status}
      </li>`;
  }).join('');
  updateBinButton();

  $('suggest-card').hidden = check.suggestions.length === 0;
  $('suggest-list').innerHTML = check.suggestions.map((s, i) => `
    <li class="row-item">
      <span class="file-badge">${icon('rules')}</span>
      <div class="row-main">
        <div class="row-title">${s.kind === 'extend'
          ? `Add ${esc(s.extensions.join(', '))} to "${esc(s.name)}"`
          : `New rule: ${esc(s.name)} (${esc(s.extensions.join(', '))})`}</div>
        <div class="row-sub">${plural(s.count, 'file')}, such as ${esc(s.examples.join(', '))}</div>
      </div>
      <button class="btn btn-outline" data-suggest="${i}">${icon('plus')}${s.kind === 'extend' ? 'Add' : 'Add rule'}</button>
    </li>`).join('');

  const skipped = [...check.skipped].sort((a, b) => reasonOrder(a) - reasonOrder(b));
  $('skip-title').textContent = `Left alone (${skipped.length})`;
  $('skip-list').innerHTML = skipped.length
    ? skipped.map((r) => {
        const reason = REASONS[r.reason] || { label: r.reason };
        return `
          <li class="row-item">
            <span class="file-badge">${icon('file')}</span>
            <div class="row-main">
              <div class="row-title" title="${esc(r.file)}">${esc(baseName(r.file))}</div>
              <div class="row-sub">${esc(r.message)}</div>
            </div>
            <span class="reason ${reason.fixable ? 'fixable' : ''}">${esc(reason.label)}</span>
          </li>`;
      }).join('')
    : '<li class="empty">Every file has somewhere to go.</li>';
}

function pickedFiles() {
  return [...document.querySelectorAll('.move-pick:checked:not(:disabled)')].map((cb) => cb.value);
}

function updateMoveButton() {
  const n = pickedFiles().length;
  $('move-checked').disabled = n === 0;
  $('move-checked').textContent = check?.dryRun ? `Try ${plural(n, 'file')} (dry run)` : `Move ${plural(n, 'file')}`;
}

function pickedClutter() {
  return [...document.querySelectorAll('.bin-pick:checked:not(:disabled)')].map((cb) => cb.value);
}

function updateBinButton() {
  const picked = pickedClutter();
  $('bin-checked').disabled = picked.length === 0;
  $('bin-checked').textContent = picked.length
    ? `${check.dryRun ? 'Try binning' : 'Bin'} ${plural(picked.length, 'file')}`
    : 'Send to Recycle Bin';
}

$('clutter-list').addEventListener('change', updateBinButton);

$('bin-checked').addEventListener('click', async () => {
  const files = pickedClutter();
  if (!files.length) return;
  $('bin-checked').disabled = true;
  const results = await window.folderTidy.binFiles(files);
  binResults = { ...(binResults || {}), ...Object.fromEntries(results.map((r) => [r.file, r])) };
  renderCheck();
});

async function runCheck() {
  showPage('check');
  $('run-check').disabled = true;
  $('run-check').textContent = 'Checking…';
  try {
    check = await window.folderTidy.checkNow();
    moveResults = null;
    binResults = null;
    renderCheck();
  } finally {
    $('run-check').disabled = false;
    $('run-check').textContent = 'Check again';
  }
}

$('check-btn').addEventListener('click', runCheck);
$('run-check').addEventListener('click', runCheck);
$('move-list').addEventListener('change', updateMoveButton);

$('move-checked').addEventListener('click', async () => {
  const files = pickedFiles();
  if (!files.length) return;
  $('move-checked').disabled = true;
  const results = await window.folderTidy.moveChecked(files);
  moveResults = { ...(moveResults || {}), ...Object.fromEntries(results.map((r) => [r.file, r])) };
  renderCheck();
});

// Applies a suggestion to the saved rules, then checks again so the lists update.
$('suggest-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-suggest]');
  if (!btn) return;
  const s = check.suggestions[Number(btn.dataset.suggest)];
  const rules = structuredClone(state.rules);

  if (s.kind === 'extend') {
    const rule = rules.find((r) => r.id === s.ruleId);
    rule.extensions.push(...s.extensions.filter((ext) => !rule.extensions.includes(ext)));
  } else {
    const folder = await window.folderTidy.pickFolder(`Choose where "${s.name}" go`);
    if (!folder) return;
    rules.push({ id: `rule-${Date.now()}`, name: s.name, enabled: true, extensions: s.extensions, namePattern: '', destination: folder });
  }

  state = await window.folderTidy.saveRules(rules);
  rulesDraft = null;
  renderRules();
  renderHome();
  await runCheck();
});

window.folderTidy.onRunCheck(runCheck);
window.folderTidy.onShowPage(showPage);

// A background move only changes home and history. Rule and settings drafts are kept,
// so unsaved edits are not lost while you are working.
window.folderTidy.onStateChanged(async () => {
  state = await window.folderTidy.getState();
  renderHome();
  renderHistory();
  renderUpdate();
});
refresh();
