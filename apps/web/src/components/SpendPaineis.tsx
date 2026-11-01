import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import {
  getMyWorkspaceSpend,
  getProjectSpendTeam,
  getProjectsSummary,
  getWorkspaceSpendReport,
  listModelCatalog,
  listProjects,
} from '../lib/api-client';
import { FRESCOR_DA_CONFIGURACAO_MS } from '../lib/query-policy';
import { numberFmt } from '../lib/currency';
import { hashtagDaSessao } from '../lib/session-label';
import { rotuloDoAtor } from '../lib/spend';
import { JANELAS, comoRanking, rotuloDoProvider } from '../lib/spend-ranking';
import { Select } from './ui/Select';
import { Shimmer } from './ui/Shimmer';
import { GastoPorDia } from './GastoPorDia';
import { Destaque, Ranking } from './SpendCharts';
import { CredentialSpendSection, formatarUsd } from './CredentialSpendSection';
import styles from '../routes/ProjectSpendTab.module.css';

export function SeletorDeJanela({
  dias,
  onChange,
}: {
  dias: number;
  onChange: (dias: number) => void;
}) {
  const { t } = useTranslation('spend');
  return (
    <label className={styles.nota}>
      {t('window.label')}{' '}
      <Select value={dias} onChange={(e) => onChange(Number(e.target.value))}>
        {JANELAS.map((n) => (
          <option key={n} value={n}>
            {t('window.option', { n })}
          </option>
        ))}
      </Select>
    </label>
  );
}

/**
 * Modelos marcados `subscription` (nome → verdadeiro). Lê o catálogo do
 * workspace, que o owner já alcança; erro ou carga = sem marca, e a linha
 * volta ao US$ (nunca inventa "assinatura").
 */
function useModelosDeAssinatura(workspaceId: string | undefined) {
  const catalogo = useQuery({
    queryKey: ['model-catalog', workspaceId],
    queryFn: () => listModelCatalog(workspaceId!),
    enabled: Boolean(workspaceId),
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });
  const nomes = new Set<string>();
  for (const porProvider of Object.values(catalogo.data ?? {})) {
    for (const modelos of Object.values(porProvider)) {
      for (const m of modelos) if (m.billing === 'subscription') nomes.add(m.name);
    }
  }
  return nomes;
}

function Estado({
  q,
  carregando,
  erro,
}: {
  q: { isLoading: boolean; isError: boolean; refetch: () => unknown };
  carregando: string;
  erro: string;
}) {
  const { t } = useTranslation('spend');
  return (
    <>
      {q.isLoading && (
        <div className={styles.estado}>
          <Shimmer>{carregando}</Shimmer>
        </div>
      )}
      {q.isError && (
        <div className={styles.estadoErro} role="alert">
          <span>{erro}</span>
          <button type="button" className={styles.botao} onClick={() => void q.refetch()}>
            {t('shared.retry')}
          </button>
        </div>
      )}
    </>
  );
}

function DestaquesDoTotal({
  total,
  assinatura,
  chamadas,
  entrada,
  saida,
  rotuloTotal,
}: {
  total: number;
  assinatura?: number;
  chamadas: number;
  entrada: number;
  saida: number;
  rotuloTotal: string;
}) {
  const { t } = useTranslation('spend');
  return (
    <div className={styles.destaques}>
      <Destaque
        rotulo={rotuloTotal}
        valor={formatarUsd(total)}
        detalhe={t('workspace.callsDetail', {
          count: chamadas,
          n: numberFmt.format(chamadas),
        })}
      />
      <Destaque
        rotulo={t('workspace.tokensLabel')}
        valor={numberFmt.format(entrada + saida)}
        detalhe={t('shared.tokensDetail', {
          input: numberFmt.format(entrada),
          output: numberFmt.format(saida),
        })}
      />
      {(assinatura ?? 0) > 0 && (
        <Destaque
          rotulo={t('subscription.label')}
          valor={formatarUsd(assinatura!)}
          detalhe={t('subscription.detail')}
        />
      )}
    </div>
  );
}

