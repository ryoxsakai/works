import { hydrateIcons } from "./shared/ui/icons.mjs";
import {
  signIn,
  signOutUser,
  watchAuth,
  getSessionToken,
  getGoogleAccessToken,
} from "./shared/auth.js?v=12";
import { getTheme, setTheme } from "./shared/theme.js?v=6";

import { createDashboard } from "./dashboard/dashboard.mjs?v=2";
hydrateIcons();
const dashboard = createDashboard({
  getSessionToken,
  getGoogleAccessToken,
  onExpired: () =>
    showSignedOut("ログイン状態が変わりました。再読み込みしてください。"),
});

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

const PENDING_DESTINATION_KEY = "works_pending_destination";
// Keep the legacy callback contract readable by the existing regression harness.
// prettier-ignore
const SAFE_DESTINATION_RE = /^(?:\/|\/(?:tutor|material|material-print|admission|ss|todo|kdp|wiki|memo|workflow)\/)$/;

let authBusy = false;
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
  try {
    localStorage.setItem(PENDING_DESTINATION_KEY, value);
  } catch {
    /* Navigation still works without local storage. */
  }
}

function consumePendingDestination() {
  let value;
  try {
    value = localStorage.getItem(PENDING_DESTINATION_KEY);
    localStorage.removeItem(PENDING_DESTINATION_KEY);
  } catch {
    return "";
  }
  return isSafeDestination(value) ? value : "";
}

function showSignedOut(message = "") {
  dashboard.signedOut();
  settleAuthState("signed-out");
  els.authError.textContent = message;
  els.authAction.setAttribute("aria-label", "Googleでログイン");
  els.authAction.title = "Googleでログイン";
  els.userAvatar.hidden = true;
  els.userAvatar.removeAttribute("src");
  els.userAvatarFallback.hidden = false;
}

function showSignedIn(user) {
  dashboard.signedIn(user);
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

document.addEventListener("click", async (event) => {
  const link = event.target.closest("a[href]");
  if (
    event.defaultPrevented ||
    !link ||
    link.origin !== location.origin ||
    !isSafeDestination(link.pathname) ||
    link.pathname === "/" ||
    authState === "signed-in"
  )
    return;
  event.preventDefault();
  if (authBusy) return;
  authBusy = true;
  const destination = link.pathname;
  savePendingDestination(destination);
  try {
    const state = await waitForAuthState();
    if (state === "signed-in") {
      window.location.assign(destination);
      return;
    }
    signIn("/tutor/");
  } catch (error) {
    els.authError.textContent =
      error instanceof Error ? error.message : String(error);
  } finally {
    setTimeout(() => {
      authBusy = false;
    }, 1500);
  }
});

els.authAction.addEventListener("click", async () => {
  if (authBusy || !dashboard.canLeave()) return;
  authBusy = true;
  els.authAction.disabled = true;
  els.authError.textContent = "";
  try {
    const state = await waitForAuthState();
    if (state === "signed-in") {
      dashboard.clear();
      await signOutUser();
      showSignedOut();
      return;
    }
    savePendingDestination("/");
    signIn("/tutor/");
  } catch (error) {
    els.authError.textContent =
      error instanceof Error ? error.message : String(error);
  } finally {
    authBusy = false;
    els.authAction.disabled = false;
  }
});

els.openSettings.addEventListener("click", () => {
  const current = getTheme();
  els.themeRadios.forEach((radio) => {
    radio.checked = radio.value === current;
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
