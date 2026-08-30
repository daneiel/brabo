import { test as setup } from '@playwright/test';
import { entrar } from './navegador.ts';

/**
 * Entra UMA vez por execução e guarda o estado, que os specs seguintes
 * reusam. Não é otimização de tempo — é uma restrição REAL do produto.
 *
 * O login tem lockout progressivo por e-mail e por IP
 * (`AUTH_LOCKOUT_IP_THRESHOLDS`, default `20:30,30:120`, janela de 15
 * minutos). O balde de IP não zera no sucesso: ele drena por tempo, de
 * propósito — zerá-lo no sucesso deixaria quem tem uma conta válida
 * pulverizar palpites em outras contas entre dois logins seus.
 *
 * Consequência para esta camada: um spec que entra pelo formulário a cada
 * teste gasta o balde, e a punição chega como **401 uniforme** — o mesmo
 * corpo de senha errada, porque revelar o lockout seria um sinal de
 * enumeração. Ou seja: a suite passaria a falhar acusando o login,
 * exatamente onde o defeito NÃO está. Foi o que aconteceu ao rodar de
 * verdade, várias vezes seguidas.
 *
 * Então o formulário é exercitado uma vez aqui e uma vez em
 * `autenticacao.spec.ts` (que precisa da origem limpa para provar o que
 * prova). O resto reusa o estado, e o único cookie que sobrevive ao
 * arquivo é o refresh httpOnly — o access é reconstruído no primeiro
 * carregamento, que é o mesmo caminho do reload.
 */

const ESTADO = 'suporte/.estado-autenticado.json';

setup('entrar uma vez e guardar o estado', async ({ page }) => {
  await entrar(page);
  await page.context().storageState({ path: ESTADO });
});
