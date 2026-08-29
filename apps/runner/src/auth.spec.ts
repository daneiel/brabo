import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, jwtVerify } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assinarTicketComChaveDeDispositivo,
  obterTicketDoRunner,
  obterTicketDoRunnerComCredencial,
  obterToken,
  TokenInvalidoError,
  validarFormatoDoToken,
} from './auth.ts';

const TOKEN_VALIDO = 'brb_' + 'a'.repeat(32);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('validarFormatoDoToken', () => {
  it('aceita um token brb_... bem formado', () => {
    expect(() => validarFormatoDoToken(TOKEN_VALIDO)).not.toThrow();
  });

  it('recusa token sem o prefixo brb_', () => {
    expect(() => validarFormatoDoToken('outro_prefixo_1234567890')).toThrow(
      TokenInvalidoError,
    );
  });

  it('recusa token curto demais mesmo com o prefixo certo', () => {
    expect(() => validarFormatoDoToken('brb_curto')).toThrow(TokenInvalidoError);
  });

  it('a mensagem ensina onde gerar um token', () => {
    try {
      validarFormatoDoToken('invalido');
      throw new Error('deveria ter lançado');
    } catch (erro) {
      expect(erro).toBeInstanceOf(TokenInvalidoError);
      expect((erro as Error).message).toContain('Configurações do projeto');
    }
  });
});

describe('obterToken', () => {
  it('--token vence BRABO_ACCOUNT_TOKEN quando os dois existem', () => {
    vi.stubEnv('BRABO_ACCOUNT_TOKEN', 'brb_' + 'b'.repeat(32));
    expect(obterToken(TOKEN_VALIDO)).toBe(TOKEN_VALIDO);
  });

  it('cai pro env quando a flag --token está ausente', () => {
    vi.stubEnv('BRABO_ACCOUNT_TOKEN', TOKEN_VALIDO);
    expect(obterToken(undefined)).toBe(TOKEN_VALIDO);
  });

  it('valida o formato do token vindo do env, não só o da flag', () => {
    vi.stubEnv('BRABO_ACCOUNT_TOKEN', 'formato-errado');
    expect(() => obterToken(undefined)).toThrow(TokenInvalidoError);
  });

  it('lança IMEDIATAMENTE quando nem flag nem env existem — nunca bloqueia em prompt', () => {
    vi.stubEnv('BRABO_ACCOUNT_TOKEN', '');
    delete process.env.BRABO_ACCOUNT_TOKEN;
    expect(() => obterToken(undefined)).toThrow(/nenhum token informado/);
  });
});

describe('obterTicketDoRunner', () => {
  it('caminho feliz: parseia {ticket, engineWsUrl}', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ticket: 'tk-1', engineWsUrl: 'ws://engine/socket' }),
      }),
    );

    await expect(
      obterTicketDoRunner('http://api', 'proj-1', TOKEN_VALIDO),
    ).resolves.toEqual({ ticket: 'tk-1', engineWsUrl: 'ws://engine/socket' });
  });

  it('manda o token exatamente como recebido, sem prefixo extra nem strip', async () => {
    const espiao = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ticket: 'tk-1', engineWsUrl: 'ws://engine/socket' }),
    });
    vi.stubGlobal('fetch', espiao);

    await obterTicketDoRunner('http://api', 'proj-1', TOKEN_VALIDO);

    const [, opcoes] = espiao.mock.calls[0] as [string, RequestInit];
    expect((opcoes.headers as Record<string, string>).authorization).toBe(
      `Bearer ${TOKEN_VALIDO}`,
    );
  });

  it('propaga a mensagem de erro do corpo quando a resposta não é 2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'token revogado' }),
      }),
    );

    await expect(
      obterTicketDoRunner('http://api', 'proj-1', TOKEN_VALIDO),
    ).rejects.toThrow(/HTTP 401.*token revogado/);
  });

  it('lança quando o corpo foge do contrato esperado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ticket: 'tk-1' /* engineWsUrl ausente */ }),
      }),
    );

    await expect(
      obterTicketDoRunner('http://api', 'proj-1', TOKEN_VALIDO),
    ).rejects.toThrow(/fora do contrato esperado/);
  });
});

