/*
 * Preview do ProjectCardSkeleton — não recebe props: é a silhueta de UM card
 * de projeto, com as mesmas medidas do ProjectCard real. É o que o Dashboard
 * repete enquanto a lista carrega.
 */
import { ProjectCardSkeleton } from 'web';

/** Como o Dashboard usa: alguns em sequência, no lugar dos cards. */
export function CarregandoALista() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
      <ProjectCardSkeleton />
      <ProjectCardSkeleton />
    </div>
  );
}
