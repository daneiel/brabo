import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listCredentials,
  listModelCatalog,
  setModelsActive,
  syncModelCatalog,
} from '../lib/api-client';
import type { ModelComCuradoria, ResultadoDoSync } from '../lib/api-types';
import {
  ROTULO_DO_PROVIDER,
  agruparModelos,
  formatarJanela,
  formatarPreco,
} from '../lib/models';
import { Alert } from './ui/Alert';
import { ChevronDownIcon, ChevronRightIcon } from './ui/icons';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
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
    () => (catalogo ? agruparModelos(catalogo) : []),
    [catalogo],
  );

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
      showToast({ title: 'Catálogo sincronizado', tone: 'success' });
      return resultado;
    },
    onError: () =>
      showToast({
        title: 'Sync falhou',
        message: 'A api não respondeu. Nada foi alterado no catálogo.',
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
        title: isActive ? 'Modelos ativados' : 'Modelos desativados',
        tone: 'success',
      });
    },
    onError: () =>
      showToast({ title: 'Não foi possível salvar', tone: 'danger' }),
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
            <h2 className={styles.title}>Catálogo de modelos</h2>
            <span className={styles.eyebrow}>curadoria por workspace</span>
          </div>
          <div className={styles.subtitle}>
            O que o sync descobre entra desativado. Só o que você ativar aparece
            no seletor de modelos.
          </div>
        </div>
        <div className={styles.acoes}>
          {grupos.length > 0 && (
            <Button variant="ghost" onClick={alternarTudo}>
              {tudoMinimizado ? 'Expandir tudo' : 'Minimizar tudo'}
            </Button>
          )}
          <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? 'Sincronizando…' : 'Atualizar catálogo'}
          </Button>
        </div>
      </div>

      {semCatalogo.length > 0 && (
        <Alert tone="warning">
          Você tem credencial de{' '}
          <strong>
            {semCatalogo.map((p) => ROTULO_DO_PROVIDER[p]).join(', ')}
          </strong>{' '}
          e nenhum modelo {semCatalogo.length > 1 ? 'deles' : 'dele'} no
          catálogo. Cadastrar a chave não descobre modelo — clique em{' '}
          <strong>Atualizar catálogo</strong> para buscá-los no provider.
        </Alert>
      )}

      {sync.data && <RelatorioDoSync resultados={sync.data.porProvider} />}

      {marcados.size > 0 && (
        <div className={styles.barraDeLote}>
          <span className={styles.contagem}>
            {marcados.size} selecionado{marcados.size > 1 ? 's' : ''}
          </span>
          <Button onClick={() => ativar.mutate(true)} disabled={ativar.isPending}>
            Ativar
          </Button>
          <Button
            variant="danger"
            onClick={() => ativar.mutate(false)}
            disabled={ativar.isPending}
          >
            Desativar
          </Button>
        </div>
      )}

      {grupos.length === 0 && (
        <div className={styles.vazio}>
          Nenhum modelo no catálogo. Cadastre uma credencial de provider e
          atualize.
        </div>
      )}

      {grupos.map((grupo) => (
        <div key={grupo.kind} className={styles.grupo}>
          <button
            type="button"
            className={styles.grupoTitulo}
            aria-expanded={!gruposFechados.has(grupo.kind)}
            onClick={() => alternarGrupo(grupo.kind)}
          >
            <span className={styles.chevron}>
              {gruposFechados.has(grupo.kind) ? (
                <ChevronRightIcon size={13} />
              ) : (
                <ChevronDownIcon size={13} />
              )}
            </span>
            {grupo.rotulo}
            {/* "Hubs" sozinho não diz de QUEM é o catálogo — e preço,
                disponibilidade e credencial pertencem ao hub, não ao fabricante
                do modelo. Nos outros grupos o provider já é evidente na linha. */}
            {grupo.kind === 'hub' && (
              <span className={styles.grupoProvedores}>
                ·{' '}
                {grupo.provedores
                  .map((p) => ROTULO_DO_PROVIDER[p] ?? p)
                  .join(', ')}
              </span>
            )}
            <span className={styles.grupoContagem}>{grupo.modelos.length}</span>
          </button>

          {/* Um hub serve o catálogo de dezenas de fabricantes numa lista só —
              338, no caso do OpenRouter. Repartir por quem serve por baixo é o
              que torna a lista navegável; sem isso, achar o Claude é rolagem. */}
          {!gruposFechados.has(grupo.kind) &&
            (grupo.subgrupos
            ? grupo.subgrupos.map((sub) => {
                const aberto = subgruposAbertos.has(sub.upstream);
                const marcadosAqui = sub.modelos.filter((m) =>
                  marcados.has(m.id),
                ).length;
                return (
                  <div key={sub.upstream} className={styles.subgrupo}>
                    <button
                      type="button"
                      className={styles.subgrupoTitulo}
                      aria-expanded={aberto}
                      onClick={() => alternarSubgrupo(sub.upstream)}
                    >
                      <span className={styles.chevron}>
                        {aberto ? (
                          <ChevronDownIcon size={12} />
                        ) : (
                          <ChevronRightIcon size={12} />
                        )}
                      </span>
                      {sub.rotulo}
                      <span className={styles.grupoContagem}>
                        {sub.modelos.length}
                      </span>
                      {/* Fechado com itens marcados: sem este selo, a barra
                          diria "12 selecionados" e você não teria como ver
                          QUAIS — ativaria em lote às cegas. */}
                      {!aberto && marcadosAqui > 0 && (
                        <span className={styles.marcadosOcultos}>
                          {marcadosAqui} marcado{marcadosAqui > 1 ? 's' : ''}
                        </span>
                      )}
                    </button>
                    {aberto &&
                      sub.modelos.map((model) => (
                        <LinhaDoCatalogo
                          key={model.id}
                          model={model}
                          marcado={marcados.has(model.id)}
                          onToggle={() => alternar(model.id)}
                        />
                      ))}
                  </div>
                );
              })
            : grupo.modelos.map((model) => (
                <LinhaDoCatalogo
                  key={model.id}
                  model={model}
                  marcado={marcados.has(model.id)}
                  onToggle={() => alternar(model.id)}
                />
              )))}
        </div>
      ))}
    </div>
  );
}

