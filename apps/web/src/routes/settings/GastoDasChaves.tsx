import { useQuery } from '@tanstack/react-query';
import { getProject } from '../../lib/api-client';
import { useCurrentWorkspaceWithRole } from '../../lib/hooks';
import { CredentialSpendSection } from '../../components/CredentialSpendSection';

/**
 * O relatório de gasto das chaves — só para o OWNER (RN-060).
 *
 * A rota exige `owner` no workspace. A tela não a chama sem o papel: pedir um
 * 403 de propósito enche o log de segurança de ruído e deixa a seção piscando
 * um erro para quem simplesmente não é o dono.
 */
export function GastoDasChaves({ projectId }: { projectId: string }) {
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  const { data: comPapel } = useCurrentWorkspaceWithRole();

  if (!project || comPapel?.role !== 'owner') return null;
  return <CredentialSpendSection workspaceId={project.workspaceId} />;
}
