import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { RunnerOnboardingPanel } from './RunnerOnboardingPanel';
import { Alert } from './ui/Alert';
import { ArrowUpIcon, FolderIcon } from './ui/icons';
import {
  connectFsBrowserChannel,
  type FsBrowserChannel,
  type FsEntrada,
} from '../lib/fs-browser-channel';
import styles from './FolderBrowserModal.module.css';

interface FolderBrowserModalProps {
  /**
   * `null` quando o projeto ainda não existe (passo de workspace da
   * criação, ANTES da confirmação) — o runner é ancorado a um `--project
   * <id>` que só existe depois de criado (ver a ADR desta entrega). Nesse
   * caso o modal não tenta conectar: mostra o estado declarado, e digitar o
   * caminho manualmente continua sendo o caminho — nunca finge uma
   * capacidade que a arquitetura hoje não tem.
   */
  projectId: string | null;
  /** Pasta a abrir primeiro. Sem valor, pede `os.homedir()` ao runner. */
  caminhoInicial?: string;
  onSelecionar: (caminho: string) => void;
  onClose: () => void;
}

interface ResultadoListagem {
  path: string;
  entradas: FsEntrada[];
  erro?: string;
}

function pathPai(path: string): string {
  const partes = path.split('/').filter(Boolean);
  partes.pop();
  return '/' + partes.join('/');
}

function segmentosDoPath(path: string): { rotulo: string; caminho: string }[] {
  const partes = path.split('/').filter(Boolean);
  const segmentos: { rotulo: string; caminho: string }[] = [{ rotulo: '/', caminho: '/' }];
  let acumulado = '';
  for (const parte of partes) {
    acumulado += `/${parte}`;
    segmentos.push({ rotulo: parte, caminho: acumulado });
  }
  return segmentos;
}

/**
 * Navegação de pasta local via o Runner (ADR sobre navegação de pasta via o
 * Runner, revisa a ADR 0072). Breadcrumb + lista de subpastas (só
 * diretórios — arquivos aparecem no protocolo mas não fazem sentido
 * escolher aqui), `..` para subir, "Selecionar esta pasta". Sem runner
 * conectado, mostra `RunnerOnboardingPanel` em vez de travar carregando
 * pra sempre.
 */
export function FolderBrowserModal({
  projectId,
  caminhoInicial,
  onSelecionar,
  onClose,
}: FolderBrowserModalProps) {
  const { t } = useTranslation('terminal');
  const canalRef = useRef<FsBrowserChannel | null>(null);
  const [path, setPath] = useState<string>(caminhoInicial ?? '');
  const [entradas, setEntradas] = useState<FsEntrada[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const aplicar = useCallback((resultado: ResultadoListagem) => {
    setCarregando(false);
    setPath(resultado.path);
    if (resultado.erro) {
      setErro(resultado.erro);
      setEntradas(null);
    } else {
      setErro(null);
      setEntradas(resultado.entradas);
    }
  }, []);

  const carregar = useCallback(
    async (alvo?: string) => {
      const canal = canalRef.current;
      if (!canal) return;
      setCarregando(true);
      setErro(null);

      if (alvo) {
        aplicar(await canal.listarDiretorio(alvo));
        return;
      }

      const inicial = await canal.diretorioInicial();
      if (inicial.erro || !inicial.path) {
        setCarregando(false);
        setErro(inicial.erro ?? t('folderBrowserModal.initialDirError'));
        return;
      }
      aplicar(await canal.listarDiretorio(inicial.path));
    },
    [aplicar, t],
  );

  useEffect(() => {
    if (!projectId) return;
    const canal = connectFsBrowserChannel(projectId);
    canalRef.current = canal;
    void carregar(caminhoInicial);

    return () => {
      canal.fechar();
      canalRef.current = null;
    };
    // `caminhoInicial` só importa na PRIMEIRA carga desta conexão — navegar
    // dentro do modal não deve reabrir o canal a cada clique.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const semRunner = erro?.includes('Nenhum runner conectado') ?? false;

  return (
    <Modal title={t('folderBrowserModal.title')} icon={<FolderIcon size={16} />} onClose={onClose}>
      {!projectId && (
        <div className={styles.semProjeto}>
          <Alert tone="accent">{t('folderBrowserModal.noProjectMessage')}</Alert>
          <div className={styles.rodape}>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('folderBrowserModal.understood')}
            </Button>
          </div>
        </div>
      )}

      {projectId && semRunner && (
        <RunnerOnboardingPanel
          projectId={projectId}
          mensagem={erro ?? undefined}
          onRetry={() => void carregar(path || caminhoInicial)}
          retrying={carregando}
        />
      )}

      {projectId && !semRunner && (
        <div className={styles.corpo}>
          <div className={styles.breadcrumb} aria-label={t('folderBrowserModal.breadcrumbLabel')}>
            {segmentosDoPath(path || '/').map((seg, indice, lista) => (
              <span key={seg.caminho} className={styles.segmentoWrapper}>
                <button
                  type="button"
                  className={styles.segmento}
                  disabled={carregando}
                  onClick={() => void carregar(seg.caminho)}
                >
                  {seg.rotulo}
                </button>
                {indice < lista.length - 1 && <span aria-hidden="true">/</span>}
              </span>
            ))}
          </div>

          {erro && !semRunner && (
            <Alert tone="danger" role="alert">
              {erro}
            </Alert>
          )}

          <div className={styles.lista} role="listbox" aria-label={t('folderBrowserModal.subfoldersLabel')}>
            {carregando && <div className={styles.estado}>{t('folderBrowserModal.loading')}</div>}

            {!carregando && (
              <button
                type="button"
                className={styles.item}
                onClick={() => void carregar(pathPai(path))}
                disabled={path === '/' || path === ''}
              >
                <ArrowUpIcon size={14} />
                <span>..</span>
              </button>
            )}

            {!carregando &&
              entradas
                ?.filter((e) => e.isDir)
                .map((entrada) => (
                  <button
                    key={entrada.nome}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className={styles.item}
                    onClick={() => void carregar(`${path === '/' ? '' : path}/${entrada.nome}`)}
                  >
                    <FolderIcon size={14} />
                    <span>{entrada.nome}</span>
                  </button>
                ))}

            {!carregando && entradas && entradas.filter((e) => e.isDir).length === 0 && (
              <div className={styles.estado}>{t('folderBrowserModal.empty')}</div>
            )}
          </div>

          <div className={styles.rodape}>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('folderBrowserModal.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={carregando || !path}
              onClick={() => {
                onSelecionar(path);
                onClose();
              }}
            >
              {t('folderBrowserModal.select')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
