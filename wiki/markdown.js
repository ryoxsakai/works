import { Marked } from "./vendor/marked.esm.js";
import DOMPurify from "./vendor/purify.es.mjs";
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const markdown = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html(token) {
      return esc(token.text);
    },
    image(token) {
      return esc(token.text);
    },
    link(token) {
      let url;
      try {
        url = new URL(token.href);
      } catch {
        return esc(token.text);
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return esc(token.text);
      return `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer"${token.title ? ` title="${esc(token.title)}"` : ""}>${this.parser.parseInline(token.tokens)}</a>`;
    },
  },
});
export function renderMarkdown(body) {
  const rendered = markdown.parse(String(body ?? ""));
  // The strict renderer also works in Node tests. Browsers additionally enforce a DOM allowlist.
  return typeof DOMPurify.sanitize === "function"
    ? DOMPurify.sanitize(rendered, {
        ALLOWED_TAGS: [
          "p",
          "br",
          "hr",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "strong",
          "em",
          "del",
          "blockquote",
          "pre",
          "code",
          "ul",
          "ol",
          "li",
          "table",
          "thead",
          "tbody",
          "tr",
          "th",
          "td",
          "a",
          "input",
        ],
        ALLOWED_ATTR: [
          "href",
          "title",
          "target",
          "rel",
          "class",
          "start",
          "align",
          "type",
          "disabled",
          "checked",
        ],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
      })
    : rendered;
}
