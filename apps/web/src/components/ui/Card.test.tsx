import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './Card';
import styles from './Card.module.css';

describe('Card (AT-286)', () => {
  it('nasce com a superfície do design system, raio lg e padding md', () => {
    render(<Card>conteúdo</Card>);
    const card = screen.getByText('conteúdo');
    expect(card.tagName).toBe('DIV');
    expect(card).toHaveClass(styles.card, styles.padMd);
    expect(card).not.toHaveClass(styles.radiusMd);
    expect(card).not.toHaveClass(styles.recorta);
  });

  it('aplica as variantes e mantém className e style de quem posiciona', () => {
    render(
      <Card
        padding="none"
        radius="md"
        recorta
        className="externa"
        style={{ ['--msg-color' as string]: 'red' }}
        data-testid="c"
      >
        x
      </Card>,
    );
    const card = screen.getByTestId('c');
    expect(card).toHaveClass(styles.card, styles.padNone, styles.radiusMd, styles.recorta, 'externa');
    expect(card).not.toHaveClass(styles.padMd);
    expect(card.style.getPropertyValue('--msg-color')).toBe('red');
  });

  it('não é interativo: sem papel nem foco próprio', () => {
    render(<Card>y</Card>);
    const card = screen.getByText('y');
    expect(card).not.toHaveAttribute('role');
    expect(card).not.toHaveAttribute('tabindex');
  });
});