/**
 * Nenhum provider some do relatório — nem o que foi pulado. "Não sei o que tem
 * lá" não é "não tem nada lá", e o motivo do pulo (com a ORIGEM da falha, no
 * vocabulário do ADR 0020) é o que evita diagnóstico por eliminação.
 */
function RelatorioDoSync({ resultados }: { resultados: ResultadoDoSync[] }) {
  return (
    <div className={styles.relatorio}>
      {resultados.map((r) => (
        <div key={r.provider} className={styles.relatorioLinha}>
          <span className={styles.relatorioProvider}>{r.provider}</span>
          {r.pulado ? (
            <Badge tone={r.pulado === 'falha' ? 'danger' : 'muted'}>
              {r.pulado === 'sem_capability' && 'sem listagem de catálogo'}
              {r.pulado === 'sem_credencial' && 'sem credencial cadastrada'}
              {r.pulado === 'falha' && `falhou · origem ${r.origemDaFalha}`}
            </Badge>
          ) : (
            <span className={styles.relatorioNumeros}>
              {r.descobertos} novo(s) · {r.reencontrados} de volta ·{' '}
              {r.indisponibilizados} sumido(s)
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
          {model.isActive ? 'ativo' : 'desativado'}
        </Badge>
        {indisponivel && (
          <Badge tone="warning">indisponível no provider</Badge>
        )}
        <Badge tone="muted">{formatarPreco(model)}</Badge>
        {janela && <Badge tone="muted">{janela}</Badge>}
        {model.supportsToolCalling && <Badge tone="accent">tool calling</Badge>}
        {model.manualPricing && <Badge tone="muted">preço manual</Badge>}
      </span>
    </label>
  );
}
