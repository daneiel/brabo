/**
 * Instância do i18next (fundação de i18n, Onda 6a).
 *
 * `pt-BR` é o idioma DEFAULT e o `fallbackLng` desde o ADR 0216 (RN-891);
 * `en`, `ru` e `zh-Hans` são selecionáveis. Locale sem pasta em `locales/`
 * não quebra nada: o glob volta vazio e a tela cai no pt-BR. O idioma inicial vem de
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
import { aplicarLangNoDocumento, IDIOMA_PADRAO, idiomaInicial } from './idioma';

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

const modulos = import.meta.glob<ModuloJson>('../locales/*/*.json', { eager: true });

/** Recursos por locale, a partir das pastas que EXISTEM em `locales/`. */
function recursosPorLocale(): Record<string, Record<string, RecursoDeNamespace>> {
  const porLocale: Record<string, Record<string, ModuloJson>> = {};
  for (const [caminho, modulo] of Object.entries(modulos)) {
    const partes = caminho.split('/');
    const locale = partes[partes.length - 2];
    (porLocale[locale] ??= {})[caminho] = modulo;
  }
  const recursos: Record<string, Record<string, RecursoDeNamespace>> = {};
  for (const [locale, mods] of Object.entries(porLocale)) {
    recursos[locale] = recursosPorNamespace(mods);
  }
  return recursos;
}

const recursos = recursosPorLocale();

/** Os locales com catálogo (pasta em `locales/`). O resto cai no pt-BR. */
export const LOCALES_COM_CATALOGO: readonly string[] = Object.keys(recursos);

export function temCatalogo(idioma: string): boolean {
  return LOCALES_COM_CATALOGO.includes(idioma);
}

i18n.on('languageChanged', aplicarLangNoDocumento);

void i18n.use(initReactI18next).init({
  resources: recursos,
  lng: idiomaInicial(),
  fallbackLng: IDIOMA_PADRAO,
  defaultNS: 'common',
  ns: Object.keys(recursos[IDIOMA_PADRAO] ?? {}),
  interpolation: { escapeValue: false }, // React já escapa.
  returnNull: false,
});

aplicarLangNoDocumento(i18n.language);

export default i18n;
