import { useQuery } from '@tanstack/react-query';
import { getProject } from '../../lib/api-client';
import { useCurrentWorkspaceWithRole } from '../../lib/hooks';
import { CredentialSpendSection } from '../../components/CredentialSpendSection';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

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
  // `semMoldura` pelo mesmo motivo do catálogo: `CredentialSpendSection` traz
  // a própria moldura e é compartilhado com a aba Gastos. Sem papel de `owner`
  // a seção não monta, não se registra e some do sumário — o mapa nunca
  // oferece uma sala à qual esta pessoa não tem acesso (RN-060).
  return (
    <SecaoDeConfiguracoes chave="key-spend" semMoldura>
      <CredentialSpendSection workspaceId={project.workspaceId} />
    </SecaoDeConfiguracoes>
  );
}
