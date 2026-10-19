/**
 * The script text comes from the model with Markdown-style bold (**CHARACTERS:**, **ADAM:**). It is shown as plain text in a pre-wrap box,
 * so the asterisks used to appear literally. splitBold() turns it into segments the view renders as <strong>.
 *  - "**x**" -> bold segment "x"; the asterisks are never shown
 *  - an UNCLOSED "**" (the typewriter is mid-word, or a cut-off answer) bolds the rest instead of flashing raw asterisks
 *  - a lone "*" is kept as text; the text of the script itself is not changed (copy / edit / export keep working on the raw string)
 */
export function splitBold(text) {
  const src = String(text ?? '');
  const parts = src.split('**');
  const out = [];
  parts.forEach((part, i) => {
    if (part === '') return;
    const bold = i % 2 === 1;
    // single *emphasis* inside a segment becomes italic; a lone, unpaired "*" stays as text
    const bits = part.split('*');
    if (bits.length < 3) { out.push({ text: part, bold }); return; }
    const pairs = Math.floor((bits.length - 1) / 2);
    bits.forEach((bit, j) => {
      if (bit === '') return;
      const inPair = j % 2 === 1 && j <= pairs * 2 - 1;
      out.push(inPair ? { text: bit, bold, italic: true } : { text: bit, bold });
    });
  });
  return out;
}
