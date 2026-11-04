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
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  broom: '<path d="M14 4l6 6M17 7l-6 6"/><path d="M11 13l-6 1-2 7 7-2 1-6"/><path d="M6 16l2 2"/>',
  archive: '<path d="M3 4h18v4H3z"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>',
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
  if (state.stats) renderWeek();
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

// Mirrors lib/naming.js, so the rule card can show what a name would become.
function cleanName(fileName) {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot) : '';
  const before = ext ? fileName.slice(0, dot) : fileName;
  const base = before
    .replace(/^copy of\s+/i, '')
    .replace(/\s*-\s*copy(\s*\(\d+\))?$/i, '')
    .replace(/\s*\(\d+\)$/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s._-]+|[\s_-]+$/g, '');
  return (base || before) + ext.toLowerCase();
}

function renameTo(fileName, r) {
  let name = fileName;
  if (r.cleanName) name = cleanName(name);
  if (r.datePrefix && !/^\d{4}-\d{2}-\d{2}/.test(name)) {
    const d = new Date();
    name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${name}`;
  }
  return name;
}

function renameExample(r) {
  if (!r.cleanName && !r.datePrefix) return '';
  const sample = r.cleanName ? 'Brief - Copy (2).pdf' : 'Brief.pdf';
  return `e.g. ${sample} becomes ${renameTo(sample, r)}`;
}

// The extra conditions on a rule, in words.
function conditionText(r) {
  const parts = [];
  if (r.minSizeMB > 0) parts.push(`over ${r.minSizeMB} MB`);
  if (r.olderThanDays > 0) parts.push(`older than ${plural(r.olderThanDays, 'day')}`);
  return parts.join(' and ');
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
          <span class="field-label field-label-row">File types
            <label class="tick"><input type="checkbox" class="rule-any" ${r.anyType ? 'checked' : ''}>Any type</label></span>
          <input type="text" class="input rule-ext" value="${esc(r.anyType ? '' : r.extensions.join(', '))}" placeholder="${r.anyType ? 'Every file type' : '.pdf, .docx'}" ${r.anyType ? 'disabled' : ''}>
        </div>
        <div class="field">
          <span class="field-label">Name contains <span class="optional">(optional)</span></span>
          <input type="text" class="input rule-pattern" value="${esc(r.namePattern || '')}" placeholder="invoice">
        </div>
        <div class="field">
          <span class="field-label">Bigger than <span class="optional">(optional)</span></span>
          <span class="unit-field"><input type="number" min="0" step="1" class="input num-input rule-size" value="${r.minSizeMB || ''}" placeholder="Any"> MB</span>
        </div>
        <div class="field">
          <span class="field-label">Older than <span class="optional">(optional, Check only)</span></span>
          <span class="unit-field"><input type="number" min="0" step="1" class="input num-input rule-age" value="${r.olderThanDays || ''}" placeholder="Any"> days</span>
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
        <div class="field field-full">
          <span class="field-label">Rename <span class="optional">(optional, undo puts the old name back)</span></span>
          <div class="sub-row">
            <label class="tick"><input type="checkbox" class="rule-clean" ${r.cleanName ? 'checked' : ''}>Tidy the name</label>
            <label class="tick"><input type="checkbox" class="rule-date" ${r.datePrefix ? 'checked' : ''}>Add the date to the front</label>
            <span class="sub-example rename-example">${esc(renameExample(r))}</span>
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
    r.anyType = card.querySelector('.rule-any').checked;
    if (!r.anyType) {
      r.extensions = card.querySelector('.rule-ext').value
        .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
        .map((e) => (e.startsWith('.') ? e : `.${e}`));
    }
    r.namePattern = card.querySelector('.rule-pattern').value.trim();
    r.minSizeMB = Math.max(0, Math.round(Number(card.querySelector('.rule-size').value) || 0));
    r.olderThanDays = Math.max(0, Math.round(Number(card.querySelector('.rule-age').value) || 0));
    r.subfolders = card.querySelector('.rule-sub:checked')?.value || '';
    r.cleanName = card.querySelector('.rule-clean').checked;
    r.datePrefix = card.querySelector('.rule-date').checked;
  });
}

function runTest() {
  const name = $('test-name').value.trim();
  const out = $('test-result');
  out.className = 'test-result';
  if (!name) { out.textContent = 'Type a file name to see where it would go.'; return; }
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  // A typed name has no size or age, so rules with those conditions are shown as "if".
  const hit = (rulesDraft || state.rules).find((r) => r.enabled && (r.anyType || r.extensions.includes(ext)) &&
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
    const newName = renameTo(name, hit);
    const as = newName !== name ? ` as ${newName}` : '';
    const cond = conditionText(hit);
    out.textContent = `Would move to ${hit.destination}${sub}${as} (rule: ${hit.name})${cond ? `, if it's ${cond}` : ''}`;
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
  $('source-suggest').innerHTML = suggestButtons(sourcesDraft);
}

// One-click buttons for common folders, such as the Desktop, that aren't in the list yet.
function suggestButtons(sources) {
  return (state.suggestedSources || [])
    .filter((p) => !sources.some((s) => s.path.toLowerCase() === p.toLowerCase()))
    .map((p) => `<button class="btn btn-light" data-add-source="${esc(p)}">${icon('plus')}${esc(baseName(p))}</button>`).join('');
}

// ---------- This week ----------

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// A thin bar per day, rounded at the top only, with a hover title and the peak labelled.
function dayChart(days) {
  const w = 700, h = 180, top = 22, bottom = 26, gap = 18;
  const plot = h - top - bottom;
  const max = Math.max(1, ...days.map((d) => d.count));
  const bw = (w - gap * (days.length - 1)) / days.length;
  const peak = days.reduce((best, d, i) => (d.count > days[best].count ? i : best), 0);
  const today = days.length - 1;
  const bars = days.map((d, i) => {
    const x = i * (bw + gap);
    const bh = d.count ? Math.max(4, (d.count / max) * plot) : 0;
    const y = top + plot - bh;
    const r = Math.min(4, bh / 2);
    const day = DAY_NAMES[new Date(d.date).getDay()];
    const label = i === today ? 'Today' : day;
    const tip = `${label}: ${plural(d.count, 'file')}${d.bytes ? `, ${formatSize(d.bytes)}` : ''}`;
    // Path with rounded top corners and a square base sitting on the baseline.
    const bar = bh ? `<path class="bar${i === today ? ' today' : ''}" d="M${x},${top + plot} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${top + plot} Z"/>` : '';
    const value = d.count && i === peak ? `<text class="bar-value" x="${x + bw / 2}" y="${y - 6}">${d.count}</text>` : '';
    return `<g><title>${esc(tip)}</title><rect class="hit" x="${x - gap / 2}" y="0" width="${bw + gap}" height="${h}"/>${bar}${value}
      <text class="axis-label${i === today ? ' strong' : ''}" x="${x + bw / 2}" y="${h - 6}">${label}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Files sorted on each of the last 7 days">
    <line class="baseline" x1="0" x2="${w}" y1="${top + plot + 0.5}" y2="${top + plot + 0.5}"/>${bars}</svg>`;
}

// A row with a thin horizontal bar showing its share of the biggest row.
function shareRow(title, count, max, sub = '', display = count) {
  const pct = max ? Math.max(2, (count / max) * 100) : 0;
  return `
    <li class="share-row">
      <div class="share-top"><span class="row-title" title="${esc(title)}">${esc(title)}</span><span class="share-num">${esc(display)}</span></div>
      <svg class="share-bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
        <rect class="track" x="0" y="0" width="100" height="6" rx="3"/><rect class="fill" x="0" y="0" width="${pct}" height="6" rx="3"/></svg>
      ${sub ? `<div class="row-sub">${esc(sub)}</div>` : ''}
    </li>`;
}

function renderWeek() {
  const st = state.stats;
  const fmt = (iso) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
  $('week-range').textContent = `${fmt(st.since)} to today. What Folder Tidy did for you in the last 7 days.`;
  $('week-moved').textContent = st.moved;
  const diff = st.moved - st.previousWeek;
  $('week-moved-note').textContent = st.previousWeek || st.moved
    ? (diff === 0 ? 'Same as the week before' : `${Math.abs(diff)} ${diff > 0 ? 'more' : 'fewer'} than the week before`)
    : 'Nothing yet';
  $('week-freed').textContent = st.freed ? formatSize(st.freed) : '0';
  const parts = [['clutter', 'clutter binned'], ['cleaner', 'cleaned'], ['archive', 'archived']]
    .filter(([k]) => st.freedBy[k]).map(([k, label]) => `${formatSize(st.freedBy[k])} ${label}`);
  $('week-freed-note').textContent = parts.length ? parts.join(', ') : 'From the Check, Clean and Archive pages';
  $('week-saved').textContent = st.minutesSaved >= 60 ? `${(st.minutesSaved / 60).toFixed(1)} hr` : `${st.minutesSaved} min`;
  $('week-bytes').textContent = st.moved ? `${formatSize(st.bytesMoved)} in all${st.renamed ? `, ${plural(st.renamed, 'file')} renamed` : ''}` : '';

  $('week-chart').innerHTML = st.moved ? dayChart(st.days) : '<div class="empty">Nothing sorted in the last 7 days yet. New downloads will show up here.</div>';
  $('week-table').innerHTML = `<caption>Files sorted each day</caption><tr><th>Day</th><th>Files</th></tr>${st.days.map((d) => `<tr><td>${esc(new Date(d.date).toDateString())}</td><td>${d.count}</td></tr>`).join('')}`;

  const maxRule = st.byRule[0]?.count || 0;
  $('week-rules').innerHTML = st.byRule.length
    ? st.byRule.map((r) => shareRow(r.name, r.count, maxRule, r.bytes ? formatSize(r.bytes) : '')).join('')
    : '<li class="empty">No rules used yet this week.</li>';
  const maxSrc = st.bySource[0]?.count || 0;
  $('week-sources').innerHTML = st.bySource.length
    ? st.bySource.map((s) => shareRow(baseName(s.folder), s.count, maxSrc, s.folder)).join('')
    : '<li class="empty">Nothing yet.</li>';
}

function renderAll() {
  renderHome();
  renderWeek();
  renderRules();
  renderHistory();
  renderSettings();
  renderCheck();
  renderArchive();
  renderClean();
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
      <div class="btn-row"><button id="setup-add-src" class="btn btn-outline">${icon('plus')}Add folder</button>${suggestButtons(setup.sources)}</div>`;
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
  const quick = e.target.closest('[data-add-source]');
  if (quick) {
    setup.sources.push({ path: quick.dataset.addSource, enabled: true });
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
  const card = e.target.closest('.rule');
  const r = card && rulesDraft[Number(card.dataset.index)];
  if (e.target.classList.contains('rule-sub')) {
    card.querySelector('.sub-example').textContent = subExample(r);
  }
  if (e.target.classList.contains('rule-clean') || e.target.classList.contains('rule-date')) {
    card.querySelector('.rename-example').textContent = renameExample(r);
  }
  if (e.target.classList.contains('rule-any')) {
    const ext = card.querySelector('.rule-ext');
    ext.disabled = r.anyType;
    ext.value = r.anyType ? '' : r.extensions.join(', ');
    ext.placeholder = r.anyType ? 'Every file type' : '.pdf, .docx';
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
    if (ext && !rulesDraft[i].anyType && !rulesDraft[i].extensions.includes(ext)) rulesDraft[i].extensions.push(ext);
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

$('source-suggest').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-add-source]');
  if (!btn) return;
  sourcesDraft.push({ path: btn.dataset.addSource, enabled: true });
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
  condition: { label: 'Size or age', fixable: true },
  'already-there': { label: 'Already sorted' },
  downloading: { label: 'Downloading' },
  'too-new': { label: 'Just changed' },
  locked: { label: 'In use' },
  protected: { label: 'Protected' },
  ignored: { label: 'Ignored' },
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
            ${done ? status : ignoreBtn(r.file)}
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
        ${done ? '' : ignoreBtn(c.file)}
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
            ${r.reason === 'ignored'
              ? `<button class="btn btn-ghost small" data-unignore="${esc(r.file)}">Stop ignoring</button>`
              : `<span class="reason ${reason.fixable ? 'fixable' : ''}">${esc(reason.label)}</span>`}
          </li>`;
      }).join('')
    : '<li class="empty">Every file has somewhere to go.</li>';
}

function ignoreBtn(file) {
  return `<button class="btn btn-ghost small" data-ignore="${esc(file)}" title="Never move or bin this file">Leave alone</button>`;
}

// "Leave alone" and "Stop ignoring" work from any list on the Check page.
$('check-results').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-ignore], [data-unignore]');
  if (!btn) return;
  btn.disabled = true;
  const ignore = btn.hasAttribute('data-ignore');
  check = await window.folderTidy.setIgnored(ignore ? btn.dataset.ignore : btn.dataset.unignore, ignore);
  renderCheck();
});

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

// ---------- Archive ----------

let archiveScan = null;     // the last archive check, from the main process
let archiveResults = null;  // what happened to each folder after pressing Archive, by path
let archiveProgress = null;

const ARCHIVE_REASONS = {
  recent: 'In use',
  empty: 'Empty',
  links: 'Has links',
  unreadable: 'Unreadable',
  protected: 'Protected',
  ignored: 'Ignored',
  'archive-folder': 'Archive folder',
};

function renderArchiveSetup() {
  const a = state.archive;
  $('archive-parents').innerHTML = a.parents.length
    ? a.parents.map((p, i) => `
        <li class="folder-row">
          <span class="file-badge">${icon('folder')}</span>
          <div class="row-main">
            <div class="row-title">${esc(baseName(p))}</div>
            <div class="row-sub">${esc(p)}</div>
          </div>
          <button class="btn btn-ghost btn-danger remove-parent" data-index="${i}" title="Stop using this folder">${icon('x')}</button>
        </li>`).join('')
    : '<li class="empty">No project folders yet. Add the folder your projects live in.</li>';
  $('archive-dest').textContent = a.destination || 'No folder chosen yet. Pick a folder on an external drive, a NAS, or a synced cloud folder.';
  $('choose-archive-dest').textContent = a.destination ? 'Change' : 'Choose folder';
  $('a-days').value = a.idleDays;
  $('a-daily').checked = a.dailyCheck;
  $('a-time').value = a.checkTime;
  $('a-time-row').classList.toggle('hidden', !a.dailyCheck);
  const ready = a.parents.length && a.destination;
  $('run-archive').disabled = !ready || a.busy;
  $('run-archive').title = ready ? '' : 'Add a project folder and an archive folder first';
}

function renderArchiveLog() {
  const log = state.archive.log;
  $('archive-log').innerHTML = log.length
    ? log.map((e) => {
        const when = new Date(e.time).toLocaleDateString([], { dateStyle: 'medium' });
        const restored = e.restoredTo ? ` · Restored to ${esc(e.restoredTo)}` : '';
        const kept = e.originalRemoved ? '' : ' · Original still in place';
        return `
          <li class="row-item">
            <span class="file-badge">${icon('archive')}</span>
            <div class="row-main">
              <div class="row-title" title="${esc(e.folder)}">${esc(baseName(e.folder))}</div>
              <div class="row-sub" title="${esc(e.zip)}">${esc(when)} · ${formatSize(e.size)} · ${plural(e.files, 'file')}${restored}${kept}</div>
            </div>
            <div class="row-actions">
              <button class="btn btn-ghost small" data-show-zip="${esc(e.zip)}">Show zip</button>
              <button class="btn btn-outline" data-restore="${esc(e.id)}">${icon('undo')}Restore</button>
            </div>
          </li>`;
      }).join('')
    : '<li class="empty">Nothing archived yet.</li>';
}

function renderArchiveProgress() {
  const p = archiveProgress;
  $('archive-progress').hidden = !p;
  if (!p) return;
  const stage = { zipping: 'Zipping', checking: 'Checking', binning: 'Sending to the Recycle Bin' }[p.stage];
  $('archive-progress-label').textContent = `${stage} ${baseName(p.folder)}…`;
  $('archive-progress-bar').value = p.total ? p.done / p.total : 0;
}

function renderArchive() {
  renderArchiveSetup();
  renderArchiveLog();
  $('archive-empty').hidden = !!archiveScan;
  $('archive-results').hidden = !archiveScan;
  renderArchiveProgress();
  if (!archiveScan) return;

  const ready = archiveScan.projects.filter((p) => p.ready);
  const skipped = archiveScan.projects.filter((p) => !p.ready);
  const when = new Date(archiveScan.time).toLocaleTimeString([], { timeStyle: 'short' });
  $('archive-meta').textContent = `Checked at ${when}. ${plural(ready.length, 'project')} ready, ${skipped.length} not ready.`
    + (archiveScan.dryRun ? ' Dry run is on, so nothing will actually be archived.' : '');

  const warnings = [];
  if (archiveScan.destinationMissing) warnings.push(`Your archive folder (${state.archive.destination}) isn't there. Plug in the drive, then check again.`);
  for (const m of archiveScan.missingParents) warnings.push(`Project folder not found: ${m}`);
  $('archive-warning').hidden = !warnings.length;
  $('archive-warning').innerHTML = warnings.map(esc).join('<br>');

  const total = ready.reduce((sum, p) => sum + p.size, 0);
  $('archive-ready-title').textContent = `Ready to archive (${ready.length}${ready.length ? `, ${formatSize(total)}` : ''})`;
  $('archive-ready-list').innerHTML = ready.length
    ? ready.map((p) => {
        const done = archiveResults?.[p.folder];
        const status = !done ? ''
          : done.ok ? `<span class="result-ok">${done.dryRun ? 'Would archive' : done.originalRemoved === false ? 'Zipped, original kept' : 'Archived'}</span>`
          : `<span class="result-fail">${esc(done.message)}</span>`;
        const sub = done && done.ok && done.message ? done.message : p.message;
        return `
          <li class="row-item">
            <label class="check-row">
              <input type="checkbox" class="archive-pick" value="${esc(p.folder)}" ${done || state.archive.busy ? 'disabled' : 'checked'}>
              <span class="file-badge">${icon('folder')}</span>
              <div class="row-main">
                <div class="row-title" title="${esc(p.folder)}">${esc(p.name)}</div>
                <div class="row-sub">${esc(sub)}</div>
              </div>
            </label>
            ${done ? status : `<button class="btn btn-ghost small" data-archive-ignore="${esc(p.folder)}" title="Never offer this folder for the archive">Leave alone</button>`}
          </li>`;
      }).join('')
    : `<li class="empty">Nothing has been idle for ${plural(state.archive.idleDays, 'day')} yet.</li>`;
  updateArchiveButton();

  $('archive-skip-title').textContent = `Not ready (${skipped.length})`;
  $('archive-skip-list').innerHTML = skipped.length
    ? skipped.map((p) => `
        <li class="row-item">
          <span class="file-badge">${icon('folder')}</span>
          <div class="row-main">
            <div class="row-title" title="${esc(p.folder)}">${esc(p.name)}</div>
            <div class="row-sub">${esc(p.message)}</div>
          </div>
          ${p.reason === 'ignored'
            ? `<button class="btn btn-ghost small" data-archive-unignore="${esc(p.folder)}">Stop ignoring</button>`
            : `<span class="reason">${esc(ARCHIVE_REASONS[p.reason] || p.reason)}</span>`}
        </li>`).join('')
    : '<li class="empty">Every project is ready.</li>';
}

function pickedProjects() {
  return [...document.querySelectorAll('.archive-pick:checked:not(:disabled)')].map((cb) => cb.value);
}

function updateArchiveButton() {
  const n = pickedProjects().length;
  const btn = $('archive-checked');
  btn.disabled = n === 0 || state.archive.busy || archiveScan?.destinationMissing;
  btn.textContent = state.archive.busy ? 'Archiving…'
    : archiveScan?.dryRun ? `Try ${plural(n, 'folder')} (dry run)` : `Archive ${plural(n, 'folder')}`;
}

async function saveArchive(patch) {
  state = await window.folderTidy.saveArchive(patch);
  renderArchiveSetup();
}

async function runArchiveScan() {
  showPage('archive');
  if (!state.archive.parents.length || !state.archive.destination) return;
  $('run-archive').disabled = true;
  $('run-archive').textContent = 'Checking…';
  try {
    archiveScan = await window.folderTidy.archiveScan();
    archiveResults = null;
    renderArchive();
  } finally {
    $('run-archive').textContent = 'Check again';
    renderArchiveSetup();
  }
}

$('run-archive').addEventListener('click', runArchiveScan);

$('add-parent').addEventListener('click', async () => {
  const folder = await window.folderTidy.pickFolder('Choose the folder your projects live in');
  if (!folder || state.archive.parents.some((p) => p.toLowerCase() === folder.toLowerCase())) return;
  await saveArchive({ parents: [...state.archive.parents, folder] });
});

$('archive-parents').addEventListener('click', async (e) => {
  const btn = e.target.closest('.remove-parent');
  if (!btn) return;
  await saveArchive({ parents: state.archive.parents.filter((_, i) => i !== Number(btn.dataset.index)) });
});

$('choose-archive-dest').addEventListener('click', async () => {
  const folder = await window.folderTidy.pickFolder('Choose where archived projects go');
  if (folder) await saveArchive({ destination: folder });
});

$('a-days').addEventListener('change', () => saveArchive({ idleDays: Number($('a-days').value) }));
$('a-daily').addEventListener('change', () => saveArchive({ dailyCheck: $('a-daily').checked }));
$('a-time').addEventListener('change', () => saveArchive({ checkTime: $('a-time').value || '10:00' }));

$('archive-ready-list').addEventListener('change', updateArchiveButton);

$('archive-checked').addEventListener('click', async () => {
  const folders = pickedProjects();
  if (!folders.length) return;
  const size = formatSize(archiveScan.projects.filter((p) => folders.includes(p.folder)).reduce((sum, p) => sum + p.size, 0));
  if (!archiveScan.dryRun && !confirm(`Archive ${plural(folders.length, 'folder')} (${size}) to ${state.archive.destination}?\n\nEach one is zipped and checked first. Only then does the original go to the Recycle Bin.`)) return;
  state.archive.busy = true;
  updateArchiveButton();
  try {
    const results = await window.folderTidy.archiveRun(folders);
    archiveResults = { ...(archiveResults || {}), ...Object.fromEntries(results.map((r) => [r.folder, r])) };
  } finally {
    archiveProgress = null;
    state = await window.folderTidy.getState();
    renderArchive();
  }
});

$('archive').addEventListener('click', async (e) => {
  const ignore = e.target.closest('[data-archive-ignore], [data-archive-unignore]');
  if (ignore) {
    ignore.disabled = true;
    const on = ignore.hasAttribute('data-archive-ignore');
    archiveScan = await window.folderTidy.archiveIgnore(on ? ignore.dataset.archiveIgnore : ignore.dataset.archiveUnignore, on);
    renderArchive();
    return;
  }
  const show = e.target.closest('[data-show-zip]');
  if (show) { window.folderTidy.showItem(show.dataset.showZip); return; }
  const restore = e.target.closest('[data-restore]');
  if (restore) {
    restore.disabled = true;
    restore.textContent = 'Restoring…';
    const result = await window.folderTidy.archiveRestore(restore.dataset.restore);
    if (!result.ok) alert(result.message);
    state = await window.folderTidy.getState();
    renderArchiveLog();
  }
});

window.folderTidy.onArchiveProgress((p) => {
  archiveProgress = p;
  renderArchiveProgress();
});
window.folderTidy.onRunArchiveScan(async () => {
  state = await window.folderTidy.getState();
  await runArchiveScan();
});

// ---------- Clean ----------

let junk = null;        // the last junk scan
let junkResults = null; // what clearing did, by category id
let big = null;         // the last big-files scan
let bigResults = null;  // what binning did, by file path

function ago(ms) {
  const days = Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000));
  if (days < 1) return 'today';
  if (days < 60) return `${plural(days, 'day')} ago`;
  if (days < 730) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function renderCleanSetup() {
  const c = state.cleaner;
  $('big-where').textContent = c.searching.join(', ') + (c.bigFolders.length ? '' : ' (AppData and OneDrive are left out)');
  $('big-reset').hidden = !c.bigFolders.length;
  $('big-mb').value = c.bigFileMB;
}

function renderJunk() {
  if (!junk) return;
  const cats = junk.categories;
  const total = cats.reduce((sum, c) => sum + c.size, 0);
  $('junk-title').textContent = `Junk (${formatSize(total)})`;
  const rows = cats.map((c) => {
    const done = junkResults?.[c.id];
    const status = !done ? `<span class="share-num">${c.size ? formatSize(c.size) : 'None'}</span>`
      : `<span class="result-ok">${done.dryRun ? 'Would clear' : 'Cleared'} ${formatSize(done.freed)}${done.skipped ? ` · ${done.skipped} in use` : ''}</span>`;
    return `
      <li class="row-item">
        <label class="check-row">
          <input type="checkbox" class="junk-pick" value="${esc(c.id)}" ${done || !c.size ? 'disabled' : 'checked'}>
          <span class="file-badge">${icon('broom')}</span>
          <div class="row-main">
            <div class="row-title">${esc(c.name)}</div>
            <div class="row-sub">${esc(c.description)}${c.count ? ` · ${plural(c.count, 'file')}` : ''}</div>
          </div>
        </label>
        ${status}
      </li>`;
  });
  const bin = junk.recycleBin;
  if (bin.available) {
    rows.push(`
      <li class="row-item">
        <span class="file-badge">${icon('trash')}</span>
        <div class="row-main">
          <div class="row-title">Recycle Bin</div>
          <div class="row-sub">${bin.count ? `${plural(bin.count, 'item')}. Emptying it is for good.` : 'Already empty'}</div>
        </div>
        <span class="share-num">${bin.size ? formatSize(bin.size) : ''}</span>
        <button id="empty-bin" class="btn btn-outline" ${bin.count ? '' : 'disabled'}>Empty</button>
      </li>`);
  }
  $('junk-list').innerHTML = rows.join('');
  $('junk-foot').hidden = false;
  updateJunkButton();
}

function pickedJunk() {
  return [...document.querySelectorAll('.junk-pick:checked:not(:disabled)')].map((cb) => cb.value);
}

function updateJunkButton() {
  const ids = pickedJunk();
  const size = junk ? junk.categories.filter((c) => ids.includes(c.id)).reduce((sum, c) => sum + c.size, 0) : 0;
  $('clear-junk').disabled = !ids.length;
  $('clear-junk').textContent = ids.length ? `${junk.dryRun ? 'Try clearing' : 'Clear'} ${formatSize(size)}` : 'Clear';
}

function renderBig() {
  $('big-results').hidden = !big;
  if (!big) return;
  const maxFolder = big.folders[0]?.size || 0;
  $('big-folders').innerHTML = big.folders.length
    ? big.folders.map((f) => shareRow(baseName(f.folder), f.size, maxFolder, f.folder, formatSize(f.size))).join('')
    : '<li class="empty">Nothing found.</li>';
  $('big-files-head').textContent = `Biggest files (${big.files.length})`;
  $('big-list').innerHTML = big.files.length
    ? big.files.map((f) => {
        const done = bigResults?.[f.file];
        const status = !done ? '' : done.ok ? `<span class="result-ok">${done.dryRun ? 'Would bin' : 'Binned'}</span>` : `<span class="result-fail">${esc(done.message)}</span>`;
        return `
          <li class="row-item">
            <label class="check-row">
              <input type="checkbox" class="big-pick" value="${esc(f.file)}" ${done ? 'disabled' : ''}>
              <span class="file-badge">${icon('file')}</span>
              <div class="row-main">
                <div class="row-title" title="${esc(f.file)}">${esc(baseName(f.file))}</div>
                <div class="row-sub" title="${esc(parentOf(f.file))}">${formatSize(f.size)} · changed ${ago(f.mtimeMs)} · ${esc(parentOf(f.file))}</div>
              </div>
            </label>
            ${done ? status : `<button class="btn btn-ghost small" data-show-file="${esc(f.file)}">Show</button>`}
          </li>`;
      }).join('')
    : `<li class="empty">No files over ${state.cleaner.bigFileMB} MB. Nice.</li>`;
  updateBigButton();
}

function pickedBig() {
  return [...document.querySelectorAll('.big-pick:checked:not(:disabled)')].map((cb) => cb.value);
}

function updateBigButton() {
  const files = pickedBig();
  const size = big ? big.files.filter((f) => files.includes(f.file)).reduce((sum, f) => sum + f.size, 0) : 0;
  $('bin-big').disabled = !files.length;
  $('bin-big').textContent = files.length ? `${big.dryRun ? 'Try binning' : 'Bin'} ${plural(files.length, 'file')} (${formatSize(size)})` : 'Send to Recycle Bin';
}

function renderClean() {
  renderCleanSetup();
  renderJunk();
  renderBig();
}

async function busyButton(btn, label, fn) {
  const before = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = before; }
}

