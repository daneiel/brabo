import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AgentTimelineTree } from './AgentTimelineTree';
import { getAgentLastSeenSeq } from '../lib/read-state';
import type { SessionEvent } from '../lib/api-types';

const PROJECT_ID = 'proj-1';

let seq = 0;
function evento(
  type: string,
  actor: { kind: string; id: string },
  payload: Record<string, unknown> = {},
): SessionEvent {
  seq += 1;
  return {
    id: `evt-${seq}`,
    sessionId: 's1',
    seq,
    type,
    actor,
    payload,
    createdAt: new Date(2026, 7, 4, 12, 0, seq).toISOString(),
  } as SessionEvent;
}

const agente = (id: string) => ({ kind: 'agent', id });

describe('AgentTimelineTree', () => {
  beforeEach(() => {
    seq = 0;
    localStorage.clear();
  });

  it('abre por padrão os agentes ATIVOS e os 5 mais recentes parados', () => {
    const eventos: SessionEvent[] = [];
    for (const nome of ['a', 'b', 'c', 'd', 'e', 'f']) {
      eventos.push(evento('agent.activated', agente(nome)));
      eventos.push(evento('agent.response', agente(nome), {})); // encerra — todos parados
    }

    render(<AgentTimelineTree events={eventos} projectId={PROJECT_ID} />);

    // 6 agentes parados, só os 5 mais recentes (b..f) abrem; `a` (o mais
    // antigo) nasce fechado.
    expect(screen.getByTestId('ramo-cabecalho-a').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('ramo-cabecalho-f').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('ramo-cabecalho-b').getAttribute('aria-expanded')).toBe('true');
  });

  it('marco individual expande e mostra args/resultado/iteração ao clicar', () => {
    const eventos: SessionEvent[] = [
      evento('agent.activated', agente('dev-backend')),
      evento('agent.response', agente('dev-backend'), { iteration: 0, content: 'vou ler o arquivo' }),
      evento('tool.call', agente('dev-backend'), {
        tool: 'read_file',
        args: { path: 'lib/foo.ex' },
      }),
      evento('tool.result', agente('dev-backend'), {
        tool: 'read_file',
        ok: true,
        result: 'defmodule Foo do\nend',
      }),
    ];
    const [, respostaEv, chamadaEv, resultadoEv] = eventos;

    render(<AgentTimelineTree events={eventos} projectId={PROJECT_ID} />);

    function regiaoDe(botao: HTMLElement): HTMLElement {
      const id = botao.getAttribute('aria-controls')!;
      return document.getElementById(id)!;
    }

    // O marco de tool.call é expansível — clicar mostra os argumentos.
    const marcoFerramenta = screen.getByTestId(`marco-cabecalho-${chamadaEv.id}`);
    expect(marcoFerramenta.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(marcoFerramenta);
    expect(marcoFerramenta.getAttribute('aria-expanded')).toBe('true');
    expect(within(regiaoDe(marcoFerramenta)).getByText(/lib\/foo\.ex/)).toBeInTheDocument();

    // O marco de tool.result mostra o resultado.
    const marcoResultado = screen.getByTestId(`marco-cabecalho-${resultadoEv.id}`);
    fireEvent.click(marcoResultado);
    expect(within(regiaoDe(marcoResultado)).getByText(/defmodule Foo/)).toBeInTheDocument();

    // O marco de agent.response mostra a iteração e o conteúdo.
    const marcoResposta = screen.getByTestId(`marco-cabecalho-${respostaEv.id}`);
    fireEvent.click(marcoResposta);
    const regiaoResposta = regiaoDe(marcoResposta);
    expect(within(regiaoResposta).getByText(/iteração 0/i)).toBeInTheDocument();
    expect(within(regiaoResposta).getByText(/vou ler o arquivo/)).toBeInTheDocument();
  });

  it('ramo e detalhe expandido usam o skin de bolha do chat (avatar + bolha, sem <pre> cru)', () => {
    const eventos: SessionEvent[] = [
      evento('agent.activated', agente('dev-backend')),
      evento('tool.call', agente('dev-backend'), {
        tool: 'read_file',
        args: { path: 'lib/foo.ex' },
      }),
    ];
    const chamadaEv = eventos[1];

    render(<AgentTimelineTree events={eventos} projectId={PROJECT_ID} />);

    // O cabeçalho do ramo porta o avatar do agente (ícone), não mais o pino.
    const cabecalhoRamo = screen.getByTestId('ramo-cabecalho-dev-backend');
    expect(cabecalhoRamo.querySelector('svg')).toBeInTheDocument();

    // O detalhe expandido do marco também ganha avatar, e o conteúdo deixa
    // de ser um `<pre>` cru — vira a mesma bolha do chat.
    const marcoFerramenta = screen.getByTestId(`marco-cabecalho-${chamadaEv.id}`);
    fireEvent.click(marcoFerramenta);
    const regiao = document.getElementById(
      marcoFerramenta.getAttribute('aria-controls')!,
    )!;
    expect(regiao.querySelector('svg')).toBeInTheDocument();
    expect(regiao.querySelector('pre')).not.toBeInTheDocument();
    expect(within(regiao).getByText(/lib\/foo\.ex/)).toBeInTheDocument();
  });

  it('marco não expansível (handoff, artefato…) não vira botão de expandir', () => {
    const eventos: SessionEvent[] = [
      evento('agent.activated', agente('po')),
      evento('handoff.offered', agente('po'), { toAgent: 'arquiteto' }),
    ];
    const handoffEv = eventos[1];

    render(<AgentTimelineTree events={eventos} projectId={PROJECT_ID} />);

    expect(screen.queryByTestId(`marco-cabecalho-${handoffEv.id}`)).not.toBeInTheDocument();
    expect(screen.getByText('ofereceu o trabalho')).toBeInTheDocument();
  });

  it('contador de novidade aparece quando o ramo está colapsado com marco novo, e some ao abrir', () => {
    const eventos: SessionEvent[] = [];
    // `alvo` primeiro — vira o mais ANTIGO. 5 agentes depois dele preenchem
    // os "5 últimos" por padrão e o empurram pra fora, colapsado.
    eventos.push(evento('agent.activated', agente('alvo')));
    eventos.push(evento('agent.response', agente('alvo'), {}));
    for (const nome of ['x1', 'x2', 'x3', 'x4', 'x5']) {
      eventos.push(evento('agent.activated', agente(nome)));
      eventos.push(evento('agent.response', agente(nome), {}));
    }

    const { rerender } = render(<AgentTimelineTree events={eventos} projectId={PROJECT_ID} />);

    const cabecalhoAlvo = () => screen.getByTestId('ramo-cabecalho-alvo');
    // `alvo` está fora dos 5 últimos (x1..x5 são mais recentes) — nasce
    // fechado, e como NUNCA foi visto (localStorage vazio), os 2 marcos que
    // já tem contam como novidade — mesmo comportamento do sino de projeto
    // (`getLastSeenSeq` default 0 = "tudo é novo até a primeira visita").
    expect(cabecalhoAlvo().getAttribute('aria-expanded')).toBe('false');
    expect(within(cabecalhoAlvo()).getByText('+2')).toBeInTheDocument();

    // Abrir marca como visto — a contagem de novidade some, sobra o total.
    fireEvent.click(cabecalhoAlvo());
    expect(getAgentLastSeenSeq(PROJECT_ID, 'alvo')).toBe(eventos[1].seq);
    expect(within(cabecalhoAlvo()).queryByText(/^\+/)).not.toBeInTheDocument();
    expect(within(cabecalhoAlvo()).getByText('2')).toBeInTheDocument();

    fireEvent.click(cabecalhoAlvo()); // fecha de novo — agora está VISTO, sem novidade
    expect(within(cabecalhoAlvo()).queryByText(/^\+/)).not.toBeInTheDocument();

    // Marco novo chega para `alvo` (um `agent.response` — desfecho, então o
    // ramo continua PARADO, não vira ativo por causa dele). Os outros 5
    // agentes também recebem marco novo, mais recente ainda — o que garante
    // que `alvo` continua fora dos "5 últimos" e permanece colapsado, com a
    // contagem de novidade reaparecendo só com o que É novo (1 marco).
    const novoMarco = evento('agent.response', agente('alvo'), {});
    const maisRecentes = ['x1', 'x2', 'x3', 'x4', 'x5'].map((nome) =>
      evento('agent.response', agente(nome), {}),
    );
    rerender(
      <AgentTimelineTree
        events={[...eventos, novoMarco, ...maisRecentes]}
        projectId={PROJECT_ID}
      />,
    );

    expect(cabecalhoAlvo().getAttribute('aria-expanded')).toBe('false');
    expect(within(cabecalhoAlvo()).getByText('+1')).toBeInTheDocument();
  });
});
