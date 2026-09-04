/**
 * De onde vem o que o broker precisa saber sobre um projeto — e é a peça que
 * torna este serviço NÃO-ARBITRÁRIO.
 *
 * O broker não recebe especificação de container. Ele recebe um `projectId` e
 * uma das cinco operações, e vai BUSCAR na api o contexto do projeto: o nome
 * da pasta congelado na criação (RN-109), o modo de execução, e a decisão de
 * imagem do Arquiteto que estiver vigente. Imagem, rede, recursos e o único
 * mount são COMPUTADOS a partir disso, nunca recebidos — não existe campo em
 * que alguém escreva `privileged`, `cap_add`, `network: host` ou um `-v` livre,
 * porque não existe campo.
 *
 * O sentido da chamada é o que faz a diferença: se o payload viesse pronto do
 * chamador, a contenção inteira dependeria de o chamador estar correto, e este
 * processo é root-equivalente no host. Uma chamada a mais é o preço de a
 * contenção não depender de ninguém.
 *
 * O que volta daqui é DADO NÃO CONFIÁVEL, mesmo vindo da api: quem o
 * transforma em especificação é `especificacaoValidada`, que faz o PARSE para
 * o tipo fechado. Ver o docblock daquele módulo sobre por que a validação da
 * api (que é sobre o ARTEFATO) não dispensa esta (que é sobre o que vai para o
 * daemon).
 */

import type { ConfiguracaoDoBroker } from './config.ts';

/** O cabeçalho que a api e o engine já usam nos dois sentidos. */
export const CABECALHO_SERVICE_TOKEN = 'x-brabo-service-token';

/** Teto da chamada à api. Curto: é uma leitura, e ela está do lado. */
const TIMEOUT_MS = 10_000;

export interface DecisaoDeImagemDaApi {
  image: string;
  network: string;
  resources: { cpus: number; memoryMb: number; pidsLimit: number };
}

export interface ContextoDoProjeto {
  projectId: string;
  projectSlug: string;
  workspaceId: string;
  workspaceDirName: string;
  executionMode: string;
  /** `null` enquanto o Arquiteto não decidiu (RN-105). */
  imagem: DecisaoDeImagemDaApi | null;
  /** Versão do artefato vigente — 0 quando não há decisão. */
  imagemVersao: number;
}

/**
 * A api não respondeu, ou respondeu o que não dá para usar. Origem `infra`:
 * esta classe é lançada só quando o TRANSPORTE falhou ou o status não foi 2xx —
 * nunca por conteúdo, que é problema de `especificacaoValidada`.
 */
export class ApiIndisponivelError extends Error {
  readonly origem = 'infra';
  readonly status: number | null;

  constructor(url: string, detalhe: string, status: number | null = null) {
    super(
      `não consegui ler o contexto do projeto na api (${url}): ${detalhe}. ` +
        'Nenhum container foi tocado.',
    );
    this.name = 'ApiIndisponivelError';
    this.status = status;
  }
}

/** O projeto não existe. Separado de `ApiIndisponivelError` porque o conserto é outro. */
export class ProjetoDesconhecidoError extends Error {
  readonly origem = 'politica';
  readonly projectId: string;

  constructor(projectId: string) {
    super(`a api não conhece o projeto ${projectId}.`);
    this.name = 'ProjetoDesconhecidoError';
    this.projectId = projectId;
  }
}

/**
 * O contrato que o servidor consome. Existe como tipo (e não só como classe)
 * porque o teste substitui isto por uma função — nenhum teste deste pacote
 * fala com uma api de verdade.
 */
export type BuscarContexto = (projectId: string) => Promise<ContextoDoProjeto>;

/**
 * `projectId` vira SEGMENTO DE URL sem DTO nem framework no meio — mesma
 * armadilha que a RN-128 nomeou do lado da api, mesma largura de aceitação.
 */
const SEGMENTO_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

export class IdDeProjetoInvalidoError extends Error {
  readonly origem = 'politica';

  constructor(valor: string) {
    super(
      `projectId inválido: ${JSON.stringify(valor)}. Só aceito letras, ` +
        'dígitos, `-` e `_`, de 1 a 64 caracteres.',
    );
    this.name = 'IdDeProjetoInvalidoError';
  }
}

export function garantirIdDeProjeto(valor: string): string {
  if (!SEGMENTO_VALIDO.test(valor)) throw new IdDeProjetoInvalidoError(valor);
  return valor;
}

export function criarBuscadorDeContexto(
  config: ConfiguracaoDoBroker,
  buscar: typeof fetch = fetch,
): BuscarContexto {
  return async (projectId: string): Promise<ContextoDoProjeto> => {
    const id = garantirIdDeProjeto(projectId);
    const url = `${config.apiUrl}/internal/projects/${id}/container-spec`;

    let resposta: Response;
    try {
      resposta = await buscar(url, {
        method: 'GET',
        headers: {
          [CABECALHO_SERVICE_TOKEN]: config.tokenDeServico,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (erro) {
      throw new ApiIndisponivelError(url, descrever(erro));
    }

    if (resposta.status === 404) throw new ProjetoDesconhecidoError(id);
    if (!resposta.ok) {
      throw new ApiIndisponivelError(
        url,
        `respondeu ${resposta.status}`,
        resposta.status,
      );
    }

    try {
      return (await resposta.json()) as ContextoDoProjeto;
    } catch (erro) {
      throw new ApiIndisponivelError(url, `corpo ilegível: ${descrever(erro)}`);
    }
  };
}

function descrever(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  return String(erro);
}
