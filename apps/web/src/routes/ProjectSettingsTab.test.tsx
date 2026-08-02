import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExecutionSection, PromotionSection } from './ProjectSettingsTab';
import { ToastProvider } from '../components/ui/ToastProvider';
import type { Project } from '../lib/api-types';

const getProject = vi.fn();
const updateProject = vi.fn();

vi.mock('../lib/api-client', () => ({
  getProject: (...args: unknown[]) => getProject(...args),
  updateProject: (...args: unknown[]) => updateProject(...args),
}));

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    workspaceId: 'ws-1',
    name: 'Checkout',
    slug: 'checkout',
    createdBy: 'user-1',
    maxConsecutiveBlocked: null,
    storyPromotion: 'manual',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...over,
  };
}

function montarSecao(secao: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{secao}</ToastProvider>
    </QueryClientProvider>,
  );
}

function montar() {
  return montarSecao(<ExecutionSection projectId="proj-1" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  updateProject.mockResolvedValue(project({ maxConsecutiveBlocked: 3 }));
});

describe('ExecutionSection', () => {
  it('sem valor próprio: mostra o default (3), pré-preenchido no campo', async () => {
    getProject.mockResolvedValue(project({ maxConsecutiveBlocked: null }));
    montar();

    expect(await screen.findByText(/usa o default \(3\)/)).toBeTruthy();
    expect(screen.getByDisplayValue('3')).toBeTruthy();
  });

  it('com valor próprio: mostra o valor configurado, não o default', async () => {
    getProject.mockResolvedValue(project({ maxConsecutiveBlocked: 5 }));
    montar();

    expect(await screen.findByDisplayValue('5')).toBeTruthy();
    expect(screen.getByText('Configurado para este projeto')).toBeTruthy();
  });

  it('salvar envia o número digitado e invalida a query do projeto', async () => {
    getProject.mockResolvedValue(project({ maxConsecutiveBlocked: null }));
    montar();

    const campo = await screen.findByDisplayValue('3');
    fireEvent.change(campo, { target: { value: '7' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith('proj-1', {
        maxConsecutiveBlocked: 7,
      }),
    );
    expect(await screen.findByText('Teto do circuit breaker salvo')).toBeTruthy();
  });

  it('valor inválido (zero, negativo, fracionário): botão desabilitado, nada é salvo', async () => {
    getProject.mockResolvedValue(project({ maxConsecutiveBlocked: 3 }));
    montar();

    const campo = await screen.findByDisplayValue('3');
    fireEvent.change(campo, { target: { value: '0' } });

    const botao = screen.getByText('Salvar').closest('button');
    expect(botao?.disabled).toBe(true);

    fireEvent.click(screen.getByText('Salvar'));
    expect(updateProject).not.toHaveBeenCalled();
  });
});

describe('PromotionSection (Fase 12c — RN-048)', () => {
  function montarPromocao() {
    return montarSecao(<PromotionSection projectId="proj-1" />);
  }

  it('projeto novo cai em manual e explica o que isso significa', async () => {
    getProject.mockResolvedValue(project({ storyPromotion: 'manual' }));
    montarPromocao();

    expect(await screen.findByDisplayValue('Manual — eu promovo')).toBeTruthy();
    expect(screen.getByText(/Nenhuma tarefa dela é pegável até lá/)).toBeTruthy();
  });

  it('projeto em auto mostra que é o comportamento anterior, mantido como opção', async () => {
    getProject.mockResolvedValue(project({ storyPromotion: 'auto' }));
    montarPromocao();

    expect(
      await screen.findByDisplayValue('Automática — o PO promove'),
    ).toBeTruthy();
    expect(screen.getByText(/comportamento anterior à Fase 12c/)).toBeTruthy();
  });

  it('trocar o modo salva no onChange, sem botão', async () => {
    getProject.mockResolvedValue(project({ storyPromotion: 'manual' }));
    updateProject.mockResolvedValue(project({ storyPromotion: 'auto' }));
    montarPromocao();

    const select = await screen.findByLabelText('Quem promove histórias');
    fireEvent.change(select, { target: { value: 'auto' } });

    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith('proj-1', {
        storyPromotion: 'auto',
      }),
    );
  });
});
