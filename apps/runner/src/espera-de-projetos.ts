/**
 * O agente de MÁQUINA com ZERO conexões ESPERA, e reconsulta
 * `GET /runner/projects` até o primeiro projeto aparecer (RN-550, ADR 0155
 * ponto 5).
 *
 * ## A assimetria é o desenho, e ela NÃO desfaz a decisão da RN-544
 *
 * ```
 * conexões > 0  →  a lista é consultada SÓ no start  (byte a byte a RN-544)
 * conexões = 0  →  reconsulta, com a cadência abaixo
 * ```
 *
 * A [RN-544](../../../docs/business-rules.md#rn-544) recusou repesquisa
 * periódica por um argumento que continua inteiro: uma lista que volta MENOR é
 * AMBÍGUA — projeto apagado, convertido de modo, papel revogado, ou um 500
 * transitório se disfarçando dos três —, e derrubar uma conexão VIVA por causa
 * dessa ambiguidade trocaria um estado certo por um palpite.
 *
 * Com ZERO conexões não há nada a derrubar, e não há ambiguidade nenhuma:
 * qualquer projeto que apareça é ganho puro, e nenhuma decisão é tomada sobre
 * o que sumiu. Por isso a reconsulta PARA no instante em que a primeira lista
 * não-vazia chega — daí em diante o comportamento é o de hoje, e este módulo
 * não é chamado de novo enquanto o processo viver.
 *
 * ## Por que ficar de pé passou a ser o certo
 *
 * A RN-544 saiu com 0 e argumentou que "ficar de pé com zero conexões seria um
 * serviço 'ativo' que não faz nada, e o `status` da unit passaria a mentir". O
 * argumento dependia da premissa de que o processo não faria nada — e é
 * exatamente essa premissa que este módulo remove: ele reconsulta, com
 * cadência declarada, e diz que está fazendo isso. `active (running)` passa a
 * ser verdade, e é a saída com 0 que passaria a mentir, porque ela deixa a
 * instalação nova (ADR 0155) sem agente justamente no minuto em que a pessoa
 * vai criar o primeiro projeto na web.
 *
 * ## O que este módulo NÃO faz
 *
 * Não conecta, não cria pasta e não decide política de saída: ele devolve um
 * desfecho NOMEADO e quem chama decide (`index.ts`), exatamente como
 * `projetos.ts` é separado de quem conecta. E não repete a régua de erro da
 * rota: `CredencialNaoEDeMaquinaError` sobe intacta, porque uma credencial que
 * a api recusa por ESPÉCIE não passa a valer por esperar mais um minuto.
 */

import { CredencialNaoEDeMaquinaError, type ProjetoDoRunner } from './projetos.ts';

/**
 * A cadência da reconsulta, em milissegundos: escalona e ESTABILIZA — nunca
 * cresce sem fim.
 *
 * Os dois primeiros degraus são curtos porque o caso que esta espera existe
 * para atender é o de alguém que acabou de instalar e está criando o primeiro
 * projeto AGORA (ADR 0155): um teto de minutos faria o agente aparecer depois
 * de a pessoa desistir de esperar. O platô de 60s é o preço em regime: UMA
 * requisição por minuto, de uma instalação, contra uma rota que devolve a
 * lista de projetos do próprio dono da credencial. Deixar o platô crescer
 * (300s, 600s) economizaria tráfego que ninguém está pagando e pioraria a
 * única coisa que esta espera entrega.
 */
export const CADENCIA_DA_ESPERA_MS: readonly number[] = [15_000, 30_000, 60_000];

/**
 * Falhas SEGUIDAS da reconsulta antes de desistir. Deliberadamente o mesmo
 * número de `TETO_DE_TENTATIVAS_SEGUIDAS` (`index.ts`) e pelo mesmo motivo —
 * não martelar a api para sempre quando o problema não é transitório —, e
 * deliberadamente uma constante SEPARADA: aquele teto conta falhas de
 * CONECTAR (ticket + engine) e este conta falhas de LISTAR (uma rota HTTP da
 * api). São sujeitos diferentes, e amarrá-los faria uma mudança de cadência de
 * conexão mexer, sem que ninguém pedisse, no tempo que uma instalação nova
 * espera antes de desistir.
 *
 * Zerado a cada consulta que responde — inclusive quando ela responde VAZIO,
 * que é sucesso: a lista vazia é a resposta certa de uma instalação nova.
 */
export const TETO_DE_FALHAS_DE_CONSULTA = 10;

