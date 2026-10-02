import { describe, expect, it } from 'vitest';
import type { SessionEvent } from './api-types';
import { ecosDeRespostaEstruturada } from './eco-de-formulario';

function ev(seq: number, type: string, actorKind: string, payload: unknown): SessionEvent {
  return {
    id: `e${seq}`,
    sessionId: 's',
    seq,
    type,
    actor: { kind: actorKind, id: actorKind === 'user' ? 'u1' : 'criativo' } as SessionEvent['actor'],
    payload,
    createdAt: '2026-10-02T00:00:00.000Z',
  };
}

const pergunta = ev(1, 'chat.structured_question', 'agent', {
  questions: [
    { id: 'q1', label: 'Público', type: 'text', options: [] },
    { id: 'q2', label: 'Prazo', type: 'text', options: [] },
  ],
});
const resposta = ev(2, 'chat.structured_question_answered', 'user', {
  questionSetId: 'e1',
  answers: { q1: 'lojistas', q2: '3 meses' },
});

describe('ecosDeRespostaEstruturada (RN-712)', () => {
  it('acha a chat.message que repete as respostas do formulário', () => {
    const eco = ev(3, 'chat.message', 'user', { text: '1. Público: lojistas\n2. Prazo: 3 meses' });
    expect(ecosDeRespostaEstruturada([pergunta, resposta, eco]).has('e3')).toBe(true);
  });

  it('mensagem digitada diferente não é eco e fica no fio', () => {
    const outra = ev(3, 'chat.message', 'user', { text: '1. Público: outro' });
    expect(ecosDeRespostaEstruturada([pergunta, resposta, outra]).size).toBe(0);
  });
});
