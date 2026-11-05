/** Local wall clock: update only this element, once per minute while visible. */
export function startHeaderClock(element: HTMLTimeElement) {
  const date = element.querySelector<HTMLElement>('.clock-date')!;
  const time = element.querySelector<HTMLElement>('.clock-time')!;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function update() {
    clearTimeout(timer);
    if (document.hidden) return;
    const now = new Date();
    date.textContent = now.toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric'});
    time.textContent = now.toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'});
    element.dateTime = now.toISOString();
    element.title = now.toLocaleString(undefined, {dateStyle:'full', timeStyle:'long'});
    element.setAttribute('aria-label', element.title);
    timer = setTimeout(update, 60000 - (Date.now() % 60000));
  }
  document.addEventListener('visibilitychange', update);
  window.addEventListener('focus', update);
  update();
}
