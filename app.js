// PDF Inspector Web UI — application controller.
// The PDF never leaves the browser: bytes go straight into the pdf-inspector
// WebAssembly build running in a Web Worker.

import { renderMarkdown } from './md.js';

const $ = (id) => document.getElementById(id);

const SAMPLES = [
  {
    file: 'thermo-freon12.pdf',
    icon: '📊',
    title: 'Thermodynamic tables',
    desc: 'Dense numeric tables · rect-based detection',
  },
  {
    file: 'forecast_table_chart.pdf',
    icon: '📈',
    title: 'Forecast report',
    desc: 'Tables next to charts · headings',
  },
  {
    file: 'firecrawl_docs_tagged.pdf',
    icon: '🏷️',
    title: 'Tagged documentation',
    desc: 'Struct-tree roles · code blocks · lists',
  },
  {
    file: 'wireless_two_col_no_rects.pdf',
    icon: '📰',
    title: 'Two-column paper',
    desc: 'Column detection · reading order',
  },
];

// Public CORS relays, tried in order only after a direct fetch fails.
const CORS_PROXIES = [
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

const state = {
  bytes: null,     // ArrayBuffer of the current PDF
  name: '',        // display name
  result: null,    // last engine result
  view: 'preview', // preview | markdown | json
};

/* ------------------------------------------------------------------ worker */

const worker = new Worker('./worker.js', { type: 'module' });
const pending = new Map();
let seq = 0;

worker.onmessage = ({ data }) => {
  const entry = pending.get(data.id);
  if (!entry) return;
  pending.delete(data.id);
  data.ok ? entry.resolve(data) : entry.reject(new Error(data.error));
};

worker.onerror = (event) => {
  setEngine('err', 'engine failed');
  showError('Could not start the WebAssembly engine', event.message || 'worker error');
};

function call(message, transfer = []) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...message, id }, transfer);
  });
}

function setEngine(status, label) {
  $('engine-dot').className = `dot dot-${status}`;
  $('engine-label').textContent = label;
}

call({ type: 'init' })
  .then(({ version }) => setEngine('ready', `pdf-inspector wasm v${version}`))
  .catch((error) => {
    setEngine('err', 'engine failed');
    showError('Could not load the WebAssembly engine', error.message);
  });

/* -------------------------------------------------------------- ui helpers */

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toast.hidden = true; }, 220);
  }, 1900);
}

function setBusy(busy, label = 'Parsing…') {
  $('loading-label').textContent = label;
  $('loading').hidden = !busy;
  if (busy) {
    $('empty').hidden = true;
    $('error').hidden = true;
  }
}

function showError(title, message) {
  setBusy(false);
  $('empty').hidden = true;
  $('error').hidden = false;
  $('error-title').textContent = title;
  $('error-msg').textContent = message;
}

