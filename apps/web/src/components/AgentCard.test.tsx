import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentCard } from './AgentCard';
import { AGENTS } from '../lib/agents';
// Instância REAL do app (mesmo motivo de `agent-status.test.ts`): sem
// `I18nextProvider` no teste, o hook `useTranslation` cai no singleton
// global de `lib/i18n.ts` — as asserções abaixo checam o texto ATUAL em
// português.
import i18n from '../lib/i18n';

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

function renderCard(props: Partial<Parameters<typeof AgentCard>[0]> = {}) {
  return render(
    <AgentCard agent={AGENTS.criativo} status="trabalhando" {...props} />,
  );
}

describe('AgentCard', () => {
  it('mostra nome, papel e status', () => {
    renderCard();
    expect(screen.getByText(AGENTS.criativo.name)).toBeInTheDocument();
    expect(screen.getByText('trabalhando')).toBeInTheDocument();
  });

  it('mostra o modelo vinculado com o provider', () => {
    renderCard({ model: { name: 'qwen2.5-coder:7b', provider: 'ollama' } });
    expect(screen.getByText(/qwen2\.5-coder:7b · ollama/)).toBeInTheDocument();
  });

  it('mostra a task corrente e a branch', () => {
    renderCard({
      activity: { label: 'Implementar enviar(payload)', branch: 'feature/task-abc' },
    });
    expect(screen.getByText('Implementar enviar(payload)')).toBeInTheDocument();
    expect(screen.getByText('feature/task-abc')).toBeInTheDocument();
  });

  it('mostra os tokens da sessão formatados', () => {
    renderCard({ tokensMicros: 1_234_500 });
    expect(screen.getByText('US$ 1.2345')).toBeInTheDocument();
  });

  it('mostra tokens zerados em vez de esconder o campo', () => {
    // `0` é informação: o agente existe e ainda não gastou nada. Esconder
    // faria o card parecer sem suporte a custo.
    renderCard({ tokensMicros: 0 });
    expect(screen.getByText('US$ 0.0000')).toBeInTheDocument();
  });

  it('o toggle de autonomia só aparece com o handler, e chama de volta', () => {
    const semHandler = renderCard({ autonomy: 'manual' });
    expect(screen.queryByRole('button', { name: 'auto' })).not.toBeInTheDocument();
    semHandler.unmount();

    const onAutonomyChange = vi.fn();
    renderCard({ autonomy: 'manual', onAutonomyChange });
    fireEvent.click(screen.getByRole('button', { name: 'auto' }));
    expect(onAutonomyChange).toHaveBeenCalledWith('auto');
  });

  describe('rearmar (Fase 12b — RN-047)', () => {
    it('só aparece com status travado E o handler — nenhum dos dois sozinho basta', () => {
      const onRearm = vi.fn();

      renderCard({ status: 'trabalhando', onRearm }).unmount();
      expect(screen.queryByRole('button', { name: 'rearmar' })).not.toBeInTheDocument();

      renderCard({ status: 'travado' }).unmount();
      expect(screen.queryByRole('button', { name: 'rearmar' })).not.toBeInTheDocument();

      renderCard({ status: 'travado', onRearm });
      expect(screen.getByRole('button', { name: 'rearmar' })).toBeInTheDocument();
    });

    it('chama onRearm ao clicar', () => {
      const onRearm = vi.fn();
      renderCard({ status: 'travado', onRearm });

      fireEvent.click(screen.getByRole('button', { name: 'rearmar' }));

      expect(onRearm).toHaveBeenCalledTimes(1);
    });
  });
});
