import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mensagemDaApi } from '../../lib/api-client';
import { useToast } from '../../components/ui/ToastProvider';

/** Uma linha que a aplicação em lote alcança: a chave que vai na api, o nome que vai na tela. */
export interface AlvoDaAplicacao {
  chave: string;
  /** O nome que a pessoa lê na tabela — é ele que o relatório parcial NOMEIA, nunca a chave. */
  nome: string;
}

interface ConfigDeAplicacao {
  alvos: AlvoDaAplicacao[];
  /** Uma chamada por alvo. Recusa LANÇA — é assim que a falha entra no relatório. */
  aplicar: (chave: string) => Promise<unknown>;
  /** Releitura das linhas que a api CONFIRMOU. Só roda se ao menos uma passou. */
  aoConcluir?: (chaves: string[]) => Promise<unknown> | void;
  /** A frase de sucesso da própria seção, que sabe nomear o valor aplicado. */
  sucessoDeTodos: (total: number) => string;
  /** O que dizer quando a api falha sem mensagem própria. */
  erroGenerico: string;
}

interface AplicacaoEmLote {
  aplicando: boolean;
  aplicarATodos: () => Promise<void>;
}

/**
 * Aplicar UM valor escolhido a N linhas de uma vez.
 *
 * ## Por que não é `useSecaoSalvavel`
 *
 * As duas fazem N chamadas e devem o mesmo relatório, e é por isso que
 * dividem o vocabulário dos toasts (`secao.toast.parcial*`) — mas a forma do
 * problema é outra, e forçar uma na outra deformaria as duas.
 *
 * `useSecaoSalvavel` é para N valores DIGITADOS, um por linha, cada um com o
 * seu rascunho: ele existe para saber quais linhas estão SUJAS, e a régua da
 * RN-469 diz que campo digitado precisa de confirmação. Aqui o valor é UM só,
 * NOMEADO, escolhido num seletor, e as N linhas não têm rascunho nenhum — não
 * há o que comparar com o servidor, e por isso não há `sujas`, `invalidas` nem
 * `MarcaDeNaoSalvo`. O que existe é uma AÇÃO sobre linhas que a pessoa não
 * editou uma a uma.
 *
 * ## Por que mesmo assim tem botão, e não aplica no `onChange`
 *
 * A régua da RN-469 diz que escolha de valor NOMEADO salva no `onChange`, e
 * esta é a exceção que a régua já contém: ela vale para o controle que grava o
 * PRÓPRIO valor. Aqui o seletor não é a configuração — ele é o ARGUMENTO de
 * uma ação que reescreve N linhas que a pessoa não estava editando. Aplicar no
 * `onChange` faria um clique exploratório num dropdown sobrescrever as N, e o
 * desfazer disso é N cliques. O botão nomeia quantas linhas vai alcançar
 * justamente porque esse número é a consequência.
 *
 * ## O que ele nunca faz
 *
 * Não é transação, e a tela não afirma o que não obteve (RN-469): as chamadas
 * são em SÉRIE, na ordem da tela, e uma recusa NÃO interrompe as seguintes —
 * quem clicou pediu as N. O desfecho tem os mesmos três estados que nunca se
 * disfarçam um do outro: todas passaram, NENHUMA passou (a mensagem da api,
 * nunca uma contagem), ALGUMAS passaram (quantas de quantas, NOMEANDO as que
 * ficaram). Só as linhas que a api confirmou são relidas.
 */
export function useAplicacaoEmLote({
  alvos,
  aplicar,
  aoConcluir,
  sucessoDeTodos,
  erroGenerico,
}: ConfigDeAplicacao): AplicacaoEmLote {
  const { t } = useTranslation('settings');
  const { showToast } = useToast();
  const [aplicando, setAplicando] = useState(false);

  async function aplicarATodos() {
    if (alvos.length === 0) return;
    setAplicando(true);
    const confirmadas: string[] = [];
    const falhas: { nome: string; erro: unknown }[] = [];
    try {
      for (const alvo of alvos) {
        try {
          await aplicar(alvo.chave);
          confirmadas.push(alvo.chave);
        } catch (erro) {
          falhas.push({ nome: alvo.nome, erro });
        }
      }

      if (confirmadas.length > 0) await aoConcluir?.(confirmadas);

      if (falhas.length === 0) {
        showToast({ title: sucessoDeTodos(confirmadas.length), tone: 'success' });
      } else if (confirmadas.length === 0) {
        showToast({
          title: mensagemDaApi(falhas[0].erro, erroGenerico),
          tone: 'danger',
        });
      } else {
        showToast({
          title: t('secao.toast.parcial', {
            salvas: confirmadas.length,
            total: alvos.length,
          }),
          message: t('secao.toast.parcialDetalhe', {
            itens: falhas.map((f) => f.nome).join(', '),
            motivo: mensagemDaApi(falhas[0].erro, erroGenerico),
          }),
          tone: 'warning',
        });
      }
    } finally {
      setAplicando(false);
    }
  }

  return { aplicando, aplicarATodos };
}
