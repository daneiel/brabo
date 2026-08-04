/*
 * Previews do Skeleton. As medidas saem do uso real em ProjectCard.tsx
 * (avatar 34×34 com radius 8, título 70%, subtítulo 40%) e Dashboard.tsx.
 */
import { Skeleton } from 'web';

/** As três formas que a app usa: bloco, linha de texto e quadrado com radius. */
export function Formas() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 320 }}>
      <Skeleton width={220} height={13} />
      <Skeleton width="70%" height={15} />
      <Skeleton width="40%" height={11} />
      <Skeleton width={34} height={34} radius={8} />
    </div>
  );
}

/**
 * O ponto do Skeleton é reservar a MEDIDA do conteúdo que vem, para a lista
 * não pular quando os dados chegam. Aqui, a silhueta de um cabeçalho de card.
 */
export function SilhuetaDeCard() {
  return (
    <div style={{ display: 'flex', gap: 11, alignItems: 'center', maxWidth: 320 }}>
      <Skeleton width={34} height={34} radius={8} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <Skeleton width="70%" height={15} />
        <Skeleton width="40%" height={11} />
      </div>
    </div>
  );
}
