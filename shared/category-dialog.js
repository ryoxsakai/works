// Native dialogs provide focus containment, Escape and focus restoration.
export function categoryDialog(onClose) {
  const dialog = document.getElementById('category-modal');
  let previousOverflow;
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button, input')]
      .filter((element) => !element.disabled && element.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first?.focus();
    }
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    onClose();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  });
  return {
    open() {
      if (dialog.open) return;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      dialog.showModal();
      document.getElementById('new-category-input').focus();
    },
    close() {
      dialog.close();
      document.body.style.overflow = previousOverflow ?? '';
    },
    focus(index, action = 'startEditCat', direction) {
      const args = direction === undefined ? index : `${index},${direction}`;
      const button = dialog.querySelector(`[onclick="${action}(${args})"]`);
      const target = button && !button.disabled ? button :
        dialog.querySelector(`[onclick="startEditCat(${index})"]`);
      target?.focus();
    },
  };
}
