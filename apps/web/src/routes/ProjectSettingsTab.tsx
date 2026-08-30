/**
 * A aba Configurações — ENTRADA e BARREL das 17 seções (ADR 0125).
 *
 * As seções moram uma por arquivo em `./settings/`. Este arquivo continua
 * existindo neste CAMINHO, com os mesmos 11 nomes exportados, porque o caminho
 * e os nomes são contrato de teste: `ProjectSettingsTab.test.tsx` importa os 11
 * nomes daqui, e `ProjectPage.test.tsx`/`project-tabs.test.tsx` fazem
 * `vi.mock('./ProjectSettingsTab', …)` DO CAMINHO. Mover o arquivo ou renomear
 * um export quebraria os três sem que nada no produto tivesse mudado.
 *
 * O componente não guarda NADA de DADO — sem query, sem `t`, sem checagem de
 * papel. Cada seção recebe no máximo `projectId` e chama os próprios hooks; a
 * duplicação de `useQuery({queryKey: ['project', projectId]})`,
 * `useTranslation('settings')` e afins entre seções é DELIBERADA e o
 * react-query a deduplica em runtime. Não a "otimize" para um pai comum ou um
 * context: isso seria mudança de comportamento vestida de limpeza.
 *
 * O que ele passou a guardar é NAVEGAÇÃO, e só ela: `ProvedorDoSumario` mantém
 * quais seções estão montadas, qual está vigente na rolagem e como chegar a
 * uma delas. É o oposto do caso acima — a pergunta "que seções existem agora?"
 * não é respondível de dentro de nenhuma seção, e sete das 17 renderizam
 * `null` em condição normal. A ordem de render abaixo é a MESMA de
 * `settings/sumario.ts`, e as duas não podem divergir: é ela que decide qual
 * entrada o sumário marca enquanto o leitor rola.
 */
import { RepositorySection } from './settings/RepositorySection';
import { ExecutionSection } from './settings/ExecutionSection';
import { ExecutionModeSection } from './settings/ExecutionModeSection';
import { ParallelismSection } from './settings/ParallelismSection';
import { BudgetSection } from './settings/BudgetSection';
import { PromotionSection } from './settings/PromotionSection';
import { MelhoresModelosPorCapacidadeSection } from './settings/MelhoresModelosPorCapacidadeSection';
import { ModelsSection } from './settings/ModelsSection';
import { AreaModelsSection } from './settings/AreaModelsSection';
import { CatalogoDeModelos } from './settings/CatalogoDeModelos';
import { MembersSection } from './settings/MembersSection';
import { PersonalAccessTokensSection } from './settings/PersonalAccessTokensSection';
import { ProficiencySection } from './settings/ProficiencySection';
import { InstructionVersionsSection } from './settings/InstructionVersionsSection';
import { MatrixSection } from './settings/MatrixSection';
import { CredentialsSection } from './settings/CredentialsSection';
import { GastoDasChaves } from './settings/GastoDasChaves';
import { ProvedorDoSumario } from './settings/SecaoDeConfiguracoes';
import { SumarioDeConfiguracoes } from './settings/SumarioDeConfiguracoes';
import styles from './settings/sumario.module.css';

// Os 11 nomes que a aba já exportava antes da divisão — a superfície pública
// não muda com o move. As outras 6 seções continuam sem reexport aqui: são
// exportadas pelo próprio arquivo só porque o barrel precisa compô-las.
export { ExecutionSection } from './settings/ExecutionSection';
export { ExecutionModeSection } from './settings/ExecutionModeSection';
export { ParallelismSection } from './settings/ParallelismSection';
export { BudgetSection } from './settings/BudgetSection';
export { PromotionSection } from './settings/PromotionSection';
export { MelhoresModelosPorCapacidadeSection } from './settings/MelhoresModelosPorCapacidadeSection';
export { ModelsSection } from './settings/ModelsSection';
export { AreaModelsSection } from './settings/AreaModelsSection';
export { PersonalAccessTokensSection } from './settings/PersonalAccessTokensSection';
export { ProficiencySection } from './settings/ProficiencySection';
export { CredentialsSection } from './settings/CredentialsSection';

interface ProjectSettingsTabProps {
  projectId: string;
}

export function ProjectSettingsTab({ projectId }: ProjectSettingsTabProps) {
  return (
    <ProvedorDoSumario>
      <div className={styles.layout}>
        <SumarioDeConfiguracoes />

        <div className={styles.secoes}>
          <RepositorySection projectId={projectId} />
          <ExecutionSection projectId={projectId} />
          <ExecutionModeSection projectId={projectId} />
          <ParallelismSection projectId={projectId} />
          <BudgetSection projectId={projectId} />
          <PromotionSection projectId={projectId} />
          <MelhoresModelosPorCapacidadeSection projectId={projectId} />
          <ModelsSection projectId={projectId} />
          <AreaModelsSection projectId={projectId} />
          <CatalogoDeModelos projectId={projectId} />
          <MembersSection projectId={projectId} />
          <PersonalAccessTokensSection projectId={projectId} />
          <ProficiencySection projectId={projectId} />
          <InstructionVersionsSection projectId={projectId} />
          <MatrixSection />
          <CredentialsSection />
          <GastoDasChaves projectId={projectId} />
        </div>
      </div>
    </ProvedorDoSumario>
  );
}
