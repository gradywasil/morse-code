// Give a transmission one Back step without adding entries for edits or replays.
export function createBroadcastBack({ history, target, onBack }) {
  let active = false;
  let returning = false;
  let wanted = false;

  function setActive(value) {
    wanted = value;
    if (returning) return;
    if (value && !active) {
      history.pushState(history.state, '');
      active = true;
    } else if (!value && active) {
      active = false;
      returning = true;
      history.back();
    }
  }

  target.addEventListener('popstate', () => {
    if (returning) {
      returning = false;
      if (wanted) setActive(true);
    } else if (active) {
      active = false;
      wanted = false;
      onBack();
    }
  });

  return { setActive };
}
