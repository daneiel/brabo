import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  getRedeDoContainer,
  mensagemDaApi,
  proposeAction,
  putRedeDoContainer,
} from '../lib/api-client';
import { userIdDaSessao } from '../lib/auth';
import { useLatestSession } from '../lib/hooks';
import { FRESCOR_DA_CONFIGURACAO_MS } from '../lib/query-policy';
import { roleAtLeast } from '../lib/roles';
import { textoDaRede, validarRedeEmTexto, type RedeEmTexto } from '../lib/rede-do-container';
import type { ContainerOverviewItem, Role } from '../lib/api-types';
import { Button } from './ui/Button';
import { Textarea } from './ui/Textarea';
import { useToast } from './ui/ToastProvider';
import styles from '../routes/ContainersPage.module.css';

const chaveDaRede = (projectId: string) => ['container-network', projectId] as const;

/** Rede declarada do container (AT-608, RN-932/934/935): leitura, edição (`maintainer`) e recriação. */
export function RedeDoContainer({
  item,
  papel,
}: {
  item: ContainerOverviewItem;
  papel: Role | undefined;
}) {
  const { t } = useTranslation('containers');
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { latest: sessao } = useLatestSession(item.projectId, false);
  const rede = useQuery({
    queryKey: chaveDaRede(item.projectId),
    queryFn: () => getRedeDoContainer(item.projectId),
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });
  const [texto, setTexto] = useState<RedeEmTexto>({ ports: '', dns: '', extraHosts: '' });
  const [sujo, setSujo] = useState(false);
  const [recusa, setRecusa] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [propondo, setPropondo] = useState(false);

  useEffect(() => {
    if (rede.data !== undefined && !sujo) setTexto(textoDaRede(rede.data));
  }, [rede.data, sujo]);

  const podeEditar = roleAtLeast(papel, 'maintainer');
  const editar = (campo: keyof RedeEmTexto, valor: string) => {
    setTexto((x) => ({ ...x, [campo]: valor }));
    setSujo(true);
    setRecusa(null);
  };

  async function salvar() {
    const v = validarRedeEmTexto(texto);
    if (!v.ok) {
      setRecusa(`${v.campo}: ${t(`rede.erro.${v.motivo}`)}`);
      return;
    }
    setSalvando(true);
    try {
      const nova = await putRedeDoContainer(item.projectId, v.rede);
      queryClient.setQueryData(chaveDaRede(item.projectId), nova);
      setSujo(false);
      setRecusa(null);
    } catch (e) {
      const corpo = e instanceof ApiError ? (e.body as { code?: string; campo?: string } | null) : null;
      if (corpo?.code === 'rede_invalida') {
        setRecusa(`${corpo.campo ?? ''}: ${mensagemDaApi(e)}`);
      } else if (corpo?.code === 'sem_sessao') {
        setRecusa(t('rede.semSessao'));
      } else {
        setRecusa(mensagemDaApi(e));
      }
    } finally {
      setSalvando(false);
    }
  }

  const status = item.registrado?.status ?? null;
  const motivoDaRecriacao = !podeEditar
    ? 'papel'
    : item.executionMode === 'runner'
      ? 'runner'
      : status === null || status === 'removed'
        ? 'semContainer'
        : !sessao
          ? 'semSessao'
          : sujo
            ? 'naoSalva'
            : null;

  async function recriar() {
    if (!sessao) return;
    setPropondo(true);
    try {
      await proposeAction(item.projectId, sessao.id, {
        actionType: 'container_recreate',
        actor: { kind: 'user', id: userIdDaSessao() ?? 'usuário' },
        payload: {},
      });
      queryClient.invalidateQueries({ queryKey: ['containers-overview'] });
    } catch (e) {
      showToast({ title: t('actions.errorTitle'), message: mensagemDaApi(e), tone: 'danger' });
    } finally {
      setPropondo(false);
    }
  }

  const publicadas = item.observado?.portasPublicadas ?? [];

  return (
    <section aria-label={t('rede.titulo')} data-testid="rede-do-container">
      <h2 className={styles.subtitle}>{t('rede.titulo')}</h2>
      {rede.isPending && <p className={styles.loading}>{t('loading')}</p>}
      {rede.isError && <p className={styles.motivo}>{mensagemDaApi(rede.error)}</p>}
      {rede.data === null && !sujo && <p className={styles.semRegistro}>{t('rede.nenhuma')}</p>}
      {rede.data && <p className={styles.motivo}>{t('rede.versao', { version: rede.data.version })}</p>}
      {!rede.isPending && !rede.isError && (
        <>
          <Textarea
            label={t('rede.portas')}
            hint={t('rede.portasDica')}
            value={texto.ports}
            disabled={!podeEditar}
            onChange={(e) => editar('ports', e.target.value)}
          />
          <Textarea
            label={t('rede.dns')}
            value={texto.dns}
            disabled={!podeEditar}
            onChange={(e) => editar('dns', e.target.value)}
          />
          <Textarea
            label={t('rede.hosts')}
            hint={t('rede.hostsDica')}
            value={texto.extraHosts}
            disabled={!podeEditar}
            onChange={(e) => editar('extraHosts', e.target.value)}
          />
          <p className={styles.motivo}>{t('rede.loopback')}</p>
          <p className={styles.motivo}>{t('rede.soVale')}</p>
          {!podeEditar && <p className={styles.motivo}>{t('rede.semPapel')}</p>}
          {recusa && (
            <p role="alert" className={styles.motivo}>
              {recusa}
            </p>
          )}
          <div className={styles.acoes}>
            <Button
              variant="secondary"
              disabled={!podeEditar || !sujo}
              loading={salvando}
              onClick={() => void salvar()}
            >
              {t('rede.salvar')}
            </Button>
            <Button
              variant="danger"
              disabled={motivoDaRecriacao !== null}
              loading={propondo}
              onClick={() => void recriar()}
            >
              {t('rede.recriar')}
            </Button>
          </div>
          <p className={styles.motivo}>{t('rede.recriarAviso')}</p>
          {motivoDaRecriacao && motivoDaRecriacao !== 'papel' && (
            <p className={styles.motivo}>{t(`rede.recriarBloqueio.${motivoDaRecriacao}`)}</p>
          )}
        </>
      )}
      {publicadas.length > 0 && (
        <>
          <h3 className={styles.subtitle}>{t('rede.observadas')}</h3>
          <ul>
            {publicadas.map((p) => (
              <li key={`${p.host}-${p.container}`}>
                <code>{`http://127.0.0.1:${p.host}`}</code> → {p.container}
              </li>
            ))}
          </ul>
          <p className={styles.motivo}>{t('rede.observadasNota')}</p>
        </>
      )}
    </section>
  );
}
