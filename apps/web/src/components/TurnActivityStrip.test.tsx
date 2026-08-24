import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TurnActivityStrip } from './TurnActivityStrip';
import type { EstadoDaAtividadeDoTurno } from '../lib/atividade-do-turno';
// Instância REAL do app (mesmo padrão de `AgentTimelineTree.test.tsx`): sem
// `I18nextProvider` no teste, `useTranslation` cai no singleton global.
import i18n from '../lib/i18n';

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

const VAZIO: EstadoDaAtividadeDoTurno = { linhas: [], corrente: '' };

describe('TurnActivityStrip', () => {
  it('sem nenhuma linha e sem pensandoVisivel: não renderiza NADA', () => {
    const { container } = render(
      <TurnActivityStrip estado={VAZIO} agente="po" pensandoVisivel={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('sem nenhuma linha, mas pensandoVisivel (timer de 5s já armado): mostra "Pensando…"', () => {
    render(<TurnActivityStrip estado={VAZIO} agente="po" pensandoVisivel />);
    expect(screen.getByText('Pensando…')).toBeInTheDocument();
  });

  it('mostra o TEXTO CORRENTE como prévia, mesmo antes dos 5s (RN-131: texto de verdade não espera timer)', () => {
    const estado: EstadoDaAtividadeDoTurno = { linhas: [], corrente: 'Escrevendo a resposta...' };
    render(<TurnActivityStrip estado={estado} agente="po" pensandoVisivel={false} />);
    expect(screen.getByText('Escrevendo a resposta...')).toBeInTheDocument();
    expect(screen.queryByText('Pensando…')).not.toBeInTheDocument();
  });

  it('sem corrente, mostra a ÚLTIMA linha arquivada como prévia', () => {
    const estado: EstadoDaAtividadeDoTurno = {
      linhas: [
        { tipo: 'narracao', texto: 'Vou escrever uma história.' },
        { tipo: 'ferramenta', texto: 'Escrevendo uma história' },
      ],
      corrente: '',
    };
    render(<TurnActivityStrip estado={estado} agente="po" pensandoVisivel={false} />);
    expect(screen.getByText('Escrevendo uma história')).toBeInTheDocument();
    // A narração anterior NÃO some — só não é a prévia; continua acessível
    // dentro do Disclosure fechado (verificado no teste de expansão abaixo).
    expect(screen.queryByText('Vou escrever uma história.')).not.toBeInTheDocument();
  });

  it('expande a lista INTEIRA (arquivadas + corrente) via Disclosure', () => {
    const estado: EstadoDaAtividadeDoTurno = {
      linhas: [
        { tipo: 'narracao', texto: 'Vou escrever uma história.' },
        { tipo: 'ferramenta', texto: 'Escrevendo uma história' },
      ],
      corrente: 'Pronto, terminei.',
    };
    render(<TurnActivityStrip estado={estado} agente="po" pensandoVisivel={false} />);

    // Fechado por padrão: as linhas arquivadas não aparecem ainda.
    expect(screen.queryByText('Vou escrever uma história.')).not.toBeInTheDocument();

    const cabecalho = screen.getByRole('button', { name: /Passos do turno/ });
    fireEvent.click(cabecalho);

    expect(screen.getByText('Vou escrever uma história.')).toBeInTheDocument();
    expect(screen.getByText('Escrevendo uma história')).toBeInTheDocument();
    // O corrente entra na lista expandida também, como narração em curso —
    // ao lado da PRÉVIA de uma linha só (que também mostra o mesmo texto,
    // daí o `getAllByText`).
    expect(screen.getAllByText('Pronto, terminei.')).toHaveLength(2);
  });

  it('nunca renderiza o nome cru da ferramenta — só a frase já resolvida', () => {
    const estado: EstadoDaAtividadeDoTurno = {
      linhas: [{ tipo: 'ferramenta', texto: 'Escrevendo uma história' }],
      corrente: '',
    };
    render(<TurnActivityStrip estado={estado} agente="po" pensandoVisivel={false} />);
    expect(screen.queryByText('create_story')).not.toBeInTheDocument();
    expect(screen.queryByText(/tool.call/i)).not.toBeInTheDocument();
  });

  it('sem agente (null): não quebra, degrada pro fallback genérico', () => {
    const estado: EstadoDaAtividadeDoTurno = { linhas: [], corrente: 'Olá' };
    render(<TurnActivityStrip estado={estado} agente={null} pensandoVisivel={false} />);
    expect(screen.getByText('Olá')).toBeInTheDocument();
  });
});
