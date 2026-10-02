import { expect, type Page } from '@playwright/test';
import { USUARIO } from './api.ts';

/**
 * Entrar pela tela de login, do jeito que um humano entra.
 *
 * Até a AT-374 o roteador NORMALIZAVA `/login` para `/login?oauthError=false`
 * logo depois do mount (`validateSearch` do `loginRoute`), e essa navegação
 * remontava a `LoginPage` — um preenchimento anterior a ela era descartado.
 * Desde a AT-374 o `validateSearch` devolve `undefined` e a URL fica em
 * `/login` (ou `/login?proxima=…`): não há mais reescrita. A espera aceita as
 * duas formas, e a ordem continua: esperar a URL assentar, preencher,
 * CONFERIR que o valor ficou, e só então enviar — a conferência é o que
 * transforma uma corrida que volte em falha honesta, em vez de um "login não
 * funcionou" enganoso.
 */
export async function entrar(page: Page): Promise<void> {
  await page.goto('/login');

  // Esperar a rota do login assentar (com ou sem query) — mais estreito, e
  // muito mais estável, que um `networkidle`.
  await page.waitForURL(/\/login(\?|$)/, { timeout: 30_000 });

  const email = page.locator('input[type="email"]');
  const senha = page.locator('input[type="password"]');

  await expect(senha).toBeVisible();
  await email.fill(USUARIO.email);
  await senha.fill(USUARIO.senha);

  // Se um remount ainda assim limpar os campos, é AQUI que o teste cai — com
  // a mensagem certa, em vez de virar um "login não funcionou" enganoso.
  await expect(email).toHaveValue(USUARIO.email);
  await expect(senha).toHaveValue(USUARIO.senha);

  await page.locator('button[type="submit"]').click();

  // `irPara('/')` do `LoginPage` só roda com `r.ok`.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}
