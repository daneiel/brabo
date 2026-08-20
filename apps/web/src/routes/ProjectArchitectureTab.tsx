import { useArchitecture } from '../lib/hooks';
import { C4DiagramView } from '../components/C4DiagramView';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import type { Architecture } from '../lib/api-types';
// Mesmo módulo de estilo da Visão geral, de propósito (mesmo padrão de
// `ProjectInsightsTab.tsx`, achado #15): a seção saiu de lá inteira e
// precisa continuar IDÊNTICA visualmente. Duplicar as classes só para ter
// arquivo de CSS próprio abriria a porta para as duas versões divergirem.
import styles from './ProjectOverviewTab.module.css';

/**
 * Aba Arquitetura (PROGRAMA de abas agrupadas — Onda 3): module_map, o
 * diagrama C4 (Context + Container) e os ADRs do Arquiteto, com as
 * pendências de validação cruzada entre história e módulo.
 *
 * Morava dentro da Visão geral (`ArchitectureSection`, achado real: não
 * havia lugar próprio para gerir arquitetura visualmente nem forma de
 * ampliar o diagrama). A extração é 1:1 — mesmo hook (`useArchitecture`),
 * mesmo `C4DiagramView`, nenhuma lógica de dado nova. O que ganhou aqui foi
 * lugar próprio (a Visão geral passou a mostrar um resumo condensado com
 * link "Ver arquitetura completa") e o lightbox de ampliar diagrama
 * (`C4DiagramView.tsx`/`Modal.tsx`).
 */
export function ProjectArchitectureTab({ projectId }: { projectId: string }) {
  const { data: architecture } = useArchitecture(projectId);
  return <ArchitectureContent architecture={architecture} />;
}

const ADR_TONE: Record<string, BadgeTone> = {
  pending: 'warning',
  approved: 'accent',
  executed: 'success',
  failed: 'danger',
  denied: 'muted',
};

function ArchitectureContent({ architecture }: { architecture?: Architecture }) {
  const moduleMap = architecture?.moduleMap;
  const adrs = architecture?.adrs ?? [];
  const pendencies = architecture?.pendencies ?? [];
  const c4Diagram = architecture?.c4Diagram;

  const isEmpty = !moduleMap && adrs.length === 0 && pendencies.length === 0;

  return (
    <div className={styles.arch}>
      <div className={styles.sectionHeader}>Arquitetura</div>
      {isEmpty ? (
        <div className={styles.sectionSub}>
          Sem arquitetura ainda — o Arquiteto gera o module_map e os ADRs.
        </div>
      ) : (
        <>
          <div className={styles.archLabel}>
            Módulos {moduleMap ? `· v${moduleMap.version}` : ''}
          </div>
          {!moduleMap || moduleMap.modules.length === 0 ? (
            <div className={styles.sectionSub}>Nenhum módulo ainda.</div>
          ) : (
            <div className={styles.moduleGrid}>
              {moduleMap.modules.map((m) => (
                <div key={m.name} className={styles.moduleCard}>
                  <div className={styles.moduleName}>{m.name}</div>
                  <div className={styles.moduleStack}>{m.stack}</div>
                  <div className={styles.moduleResp}>{m.responsibility}</div>
                  {m.dependsOn.length > 0 && (
                    <div className={styles.deps}>
                      {m.dependsOn.map((d) => (
                        <span key={d} className={styles.depChip}>
                          {d}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className={styles.archLabel}>
            Diagrama C4 {c4Diagram?.status === 'gerado' ? `· v${c4Diagram.version}` : ''}
          </div>
          {c4Diagram?.status === 'gerado' && c4Diagram.diagrama ? (
            <C4DiagramView diagrama={c4Diagram.diagrama} />
          ) : (
            <div className={styles.sectionSub}>
              Sem diagrama ainda — o Arquiteto gera o Context + Container a partir do
              module_map (create_c4_diagram).
            </div>
          )}

          <div className={styles.archLabel}>ADRs</div>
          {adrs.length === 0 ? (
            <div className={styles.sectionSub}>Nenhum ADR proposto ainda.</div>
          ) : (
            <ul className={styles.adrList}>
              {adrs.map((adr) => (
                <li key={adr.actionId} className={styles.adrItem}>
                  <Badge tone={ADR_TONE[adr.status] ?? 'muted'}>{adr.status}</Badge>
                  {adr.pullRequestUrl ? (
                    <a
                      href={adr.pullRequestUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.adrLink}
                    >
                      {adr.title}
                    </a>
                  ) : (
                    <span>{adr.title}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {pendencies.length > 0 && (
            <>
              <div className={styles.archLabel}>
                Pendências de validação cruzada
                <Badge tone="danger">{pendencies.length}</Badge>
              </div>
              <ul className={styles.pendList}>
                {pendencies.map((p) => (
                  <li key={p.storyId} className={styles.pendItem}>
                    <span className={styles.pendTitle}>{p.title}</span>
                    <span className={styles.pendReason}>
                      {p.reason === 'no_module'
                        ? 'sem módulo vinculado'
                        : `módulo inexistente: ${p.missing.join(', ')}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
