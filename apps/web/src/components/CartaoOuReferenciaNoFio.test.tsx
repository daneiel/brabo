import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { ProposedAction } from '../lib/api-types';
import { registrarAcoesNoBloco } from '../lib/acoes-no-bloco';
import { CartaoOuReferenciaNoFio } from './CartaoOuReferenciaNoFio';

function acao(status: ProposedAction['status']): ProposedAction {
  return {
    id: 'm-1',
    sessionId: 's-1',
    actionType: 'git_merge',
    status,
    actor: { kind: 'user', id: 'u' },
    payload: {},
    createdAt: new Date().toISOString(),
  } as unknown as ProposedAction;
}

function Fio({ status }: { status: ProposedAction['status'] }) {
  return (
    <CartaoOuReferenciaNoFio action={acao(status)}>
      <button type="button">Aprovar</button>
    </CartaoOuReferenciaNoFio>
  );
}

let soltar: (() => void) | null = null;
afterEach(() => {
  act(() => soltar?.());
  soltar = null;
});

describe('CartaoOuReferenciaNoFio (RN-843, AT-512)', () => {
  it('com a ação pendente desenhada no bloco, o fio só aponta para lá: um único Aprovar', () => {
    soltar = registrarAcoesNoBloco(['m-1']);
    render(
      <>
        <button type="button">Aprovar</button>
        <Fio status="pending" />
      </>,
    );
    expect(screen.getAllByRole('button', { name: 'Aprovar' })).toHaveLength(1);
    expect(screen.getByTestId('referencia-ao-bloco')).toBeInTheDocument();
  });

  it('sem o bloco montado, o fio mostra o cartão completo', () => {
    render(<Fio status="pending" />);
    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeInTheDocument();
    expect(screen.queryByTestId('referencia-ao-bloco')).toBeNull();
  });

  it('decidida, o fio volta ao cartão (histórico) mesmo com o registro', () => {
    soltar = registrarAcoesNoBloco(['m-1']);
    render(<Fio status="approved" />);
    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeInTheDocument();
  });

  it('o bloco desmontado devolve o cartão ao fio', () => {
    soltar = registrarAcoesNoBloco(['m-1']);
    render(<Fio status="pending" />);
    expect(screen.queryByRole('button', { name: 'Aprovar' })).toBeNull();
    act(() => soltar?.());
    soltar = null;
    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeInTheDocument();
  });
});
