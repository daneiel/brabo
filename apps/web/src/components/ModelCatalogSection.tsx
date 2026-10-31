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
  LLMProviderName,
  ModelComCuradoria,
  ResultadoDoSync,
  UsoDeModelo,
} from '../lib/api-types';
import {
  COR_DO_PROVIDER,
  FACETAS,
  ROTULO_DO_PROVIDER,
  ROTULO_DO_USO,
  USOS_DE_MODELO,
  agruparModelos,
  catalogoDoProvider,
  providerAtivo,
  providersSemCatalogo,
  formatarJanela,
  formatarPreco,
  type Faceta,
} from '../lib/models';
import { Alert } from './ui/Alert';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Disclosure } from './ui/Disclosure';
import { Tabs } from './ui/Tabs';
import { useProvidersComChave } from '../lib/providers-com-chave';
import { useToast } from './ui/ToastProvider';
import { HuggingFaceModelBrowser } from './HuggingFaceModelBrowser';
import styles from './ModelCatalogSection.module.css';
import { FRESCOR_DA_CONFIGURACAO_MS } from '../lib/query-policy';

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
   * Subgrupos de fabricante (OpenRouter) nascem FECHADOS: são 58, e abri-los
   * devolve a lista de 338 linhas que o agrupamento existe para evitar.
   */
  const [abaEscolhida, setAbaEscolhida] = useState<string | null>(null);
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
  /**
   * Busca por nome/id (RN-694). Com termo, todo grupo e subgrupo com resultado
   * abre sozinho — achar um modelo entre 464 não pode exigir abrir o grupo
   * certo antes. Os `Set`s de aberto/fechado ficam intactos e voltam a valer
   * quando a busca é limpa.
   */
  const [busca, setBusca] = useState('');
  const buscando = busca.trim() !== '';

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
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });

  // Só `grupos` (já filtrado) importa aqui: o total sem filtro sai das abas.
  const grupos = useMemo(
    () =>
      catalogo
        ? agruparModelos(catalogo, {
            facetas: [...facetas],
            usos: [...usosFiltrados],
            busca,
          })
        : [],
    [catalogo, facetas, usosFiltrados, busca],
  );

  const comChave = useProvidersComChave(workspaceId);

  /**
   * Uma aba por provider ATIVO (local ou com chave do titular, RN-058). Sem
   * chave mas com modelo ATIVO continua como aba marcada, para dar para
   * desativá-lo (RN-043); os demais sem chave não aparecem e entram na linha
   * "de fora" (RN-180). Chave desconhecida mostra todos.
   */
  const { abas, deFora } = useMemo(() => {
    if (!catalogo) return { abas: [], deFora: [] as LLMProviderName[] };
    const todos = agruparModelos(catalogo).flatMap((g) => g.modelos);
    const ordem = Object.keys(ROTULO_DO_PROVIDER);
    const nomes = [...new Set(todos.map((m) => m.provider))].sort(
      (a, b) => ordem.indexOf(a) - ordem.indexOf(b),
    );
    const abas: { provider: LLMProviderName; semChave: boolean; total: number }[] = [];
    const deFora: LLMProviderName[] = [];
    for (const provider of nomes) {
      const meus = todos.filter((m) => m.provider === provider);
      const semChave = !providerAtivo(provider, comChave);
      if (!semChave || meus.some((m) => m.isActive)) {
        abas.push({ provider, semChave, total: meus.length });
      } else {
        deFora.push(provider);
      }
    }
    return { abas, deFora };
  }, [catalogo, comChave]);

  const naAba = (provider: LLMProviderName) => catalogoDoProvider(grupos, provider);
  const totalSemFiltro = abas.reduce((n, a) => n + a.total, 0);
  const totalVisivel = abas.reduce((n, a) => n + naAba(a.provider).modelos.length, 0);
  const filtrando = facetas.size > 0 || usosFiltrados.size > 0 || buscando;
  const abaAtiva =
    abas.find((a) => a.provider === abaEscolhida) ?? abas[0] ?? null;
  const atual = abaAtiva ? naAba(abaAtiva.provider) : null;
  const comMatch = abas.filter(
    (a) => a.provider !== abaAtiva?.provider && naAba(a.provider).modelos.length > 0,
  );

  const todosOsUpstreams = (atual?.subgrupos ?? []).map((s) => s.upstream);
  // O botão mostra a AÇÃO, não o estado, para não fazer ninguém adivinhar.
  const tudoMinimizado = subgruposAbertos.size === 0;

  function alternarTudo() {
    setSubgruposAbertos(tudoMinimizado ? new Set(todosOsUpstreams) : new Set());
  }

  const { data: credenciais } = useQuery({
    queryKey: ['credentials'],
    queryFn: listCredentials,
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
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
  const semCatalogo = useMemo(
    () =>
      credenciais && catalogo ? providersSemCatalogo(credenciais, catalogo) : [],
    [credenciais, catalogo],
  );

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
      // AT-372: o toast diz QUANTOS modelos o sync trouxe e leva ao próximo
      // passo — ativar um. "Sincronizado" sozinho não dizia se veio algo.
      const vieram = resultado.porProvider.reduce(
        (soma, r) => soma + r.descobertos + r.reencontrados,
        0,
      );
      showToast({
        title: t('catalog.toasts.syncSuccess'),
        message: t('catalog.toasts.syncCount', { count: vieram }),
        tone: 'success',
        acao:
          vieram > 0
            ? {
                rotulo: t('catalog.toasts.syncActivateLink'),
                aoClicar: () =>
                  document
                    .getElementById('catalogo-de-modelos-lista')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
              }
            : undefined,
      });
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
    // A recusa do alias `~` (RN-679) tem título próprio e a frase da api, que
    // nomeia os modelos recusados — "não foi possível salvar" esconderia o
    // motivo e o lote inteiro parece ter falhado por acaso.
    onError: (erro) => {
      const recusa = recusaDeAliasLivre(erro);
      showToast(
        recusa
          ? {
              title: t('catalog.toasts.aliasRefused'),
              message: recusa,
              tone: 'danger',
            }
          : { title: t('catalog.toasts.saveError'), tone: 'danger' },
      );
    },
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
    <div className={styles.section} id="catalogo-de-modelos-lista">
      <div className={styles.header}>
        <div>
          <div className={styles.tituloLinha}>
            <h2 className={styles.title}>{t('catalog.title')}</h2>
            <span className={styles.eyebrow}>{t('catalog.eyebrow')}</span>
          </div>
          <div className={styles.subtitle}>{t('catalog.subtitle')}</div>
        </div>
        <div className={styles.acoes}>
          {(atual?.subgrupos?.length ?? 0) > 0 && (
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
        <input
          type="search"
          className={styles.busca}
          aria-label={t('catalog.search.aria')}
          placeholder={t('catalog.search.placeholder')}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      )}

      {buscando && totalVisivel === 0 && (
        <Alert tone="accent">{t('catalog.search.noMatch', { term: busca.trim() })}</Alert>
      )}

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

      {filtrando && !buscando && totalVisivel === 0 && (
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
          {/* A explicação do lote mora numa LINHA PRÓPRIA (AT-373): ao lado
              dos botões ela virava coluna estreita e empurrava a barra além
              da largura da página. */}
        </div>
      )}

      {/* Só quando o catálogo é REALMENTE vazio: com filtro ligado, mandar
          cadastrar credencial seria mentira — a credencial existe e o modelo
          também, quem escondeu foi a faceta. */}
      {totalSemFiltro === 0 && (
        <div className={styles.vazio}>{t('catalog.empty')}</div>
      )}

      {deFora.length > 0 && (
        <p className={styles.subtitle}>
          {t('catalog.tabs.outside', {
            count: deFora.length,
            names: deFora.map((p) => ROTULO_DO_PROVIDER[p] ?? p).join(', '),
          })}
        </p>
      )}

      {abas.length > 0 && abaAtiva && atual && (
        <>
          <Tabs
            items={abas.map((a) => ({
              key: a.provider,
              label: a.semChave
                ? `${ROTULO_DO_PROVIDER[a.provider] ?? a.provider} · ${t('catalog.tabs.noKey')}`
                : (ROTULO_DO_PROVIDER[a.provider] ?? a.provider),
              count: naAba(a.provider).modelos.length,
              cor: COR_DO_PROVIDER[a.provider],
            }))}
            active={abaAtiva.provider}
            onChange={setAbaEscolhida}
          />
          <div role="tabpanel" aria-label={t('catalog.tabs.aria')}>
            {abaAtiva.semChave && <Alert tone="warning">{t('catalog.tabs.noKeyNote')}</Alert>}
            {filtrando && atual.modelos.length === 0 && comMatch.length > 0 && (
              <Alert tone="accent">
                {t('catalog.tabs.noMatchHere', {
                  provider: ROTULO_DO_PROVIDER[abaAtiva.provider] ?? abaAtiva.provider,
                  tabs: comMatch
                    .map((a) => ROTULO_DO_PROVIDER[a.provider] ?? a.provider)
                    .join(', '),
                })}
              </Alert>
            )}
            {/* Um hub serve o catálogo de dezenas de fabricantes numa lista só
                — 338, no caso do OpenRouter. Repartir por quem serve por baixo
                é o que torna a lista navegável. */}
            {atual.subgrupos
              ? atual.subgrupos.map((sub) => {
                  const aberto = buscando || subgruposAbertos.has(sub.upstream);
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
              : atual.modelos.map((model) => (
                  <LinhaDoCatalogo
                    key={model.id}
                    model={model}
                    marcado={marcados.has(model.id)}
                    onToggle={() => alternar(model.id)}
                  />
                ))}
          </div>
        </>
      )}

      <HuggingFaceModelBrowser workspaceId={workspaceId} />
      {marcados.size > 0 && <div className={styles.respiroDaBarraDeLote} aria-hidden="true" />}
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
              {[
                t('catalog.syncReport.novos', { count: r.descobertos }),
                t('catalog.syncReport.deVolta', { count: r.reencontrados }),
                t('catalog.syncReport.sumidos', { count: r.indisponibilizados }),
              ].join(' · ')}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * A frase da recusa do alias de roteamento livre (422
 * `alias_de_roteamento_livre`, RN-679), ou `null` para qualquer outro erro.
 * Casa pelo `code` do corpo, nunca pelo texto, que muda de idioma.
 */
function recusaDeAliasLivre(erro: unknown): string | null {
  const body = (erro as { body?: { code?: unknown; message?: unknown } } | null)
    ?.body;
  if (body?.code !== 'alias_de_roteamento_livre') return null;
  return typeof body.message === 'string' ? body.message : null;
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
        {/* O motivo em TEXTO, na linha: o alias `~` fica visível (inclusive o
            curado antes da regra, que segue ativo) e a tela diz por que ele
            não pode ser ativado antes de alguém tentar (RN-679). */}
        {model.freeRoutingAlias && (
          <span className={styles.motivoDoAlias}>
            {t('catalog.freeRoutingAliasReason')}
          </span>
        )}
      </span>
      <span className={styles.selos}>
        <Badge tone={model.isActive ? 'success' : 'muted'}>
          {model.isActive ? t('badges.active') : t('badges.inactive')}
        </Badge>
        {indisponivel && <Badge tone="warning">{t('badges.unavailable')}</Badge>}
        {model.freeRoutingAlias && (
          <Badge tone="warning">{t('badges.freeRoutingAlias')}</Badge>
        )}
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
