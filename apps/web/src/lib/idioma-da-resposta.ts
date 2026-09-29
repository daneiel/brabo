/**
 * O idioma em que os AGENTES respondem (RN-618) — eixo separado do idioma da
 * INTERFACE (`lib/idioma.ts`), que continua fechado a `pt-BR`/`en`. A lista
 * aqui é ABERTA: qualquer código BCP-47 que a api reconheça. Quem valida de
 * verdade é a api (`normalizarIdiomaBcp47`); este módulo só nomeia e sugere.
 */
import { IDIOMA_AUTOMATICO } from './api-types';

export { IDIOMA_AUTOMATICO };

/** A queryKey das preferências da conta — a Conta e a barra da sessão a leem. */
export const QUERY_KEY_PREFERENCIAS = ['user-preferences'] as const;

/**
 * Os idiomas oferecidos direto no seletor. É SUGESTÃO de atalho, não a lista
 * aceita: "Outro código…" abre um campo para qualquer BCP-47, e o idioma
 * gravado que não está aqui aparece no seletor mesmo assim.
 */
export const IDIOMAS_SUGERIDOS: readonly string[] = [
  'pt-BR',
  'en',
  'es',
  'fr',
  'de',
  'it',
  'ja',
  'zh-Hans',
];

/** Valor do `<option>` que abre o campo livre — nunca vai para a api. */
export const OPCAO_OUTRO_CODIGO = '__outro__';

/**
 * O nome do idioma no idioma da INTERFACE (`pt-BR` → "português (Brasil)"),
 * com o código entre parênteses quando o nome existe, para que a pessoa veja
 * exatamente o que está gravado. Sem nome conhecido, só o código — nunca um
 * texto inventado.
 */
export function nomeDoIdioma(codigo: string, idiomaDaInterface: string): string {
  try {
    const nome = new Intl.DisplayNames([idiomaDaInterface], {
      type: 'language',
      fallback: 'none',
    }).of(codigo);
    return nome ? `${nome} (${codigo})` : codigo;
  } catch {
    return codigo;
  }
}

/** As opções do seletor: as sugeridas, mais o valor atual se não for uma delas. */
export function opcoesDeIdioma(atual: string | null): string[] {
  const opcoes = [...IDIOMAS_SUGERIDOS];
  if (atual && atual !== IDIOMA_AUTOMATICO && !opcoes.includes(atual)) {
    opcoes.push(atual);
  }
  return opcoes;
}
