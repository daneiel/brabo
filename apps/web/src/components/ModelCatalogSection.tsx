import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listCredentials,
  listModelCatalog,
  setModelUses,
  setModelsActive,
  syncModelCatalog,
} from '../lib/api-client';
import type {
  ModelComCuradoria,
  ResultadoDoSync,
  UsoDeModelo,
} from '../lib/api-types';
import {
  FACETAS,
  ROTULO_DO_PROVIDER,
  ROTULO_DO_USO,
  USOS_DE_MODELO,
  agruparModelos,
  formatarJanela,
  formatarPreco,
  type Faceta,
} from '../lib/models';
import { Alert } from './ui/Alert';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Disclosure } from './ui/Disclosure';
import { useToast } from './ui/ToastProvider';
import styles from './ModelCatalogSection.module.css';

/**
 * Curadoria do catálogo (Fase 9c, RN-043).
 *
 * O sync descobre modelos e os deixa INATIVOS; ligar é decisão do owner. Um
 * catálogo de provider tem centenas de linhas, e despejá-las ativas tornaria a
 * escolha impossível e ligaria modelo caro sem ninguém decidir.
 *
 * O modelo que sumiu do provider aparece marcado e NÃO desaparece: `token_usage`
 * e `model_bindings` apontam para ele, e some-lo da tela deixaria o binding
 * afetado sem explicação.
 */