/**
 * De quantas em quantas consultas SEM projeto o processo diz que continua
 * esperando. Com o platô de 60s dá uma linha a cada meia hora.
 *
 * Nem toda consulta vira linha de propósito: um log por minuto, para sempre,
 * é ruído que enterra as linhas que importam no `journalctl`. Nenhuma linha
 * também não serve — ficar de pé em silêncio é o que faz "esperando" e
 * "travado" parecerem a mesma coisa para quem está olhando. O batimento é o
 * meio-termo, e ele DIZ quantas consultas já houve, que é o que distingue os
 * dois estados sem precisar de outra fonte.
 */
export const CONSULTAS_POR_BATIMENTO = 30;

/** O intervalo antes da n-ésima consulta (1-based). */
export function esperaDaConsulta(consulta: number): number {
  const ultimo = CADENCIA_DA_ESPERA_MS[CADENCIA_DA_ESPERA_MS.length - 1] as number;
  return CADENCIA_DA_ESPERA_MS[consulta - 1] ?? ultimo;
}

export type DesfechoDaEspera =
  /** Apareceu projeto: a lista NÃO-VAZIA daquele instante. */
  | { tipo: 'projetos'; projetos: ProjetoDoRunner[] }
  /** SIGINT/SIGTERM durante a espera — quem encerra é o handler de sinal. */
  | { tipo: 'parado' }
  /** `TETO_DE_FALHAS_DE_CONSULTA` esgotado — já relatado, linha a linha. */
  | { tipo: 'desistiu'; mensagem: string };

export interface DependenciasDaEspera {
  /** `GET /runner/projects` — injetada para o teste não subir rede. */
  listar: () => Promise<ProjetoDoRunner[]>;
  /** O `sleep` do processo — injetado pelo mesmo motivo. */
  esperar: (ms: number) => Promise<void>;
  /** SIGINT/SIGTERM já chegou. */
  deveParar: () => boolean;
  log: (linha: string) => void;
  erro: (linha: string) => void;
}

function mensagemDeErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * Espera até a rota listar ALGUM projeto. Chamada só quando a consulta do
 * start voltou VAZIA, e só no modo de máquina.
 *
 * A primeira coisa que ela faz é ESPERAR, nunca consultar: quem a chama acabou
 * de consultar, e uma segunda chamada imediata seria duas requisições no mesmo
 * instante dizendo a mesma coisa.
 */
export async function esperarPrimeiroProjeto(
  deps: DependenciasDaEspera,
): Promise<DesfechoDaEspera> {
  let consultas = 0;
  let falhasSeguidas = 0;

  while (!deps.deveParar()) {
    await deps.esperar(esperaDaConsulta(consultas + 1));
    if (deps.deveParar()) break;
    consultas++;

    let projetos: ProjetoDoRunner[];
    try {
      projetos = await deps.listar();
    } catch (erro) {
      // Recusa por ESPÉCIE de credencial não é transitória e não vira teto:
      // ela sobe para quem chamou, que a trata como o start já a trata. Uma
      // chave de projeto não vira chave de máquina por esperar.
      if (erro instanceof CredencialNaoEDeMaquinaError) throw erro;

      falhasSeguidas++;
      deps.erro(
        `falha ao reconsultar a lista de projetos (${falhasSeguidas}/${TETO_DE_FALHAS_DE_CONSULTA}): ` +
          mensagemDeErro(erro),
      );
      if (falhasSeguidas >= TETO_DE_FALHAS_DE_CONSULTA) {
        return {
          tipo: 'desistiu',
          mensagem:
            `${TETO_DE_FALHAS_DE_CONSULTA} consultas seguidas sem resposta útil — desistindo de ` +
            'esperar o primeiro projeto. Suba o agente de novo quando a api estiver de pé ' +
            '(`brabo-runner service status --machine` diz se o serviço está instalado).',
        };
      }
      continue;
    }

    falhasSeguidas = 0;
    if (projetos.length > 0) {
      deps.log(
        `apareceu(ram) ${projetos.length} projeto(s) na consulta ${consultas} — a espera ACABA ` +
          'aqui, e a lista volta a ser consultada só no start (RN-544).',
      );
      return { tipo: 'projetos', projetos };
    }

    if (consultas % CONSULTAS_POR_BATIMENTO === 0) {
      deps.log(
        `ainda nenhum projeto em modo "runner" — ${consultas} consultas até agora, seguindo ` +
          'de pé. Criar o projeto na web basta; ninguém precisa voltar ao terminal.',
      );
    }
  }

  return { tipo: 'parado' };
}
