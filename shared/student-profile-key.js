// Original Tutor name-key selection. This computes an existing storage key, not person identity.

export function isGroupLessonTitle(title) {
  const name = selectionTitleWithoutAnnotation(title).normalize("NFKC");
  return /[AM]/.test(name) || /集団|グループ/.test(title)
    || /^(?:中堅大英語|英語中堅大|高1長文読解)$/.test(name.replace(/\s/g, ""));
}

export function selectionTitleWithoutAnnotation(title) {
  return String(title || "").split(/[（(【\[/／]/, 1)[0].trim();
}

export function curriculumSelectionName(title) {
  const text = String(title || "").trim();
  if (isGroupLessonTitle(text)) return text;
  return selectionTitleWithoutAnnotation(text);
}

export function studentProfileName(ref,binding){const title=String(ref.title||'').trim();if(!binding)return title;const name=curriculumSelectionName(title);if(binding.context!=='curriculum'||!name||binding.name!==name)throw Object.assign(new Error('元の予定から確定できる名前キーを確認してください。'),{status:400});return name;}
export const studentProfileFields=binding=>binding?{profile_context:'curriculum'}:{};
export function studentProfileQuery(ref,binding){return new URLSearchParams({calendar_id:ref.calendar_id,event_id:ref.id,...(binding?{name:studentProfileName(ref,binding),profile_context:'curriculum'}:{})});}
export function curriculumProfileBinding(ref,preferredName){const name=preferredName??curriculumSelectionName(ref.title);if(name===ref.title.trim())return undefined;const binding={name,context:'curriculum'};studentProfileName(ref,binding);return binding;}
