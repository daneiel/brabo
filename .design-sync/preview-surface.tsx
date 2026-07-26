/*
 * Superfície do design system — o wrapper que dá contexto de cor a tudo.
 *
 * POR QUE ISTO EXISTE
 *
 * Este DS é DARK-primário: `:root` define `--surface-0` como petróleo escuro e
 * `--text-primary` como areia clara; o tema claro só entra com
 * `[data-theme="light"]`. Os componentes não pintam o próprio fundo — eles
 * assumem estar sobre a superfície do DS e herdam a cor de texto dela (os
 * ícones, inclusive, desenham com `currentColor`).
 *
 * Na app isso vem do `body` em apps/web/src/index.css. Fora dela, é preciso
 * alguém declarar a superfície — e o template de card do conversor faz o
 * oposto: fixa `body{background:#fff}` num `<style>` inline DEPOIS dos
 * stylesheets. Sem este wrapper, todos os 57 cards renderizam claro-sobre-claro
 * e o render check marca ícones e textos como `blank`/`thin`.
 *
 * Está registrado em `cfg.provider`, então envolve todo preview e é o que o
 * `.prompt.md` manda o agente de design usar. Por isso ele declara SÓ o que é
 * verdade para qualquer contexto — cor, fonte e altura. Nada de padding ou
 * border-radius: numa tela de verdade, isso viraria uma caixa arredondada
 * estranha no meio do design, e a orientação do prompt ficaria errada.
 */
import type { ReactNode } from 'react';

export function BraboSurface({ children }: { children?: ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--surface-0)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-body)',
        // Sem altura, a superfície vira uma faixa rente ao topo e o resto do
        // card (ou da página) continua com o fundo de quem está por baixo.
        // 48px é o padding vertical que o template do card põe no body.
        minHeight: 'calc(100vh - 48px)',
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  );
}
