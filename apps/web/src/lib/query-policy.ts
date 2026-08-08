import { ApiError } from './api-client';

/**
 * Política de repetição das queries — quando insistir e quando parar.
 *
 * Origem: uma tela de projeto com **1128 erros 429 no console**. A api limita
 * 300 requisições por minuto por usuário (`RateLimitGuard`), a app tem ~25
 * queries com `refetchInterval` de 3 a 5 segundos, e nada nesse conjunto sabia
 * ler um "pare" do servidor: o TanStack retentava três vezes cada falha e o
 * poll seguia batendo na mesma porta a cada 3s. O resultado é um laço que se
 * alimenta — o limite estoura, a app responde com MAIS tráfego, e o limite
 * nunca tem chance de se refazer dentro da janela deslizante.
 */

/** O default do TanStack Query, mantido para o que É retentável. */
export const TENTATIVAS_MAX = 3;

/**
 * 4xx não se retenta; 5xx e falha de rede sim.
 *
 * Um 4xx é uma afirmação do servidor sobre a REQUISIÇÃO — repeti-la sem mudar
 * nada só reproduz a mesma resposta. Três casos onde isso importa nesta app:
 *
 * - **429**: é literalmente o servidor pedindo para parar. Retentar é a única
 *   reação que piora o problema, e piora para todas as outras queries junto,
 *   porque o balde é por usuário;
 * - **401**: `request()` já renova a sessão e repete UMA vez por dentro
 *   (ver `api-client.ts`). Se o token novo também levou 401, o problema não é
 *   validade de token — e cada retentativa daqui era mais uma renovação
 *   apresentada ao servidor;
 * - **403/404**: papel RBAC e recurso inexistente não mudam em 4 segundos.
 *
 * 5xx e erro de rede continuam com as três tentativas: ali repetir é a reação
 * certa, porque a causa costuma ser transitória (deploy, reinício de pod, wifi
 * caindo).
 */
export function deveRetentar(falhas: number, erro: unknown): boolean {
  if (erro instanceof ApiError && erro.status >= 400 && erro.status < 500) {
    return false;
  }
  return falhas < TENTATIVAS_MAX;
}

/**
 * O formato mínimo que o `refetchInterval` recebe. Estrutural de propósito:
 * `Query<TData, TError, ...>` é genérico em quatro parâmetros e tipar o
 * callback pelo tipo nominal obrigaria cada chamador a repetir os genéricos.
 */
interface QueryComEstado {
  state: { status: 'pending' | 'error' | 'success' };
}

/**
 * Poll que PARA quando a query erra, em vez de insistir para sempre.
 *
 * `refetchInterval: 3000` é incondicional: erre o que errar, a query volta em
 * 3 segundos. Com a api limitando, era isso que transformava um 429 em mil —
 * e, do lado de quem olha, num console que rola sozinho sem nunca dizer o que
 * houve.
 *
 * Parar não é desistir. A query continua sendo refeita no foco da janela
 * (`refetchOnWindowFocus`, default), na remontagem da tela e no botão
 * "Tentar de novo" que `ErroDeCarregamento` oferece — três gatilhos com uma
 * pessoa por trás, que é exatamente quem deve decidir insistir. E basta um
 * sucesso para `status` voltar a `success` e o poll retomar sozinho.
 */
export function pollQueParaNoErro(
  intervaloMs: number,
): (query: QueryComEstado) => number | false {
  return (query) => (query.state.status === 'error' ? false : intervaloMs);
}
