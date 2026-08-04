// Minimal Markdown → HTML renderer. Deliberately dependency-free and scoped to
// exactly what pdf-inspector emits: headings, lists, GFM tables, fenced code,
// blockquotes, rules, links and emphasis — plus `<!-- Page N -->` markers.
// All text is HTML-escaped before any tag is produced, so raw markup in a PDF
// can never become live HTML.

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const BULLET = /^\s{0,3}([-*+•‣◦])\s+(.*)$/;
const ORDERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const PAGE_MARKER = /^\s*<!--\s*Page\s+(\d+)\s*-->\s*$/i;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function inline(text) {
  let out = escapeHtml(text);

  // Code spans first — their content must not be re-processed for emphasis.
  const spans = [];
  out = out.replace(/`([^`]+)`/g, (_, code) => {
    spans.push(code);
    return `\u0000${spans.length - 1}\u0000`;
  });

  out = out
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '<em>[image: $1]</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+|#[^)\s]*)\)/g,
      '<a href="$2" target="_blank" rel="noopener nofollow">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g,
      '$1<a href="$2" target="_blank" rel="noopener nofollow">$2</a>')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|\W)_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${spans[Number(i)]}</code>`);
}

const splitRow = (line) =>
  line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

function renderTable(lines, start) {
  if (start + 1 >= lines.length) return null;
  if (!lines[start].includes('|') || !TABLE_DIVIDER.test(lines[start + 1])) return null;

  const header = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return ' style="text-align:center"';
    if (right) return ' style="text-align:right"';
    return '';
  });

  const body = [];
  let i = start + 2;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || !line.includes('|')) break;
    body.push(splitRow(line));
  }

  const cells = (row, tag) => row
    .map((cell, idx) => `<${tag}${aligns[idx] ?? ''}>${inline(cell)}</${tag}>`)
    .join('');

  const html =
    '<div class="table-scroll"><table><thead><tr>' + cells(header, 'th') + '</tr></thead>' +
    (body.length ? '<tbody>' + body.map((r) => `<tr>${cells(r, 'td')}</tr>`).join('') + '</tbody>' : '') +
    '</table></div>';

  return { html, next: i };
}

export function renderMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let paragraph = [];

  const flush = () => {
    if (!paragraph.length) return;
    out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = line.match(FENCE);
    if (fence) {
      flush();
      const marker = fence[1][0];
      const code = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s{0,3}${marker}{3,}\\s*$`).test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const marker = line.match(PAGE_MARKER);
    if (marker) {
      flush();
      out.push(`<span class="page-marker">Page ${marker[1]}</span>`);
      continue;
    }

    if (!line.trim()) { flush(); continue; }

    if (RULE.test(line)) { flush(); out.push('<hr>'); continue; }

    const heading = line.match(HEADING);
    if (heading) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (line.includes('|')) {
      const table = renderTable(lines, i);
      if (table) { flush(); out.push(table.html); i = table.next - 1; continue; }
    }

    if (QUOTE.test(line)) {
      flush();
      const quoted = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(lines[i].match(QUOTE)[1]);
        i++;
      }
      i--;
      out.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`);
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      flush();
      const ordered = !BULLET.test(line);
      const pattern = ordered ? ORDERED : BULLET;
      const items = [];
      while (i < lines.length && pattern.test(lines[i])) {
        const item = [lines[i].match(pattern)[2]];
        i++;
        // Continuation lines: indented and not the start of a new item.
        while (
          i < lines.length && lines[i].trim() &&
          /^\s{2,}/.test(lines[i]) && !BULLET.test(lines[i]) && !ORDERED.test(lines[i])
        ) {
          item.push(lines[i].trim());
          i++;
        }
        items.push(item.join(' '));
      }
      i--;
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  flush();
  return out.join('\n');
}
