import { describe, expect, it } from 'vitest';
import { nomeDaMensagemOtimista, otimistaJaNoLog } from './mensagem-otimista';

describe('mensagem otimista (RN-728, AT-409)', () => {
  const eventos = [
    { id: 'm-1', type: 'chat.message' },
    { id: 'q-1', type: 'chat.message_queued' },
  ];

  it('sai do fio quando o chat.message com o id do aceite chega ao log', () => {
    expect(otimistaJaNoLog(eventos, 'm-1')).toBe(true);
  });

  it('fica enquanto o evento não chegou, sem id, ou se só outro tipo tem o id', () => {
    expect(otimistaJaNoLog(eventos, 'm-2')).toBe(false);
    expect(otimistaJaNoLog(eventos, null)).toBe(false);
    expect(otimistaJaNoLog(eventos, 'q-1')).toBe(false);
  });

  it('o nome é o mesmo da bolha do log: o da linha de membro, não o e-mail', () => {
    const autoria = {
      meuId: 'u-1',
      meuEmail: 'dono@loja-teste.local',
      membros: [
        { userId: 'u-1', name: 'Dono Loja', email: 'dono@loja-teste.local', role: 'owner' },
      ] as never,
    };
    expect(nomeDaMensagemOtimista(autoria)).toBe('Dono Loja');
    expect(nomeDaMensagemOtimista({ ...autoria, membros: undefined })).toBe('dono@loja-teste.local');
  });
});
