import { useQuery } from '@tanstack/react-query';
import {
  getMySpend,
  getProject,
  getWorkspaceSpendReport,
} from '../lib/api-client';
import { useCurrentWorkspaceWithRole } from '../lib/hooks';
import { hashtagDaSessao } from '../lib/session-label';
import { numberFmt } from '../lib/currency';
import { rotuloDoAtor, tokensDe, type SpendLinha } from '../lib/spend';
import {
  BarrasPorDia,
  Destaque,
  Ranking,
  type LinhaDeRanking,
} from '../components/SpendCharts';
import {
  CredentialSpendSection,
  formatarUsd,
} from '../components/CredentialSpendSection';
import styles from './ProjectSpendTab.module.css';

/** Janela do relatório. Um mês é o ciclo em que uma fatura de LLM fecha. */
const DIAS = 30;

/**
 * A aba de Gastos — o mesmo gasto, para duas audiências (FASE 22, ADR 0063).
 *
 * O que ela mostra depende de QUEM olha, e não é preferência de layout:
 *
 * - o **owner** vê a conta do workspace inteiro. Onde o dinheiro foi (modelo,
 *   projeto, ator, dia) e, na seção que já existia, de que CHAVE saiu — a
 *   pergunta da fatura, que a RN-060 reserva a ele;
 * - o **membro** vê o que ELE consumiu neste projeto, em tokens e custo
 *   estimado. Sem provider e sem credencial: a chave que roda é a do owner
 *   (RN-058), e uma fatia de fatura alheia não é o que ele está perguntando.
 *
 * As duas leituras convivem porque nunca respondem a mesma coisa. O owner vê
 * as duas por ser a única pessoa que pode ver as duas.
 */
export function ProjectSpendTab({ projectId }: { projectId: string }) {
  const papel = useCurrentWorkspaceWithRole();

  // Ramificar antes de o papel chegar não é só um piscar de tela: `comPapel`
  // indefinido cairia na visão do membro e DISPARARIA a requisição dela, para
  // depois trocar tudo. Enquanto o papel é desconhecido não há pergunta a
  // fazer — e os três estados valem aqui também (RN-088).
  return (
    <div className={styles.pagina}>
      {papel.isLoading && <div className={styles.estado}>Carregando…</div>}

      {papel.isError && (
        <div className={styles.estadoErro} role="alert">
          <span>
            Não consegui descobrir o seu papel neste workspace, e é ele que diz
            qual relatório mostrar.
          </span>
          <button
            type="button"
            className={styles.botao}
            onClick={() => papel.refetch()}
          >
            Tentar de novo
          </button>
        </div>
      )}

      {papel.data &&
        (papel.data.role === 'owner' ? (
          <GastoDoWorkspace projectId={projectId} />
        ) : (
          <MeuConsumo projectId={projectId} />
        ))}
    </div>
  );
}

