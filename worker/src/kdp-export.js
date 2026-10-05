// Portable, dependency-free EPUB 3 (ZIP STORE). Raw HTML is always text.
const enc = new TextEncoder();
export function xml(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function inline(text, assets) {
  const tokens = [];
  const marker = "kdp" + crypto.randomUUID().replaceAll("-", "");
  const token = (html) => `\uE000${marker}:${tokens.push(html) - 1}\uE001`;
  text = text.replace(/!\[([^\]]*)\]\((kdp-image:[\w-]+)\)/g, (_, alt, url) => {
    const asset = assets.find((a) => "kdp-image:" + a.id === url);
    if (!asset)
      throw Object.assign(new Error("画像が見つかりません: " + url), {
        status: 422,
      });
    return token(
      `<img src="images/${asset.id}.${asset.extension}" alt="${xml(alt)}" />`,
    );
  });
  // External images cannot silently leave a broken or network-dependent book.
  if (/!\[[^\]]*\]\(/.test(text))
    throw Object.assign(
      new Error("画像はKDP管理からアップロードして挿入してください。"),
      { status: 422 },
    );
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, label, url) => token(`<a href="${xml(url)}">${xml(label)}</a>`),
  );
  text = xml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  return text.replace(
    new RegExp("\\uE000" + marker + ":(\\d+)\\uE001", "g"),
    (_, i) => tokens[Number(i)],
  );
}
export function markdownXhtml(body, assets = []) {
  return String(body || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => /^[-*] /.test(l)))
        return (
          "<ul>" +
          lines
            .map((l) => "<li>" + inline(l.slice(2), assets) + "</li>")
            .join("") +
          "</ul>"
        );
      if (lines.every((l) => /^\d+\. /.test(l)))
        return (
          "<ol>" +
          lines
            .map(
              (l) =>
                "<li>" + inline(l.replace(/^\d+\. /, ""), assets) + "</li>",
            )
            .join("") +
          "</ol>"
        );
      return lines
        .map((line) => {
          const h = line.match(/^(#{1,6}) (.*)$/);
          return h
            ? `<h${h[1].length}>${inline(h[2], assets)}</h${h[1].length}>`
            : `<p>${inline(line, assets)}</p>`;
        })
        .join("\n");
    })
    .join("\n");
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function zipStore(entries) {
  const parts = [],
    central = [];
  let offset = 0;
  const header = (size) => {
    const data = new Uint8Array(size);
    return [data, new DataView(data.buffer)];
  };
  for (const entry of entries) {
    const name = enc.encode(entry.name),
      bytes =
        typeof entry.data === "string" ? enc.encode(entry.data) : entry.data;
    const crc = crc32(bytes);
    const [local, v] = header(30);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true);
    v.setUint16(12, 0x21, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, bytes.length, true);
    v.setUint32(22, bytes.length, true);
    v.setUint16(26, name.length, true);
    parts.push(local, name, bytes);
    const [c, w] = header(46);
    w.setUint32(0, 0x02014b50, true);
    w.setUint16(4, 20, true);
    w.setUint16(6, 20, true);
    w.setUint16(8, 0x0800, true);
    w.setUint16(14, 0x21, true);
    w.setUint32(16, crc, true);
    w.setUint32(20, bytes.length, true);
    w.setUint32(24, bytes.length, true);
    w.setUint16(28, name.length, true);
    w.setUint32(42, offset, true);
    central.push(c, name);
    offset += local.length + name.length + bytes.length;
  }
  const centralLength = central.reduce((n, a) => n + a.length, 0);
  const [end, v] = header(22);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, entries.length, true);
  v.setUint16(10, entries.length, true);
  v.setUint32(12, centralLength, true);
  v.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralLength + 22);
  let pos = 0;
  for (const part of [...parts, ...central, end]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}
export function exportMarkdown(tree) {
  let out = `# ${tree.book.title}\n\n${tree.book.subtitle || ""}\n\n${tree.book.description || ""}\n`;
  for (const c of tree.chapters.filter((c) => !c.archived)) {
    out += `\n## ${c.title}\n`;
    for (const s of c.sections.filter((s) => !s.archived))
      out += `\n### ${s.title}\n\n${s.body}\n`;
  }
  return out;
}
export function buildEpub(tree, assets = []) {
  const b = tree.book;
  const lang = /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(b.language)
    ? b.language
    : "en";
  const page = (title, body) =>
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}"><head><title>${xml(title)}</title><link rel="stylesheet" type="text/css" href="style.css" /></head><body>${body}</body></html>`;
  const chapters = tree.chapters.filter((c) => !c.archived);
  const files = [
    { name: "mimetype", data: "application/epub+zip" },
    {
      name: "META-INF/container.xml",
      data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml" /></rootfiles></container>',
    },
    {
      name: "OEBPS/style.css",
      data: "body{font-family:serif;line-height:1.6}img{max-width:100%;height:auto}p{overflow-wrap:break-word}h1,h2,h3{page-break-after:avoid}",
    },
  ];
  const nav = chapters
    .map(
      (c, i) =>
        `<li><a href="chapter-${i}.xhtml">${xml(c.title)}</a><ol>${c.sections
          .filter((s) => !s.archived)
          .map(
            (s) =>
              `<li><a href="chapter-${i}.xhtml#s-${s.id}">${xml(s.title)}</a></li>`,
          )
          .join("")}</ol></li>`,
    )
    .join("");
  files.push({
    name: "OEBPS/nav.xhtml",
    data: page(
      "Table of contents",
      `<nav epub:type="toc" id="toc"><h1>${xml(b.title)}</h1><ol>${nav}</ol></nav>`,
    ),
  });
  files.push({
    name: "OEBPS/title.xhtml",
    data: page(
      b.title,
      `<h1>${xml(b.title)}</h1><p>${xml(b.subtitle)}</p><p>${xml(b.author)}</p><p>${xml(b.description)}</p>`,
    ),
  });
  chapters.forEach((c, i) =>
    files.push({
      name: `OEBPS/chapter-${i}.xhtml`,
      data: page(
        c.title,
        `<h1>${xml(c.title)}</h1>` +
          c.sections
            .filter((s) => !s.archived)
            .map(
              (s) =>
                `<section id="s-${s.id}"><h2>${xml(s.title)}</h2>${markdownXhtml(s.body, assets)}</section>`,
            )
            .join(""),
      ),
    }),
  );
  for (const a of assets)
    files.push({ name: `OEBPS/images/${a.id}.${a.extension}`, data: a.bytes });
  const manifest =
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" /><item id="title" href="title.xhtml" media-type="application/xhtml+xml" /><item id="style" href="style.css" media-type="text/css" />' +
    chapters
      .map(
        (_, i) =>
          `<item id="c${i}" href="chapter-${i}.xhtml" media-type="application/xhtml+xml" />`,
      )
      .join("") +
    assets
      .map(
        (a) =>
          `<item id="a-${a.id}" href="images/${a.id}.${a.extension}" media-type="${a.content_type}" />`,
      )
      .join("");
  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  files.push({
    name: "OEBPS/package.opf",
    data: `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${lang}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:uuid:${xml(b.id)}</dc:identifier><dc:title>${xml(b.title)}</dc:title><dc:creator>${xml(b.author)}</dc:creator><dc:language>${lang}</dc:language><meta property="dcterms:modified">${modified}</meta></metadata><manifest>${manifest}</manifest><spine><itemref idref="title" /><itemref idref="nav" />${chapters.map((_, i) => `<itemref idref="c${i}" />`).join("")}</spine></package>`,
  });
  return zipStore(files);
}
