import { memo, type CSSProperties, type ElementType } from 'react';
import { LazyMotion, domAnimation, m, useReducedMotion } from 'motion/react';
import styles from './Shimmer.module.css';

/*
 * Texto de algo EM CURSO com um brilho que corre da direita para a esquerda —
 * o Shimmer do AI Elements (ADR 0210), adaptado a CSS Modules e aos tokens de
 * `design/tokens.css`. `motion` mora SÓ aqui: nenhum outro componente o importa.
 *
 * O texto fica no DOM (leitor de tela lê a frase); `role`/`aria-live` são de
 * quem chama. Com reduced motion o texto fica estático na cor-base.
 */

type Props = {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
};

// `m.create(tag)` uma vez por tag, no módulo: criar no render remontaria o nó.
const cacheDeComponente = new Map<ElementType, ElementType>();
function componenteDe(tag: ElementType): ElementType {
  let c = cacheDeComponente.get(tag);
  if (!c) {
    c = m.create(tag as never) as unknown as ElementType;
    cacheDeComponente.set(tag, c);
  }
  return c;
}

function ShimmerComponent({ children, as = 'span', className, duration = 2, spread = 2 }: Props) {
  const reduzir = useReducedMotion();
  if (reduzir) {
    const Tag = as;
    return <Tag className={[styles.estatico, className].filter(Boolean).join(' ')}>{children}</Tag>;
  }
  const Componente = componenteDe(as);
  const style = { '--spread': `${children.length * spread}px` } as CSSProperties;
  return (
    <LazyMotion features={domAnimation}>
      <Componente
        className={[styles.shimmer, className].filter(Boolean).join(' ')}
        style={style}
        initial={{ backgroundPosition: '100% center' }}
        animate={{ backgroundPosition: '0% center' }}
        transition={{ duration, ease: 'linear', repeat: Infinity }}
      >
        {children}
      </Componente>
    </LazyMotion>
  );
}

export const Shimmer = memo(ShimmerComponent);
