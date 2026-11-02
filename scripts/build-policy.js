// Turns INTEGRITETSPOLICY.md into public/integritet.html, the public privacy policy
// (App Store Review Guidelines 5.1.1). Expo copies public/ into the web build, so the
// page is served from the app's own website. Run by export:web; no dependencies.

const fs = require('fs');
const path = require('path');

function escape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  return escape(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
}

/** The small part of Markdown the policy uses: headings, paragraphs, bullet lists, bold, italics. */
function markdownToHtml(md) {
  const out = [];
  let list = false;
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push('</ul>');
    list = false;
  };
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (/^-\s+/.test(line)) {
      flushPara();
      if (!list) out.push('<ul>');
      list = true;
      out.push(`<li>${inline(line.replace(/^-\s+/, ''))}</li>`);
    } else if (!line) {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join('\n');
}

function page(md) {
  const title = (md.match(/^#\s+(.*)$/m) || [, 'Integritetspolicy'])[1];
  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
:root { color-scheme: light dark; --bg: #F5F7F2; --fg: #20372D; --muted: #53675C; --card: #fff; }
@media (prefers-color-scheme: dark) { :root { --bg: #101A16; --fg: #EDF4EE; --muted: #B1C5B8; --card: #1A2922; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.5 -apple-system, system-ui, sans-serif; }
main { max-width: 640px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 30px; line-height: 1.12; letter-spacing: -1px; } h2 { font-size: 20px; margin-top: 32px; }
li { margin: 6px 0; }
</style>
</head>
<body>
<main>
${markdownToHtml(md)}
</main>
</body>
</html>
`;
}

function build(root = path.join(__dirname, '..')) {
  const md = fs.readFileSync(path.join(root, 'INTEGRITETSPOLICY.md'), 'utf8');
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'integritet.html'), page(md));
}

if (require.main === module) build();

module.exports = { markdownToHtml, page, build };
