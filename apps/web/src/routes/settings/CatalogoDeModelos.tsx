import { useQuery } from '@tanstack/react-query';
import { getProject } from '../../lib/api-client';
import { ModelCatalogSection } from '../../components/ModelCatalogSection';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

/**
 * O catálogo é global, mas a curadoria pende do workspace: é de lá que o
 * `RolesGuard` tira o papel (só `owner` ativa). Daí a busca do projeto só para
 * descobrir a que workspace ele pertence.
 */
export function CatalogoDeModelos({ projectId }: { projectId: string }) {
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  if (!project) return null;
  // `semMoldura`: `ModelCatalogSection` já desenha o próprio `.section`, e é
  // compartilhado com outras abas — a âncora do sumário tem de ficar aqui,
  // fora dele, para não cravar um `id` de Configurações num componente que
  // aparece em mais de um lugar.
  return (
    <SecaoDeConfiguracoes chave="model-catalog" semMoldura>
      <ModelCatalogSection workspaceId={project.workspaceId} />
    </SecaoDeConfiguracoes>
  );
}
