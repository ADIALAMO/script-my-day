// What kind of file did the user pick for "Star Yourself"? Pure, no DOM — unit-tested (tests/character-file.test.js).
//   'heic'      looks like HEIC / HEIF (Apple's photo format) by MIME type OR file extension. Safari can decode it, most other desktop browsers cannot,
//               so this only chooses the MESSAGE (and the heic_detected count) when the decode fails — it never blocks a file that decodes.
//   'not_image' a MIME type that is not image/* (and not HEIC by extension)
//   'ok'        anything else (the browser decides whether it can read it)
const HEIC_TYPE = /^image\/hei[cf](-sequence)?$/i;
const HEIC_EXT = /\.(heic|heif|hif)$/i;   // only the LAST extension counts: photo.heic.jpg is a JPEG name

export function classifyPickedFile(file) {
  const type = String(file?.type ?? '').trim();
  const name = String(file?.name ?? '');
  if (HEIC_TYPE.test(type) || HEIC_EXT.test(name)) return 'heic';
  if (!type.toLowerCase().startsWith('image/')) return 'not_image';
  return 'ok';
}
