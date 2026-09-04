import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { RunnerOnboardingPanel } from './RunnerOnboardingPanel';
import { Alert } from './ui/Alert';
import { FolderIcon, FileIcon, ServerIcon, UserIcon } from './ui/icons';
import {
  connectFsBrowserChannel,
  type FsBrowserChannel,
  type FsEntrada,
} from '../lib/fs-browser-channel';
import styles from './FolderBrowserModal.module.css';

interface FolderBrowserModalProps {
  /**
   * `null` quando o projeto ainda não existe (passo de workspace da
   * criação, ANTES da confirmação, no modo `mounted`) — o runner é
   * ancorado a um `--project <id>` que só existe depois de criado (ver o
   * ADR 0107). No modo `runner`, `NewProjectWizard` cria o projeto
   * ANTECIPADAMENTE só pra poder passar um id real aqui (ADR 0108). Sem
   * `projectId`, o modal não tenta conectar: mostra o estado declarado, e
   * digitar o caminho manualmente continua sendo o caminho — nunca finge
   * uma capacidade que a arquitetura hoje não tem.
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

function nomeDaPasta(path: string): string {
  const partes = path.split('/').filter(Boolean);
  return partes.length > 0 ? partes[partes.length - 1] : '/';
}

function juntarCaminho(path: string, nome: string): string {
  return path === '/' ? `/${nome}` : `${path}/${nome}`;
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
 * Navegação de pasta local via o Runner (ADR 0107, revisa a ADR 0072).
 * Explorador de TRÊS colunas — atalhos, lista navegável (breadcrumb + um
 * clique seleciona / duplo clique entra) e um painel de detalhes —, seguindo
 * a referência visual do dono do produto (picker estilo GNOME Files/GTK),
 * refeito só com componentes, tokens e ícones deste design system.
 *
 * O protocolo (`FsEntrada`) só tem `{ nome, isDir }` — sem tamanho nem data
 * de modificação, e este componente não estende isso (mexeria em
 * `apps/engine`/`apps/runner`, fora do escopo desta entrega). O painel de
 * detalhes só mostra o que dá pra derivar client-side: nome, tipo, e a
 * contagem de itens quando o item exibido é a pasta JÁ ABERTA (nunca de uma
 * pasta só selecionada, que exigiria um fetch a mais).
 *
 * Sem runner conectado, mostra `RunnerOnboardingPanel` em vez de travar
 * carregando pra sempre.
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
  // Nome do item SELECIONADO (um clique) dentro da listagem atual — sempre
  // uma pasta, porque arquivos não são selecionáveis. `null` quando nada
  // está selecionado: aí o "alvo" é a pasta aberta no momento.
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const aplicar = useCallback((resultado: ResultadoListagem) => {
    setCarregando(false);
    setPath(resultado.path);
    setSelecionado(null);
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

  // O "alvo" que o botão final usa: o item selecionado (se houver — sempre
  // pasta), senão a pasta atualmente aberta.
  const alvo = selecionado ? juntarCaminho(path, selecionado) : path;

  const detalhe = useMemo(() => {
    if (selecionado) {
      return { nome: selecionado, contagem: undefined as number | undefined };
    }
    return {
      nome: nomeDaPasta(path || '/'),
      contagem: entradas ? entradas.length : undefined,
    };
  }, [selecionado, path, entradas]);

  return (
    <Modal title={t('folderBrowserModal.title')} icon={<FolderIcon size={16} />} onClose={onClose} size="full">
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
          {erro && !semRunner && (
            <Alert tone="danger" role="alert">
              {erro}
            </Alert>
          )}

          <div className={styles.layout}>
            <nav className={styles.atalhos} aria-label={t('folderBrowserModal.shortcutsLabel')}>
              <button
                type="button"
                className={styles.atalhoItem}
                disabled={carregando}
                onClick={() => void carregar()}
              >
                <UserIcon size={14} />
                <span>{t('folderBrowserModal.personalFolder')}</span>
              </button>
              <button
                type="button"
                className={styles.atalhoItem}
                disabled={carregando}
                onClick={() => void carregar('/')}
              >
                <ServerIcon size={14} />
                <span>{t('folderBrowserModal.root')}</span>
              </button>
            </nav>

            <div className={styles.central}>
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

              <div className={styles.lista} role="listbox" aria-label={t('folderBrowserModal.entriesLabel')}>
                {carregando && <div className={styles.estado}>{t('folderBrowserModal.loading')}</div>}

                {!carregando && (
                  <button
                    type="button"
                    className={styles.item}
                    onClick={() => void carregar(pathPai(path))}
                    disabled={path === '/' || path === ''}
                  >
                    <FolderIcon size={14} />
                    <span>..</span>
                  </button>
                )}

                {!carregando &&
                  entradas?.map((entrada) =>
                    entrada.isDir ? (
                      <button
                        key={entrada.nome}
                        type="button"
                        role="option"
                        aria-selected={selecionado === entrada.nome}
                        className={[
                          styles.item,
                          selecionado === entrada.nome && styles.itemSelecionado,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => setSelecionado(entrada.nome)}
                        onDoubleClick={() => void carregar(juntarCaminho(path, entrada.nome))}
                      >
                        <FolderIcon size={14} />
                        <span>{entrada.nome}</span>
                      </button>
                    ) : (
                      <div
                        key={entrada.nome}
                        className={[styles.item, styles.itemArquivo].join(' ')}
                        aria-disabled="true"
                      >
                        <FileIcon size={14} />
                        <span>{entrada.nome}</span>
                      </div>
                    ),
                  )}

                {!carregando && entradas && entradas.length === 0 && (
                  <div className={styles.estado}>{t('folderBrowserModal.empty')}</div>
                )}
              </div>
            </div>

            <aside className={styles.detalhes} aria-label={t('folderBrowserModal.detailsLabel')}>
              {!carregando && (path || selecionado) ? (
                <>
                  <div className={styles.detalhesIcone}>
                    <FolderIcon size={28} />
                  </div>
                  <div className={styles.detalhesNome}>{detalhe.nome}</div>
                  <div className={styles.detalhesLinha}>{t('folderBrowserModal.folderType')}</div>
                  {detalhe.contagem !== undefined && (
                    <div className={styles.detalhesLinha}>
                      {t('folderBrowserModal.itemCount', { count: detalhe.contagem })}
                    </div>
                  )}
                </>
              ) : (
                <div className={styles.estado}>{t('folderBrowserModal.loading')}</div>
              )}
            </aside>
          </div>

          <div className={styles.rodape}>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('folderBrowserModal.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={carregando || !alvo}
              onClick={() => {
                onSelecionar(alvo);
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
