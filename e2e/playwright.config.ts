import { defineConfig, devices } from '@playwright/test';

/**
 * E2E de NAVEGADOR — a camada que faltava na pirâmide.
 *
 * O que só existe aqui, e por quê:
 *
 * - **Cookie httpOnly + CSRF + CORS.** O access token vive em memória, o
 *   refresh num cookie httpOnly que o JS não enxerga, e o par dele é o
 *   `brabo_csrf`, legível, que vai no cabeçalho `X-CSRF-Token`. Nada disso
 *   é exercitável com jsdom: não há origem de verdade, não há preflight,
 *   não há `SameSite`. O `main.ts` da api registra isso em comentário
 *   ("teste não faz preflight") — este pacote é a resposta.
 * - **O ticket do socket (RN-108).** O canal `session:<id>` do Phoenix
 *   exige ticket opaco de uso único; provar que ele é buscado, aceito e
 *   que o handshake sobe exige um WebSocket real.
 *
 * O que ele NÃO é: uma segunda suite funcional. `apps/web` já testa
 * componente a componente e `docker/smoke.sh` já prova que as imagens de
 * produção sobem e conversam por HTTP. Aqui a pergunta é a terceira:
 * "um navegador de verdade, em outra origem, consegue entrar e ficar
 * dentro?".
 *
 * Roda contra o compose de PRODUÇÃO (`docker/smoke.sh` com
 * `SMOKE_KEEP_UP=1`), não contra o `vite dev`: as origens cruzadas
 * (`:8088` → `:3000`) só existem lá, e é exatamente delas que os últimos
 * bugs de cookie/CORS/socket vieram.
 */

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:8088';

export default defineConfig({
  testDir: './testes',
  // Sem paralelismo entre arquivos: os specs compartilham o MESMO usuário
  // semeado e o mesmo banco. Isolar por workspace/projeto por teste custaria
  // mais do que a lentidão de dois arquivos em série.
  fullyParallel: false,
  workers: 1,
  // `forbidOnly` no CI: um `.only` esquecido faz a suite passar verde tendo
  // rodado um teste só — o modo de falha exato que esta camada existe para
  // não ter.
  forbidOnly: Boolean(process.env.CI),
  // Uma nova tentativa no CI, nenhuma local. E2E contra stack real tem
  // flake de origem externa (container ainda subindo, socket lento); zero
  // retry transformaria isso em ruído que ensina a ignorar o vermelho.
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: WEB,
    // Rastro só do que falhou, e só na retentativa: um trace por teste
    // encheria o artefato do CI com o caminho feliz.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    // Entra uma vez e guarda o estado. Existe por causa do lockout por IP do
    // próprio produto — ver o comentário longo em `suporte/entrar.setup.ts`.
    {
      name: 'setup',
      testDir: './suporte',
      testMatch: /entrar\.setup\.ts/,
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'suporte/.estado-autenticado.json',
      },
    },
  ],
});
