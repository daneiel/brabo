import { PrListAndDiff } from './PrListAndDiff';

/**
 * Painel de PRs dentro do painel inferior da aba Código (`CodeBottomPanel.tsx`,
 * aba "Diff de PR"). A lógica de verdade — filtro, lista, visualizador de
 * diff — foi EXTRAÍDA para `PrListAndDiff.tsx` (Onda 2 do programa de abas
 * agrupadas): a aba `prs` (project-wide, `ProjectPrsTab.tsx`) consome o
 * mesmo componente, com o botão de merge que este lugar não usa
 * (`renderItemExtra` fica ausente aqui, de propósito — o comportamento deste
 * painel não mudou).
 */
export function CodeDiffPanel({ projectId }: { projectId: string }) {
  return <PrListAndDiff projectId={projectId} />;
}
