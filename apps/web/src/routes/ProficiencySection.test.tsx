import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectSettingsTab } from './ProjectSettingsTab';
import { ToastProvider } from '../components/ui/ToastProvider';
import type { ProficiencyProfile } from '../lib/api-types';

/**
 * A seção de proficiência não tinha teste nenhum — e o defeito que mais
 * importa aqui é de navegação: a evidência de um perfil pode ser de QUALQUER
 * sessão (a janela da Anamnese é de projeto), então o chip precisa RESOLVER a
 * sessão do evento. Antes ele mandava sempre pra sessão mais recente.
 */
const navigate = vi.fn();
const getProjectEvent = vi.fn();
const deleteMyProficiency = vi.fn((_projectId: string) => Promise.resolve({}));
const runAnamnese = vi.fn((_projectId: string) => Promise.resolve({ ok: true }));

const PERFIL: ProficiencyProfile = {
  id: 'prof-1',
  projectId: 'project-1',
  userId: 'user-1',
  competency: 'nestjs',
  level: 'avancado',
  rationale: 'corrigiu o dev-api duas vezes no mesmo detalhe de DI',
  evidenceEventIds: ['01JEVT0000000000000000AAAA'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

vi.mock('../lib/hooks', () => ({
  useProficiency: () => ({ data: [PERFIL] }),
}));

vi.mock('../lib/api-client', () => ({
  getProjectEvent: (projectId: string, eventId: string) =>
    getProjectEvent(projectId, eventId),
  deleteMyProficiency: (projectId: string) => deleteMyProficiency(projectId),
  runAnamnese: (projectId: string) => runAnamnese(projectId),
  optInProficiency: () => Promise.resolve({}),
  listProjectInstructionVersions: () => Promise.resolve([]),
  rollbackInstruction: () => Promise.resolve({}),
  addProjectMember: () => Promise.resolve({}),
  removeProjectMember: () => Promise.resolve({}),
  listProjectMembers: () => Promise.resolve([]),
  listCredentials: () => Promise.resolve([]),
  upsertCredential: () => Promise.resolve({}),
  deleteCredential: () => Promise.resolve({}),
  // Shape válido de ModelsByCategory — `{}` fazia o ModelPicker estourar num
  // Object.entries e poluía o log com um erro que não é do teste.
  listModels: () => Promise.resolve({ local: {}, cloud: {} }),
  getAgentModelBinding: () => Promise.resolve(null),
  setAgentModelBinding: () => Promise.resolve({}),
}));

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ProjectSettingsTab projectId="project-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigate.mockClear();
  getProjectEvent.mockClear();
  deleteMyProficiency.mockClear();
  runAnamnese.mockClear();
  getProjectEvent.mockResolvedValue({
    id: '01JEVT0000000000000000AAAA',
    sessionId: 'sessao-antiga',
  });
});

describe('ProficiencySection', () => {
  it('mostra competência, nível e o porquê', () => {
    renderTab();

    expect(screen.getByText('nestjs')).toBeTruthy();
    expect(screen.getByText('avancado')).toBeTruthy();
    expect(
      screen.getByText('corrigiu o dev-api duas vezes no mesmo detalhe de DI'),
    ).toBeTruthy();
  });

  it('chip de evidência RESOLVE a sessão do evento antes de navegar', async () => {
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: '000000AAAA'.slice(-8) }));

    await waitFor(() =>
      expect(getProjectEvent).toHaveBeenCalledWith(
        'project-1',
        '01JEVT0000000000000000AAAA',
      ),
    );

    // A sessão do destino é a do EVENTO, não a mais recente do projeto.
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/projects/$projectId/sessions/$sessionId',
        params: { projectId: 'project-1', sessionId: 'sessao-antiga' },
        search: { highlightEvent: '01JEVT0000000000000000AAAA' },
      }),
    );
  });

  it('evidência que não resolve não navega pra lugar nenhum', async () => {
    getProjectEvent.mockRejectedValue(new Error('404'));
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: '000000AAAA'.slice(-8) }));

    await waitFor(() => expect(getProjectEvent).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('apagar o perfil pede confirmação antes de apagar', async () => {
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Apagar meu perfil' }));

    // O clique abre o modal e NÃO apaga ainda — a ação é irreversível.
    expect(deleteMyProficiency).not.toHaveBeenCalled();
    expect(
      screen.getByText('Apagar meu perfil de proficiência?'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Apagar' }));
    await waitFor(() =>
      expect(deleteMyProficiency).toHaveBeenCalledWith('project-1'),
    );
  });

  it('cancelar a confirmação não apaga', () => {
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Apagar meu perfil' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(deleteMyProficiency).not.toHaveBeenCalled();
  });

  it('rodar agora dispara a rodada sob demanda', async () => {
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Rodar agora' }));

    await waitFor(() => expect(runAnamnese).toHaveBeenCalledWith('project-1'));
  });
});
