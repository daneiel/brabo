import type { KeyboardEvent, ReactNode } from 'react';

/* File tree do AI Elements (AT-683): árvore ARIA com setas. As linhas são os botões [data-tree-row]. */
export function FileTree({ children, rotulo }: { children: ReactNode; rotulo: string }) {
  function aoTeclar(e: KeyboardEvent<HTMLUListElement>) {
    const linhas = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-tree-row]'));
    const i = linhas.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const atual = linhas[i];
    const aberto = atual.getAttribute('aria-expanded');
    if (e.key === 'ArrowRight' && aberto === 'false') atual.click();
    else if (e.key === 'ArrowLeft' && aberto === 'true') atual.click();
    else {
      const destino =
        e.key === 'ArrowDown' ? linhas[i + 1]
        : e.key === 'ArrowUp' ? linhas[i - 1]
        : e.key === 'Home' ? linhas[0]
        : e.key === 'End' ? linhas[linhas.length - 1]
        : undefined;
      if (!destino) return;
      destino.focus();
    }
    e.preventDefault();
  }
  return (
    <ul role="tree" aria-label={rotulo} data-slot="ai-file-tree" onKeyDown={aoTeclar} className="m-0 list-none p-0">
      {children}
    </ul>
  );
}
