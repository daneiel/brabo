import Keycloak from 'keycloak-js';
import { runtimeConfig } from './runtime-config';

/**
 * Client público (brabo-web) — authorization code + PKCE, mesmo padrão
 * de qualquer SPA contra este realm (ver docker/keycloak/realm.json).
 * `onLoad: 'login-required'` gate a aplicação inteira antes do render
 * (ver main.tsx) — não há rota pública nesta app além do redirect de
 * callback do git OAuth, que é tratado inteiramente pela api (302 direto
 * pro browser, nunca passa por aqui).
 */
export const keycloak = new Keycloak({
  url: runtimeConfig.keycloakUrl,
  realm: runtimeConfig.keycloakRealm,
  clientId: runtimeConfig.keycloakClientId,
});

let initPromise: Promise<boolean> | null = null;

export function initKeycloak(): Promise<boolean> {
  if (!initPromise) {
    initPromise = keycloak.init({
      onLoad: 'login-required',
      pkceMethod: 'S256',
      checkLoginIframe: false,
    });
  }
  return initPromise;
}

export async function getToken(): Promise<string> {
  try {
    await keycloak.updateToken(30);
  } catch {
    await keycloak.login();
  }
  if (!keycloak.token) throw new Error('Sem token de autenticação');
  return keycloak.token;
}

export function currentUser() {
  const p = keycloak.tokenParsed;
  return {
    id: p?.sub as string,
    name: (p?.name ?? p?.preferred_username) as string | undefined,
    email: p?.email as string | undefined,
  };
}

export function logout() {
  return keycloak.logout({ redirectUri: window.location.origin });
}
