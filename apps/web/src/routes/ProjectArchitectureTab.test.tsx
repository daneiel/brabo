import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { ProjectArchitectureTab } from './ProjectArchitectureTab';
import type { Architecture } from '../lib/api-types';

const getArchitecture = vi.fn();

vi.mock('../lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...original,
    getArchitecture: (...args: unknown[]) => getArchitecture(...args),
  };
});

// `C4DiagramView` renderiza Mermaid de verdade — motor pesado, já coberto
// pelo próprio `C4DiagramView.test.tsx`. Aqui o que importa é só que a aba
// PASSA o diagrama certo pra ele; um dublê raso prova isso sem duplicar a
// cobertura do motor.
vi.mock('../components/C4DiagramView', () => ({
  C4DiagramView: ({ diagrama }: { diagrama: { systemName: string } }) => (
    <div data-testid="c4-diagram-view">diagrama de {diagrama.systemName}</div>
  ),
}));

const ARQUITETURA_VAZIA: Architecture = {
  moduleMap: null,
  adrs: [],
  pendencies: [],
  c4Diagram: { status: 'sem_diagrama', diagrama: null, version: 0, eventId: null, createdAt: null },
};

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectArchitectureTab projectId="proj-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * A aba é a extração 1:1 da antiga `ArchitectureSection` de
 * `ProjectOverviewTab.tsx` (PROGRAMA de abas agrupadas — Onda 3): mesmo
 * hook (`useArchitecture`), mesmo corpo — módulos, diagrama, ADRs,
 * pendências.
 */
describe('ProjectArchitectureTab', () => {
  it('sem arquitetura nenhuma, mostra a frase de vazio', async () => {
    getArchitecture.mockResolvedValue(ARQUITETURA_VAZIA);

    montar();

    expect(
      await screen.findByText('Sem arquitetura ainda — o Arquiteto gera o module_map e os ADRs.'),
    ).toBeInTheDocument();
  });

  it('mostra os cards de módulo com stack, responsabilidade e dependências', async () => {
    getArchitecture.mockResolvedValue({
      ...ARQUITETURA_VAZIA,
      moduleMap: {
        id: 'mm-1',
        projectId: 'proj-1',
        sessionId: 'sess-1',
        version: 2,
        modules: [
          {
            name: 'Checkout',
            stack: 'NestJS',
            responsibility: 'Fluxo de pagamento',
            dependsOn: ['Catalogo'],
          },
        ],
        createdAt: '2026-08-10T10:00:00.000Z',
      },
    });

    montar();

    expect(await screen.findByText('Checkout')).toBeInTheDocument();
    expect(screen.getByText('NestJS')).toBeInTheDocument();
    expect(screen.getByText('Fluxo de pagamento')).toBeInTheDocument();
    expect(screen.getByText('Catalogo')).toBeInTheDocument();
    expect(screen.getByText('Módulos · v2')).toBeInTheDocument();
  });

  it('diagrama `gerado` passa pro C4DiagramView; `sem_diagrama` mostra a frase de pendência', async () => {
    getArchitecture.mockResolvedValue({
      ...ARQUITETURA_VAZIA,
      moduleMap: {
        id: 'mm-1',
        projectId: 'proj-1',
        sessionId: 'sess-1',
        version: 1,
        modules: [{ name: 'M', stack: 's', responsibility: 'r', dependsOn: [] }],
        createdAt: '2026-08-10T10:00:00.000Z',
      },
      c4Diagram: {
        status: 'gerado',
        diagrama: {
          systemName: 'Brabo',
          systemDescription: '',
          actors: [],
          contextDiagram: 'C4Context',
          containerDiagram: 'C4Container',
        },
        version: 1,
        eventId: 'evt-1',
        createdAt: '2026-08-10T10:00:00.000Z',
      },
    });

    montar();

    expect(await screen.findByTestId('c4-diagram-view')).toHaveTextContent('diagrama de Brabo');
  });

  it('sem diagrama gerado ainda, mostra a frase (nunca chama o C4DiagramView)', async () => {
    getArchitecture.mockResolvedValue({
      ...ARQUITETURA_VAZIA,
      moduleMap: {
        id: 'mm-1',
        projectId: 'proj-1',
        sessionId: 'sess-1',
        version: 1,
        modules: [{ name: 'M', stack: 's', responsibility: 'r', dependsOn: [] }],
        createdAt: '2026-08-10T10:00:00.000Z',
      },
    });

    montar();

    expect(
      await screen.findByText(/Sem diagrama ainda — o Arquiteto gera o Context \+ Container/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('c4-diagram-view')).not.toBeInTheDocument();
  });

  it('lista ADRs com o selo de status e o link da PR quando existe', async () => {
    getArchitecture.mockResolvedValue({
      ...ARQUITETURA_VAZIA,
      adrs: [
        { actionId: 'a-1', title: 'ADR 0099 — grafo de conhecimento', status: 'executed', pullRequestUrl: 'https://github.com/x/y/pull/1' },
        { actionId: 'a-2', title: 'ADR sem PR ainda', status: 'pending', pullRequestUrl: null },
      ],
    });

    montar();

    const link = await screen.findByRole('link', { name: 'ADR 0099 — grafo de conhecimento' });
    expect(link).toHaveAttribute('href', 'https://github.com/x/y/pull/1');
    expect(screen.getByText('ADR sem PR ainda')).toBeInTheDocument();
    expect(screen.getByText('executed')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('mostra as pendências de validação cruzada com o motivo certo', async () => {
    getArchitecture.mockResolvedValue({
      ...ARQUITETURA_VAZIA,
      pendencies: [
        { storyId: 's-1', title: 'História sem módulo', status: 'ready', reason: 'no_module', missing: [] },
        {
          storyId: 's-2',
          title: 'História com módulo inexistente',
          status: 'ready',
          reason: 'missing_module',
          missing: ['ModuloFantasma'],
        },
      ],
    });

    montar();

    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(screen.getByText('História sem módulo')).toBeInTheDocument();
    expect(screen.getByText('sem módulo vinculado')).toBeInTheDocument();
    expect(screen.getByText('História com módulo inexistente')).toBeInTheDocument();
    expect(screen.getByText('módulo inexistente: ModuloFantasma')).toBeInTheDocument();
  });
});
