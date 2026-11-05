/** Preserve disclosure and keyboard context when background reads repaint the same view. */
export function createView(element) {
  let currentKey;
  let pendingFocus;
  const disclosures = new Map();
  return (html, key) => {
    if (key !== currentKey) {
      disclosures.clear();
      pendingFocus = undefined;
    } else
      for (const detail of element.querySelectorAll('details[data-ui-key]'))
        disclosures.set(detail.dataset.uiKey, detail.open);
    const active = document.activeElement;
    const identity = element.contains(active)
      ? [...active.attributes].find(
          (attribute) => attribute.name === 'id' || attribute.name.startsWith('data-'),
        )
      : undefined;
    if (identity) pendingFocus = identity;
    else if (active !== document.body) pendingFocus = undefined;
    currentKey = key;
    element.innerHTML = html;
    for (const detail of element.querySelectorAll('details[data-ui-key]')) {
      if (disclosures.has(detail.dataset.uiKey))
        detail.open = disclosures.get(detail.dataset.uiKey);
    }
    if (pendingFocus) {
      const control = element.querySelector(
        `[${pendingFocus.name}="${CSS.escape(pendingFocus.value)}"]`,
      );
      if (control) {
        control.focus({ preventScroll: true });
        pendingFocus = undefined;
      }
    }
  };
}