export function ModelCatalogSection({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation('models');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  /**
   * Dois conjuntos com POLARIDADE oposta, e é de propósito: cada um carrega o
   * seu default no próprio nome.
   *
   * Grupos nascem ABERTOS (são três, e fechá-los de saída esconderia até o que
   * é pequeno); subgrupos de fabricante nascem FECHADOS (são 58 no OpenRouter,
   * e abri-los devolve a lista de 338 linhas que o agrupamento existe para
   * evitar). Um único Set com "aberto" ou "fechado" para os dois exigiria semear
   * um deles com dados que só chegam depois da query.
   */
  const [gruposFechados, setGruposFechados] = useState<Set<string>>(new Set());
  const [subgruposAbertos, setSubgruposAbertos] = useState<Set<string>>(
    new Set(),
  );
  /**
   * As facetas exigidas. Nascem vazias: o catálogo inteiro é o default, e um
   * filtro ligado por conta própria esconderia modelo sem o usuário ter pedido
   * — que é o mesmo defeito do modelo que some da lista.
   */
  const [facetas, setFacetas] = useState<Set<Faceta>>(new Set());
  /** Filtro pelo uso que ESTE workspace marcou — o outro eixo da busca. */
  const [usosFiltrados, setUsosFiltrados] = useState<Set<UsoDeModelo>>(
    new Set(),
  );
  /** Os usos que a barra de lote vai APLICAR (substituindo) nos marcados. */
  const [usosDoLote, setUsosDoLote] = useState<Set<UsoDeModelo>>(new Set());

  function alternarNoSet<T>(
    set: React.Dispatch<React.SetStateAction<Set<T>>>,
    valor: T,
  ) {
    set((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(valor)) proximo.add(valor);
      return proximo;
    });
  }

  function alternarFaceta(id: Faceta) {
    setFacetas((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(id)) proximo.add(id);
      return proximo;
    });
  }

  function alternarGrupo(kind: string) {
    setGruposFechados((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(kind)) proximo.add(kind);
      return proximo;
    });
  }

  function alternarSubgrupo(upstream: string) {
    setSubgruposAbertos((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(upstream)) proximo.add(upstream);
      return proximo;
    });
  }

  const { data: catalogo } = useQuery({
    queryKey: ['model-catalog', workspaceId],
    queryFn: () => listModelCatalog(workspaceId),
  });

  const grupos = useMemo(
    () =>
      catalogo
        ? agruparModelos(catalogo, {
            facetas: [...facetas],
            usos: [...usosFiltrados],
          })
        : [],
    [catalogo, facetas, usosFiltrados],
  );

  /** O total sem filtro, para dizer quanto o filtro escondeu em vez de só sumir. */
  const totalSemFiltro = useMemo(
    () =>
      catalogo
        ? agruparModelos(catalogo).reduce((n, g) => n + g.modelos.length, 0)
        : 0,
    [catalogo],
  );
  const totalVisivel = grupos.reduce((n, g) => n + g.modelos.length, 0);
  const filtrando = facetas.size > 0 || usosFiltrados.size > 0;

  const todosOsUpstreams = grupos.flatMap((g) =>
    (g.subgrupos ?? []).map((s) => s.upstream),
  );
  // "Tudo minimizado" é o que decide o que o botão OFERECE — ele mostra a ação,
  // não o estado, para não fazer o usuário adivinhar o que vai acontecer.
  const tudoMinimizado =
    gruposFechados.size === grupos.length && subgruposAbertos.size === 0;

  function alternarTudo() {
    if (tudoMinimizado) {
      setGruposFechados(new Set());
      setSubgruposAbertos(new Set(todosOsUpstreams));
    } else {
      setGruposFechados(new Set(grupos.map((g) => g.kind)));
      setSubgruposAbertos(new Set());
    }
  }


  const { data: credenciais } = useQuery({
    queryKey: ['credentials'],
    queryFn: listCredentials,
  });

  /**
   * Providers com credencial cadastrada e NENHUM modelo no catálogo.
   *
   * O passo que faltava estar dito: cadastrar a chave não descobre modelo
   * nenhum — quem descobre é o sync, e nada na tela ligava as duas coisas. O
   * caso real foi uma chave de OpenRouter válida, testada e verde, com o
   * seletor de modelos oferecendo só os locais.
   *
   * Compara com o catálogo INTEIRO (ativos e inativos): o que interessa aqui é
   * "o sync já trouxe algo deste provider?", não a curadoria.
   */
  const semCatalogo = useMemo(() => {
    if (!credenciais || !catalogo) return [];
    const comModelo = new Set(
      Object.values(catalogo)
        .flatMap((porGrupo) => Object.values(porGrupo).flat())
        .map((m) => m.provider),
    );
    return credenciais
      .map((c) => c.provider)
      // `github`/`gitlab` são token de git, não dão modelo nenhum.
      .filter((p): p is keyof typeof ROTULO_DO_PROVIDER => p in ROTULO_DO_PROVIDER)
      .filter((p) => !comModelo.has(p));
  }, [credenciais, catalogo]);

  function invalidar() {
    void queryClient.invalidateQueries({
      queryKey: ['model-catalog', workspaceId],
    });
    // O seletor lê `/models` (só ativos) — sem isto ele mostraria o estado
    // anterior até o próximo refetch.
    void queryClient.invalidateQueries({ queryKey: ['models'] });
  }

  const sync = useMutation({
    mutationFn: () => syncModelCatalog(workspaceId),
    onSuccess: (resultado) => {
      invalidar();
      showToast({ title: t('catalog.toasts.syncSuccess'), tone: 'success' });
      return resultado;
    },
    onError: () =>
      showToast({
        title: t('catalog.toasts.syncErrorTitle'),
        message: t('catalog.toasts.syncErrorMessage'),
        tone: 'danger',
      }),
  });

  const ativar = useMutation({
    mutationFn: (isActive: boolean) =>
      setModelsActive(workspaceId, { modelIds: [...marcados], isActive }),
    onSuccess: (_dados, isActive) => {
      invalidar();
      setMarcados(new Set());
      showToast({
        title: isActive
          ? t('catalog.toasts.activated')
          : t('catalog.toasts.deactivated'),
        tone: 'success',
      });
    },
    onError: () =>
      showToast({ title: t('catalog.toasts.saveError'), tone: 'danger' }),
  });

  const marcarUsos = useMutation({
    mutationFn: () =>
      setModelUses(workspaceId, {
        modelIds: [...marcados],
        uses: [...usosDoLote],
      }),
    onSuccess: () => {
      invalidar();
      setMarcados(new Set());
      setUsosDoLote(new Set());
      showToast({ title: t('catalog.toasts.usesUpdated'), tone: 'success' });
    },
    onError: () =>
      showToast({ title: t('catalog.toasts.saveError'), tone: 'danger' }),
  });

  function alternar(id: string) {
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(id)) proximo.add(id);
      return proximo;
    });
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <div>
          <div className={styles.tituloLinha}>
            <h2 className={styles.title}>{t('catalog.title')}</h2>
            <span className={styles.eyebrow}>{t('catalog.eyebrow')}</span>
          </div>
          <div className={styles.subtitle}>{t('catalog.subtitle')}</div>
        </div>
        <div className={styles.acoes}>
          {grupos.length > 0 && (
            <Button variant="ghost" onClick={alternarTudo}>
              {tudoMinimizado ? t('catalog.expandAll') : t('catalog.collapseAll')}
            </Button>
          )}
          <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? t('catalog.syncing') : t('catalog.updateButton')}
          </Button>
        </div>
      </div>

      {totalSemFiltro > 0 && (
        <div className={styles.facetas}>
          {FACETAS.map((f) => (
            <button
              key={f.id}
              type="button"
              title={f.ajuda}
              aria-pressed={facetas.has(f.id)}
              className={[
                styles.faceta,
                facetas.has(f.id) && styles.facetaLigada,
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => alternarFaceta(f.id)}
            >
              {f.rotulo}
            </button>
          ))}
          {/* O outro eixo: capability é o que o provider PROVA, uso é o que
              este workspace decidiu. Separados por um divisor porque
              confundi-los é justamente o erro que o ADR 0051 evita. */}
          <span className={styles.divisorDeFiltro} aria-hidden="true" />
          {USOS_DE_MODELO.map((u) => (
            <button
              key={u}
              type="button"
              title={t('catalog.usesFilterTitle', { use: ROTULO_DO_USO[u] })}
              aria-pressed={usosFiltrados.has(u)}
              className={[
                styles.faceta,
                styles.facetaDeUso,
                usosFiltrados.has(u) && styles.facetaLigada,
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => alternarNoSet(setUsosFiltrados, u)}
            >
              {ROTULO_DO_USO[u]}
            </button>
          ))}
          {/* Sem esta contagem, um filtro que zera a lista é indistinguível de
              um catálogo vazio — e a saída (desligar a faceta) fica escondida. */}
          {filtrando && (
            <span className={styles.facetaContagem}>
              {t('catalog.countOfTotal', { visible: totalVisivel, total: totalSemFiltro })}
            </span>
          )}
        </div>
      )}

      {filtrando && totalVisivel === 0 && (
        <Alert tone="accent">
          {t('catalog.filteredEmpty.prefix')}
          <strong>{t('catalog.filteredEmpty.thisWorkspace')}</strong>
          {t('catalog.filteredEmpty.suffix')}
        </Alert>
      )}

      {semCatalogo.length > 0 && (
        <Alert tone="warning">
          {t('catalog.missingCatalog.prefix')}
          <strong>
            {semCatalogo.map((p) => ROTULO_DO_PROVIDER[p]).join(', ')}
          </strong>
          {t('catalog.missingCatalog.middle', { count: semCatalogo.length })}
          <strong>{t('catalog.updateButton')}</strong>
          {t('catalog.missingCatalog.suffix')}
        </Alert>
      )}

      {sync.data && <RelatorioDoSync resultados={sync.data.porProvider} />}

      {marcados.size > 0 && (
        <div className={styles.barraDeLote}>
          <span className={styles.contagem}>
            {t('catalog.batchBar.selectedCount', { count: marcados.size })}
          </span>
          <Button onClick={() => ativar.mutate(true)} disabled={ativar.isPending}>
            {t('catalog.batchBar.activate')}
          </Button>
          <Button
            variant="danger"
            onClick={() => ativar.mutate(false)}
            disabled={ativar.isPending}
          >
            {t('catalog.batchBar.deactivate')}
          </Button>
          <span className={styles.divisorDeFiltro} aria-hidden="true" />
          {/* Marcar uso é operação SEPARADA de ativar: os dois eixos não se
              misturam num botão só, para ninguém ligar um modelo achando que
              só estava opinando sobre ele. */}
          <span className={styles.rotuloDoLote}>{t('catalog.batchBar.markAs')}</span>
          {USOS_DE_MODELO.map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={usosDoLote.has(u)}
              className={[
                styles.faceta,
                styles.facetaDeUso,
                usosDoLote.has(u) && styles.facetaLigada,
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => alternarNoSet(setUsosDoLote, u)}
            >
              {ROTULO_DO_USO[u]}
            </button>
          ))}
          <Button
            variant="ghost"
            onClick={() => marcarUsos.mutate()}
            disabled={marcarUsos.isPending}
            title={t('catalog.batchBar.applyUsesTitle')}
          >
            {usosDoLote.size > 0
              ? t('catalog.batchBar.applyUses')
              : t('catalog.batchBar.clearUses')}
          </Button>
        </div>
      )}

      {/* Só quando o catálogo é REALMENTE vazio: com filtro ligado, mandar
          cadastrar credencial seria mentira — a credencial existe e o modelo
          também, quem escondeu foi a faceta. */}
      {totalSemFiltro === 0 && (
        <div className={styles.vazio}>{t('catalog.empty')}</div>
      )}

      {/* Migrado para o `Disclosure` do design system na Onda 4/frente H4 —
          era a implementação de REFERÊNCIA que ditou a semântica do
          componente (grupos, subgrupos, `aria-expanded`, "minimizar tudo"),
          mas nunca tinha sido convertida para consumi-lo. Os dois `Set`s
          (`gruposFechados`/`subgruposAbertos`) continuam sendo a fonte de
          verdade — `Disclosure` só fica CONTROLADO por eles via `aberto`/
          `onAlternar`, sem duplicar estado. */}
      {grupos.map((grupo) => {
        const abertoGrupo = !gruposFechados.has(grupo.kind);
        return (
          <Disclosure
            key={grupo.kind}
            className={styles.grupo}
            classNameCabecalho={styles.grupoTitulo}
            aberto={abertoGrupo}
            onAlternar={() => alternarGrupo(grupo.kind)}
            titulo={
              <>
                {grupo.rotulo}
                {/* "Hubs" sozinho não diz de QUEM é o catálogo — e preço,
                    disponibilidade e credencial pertencem ao hub, não ao
                    fabricante do modelo. Nos outros grupos o provider já é
                    evidente na linha. */}
                {grupo.kind === 'hub' && (
                  <span className={styles.grupoProvedores}>
                    ·{' '}
                    {grupo.provedores
                      .map((p) => ROTULO_DO_PROVIDER[p] ?? p)
                      .join(', ')}
                  </span>
                )}
              </>
            }
            trailing={grupo.modelos.length}
          >
            {/* Um hub serve o catálogo de dezenas de fabricantes numa lista só
                — 338, no caso do OpenRouter. Repartir por quem serve por baixo
                é o que torna a lista navegável; sem isso, achar o Claude é
                rolagem. */}
            {grupo.subgrupos
              ? grupo.subgrupos.map((sub) => {
                  const aberto = subgruposAbertos.has(sub.upstream);
                  const marcadosAqui = sub.modelos.filter((m) =>
                    marcados.has(m.id),
                  ).length;
                  return (
                    <Disclosure
                      key={sub.upstream}
                      className={styles.subgrupo}
                      classNameCabecalho={styles.subgrupoTitulo}
                      aberto={aberto}
                      onAlternar={() => alternarSubgrupo(sub.upstream)}
                      titulo={sub.rotulo}
                      trailing={
                        <>
                          <span className={styles.grupoContagem}>
                            {sub.modelos.length}
                          </span>
                          {/* Fechado com itens marcados: sem este selo, a
                              barra diria "12 selecionados" e você não teria
                              como ver QUAIS — ativaria em lote às cegas. */}
                          {!aberto && marcadosAqui > 0 && (
                            <span className={styles.marcadosOcultos}>
                              {t('catalog.markedHidden', { count: marcadosAqui })}
                            </span>
                          )}
                        </>
                      }
                    >
                      {sub.modelos.map((model) => (
                        <LinhaDoCatalogo
                          key={model.id}
                          model={model}
                          marcado={marcados.has(model.id)}
                          onToggle={() => alternar(model.id)}
                        />
                      ))}
                    </Disclosure>
                  );
                })
              : grupo.modelos.map((model) => (
                  <LinhaDoCatalogo
                    key={model.id}
                    model={model}
                    marcado={marcados.has(model.id)}
                    onToggle={() => alternar(model.id)}
                  />
                ))}
          </Disclosure>
        );
      })}
    </div>
  );
}

