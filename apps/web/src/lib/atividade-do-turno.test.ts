import { describe, expect, it } from 'vitest';
import {
  ESTADO_INICIAL_DA_ATIVIDADE,
  reduzirAtividadeDoTurno,
  type EstadoDaAtividadeDoTurno,
} from './atividade-do-turno';

function reduzirTudo(
  acoes: Parameters<typeof reduzirAtividadeDoTurno>[1][],
): EstadoDaAtividadeDoTurno {
  return acoes.reduce(reduzirAtividadeDoTurno, ESTADO_INICIAL_DA_ATIVIDADE);
}

describe('reduzirAtividadeDoTurno', () => {
  it('delta → tool.call → delta → reset: acumula, arquiva ao chamar ferramenta, acumula de novo, reseta', () => {
    let estado = ESTADO_INICIAL_DA_ATIVIDADE;

    estado = reduzirAtividadeDoTurno(estado, { tipo: 'delta', texto: 'Vou ' });
    estado = reduzirAtividadeDoTurno(estado, { tipo: 'delta', texto: 'escrever uma história.' });
    expect(estado).toEqual({ linhas: [], corrente: 'Vou escrever uma história.' });

    estado = reduzirAtividadeDoTurno(estado, {
      tipo: 'tool_call',
      frase: 'Escrevendo uma história',
    });
    expect(estado).toEqual({
      linhas: [
        { tipo: 'narracao', texto: 'Vou escrever uma história.' },
        { tipo: 'ferramenta', texto: 'Escrevendo uma história' },
      ],
      corrente: '',
    });

    estado = reduzirAtividadeDoTurno(estado, { tipo: 'delta', texto: 'Pronto, feito.' });
    expect(estado.corrente).toBe('Pronto, feito.');
    expect(estado.linhas).toHaveLength(2);

    estado = reduzirAtividadeDoTurno(estado, { tipo: 'reset' });
    expect(estado).toEqual(ESTADO_INICIAL_DA_ATIVIDADE);
  });

  it('tool.call → tool.call sem delta entre elas: DUAS linhas de ferramenta, nenhuma narração vazia', () => {
    const estado = reduzirTudo([
      { tipo: 'tool_call', frase: 'Lendo o backlog' },
      { tipo: 'tool_call', frase: 'Criando a tarefa' },
    ]);

    expect(estado.linhas).toEqual([
      { tipo: 'ferramenta', texto: 'Lendo o backlog' },
      { tipo: 'ferramenta', texto: 'Criando a tarefa' },
    ]);
    expect(estado.corrente).toBe('');
  });

  it('turno inteiro sem chamada de ferramenta nenhuma: nunca produz linha arquivada', () => {
    const estado = reduzirTudo([
      { tipo: 'delta', texto: 'Só ' },
      { tipo: 'delta', texto: 'texto, ' },
      { tipo: 'delta', texto: 'sem ferramenta.' },
    ]);

    expect(estado.linhas).toEqual([]);
    expect(estado.corrente).toBe('Só texto, sem ferramenta.');

    const resetado = reduzirAtividadeDoTurno(estado, { tipo: 'reset' });
    expect(resetado).toEqual(ESTADO_INICIAL_DA_ATIVIDADE);
    expect(resetado.linhas).toEqual([]);
  });

  it('reset a partir do estado inicial é idempotente', () => {
    expect(reduzirAtividadeDoTurno(ESTADO_INICIAL_DA_ATIVIDADE, { tipo: 'reset' })).toEqual(
      ESTADO_INICIAL_DA_ATIVIDADE,
    );
  });
});
