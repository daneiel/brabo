import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import i18n from '../../lib/i18n';
import { Canvas, CONTROLES, grafoDe } from './canvas';

await i18n.changeLanguage('pt-BR');

const modulos = [
  { name: 'api', stack: 'NestJS', dependsOn: ['db', 'fantasma'] },
  { name: 'db', stack: 'Postgres', dependsOn: [] },
];

describe('Canvas (AT-684)', () => {
  it('deriva nós e arestas do module_map, ignorando dependência inexistente', () => {
    const { nos, arestas } = grafoDe(modulos);
    expect(nos.map((n) => n.id)).toEqual(['api', 'db']);
    expect(arestas.map((a) => a.id)).toEqual(['api->db']);
    expect(nos[0]!.position.y).toBeGreaterThan(nos[1]!.position.y);
  });

  it('mostra texto no estado vazio', () => {
    render(<Canvas modulos={[]} />);
    expect(screen.getByText('Sem módulos para desenhar o grafo.')).toBeTruthy();
  });

  it('colore pelos tokens, nunca por hex', () => {
    const valores = [...Object.values(CONTROLES), ...grafoDe(modulos).nos.map((n) => n.style!.background as string)];
    for (const v of valores) expect(String(v)).toMatch(/^var\(--/);
  });
});
