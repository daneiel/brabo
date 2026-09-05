import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { RunnerOnboardingPanel } from './RunnerOnboardingPanel';
import { Alert } from './ui/Alert';
import { FolderIcon, FileIcon, ServerIcon, UserIcon } from './ui/icons';
import { criarFsBrowserViaApi, type FsBrowser, type FsEntrada } from '../lib/fs-browser';
import { connectFsBrowserChannel } from '../lib/fs-browser-channel';
import styles from './FolderBrowserModal.module.css';

/**
 * DE ONDE o modal lê o filesystem (RN-504).
 *
 * União discriminada, e não duas props opcionais, porque os dois transportes
 * precisam de identificadores DIFERENTES e nenhum dos dois é opcional dentro
 * do seu ramo: o de api é escopado a um `workspaceId` (a base é da
 * instalação, o workspace só dá escopo à autorização) e o de runner é
 * ancorado a um `--project <id>` que só existe depois de o projeto ser
 * criado (ADR 0107/0108). Com duas props opcionais, "nenhuma das duas" e
 * "as duas" seriam estados representáveis que o componente teria de tratar
 * em runtime; assim eles não existem.
 */
export type OrigemDoNavegador =
  | { tipo: 'api'; workspaceId: string }
  | { tipo: 'runner'; projectId: string };

interface FolderBrowserModalProps {
  origem: OrigemDoNavegador;
  /**
   * Pasta a abrir primeiro. Sem valor, pergunta ao transporte onde começar —
   * a base de projetos montados (api) ou `os.homedir()` (runner).
   */
  caminhoInicial?: string;
  onSelecionar: (caminho: string) => void;
  onClose: () => void;
}

