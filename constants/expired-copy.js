// Copy for a stored poster / comic panel that the storage lifecycle already deleted (utils/expired-image.js). Every string exists in he AND en.
// No numbers on purpose: the retention periods live in config/limits.js and the dashboard, and this text must not go stale.
export const EXPIRED_COPY = {
  message: {
    en: 'This image was deleted automatically after the storage period. Your script is still here — create a new poster or comic.',
    he: 'התמונה הזו נמחקה אוטומטית בתום תקופת האחסון. התסריט שלך עדיין כאן — אפשר ליצור פוסטר או קומיקס חדשים.',
  },
};
export const expiredText = (lang) => EXPIRED_COPY.message[lang === 'he' ? 'he' : 'en'];
