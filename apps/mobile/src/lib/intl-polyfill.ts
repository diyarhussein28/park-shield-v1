// Hermes (the JavaScript engine of React Native) has Intl.DateTimeFormat and Intl.NumberFormat, but no
// Intl.PluralRules and no Intl.Locale, which the website's ICU texts need for plurals („1 Stunde“ /
// „2 Stunden“). Each polyfill installs itself only where the API is missing (Node/Jest keep their own),
// with the plural rules of the two app languages. Imported first by ./portal-i18n.
import '@formatjs/intl-getcanonicallocales/polyfill.js';
import '@formatjs/intl-locale/polyfill.js';
import '@formatjs/intl-pluralrules/polyfill.js';
import '@formatjs/intl-pluralrules/locale-data/de.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';
