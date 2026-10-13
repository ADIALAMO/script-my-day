// "Does any text line leave the box's content area?" — pure geometry behind the script-box glyph-fit checks (unit-tested in tests/glyph-fit.test.js; the
// browser-side measurement lives in scripts/measure-script-box.mjs). All numbers are viewport coordinates from getBoundingClientRect / Range.getClientRects.

/**
 * Content rectangle (inside border, scrollbar and padding) of a scroll container.
 * A vertical scrollbar sits on the LEFT of a right-to-left container and on the right otherwise, so the rect must skip it on the right side only.
 * m = { left, offsetWidth, clientWidth, borderLeft, borderRight, paddingLeft, paddingRight, rtl }
 */
export function contentRect(m) {
  const borderL = m.borderLeft || 0;
  const borderR = m.borderRight || 0;
  const scrollbar = Math.max(0, m.offsetWidth - m.clientWidth - borderL - borderR);
  const innerLeft = m.left + borderL + (m.rtl ? scrollbar : 0);
  const left = innerLeft + (m.paddingLeft || 0);
  const right = innerLeft + m.clientWidth - (m.paddingRight || 0);
  return { left, right };
}

/** line rectangles (zero-width ones ignored) that stick out of the content rect by more than `tolerance` px, with how far */
export function findOutside(rects, content, tolerance = 0.5) {
  const out = [];
  for (const r of rects) {
    if (!(r.right - r.left > 0)) continue;
    const overLeft = content.left - r.left;
    const overRight = r.right - content.right;
    if (overLeft > tolerance || overRight > tolerance) out.push({ left: r.left, right: r.right, overLeft: Math.max(0, overLeft), overRight: Math.max(0, overRight) });
  }
  return out;
}

/** a fixed frame radius clips scrolling text only if the text can come closer to a side than the radius: padding must be at least the radius */
export const radiusClipsText = ({ radius, paddingLeft, paddingRight }) => radius > Math.min(paddingLeft, paddingRight);
