const el = (): HTMLElement => document.getElementById('tip') as HTMLElement;

/** Show the shared tooltip near the pointer. */
export function showTip(html: string, e: PointerEvent | MouseEvent): void {
  const t = el();
  t.innerHTML = html;
  t.hidden = false;
  const { innerWidth: w } = window;
  const r = t.getBoundingClientRect();
  const x = Math.min(e.clientX + 12, w - r.width - 8);
  const y =
    e.clientY - r.height - 12 < 8 ? e.clientY + 16 : e.clientY - r.height - 12;
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${y}px`;
}

export function hideTip(): void {
  el().hidden = true;
}
