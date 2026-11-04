import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen as telaInteira, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import i18n from '../lib/i18n';
import * as api from '../lib/api-client';
import { SessionComposer, type SessionComposerProps } from './SessionComposer';

vi.mock('@tanstack/react-router', () => ({ Link: () => null }));
vi.mock('../lib/api-client', async (orig) => ({
  ...(await orig<typeof import('../lib/api-client')>()),
  getProjectPendingActions: vi.fn(),
  approveAction: vi.fn(async () => ({})),
  sendMessageToMany: vi.fn(async () => ({ mensagemId: 'm1', entregas: [] })),
  getOpenQuestions: vi.fn(async () => ({ total: 0, items: [] })),
  getAgentCatalog: vi.fn(),
  searchRag: vi.fn(),
}));
vi.mock('../components/ai-elements/anexos', () => ({ AnexosPendentes: () => null, BotaoDeAnexar: () => null }));
vi.mock('../lib/anexos', () => ({ adicionarAnexos: vi.fn(), subirAnexosPendentes: vi.fn(async () => []) }));

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});
afterAll(() => {
  void i18n.changeLanguage('en');
});
beforeEach(() => vi.clearAllMocks());

const acao = (actionType: string, id = 'a1', payload = {}) =>
  ({ id, sessionId: 's1', actionType, payload }) as never;

function Montar({ extra = {} }: { extra?: Partial<SessionComposerProps> }) {
  const [draft, setDraft] = useState('');
  const props = {
    isActive: true,
    handoffDaInfraOferecido: undefined,
    handleAcceptHandoff: async () => {},
    opcoesDeDestinatario: ['criativo', 'po', 'arquiteto'],
    destinatario: 'criativo',
    precisaEscolherDestinatario: false,
    escolherDestinatario: vi.fn(),
    manualHandoffTarget: '',
    setManualHandoffTarget: () => {},
    enviandoHandoffManual: false,
    activeFor: () => true,
    handleRequestManualHandoff: async () => {},
    session: { id: 's1', projectId: 'p1', status: 'active' } as never,
    draft,
    setDraft,
    handleComposerKeyDown: () => {},
    streaming: false,
    podeEnfileirar: false,
    handleSend: vi.fn(async () => {}),
    handleCancel: async () => {},
    criativoActive: true,
    prontidaoJaDeclarada: false,
    handleReadiness: async () => {},
    hasBusinessRule: true,
    arquitetoActive: false,
    arquiteturaJaDeclarada: false,
    handleArchitectureReadiness: async () => {},
    hasPromotedStory: false,
    handleActivate: async () => {},
    ...extra,
  } satisfies SessionComposerProps;
  return <SessionComposer {...props} />;
}

function montar(extra: Partial<SessionComposerProps> = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Montar extra={extra} />
    </QueryClientProvider>,
  );
  return screen.getByPlaceholderText(/Escreva uma mensagem/) as HTMLTextAreaElement;
}

function digitar(campo: HTMLTextAreaElement, texto: string) {
  fireEvent.change(campo, { target: { value: texto } });
  campo.setSelectionRange(texto.length, texto.length);
  fireEvent.input(campo);
}

const screen = {
  ...telaInteira,
  // só o menu: o seletor "Para" também tem <option>.
  findByRole: async (r: string, o?: object) =>
    r === 'option' ? within(await telaInteira.findByTestId('menu-do-composer')).findByRole(r as never, o) : telaInteira.findByRole(r as never, o),
  findAllByRole: async (r: string, o?: object) => within(await telaInteira.findByTestId('menu-do-composer')).findAllByRole(r as never, o),
  getByRole: (r: string, o?: object) =>
    r === 'option' ? within(telaInteira.getByTestId('menu-do-composer')).getByRole(r as never, o) : telaInteira.getByRole(r as never, o),
  queryByRole: (r: string, o?: object) =>
    r === 'option'
      ? (telaInteira.queryByTestId('menu-do-composer') && within(telaInteira.getByTestId('menu-do-composer')).queryByRole(r as never, o)) || null
      : telaInteira.queryByRole(r as never, o),
  findByTestId: telaInteira.findByTestId,
  getByTestId: telaInteira.getByTestId,
  getByPlaceholderText: telaInteira.getByPlaceholderText,
  findAllByText: telaInteira.findAllByText,
  getAllByRole: telaInteira.getAllByRole,
};