$('scan-junk').addEventListener('click', () => busyButton($('scan-junk'), 'Looking…', async () => {
  const result = await window.folderTidy.cleanScanJunk();
  if (result.busy) return;
  junk = result;
  junkResults = null;
  renderJunk();
  $('scan-junk').dataset.done = '1';
}).then(() => { if ($('scan-junk').dataset.done) $('scan-junk').textContent = 'Look again'; }));

$('junk-list').addEventListener('change', updateJunkButton);

$('clear-junk').addEventListener('click', async () => {
  const ids = pickedJunk();
  if (!ids.length) return;
  if (!junk.dryRun && !confirm('Delete these temp and cache files for good?\n\nApps rebuild them when they need them. Close your browser first to clear the most.')) return;
  await busyButton($('clear-junk'), 'Clearing…', async () => {
    const results = await window.folderTidy.cleanJunk(ids);
    if (results.busy) return;
    junkResults = { ...(junkResults || {}), ...Object.fromEntries(results.map((r) => [r.id, r])) };
    const freed = results.reduce((sum, r) => sum + (r.freed || 0), 0);
    $('junk-result').textContent = `${junk.dryRun ? 'Dry run: would clear' : 'Cleared'} ${formatSize(freed)}.`;
  });
  renderJunk();
});

$('junk-list').addEventListener('click', async (e) => {
  if (!e.target.closest('#empty-bin')) return;
  const bin = junk.recycleBin;
  if (!confirm(`Empty the Recycle Bin (${formatSize(bin.size)}, ${plural(bin.count, 'item')})?\n\nThis can't be undone.`)) return;
  const result = await window.folderTidy.emptyBin();
  if (!result.ok) { alert(result.message); return; }
  if (result.dryRun) { $('junk-result').textContent = 'Dry run: the Recycle Bin was left as it is.'; return; }
  junk.recycleBin = { ...bin, count: 0, size: 0 };
  renderJunk();
});

