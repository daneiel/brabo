/**
 * A configuração do broker — cinco variáveis, e a recusa de subir sem as que
 * importam.
 *
 * Mesma disciplina do ADR 0059/RN-093/RN-114 do lado da api: o default de
 * desenvolvimento está PUBLICADO neste repositório, então em produção ele é
 * recusado mesmo quando definido explicitamente. A lição registrada lá é a
 * razão exata da forma daqui — o caminho real de erro não é a variável ausente,
 * é a variável DEFINIDA com o valor de exemplo.
 */

import { timingSafeEqual } from 'node:crypto';

/** Igual ao `PADRAO_DEV` de `apps/api/src/infrastructure/security/service-token.ts`. */
const TOKEN_PADRAO_DEV = 'dev-service-token-change-me';
const TAMANHO_MINIMO_DO_TOKEN = 16;

export const PORTA_PADRAO = 8090;

export interface ConfiguracaoDoBroker {
  porta: number;
  /** O segredo aceito no cabeçalho `x-brabo-service-token`. */
  tokenDeServico: string;
  /** Aceito só na VERIFICAÇÃO, para a rotação não ter janela de recusa. */
  tokenAnterior: string | null;
  /** Onde a api mora, para o broker LER a decisão do Arquiteto dela. */
  apiUrl: string;
  /**
   * A raiz das pastas de projeto **no HOST** — não dentro deste container.
   *
   * É a peça sem a qual `start` não pode existir, e a razão é geométrica: o
   * `-v` de um `docker run` é interpretado pelo DAEMON, que enxerga o
   * filesystem do host. Um caminho de dentro deste container
   * (`/data/project-workspaces/...`) seria criado VAZIO no host e montado
   * vazio no container do projeto — o dev agent abriria uma pasta sem código e
   * ninguém saberia por quê.
   *
   * `null` (não configurada) é estado legítimo: as outras quatro operações
   * funcionam, e só `start` recusa, dizendo qual variável falta. Adivinhar um
   * default aqui seria adivinhar o layout de disco de quem opera.
   */
  raizDeWorkspacesNoHost: string | null;
  /**
   * A SEGUNDA raiz — a base dos projetos MONTADOS **no HOST**
   * (`BRABO_PROJECTS_HOST_BASE`, ADR 0141), e não uma variante da de cima.
   *
   * Duas e não uma porque as duas pastas têm dono e nomeação opostos: a
   * gerenciada é do PRODUTO e nomeada por `workspace_dir_name` (UNIQUE); a
   * base é do USUÁRIO e nomeada por ele. Apontar as duas para o mesmo lugar
   * faria `<base>/loja` e um projeto `container` com `workspace_dir_name =
   * loja` caírem na MESMA pasta física — o `git init` do bootstrap dentro do
   * projeto de outra pessoa, com nada no schema impedindo.
   *
   * Qual das duas resolve um projeto NÃO é decidido aqui e nem é adivinhado:
   * a api manda um localizador discriminado (`localizacao.tipo`, RN-501), e
   * a spec diz contra qual raiz o segmento vale. O broker continua sem
   * receber caminho absoluto nenhum.
   *
   * `null` é o mesmo estado legítimo da de cima, com o mesmo desfecho: só
   * `start` de projeto `mounted` recusa, nomeando a variável.
   */
  baseDeProjetosNoHost: string | null;
}

export class ConfiguracaoInvalidaError extends Error {
  /** Origem no vocabulário do produto (`infra | modelo | codigo | politica`). */
  readonly origem = 'infra';

  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ConfiguracaoInvalidaError';
  }
}

export function lerConfiguracao(
  env: NodeJS.ProcessEnv = process.env,
): ConfiguracaoDoBroker {
  const producao = env.NODE_ENV === 'production';
  const bruto = (env.BRABO_SERVICE_TOKEN ?? '').trim();

  const tokenDeServico = producao
    ? tokenDeProducao(bruto)
    : bruto || TOKEN_PADRAO_DEV;

  const anterior = (env.BRABO_SERVICE_TOKEN_PREVIOUS ?? '').trim();

  const raiz = (env.PROJECT_WORKSPACES_HOST_ROOT ?? '').trim();
  const base = (env.BRABO_PROJECTS_HOST_BASE ?? '').trim();

  return {
    porta: porta(env.BROKER_PORT),
    tokenDeServico,
    tokenAnterior:
      anterior.length > 0 && anterior !== tokenDeServico ? anterior : null,
    apiUrl: (env.API_URL ?? 'http://api:3000').replace(/\/+$/, ''),
    raizDeWorkspacesNoHost: raiz.length > 0 ? raiz : null,
    baseDeProjetosNoHost: base.length > 0 ? base : null,
  };
}

function tokenDeProducao(bruto: string): string {
  if (!bruto) {
    throw new ConfiguracaoInvalidaError(
      'BRABO_SERVICE_TOKEN é obrigatória em produção — é o único mecanismo ' +
        'que separa a api de qualquer outro processo que alcance a porta ' +
        'deste broker, e este broker fala com o Docker do host.',
    );
  }
  if (bruto === TOKEN_PADRAO_DEV) {
    throw new ConfiguracaoInvalidaError(
      'BRABO_SERVICE_TOKEN está com o valor de exemplo do repositório, que é ' +
        'público. Num broker que fala com o Docker do host isso equivale a ' +
        'não ter autenticação nenhuma. Gere um próprio (ex.: ' +
        '`openssl rand -base64 32`).',
    );
  }
  if (bruto.length < TAMANHO_MINIMO_DO_TOKEN) {
    throw new ConfiguracaoInvalidaError(
      `BRABO_SERVICE_TOKEN tem ${bruto.length} caracteres; o mínimo em ` +
        `produção é ${TAMANHO_MINIMO_DO_TOKEN}. É o MESMO piso da api — os ` +
        'dois lados comparam o mesmo segredo.',
    );
  }
  return bruto;
}

function porta(bruto: string | undefined): number {
  if (bruto === undefined || bruto.trim() === '') return PORTA_PADRAO;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new ConfiguracaoInvalidaError(
      `BROKER_PORT inválida: ${JSON.stringify(bruto)}. Esperava um inteiro ` +
        `entre 1 e 65535 (default ${PORTA_PADRAO}).`,
    );
  }
  return n;
}

/**
 * Comparação em tempo constante, como `tokenDeServicoConfere` na api e
 * `secure_compare` no engine. Um `===` vazaria o segredo byte a byte para quem
 * medisse o tempo — e esta é uma porta que aceita tentativa repetida sem custo,
 * que é justamente a condição que torna o ataque prático.
 *
 * Implementada com `timingSafeEqual` sobre buffers de MESMO tamanho: a função
 * do Node lança quando os tamanhos diferem, e o tamanho do apresentado é
 * público de qualquer forma (ele veio de fora).
 */
export function tokenConfere(
  apresentado: string,
  config: ConfiguracaoDoBroker,
  comparar: (a: string, b: string) => boolean = comparaEmTempoConstante,
): boolean {
  if (comparar(apresentado, config.tokenDeServico)) return true;
  return (
    config.tokenAnterior !== null && comparar(apresentado, config.tokenAnterior)
  );
}

function comparaEmTempoConstante(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.byteLength !== bufB.byteLength) {
    // Compara contra si mesmo para gastar o mesmo tempo, e devolve false.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
