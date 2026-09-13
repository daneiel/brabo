/**
 * QUAIS projetos este agente local atende, e ONDE a pasta de cada um fica
 * (ADR 0154 ponto 3, RN-544) — as duas metades da descoberta do agente de
 * MÁQUINA, separadas de quem conecta, exatamente como `pasta-do-projeto.ts` é
 * separado de `tratarWorkspaceCreate`.
 *
 * ## Ele PERGUNTA, e não varre o disco
 *
 * `GET /runner/projects` (RN-543) devolve os projetos em `execution_mode:
 * 'runner'` nos quais o dono da credencial alcança pelo menos `developer` — o
 * MESMO mínimo de `runner-ticket`. Varrer a base seria adivinhar por nome de
 * pasta: a base é do USUÁRIO e pode ter pasta que não é projeto nenhum, e essa
 * é a classe de erro que o ADR 0141 recusou por escrito ao proibir
 * `PROJECT_WORKSPACES_HOST_DIR` como base.
 *
 * O que viaja é o SEGMENTO (`workspaceDirName`, RN-109), nunca um caminho
 * absoluto: quem tem a raiz é quem executa (ADR 0130/0144), e a raiz aqui é a
 * base LOCAL, consentida no instalador e jamais recebida pela rede.
 *
 * ## Este módulo NÃO sabe de que espécie é a credencial, e isso é decisão
 *
 * Em disco, uma chave de máquina e uma chave de projeto são o MESMO arquivo:
 * uma JWK privada com um `kid` dentro (RN-475). Quem sabe a espécie é o
 * SERVIDOR, que acha a pública por esse `kid` e lê `project_id`. Então este
 * runner não tenta adivinhar: ele pergunta, e uma credencial de PROJETO é
 * recusada com 403 e mensagem PRÓPRIA pelo `PatAuthGuard` — que este módulo
 * transforma em `CredencialNaoEDeMaquinaError`, nomeando o arquivo, em vez de
 * deixar virar um "falha na conexão" genérico. Inventar um palpite local
 * produziria duas fontes de verdade sobre a mesma coisa, e a local seria a
 * errada.
 *
 * ## `planejarConexoes` não cria nada, e reusa as guardas que já existem
 *
 * A pasta de cada projeto é `<base>/<workspaceDirName>`, resolvida por
 * `resolverPastaDoProjetoNaBase` (`base-guard.ts`) — a MESMA guarda que
 * `workspace_create` usa para o segmento que vem do engine, pelo mesmo motivo:
 * o nome veio pela rede. Sobre ela roda `validarDirDentroDoHomeNoLinux`
 * (RN-434), reusada inteira. Nenhuma quarta cópia de régua nasce aqui, e
 * nenhum `mkdir` acontece aqui — quem cria é o chamador, com
 * `garantirDiretorio`, que é a RN-435 aplicada a um caminho DERIVADO em vez de
 * digitado.
 *
 * Um projeto cuja pasta é recusada NÃO derruba os outros: ele sai do plano
 * NOMEADO, com o motivo, e a lista de recusados volta junto com a de alvos.
 * Colapsar as duas faria "não havia projeto" e "todos foram recusados" darem a
 * mesma saída, que é o vazio disfarçado que este repositório não aceita.
 */

import {
  assinarDescobertaComChaveDeDispositivo,
  tentarLerErro,
  type CredencialDeAutenticacao,
} from './auth.ts';
import { resolverPastaDoProjetoNaBase, SegmentoDeProjetoInvalidoError } from './base-guard.ts';
import { DirForaDoHomeError, validarDirDentroDoHomeNoLinux } from './guard.ts';

/**
 * Uma linha de `GET /runner/projects`. Campos exatamente como a api os manda
 * (`RunnerProjectResponseDto`) — `workspaceVerifiedAt` é ISO-8601 ou `null`.
 */
export interface ProjetoDoRunner {
  projectId: string;
  name: string;
  workspaceDirName: string;
  /**
   * Quando a pasta foi CONFIRMADA por um runner, ou `null`. É registro de uma
   * confirmação, nunca batimento (RN-468): usá-lo como "está de pé" seria a
   * tela de login afirmando o que não sabe, do lado do CLI.
   */
  workspaceVerifiedAt: string | null;
}

/**
 * A credencial apresentada está presa a um PROJETO — 403 da rota de
 * descoberta. Erro PRÓPRIO porque o conserto é próprio: quem tem chave de
 * projeto usa `--project`, e quem quer o agente de máquina precisa de uma
 * chave de máquina (que hoje só o `install.sh` registra, ADR 0155 ponto 4).
 */
