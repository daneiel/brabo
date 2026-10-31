/**
 * Os primeiros passos de um projeto novo (RN-708, AT-372).
 *
 * Três passos, e cada um é DERIVADO de uma leitura que já existe — nenhuma
 * rota nova:
 *
 * - `credencial`: a conta tem ao menos uma credencial de LLM
 *   (`GET /users/me/credentials`, a MESMA chave `['credentials']` da seção);
 * - `modelo`: o time tem modelo — o binding resolvido do Criativo, do LOTE da
 *   RN-654 (a mesma `queryKey` de Configurações), não é nulo;
 * - `ideacao`: o projeto tem ao menos uma sessão de trabalho.
 *
 * `undefined` em qualquer insumo é "não sei" (RN-470): o cartão não aparece
 * enquanto houver um "não sei" — afirmar "falta credencial" sem ter lido seria
 * a tela mentindo.
 */
export type ChaveDoPasso = 'credencial' | 'modelo' | 'ideacao';

export interface Passo {
  chave: ChaveDoPasso;
  feito: boolean;
}

export interface InsumosDosPrimeirosPassos {
  /** Quantas credenciais a conta tem; `undefined` = não lido. */
  credenciais: number | undefined;
  /** O time tem modelo resolvido; `undefined` = não lido. */
  timeComModelo: boolean | undefined;
  /** O projeto tem sessão de trabalho; `undefined` = não lido. */
  temSessao: boolean | undefined;
}

/**
 * Os passos, na ordem em que fazem sentido — ou `null` quando o cartão não
 * deve aparecer: algum insumo ainda não lido, ou todos feitos.
 */
export function derivarPrimeirosPassos(insumos: InsumosDosPrimeirosPassos): Passo[] | null {
  const { credenciais, timeComModelo, temSessao } = insumos;
  if (credenciais === undefined || timeComModelo === undefined || temSessao === undefined) {
    return null;
  }
  const passos: Passo[] = [
    { chave: 'credencial', feito: credenciais > 0 },
    { chave: 'modelo', feito: timeComModelo },
    { chave: 'ideacao', feito: temSessao },
  ];
  return passos.every((p) => p.feito) ? null : passos;
}
