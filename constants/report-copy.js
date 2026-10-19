// Copy for the in-app "Report" control (components/ReportButton.jsx). Every string exists in he AND en.
export const REPORT_COPY = {
  button:     { en: 'Report', he: 'דווח' },
  buttonAria: { en: 'Report this image as inappropriate', he: 'דווח על התמונה כלא הולמת' },
  title: {
    poster: { en: 'Report this poster', he: 'דיווח על הפוסטר' },
    panel:  { en: 'Report this image',  he: 'דיווח על התמונה' },
    reel:   { en: 'Report this reel',   he: 'דיווח על הריל' },
    character: { en: 'Report this character image', he: 'דיווח על תמונת הדמות' },
    script: { en: 'Report this script', he: 'דיווח על התסריט' },
  },
  // A generated SCRIPT (text): nothing is stored on our side, so it is hidden on this device and the team is alerted with reason / genre / language only.
  buttonAriaScript: { en: 'Report this script as inappropriate', he: 'דיווח על התסריט כלא הולם' },
  introScript: {
    en: 'Tell us what is wrong. This script will be hidden on this device and our team will be notified. We do not receive the text itself.',
    he: 'ספרו לנו מה לא בסדר. התסריט יוסתר במכשיר הזה והצוות שלנו יקבל התראה. אנחנו לא מקבלים את הטקסט עצמו.',
  },
  doneScript: { en: 'Thanks. This script is hidden on this device and our team has been notified.', he: 'תודה. התסריט הוסתר במכשיר הזה והצוות שלנו קיבל התראה.' },
  hiddenScript: { en: 'Script hidden after your report', he: 'התסריט הוסתר לאחר הדיווח שלכם' },
  intro: {
    en: 'Tell us what is wrong. The image will be hidden and our team will be notified.',
    he: 'ספר לנו מה לא בסדר. התמונה תוסתר והצוות שלנו יקבל התראה.',
  },
  // Gallery (static showcase) items: hidden for the reporter only, the team is notified. Never claims the item is removed for everyone.
  introGallery: {
    en: 'Tell us what is wrong. This item will be hidden for you and our team will be notified.',
    he: 'ספר לנו מה לא בסדר. הפריט יוסתר עבורך והצוות שלנו יקבל התראה.',
  },
  doneGallery: { en: 'Thanks. This item is hidden for you and our team has been notified.', he: 'תודה. הפריט הוסתר עבורך והצוות שלנו קיבל התראה.' },
  reasons: {
    sexual:  { en: 'Sexual content or nudity', he: 'תוכן מיני או עירום' },
    violent: { en: 'Violent or disturbing',    he: 'אלים או מטריד' },
    other:   { en: 'Something else',           he: 'אחר' },
  },
  send:    { en: 'Send report', he: 'שלח דיווח' },
  sending: { en: 'Sending…',    he: 'שולח…' },
  cancel:  { en: 'Cancel',      he: 'ביטול' },
  done:    { en: 'Thanks. This image is hidden and our team has been notified.', he: 'תודה. התמונה הוסתרה והצוות שלנו קיבל התראה.' },
  errors: {
    rate:    { en: 'Too many reports. Try again in a few minutes.', he: 'יותר מדי דיווחים. נסה שוב בעוד כמה דקות.' },
    failed:  { en: "Couldn't send the report. Check your connection and try again.", he: 'לא הצלחנו לשלוח את הדיווח. בדוק את החיבור ונסה שוב.' },
    invalid: { en: "This image can't be reported.", he: 'לא ניתן לדווח על התמונה הזו.' },
    invalidScript: { en: "This script can't be reported.", he: 'לא ניתן לדווח על התסריט הזה.' },
  },
  hiddenTile: { en: 'Hidden after your report', he: 'הוסתר לאחר הדיווח שלך' },
  reelNotice: { en: 'Reel removed after your report.', he: 'הריל הוסר לאחר הדיווח שלך.' },
};

export const reportText = (entry, lang) => (entry && (entry[lang] ?? entry.en)) || '';