const formatBytes = (n) =>
  n < 1024 ? `${n} B`
  : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB`
  : `${(n / 1024 / 1024).toFixed(2)} MB`;

/* ------------------------------------------------------------------- input */

document.querySelectorAll('.tab[data-src]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab[data-src]').forEach((t) => t.classList.toggle('is-active', t === tab));
    document.querySelectorAll('[data-panel]').forEach((panel) => {
      panel.classList.toggle('is-active', panel.dataset.panel === tab.dataset.src);
    });
  });
});

const drop = $('drop');
$('browse').addEventListener('click', (event) => { event.stopPropagation(); $('file').click(); });
drop.addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) loadFile(file);
});

['dragenter', 'dragover'].forEach((type) =>
  drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((type) =>
  drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

// A drop anywhere on the page should work, not just on the dashed box.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file && file.type === 'application/pdf') loadFile(file);
});

async function loadFile(file) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    showError('Not a PDF', `${file.name} does not look like a PDF file.`);
    return;
  }
  setBusy(true, `Reading ${file.name}…`);
  const bytes = await file.arrayBuffer();
  await run(bytes, file.name);
}

$('fetch-url').addEventListener('click', fetchUrl);
$('url').addEventListener('keydown', (event) => { if (event.key === 'Enter') fetchUrl(); });

async function fetchUrl() {
  const raw = $('url').value.trim();
  if (!raw) return;

  let url;
  try {
    url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) throw new Error('protocol');
  } catch {
    showError('Invalid URL', 'Enter a full http(s) URL to a PDF file.');
    return;
  }

  const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'document.pdf');
  const attempts = [(u) => u, ...CORS_PROXIES];

  for (let i = 0; i < attempts.length; i++) {
    try {
      setBusy(true, i === 0 ? 'Downloading PDF…' : 'Direct fetch blocked — retrying via CORS proxy…');
      const response = await fetch(attempts[i](url.href), { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength < 5) throw new Error('empty response');
      await run(bytes, name.endsWith('.pdf') ? name : `${name}.pdf`);
      return;
    } catch (error) {
      if (i === attempts.length - 1) {
        showError(
          'Could not download that PDF',
          `${error.message}. The host may block cross-origin requests — download the file and use the Upload tab instead.`,
        );
      }
    }
  }
}

const samplesEl = $('samples');
SAMPLES.forEach((sample) => {
  const button = document.createElement('button');
  button.className = 'sample';
  button.innerHTML =
    `<span class="sample-badge">${sample.icon}</span>` +
    `<span class="sample-txt"><span class="sample-title"></span><span class="sample-desc"></span></span>`;
  button.querySelector('.sample-title').textContent = sample.title;
  button.querySelector('.sample-desc').textContent = sample.desc;
  button.addEventListener('click', async () => {
    setBusy(true, `Loading ${sample.title}…`);
    try {
      const response = await fetch(`./samples/${sample.file}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await run(await response.arrayBuffer(), sample.file);
    } catch (error) {
      showError('Could not load sample', error.message);
    }
  });
  samplesEl.appendChild(button);
});

$('reparse').addEventListener('click', () => {
  if (state.bytes) run(state.bytes, state.name);
});

/* ----------------------------------------------------------------- options */

function readOptions() {
  const options = { profile: $('opt-profile').value };
  if ($('opt-markers').checked) options.includePageMarkers = true;
  if ($('opt-images').checked) options.includeImages = true;

  const password = $('opt-password').value;
  if (password) options.password = password;

  const pages = parsePages($('opt-pages').value);
  if (pages.length) options.pages = pages;

  return options;
}

// "1,3,5-10" → [1,3,5,6,7,8,9,10]
function parsePages(spec) {
  const pages = new Set();
  for (const part of spec.split(',')) {
    const token = part.trim();
    if (!token) continue;
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b);
      for (let p = Math.max(1, from); p <= to && p - from < 5000; p++) pages.add(p);
    } else if (/^\d+$/.test(token) && Number(token) > 0) {
      pages.add(Number(token));
    }
  }
  return [...pages].sort((a, b) => a - b);
}

/* --------------------------------------------------------------- pipeline */

async function run(bytes, name) {
  state.bytes = bytes;
  state.name = name;

  $('filebar').hidden = false;
  $('file-name').textContent = name;
  $('file-size').textContent = formatBytes(bytes.byteLength);

  setBusy(true, 'Parsing with pdf-inspector…');

  try {
    // The worker gets a copy so `state.bytes` stays usable for re-parsing.
    const { result } = await call({ type: 'process', bytes: bytes.slice(0), options: readOptions() });
    state.result = result;
    renderResult(result);
  } catch (error) {
    state.result = null;
    $('stats').hidden = true;
    setOutputEnabled(false);
    showError('Extraction failed', error.message);
  } finally {
    setBusy(false);
  }
}

