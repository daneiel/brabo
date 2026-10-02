import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { listCredentials } from '../lib/api-client';
import { useBindingsResolvidos } from '../lib/bindings-resolvidos';
import { derivarPrimeirosPassos, type ChaveDoPasso } from '../lib/primeiros-passos';
import { FRESCOR_DA_CONFIGURACAO_MS } from '../lib/query-policy';
import styles from './PrimeirosPassos.module.css';

/**
 * O cartão de primeiros passos da Visão geral (RN-708, AT-372).
 *
 * Diz o que falta para o projeto novo andar — credencial de LLM, modelo
 * aplicado ao time, primeira ideação —, cada passo com o link para o lugar
 * exato onde se faz. Some quando os três estão feitos.
 *
 * As leituras são as que já existiam: `['credentials']` (a da seção de
 * Credenciais, configuração: frescor de um minuto, sem poll — RN-645), o lote
 * de bindings resolvidos (RN-654, a mesma `queryKey` de Configurações) e a
 * lista de sessões que a página já polla (`temSessao`, vindo de quem chama).
 */
export function PrimeirosPassos({
  projectId,
  temSessao,
}: {
  projectId: string;
  /** `undefined` enquanto a lista de sessões não chegou. */
  temSessao: boolean | undefined;
}) {
  const { t } = useTranslation('overview');
  const credenciais = useQuery({
    queryKey: ['credentials'],
    queryFn: listCredentials,
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });
  const bindings = useBindingsResolvidos(projectId);
  const doCriativo = bindings.doAgente('criativo');

  const passos = derivarPrimeirosPassos({
    credenciais: credenciais.data?.length,
    timeComModelo: doCriativo === undefined ? undefined : doCriativo !== null,
    temSessao,
  });
  if (!passos) return null;

  const destino: Record<ChaveDoPasso, { tab: 'settings' | 'criativo'; section?: 'credentials' | 'model-catalog' }> = {
    credencial: { tab: 'settings', section: 'credentials' },
    modelo: { tab: 'settings', section: 'model-catalog' },
    ideacao: { tab: 'criativo' },
  };
  const feitos = passos.filter((p) => p.feito).length;

  return (
    <section className={styles.cartao} data-testid="primeiros-passos" aria-label={t('primeirosPassos.title')}>
      <div className={styles.cabecalho}>
        <h2 className={styles.titulo}>{t('primeirosPassos.title')}</h2>
        <span className={styles.contagem}>
          {t('primeirosPassos.progresso', { feitos, total: passos.length })}
        </span>
      </div>
      <ol className={styles.lista}>
        {passos.map((passo) => (
          <li
            key={passo.chave}
            className={[styles.passo, passo.feito && styles.feito].filter(Boolean).join(' ')}
            data-passo={passo.chave}
            data-feito={passo.feito ? 'sim' : 'nao'}
          >
            <span className={styles.marca} aria-hidden="true">
              {passo.feito ? '✓' : '○'}
            </span>
            <span className={styles.texto}>
              <span className={styles.nome}>{t(`primeirosPassos.${passo.chave}.titulo`)}</span>
              <span className={styles.estado}>
                {passo.feito ? t('primeirosPassos.feito') : t(`primeirosPassos.${passo.chave}.pendente`)}
              </span>
            </span>
            {!passo.feito && (
              <Link
                to="/projects/$projectId"
                params={{ projectId }}
                search={destino[passo.chave]}
                className={styles.link}
              >
                {t(`primeirosPassos.${passo.chave}.link`)}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
