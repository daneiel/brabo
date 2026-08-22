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
 * Os namespaces são DESCOBERTOS, não registrados à mão: todo arquivo em
 * `locales/{en,pt-BR}/<namespace>.json` vira um namespace automaticamente
 * via `import.meta.glob` (Vite). Isso existe porque a extração de strings do
 * resto da interface roda em DEZENAS de agentes em paralelo (Onda 6b) — se
 * cada um precisasse editar este arquivo pra registrar seu próprio
 * namespace, seria um arquivo compartilhado colidindo dezenas de vezes.
 * Namespace novo é só criar os dois arquivos JSON; nada aqui muda.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { idiomaInicial } from './idioma';

type RecursoDeNamespace = Record<string, unknown>;
type ModuloJson = { default: RecursoDeNamespace };

function nomeDoNamespace(caminho: string): string {
  return (caminho.split('/').pop() ?? '').replace(/\.json$/, '');
}

function recursosPorNamespace(
  modulos: Record<string, ModuloJson>,
): Record<string, RecursoDeNamespace> {
  const recursos: Record<string, RecursoDeNamespace> = {};
  for (const [caminho, modulo] of Object.entries(modulos)) {
    recursos[nomeDoNamespace(caminho)] = modulo.default;
  }
  return recursos;
}

const modulosEn = import.meta.glob<ModuloJson>('../locales/en/*.json', { eager: true });
const modulosPtBR = import.meta.glob<ModuloJson>('../locales/pt-BR/*.json', { eager: true });

const recursosEn = recursosPorNamespace(modulosEn);
const recursosPtBR = recursosPorNamespace(modulosPtBR);

void i18n.use(initReactI18next).init({
  resources: {
    en: recursosEn,
    'pt-BR': recursosPtBR,
  },
  lng: idiomaInicial(),
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: Object.keys(recursosEn),
  interpolation: { escapeValue: false }, // React já escapa.
  returnNull: false,
});

export default i18n;
