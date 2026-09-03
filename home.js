import { signIn, signOutUser, watchAuth } from "./shared/auth.js?v=12";
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
  moduleLinks: [...document.querySelectorAll(".module-card")],
};

const PENDING_DESTINATION_KEY = "works_pending_destination";
const SAFE_DESTINATION_RE = /^(?:\/|\/(?:tutor|material|material-print|admission|ss)\/)$/;

let authState = "checking";
let resolveAuthState;
const authStateReady = new Promise((resolve) => {
  resolveAuthState = resolve;
});

function settleAuthState(nextState) {
  authState = nextState;
  if (resolveAuthState) {
    resolveAuthState(nextState);
    resolveAuthState = null;
  }
}

async function waitForAuthState() {
  return authState === "checking" ? authStateReady : authState;
}

function isSafeDestination(value) {
  return SAFE_DESTINATION_RE.test(String(value || ""));
}

function savePendingDestination(value) {
  if (!isSafeDestination(value)) return;
  localStorage.setItem(PENDING_DESTINATION_KEY, value);
}

function consumePendingDestination() {
  const value = localStorage.getItem(PENDING_DESTINATION_KEY);
  localStorage.removeItem(PENDING_DESTINATION_KEY);
  return isSafeDestination(value) ? value : "";
}

function showSignedOut(message = "") {
  settleAuthState("signed-out");
  els.authError.textContent = message;
  els.authAction.setAttribute("aria-label", "Googleでログイン");
  els.authAction.title = "Googleでログイン";
  els.userAvatar.hidden = true;
  els.userAvatar.removeAttribute("src");
  els.userAvatarFallback.hidden = false;
}

function showSignedIn(user) {
  settleAuthState("signed-in");
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

  const pendingDestination = consumePendingDestination();
  if (pendingDestination) window.location.assign(pendingDestination);
}

els.moduleLinks.forEach((link) => {
  link.addEventListener("click", async (event) => {
    if (authState === "signed-in") return;
    event.preventDefault();
    const destination = new URL(link.href, window.location.origin).pathname;
    savePendingDestination(destination);

    try {
      const state = await waitForAuthState();
      if (state === "signed-in") {
        window.location.assign(destination);
        return;
      }
      signIn("/tutor/");
    } catch (error) {
      els.authError.textContent = error instanceof Error ? error.message : String(error);
    }
  });
});

els.authAction.addEventListener("click", async () => {
  els.authError.textContent = "";
  try {
    const state = await waitForAuthState();
    if (state === "signed-in") {
      await signOutUser();
      showSignedOut();
      return;
    }
    savePendingDestination("/");
    signIn("/tutor/");
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
