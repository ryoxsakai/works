import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { firebaseConfig, ALLOWED_EMAIL } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Firebaseのセッションはリロード後も残るが、Googleのアクセストークンはメモリ上にしか保持しないため
// カレンダーAPIを叩くには再ログインのたびに取り直しになる(単一ユーザー運用なので許容)。
let googleAccessToken = null;
let redirectError = null;

// signInWithPopupはモバイルブラウザだとポップアップのライフサイクルが不安定で
// auth/cancelled-popup-request 等が起きやすいため、リダイレクト方式を使う。
// ログイン後にこのページへ戻ってきた時点でここが実行され、結果を受け取る。
const redirectResultPromise = getRedirectResult(auth)
  .then((result) => {
    if (result) {
      const credential = GoogleAuthProvider.credentialFromResult(result);
      googleAccessToken = credential?.accessToken ?? null;
    }
  })
  .catch((err) => {
    redirectError = err;
  });

export function getGoogleAccessToken() {
  return googleAccessToken;
}

export async function watchAuth({ onSignedIn, onSignedOut, onError }) {
  await redirectResultPromise;
  if (redirectError && onError) onError(redirectError);

  onAuthStateChanged(auth, (user) => {
    if (user && user.email?.toLowerCase() === ALLOWED_EMAIL.toLowerCase()) {
      onSignedIn(user);
    } else {
      if (user) signOut(auth);
      onSignedOut();
    }
  });
}

export function signIn() {
  const provider = new GoogleAuthProvider();
  provider.addScope("https://www.googleapis.com/auth/calendar.readonly");
  provider.setCustomParameters({ login_hint: ALLOWED_EMAIL });
  return signInWithRedirect(auth, provider);
}

export function signOutUser() {
  googleAccessToken = null;
  return signOut(auth);
}

export async function getIdToken() {
  const user = auth.currentUser;
  if (!user) throw new Error("not signed in");
  return user.getIdToken();
}
