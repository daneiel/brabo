import { useSyncExternalStore } from 'react';

/**
 * RN-831 (AT-503): a mensagem cujo envio FALHOU não some do fio.
 *
 * Antes, o `catch` de `enviarMensagem` (`SessionPage.tsx`) apagava a bolha
 * otimista e deixava só um toast — o texto sumia da tela. Agora o `catch`
 * marca a mensagem aqui, e o fio (`SessionFio.tsx`) a desenha com o selo
 * "não enviada · tentar de novo"; o clique reenvia ao MESMO destinatário.
 *
 * Mora num store de módulo, e não em estado da `SessionPage`, porque a página
 * está no teto de linhas (`SessionPage.teto.test.ts`): o `catch` ganha UMA
 * linha, o resto mora aqui e no fio. Há uma mensagem não enviada por vez — a
 * próxima tentativa (ou o próximo envio) a substitui.
 */
export type MensagemNaoEnviada = {
  texto: string;
  /** Reenvia o MESMO texto ao MESMO destinatário. */
  reenviar: () => void;
};

let atual: MensagemNaoEnviada | null = null;
const ouvintes = new Set<() => void>();

function avisar() {
  for (const ouvinte of ouvintes) ouvinte();
}

export function marcarMensagemNaoEnviada(mensagem: MensagemNaoEnviada): void {
  atual = mensagem;
  avisar();
}

export function limparMensagemNaoEnviada(): void {
  if (atual === null) return;
  atual = null;
  avisar();
}

function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function useMensagemNaoEnviada(): MensagemNaoEnviada | null {
  return useSyncExternalStore(
    assinar,
    () => atual,
    () => atual,
  );
}