/** A audiência do owner. */
function GastoDoWorkspace({ projectId }: { projectId: string }) {
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  const workspaceId = project?.workspaceId;

  const relatorio = useQuery({
    queryKey: ['workspace-spend', workspaceId, DIAS],
    queryFn: () => getWorkspaceSpendReport(workspaceId!, DIAS),
    enabled: Boolean(workspaceId),
  });

  return (
    <>
      <header className={styles.cabecalho}>
        <h2 className={styles.titulo}>Gastos do workspace</h2>
        <p className={styles.subtitulo}>
          Últimos {DIAS} dias. Onde o dinheiro foi — por modelo, por projeto,
          por agente e por pessoa. De qual <strong>chave</strong> ele saiu é a
          seção de baixo.
        </p>
      </header>

      {/* Os três estados, e o erro ANTES do vazio (RN-088). */}
      {relatorio.isLoading && <div className={styles.estado}>Somando…</div>}

      {relatorio.isError && (
        <div className={styles.estadoErro} role="alert">
          <span>
            Não consegui carregar o gasto agora. O consumo continua registrado —
            isto é só a leitura.
          </span>
          <button
            type="button"
            className={styles.botao}
            onClick={() => relatorio.refetch()}
          >
            Tentar de novo
          </button>
        </div>
      )}

      {relatorio.data && (
        <>
          <div className={styles.destaques}>
            <Destaque
              rotulo={`Total em ${DIAS} dias`}
              valor={formatarUsd(relatorio.data.totalMicros)}
              detalhe={`${numberFmt.format(relatorio.data.chamadas)} chamada(s)`}
            />
            <Destaque
              rotulo="Tokens"
              valor={numberFmt.format(
                relatorio.data.inputTokens + relatorio.data.outputTokens,
              )}
              detalhe={`${numberFmt.format(relatorio.data.inputTokens)} entrada · ${numberFmt.format(relatorio.data.outputTokens)} saída`}
            />
          </div>

          <div className={styles.faixa}>
            <BarrasPorDia
              serie={relatorio.data.porDia}
              titulo="Gasto por dia"
            />
          </div>

          <div className={styles.grade}>
            <Ranking
              titulo="Por modelo"
              linhas={comoRanking(relatorio.data.porModelo, (l) => l.chave)}
              vazio="Nenhuma chamada nesta janela."
            />
            <Ranking
              titulo="Por projeto"
              linhas={comoRanking(
                relatorio.data.porProjeto,
                (l) => l.rotulo ?? l.chave,
              )}
              vazio="Nenhum projeto gastou nesta janela."
            />
            <Ranking
              titulo="Por agente e pessoa"
              linhas={comoRanking(relatorio.data.porAtor, rotuloDoAtor)}
              vazio="Ninguém gastou nesta janela."
            />
          </div>
        </>
      )}

      {/* A pergunta da FATURA, que é outra: por credencial, e só do owner
          (RN-060). Reaproveitada inteira em vez de reescrita aqui. */}
      {project && <CredentialSpendSection workspaceId={project.workspaceId} />}
    </>
  );
}

/** A audiência do membro. */
function MeuConsumo({ projectId }: { projectId: string }) {
  const meu = useQuery({
    queryKey: ['my-spend', projectId, DIAS],
    queryFn: () => getMySpend(projectId, DIAS),
  });

  return (
    <>
      <header className={styles.cabecalho}>
        <h2 className={styles.titulo}>O meu consumo</h2>
        <p className={styles.subtitulo}>
          Últimos {DIAS} dias, só o que <strong>você</strong> consumiu neste
          projeto. O custo é <strong>estimado</strong>: quem paga a chamada é a
          chave do dono do workspace, e a fatura dela é dele.
        </p>
      </header>

      {meu.isLoading && <div className={styles.estado}>Somando…</div>}

      {meu.isError && (
        <div className={styles.estadoErro} role="alert">
          <span>
            Não consegui carregar o seu consumo agora. O registro continua lá —
            isto é só a leitura.
          </span>
          <button
            type="button"
            className={styles.botao}
            onClick={() => meu.refetch()}
          >
            Tentar de novo
          </button>
        </div>
      )}

      {meu.data && (
        <>
          <div className={styles.destaques}>
            <Destaque
              rotulo={`Estimado em ${DIAS} dias`}
              valor={formatarUsd(meu.data.totalMicros)}
              detalhe={`${numberFmt.format(meu.data.chamadas)} chamada(s) suas`}
            />
            <Destaque
              rotulo="Tokens seus"
              valor={numberFmt.format(
                meu.data.inputTokens + meu.data.outputTokens,
              )}
              detalhe={`${numberFmt.format(meu.data.inputTokens)} entrada · ${numberFmt.format(meu.data.outputTokens)} saída`}
            />
          </div>

          <div className={styles.faixa}>
            <BarrasPorDia serie={meu.data.porDia} titulo="Seu gasto por dia" />
          </div>

          <Ranking
            titulo="Por sessão"
            linhas={comoRanking(meu.data.porSessao, (l) =>
              hashtagDaSessao(l.chave),
            )}
            vazio="Você não gastou nada neste projeto nos últimos 30 dias. O que os agentes gastam sai da chave do dono do workspace, e aparece no relatório dele."
          />

          <p className={styles.nota}>
            Aqui não há quebra por provider nem por credencial — é a conta de
            outra pessoa, e a pergunta desta tela é o seu consumo.
          </p>
        </>
      )}
    </>
  );
}

function comoRanking(
  linhas: SpendLinha[],
  rotulo: (linha: SpendLinha) => string,
): LinhaDeRanking[] {
  return linhas.map((linha) => ({
    chave: linha.chave,
    rotulo: rotulo(linha),
    costMicros: linha.costMicros,
    detalhe: `${numberFmt.format(tokensDe(linha))} tok · ${linha.chamadas}×`,
  }));
}
