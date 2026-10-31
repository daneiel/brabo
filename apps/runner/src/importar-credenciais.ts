/**
 * AT-611 (L3): `brabo-runner credentials import` — acha as chaves de API de LLM
 * que as outras ferramentas da máquina já guardam (`credenciais-locais.ts`) e,
 * item a item, com a confirmação da pessoa, as grava na api por
 * `POST /runner/llm-credentials` (RN-927). Tudo é INJETADO (TTY, leitor,
 * pergunta, saída, fetch), então o teste roda com fixture e HTTP falsos.
 * O VALOR da chave só existe no corpo do POST: nunca vai a saída nem a erro.
 */
import { assinarDescobertaComChaveDeDispositivo, tentarLerErro } from './auth.ts';
import type { Candidato, Resultado } from './credenciais-locais.ts';

export interface DepsDaImportacao {
  stdinTTY: boolean;
  stdoutTTY: boolean;
  apiUrl: string;
  chave: { jwkPrivada: object; deviceKeyId: string } | null;
  achar: () => Resultado;
  perguntar: (texto: string) => Promise<string>;
  saida: (linha: string) => void;
  fetchImpl?: typeof fetch;
}

const AVISO_ASSINATURA =
  'login por assinatura, não importável — crie uma chave de API no console do fornecedor';
const sim = (r: string) => /^(s|sim|y|yes)$/i.test(r.trim());

async function enviar(
  d: DepsDaImportacao,
  chave: NonNullable<DepsDaImportacao['chave']>,
  c: Candidato,
  substituir: boolean,
) {
  const bearer = await assinarDescobertaComChaveDeDispositivo(chave.jwkPrivada, chave.deviceKeyId);
  const corpo: Record<string, unknown> = {
    provider: c.provider,
    apiKey: c.valor,
    origem: c.origem,
  };
  if (substituir) corpo.substituir = true;
  return (d.fetchImpl ?? fetch)(`${d.apiUrl}/runner/llm-credentials`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
}

/** Devolve o código de saída. */
export async function importarCredenciais(d: DepsDaImportacao): Promise<number> {
  if (!d.stdinTTY || !d.stdoutTTY) {
    d.saida('credentials import é interativo: rode num terminal (nada foi lido).');
    return 2;
  }
  const chave = d.chave;
  if (!chave) {
    d.saida(
      'sem chave de dispositivo de MÁQUINA nesta pasta (brabo-runner device-key create/finish); ' +
        'um token de projeto (PAT) é recusado com 403 por esta rota.',
    );
    return 2;
  }
  const { candidatos, problemas } = d.achar();
  for (const p of problemas) d.saida(`problema: ${p.ferramenta} — ${p.origem}: ${p.motivo}`);
  if (candidatos.length === 0) {
    d.saida('nenhuma credencial local encontrada.');
    return 0;
  }
  let falhas = 0;
  for (const c of candidatos) {
    const alvo = c.provider ?? 'sem provider no Brabo';
    if (c.tipo === 'assinatura') {
      d.saida(`- ${c.ferramenta} (${c.origem}) [${alvo}]: ${AVISO_ASSINATURA}`);
      continue;
    }
    d.saida(`- ${c.ferramenta} (${c.origem}) [${alvo}] chave de API ${c.final}`);
    if (!c.provider) {
      d.saida('  ignorada: sem provider no Brabo.');
      continue;
    }
    if (!sim(await d.perguntar('  importar? [s/N] '))) {
      d.saida('  mantida fora.');
      continue;
    }
    try {
      let r = await enviar(d, chave, c, false);
      let substituida = false;
      if (r.status === 409) {
        if (!sim(await d.perguntar('  já existe uma chave desse provider. substituir? [s/N] '))) {
          d.saida('  mantida a existente.');
          continue;
        }
        r = await enviar(d, chave, c, true);
        substituida = true;
      }
      if (r.ok) d.saida(substituida ? '  substituída.' : '  gravada.');
      else {
        falhas++;
        const msg = await tentarLerErro(r);
        d.saida(
          r.status === 403
            ? `  erro 403: esta rota só aceita chave de MÁQUINA (não PAT nem chave de projeto): ${msg}`
            : `  erro ${r.status}: ${msg}`,
        );
      }
    } catch (e) {
      falhas++;
      d.saida(`  erro de rede: ${e instanceof Error ? e.name : 'falha'}`);
    }
  }
  d.saida(
    'A credencial gravada é da CONTA de quem roda este comando; os agentes gastam a do ' +
      'TITULAR do workspace (RN-058) — se você não for o titular, o gasto dos agentes não muda.',
  );
  return falhas > 0 ? 1 : 0;
}
