import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Model, ModelsByCategory } from '../lib/api-types';
import { agruparModelos, formatarJanela, formatarPreco } from '../lib/models';
import { Badge } from './ui/Badge';
import { ChevronDownIcon, ModelIcon } from './ui/icons';
import styles from './ModelPicker.module.css';
import { Checkbox } from './shadcn/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from './shadcn/popover';

/**
 * O handoff (`design_handoff_brabo/README.md`, seção 7 "Dropdown de modelo")
 * pede um badge verde **ideal** em cada opção "quando o modelo cobre TODAS as
 * capacidades exigidas pelo agente". Investigado e NÃO construído — ver
 * ADR 0077.
 *
 * O motivo é duplo, e o segundo por si só já fecharia a questão:
 *
 * 1. "Capacidades exigidas por agente" não existe no domínio. A tabela de
 *    bindings (`ModelsSection`, `ProjectSettingsTab.tsx`) já registrou isso
 *    ao renomear a coluna de "Agente · capacidades" para só "Agente" —
 *    prometer aqui o que já foi recusado ali reabriria a mesma lacuna.
 * 2. Mesmo que existisse, este picker não tem como LER capacidade curada
 *    (`uses`, ADR 0051): ele recebe `Model` de `GET /projects/:id/models`
 *    (papel `viewer`), e `uses` só existe em `ModelComCuradoria`, de
 *    `GET /workspaces/:id/models/catalog` (papel `maintainer`). Buscar a
 *    segunda rota para pintar um badge no seletor de um `developer`
 *    alargaria o que ele pode LER — mudança de RBAC, decisão de produto,
 *    fora do escopo desta frente.
 */

// Largura e teto de altura do dropdown; o Popover posiciona e vira para cima
// sozinho, e `--available-height` impede que ele passe do viewport.
const ESTILO_DO_DROPDOWN = {
  width: 320,
  maxHeight: 'min(360px, var(--available-height, 360px))',
  padding: 0,
  gap: 0,
  overflowY: 'auto',
} as const;

interface ModelPickerProps {
  models: ModelsByCategory;
  selectedModelId?: string;
  onSelect: (model: Model) => void;
  variant?: 'topbar' | 'inline' | 'standalone';
  /**
   * Liga o filtro "aptos para agentes" JÁ MARCADO (Fase 9c). A mensagem da
   * RN-040 manda o usuário para este filtro desde a Fase 9a.
   *
   * A régua de quem passa é o ESCOPO do binding que o picker grava, e ela tem
   * uma fonte só do outro lado: `assertModelFitsBindingScope`
   * (`domain/llm/model-capabilities.ts`) exige tool calling em `agent` e em
   * `area`, e em mais nenhum. Então ligam o filtro as duas telas que gravam
   * nesses escopos — `ModelsSection` (agente e caixa da área) —,
   * e o seletor de SESSÃO não liga: ali a api aceita modelo chat-only de
   * propósito (uma sessão sem ferramenta na mão é conversa), e marcar o filtro
   * esconderia o que o domínio permite. O filtro segue o que a api RECUSA;
   * onde ela não recusa, quem escolhe é a pessoa.
   *
   * Isto é o estado INICIAL de um checkbox, nunca uma trava: desmarcar volta a
   * listar o catálogo inteiro.
   */
  filtroDeAgentesPadrao?: boolean;
  /**
   * Some sem o gatilho abrir (ADR 0064) — quem não tem `maintainer` VÊ o
   * modelo vigente da área mas não consegue trocá-lo. Ficou no picker, e não
   * num overlay do chamador, porque o overlay não bloquearia o teclado.
   */
  disabled?: boolean;
}

