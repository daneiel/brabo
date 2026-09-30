import { describe, expect, it } from 'vitest';
import { dividirFio, FIO_RECENTES_ABERTAS, type EntradaDoFio } from './session-fio';

/**
 * RN-644 — o corte do fio conta MENSAGENS, nunca parte um turno e devolve o
 * histórico em ordem cronológica, declarando o que contém.
 */

function msg(key: string, turno: number): EntradaDoFio {
  return { key, node: null, origem: 'usuario', turno, mensagem: true };
}

function card(key: string, turno: number): EntradaDoFio {
  return { key, node: null, origem: 'agente', turno, mensagem: false };
}

const chaves = (itens: EntradaDoFio[]) => itens.map((e) => e.key);

describe('dividirFio (RN-644)', () => {
  it('cards não contam no corte: 5 mensagens entre muitos cards não recolhem nada', () => {
    const fio = [
      msg('q1', 1),
      msg('r1', 1),
      card('handoff', 1),
      card('aprovacao-1', 1),
      card('aprovacao-2', 1),
      msg('q2', 4),
      msg('r2', 4),
      card('historia', 4),
      msg('q3', 8),
    ];

    const { historico, recentes } = dividirFio(fio);

    expect(historico).toBeNull();
    expect(chaves(recentes)).toEqual(chaves(fio));
  });

  it('o corte recua até a abertura do turno: a pergunta nunca fica longe da resposta', () => {
    const fio = [
      msg('q1', 1),
      msg('r1', 1),
      card('handoff', 1),
      msg('q2', 4),
      msg('r2', 4),
      msg('q3', 6),
      msg('r3', 6),
      msg('q4', 8),
      msg('r4', 8),
    ];

    const { historico, recentes } = dividirFio(fio);

    // As 5 últimas mensagens começam em r2; o corte recua até q2.
    expect(chaves(recentes)).toEqual(['q2', 'r2', 'q3', 'r3', 'q4', 'r4']);
    expect(chaves(historico!.itens)).toEqual(['q1', 'r1', 'handoff']);
    expect(historico!.mensagens).toBe(2);
    expect(historico!.outras).toBe(1);
  });

  it('o histórico sai na ordem do fio, nunca reagrupado por origem', () => {
    const fio: EntradaDoFio[] = [
      { key: 'q1', node: null, origem: 'usuario', turno: 1, mensagem: true },
      { key: 'r1', node: null, origem: 'llm', turno: 1, mensagem: true },
      { key: 'q2', node: null, origem: 'usuario', turno: 3, mensagem: true },
      { key: 'r2', node: null, origem: 'llm', turno: 3, mensagem: true },
      ...Array.from({ length: FIO_RECENTES_ABERTAS }, (_, i) => msg(`p${i}`, 0)),
    ];
    // Prólogo depois das trocas não existe na vida real, mas isola a regra:
    // turno 0 não recua, então o corte cai exatamente nas 5 do fim.

    const { historico } = dividirFio(fio);

    expect(chaves(historico!.itens)).toEqual(['q1', 'r1', 'q2', 'r2']);
  });

  it('CASO DE FALHA evitado: turno único maior que o corte não gera histórico vazio', () => {
    // Uma pergunta e seis respostas no mesmo turno: recuar até a abertura
    // chega ao início, e o histórico seria um bloco vazio — não aparece.
    const fio = [msg('q1', 1), ...Array.from({ length: 6 }, (_, i) => msg(`r${i}`, 1))];

    const { historico, recentes } = dividirFio(fio);

    expect(historico).toBeNull();
    expect(recentes).toHaveLength(7);
  });

  it('prólogo (turno 0) não recua: sem abertura, o corte é exato', () => {
    const fio = Array.from({ length: 7 }, (_, i) => msg(`f${i}`, 0));

    const { historico, recentes } = dividirFio(fio);

    expect(chaves(historico!.itens)).toEqual(['f0', 'f1']);
    expect(recentes).toHaveLength(FIO_RECENTES_ABERTAS);
  });
});
