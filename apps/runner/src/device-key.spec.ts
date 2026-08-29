import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  lerChaveDeDispositivo,
  lerConfigLocal,
  NOME_ARQUIVO_CHAVE,
  NOME_ARQUIVO_CONFIG,
} from './device-key.ts';

describe('lerConfigLocal', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brabo-runner-device-key-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('caminho feliz: lê projectId e apiUrl do arquivo local', () => {
    writeFileSync(
      join(dir, NOME_ARQUIVO_CONFIG),
      JSON.stringify({ projectId: 'proj-1', apiUrl: 'https://api.brabo.dev' }),
    );

    expect(lerConfigLocal(dir)).toEqual({
      projectId: 'proj-1',
      apiUrl: 'https://api.brabo.dev',
    });
  });

  it('devolve null (não lança) quando o arquivo não existe', () => {
    expect(lerConfigLocal(dir)).toBeNull();
  });

  it('devolve null (não lança) quando o JSON é inválido', () => {
    writeFileSync(join(dir, NOME_ARQUIVO_CONFIG), '{ isto não é json');
    expect(lerConfigLocal(dir)).toBeNull();
  });

  it('devolve null quando falta projectId', () => {
    writeFileSync(join(dir, NOME_ARQUIVO_CONFIG), JSON.stringify({ apiUrl: 'https://x' }));
    expect(lerConfigLocal(dir)).toBeNull();
  });

  it('devolve null quando falta apiUrl', () => {
    writeFileSync(join(dir, NOME_ARQUIVO_CONFIG), JSON.stringify({ projectId: 'proj-1' }));
    expect(lerConfigLocal(dir)).toBeNull();
  });
});

describe('lerChaveDeDispositivo', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brabo-runner-device-key-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('caminho feliz: lê a JWK e usa jwk.kid como deviceKeyId', () => {
    const jwk = { kty: 'OKP', crv: 'Ed25519', x: 'abc', d: 'def', kid: 'device-key-1' };
    writeFileSync(join(dir, NOME_ARQUIVO_CHAVE), JSON.stringify(jwk));

    expect(lerChaveDeDispositivo(dir)).toEqual({
      jwkPrivada: jwk,
      deviceKeyId: 'device-key-1',
    });
  });

  it('devolve null (não lança) quando o arquivo não existe', () => {
    expect(lerChaveDeDispositivo(dir)).toBeNull();
  });

  it('devolve null (não lança) quando o JSON é inválido', () => {
    writeFileSync(join(dir, NOME_ARQUIVO_CHAVE), 'não é json {{{');
    expect(lerChaveDeDispositivo(dir)).toBeNull();
  });

  it('devolve null quando a JWK não tem kid', () => {
    writeFileSync(
      join(dir, NOME_ARQUIVO_CHAVE),
      JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: 'abc', d: 'def' }),
    );
    expect(lerChaveDeDispositivo(dir)).toBeNull();
  });
});

describe('lerConfigLocal / lerChaveDeDispositivo respeitam o cwd recebido, nunca um global', () => {
  it('não lê de uma pasta diferente da passada como parâmetro', () => {
    const outraPasta = mkdtempSync(join(tmpdir(), 'brabo-runner-device-key-outra-'));
    try {
      writeFileSync(
        join(outraPasta, NOME_ARQUIVO_CONFIG),
        JSON.stringify({ projectId: 'proj-x', apiUrl: 'https://x' }),
      );
      const vazia = mkdtempSync(join(tmpdir(), 'brabo-runner-device-key-vazia-'));
      try {
        expect(lerConfigLocal(vazia)).toBeNull();
      } finally {
        rmSync(vazia, { recursive: true, force: true });
      }
    } finally {
      rmSync(outraPasta, { recursive: true, force: true });
    }
  });
});

describe('nenhuma escrita em disco', () => {
  it('device-key.ts não importa writeFileSync/mkdirSync — este módulo só LÊ', () => {
    const caminho = fileURLToPath(new URL('./device-key.ts', import.meta.url));
    const fonte = readFileSync(caminho, 'utf-8');

    expect(fonte).not.toContain('writeFileSync');
    expect(fonte).not.toContain('mkdirSync');
    expect(fonte).not.toContain('appendFileSync');
  });
});