/**
 * A audiência do OWNER. Sem `projectId` é o workspace inteiro (página global);
 * com ele, só aquele projeto (aba do projeto) e a quebra por sessão.
 */
export function GastoDoWorkspace({
  workspaceId,
  projectId,
}: {
  workspaceId: string | undefined;
  projectId?: string;
}) {
  const { t } = useTranslation('spend');
  const [dias, setDias] = useState<number>(30);
  const relatorio = useQuery({
    queryKey: projectId
      ? ['workspace-spend', workspaceId, dias, projectId]
      : ['workspace-spend', workspaceId, dias],
    queryFn: () => getWorkspaceSpendReport(workspaceId!, dias, projectId),
    enabled: Boolean(workspaceId),
  });
  const assinaturas = useModelosDeAssinatura(workspaceId);
  const r = relatorio.data;

  return (
    <>
      <header className={styles.cabecalho}>
        <h2 className={styles.titulo}>
          {projectId ? t('project.ownerTitle') : t('workspace.title')}
        </h2>
        <p className={styles.subtitulo}>
          {projectId ? (
            t('project.ownerSubtitle', { dias })
          ) : (
            <Trans
              i18nKey="workspace.subtitle"
              ns="spend"
              values={{ dias }}
              components={{ strong: <strong /> }}
            />
          )}
        </p>
        <SeletorDeJanela dias={dias} onChange={setDias} />
      </header>

      <Estado
        q={relatorio}
        carregando={t('shared.summing')}
        erro={t('workspace.error')}
      />

      {r && (
        <>
          <DestaquesDoTotal
            total={r.totalMicros}
            assinatura={r.assinaturaMicros}
            chamadas={r.chamadas}
            entrada={r.inputTokens}
            saida={r.outputTokens}
            rotuloTotal={t('workspace.totalLabel', { dias })}
          />
          <div className={styles.faixa}>
            <GastoPorDia serie={r.porDia} titulo={t('workspace.dailySpendTitle')} />
          </div>
          <div className={styles.grade}>
            <Ranking
              titulo={t('workspace.byModelTitle')}
              linhas={comoRanking(r.porModelo, (l) => l.chave, t, assinaturas)}
              vazio={t('workspace.byModelEmpty')}
            />
            <Ranking
              titulo={t('workspace.byProviderTitle')}
              linhas={comoRanking(r.porProvider, rotuloDoProvider, t)}
              vazio={t('workspace.byProviderEmpty')}
            />
            {projectId ? (
              <Ranking
                titulo={t('project.bySessionTitle')}
                linhas={comoRanking(
                  r.porSessao ?? [],
                  (l) => hashtagDaSessao(l.chave),
                  t,
                )}
                vazio={t('project.bySessionEmpty')}
              />
            ) : (
              <Ranking
                titulo={t('workspace.byProjectTitle')}
                linhas={comoRanking(r.porProjeto, (l) => l.rotulo ?? l.chave, t)}
                vazio={t('workspace.byProjectEmpty')}
              />
            )}
            <Ranking
              titulo={t('workspace.byActorTitle')}
              linhas={comoRanking(r.porAtor, rotuloDoAtor, t)}
              vazio={t('workspace.byActorEmpty')}
            />
          </div>
        </>
      )}

      {/* A pergunta da FATURA: por credencial, global e só do owner (RN-060). */}
      {!projectId && workspaceId && <CredentialSpendSection workspaceId={workspaceId} />}
    </>
  );
}