function renderResult(result) {
  $('error').hidden = true;
  $('empty').hidden = true;

  const stats = $('stats');
  stats.hidden = false;
  stats.replaceChildren();

  const markdown = result.markdown ?? '';
  const words = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;

  const chips = [
    { label: 'type', value: result.pdfType, cls: 'stat-accent' },
    { label: 'pages', value: result.pageCount },
    { label: 'confidence', value: `${Math.round(result.confidence * 100)}%` },
    { label: 'parsed in', value: `${result.processingTimeMs} ms`, cls: 'stat-ok' },
    { label: 'words', value: words.toLocaleString() },
    { label: 'chars', value: markdown.length.toLocaleString() },
  ];

  if (result.layout?.pagesWithTables?.length) {
    chips.push({ label: 'pages w/ tables', value: result.layout.pagesWithTables.length });
  }
  if (result.layout?.pagesWithColumns?.length) {
    chips.push({ label: 'pages w/ columns', value: result.layout.pagesWithColumns.length });
  }
  if (result.pagesNeedingOcr?.length) {
    chips.push({ label: 'need OCR', value: result.pagesNeedingOcr.length, cls: 'stat-warn' });
  }
  if (result.hasEncodingIssues) {
    chips.push({ label: 'encoding', value: 'issues', cls: 'stat-warn' });
  }

  for (const chip of chips) {
    const el = document.createElement('div');
    el.className = `stat ${chip.cls ?? ''}`.trim();
    const value = document.createElement('b');
    value.textContent = String(chip.value);
    const label = document.createElement('span');
    label.textContent = chip.label;
    el.append(value, label);
    stats.appendChild(el);
  }

  $('view-markdown').firstElementChild.textContent = markdown || '(no markdown — this PDF needs OCR)';
  // The markdown is elided in the JSON *view* only — copy and download both
  // emit the complete object.
  $('view-json').firstElementChild.textContent = JSON.stringify(
    {
      ...result,
      markdown: markdown
        ? `<${markdown.length} chars — elided here; included in copy/download>`
        : null,
    },
    null, 2,
  );
  $('view-preview').innerHTML = markdown
    ? renderMarkdown(markdown)
    : '<p><em>No text layer was found. pdf-inspector classified this document as ' +
      `<strong>${result.pdfType}</strong> — it needs an OCR pass.</em></p>`;

  setOutputEnabled(true);
  showView(state.view);
  document.querySelector('.out-body').scrollTop = 0;
}

function setOutputEnabled(enabled) {
  $('copy').disabled = !enabled;
  $('download').disabled = !enabled;
  if (!enabled) {
    ['view-preview', 'view-markdown', 'view-json'].forEach((id) => { $(id).hidden = true; });
  }
}

/* ------------------------------------------------------------- output tabs */

document.querySelectorAll('.tab[data-view]').forEach((tab) => {
  tab.addEventListener('click', () => {
    state.view = tab.dataset.view;
    document.querySelectorAll('.tab[data-view]').forEach((t) => t.classList.toggle('is-active', t === tab));
    if (state.result) showView(state.view);
  });
});

function showView(view) {
  $('view-preview').hidden = view !== 'preview';
  $('view-markdown').hidden = view !== 'markdown';
  $('view-json').hidden = view !== 'json';
}

/* ---------------------------------------------------- copy + download icons */

function currentOutput() {
  if (!state.result) return null;
  if (state.view === 'json') {
    return { text: JSON.stringify(state.result, null, 2), ext: 'json', mime: 'application/json' };
  }
  return { text: state.result.markdown ?? '', ext: 'md', mime: 'text/markdown' };
}

$('copy').addEventListener('click', async () => {
  const output = currentOutput();
  if (!output) return;
  try {
    await navigator.clipboard.writeText(output.text);
  } catch {
    // Clipboard API needs a secure context; fall back to a temporary textarea.
    const area = document.createElement('textarea');
    area.value = output.text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  const button = $('copy');
  button.classList.add('copied');
  setTimeout(() => button.classList.remove('copied'), 1400);
  showToast(`Copied ${output.ext.toUpperCase()} to clipboard`);
});

$('download').addEventListener('click', () => {
  const output = currentOutput();
  if (!output) return;
  const base = state.name.replace(/\.pdf$/i, '') || 'output';
  const url = URL.createObjectURL(new Blob([output.text], { type: `${output.mime};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${base}.${output.ext}`;
  link.click();
  URL.revokeObjectURL(url);
  showToast(`Downloaded ${base}.${output.ext}`);
});

/* ------------------------------------------------------------------- theme */

const theme = localStorage.getItem('pdfui-theme')
  || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
document.documentElement.dataset.theme = theme;

$('theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('pdfui-theme', next);
});
