import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Model, ModelsByCategory } from '../lib/api-types';
import { agruparModelos, formatarJanela, formatarPreco } from '../lib/models';
import { Badge } from './ui/Badge';
import { ChevronDownIcon, ModelIcon } from './ui/icons';
import styles from './ModelPicker.module.css';

// Precisa casar com .dropdown no CSS — o cálculo de posição depende disso.
const DROPDOWN_WIDTH = 320;
const DROPDOWN_MAX_HEIGHT = 360;
const GAP = 6;
const MARGEM_VIEWPORT = 8;

interface ModelPickerProps {
  models: ModelsByCategory;
  selectedModelId?: string;
  onSelect: (model: Model) => void;
  variant?: 'topbar' | 'inline' | 'standalone';
  /**
   * Liga o filtro "aptos para agentes" JÁ MARCADO (Fase 9c). É o que a tela de
   * binding de agente passa: a mensagem da RN-040 manda o usuário para este
   * filtro desde a Fase 9a, e até agora ele não existia.
   */
  filtroDeAgentesPadrao?: boolean;
}

export function ModelPicker({
  models,
  selectedModelId,
  onSelect,
  variant = 'standalone',
  filtroDeAgentesPadrao = false,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [soAptos, setSoAptos] = useState(filtroDeAgentesPadrao);
  const [posicao, setPosicao] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // O dropdown é `fixed` e vive FORA do wrapper na árvore de layout, mas
  // continua filho dele no DOM — a ref existe para distinguir "rolou a lista"
  // de "rolou a página" no listener de captura.
  const dropdownRef = useRef<HTMLDivElement>(null);

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
   * O dropdown é `position: fixed` ancorado no gatilho, não `absolute` dentro
   * do wrapper.
   *
   * Motivo: o picker vive dentro de uma `Table`, que tem `overflow: hidden`
   * (necessário pro border-radius recortar as linhas). Um filho `absolute` era
   * RECORTADO por esse overflow — nas últimas linhas (QA, SecOps) o dropdown
   * abria pra baixo e sumia inteiro, tornando a seleção impossível. `fixed`
   * escapa do clipping do ancestral, e daí dá pra virar pra cima quando não há
   * espaço embaixo.
   */
  useLayoutEffect(() => {
    if (!open) return;

    const gatilho = triggerRef.current?.getBoundingClientRect();
    if (gatilho) {
      const espacoAbaixo = window.innerHeight - gatilho.bottom - GAP - MARGEM_VIEWPORT;
      const espacoAcima = gatilho.top - GAP - MARGEM_VIEWPORT;
      const abreParaCima = espacoAbaixo < DROPDOWN_MAX_HEIGHT && espacoAcima > espacoAbaixo;
      const maxHeight = Math.max(120, Math.min(DROPDOWN_MAX_HEIGHT, abreParaCima ? espacoAcima : espacoAbaixo));

      setPosicao({
        top: abreParaCima ? gatilho.top - GAP - maxHeight : gatilho.bottom + GAP,
        // Não deixa vazar pela direita em tela estreita.
        left: Math.max(
          MARGEM_VIEWPORT,
          Math.min(gatilho.left, window.innerWidth - DROPDOWN_WIDTH - MARGEM_VIEWPORT),
        ),
        maxHeight,
      });
    }

    // Rolar a PÁGINA descola o `fixed` do gatilho — fechar é mais honesto que
    // perseguir o elemento a cada frame. Redimensionar invalida o cálculo de
    // posição pelo mesmo motivo.
    function fecha() {
      setOpen(false);
    }

    /**
     * Rolar DENTRO da lista não é rolar a página, e fechar aqui inutilizava o
     * componente: o listener era de captura e sem olhar o alvo, então a
     * primeira volta da roda do mouse sobre o dropdown o fechava — e a rolagem
     * seguia para a página atrás. Com `max-height: 360px` e mais modelos que
     * isso, os de baixo eram simplesmente inalcançáveis.
     */
    function aoRolar(evento: Event) {
      const alvo = evento.target as Node | null;
      if (alvo && dropdownRef.current?.contains(alvo)) return;
      fecha();
    }

    window.addEventListener('resize', fecha);
    window.addEventListener('scroll', aoRolar, true);
    return () => {
      window.removeEventListener('resize', fecha);
      window.removeEventListener('scroll', aoRolar, true);
    };
  }, [open]);

  // Fechar clicando fora e no Escape: sem isso o dropdown ficava aberto
  // indefinidamente — e agora que é `fixed`, sobreposto a qualquer coisa.
  useEffect(() => {
    if (!open) return;

    function onMouseDown(event: MouseEvent) {
      const alvo = event.target as Element | null;
      if (wrapperRef.current?.contains(alvo as Node)) return;
      if (alvo?.closest?.(`.${styles.dropdown}`)) return;
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function pick(model: Model) {
    onSelect(model);
    setOpen(false);
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        type="button"
        ref={triggerRef}
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.triggerIcon}>
          <ModelIcon size={14} />
        </span>
        {selected ? selected.displayName : 'Selecionar modelo'}
        {variant === 'topbar' && (
          <span className={styles.chevron}>
            <ChevronDownIcon size={13} />
          </span>
        )}
      </button>

      {open && posicao && (
        <div
          ref={dropdownRef}
          className={styles.dropdown}
          style={{ top: posicao.top, left: posicao.left, maxHeight: posicao.maxHeight }}
        >
          <label className={styles.filtro}>
            <input
              type="checkbox"
              checked={soAptos}
              onChange={(e) => setSoAptos(e.target.checked)}
            />
            aptos para agentes
          </label>

          {todosOsModelos.length === 0 && (
            <div className={styles.groupHeader}>Nenhum modelo cadastrado</div>
          )}
          {todosOsModelos.length > 0 && grupos.length === 0 && (
            <div className={styles.vazio}>
              Nenhum modelo faz tool calling nativo. Desmarque o filtro para ver
              os demais.
            </div>
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
        </div>
      )}
    </div>
  );
}

function ModelOption({ model, selected, onClick }: { model: Model; selected: boolean; onClick: () => void }) {
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
          {model.supportsToolCalling && <Badge tone="accent">tool calling</Badge>}
          {/* Indisponível aparece MARCADO, nunca some: um modelo ausente da
              lista deixaria o binding que aponta pra ele sem explicação. */}
          {indisponivel && <Badge tone="warning">indisponível no provider</Badge>}
        </span>
      </span>
    </button>
  );
}