interface ResultadoListagem {
  path: string;
  entradas: FsEntrada[];
  erro?: string;
  arquivos?: number;
  simbolicos?: number;
  truncado?: boolean;
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
 * Explorador de pasta de TRÊS colunas — atalhos, lista navegável (breadcrumb
 * + um clique seleciona / duplo clique entra) e um painel de detalhes —,
 * seguindo a referência visual do dono do produto (picker estilo GNOME
 * Files/GTK), refeito só com componentes, tokens e ícones deste design
 * system.
 *
 * DOIS transportes desde a RN-504, escolhidos por `origem` e escondidos
 * atrás da interface `FsBrowser`: a API, escopada à base de projetos
 * montados (ADR 0141), e o canal Phoenix do runner (ADR 0107, revisa a ADR
 * 0072). O corpo do componente não sabe qual dos dois está falando — o que
 * `origem` decide são só as três coisas que MUDAM de verdade: qual fábrica
 * chamar, quais atalhos oferecer e se `RunnerOnboardingPanel` faz sentido.
 *
 * O painel de detalhes só mostra o que dá pra derivar client-side: nome,
 * tipo, e a contagem de itens quando o item exibido é a pasta JÁ ABERTA
 * (nunca de uma pasta só selecionada, que exigiria um fetch a mais). O
 * transporte de api acrescenta o que ficou de FORA da listagem (arquivos,
 * symlinks, corte no teto) — sem isso uma pasta cheia de código apareceria
 * como "pasta vazia", que é a tela afirmando sobre o que não leu (RN-180).
 */
export function FolderBrowserModal({
  origem,
  caminhoInicial,
  onSelecionar,
  onClose,
}: FolderBrowserModalProps) {
  const { t } = useTranslation('terminal');
  const canalRef = useRef<FsBrowser | null>(null);
  const [path, setPath] = useState<string>(caminhoInicial ?? '');
  const [entradas, setEntradas] = useState<FsEntrada[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Nome do item SELECIONADO (um clique) dentro da listagem atual — sempre
  // uma pasta, porque arquivos não são selecionáveis. `null` quando nada
  // está selecionado: aí o "alvo" é a pasta aberta no momento.
  const [selecionado, setSelecionado] = useState<string | null>(null);
  // O que a listagem DEIXOU DE FORA. `null` quando o transporte não conta —
  // o do runner não conta, e preencher com zeros afirmaria "não há nada de
  // fora", que é diferente de "não sei".
  const [omitidos, setOmitidos] = useState<{
    arquivos: number;
    simbolicos: number;
    truncado: boolean;
  } | null>(null);

  const aplicar = useCallback((resultado: ResultadoListagem) => {
    setCarregando(false);
    setPath(resultado.path);
    setSelecionado(null);
    setOmitidos(
      resultado.arquivos === undefined || resultado.simbolicos === undefined
        ? null
        : {
            arquivos: resultado.arquivos,
            simbolicos: resultado.simbolicos,
            truncado: resultado.truncado ?? false,
          },
    );
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

  // O id que ancora o transporte. Extraído para uma constante porque é ele —
  // e não o objeto `origem`, recriado a cada render pelo pai — que decide
  // quando o transporte é recriado.
  const ancora = origem.tipo === 'api' ? origem.workspaceId : origem.projectId;

  useEffect(() => {
    const canal =
      origem.tipo === 'api'
        ? criarFsBrowserViaApi(origem.workspaceId)
        : connectFsBrowserChannel(origem.projectId);
    canalRef.current = canal;
    void carregar(caminhoInicial);

    return () => {
      canal.fechar();
      canalRef.current = null;
    };
    // `caminhoInicial` só importa na PRIMEIRA carga desta conexão — navegar
    // dentro do modal não deve reabrir o canal a cada clique.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origem.tipo, ancora]);

  // Só faz sentido no transporte do runner: pelo caminho da api não existe
  // runner nenhum para onboardar, e a mensagem de recusa dela é outra.
  const semRunner =
    origem.tipo === 'runner' && (erro?.includes('Nenhum runner conectado') ?? false);

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
      {origem.tipo === 'runner' && semRunner && (
        <RunnerOnboardingPanel
          projectId={origem.projectId}
          mensagem={erro ?? undefined}
          onRetry={() => void carregar(path || caminhoInicial)}
          retrying={carregando}
        />
      )}

      {!semRunner && (
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
                {origem.tipo === 'api' ? <ServerIcon size={14} /> : <UserIcon size={14} />}
                <span>
                  {origem.tipo === 'api'
                    ? t('folderBrowserModal.projectsBase')
                    : t('folderBrowserModal.personalFolder')}
                </span>
              </button>
              {/*
                A raiz do filesystem NÃO é oferecida pelo transporte de api:
                `/` está fora da base por construção, e o atalho só teria como
                terminar num 400. Oferecer um botão que a api recusa é a tela
                prometendo o que o servidor não faz.
              */}
              {origem.tipo === 'runner' && (
                <button
                  type="button"
                  className={styles.atalhoItem}
                  disabled={carregando}
                  onClick={() => void carregar('/')}
                >
                  <ServerIcon size={14} />
                  <span>{t('folderBrowserModal.root')}</span>
                </button>
              )}
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

              {/*
                O que a listagem deixou de fora, DITO — nunca omitido em
                silêncio (RN-180). Sem esta linha, uma pasta com 40 arquivos e
                nenhuma subpasta se apresentaria como "pasta vazia", e quem
                está escolhendo onde o projeto vai morar tomaria a decisão
                sobre uma tela que afirma o contrário do disco.
              */}
              {!carregando && omitidos && (
                <div className={styles.rodapeDaLista}>
                  {omitidos.truncado && (
                    <span>{t('folderBrowserModal.truncated')} </span>
                  )}
                  {omitidos.arquivos > 0 && (
                    <span>
                      {t('folderBrowserModal.hiddenFiles', { count: omitidos.arquivos })}{' '}
                    </span>
                  )}
                  {omitidos.simbolicos > 0 && (
                    <span>
                      {t('folderBrowserModal.hiddenLinks', { count: omitidos.simbolicos })}
                    </span>
                  )}
                </div>
              )}
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
