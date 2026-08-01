import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectCard } from './ProjectCard';
import { groupRosterByArea, type RosterEntry } from '../lib/agent-status';
import { AGENTS } from '../lib/agents';

function entry(id: keyof typeof AGENTS): RosterEntry {
  return { id, def: AGENTS[id], status: 'ocioso' };
}

const baseProps = {
  name: 'Core API',
  provider: 'github' as const,
  tokensUsed: 10,
  tokensLimit: 100,
  costBRL: 0,
  costUSD: 10,
  lastActivityText: 'sem atividade',
  onClick: vi.fn(),
};

describe('ProjectCard — chips de agente', () => {
  it('área de QA com subespecialidades vira um chip único, contagem inclui o lead', () => {
    const roster = [entry('qa'), entry('qa-automacao'), entry('qa-performance-seguranca')];
    const rosterGroups = groupRosterByArea(roster);

    render(<ProjectCard {...baseProps} rosterGroups={rosterGroups} />);

    // Um chip só pro grupo de área — não um por subagente.
    expect(screen.getAllByTitle(/QA/)).toHaveLength(1);
    expect(screen.getByTitle('QA ×3')).toBeInTheDocument();
  });

  it('agente solo não ganha contagem', () => {
    const roster = [entry('po')];
    const rosterGroups = groupRosterByArea(roster);

    render(<ProjectCard {...baseProps} rosterGroups={rosterGroups} />);

    expect(screen.getByTitle('PO')).toBeInTheDocument();
  });

  it('mais de 4 chips: mostra só os 4 primeiros mais um badge de excedente', () => {
    const roster = [
      entry('criativo'),
      entry('po'),
      entry('arquiteto'),
      entry('infra'),
      entry('secops'),
    ];
    const rosterGroups = groupRosterByArea(roster);

    render(<ProjectCard {...baseProps} rosterGroups={rosterGroups} />);

    expect(screen.getByTitle('Criativo')).toBeInTheDocument();
    expect(screen.getByTitle('PO')).toBeInTheDocument();
    expect(screen.getByTitle('Arquiteto')).toBeInTheDocument();
    expect(screen.getByTitle('Infra')).toBeInTheDocument();
    expect(screen.queryByTitle('SecOps')).not.toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('roster vazia: nenhum chip renderizado', () => {
    render(<ProjectCard {...baseProps} rosterGroups={[]} />);

    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
  });

  it('provider: só github, gitlab ou local — sem Bitbucket', () => {
    const { rerender } = render(<ProjectCard {...baseProps} rosterGroups={[]} provider="github" />);
    expect(screen.getByText('GitHub')).toBeInTheDocument();

    rerender(<ProjectCard {...baseProps} rosterGroups={[]} provider="gitlab" />);
    expect(screen.getByText('GitLab')).toBeInTheDocument();

    rerender(<ProjectCard {...baseProps} rosterGroups={[]} provider="local" />);
    expect(screen.getByText('Repositório local')).toBeInTheDocument();
  });
});
