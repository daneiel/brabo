import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FileTree } from './file-tree';

function Arvore() {
  return (
    <FileTree rotulo="Arquivos">
      <li role="none"><button type="button" role="treeitem" data-tree-row="" aria-expanded="false" onClick={(e) => e.currentTarget.setAttribute('aria-expanded', 'true')}>pasta</button></li>
      <li role="none"><button type="button" role="treeitem" data-tree-row="" aria-selected="false">a.ts</button></li>
    </FileTree>
  );
}

describe('FileTree (AT-683)', () => {
  it('tabindex móvel: só uma linha é tab stop e as setas movem o foco', () => {
    render(<Arvore />);
    const [pasta, arq] = screen.getAllByRole('treeitem');
    expect([pasta.tabIndex, arq.tabIndex]).toEqual([0, -1]);
    pasta.focus();
    fireEvent.keyDown(pasta, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(arq);
    expect([pasta.tabIndex, arq.tabIndex]).toEqual([-1, 0]);
    fireEvent.keyDown(arq, { key: 'Home' });
    expect(document.activeElement).toBe(pasta);
  });

  it('seta à direita expande a pasta; fim da lista não move o foco', () => {
    render(<Arvore />);
    const [pasta, arq] = screen.getAllByRole('treeitem');
    pasta.focus();
    fireEvent.keyDown(pasta, { key: 'ArrowRight' });
    expect(pasta).toHaveAttribute('aria-expanded', 'true');
    arq.focus();
    fireEvent.keyDown(arq, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(arq);
  });
});