/** Orçamentos de todos os projetos — a leitura global do owner. */
export function OrcamentosDosProjetos({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation('spend');
  const resumo = useQuery({
    queryKey: ['projects-summary', workspaceId],
    queryFn: () => getProjectsSummary(workspaceId),
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });
  const projetos = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => listProjects(workspaceId),
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });
  const orcamentos = new Map(
    (resumo.data ?? []).map((s) => [s.projectId, s.budget] as const),
  );

  return (
    <section className={styles.grade} aria-label={t('global.budgetsTitle')}>
      <h3 className={styles.titulo}>{t('global.budgetsTitle')}</h3>
      {(resumo.isError || projetos.isError) && (
        <p className={styles.nota} role="alert">
          {t('global.budgetsError')}
        </p>
      )}
      {projetos.data?.length === 0 && <p className={styles.nota}>{t('global.budgetsEmpty')}</p>}
      <ul>
        {(projetos.data ?? []).map((p) => {
          const b = orcamentos.get(p.id);
          return (
            <li key={p.id}>
              <Link to="/projects/$projectId" params={{ projectId: p.id }} search={{ tab: 'spend' }}>
                {p.name}
              </Link>{' '}
              —{' '}
              {b
                ? t('global.budgetOf', {
                    gasto: formatarUsd(b.spentMicros),
                    limite: formatarUsd(b.limitMicros),
                  })
                : t('global.budgetNone')}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** O NÃO-owner na página global: o PRÓPRIO consumo, por projeto (RN-953). */
export function MeuConsumoNoWorkspace({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation('spend');
  const [dias, setDias] = useState<number>(30);
  const meu = useQuery({
    queryKey: ['workspace-spend', workspaceId, dias, 'me'],
    queryFn: () => getMyWorkspaceSpend(workspaceId, dias),
  });
  const d = meu.data;

  return (
    <>
      <header className={styles.cabecalho}>
        <h2 className={styles.titulo}>{t('global.memberTitle')}</h2>
        <p className={styles.subtitulo}>{t('global.memberSubtitle')}</p>
        <SeletorDeJanela dias={dias} onChange={setDias} />
      </header>
      <Estado q={meu} carregando={t('shared.summing')} erro={t('global.memberError')} />
      {d && (
        <>
          <DestaquesDoTotal
            total={d.totalMicros}
            assinatura={d.assinaturaMicros}
            chamadas={d.chamadas}
            entrada={d.inputTokens}
            saida={d.outputTokens}
            rotuloTotal={t('global.memberTotal', { dias })}
          />
          <div className={styles.faixa}>
            <GastoPorDia serie={d.porDia} titulo={t('global.memberDaily')} />
          </div>
          <Ranking
            titulo={t('global.memberByProject')}
            linhas={comoRanking(d.porProjeto, (l) => l.rotulo ?? l.chave, t)}
            vazio={t('global.memberByProjectEmpty')}
          />
        </>
      )}
    </>
  );
}

/**
 * O MEMBRO na aba do projeto: o total do projeto e o custo por agente e por
 * área (ADR 0233) — sem provider nem credencial. O consumo próprio vem logo
 * abaixo, no `MeuConsumo` da aba.
 */
export function GastoDoTimeNoProjeto({ projectId }: { projectId: string }) {
  const { t } = useTranslation('spend');
  const [dias, setDias] = useState<number>(30);
  const time = useQuery({
    queryKey: ['project-spend-team', projectId, dias],
    queryFn: () => getProjectSpendTeam(projectId, dias),
  });
  const d = time.data;

  return (
    <>
      <header className={styles.cabecalho}>
        <h2 className={styles.titulo}>{t('team.title')}</h2>
        <p className={styles.subtitulo}>{t('team.subtitle', { dias })}</p>
        <SeletorDeJanela dias={dias} onChange={setDias} />
      </header>
      <Estado q={time} carregando={t('shared.summing')} erro={t('team.error')} />
      {d && (
        <>
          <DestaquesDoTotal
            total={d.totalMicros}
            assinatura={d.assinaturaMicros}
            chamadas={d.chamadas}
            entrada={d.inputTokens}
            saida={d.outputTokens}
            rotuloTotal={t('team.totalLabel', { dias })}
          />
          <div className={styles.grade}>
            <Ranking
              titulo={t('team.byAgentTitle')}
              linhas={comoRanking(d.porAgente, (l) => l.chave, t)}
              vazio={t('team.byAgentEmpty')}
            />
            <Ranking
              titulo={t('team.byAreaTitle')}
              linhas={comoRanking(
                d.porArea,
                (l) => (l.chave === 'sem-area' ? t('team.noArea') : l.chave),
                t,
              )}
              vazio={t('team.byAreaEmpty')}
            />
          </div>
        </>
      )}
    </>
  );
}
