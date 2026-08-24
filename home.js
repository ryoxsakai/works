import { signIn, signOutUser, watchAuth } from "./shared/auth.js?v=11";
import { getTheme, setTheme } from "./shared/theme.js?v=5";

const els = {
  authAction: document.querySelector("#home-auth-action"),
  authError: document.querySelector("#home-auth-error"),
  userAvatar: document.querySelector("#user-avatar"),
  userAvatarFallback: document.querySelector("#user-avatar-fallback"),
  openSettings: document.querySelector("#open-home-settings"),
  settingsModal: document.querySelector("#home-settings-modal"),
  settingsClose: document.querySelector("#home-settings-close"),
  themeRadios: [...document.querySelectorAll('input[name="home-theme"]')],
};

let signedIn = false;

function showSignedOut(message = "") {
  signedIn = false;
  els.authError.textContent = message;
  els.authAction.setAttribute("aria-label", "Googleでログイン");
  els.authAction.title = "Googleでログイン";
  els.userAvatar.hidden = true;
  els.userAvatar.removeAttribute("src");
  els.userAvatarFallback.hidden = false;
}

function showSignedIn(user) {
  signedIn = true;
  els.authError.textContent = "";
  els.authAction.setAttribute("aria-label", "ログアウト");
  els.authAction.title = `${user.email} (クリックでログアウト)`;
  if (user.picture) {
    els.userAvatar.src = user.picture;
    els.userAvatar.hidden = false;
    els.userAvatarFallback.hidden = true;
  } else {
    els.userAvatar.hidden = true;
    els.userAvatarFallback.hidden = false;
  }
}

els.authAction.addEventListener("click", async () => {
  els.authError.textContent = "";
  try {
    if (signedIn) {
      await signOutUser();
      showSignedOut();
      return;
    }
    signIn();
  } catch (error) {
    els.authError.textContent = error instanceof Error ? error.message : String(error);
  }
});

els.openSettings.addEventListener("click", () => {
  const current = getTheme();
  const selected = current === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : current;
  els.themeRadios.forEach((radio) => {
    radio.checked = radio.value === selected;
  });
  els.settingsModal.showModal();
});

els.settingsClose.addEventListener("click", () => els.settingsModal.close());

els.themeRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    if (radio.checked) setTheme(radio.value);
  });
});

watchAuth({
  onSignedIn: showSignedIn,
  onSignedOut: showSignedOut,
});
