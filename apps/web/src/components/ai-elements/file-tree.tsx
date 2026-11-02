import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

/* File tree do AI Elements (AT-683): árvore ARIA com setas. As linhas são os botões [data-tree-row]. */
export function FileTree({ children, rotulo }: { children: ReactNode; rotulo: string }) {
  const ref = useRef<HTMLUListElement>(null);
  const ativa = useRef<HTMLElement | null>(null);
  // Roving tabindex: só uma linha entra na ordem de Tab; as setas movem o foco.
  useLayoutEffect(() => {
    const linhas = Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-tree-row]') ?? []);
    const alvo = linhas.find((l) => l === ativa.current) ?? linhas[0];
    for (const l of linhas) l.tabIndex = l === alvo ? 0 : -1;
  });
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
      ativa.current = destino;
    }
    e.preventDefault();
  }
  return (
    <ul
      ref={ref}
      role="tree"
      aria-label={rotulo}
      data-slot="ai-file-tree"
      onKeyDown={aoTeclar}
      onFocus={(e) => {
        const l = (e.target as HTMLElement).closest<HTMLElement>('[data-tree-row]');
        if (l) {
          ativa.current = l;
          ref.current?.querySelectorAll<HTMLElement>('[data-tree-row]').forEach((x) => (x.tabIndex = x === l ? 0 : -1));
        }
      }} className="m-0 list-none p-0">
      {children}
    </ul>
  );
}
