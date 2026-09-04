import { expect, test } from '@playwright/test';
import { entrar } from '../suporte/navegador.ts';

/**
 * O caminho de autenticação num navegador de verdade, em ORIGEM CRUZADA:
 * a web em `:8088`, a api em `:3000`.
 *
 * Cada asserção aqui existe por um mecanismo que jsdom não tem:
 *
 * - o preflight CORS (o `main.ts` da api registra "teste não faz preflight");
 * - `httpOnly`, que é uma garantia do BROWSER — em jsdom o refresh seria
 *   legível e o teste passaria mentindo;
 * - `SameSite`, que só significa alguma coisa entre origens distintas;
 * - a sobrevivência ao reload, que é o único jeito de provar que o access
 *   em memória foi RECONSTRUÍDO a partir do cookie, e não que ele nunca
 *   tinha sumido.
 *
 * Os seletores são estruturais (`input[type=email]`), nunca por texto: o
 * idioma da interface é decidido pelo SERVIDOR, e um teste preso a "Sign in"
 * quebraria ao mudar o idioma da conta semeada — falha que não fala sobre o
 * produto.
 */

// O ÚNICO arquivo que descarta o estado guardado: provar que o login
// funciona exige chegar sem sessão nenhuma. Todo o resto reusa o estado do
// `setup`, e o motivo está em `suporte/entrar.setup.ts` — não é economia de
// tempo, é o lockout por IP do próprio produto.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('autenticação no navegador', () => {
  test('sem sessão, a raiz manda para o login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  /**
   * Login, cookies e reload num teste SÓ, de propósito: são a mesma jornada,
   * e cada `entrar()` a mais gasta o balde de lockout por IP — que não zera
   * no sucesso. Separar em dois custaria um login por execução para provar
   * exatamente o mesmo.
   */
  test('login cruza a origem, o refresh fica fora do JS, e a sessão sobrevive ao reload', async ({
    page,
    context,
  }) => {
    await entrar(page);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    const cookies = await context.cookies();
    const refresh = cookies.find((c) => c.name === 'brabo_refresh');
    const csrf = cookies.find((c) => c.name === 'brabo_csrf');

    expect(refresh, 'brabo_refresh não foi emitido').toBeDefined();
    expect(csrf, 'brabo_csrf não foi emitido').toBeDefined();

    // O PAR é o desenho (session-cookies.ts): um trancado, um legível.
    expect(refresh?.httpOnly, 'o refresh precisa ser httpOnly').toBe(true);
    expect(csrf?.httpOnly, 'o csrf precisa ser legível pelo JS').toBe(false);

    // E "legível pelo JS" tem que ser verdade no browser, não só no atributo.
    const doDocumento = await page.evaluate(() => document.cookie);
    expect(doDocumento).toContain('brabo_csrf=');
    expect(doDocumento, 'o refresh vazou para document.cookie').not.toContain('brabo_refresh=');

    // O access token vive em MEMÓRIA e morre aqui. Se o refresh em cookie
    // httpOnly não voltar pela origem cruzada — `credentials: 'include'`
    // mais o preflight mais `SameSite` —, o reload cai no login.
    await page.reload();

    await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });
});
