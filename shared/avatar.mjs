import { icon } from "./ui/icons.mjs";
// SVGElement has no HTMLElement.hidden setter. Toggle the actual attribute,
// and keep one fallback visible until the current image has really loaded.
export function setUserAvatar(image, fallback, picture) {
  if (fallback.tagName.toLowerCase() !== "svg" && !fallback.querySelector("svg")) {
    fallback.classList.remove("bx", "bx-user-circle");
    fallback.innerHTML = icon("bx-user-circle");
  }
  const show = loaded => {
    image.toggleAttribute('hidden', !loaded);
    fallback.toggleAttribute('hidden', loaded);
  };
  image.onload = null;
  image.onerror = null;
  show(false);
  if (!picture) { image.removeAttribute('src'); return; }
  const current = () => image.getAttribute('src') === picture;
  image.onload = () => { if (current() && image.complete && image.naturalWidth > 0) show(true); };
  image.onerror = () => { if (current()) show(false); };
  image.src = picture;
  if (image.complete && image.naturalWidth > 0) show(true);
}
