import { expect, type Page } from '@playwright/test';
import { USUARIO } from './api.ts';

/**
 * Entrar pela tela de login, do jeito que um humano entra.
 *
 * A espera do meio não é paranoia — é uma corrida real, que apareceu ao
 * rodar de verdade: o roteador NORMALIZA `/login` para
 * `/login?oauthError=false` logo depois do mount (`validateSearch` do
 * `loginRoute`), e essa navegação remonta a `LoginPage`. Como e-mail e senha
 * são `useState` da própria página, um preenchimento que chegue ANTES da
 * normalização é descartado, e o submit sai com os dois campos vazios: a
 * tela fica no login e o teste falha acusando o login, que não é onde o
 * defeito está.
 *
 * Por isso a ordem: esperar a URL assentar, preencher, CONFERIR que o valor
 * ficou, e só então enviar. A conferência é o que transforma a corrida em
 * falha honesta caso o comportamento do roteador mude de novo.
 */
export async function entrar(page: Page): Promise<void> {
  await page.goto('/login');

  // A URL assentada é a normalizada. Esperar por ela é esperar o roteador
  // terminar — mais estreito, e muito mais estável, que um `networkidle`.
  await page.waitForURL(/\/login\?/, { timeout: 30_000 });

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