export class CredencialNaoEDeMaquinaError extends Error {
  constructor(detalhe: string) {
    super(
      `a api recusou a descoberta de projetos: esta credencial está presa a um ` +
        `PROJETO ${detalhe}. O agente de MÁQUINA exige uma chave de dispositivo ` +
        `de máquina (ADR 0154). Para rodar com esta credencial, passe ` +
        `--project <projectId> (ou use a pasta que a tela do projeto configurou).`,
    );
    this.name = 'CredencialNaoEDeMaquinaError';
  }
}

/**
 * `GET /runner/projects` — a única rota do produto autenticada por credencial
 * de dispositivo SEM `:projectId` no caminho. Chamada UMA vez, no start (ver
 * `index.ts` para por que a lista não é repesquisada).
 *
 * `fetchImpl` é injetável só para teste — default: o `fetch` global.
 */
export async function listarProjetosDoRunner(
  apiUrl: string,
  credencial: CredencialDeAutenticacao,
  fetchImpl: typeof fetch = fetch,
): Promise<ProjetoDoRunner[]> {
  const bearer =
    credencial.tipo === 'token'
      ? credencial.token
      : await assinarDescobertaComChaveDeDispositivo(
          credencial.jwkPrivada,
          credencial.deviceKeyId,
        );

  const resposta = await fetchImpl(`${apiUrl}/runner/projects`, {
    headers: { authorization: `Bearer ${bearer}` },
  });

  if (resposta.status === 403) {
    throw new CredencialNaoEDeMaquinaError(await tentarLerErro(resposta));
  }
  if (!resposta.ok) {
    throw new Error(
      `não consegui listar os projetos deste agente: HTTP ${resposta.status} ` +
        `${await tentarLerErro(resposta)}`,
    );
  }

  const corpo = (await resposta.json()) as unknown;
  if (!Array.isArray(corpo)) {
    throw new Error(
      'resposta de GET /runner/projects fora do contrato esperado (uma lista) — ' +
        'confira se a api mudou o formato.',
    );
  }
  return corpo.map(validarLinha);
}

function validarLinha(bruto: unknown, indice: number): ProjetoDoRunner {
  const linha = bruto as Partial<ProjetoDoRunner> | null;
  if (
    typeof linha !== 'object' ||
    linha === null ||
    typeof linha.projectId !== 'string' ||
    linha.projectId.length === 0 ||
    typeof linha.name !== 'string' ||
    typeof linha.workspaceDirName !== 'string' ||
    linha.workspaceDirName.length === 0
  ) {
    throw new Error(
      `resposta de GET /runner/projects fora do contrato esperado: a linha ` +
        `${indice} não tem projectId/name/workspaceDirName — confira se a api ` +
        `mudou o formato.`,
    );
  }
  return {
    projectId: linha.projectId,
    name: linha.name,
    workspaceDirName: linha.workspaceDirName,
    workspaceVerifiedAt:
      typeof linha.workspaceVerifiedAt === 'string' ? linha.workspaceVerifiedAt : null,
  };
}

/** Um projeto que este agente VAI atender, com a pasta já resolvida. */
export interface AlvoDeConexao {
  projeto: ProjetoDoRunner;
  /** `<base>/<workspaceDirName>`, absoluto e já aprovado pelas guardas. */
  dir: string;
}

/** Um projeto que este agente NÃO vai atender, e por quê. */
export interface ProjetoRecusado {
  projeto: ProjetoDoRunner;
  motivo: string;
}

export interface PlanoDeConexoes {
  alvos: AlvoDeConexao[];
  recusados: ProjetoRecusado[];
}

export interface OpcoesDoPlano {
  plataforma: NodeJS.Platform;
  home: string;
}

/**
 * De N projetos listados para N pastas. Nada é criado aqui (ver o docblock do
 * módulo), e nenhum projeto recusado derruba os outros.
 */
export function planejarConexoes(
  base: string,
  projetos: readonly ProjetoDoRunner[],
  opcoes: OpcoesDoPlano,
): PlanoDeConexoes {
  const alvos: AlvoDeConexao[] = [];
  const recusados: ProjetoRecusado[] = [];

  for (const projeto of projetos) {
    try {
      const dir = resolverPastaDoProjetoNaBase(base, projeto.workspaceDirName);
      // Redundante por construção (a base já foi validada dentro do `$HOME`, e
      // toda subpasta dela herda isso) — e rodada assim mesmo, porque o que
      // torna a redundância verdadeira é um symlink NÃO existir no meio, e
      // `validarDirDentroDoHomeNoLinux` é barata. RN-434 reusada inteira.
      validarDirDentroDoHomeNoLinux(dir, opcoes.plataforma, opcoes.home);
      alvos.push({ projeto, dir });
    } catch (erro) {
      if (erro instanceof SegmentoDeProjetoInvalidoError || erro instanceof DirForaDoHomeError) {
        recusados.push({ projeto, motivo: erro.message });
        continue;
      }
      throw erro;
    }
  }

  return { alvos, recusados };
}
