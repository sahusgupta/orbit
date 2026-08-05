const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');

const root = path.join(__dirname, '..');
const defaultTermsPath = path.join(process.env.USERPROFILE || '', 'Downloads', 'Orbit_Terms_of_Service.docx');
const defaultPrivacyPath = path.join(process.env.USERPROFILE || '', 'Downloads', 'Orbit_Privacy_Policy (1).docx');
const termsPath = path.resolve(process.argv[2] || defaultTermsPath);
const privacyPath = path.resolve(process.argv[3] || defaultPrivacyPath);

const documentDefinitions = {
  terms: {
    inputPath: termsPath,
    title: 'Orbit Terms of Service',
    description: 'Rules for using the Orbit platform and participating in the Orbit network.',
    effective: 'Effective July 20, 2026',
    detail: 'Applies to Orbit Player, Orbit Core, websites, events, APIs, kiosks, and related services'
  },
  privacy: {
    inputPath: privacyPath,
    title: 'Orbit Privacy Policy',
    description: 'How Orbit handles personal data across player, venue, organizer, website, event, and hardware-enabled experiences.',
    effective: 'Effective July 20, 2026',
    detail: 'Privacy contact: privacy@orbitpoker.com'
  }
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeText(value) {
  return value
    .replaceAll('\u2014', ',')
    .replaceAll('\u00a0', ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

function nodeText(node) {
  let value = '';
  for (const child of Array.from(node.childNodes || [])) {
    if (child.nodeType !== 1) continue;
    if (child.nodeName === 'w:t') value += child.textContent || '';
    else if (child.nodeName === 'w:tab') value += '\t';
    else if (child.nodeName === 'w:br') value += '\n';
    else value += nodeText(child);
  }
  return normalizeText(value);
}

function paragraphStyle(node) {
  const styleNode = Array.from(node.getElementsByTagName('w:pStyle'))[0];
  return styleNode?.getAttribute('w:val') || styleNode?.getAttribute('val') || '';
}

async function extractBlocks(inputPath) {
  if (!fs.existsSync(inputPath)) throw new Error(`Legal source not found: ${inputPath}`);
  const archive = await JSZip.loadAsync(fs.readFileSync(inputPath));
  const documentXml = await archive.file('word/document.xml').async('string');
  const document = new DOMParser().parseFromString(documentXml, 'application/xml');
  const body = document.getElementsByTagName('w:body')[0];
  const blocks = [];

  for (const node of Array.from(body.childNodes || [])) {
    if (node.nodeType !== 1) continue;
    if (node.nodeName === 'w:p') {
      const text = nodeText(node);
      if (!text) continue;
      const style = paragraphStyle(node);
      blocks.push({
        type: style === 'Heading1' ? 'heading1' : style === 'Heading2' ? 'heading2' : style === 'ListBullet' ? 'bullet' : 'paragraph',
        text
      });
      continue;
    }
    if (node.nodeName === 'w:tbl') {
      const rows = Array.from(node.childNodes || [])
        .filter((row) => row.nodeType === 1 && row.nodeName === 'w:tr')
        .map((row) => Array.from(row.childNodes || [])
          .filter((cell) => cell.nodeType === 1 && cell.nodeName === 'w:tc')
          .map((cell) => nodeText(cell)));
      if (rows.length) blocks.push({ type: 'table', rows });
    }
  }

  const firstSection = blocks.findIndex((block) => block.type === 'heading1');
  return firstSection >= 0 ? blocks.slice(firstSection) : blocks;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function linkContactText(text) {
  const escaped = escapeHtml(text).replaceAll('\n', '<br />');
  return escaped
    .replace(/privacy@orbitpoker\.com/g, '<a href="mailto:privacy@orbitpoker.com">privacy@orbitpoker.com</a>')
    .replace(/https:\/\/orbitpoker\.com/g, '<a href="https://orbitpoker.com">https://orbitpoker.com</a>')
    .replace(/346-434-1402/g, '<a href="tel:+13464341402">346-434-1402</a>');
}

function renderBlocks(blocks) {
  const output = [];
  let listItems = [];
  const flushList = () => {
    if (!listItems.length) return;
    output.push(`<ul>${listItems.map((item) => `<li>${linkContactText(item)}</li>`).join('')}</ul>`);
    listItems = [];
  };

  for (const block of blocks) {
    if (block.type === 'bullet') {
      listItems.push(block.text);
      continue;
    }
    flushList();
    if (block.type === 'heading1') output.push(`<h2 id="${slugify(block.text)}">${escapeHtml(block.text)}</h2>`);
    else if (block.type === 'heading2') output.push(`<h3 id="${slugify(block.text)}">${escapeHtml(block.text)}</h3>`);
    else if (block.type === 'paragraph') output.push(`<p>${linkContactText(block.text)}</p>`);
    else if (block.type === 'table') {
      const [head, ...rows] = block.rows;
      output.push(`<div class="legal-table-wrap"><table><thead><tr>${head.map((cell) => `<th scope="col">${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${linkContactText(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    }
  }
  flushList();
  return output.join('\n        ');
}

function renderToc(blocks) {
  return blocks
    .filter((block) => block.type === 'heading1')
    .map((block) => `<a href="#${slugify(block.text)}">${escapeHtml(block.text)}</a>`)
    .join('\n          ');
}

function renderPage(kind, definition, blocks, target) {
  const apiTarget = target.includes(`${path.sep}apps${path.sep}api${path.sep}`);
  const stylesheet = apiTarget ? '/legal.css' : './styles.css';
  const favicon = apiTarget ? '/orbit-logo.svg' : './orbit-logo.svg';
  const home = apiTarget ? '/support' : './index.html';
  const privacy = apiTarget ? '/privacy' : './privacy.html';
  const terms = apiTarget ? '/terms' : './terms.html';
  const support = apiTarget ? '/support' : './support.html';
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(definition.description)}" />
    <title>${escapeHtml(definition.title)}</title>
    <link rel="icon" type="image/svg+xml" href="${favicon}" />
    <link rel="stylesheet" href="${stylesheet}" />
  </head>
  <body class="legal-page">
    <header class="site-header">
      <a class="site-brand" href="${home}" aria-label="Orbit home"><img src="${favicon}" alt="" /><span>Orbit</span></a>
      <nav aria-label="Legal navigation"><a href="${privacy}"${kind === 'privacy' ? ' aria-current="page"' : ''}>Privacy</a><a href="${terms}"${kind === 'terms' ? ' aria-current="page"' : ''}>Terms</a><a href="${support}">Support</a></nav>
    </header>
    <main class="legal-shell">
      <header class="legal-header">
        <p class="eyebrow">Orbit legal</p>
        <h1>${escapeHtml(definition.title)}</h1>
        <p class="legal-summary">${escapeHtml(definition.description)}</p>
        <dl class="legal-meta"><div><dt>Effective</dt><dd>${escapeHtml(definition.effective.replace(/^Effective\s*/i, ''))}</dd></div><div><dt>Scope</dt><dd>${escapeHtml(definition.detail)}</dd></div></dl>
      </header>
      <details class="legal-toc"><summary>Contents</summary><nav aria-label="Document contents">${renderToc(blocks)}</nav></details>
      <article class="legal-document">
        ${renderBlocks(blocks)}
      </article>
    </main>
    <footer class="site-footer"><span>Orbit Technologies LLC</span><nav><a href="${privacy}">Privacy</a><a href="${terms}">Terms</a><a href="${support}">Support</a></nav></footer>
  </body>
</html>
`;
  fs.writeFileSync(target, html, 'utf8');
}

async function main() {
  for (const [kind, definition] of Object.entries(documentDefinitions)) {
    const blocks = await extractBlocks(definition.inputPath);
    const targets = [
      path.join(root, 'download-site', `${kind}.html`),
      path.join(root, 'apps', 'api', 'public', `${kind}.html`)
    ];
    targets.forEach((target) => renderPage(kind, definition, blocks, target));
    console.log(`Imported ${definition.title} into ${targets.length} web surfaces.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
