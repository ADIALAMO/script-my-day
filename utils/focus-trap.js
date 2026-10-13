// Tab order inside a small dialog (pure). `at` = index of the focused element in the dialog's focusable list, or -1 when focus is outside it.
export function nextFocusIndex(count, at, backwards = false) {
  if (!(count > 0)) return -1;
  if (at < 0) return backwards ? count - 1 : 0;
  return backwards ? (at - 1 + count) % count : (at + 1) % count;
}
