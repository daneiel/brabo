/**
 * A preferência de idioma — ler, gravar e sincronizar (fundação de i18n,
 * Onda 6a).
 *
 * Mesmo espírito de `tema.ts`, com uma diferença estrutural: tema é
 * client-side puro; idioma é persistido no SERVIDOR, por usuário (o dono do
 * produto pediu explicitamente — ver o plano da Onda 6). Isso muda onde mora
 * a fonte de verdade:
 *
 * - O SERVIDOR é a fonte de verdade. O valor chega no corpo de
 *   `/auth/login` e `/auth/refresh` (ver `lib/auth.ts#localeDaSessao`) —
 *   nunca uma chamada separada só para descobrir o idioma.
 * - `localStorage['brabo.locale']` é só CACHE, para o primeiro paint não
 *   piscar no idioma errado antes da sessão terminar de restaurar. Nunca
 *   escrito por conta própria como se fosse a verdade.
 * - Sem sessão nenhuma (tela de login/cadastro), `navigator.language` é só
 *   SUGESTÃO de exibição — nunca persistida até existir conta.
 *
 * ## O que a UI consome
 *
 * `main.tsx` assina `onMudancaDeSessao` (já existe em `auth.ts`) e chama
 * {@link sincronizarIdiomaDaSessao} sempre que a sessão muda — isso cobre o
 * boot (`restaurarSessao`) E o login, sem duplicar o gancho. A `AccountPage`
 * chama {@link definirIdioma} para gravar uma escolha nova.
 */

import type { i18n as I18nInstance } from 'i18next';
import { localeDaSessao } from './auth';
import { updateMyPreferences } from './api-client';
import type { UserLocale } from './api-types';

export type Idioma = UserLocale;

/** A chave do `localStorage`. Só cache — ver o docblock acima. */
export const CHAVE_IDIOMA = 'brabo.locale';

/**
 * O default do APP para quem ainda não tem preferência nenhuma — `pt-BR`
 * desde o ADR 0216 (RN-891), que reverteu o `en` da Onda 6. É também o
 * `fallbackLng` de `i18n.ts`: idioma sem catálogo cai aqui, nunca no inglês.
 */
export const IDIOMA_PADRAO: Idioma = 'pt-BR';

/** Os quatro idiomas da interface (ADR 0216 item 2), na ordem do seletor. */
export const IDIOMAS: readonly Idioma[] = ['pt-BR', 'en', 'ru', 'zh-Hans'];

/** O nome de cada idioma NELE MESMO — rótulo do seletor, nunca traduzido. */
export const ROTULO_NATIVO: Record<Idioma, string> = {
  'pt-BR': 'Português (Brasil)',
  en: 'English',
  ru: 'Русский',
  'zh-Hans': '简体中文',
};

export function ehIdioma(valor: unknown): valor is Idioma {
  return typeof valor === 'string' && (IDIOMAS as readonly string[]).includes(valor);
}

/**
 * Resolve uma tag BCP-47 do navegador para um dos quatro idiomas (ADR 0216
 * item 3): `pt*` → pt-BR; `zh`, `zh-CN`, `zh-SG` e `zh-Hans*` → zh-Hans;
 * `ru*` → ru; `en*` → en; qualquer outra (inclusive `zh-TW`/`zh-Hant`) →
 * pt-BR, o padrão (item 4).
 */
export function resolverIdiomaDoNavegador(tag: string): Idioma {
  const t = tag.trim().toLowerCase();
  const primario = t.split('-')[0];
  if (primario === 'pt') return 'pt-BR';
  if (primario === 'ru') return 'ru';
  if (primario === 'en') return 'en';
  if (
    t === 'zh' ||
    t === 'zh-cn' ||
    t === 'zh-sg' ||
    t === 'zh-hans' ||
    t.startsWith('zh-hans-')
  ) {
    return 'zh-Hans';
  }
  return IDIOMA_PADRAO;
}

/** Acompanha o idioma ativo no `<html lang>` (ADR 0216 item 2). */
export function aplicarLangNoDocumento(idioma: string): void {
  if (typeof document !== 'undefined') document.documentElement.lang = idioma;
}

/** A preferência em CACHE, ou `null` se não houver nenhuma ainda. */
export function lerIdiomaCache(): Idioma | null {
  try {
    const salvo = window.localStorage.getItem(CHAVE_IDIOMA);
    return ehIdioma(salvo) ? salvo : null;
  } catch {
    return null;
  }
}

function gravarIdiomaCache(idioma: Idioma): void {
  try {
    window.localStorage.setItem(CHAVE_IDIOMA, idioma);
  } catch {
    // Sem persistência: a escolha vale para esta aba. Mesma degradação de
    // `tema.ts` — idioma é preferência, não função.
  }
}

/**
 * O que `navigator.language` sugere, para quem ainda não tem conta (tela de
 * login/cadastro) — NUNCA persistido a partir daqui.
 */
export function idiomaSugeridoPeloNavegador(): Idioma {
  const lang = typeof navigator !== 'undefined' ? navigator.language : '';
  return resolverIdiomaDoNavegador(lang ?? '');
}

/**
 * O idioma para inicializar o i18next ANTES de a sessão terminar de
 * restaurar — cache gravado vence a sugestão do navegador, que vence o
 * default do app. Nunca lança.
 */
export function idiomaInicial(): Idioma {
  return lerIdiomaCache() ?? idiomaSugeridoPeloNavegador();
}

/**
 * Aplica o valor que o SERVIDOR mandou (login/refresh) — chamada pelo
 * ouvinte de `onMudancaDeSessao` em `main.tsx`. Sessão que caiu (`locale`
 * nulo) não mexe no idioma da tela: a pessoa não pediu para trocar, só
 * deslogou.
 */
export function sincronizarIdiomaDaSessao(i18n: I18nInstance): void {
  const doServidor = localeDaSessao();
  if (!ehIdioma(doServidor)) return;
  if (i18n.language === doServidor) return;
  gravarIdiomaCache(doServidor);
  void i18n.changeLanguage(doServidor);
}

/**
 * Troca o idioma: grava no servidor, atualiza o cache e troca a tela — nessa
 * ordem, porque se o servidor recusar a escolha não deve "colar" localmente.
 */
export async function definirIdioma(
  idioma: Idioma,
  i18n: I18nInstance,
): Promise<void> {
  await updateMyPreferences({ locale: idioma });
  gravarIdiomaCache(idioma);
  await i18n.changeLanguage(idioma);
}
