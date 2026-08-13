import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { firebaseConfig, ALLOWED_EMAIL } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Firebaseのセッションはリロード後も残るが、Googleのアクセストークンはメモリ上にしか保持しないため
// カレンダーAPIを叩くにはリロードのたびに再ログインが必要になる(単一ユーザー運用なので許容)。
let googleAccessToken = null;

export function getGoogleAccessToken() {
  return googleAccessToken;
}

export function watchAuth({ onSignedIn, onSignedOut }) {
  onAuthStateChanged(auth, (user) => {
    if (user && user.email?.toLowerCase() === ALLOWED_EMAIL.toLowerCase()) {
      onSignedIn(user);
    } else {
      if (user) signOut(auth);
      onSignedOut();
    }
  });
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.addScope("https://www.googleapis.com/auth/calendar.readonly");
  provider.setCustomParameters({ login_hint: ALLOWED_EMAIL });
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  googleAccessToken = credential?.accessToken ?? null;
  return result.user;
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
