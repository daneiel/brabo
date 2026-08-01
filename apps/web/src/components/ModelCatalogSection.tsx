import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listModelCatalog,
  setModelsActive,
  syncModelCatalog,
} from '../lib/api-client';
import type { Model, ResultadoDoSync } from '../lib/api-types';
import { agruparModelos, formatarJanela, formatarPreco } from '../lib/models';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { useToast } from './ui/ToastProvider';
import styles from './ModelCatalogSection.module.css';

/**
 * Curadoria do catálogo (Fase 9c, RN-041).
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

  const { data: catalogo } = useQuery({
    queryKey: ['model-catalog', workspaceId],
    queryFn: () => listModelCatalog(workspaceId),
  });

  const grupos = useMemo(
    () => (catalogo ? agruparModelos(catalogo) : []),
    [catalogo],
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
          <div className={styles.title}>Catálogo de modelos</div>
          <div className={styles.subtitle}>
            O que o sync descobre entra desativado. Só o que você ativar aparece
            no seletor de modelos.
          </div>
        </div>
        <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
          {sync.isPending ? 'Sincronizando…' : 'Atualizar catálogo'}
        </Button>
      </div>

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
          <div className={styles.grupoTitulo}>{grupo.rotulo}</div>
          {grupo.modelos.map((model) => (
            <LinhaDoCatalogo
              key={model.id}
              model={model}
              marcado={marcados.has(model.id)}
              onToggle={() => alternar(model.id)}
            />
          ))}
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
  model: Model;
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
