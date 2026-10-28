'use strict';

// UI logic. All file work happens in the main process; this only draws state and sends changes.
let state = null;
let rulesDraft = null;
let sourcesDraft = null;

const $ = (id) => document.getElementById(id);

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function showPage(name) {
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === name));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
}

document.querySelectorAll('.nav-btn').forEach((b) => {
  b.addEventListener('click', () => showPage(b.dataset.page));
});

function renderHome() {
  $('status-text').textContent = state.paused
    ? 'Paused. Nothing is being moved.'
    : `Watching ${state.sources.filter((s) => s.enabled).length} folder(s).`;
  $('pause-btn').textContent = state.paused ? 'Resume' : 'Pause';
  const recent = state.recent.slice(0, 5);
  $('recent-list').innerHTML = recent.length
    ? recent.map((e) => `
        <li class="item">
          <span>${esc(e.to.split('\\').pop())} <span class="hint">to ${esc(e.to.replace(/\\[^\\]*$/, ''))}</span></span>
          <button class="secondary" data-undo="${e.id}" ${e.undone ? 'disabled' : ''}>${e.undone ? 'Undone' : 'Undo'}</button>
        </li>`).join('')
    : '<li class="hint">No moves yet.</li>';
}

function renderRules() {
  rulesDraft = rulesDraft || structuredClone(state.rules);
  $('rules-list').innerHTML = rulesDraft.map((r, i) => `
    <div class="card rule" data-index="${i}">
      <div class="row">
        <input type="text" class="rule-name" value="${esc(r.name)}">
        <label><input type="checkbox" class="rule-enabled" ${r.enabled ? 'checked' : ''}> Enabled</label>
        <button class="secondary move-up" ${i === 0 ? 'disabled' : ''}>Up</button>
        <button class="secondary move-down" ${i === rulesDraft.length - 1 ? 'disabled' : ''}>Down</button>
        <button class="secondary delete-rule">Delete</button>
      </div>
      <label class="field">Extensions (comma separated)
        <input type="text" class="rule-ext" value="${esc(r.extensions.join(', '))}">
      </label>
      <label class="field">Name contains (optional)
        <input type="text" class="rule-pattern" value="${esc(r.namePattern || '')}">
      </label>
      <label class="field">Destination folder
        <input type="text" class="rule-dest" value="${esc(r.destination || '')}" placeholder="C:\\Users\\you\\Documents\\Invoices">
      </label>
    </div>`).join('');
}

function readRulesFromDom() {
  document.querySelectorAll('.rule').forEach((card, i) => {
    const r = rulesDraft[i];
    r.name = card.querySelector('.rule-name').value.trim() || r.name;
    r.enabled = card.querySelector('.rule-enabled').checked;
    r.extensions = card.querySelector('.rule-ext').value
      .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
      .map((e) => (e.startsWith('.') ? e : `.${e}`));
    r.namePattern = card.querySelector('.rule-pattern').value.trim();
    r.destination = card.querySelector('.rule-dest').value.trim();
  });
}

function renderHistory() {
  $('history-body').innerHTML = state.recent.length
    ? state.recent.map((e) => `
        <tr>
          <td>${esc(new Date(e.time).toLocaleString())}</td>
          <td>${esc(e.to.split('\\').pop())}</td>
          <td>${esc(e.from.replace(/\\[^\\]*$/, ''))}</td>
          <td>${esc(e.to.replace(/\\[^\\]*$/, ''))}</td>
          <td><button class="secondary" data-undo="${e.id}" ${e.undone ? 'disabled' : ''}>${e.undone ? 'Undone' : 'Undo'}</button></td>
        </tr>`).join('')
    : '<tr><td colspan="5" class="hint">No moves yet.</td></tr>';
}

function renderSettings() {
  $('s-login').checked = state.settings.startWithWindows;
  $('s-dry').checked = state.settings.dryRun;
  $('s-delay').value = state.settings.delaySeconds;
  $('s-delay-label').textContent = `${Math.round(state.settings.delaySeconds / 60)} min`;
  sourcesDraft = sourcesDraft || structuredClone(state.sources);
  $('sources-list').innerHTML = sourcesDraft.map((s, i) => `
    <div class="item">
      <label><input type="checkbox" class="src-enabled" data-index="${i}" ${s.enabled ? 'checked' : ''}> ${esc(s.path)}</label>
      <button class="secondary remove-source" data-index="${i}">Remove</button>
    </div>`).join('');
}

function renderAll() {
  renderHome();
  renderRules();
  renderHistory();
  renderSettings();
}

async function refresh() {
  state = await window.folderTidy.getState();
  rulesDraft = null;
  sourcesDraft = null;
  renderAll();
}

$('pause-btn').addEventListener('click', async () => {
  state = await window.folderTidy.setPaused(!state.paused);
  renderHome();
});

$('add-rule').addEventListener('click', () => {
  readRulesFromDom();
  rulesDraft.push({ id: `rule-${Date.now()}`, name: 'New rule', enabled: true, extensions: [], namePattern: '', destination: '' });
  renderRules();
});

$('rules-list').addEventListener('click', (e) => {
  const card = e.target.closest('.rule');
  if (!card) return;
  const i = Number(card.dataset.index);
  if (!e.target.matches('button')) return;
  readRulesFromDom();
  if (e.target.classList.contains('delete-rule')) rulesDraft.splice(i, 1);
  if (e.target.classList.contains('move-up') && i > 0) [rulesDraft[i - 1], rulesDraft[i]] = [rulesDraft[i], rulesDraft[i - 1]];
  if (e.target.classList.contains('move-down') && i < rulesDraft.length - 1) [rulesDraft[i + 1], rulesDraft[i]] = [rulesDraft[i], rulesDraft[i + 1]];
  renderRules();
});

$('save-rules').addEventListener('click', async () => {
  readRulesFromDom();
  state = await window.folderTidy.saveRules(rulesDraft);
  rulesDraft = null;
  renderRules();
});

$('test-name').addEventListener('input', () => {
  readRulesFromDom();
  const name = $('test-name').value.trim();
  if (!name) { $('test-result').textContent = ''; return; }
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  const hit = rulesDraft.find((r) => r.enabled && r.extensions.includes(ext) &&
    (!r.namePattern || name.toLowerCase().includes(r.namePattern.toLowerCase())));
  $('test-result').textContent = hit
    ? (hit.destination ? `Would move to ${hit.destination} (rule: ${hit.name})` : `Matches "${hit.name}" but has no destination`)
    : 'No rule matches';
});

document.body.addEventListener('click', async (e) => {
  const undoId = e.target.dataset.undo;
  if (!undoId) return;
  const result = await window.folderTidy.undo(undoId);
  if (!result.ok) alert(result.reason);
  await refresh();
});

$('s-delay').addEventListener('input', () => {
  $('s-delay-label').textContent = `${Math.round($('s-delay').value / 60)} min`;
});

$('add-source').addEventListener('click', () => {
  const path = $('new-source').value.trim();
  if (!path) return;
  sourcesDraft.push({ path, enabled: true });
  $('new-source').value = '';
  renderSettings();
});

$('sources-list').addEventListener('click', (e) => {
  if (!e.target.classList.contains('remove-source')) return;
  sourcesDraft.splice(Number(e.target.dataset.index), 1);
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
    delaySeconds: Number($('s-delay').value),
  });
  await refresh();
});

window.folderTidy.onStateChanged(refresh);
refresh();
