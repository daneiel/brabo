/**
 * PORTA de `Engine.Harness.ToolCallRecovery.from_content/2`
 * (`apps/engine/lib/engine/harness/tool_call_recovery.ex`) para o teste ao vivo
 * da AT-239: o engine não roda neste instrumento, e a pergunta "quantos passos
 * passaram pela recuperação" só se responde aplicando a MESMA regra à resposta
 * do modelo. `recuperacao.spec.ts` traz os casos do `tool_call_recovery_test.exs`
 * e guarda os trechos-âncora do `.ex` — divergiu a regra lá, reprova aqui.
 *
 * A regra: cada objeto JSON de nível superior do texto (contando chaves, com
 * string e escape respeitados), decodificado, cujo `name` é uma ferramenta
 * REGISTRADA no laço e cujos argumentos (`arguments`, ou `parameters` como
 * sinônimo) são um objeto. Só é consultada quando `toolCalls` veio vazio.
 */
export interface ChamadaRecuperada {
  name: string;
  arguments: Record<string, unknown>;
  id: null;
}

/** `candidatos/1`: os objetos de nível superior, na ordem. Fora de objeto, tudo é descartado. */
export function candidatos(texto: string): string[] {
  const acc: string[] = [];
  let atual = '';
  let prof = 0;
  let emString = false;
  let escape = false;
  for (const c of texto) {
    if (emString) {
      atual += c;
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') emString = false;
      continue;
    }
    if (c === '"' && prof > 0) {
      atual += c;
      emString = true;
    } else if (c === '{') {
      atual += c;
      prof += 1;
    } else if (c === '}' && prof === 1) {
      acc.push(atual + c);
      atual = '';
      prof = 0;
    } else if (c === '}' && prof > 1) {
      atual += c;
      prof -= 1;
    } else if (prof > 0) {
      atual += c;
    } else {
      atual = '';
    }
  }
  return acc;
}

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function recuperar(
  conteudo: string | null | undefined,
  nomes: readonly string[],
): ChamadaRecuperada[] {
  if (typeof conteudo !== 'string') return [];
  const saida: ChamadaRecuperada[] = [];
  for (const json of candidatos(conteudo)) {
    let mapa: unknown;
    try {
      mapa = JSON.parse(json);
    } catch {
      continue;
    }
    if (!ehObjeto(mapa) || typeof mapa.name !== 'string') continue;
    const args = ehObjeto(mapa.arguments)
      ? mapa.arguments
      : ehObjeto(mapa.parameters)
        ? mapa.parameters
        : null;
    if (args === null || !nomes.includes(mapa.name)) continue;
    saida.push({ name: mapa.name, arguments: args, id: null });
  }
  return saida;
}
