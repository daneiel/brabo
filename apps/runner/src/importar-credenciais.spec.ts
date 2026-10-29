import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { importarCredenciais, type DepsDaImportacao } from './importar-credenciais.ts';
import type { Resultado } from './credenciais-locais.ts';

const SEGREDO = 'sk-ant-SEGREDO-DA-FIXTURE-9876';
const jwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
const resultado: Resultado = {
  candidatos: [
    {
      ferramenta: 'claude-code',
      origem: 'ANTHROPIC_API_KEY',
      provider: 'anthropic',
      tipo: 'chave-de-api',
      valor: SEGREDO,
      final: '…9876',
    },
    {
      ferramenta: 'codex',
      origem: '~/.codex/auth.json',
      provider: 'openai',
      tipo: 'assinatura',
      final: '',
    },
  ],
  problemas: [{ ferramenta: 'hermes', origem: '/x/.env', motivo: 'arquivo ilegível' }],
};

function montar(respostas: string[], status: number[], extra: Partial<DepsDaImportacao> = {}) {
  const saida: string[] = [];
  const corpos: Record<string, unknown>[] = [];
  const perguntar = vi.fn(async () => respostas.shift() ?? 'n');
  const achar = vi.fn(() => resultado);
  const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
    corpos.push(JSON.parse(String(init?.body)));
    const s = status.shift() ?? 200;
    return new Response(JSON.stringify({ message: 'msg da api' }), { status: s });
  }) as unknown as typeof fetch;
  const deps: DepsDaImportacao = {
    stdinTTY: true,
    stdoutTTY: true,
    apiUrl: 'http://api',
    chave: { jwkPrivada: jwk, deviceKeyId: 'k1' },
    achar,
    perguntar,
    saida: (l) => saida.push(l),
    fetchImpl,
    ...extra,
  };
  return { deps, saida, corpos, perguntar, achar, fetchImpl };
}

describe('credentials import', () => {
  it('sem TTY sai ≠0 sem ler nada', async () => {
    const m = montar([], [], { stdinTTY: false });
    expect(await importarCredenciais(m.deps)).toBe(2);
    expect(m.achar).not.toHaveBeenCalled();
  });

  it('lista, grava o escolhido, não oferece assinatura e nunca imprime o segredo', async () => {
    const m = montar(['s'], [200]);
    expect(await importarCredenciais(m.deps)).toBe(0);
    const txt = m.saida.join('\n');
    expect(txt).toContain('login por assinatura, não importável');
    expect(txt).toContain('gravada.');
    expect(txt).toContain('arquivo ilegível');
    expect(txt).toContain('TITULAR');
    expect(m.perguntar).toHaveBeenCalledTimes(1);
    expect(m.corpos[0]).toEqual({
      provider: 'anthropic',
      apiKey: SEGREDO,
      origem: 'ANTHROPIC_API_KEY',
    });
    expect(txt).not.toContain(SEGREDO);
  });

  it('responder não não chama a api', async () => {
    const m = montar(['n'], []);
    await importarCredenciais(m.deps);
    expect(m.fetchImpl).not.toHaveBeenCalled();
  });

  it('409 pergunta e reenvia com substituir: true', async () => {
    const m = montar(['s', 's'], [409, 200]);
    expect(await importarCredenciais(m.deps)).toBe(0);
    expect(m.corpos[1]).toMatchObject({ substituir: true });
    expect(m.saida.join('\n')).toContain('substituída.');
  });

  it('nenhum segredo na saída em 409 (mantida e substituída) nem em erro de rede', async () => {
    const mantida = montar(['s', 'n'], [409]);
    await importarCredenciais(mantida.deps);
    const subst = montar(['s', 's'], [409, 200]);
    await importarCredenciais(subst.deps);
    const rede = montar(['s'], [], {
      fetchImpl: (async () => {
        throw new Error(`falha com ${SEGREDO}`);
      }) as unknown as typeof fetch,
    });
    expect(await importarCredenciais(rede.deps)).toBe(1);
    const tudo = [...mantida.saida, ...subst.saida, ...rede.saida].join('\n');
    expect(tudo).toContain('mantida a existente.');
    expect(tudo).toContain('erro de rede');
    expect(tudo).not.toContain(SEGREDO);
  });

  it('403 explica a regra da chave de máquina e sai 1, sem vazar o segredo', async () => {
    const m = montar(['s'], [403]);
    expect(await importarCredenciais(m.deps)).toBe(1);
    const txt = m.saida.join('\n');
    expect(txt).toContain('chave de MÁQUINA');
    expect(txt).not.toContain(SEGREDO);
  });
});
