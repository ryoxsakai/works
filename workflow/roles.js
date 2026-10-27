import { showDialog, closeDialog } from "./dialogs.mjs";
import {
  watchAuth,
  signIn,
  signOutUser,
  getSessionToken,
} from "/shared/auth.js?v=12";
const $ = (s) => document.querySelector(s),
  dialog = $("#role-editor"),
  form = $("#role-form");
let roles = [],
  editing = null,
  busy = false,
  opener;
const node = (tag, text) => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
async function api(body) {
  const r = await fetch("/api/workflow", {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + getSessionToken(),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || r.status);
  return data;
}
async function guard(fn, target = "#error") {
  if (busy) return;
  busy = true;
  $(target).textContent = "";
  try {
    await fn();
  } catch (e) {
    $(target).textContent = e.message;
  } finally {
    busy = false;
  }
}
function open(role, button) {
  editing = role;
  opener = button;
  form.reset();
  $("#role-error").textContent = "";
  $("#role-title").textContent = role ? "担当を編集" : "担当を追加";
  for (const [k, v] of Object.entries(role?.data || {}))
    if (form.elements[k]) form.elements[k].value = v;
  showDialog(dialog);
}
async function load() {
  const data = await api();
  roles = data.roles || [];
  $("#roles").replaceChildren();
  if (data.roles === null) {
    $("#error").textContent = "担当機能は migration 0002 の適用が必要です";
    $("#new-role").disabled = true;
  }
  for (const role of roles) {
    const card = node("article", "");
    card.className = "wf-definition";
    const badge = node(
      "h3",
      role.data.icon +
        " " +
        role.data.name +
        (role.archived ? "（アーカイブ）" : ""),
    );
    badge.className = "wf-role role-" + role.data.color;
    card.append(badge);
    for (const [k, label] of [
      ["responsibilities", "責任"],
      ["operations", "操作範囲"],
      ["completion", "完了条件"],
    ])
      card.append(node("p", label + "：" + role.data[k]));
    if (!role.archived) {
      const edit = node("button", "編集");
      edit.onclick = () => open(role, edit);
      const archive = node("button", "削除・アーカイブ");
      archive.onclick = () =>
        guard(async () => {
          if (
            !confirm(
              "履歴を残してアーカイブします。未完了の工程・定義は先に別の担当へ変更してください。",
            )
          )
            return;
          await api({
            action: "role_archive",
            role_id: role.id,
            revision: role.revision,
          });
          await load();
        });
      card.append(edit, archive);
    }
    $("#roles").append(card);
  }
}
$("#new-role").onclick = (e) => open(null, e.target);
$("#close-role").onclick = () => closeDialog(dialog);
dialog.addEventListener("close", () => opener?.focus());
form.onsubmit = (e) => {
  e.preventDefault();
  guard(async () => {
    const content = Object.fromEntries(new FormData(form));
    await api({
      action: editing ? "role_edit" : "role_create",
      ...(editing ? { role_id: editing.id, revision: editing.revision } : {}),
      content,
    });
    closeDialog(dialog);
    await load();
  }, "#role-error");
};
watchAuth({
  onSignedIn: () => {
    $("#workspace").hidden = false;
    $("#auth").textContent = "ログアウト";
    $("#auth").onclick = signOutUser;
    guard(load);
  },
  onSignedOut: () => {
    $("#workspace").hidden = true;
    closeDialog(dialog);
    roles = [];
    $("#roles").replaceChildren();
    $("#auth").textContent = "ログイン";
    $("#auth").onclick = signIn;
  },
});
