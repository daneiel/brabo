import { describe, expect, it } from 'vitest';
import { executarComando } from './exec.ts';

describe('executarComando', () => {
  it('devolve stdout e exit code de um comando simples', async () => {
    const resultado = await executarComando(
      'echo -n "ola brabo" && exit 0',
      process.cwd(),
      { shell: '/bin/sh' },
    );

    expect(resultado.exitCode).toBe(0);
    expect(resultado.output).toBe('ola brabo');
    expect(resultado.timedOut).toBe(false);
  });

  it('devolve exit code não-zero de um comando que falha', async () => {
    const resultado = await executarComando('exit 7', process.cwd(), {
      shell: '/bin/sh',
    });

    expect(resultado.exitCode).toBe(7);
    expect(resultado.timedOut).toBe(false);
  });

  it('mata o comando que estoura o timeout e marca timedOut', async () => {
    const resultado = await executarComando('sleep 5', process.cwd(), {
      shell: '/bin/sh',
      timeoutMs: 200,
    });

    expect(resultado.timedOut).toBe(true);
    expect(resultado.exitCode).toBe(-1);
  }, 10_000);

  it('trunca saída maior que o teto de bytes, com marca clara', async () => {
    // Exatamente 50000 bytes de 'a' — head -c/tr dão contagem exata e
    // previsível, ao contrário de `yes` (que emite 'a\n' e depende de onde o
    // pipe corta a linha).
    const resultado = await executarComando(
      "head -c 50000 /dev/zero | tr '\\0' 'a'",
      process.cwd(),
      { shell: '/bin/sh', maxBytes: 100 },
    );

    expect(resultado.timedOut).toBe(false);
    expect(resultado.output.startsWith('a'.repeat(100))).toBe(true);
    expect(resultado.output).toContain('[saída truncada:');
    expect(resultado.output).toContain('100 de 50000 bytes');
  });

  it('combina stdout e stderr na mesma saída', async () => {
    const resultado = await executarComando(
      'echo out && echo err 1>&2',
      process.cwd(),
      { shell: '/bin/sh' },
    );

    expect(resultado.output).toContain('out');
    expect(resultado.output).toContain('err');
  });
});
