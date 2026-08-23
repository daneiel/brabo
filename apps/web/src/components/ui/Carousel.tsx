import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import styles from './Carousel.module.css';

export interface CarouselSlide {
  key: string;
  node: ReactNode;
  /** Rótulo curto do slide (ex.: título da história) — anuncia no dot e na contagem. */
  label?: string;
}

interface CarouselProps {
  /** Nome do grupo pro leitor de tela — o que está sendo navegado. */
  ariaLabel: string;
  slides: CarouselSlide[];
  /** Ação extra no cabeçalho, ao lado da contagem — ex.: "Aprovar todas". */
  headerActions?: ReactNode;
  className?: string;
}

/**
 * Carrossel genérico, navegação item-por-item (RN-148) — primeiro do design
 * system. Nasceu do card de promoção de história em `SessionPage.tsx`
 * (`backlog.story_promotion_proposed`, RN-126): quando o PO produz várias
 * histórias na mesma leva, N cards avulsos na timeline viravam ruído — o
 * carrossel troca N cards por UM, navegável.
 *
 * Não é um componente de "lista com paginação": existe UM slide ativo por
 * vez, e é ele — só ele — que fica montado no DOM (`atual?.node`, nunca
 * `slides.map`). Isso importa porque cada slide aqui é um card ACIONÁVEL com
 * estado próprio (botões Promover/Devolver): montar os N ao mesmo tempo
 * multiplicaria o trabalho por nada, já que só um é visível.
 *
 * Índice é sempre CLAMPADO ao tamanho atual de `slides` (nunca guardado
 * separado dele) — a lista pode encolher enquanho o carrossel está aberto
 * (uma história do meio é promovida e sai da leva) sem deixar o índice
 * apontando pro vazio.
 */
export function Carousel({ ariaLabel, slides, headerActions, className }: CarouselProps) {
  const { t } = useTranslation('ui');
  const [indiceBruto, setIndiceBruto] = useState(0);

  if (slides.length === 0) return null;

  const indice = Math.min(indiceBruto, slides.length - 1);
  const atual = slides[indice];

  function ir(proximo: number) {
    setIndiceBruto(Math.max(0, Math.min(slides.length - 1, proximo)));
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      ir(indice + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      ir(indice - 1);
    }
  }

  return (
    <div
      className={[styles.carousel, className].filter(Boolean).join(' ')}
      role="group"
      aria-roledescription={t('carousel.roleDescription')}
      aria-label={ariaLabel}
    >
      <div className={styles.cabecalho}>
        <span className={styles.contagem}>
          {t('carousel.counter', { current: indice + 1, total: slides.length })}
        </span>
        {headerActions}
      </div>

      {/* A região recebe as setas do teclado; o conteúdo em si (botões)
          continua alcançável por Tab normalmente. */}
      <div
        className={styles.viewport}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-live="polite"
        aria-label={
          atual?.label
            ? t('carousel.slideLabelNamed', { index: indice + 1, label: atual.label })
            : t('carousel.slideLabel', { index: indice + 1 })
        }
      >
        {atual?.node}
      </div>

      <div className={styles.controles}>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('carousel.previousLabel')}
          disabled={indice === 0}
          onClick={() => ir(indice - 1)}
        >
          <ChevronLeftIcon size={14} />
        </Button>

        <div className={styles.dots} role="tablist" aria-label={t('carousel.dotsGroupLabel')}>
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={i === indice}
              aria-label={
                s.label
                  ? t('carousel.dotLabelNamed', { index: i + 1, label: s.label })
                  : t('carousel.dotLabel', { index: i + 1 })
              }
              className={[styles.dot, i === indice && styles.dotAtivo].filter(Boolean).join(' ')}
              onClick={() => ir(i)}
            />
          ))}
        </div>

        <Button
          type="button"
          variant="ghost"
          aria-label={t('carousel.nextLabel')}
          disabled={indice === slides.length - 1}
          onClick={() => ir(indice + 1)}
        >
          <ChevronRightIcon size={14} />
        </Button>
      </div>
    </div>
  );
}