describe('assinarTicketComChaveDeDispositivo', () => {
  it('caminho feliz: gera um JWT EdDSA verificável, com kid no header e projectId no payload', async () => {
    const { privateKey, publicKey } = await generateKeyPair('EdDSA', {
      crv: 'Ed25519',
      extractable: true,
    });
    const jwkPrivada = await exportJWK(privateKey);

    const jwt = await assinarTicketComChaveDeDispositivo(jwkPrivada, 'device-1', 'proj-1');

    const { payload, protectedHeader } = await jwtVerify(jwt, publicKey);
    expect(protectedHeader.alg).toBe('EdDSA');
    expect(protectedHeader.kid).toBe('device-1');
    expect(payload.projectId).toBe('proj-1');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    // TTL curto de propósito (RN-108) — 30s, não um valor grande.
    expect((payload.exp as number) - (payload.iat as number)).toBe(30);
  });

  it('lança quando a JWK privada está corrompida/incompleta', async () => {
    await expect(
      assinarTicketComChaveDeDispositivo({ kty: 'OKP' }, 'device-1', 'proj-1'),
    ).rejects.toThrow();
  });
});

describe('obterTicketDoRunnerComCredencial', () => {
  it('credencial tipo "token": manda o PAT direto, sem assinar nada', async () => {
    const espiao = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ticket: 'tk-1', engineWsUrl: 'ws://engine/socket' }),
    });
    vi.stubGlobal('fetch', espiao);

    await obterTicketDoRunnerComCredencial('http://api', 'proj-1', {
      tipo: 'token',
      token: TOKEN_VALIDO,
    });

    const [, opcoes] = espiao.mock.calls[0] as [string, RequestInit];
    expect((opcoes.headers as Record<string, string>).authorization).toBe(
      `Bearer ${TOKEN_VALIDO}`,
    );
  });

  it('credencial tipo "chave-de-dispositivo": assina um JWT fresco e manda como Bearer', async () => {
    const { privateKey, publicKey } = await generateKeyPair('EdDSA', {
      crv: 'Ed25519',
      extractable: true,
    });
    const jwkPrivada = await exportJWK(privateKey);
    const espiao = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ticket: 'tk-1', engineWsUrl: 'ws://engine/socket' }),
    });
    vi.stubGlobal('fetch', espiao);

    await obterTicketDoRunnerComCredencial('http://api', 'proj-1', {
      tipo: 'chave-de-dispositivo',
      jwkPrivada,
      deviceKeyId: 'device-1',
    });

    const [, opcoes] = espiao.mock.calls[0] as [string, RequestInit];
    const authorization = (opcoes.headers as Record<string, string>).authorization;
    expect(authorization).toBeDefined();
    const bearer = authorization!.replace('Bearer ', '');
    const { payload, protectedHeader } = await jwtVerify(bearer, publicKey);
    expect(protectedHeader.kid).toBe('device-1');
    expect(payload.projectId).toBe('proj-1');
  });
});

describe('nenhum I/O de arquivo', () => {
  it('auth.ts não importa node:fs nem node:readline — guarda contra reintroduzir persistência do PAT em disco', () => {
    // `vi.spyOn` em `node:fs` não funciona (namespace ESM não é
    // reconfigurável) — a garantia mais forte e mais direta é o próprio
    // módulo nunca referenciar as APIs de arquivo/prompt que o fluxo antigo
    // de login+cookie usava.
    const caminho = fileURLToPath(new URL('./auth.ts', import.meta.url));
    const fonte = readFileSync(caminho, 'utf-8');

    expect(fonte).not.toContain("from 'node:fs'");
    expect(fonte).not.toContain("from 'node:readline'");
    expect(fonte).not.toContain('writeFileSync');
    expect(fonte).not.toContain('readFileSync');
  });
});
