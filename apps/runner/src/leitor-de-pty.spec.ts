import { describe, expect, it } from 'vitest';
import * as nodePty from 'node-pty';
import type { NodePtyModule } from './pty.ts';
import {
  comLeitorDePtyProprio,
  LeitorDeFdNaoBloqueante,
  precisaDoLeitorProprio,
} from './leitor-de-pty.ts';
import { ocorrenciasDoMarcador, semSequenciasDeControle } from './auto-teste-pty.ts';

const BUN_NO_MAC = { versaoDoBun: '1.3.11', plataforma: 'darwin' as const };

describe('precisaDoLeitorProprio (AT-342)', () => {
  it('só sob o Bun e fora do Windows', () => {
    expect(precisaDoLeitorProprio(BUN_NO_MAC)).toBe(true);
    expect(precisaDoLeitorProprio({ versaoDoBun: '1.3.11', plataforma: 'linux' })).toBe(true);
    expect(precisaDoLeitorProprio({ versaoDoBun: undefined, plataforma: 'darwin' })).toBe(false);
    expect(precisaDoLeitorProprio({ versaoDoBun: '1.3.11', plataforma: 'win32' })).toBe(false);
  });
});

describe('comLeitorDePtyProprio', () => {
  it('fora do ambiente que precisa, devolve o MESMO módulo, sem embrulho', () => {
    const modulo = nodePty as unknown as NodePtyModule;
    expect(comLeitorDePtyProprio(modulo, { versaoDoBun: undefined, plataforma: 'darwin' })).toBe(modulo);
  });

  it('troca o tty.ReadStream SÓ durante o spawn, e restaura mesmo quando o spawn lança', () => {
    const tty = { ReadStream: 'original' as unknown };
    const vistoNoSpawn: unknown[] = [];
    const falso = {
      spawn: () => {
        vistoNoSpawn.push(tty.ReadStream);
        throw new Error('spawn falhou');
      },
    } as unknown as NodePtyModule;
    const embrulhado = comLeitorDePtyProprio(falso, BUN_NO_MAC, tty);
    expect(() => embrulhado.spawn('/bin/cat', [], {})).toThrow('spawn falhou');
    expect(vistoNoSpawn).toEqual([LeitorDeFdNaoBloqueante]);
    expect(tty.ReadStream).toBe('original');
  });

  // O leitor contra um PTY REAL: o fd do mestre é não-bloqueante e, com uma
  // pausa entre as duas escritas, a segunda leitura passa obrigatoriamente
  // por `EAGAIN` — o ponto exato em que o `tty.ReadStream` do Bun morre.
  // Aqui (Node) o embrulho é FORÇADO a se aplicar, então quem lê é o
  // `LeitorDeFdNaoBloqueante`, não o `tty.ReadStream` do Node.
  it.skipIf(process.platform === 'win32')(
    'lê as duas voltas de um cat real, com EAGAIN entre elas, e fecha no kill',
    async () => {
      const tty = (await import('node:tty')).default as unknown as { ReadStream: unknown };
      const embrulhado = comLeitorDePtyProprio(nodePty as unknown as NodePtyModule, BUN_NO_MAC, tty);
      const processo = embrulhado.spawn('/bin/cat', [], {
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
      });
      expect((processo as unknown as { _socket: unknown })._socket).toBeInstanceOf(
        LeitorDeFdNaoBloqueante,
      );
      let saida = '';
      processo.onData((d) => {
        saida += d;
      });
      const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const ate = async (condicao: () => boolean) => {
        for (let i = 0; i < 100 && !condicao(); i++) await esperar(20);
        return condicao();
      };

      await esperar(200);
      processo.write('PRIMEIRA\n');
      expect(await ate(() => ocorrenciasDoMarcador(saida, 'PRIMEIRA') >= 2)).toBe(true);
      await esperar(300);
      processo.write('SEGUNDA\n');
      expect(await ate(() => ocorrenciasDoMarcador(saida, 'SEGUNDA') >= 2)).toBe(true);

      const saiu = new Promise<void>((r) => processo.onExit(() => r()));
      processo.kill();
      await saiu;
    },
    10_000,
  );
});

describe('ocorrenciasDoMarcador (auto-teste de PTY)', () => {
  it('conta o marcador inteiro, ignorando sequências CSI e OSC do ConPTY', () => {
    const saida =
      '\u001b]0;cmd.exe - echo MARCA\u0007\u001b[?25lC:\\> echo MARCA\u001b[K\r\nMARCA\r\n';
    // O título (OSC) também contém o marcador e NÃO pode contar.
    expect(ocorrenciasDoMarcador(saida, 'MARCA')).toBe(2);
    expect(semSequenciasDeControle('\u001b[31mMA\u001b[0mRCA')).toBe('MARCA');
  });

  it('não conta o marcador pela metade', () => {
    expect(ocorrenciasDoMarcador('MARC\r\nMARCA\r\n', 'MARCA')).toBe(1);
  });
});