$('scan-big').addEventListener('click', () => busyButton($('scan-big'), 'Looking…', async () => {
  $('clean-progress').hidden = false;
  $('clean-progress').textContent = 'Looking through your folders…';
  const result = await window.folderTidy.cleanScanBig();
  $('clean-progress').hidden = true;
  if (result.busy) return;
  big = result;
  bigResults = null;
  renderBig();
}));

$('big-list').addEventListener('change', updateBigButton);
$('big-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-show-file]');
  if (btn) window.folderTidy.showItem(btn.dataset.showFile);
});

$('bin-big').addEventListener('click', async () => {
  const files = pickedBig();
  if (!files.length) return;
  await busyButton($('bin-big'), 'Binning…', async () => {
    const results = await window.folderTidy.cleanBinBig(files);
    bigResults = { ...(bigResults || {}), ...Object.fromEntries(results.map((r) => [r.file, r])) };
  });
  renderBig();
});

$('big-choose').addEventListener('click', async () => {
  const folder = await window.folderTidy.pickFolder('Choose a folder to look for big files in');
  if (!folder) return;
  state = await window.folderTidy.saveCleaner({ bigFolders: [folder] });
  renderCleanSetup();
});
$('big-reset').addEventListener('click', async () => {
  state = await window.folderTidy.saveCleaner({ bigFolders: [] });
  renderCleanSetup();
});
$('big-mb').addEventListener('change', async () => {
  state = await window.folderTidy.saveCleaner({ bigFileMB: Number($('big-mb').value) });
  renderCleanSetup();
});

window.folderTidy.onCleanProgress((p) => {
  if (!p.stage) return;
  $('clean-progress').hidden = false;
  $('clean-progress').textContent = `${p.stage === 'big' ? 'Looked at' : 'Counted'} ${p.count.toLocaleString()} files…`;
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
  renderArchiveSetup();
  renderArchiveLog();
});
refresh();
