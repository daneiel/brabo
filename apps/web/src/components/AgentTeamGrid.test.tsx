import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentTeamGrid } from './AgentTeamGrid';
import { AGENTS } from '../lib/agents';
import type { AgentAutonomyRule } from '../lib/api-types';
import type { RosterEntry } from '../lib/agent-status';
import i18n from '../lib/i18n';

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

const DEV: RosterEntry = { id: 'dev-api', def: AGENTS.criativo, status: 'ocioso' };

function renderGrid(autonomyRules: AgentAutonomyRule[]) {
  return render(
    <AgentTeamGrid
      roster={[DEV]}
      groups={[{ kind: 'solo', entry: DEV }]}
      events={[]}
      bindingQueries={[]}
      allModels={[]}
      autonomyRules={autonomyRules}
      progressByAgent={new Map()}
      collapsedAreas={new Set()}
      onToggleArea={vi.fn()}
      onAutonomyChange={vi.fn()}
      onRearm={vi.fn()}
    />,
  );
}

/**
 * RN-603: a frase do modo automático só aparece quando a CURINGA `"*"` está
 * ligada — é ela, e só ela, que dispensa o escopo de caminho. A regra do tipo
 * representativo é específica e não libera o escopo; dizer que libera seria a
 * tela mentindo.
 */
describe('AgentTeamGrid — frase do modo automático (RN-603)', () => {
  it('curinga ligada: diz o que libera e o que continua pedindo', () => {
    renderGrid([{ agentId: 'dev-api', actionType: '*', mode: 'auto_approve' }]);
    expect(screen.getByText(/inclusive fora da pasta do projeto/)).toBeInTheDocument();
    expect(screen.getByText(/sudo\/doas/)).toBeInTheDocument();
  });

  it('curinga desligada (manual): nenhuma frase', () => {
    renderGrid([{ agentId: 'dev-api', actionType: '*', mode: 'require_approval' }]);
    expect(screen.queryByText(/inclusive fora da pasta do projeto/)).toBeNull();
  });

  it('auto por regra ESPECÍFICA (sem curinga): nenhuma frase', () => {
    renderGrid([{ agentId: 'dev-api', actionType: 'terminal', mode: 'auto_approve' }]);
    expect(screen.getByRole('button', { name: 'auto' })).toBeInTheDocument();
    expect(screen.queryByText(/inclusive fora da pasta do projeto/)).toBeNull();
  });
});