export function ModelPicker({
  models,
  selectedModelId,
  onSelect,
  variant = 'standalone',
  filtroDeAgentesPadrao = false,
  disabled = false,
}: ModelPickerProps) {
  const { t } = useTranslation('models');
  const [open, setOpen] = useState(false);
  const [soAptos, setSoAptos] = useState(filtroDeAgentesPadrao);
  const grupos = useMemo(
    () => agruparModelos(models, { somenteAptosParaAgentes: soAptos }),
    [models, soAptos],
  );
  const todosOsModelos = useMemo(() => agruparModelos(models), [models]).flatMap(
    (g) => g.modelos,
  );
  // Procura no conjunto INTEIRO, não no filtrado: o vigente precisa aparecer no
  // gatilho mesmo quando o filtro o esconde da lista.
  const selected = todosOsModelos.find((m) => m.id === selectedModelId);

  /**
   * O vigente que o filtro tira da LISTA — e que por isso precisa ser dito.
   *
   * Não é caso de borda desde que as telas de agente e de área abrem com o
   * filtro marcado: as rotas que resolvem o binding (`GET .../agent-bindings/
   * :slug`, `GET .../area-bindings/:key`) chamam `ResolveModelBindingUseCase`
   * SEM `exigeToolCalling`, então um padrão chat-only de projeto ou workspace
   * é resolvido e vira o vigente da linha. Aí o gatilho mostra um nome que a
   * lista aberta não contém, e nenhuma opção aparece marcada — a tela
   * afirmando um estado e o contradizendo logo abaixo, que é o que a RN-470
   * proíbe.
   *
   * A causa é NOMEÁVEL porque só há um filtro aqui: `agruparModelos` também
   * aceita facetas e usos, mas este picker não passa nenhuma das duas, então
   * sumir da lista com `soAptos` ligado só pode ser falta de tool calling.
   *
   * Fica de fora quando a lista inteira está vazia: ali o `noToolCallingModels`
   * já explica o mesmo com uma frase mais completa, e dois avisos mandando
   * desmarcar o mesmo checkbox seriam ruído.
   */
  const vigenteEscondido =
    soAptos && grupos.length > 0 && selected && !selected.supportsToolCalling
      ? selected
      : undefined;

  function pick(model: Model) {
    onSelect(model);
    setOpen(false);
  }

  return (
    <div className={[styles.wrapper, variant === 'inline' && styles.inline].filter(Boolean).join(' ')}>
      <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={styles.trigger}
        disabled={disabled}
        // O nome elipsa dentro da célula; o `title` é o que devolve o nome
        // INTEIRO sem abrir o dropdown. `deepseek-v4-flash-latest` e
        // `deepseek-v4-flash-preview` são indistinguíveis truncados.
        title={selected?.displayName}
      >
        <span className={styles.triggerIcon}>
          <ModelIcon size={variant === 'inline' ? 13 : 14} />
        </span>
        {/* O nome ELIPSA em vez de esticar o gatilho: dentro da célula da
            tabela de bindings, um `displayName` longo empurrava as colunas de
            origem e fallback para fora da grade. */}
        <span className={styles.triggerLabel}>
          {selected ? selected.displayName : t('picker.selectModel')}
        </span>
        {/* Chevron também no `inline`: no desenho o seletor de modelo da tabela
            tem chevron, e sem ele o botão não se anuncia como abrível. */}
        {variant !== 'standalone' && (
          <span className={styles.chevron}>
            <ChevronDownIcon size={13} />
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className={styles.dropdown}
        style={ESTILO_DO_DROPDOWN}
      >
          <label className={styles.filtro}>
            <Checkbox checked={soAptos} onCheckedChange={setSoAptos} />
            {t('picker.filterFitForAgents')}
          </label>

          {vigenteEscondido && (
            <div className={styles.vigenteEscondido}>
              {t('picker.currentHiddenByFilter', {
                model: vigenteEscondido.displayName,
              })}
            </div>
          )}

          {todosOsModelos.length === 0 && (
            <div className={styles.groupHeader}>{t('picker.noModelsRegistered')}</div>
          )}
          {todosOsModelos.length > 0 && grupos.length === 0 && (
            <div className={styles.vazio}>{t('picker.noToolCallingModels')}</div>
          )}
          {grupos.map((grupo) => (
            <div key={grupo.kind}>
              <div className={styles.groupHeader}>{grupo.rotulo}</div>
              {grupo.modelos.map((model) => (
                <ModelOption
                  key={model.id}
                  model={model}
                  selected={model.id === selectedModelId}
                  onClick={() => pick(model)}
                />
              ))}
            </div>
          ))}
      </PopoverContent>
      </Popover>
    </div>
  );
}

function ModelOption({ model, selected, onClick }: { model: Model; selected: boolean; onClick: () => void }) {
  const { t } = useTranslation('models');
  const isFree = model.provider === 'ollama';
  const indisponivel = model.availability === 'unavailable';
  const janela = formatarJanela(model);

  return (
    <button
      type="button"
      className={[styles.option, selected && styles.selected, indisponivel && styles.indisponivel]
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
    >
      <span className={[styles.radio, selected && styles.checked].filter(Boolean).join(' ')}>
        {selected && <span className={styles.radioDot} />}
      </span>
      <span className={styles.corpo}>
        <span className={styles.optionName}>
          {model.displayName}
          {!isFree && <span className={styles.optionProvider}> · {model.provider}</span>}
        </span>
        <span className={styles.selos}>
          <Badge tone={isFree ? 'success' : 'muted'}>{formatarPreco(model)}</Badge>
          {janela && <Badge tone="muted">{janela}</Badge>}
          {model.supportsToolCalling && (
            <Badge tone="accent">{t('badges.toolCalling')}</Badge>
          )}
          {/* AT-443: o selo do catálogo (`ModelCatalogSection`) — quem escolhe
              o modelo aqui também precisa saber se ele raciocina. */}
          {model.supportsReasoning && <Badge tone="accent">{t('badges.thinking')}</Badge>}
          {/* Indisponível aparece MARCADO, nunca some: um modelo ausente da
              lista deixaria o binding que aponta pra ele sem explicação. */}
          {indisponivel && <Badge tone="warning">{t('badges.unavailable')}</Badge>}
        </span>
      </span>
    </button>
  );
}
