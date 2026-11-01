import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ResumoDoContextoDaSessao, SessionEvent } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
import i18n from '../lib/i18n';

/**
 * RN-827/828 (AT-498): o painel "Contexto da sessão" soma à janela o
 * agregado da sessão INTEIRA contado no servidor. Numa sessão de 301 eventos
 * ele dizia "0 regras" sobre 11; agora o número é o da sessão, e sem o
 * agregado o painel diz que não leu — nunca que não houve.
 */

let resumo: ResumoDoContextoDaSessao | undefined;

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

// A janela: só os eventos 102..301 — as 11 regras ficaram antes dela.
const janela: SessionEvent[] = [
  {
    id: 'e-dec',
    sessionId: 's1',
    seq: 300,
    type: 'artifact.decision_record',
    actor: { kind: 'agent', id: 'criativo' },
    payload: { choice: 'React', context: '' },
    createdAt: '2026-10-10T12:00:00.000Z',
  } as SessionEvent,
];

vi.mock('../lib/hooks', () => ({
  useSessionEventHistory: () => historicoFalso(janela),
}));

vi.mock('../lib/contexto-da-sessao', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/contexto-da-sessao')>()),
  useContextoDaSessaoInteira: () => ({ data: resumo }),
}));

const { ContextAside } = await import('./ContextAside');

function renderizar() {
  return render(
    <ContextAside
      projectId="p1"
      sessionId="s1"
      actions={[]}
      pausarPoll={false}
      logOpen={false}
      onToggleLog={() => {}}
    />,
  );
}

describe('ContextAside — agregado da sessão inteira (RN-827/828)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('pt-BR');
  });

  it('com o agregado maior que a janela, mostra o total da sessão e lista os itens do servidor (RN-844)', () => {
    resumo = {
      sessoesLidas: ['s1', 'exec'],
      regras: 11,
      decisoes: 6,
      itensDeRegras: [
        {
          eventId: 'r1',
          seq: 5,
          actorId: 'po',
          titulo: 'Login exige e-mail',
          descricao: 'só e-mail',
          origens: 2,
        },
      ],
      itensDeDecisoes: [
        { eventId: 'd1', seq: 6, actorId: 'criativo', escolha: 'SQLite', contexto: null },
      ],
      artefatosPorAgente: [{ actorId: 'po', quantos: 4 }],
      arquivosTocados: {
        itens: [{ actionId: 'a1', path: 'src/exec.ts', additions: 2, deletions: 0 }],
        total: 1,
        prsNaoLidas: 3,
      },
    };
    renderizar();
    expect(screen.getByText('11')).toBeTruthy();
    // A regra fora da janela de eventos aparece pelo item do servidor.
    expect(screen.getByText('Login exige e-mail')).toBeTruthy();
    expect(screen.queryByText(/todas antes/)).toBeNull();
    expect(screen.getByText(/Mostrando as 1 mais recentes de 11/)).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('SQLite')).toBeTruthy();
    expect(screen.getByText(/Mostrando as 1 mais recentes de 6/)).toBeTruthy();
    expect(screen.getByText(/3 PRs ficaram de fora/)).toBeTruthy();
    // O PO só tem artefato fora da janela e ainda assim aparece, com o total.
    expect(screen.getAllByText('4').length).toBeGreaterThan(0);
    // Arquivo da sessão de execução ligada (RN-828).
    expect(screen.getByText('src/exec.ts')).toBeTruthy();
    expect(screen.queryByText(/Ainda não li/)).toBeNull();
  });

  it('agregado sem arquivo diz O QUE não houve (PR nem commit), não "nada ainda"', () => {
    resumo = {
      sessoesLidas: ['s1'],
      regras: 0,
      decisoes: 0,
      itensDeRegras: [],
      itensDeDecisoes: [],
      artefatosPorAgente: [],
      arquivosTocados: { itens: [], total: 0, prsNaoLidas: 0 },
    };
    renderizar();
    expect(
      screen.getByText(
        'Nenhum arquivo nas PRs nem nos commits desta sessão ou da execução ligada a ela.',
      ),
    ).toBeTruthy();
  });

  it('sem o agregado, os arquivos dizem "não li" em vez de "nada ainda"', () => {
    resumo = undefined;
    renderizar();
    expect(screen.getByText('Ainda não li os arquivos da sessão inteira.')).toBeTruthy();
  });
});
