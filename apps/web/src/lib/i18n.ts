/**
 * Instância do i18next (fundação de i18n, Onda 6a).
 *
 * `en` é o idioma DEFAULT do app a partir de agora — `pt-BR` continua
 * mantido e selecionável (ver o plano da Onda 6). O idioma inicial vem de
 * {@link idiomaInicial} (cache do navegador ou sugestão de
 * `navigator.language`) para não esperar a sessão terminar de restaurar;
 * `apps/web/src/lib/idioma.ts#sincronizarIdiomaDaSessao` troca para o valor
 * do SERVIDOR assim que ele chega.
 *
 * Só o namespace `common` existe por ora, com as strings que a `AccountPage`
 * usa — a extração do resto da interface é etapa SEPARADA, em paralelo,
 * depois desta fundação (ver o programa maior). Namespace novo entra aqui,
 * nos `resources`, sem mexer no resto deste arquivo.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import commonEn from '../locales/en/common.json';
import commonPtBR from '../locales/pt-BR/common.json';
import { idiomaInicial } from './idioma';

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: commonEn },
    'pt-BR': { common: commonPtBR },
  },
  lng: idiomaInicial(),
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common'],
  interpolation: { escapeValue: false }, // React já escapa.
  returnNull: false,
});

export default i18n;