/**
 * Nenhum provider some do relatório — nem o que foi pulado. "Não sei o que tem
 * lá" não é "não tem nada lá", e o motivo do pulo (com a ORIGEM da falha, no
 * vocabulário do ADR 0020) é o que evita diagnóstico por eliminação.
 */
function RelatorioDoSync({ resultados }: { resultados: ResultadoDoSync[] }) {
  const { t } = useTranslation('models');
  return (
    <div className={styles.relatorio}>
      {resultados.map((r) => (
        <div key={r.provider} className={styles.relatorioLinha}>
          <span className={styles.relatorioProvider}>{r.provider}</span>
          {r.pulado ? (
            <Badge tone={r.pulado === 'falha' ? 'danger' : 'muted'}>
              {r.pulado === 'sem_capability' && t('catalog.syncReport.skippedNoCapability')}
              {r.pulado === 'sem_credencial' && t('catalog.syncReport.skippedNoCredential')}
              {r.pulado === 'falha' &&
                t('catalog.syncReport.failed', { origin: r.origemDaFalha })}
            </Badge>
          ) : (
            <span className={styles.relatorioNumeros}>
              {t('catalog.syncReport.summary', {
                discovered: r.descobertos,
                reencountered: r.reencontrados,
                missing: r.indisponibilizados,
              })}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function LinhaDoCatalogo({
  model,
  marcado,
  onToggle,
}: {
  model: ModelComCuradoria;
  marcado: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('models');
  const janela = formatarJanela(model);
  const indisponivel = model.availability === 'unavailable';

  return (
    <label
      className={[styles.linha, indisponivel && styles.linhaIndisponivel]
        .filter(Boolean)
        .join(' ')}
    >
      <input type="checkbox" checked={marcado} onChange={onToggle} />
      <span className={styles.nome}>
        {model.displayName}
        <span className={styles.slug}>{model.name}</span>
      </span>
      <span className={styles.selos}>
        <Badge tone={model.isActive ? 'success' : 'muted'}>
          {model.isActive ? t('badges.active') : t('badges.inactive')}
        </Badge>
        {indisponivel && <Badge tone="warning">{t('badges.unavailable')}</Badge>}
        <Badge tone="muted">{formatarPreco(model)}</Badge>
        {janela && <Badge tone="muted">{janela}</Badge>}
        {model.supportsToolCalling && (
          <Badge tone="accent">{t('badges.toolCalling')}</Badge>
        )}
        {/* Só o que é VERDADE aparece: um selo "não lê imagem" afirmaria uma
            ausência que o catálogo não prova. */}
        {model.supportsVision && <Badge tone="accent">{t('badges.readsImage')}</Badge>}
        {model.supportsReasoning && <Badge tone="accent">{t('badges.thinking')}</Badge>}
        {model.generatesImage && (
          <Badge tone="accent">{t('badges.generatesImage')}</Badge>
        )}
        {model.manualPricing && <Badge tone="muted">{t('badges.manualPricing')}</Badge>}
        {/* Uso vem depois das capabilities e com tom próprio: uma é o que o
            provider prova, a outra é o que este workspace decidiu. */}
        {model.uses.map((u) => (
          <Badge key={u} tone="warning">
            {ROTULO_DO_USO[u]}
          </Badge>
        ))}
      </span>
    </label>
  );
}
