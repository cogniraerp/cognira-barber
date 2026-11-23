import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en/common.json';
import es from '@/locales/es/common.json';

const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('barbersaas.lang') : null;

void i18n.use(initReactI18next).init({
  resources: { es: { common: es }, en: { common: en } },
  lng: saved ?? (navigator.language?.startsWith('en') ? 'en' : 'es'),
  fallbackLng: 'es',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

export function setLanguage(lng: 'es' | 'en'): void {
  localStorage.setItem('barbersaas.lang', lng);
  document.documentElement.lang = lng;
  void i18n.changeLanguage(lng);
}

export default i18n;
