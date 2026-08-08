import { describe, it, expect, afterEach } from 'vitest';
import { resolveOauthStateSecret } from '../../../src/infrastructure/security/oauth-state-secret';
import {
  signOauthState,
  verifyOauthState,
} from '../../../src/domain/git/oauth-state';

/**
 * Chave HMAC do `state` do OAuth de git (ADR 0059).
 *
 * Vale para estes testes a mesma observação do `cors-origins.spec.ts`: o caso
 * que interessa não é o feliz, é o de subir produção sem configurar. A
 * diferença é que aqui o default não era só permissivo — era PÚBLICO, está no
 * `.env.example` de um repositório open source, e o `state` que ele assina é o
 * que impede o callback do OAuth de ser forjado.
 *
 * Por isso o teste central não é "falha quando a variável falta": é "falha
 * quando a variável está DEFINIDA com o valor de exemplo". Esse era o caminho
 * real — o `docker-compose.prod.yml` supria o literal como fallback, então uma
 * verificação de "não vazia" teria passado por cima do defeito.
 */
describe('resolveOauthStateSecret', () => {
  // Guardado e restaurado em vez de apagado: `NODE_ENV` é global do processo, e
  // apagá-lo vaza para os outros arquivos que rodam no mesmo worker.
  const nodeEnvOriginal = process.env.NODE_ENV;

  afterEach(() => {
    delete process.env.GIT_OAUTH_STATE_SECRET;
    if (nodeEnvOriginal === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnvOriginal;
  });

  it('caminho feliz: em produção, devolve a chave configurada', () => {
    process.env.NODE_ENV = 'production';
    process.env.GIT_OAUTH_STATE_SECRET = 'kZ8Q2mLp4vX9tR6wB1nS3jH7dF0aG5cY';
    expect(resolveOauthStateSecret()).toBe(
      'kZ8Q2mLp4vX9tR6wB1nS3jH7dF0aG5cY',
    );
  });

  it('em produção, a chave de EXEMPLO do repositório derruba o boot', () => {
    // O caso que motiva o ADR: a variável definida, com o literal público.
    process.env.NODE_ENV = 'production';
    process.env.GIT_OAUTH_STATE_SECRET = 'dev-oauth-state-secret-change-me';
    expect(() => resolveOauthStateSecret()).toThrow(/valor de exemplo/i);
  });

  it('em produção, sem a variável, derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    expect(() => resolveOauthStateSecret()).toThrow(/obrigatória em produção/i);
  });

  it('em produção, chave curta derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    process.env.GIT_OAUTH_STATE_SECRET = 'senha123';
    expect(() => resolveOauthStateSecret()).toThrow(/mínimo em produção/i);
  });

  it('em produção, espaço em volta não conta como chave', () => {
    // `GIT_OAUTH_STATE_SECRET=" "` num `.env` é erro de digitação, não chave.
    process.env.NODE_ENV = 'production';
    process.env.GIT_OAUTH_STATE_SECRET = '   ';
    expect(() => resolveOauthStateSecret()).toThrow(/obrigatória em produção/i);
  });

  it('fora de produção, sem a variável, cai no default de desenvolvimento', () => {
    // `docker compose up` sem `.env` tem que continuar funcionando.
    process.env.NODE_ENV = 'development';
    expect(resolveOauthStateSecret()).toBe('dev-oauth-state-secret-change-me');
  });

  it('fora de produção, chave curta é aceita', () => {
    // O piso é regra de PRODUÇÃO. Em dev, quem escolheu um valor curto escolheu.
    process.env.NODE_ENV = 'development';
    process.env.GIT_OAUTH_STATE_SECRET = 'curta';
    expect(resolveOauthStateSecret()).toBe('curta');
  });

  it('as duas pontas do fluxo assinam e verificam com a MESMA chave', () => {
    // O que este teste protege é a razão de a resolução ter virado função
    // única: antes o literal estava duplicado em `start-git-oauth` e em
    // `handle-git-oauth-callback`, e duas cópias divergem — divergindo, o
    // callback recusaria todo `state` legítimo.
    process.env.NODE_ENV = 'production';
    process.env.GIT_OAUTH_STATE_SECRET = 'kZ8Q2mLp4vX9tR6wB1nS3jH7dF0aG5cY';

    const state = signOauthState(
      { projectId: 'p1', userId: 'u1', provider: 'github' },
      resolveOauthStateSecret(),
    );

    expect(
      verifyOauthState(state, resolveOauthStateSecret(), 'github').projectId,
    ).toBe('p1');
  });
});
