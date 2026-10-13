// Small safe Markdown subset. Escape first; never accept HTML or external images.
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function renderMarkdown(body) {
  const inline = (value) =>
    esc(value)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
        try {
          const u = new URL(url.replace(/&amp;/g, "&"));
          if (
            !["http:", "https:"].includes(u.protocol) ||
            u.username ||
            u.password
          )
            return label;
        } catch {
          return label;
        }
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      })
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  let code = false;
  return String(body)
    .split("\n")
    .map((line) => {
      if (line.startsWith("```")) {
        code = !code;
        return "";
      }
      if (code) return `<pre>${esc(line)}</pre>`;
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
      if (/^[-*]\s/.test(line)) return `<p>• ${inline(line.slice(2))}</p>`;
      if (line.startsWith("> "))
        return `<blockquote>${inline(line.slice(2))}</blockquote>`;
      return `<p>${inline(line) || "<br>"}</p>`;
    })
    .join("");
}
