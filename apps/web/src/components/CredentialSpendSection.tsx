import { useQuery } from '@tanstack/react-query';
import { getCredentialSpend } from '../lib/api-client';
import { ROTULO_DO_PROVIDER } from '../lib/models';
import type { LLMProviderName } from '../lib/api-types';
import { Badge } from './ui/Badge';
import styles from './CredentialSpendSection.module.css';

/**
 * Quanto as chaves do OWNER gastaram (RN-060).
 *
 * Existe porque a RN-058 mudou de quem é a conta: os agentes de todos os
 * projetos gastam a credencial do dono do workspace. Quem paga precisa ver o
 * que saiu — por provider, que é a unidade da chave, e separando AGENTE de
 * pessoa, porque as duas coisas saem da mesma credencial e respondem perguntas
 * diferentes.
 *
 * Só o owner monta este componente: a rota exige `owner` e pedir um 403 de
 * propósito seria ruído no log de segurança.
 */
export function CredentialSpendSection({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['credential-spend', workspaceId],
    queryFn: () => getCredentialSpend(workspaceId),
  });

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <div className={styles.tituloLinha}>
          <h2 className={styles.title}>Gasto das suas chaves</h2>
          <span className={styles.eyebrow}>só você vê</span>
        </div>
        <div className={styles.subtitle}>
          Os agentes de todos os projetos deste workspace gastam as{' '}
          <strong>suas</strong> credenciais. Aqui está o que saiu de cada uma,
          por mês.
        </div>
      </div>

      {isLoading && <div className={styles.vazio}>Somando…</div>}

      {isError && (
        <div className={styles.vazio}>
          Não consegui carregar o gasto agora. O consumo continua registrado —
          isto é só a leitura.
        </div>
      )}

      {data && data.porProvider.length === 0 && (
        <div className={styles.vazio}>
          Nenhuma chamada de LLM registrada nos últimos {data.meses} meses.
        </div>
      )}

      {data && data.porProvider.length > 0 && (
        <>
          <div className={styles.total}>
            <span className={styles.totalRotulo}>
              Total nos últimos {data.meses} meses
            </span>
            <span className={styles.totalValor}>
              {formatarUsd(data.totalMicros)}
            </span>
          </div>

          <div className={styles.tabela}>
            <div className={styles.cabecalho}>
              <span>PROVIDER</span>
              <span>AGENTES</span>
              <span>VOCÊ NO CHAT</span>
              <span>CHAMADAS</span>
              <span className={styles.direita}>TOTAL</span>
            </div>

            {data.porProvider.map((p) => (
              <div key={p.provider} className={styles.linha}>
                <span className={styles.provider}>
                  {ROTULO_DO_PROVIDER[p.provider as LLMProviderName] ??
                    p.provider}
                  {/* Chave removida cujo gasto continua no histórico: o
                      consumo aconteceu, e some-lo daria um total que não bate
                      com fatura nenhuma. */}
                  {!p.temCredencial && (
                    <Badge tone="muted">chave não cadastrada</Badge>
                  )}
                </span>
                <span className={styles.numero}>
                  {formatarUsd(p.costMicrosAgentes)}
                </span>
                <span className={styles.numero}>
                  {formatarUsd(p.costMicrosPessoas)}
                </span>
                <span className={styles.numero}>{p.chamadas}</span>
                <span className={[styles.numero, styles.direita].join(' ')}>
                  {formatarUsd(p.costMicros)}
                </span>
              </div>
            ))}
          </div>

          <div className={styles.meses}>
            {data.porProvider.map((p) =>
              p.porMes.map((m) => (
                <div key={`${p.provider}-${m.mes}`} className={styles.mesLinha}>
                  <span className={styles.mesRotulo}>
                    {formatarMes(m.mes)} ·{' '}
                    {ROTULO_DO_PROVIDER[p.provider as LLMProviderName] ??
                      p.provider}
                  </span>
                  <span className={styles.mesValor}>
                    {formatarUsd(m.costMicros)}{' '}
                    <span className={styles.mesChamadas}>
                      ({m.chamadas} chamada{m.chamadas === 1 ? '' : 's'})
                    </span>
                  </span>
                </div>
              )),
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Abaixo de um centavo NÃO vira `US$ 0,00`: a diferença entre "não gastou" e
 * "gastou pouco" é justamente o que este relatório existe para mostrar.
 */
export function formatarUsd(micros: number): string {
  if (micros === 0) return 'US$ 0,00';
  const usd = micros / 1_000_000;
  if (usd < 0.01) return '< US$ 0,01';
  return `US$ ${usd.toFixed(2).replace('.', ',')}`;
}

export function formatarMes(iso: string): string {
  // `timeZone: 'UTC'` não é detalhe: o bucket vem de `date_trunc('month', …)`
  // em UTC, e renderizar em America/Sao_Paulo (UTC-3) joga 1º de agosto às
  // 00:00Z para 31 de julho — o relatório mostrava o mês ERRADO, sempre o
  // anterior, para todo mundo a oeste de Greenwich.
  return new Date(iso).toLocaleDateString('pt-BR', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
