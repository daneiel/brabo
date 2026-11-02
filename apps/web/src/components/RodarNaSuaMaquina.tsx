import { useState } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getRunInstructions } from '../lib/api-client';
import { FRESCOR_DA_CONFIGURACAO_MS } from '../lib/query-policy';
import styles from './RodarNaSuaMaquina.module.css';

/** A `queryKey` do cartão; o aviso `infra.pr_opened` do canal a invalida. */
export const chaveDasInstrucoesDeExecucao = (projectId: string) =>
  ['run-instructions', projectId] as const;

/** RN-855: a PR de infra aberta traz o "como rodar" novo; relê o cartão. */
export function releSeInfraAbriuPr(queryClient: QueryClient, projectId: string, type: string): boolean {
  if (type !== 'infra.pr_opened') return false;
  void queryClient.invalidateQueries({ queryKey: chaveDasInstrucoesDeExecucao(projectId) });
  return true;
}

/** Só endereço local vira link: a api já recusa outro, e a tela não confia. */
export function urlLocalSegura(url: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1):\d+(\/|$)/.test(url);
}

/**
 * O cartão "Rodar na sua máquina" da Visão geral (RN-855, ADR 0213).
 *
 * Mostra o que a Infra DECLAROU na PR dela (`artifact.run_instructions`):
 * o comando, as URLs locais e a lembrança do `.env.example`. É declaração,
 * não verificação (RN-468) — nada aqui é verde nem diz "rodando". Sem
 * declaração (`null`) o cartão não aparece, como o de primeiros passos.
 */
export function RodarNaSuaMaquina({ projectId }: { projectId: string }) {
  const { t } = useTranslation('overview');
  const [copiado, setCopiado] = useState(false);
  const query = useQuery({
    queryKey: chaveDasInstrucoesDeExecucao(projectId),
    queryFn: () => getRunInstructions(projectId),
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });
  const run = query.data;
  if (!run) return null;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(run!.command);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <section className={styles.cartao} data-testid="rodar-na-sua-maquina" aria-label={t('rodarNaSuaMaquina.title')}>
      <h2 className={styles.titulo}>{t('rodarNaSuaMaquina.title')}</h2>
      {run.envExample && <p className={styles.texto}>{t('rodarNaSuaMaquina.envExample')}</p>}
      <div className={styles.comando}>
        <pre className={styles.codigo}>
          <code>{run.command}</code>
        </pre>
        <button type="button" className={styles.copiar} onClick={() => void copiar()}>
          {copiado ? t('rodarNaSuaMaquina.copiado') : t('rodarNaSuaMaquina.copiar')}
        </button>
      </div>
      <ul className={styles.urls}>
        {run.urls.map((u) => (
          <li key={u.url}>
            <span className={styles.rotulo}>{u.label}</span>{' '}
            {urlLocalSegura(u.url) ? (
              <a href={u.url} target="_blank" rel="noopener noreferrer" className={styles.link}>
                {u.url}
              </a>
            ) : (
              <span className={styles.recusada}>{t('rodarNaSuaMaquina.urlRecusada')}</span>
            )}
          </li>
        ))}
      </ul>
      <p className={styles.nota}>
        {t('rodarNaSuaMaquina.notaAntes')}{' '}
        <a href={run.prUrl} target="_blank" rel="noopener noreferrer" className={styles.link}>
          {t('rodarNaSuaMaquina.pr')}
        </a>
        {t('rodarNaSuaMaquina.notaDepois')}
      </p>
    </section>
  );
}
