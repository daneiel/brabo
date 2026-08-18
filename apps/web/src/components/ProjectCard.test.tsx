import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectCard, ProjectCardSkeleton } from './ProjectCard';
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

/**
 * RN-409 — "N online" é status AO VIVO (trabalhando/com pendência), nunca
 * tamanho de equipe. `0`/`undefined` não desenha nada — um "0 online"
 * sugeriria uma equipe vazia, não ausência de trabalho agora.
 */
describe('ProjectCard — badge de agentes online', () => {
  it('mostra "N online" quando onlineAgentCount > 0', () => {
    render(<ProjectCard {...baseProps} rosterGroups={[]} onlineAgentCount={2} />);

    expect(screen.getByText('2 online')).toBeInTheDocument();
  });

  it('sem agente online (0 ou undefined), não mostra o badge', () => {
    const { rerender } = render(
      <ProjectCard {...baseProps} rosterGroups={[]} onlineAgentCount={0} />,
    );
    expect(screen.queryByText(/online/)).not.toBeInTheDocument();

    rerender(<ProjectCard {...baseProps} rosterGroups={[]} />);
    expect(screen.queryByText(/online/)).not.toBeInTheDocument();
  });
});

/**
 * Foco visível do card (frente H1, PROGRAMA 28).
 *
 * `ProjectCard.module.css` tinha `.card:hover` mas NENHUM `:focus-visible` —
 * o card é um `<button>` (Tab alcança), mas até aqui não tinha indicação
 * própria de foco, só a que o hover dá, e teclado não aciona hover. Entrou o
 * mesmo tratamento calibrado de `Input.module.css` (ADR 0036). O teste prova
 * alcançabilidade por teclado de verdade, não presença de classe CSS.
 */
describe('ProjectCard — foco visível', () => {
  it('o card é um <button> alcançável por teclado e aciona onClick', () => {
    const onClick = vi.fn();
    render(<ProjectCard {...baseProps} rosterGroups={[]} onClick={onClick} />);

    const card = screen.getByRole('button', { name: /Core API/ });
    card.focus();
    expect(card).toHaveFocus();

    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('o skeleton NÃO é alvo de foco — é <div>, não <button>, enquanto carrega', () => {
    render(<ProjectCardSkeleton />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
