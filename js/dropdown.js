// js/dropdown.js — a compact choice control: a key that shows the current
// choice and opens the others in place (not a floating layer, so it can never
// be clipped by a dialog). Keyboard: arrows/Home/End move, Enter/Space choose,
// Escape closes just the list. Used for the accent colour and the screen light.

let uid = 0;

/**
 * @param {{host: HTMLElement, options: Array<{id: string, label: string, swatch?: string}>,
 *          value: string, onChange: (id: string) => void}} config
 *   host — an element with data-labelledby naming the visible label's id.
 * @returns {{setValue: (id: string) => void, setDisabled: (off: boolean) => void}}
 */
export function createDropdown({ host, options, value, onChange }) {
  const doc = host.ownerDocument;
  const labelId = host.dataset.labelledby ?? '';
  const n = ++uid;
  const buttonId = `dd-button-${n}`;
  let current = options.some((o) => o.id === value) ? value : options[0].id;

  const make = (tag, className, text) => {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const swatchOf = (option) => {
    if (!option.swatch) return null;
    const dot = make('span', 'dd-swatch');
    dot.setAttribute('aria-hidden', 'true');
    dot.style.background = option.swatch;
    return dot;
  };

  const button = make('button', 'key dd-button');
  button.type = 'button';
  button.id = buttonId;
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  if (labelId) button.setAttribute('aria-labelledby', `${labelId} ${buttonId}`);

  const list = make('ul', 'dd-list');
  list.setAttribute('role', 'listbox');
  if (labelId) list.setAttribute('aria-labelledby', labelId);
  list.hidden = true;

  const items = options.map((option) => {
    const item = make('li', 'key dd-option');
    item.setAttribute('role', 'option');
    item.tabIndex = -1;
    item.dataset.id = option.id;
    const dot = swatchOf(option);
    if (dot) item.append(dot);
    item.append(make('span', '', option.label));
    list.append(item);
    return item;
  });

  function paintButton() {
    const option = options.find((o) => o.id === current);
    button.replaceChildren();
    const dot = swatchOf(option);
    if (dot) button.append(dot);
    button.append(make('span', 'dd-value', option.label), make('span', 'dd-caret'));
    for (const item of items) item.setAttribute('aria-selected', String(item.dataset.id === current));
  }

  function open() {
    if (button.disabled) return;
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    (items.find((i) => i.dataset.id === current) ?? items[0]).focus();
  }
  function close(refocus = false) {
    if (list.hidden) return;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (refocus) button.focus();
  }
  function choose(id) {
    const changed = id !== current;
    current = id;
    paintButton();
    close(true);
    if (changed) onChange(id);
  }

  button.addEventListener('click', () => (list.hidden ? open() : close(true)));
  list.addEventListener('click', (event) => {
    const item = event.target.closest('.dd-option');
    if (item) choose(item.dataset.id);
  });
  list.addEventListener('keydown', (event) => {
    const at = items.indexOf(doc.activeElement);
    const go = (i) => { event.preventDefault(); items[(i + items.length) % items.length].focus(); };
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') go(at + 1);
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(items.length - 1);
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (at >= 0) choose(items[at].dataset.id);
    } else if (event.key === 'Escape') {
      event.preventDefault(); // closes the list, not the dialog around it
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') close();
  });
  doc.addEventListener('click', (event) => { if (!host.contains(event.target)) close(); });
  host.closest('dialog')?.addEventListener('close', () => close());

  host.replaceChildren(button, list);
  paintButton();

  return {
    setValue(id) { if (options.some((o) => o.id === id)) { current = id; paintButton(); } },
    setDisabled(off) { button.disabled = off; if (off) close(); },
  };
}
