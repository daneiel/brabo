import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

/**
 * Auditoria de foco visível (frente H1, PROGRAMA 28): `Badge` foi um dos 5
 * arquivos sem `:focus-visible` encontrados no confronto de design. A causa
 * NÃO era ausência de estilo — é que o componente é um `<span>` de
 * apresentação pura, sem `role`, `tabIndex` ou `onClick` em uso em lugar
 * NENHUM do produto hoje. Badge clicável não existe; se um dia existir, o
 * foco visível entra junto com o primeiro uso — não antes, por antecipação.
 */
describe('Badge', () => {
  it('é apresentação pura — nenhum papel ou atributo de foco próprio', () => {
    render(<Badge tone="accent">Aguardando</Badge>);
    const badge = screen.getByText('Aguardando');
    expect(badge.tagName).toBe('SPAN');
    expect(badge).not.toHaveAttribute('tabindex');
    expect(badge).not.toHaveAttribute('role');
  });

  it('emCurso põe o rótulo no Shimmer, e o texto continua no DOM', () => {
    const { container } = render(<Badge emCurso>Provisionando</Badge>);
    const texto = screen.getByText('Provisionando');
    expect(texto.parentElement).toBe(container.firstChild);
    expect(texto.className).toMatch(/shimmer|estatico/);
  });

  it('sem emCurso o rótulo fica cru, sem Shimmer', () => {
    render(<Badge>Ativo</Badge>);
    expect(screen.getByText('Ativo').className).not.toMatch(/shimmer|estatico/);
  });

  it('expõe tom, tamanho e forma por data-*, nunca por classe', () => {
    render(
      <Badge tone="success" size="md" square pulse dot>
        ok
      </Badge>,
    );
    const badge = screen.getByText('ok');
    expect(badge).toHaveAttribute('data-tone', 'success');
    expect(badge).toHaveAttribute('data-size', 'md');
    expect(badge).toHaveAttribute('data-square', 'true');
    expect(badge).toHaveAttribute('data-pulse', 'true');
    expect(badge.querySelector('[data-slot="badge-dot"]')).not.toBeNull();
  });

  it('tom padrão é muted e sem dot não há bolinha', () => {
    render(<Badge>x</Badge>);
    const badge = screen.getByText('x');
    expect(badge).toHaveAttribute('data-tone', 'muted');
    expect(badge.querySelector('[data-slot="badge-dot"]')).toBeNull();
  });
});