describe('menus @ e / do composer (AT-717)', () => {
  it('digitar / abre o menu com os comandos disponíveis, e o filtro funciona', async () => {
    const campo = montar();
    digitar(campo, '/');
    expect(await screen.findByRole('option', { name: /pronto/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /resumo/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /parar/ })).toBeNull();
    expect(campo).toHaveAttribute('aria-controls');
    expect(document.getElementById(campo.getAttribute('aria-activedescendant')!)).toHaveAttribute('role', 'option');
    digitar(campo, '/res');
    await waitFor(() => expect(screen.queryByRole('option', { name: /pronto/ })).toBeNull());
    expect(screen.getByRole('option', { name: /resumo/ })).toBeInTheDocument();
  });

  it('Enter escolhe sem enviar e Esc fecha; /resumo insere o texto fixo', async () => {
    const handleSend = vi.fn(async () => {});
    const campo = montar({ handleSend });
    digitar(campo, '/res');
    await screen.findByRole('option', { name: /resumo/ });
    fireEvent.keyDown(campo, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('option')).toBeNull());
    digitar(campo, '/res');
    await screen.findByRole('option', { name: /resumo/ });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect(handleSend).not.toHaveBeenCalled();
    await waitFor(() => expect(campo.value).toMatch(/^Resuma em tópicos/));
  });

  it('/aprovar com uma pendência comum confirma e chama o endpoint', async () => {
    vi.mocked(api.getProjectPendingActions).mockResolvedValue([acao('terminal', 'a1', { command: 'ls' })]);
    const campo = montar();
    digitar(campo, '/aprov');
    await screen.findByRole('option', { name: /aprovar/ });
    fireEvent.keyDown(campo, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(api.approveAction).toHaveBeenCalledWith('p1', 's1', 'a1'));
  });

  it('/aprovar com pendência de teto só leva ao card', async () => {
    vi.mocked(api.getProjectPendingActions).mockResolvedValue([acao('git_merge')]);
    const campo = montar();
    digitar(campo, '/aprov');
    await screen.findByRole('option', { name: /aprovar/ });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect(await screen.findByTestId('aviso-do-menu')).toBeInTheDocument();
    expect(api.approveAction).not.toHaveBeenCalled();
  });

  it('@ lista só os agentes da sessão; um chip usa a rota de hoje, dois usam a nova', async () => {
    const escolherDestinatario = vi.fn();
    const handleSend = vi.fn(async () => {});
    const campo = montar({ escolherDestinatario, handleSend });
    digitar(campo, '@');
    expect(await screen.findAllByRole('option')).toHaveLength(3);
    expect(screen.queryByRole('option', { name: /Staff/ })).toBeNull();
    fireEvent.keyDown(campo, { key: 'Enter' });
    await waitFor(() => expect(campo.value).toBe(''));
    expect(escolherDestinatario).toHaveBeenCalledWith('criativo', true);
    expect(screen.getByTestId('destinatarios-do-chat').textContent).toContain('Criativo');
    // um chip: o envio segue pela rota de hoje (o handler da página)
    fireEvent.click(telaInteira.getByRole('button', { name: /Remover Criativo/ }));
    expect(telaInteira.queryByTestId('destinatarios-do-chat')).toBeNull();
    expect(api.sendMessageToMany).not.toHaveBeenCalled();
  });

  it('dois chips enviam pela rota nova e o campo segue não controlado', async () => {
    const campo = montar();
    for (let i = 0; i < 2; i++) {
      digitar(campo, '@');
      await screen.findAllByRole('option');
      fireEvent.keyDown(campo, { key: 'Enter' });
      await waitFor(() => expect(campo.value).toBe(''));
    }
    expect(screen.getByTestId('destinatarios-do-chat').textContent).toContain('Criativo');
    digitar(campo, 'oi pessoal');
    fireEvent.keyDown(campo, { key: 'Enter' });
    await waitFor(() =>
      expect(api.sendMessageToMany).toHaveBeenCalledWith('p1', 's1', 'oi pessoal', ['criativo', 'po'], []),
    );
    // não controlado: o nó não tem `value` vindo do React (defaultValue apenas)
    expect(campo.defaultValue).toBe('');
  });

  it('/skills lista as ferramentas do destinatário (AT-724)', async () => {
    vi.mocked(api.getAgentCatalog).mockResolvedValueOnce({
      agentes: [{ agente: 'criativo', identidade: 'x', instrucoesDoProjeto: null, ferramentas: [{ nome: 'emit_artifact', descricao: 'grava' }] }],
    } as never);
    const campo = montar();
    digitar(campo, '/skills');
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect(await screen.findByTestId('resultado-do-comando')).toHaveTextContent(/1 ferramenta[\s\S]*emit_artifact/);
  });

  it('/skills com a api falhando mostra o motivo, nunca "sem ferramentas"', async () => {
    vi.mocked(api.getAgentCatalog).mockRejectedValueOnce(new Error('engine fora'));
    const campo = montar();
    digitar(campo, '/skills');
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect(await screen.findByTestId('aviso-do-menu')).toHaveTextContent(/engine fora/);
  });

  it('/buscar usa o texto do campo no RAG; falha diz o motivo (AT-724)', async () => {
    vi.mocked(api.searchRag).mockResolvedValueOnce({ query: 'login', searchId: null, vectorAvailable: true, hits: [{ chunkId: 'c', scope: 'adr', content: 'ADR de login', score: 1 }] } as never);
    const campo = montar();
    digitar(campo, 'login /buscar');
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect(await screen.findByTestId('resultado-do-comando')).toHaveTextContent(/ADR de login/);
    expect(api.searchRag).toHaveBeenCalledWith('p1', expect.objectContaining({ query: 'login' }));

    vi.mocked(api.searchRag).mockRejectedValueOnce(new Error('rag fora'));
    digitar(campo, 'outro /buscar');
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect(await screen.findByTestId('aviso-do-menu')).toHaveTextContent(/rag fora/);
  });
});
