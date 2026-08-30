import { useQuery } from '@tanstack/react-query';
import { getProject } from '../../lib/api-client';
import { ModelCatalogSection } from '../../components/ModelCatalogSection';

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
  return <ModelCatalogSection workspaceId={project.workspaceId} />;
}
