import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mensagemDaApi } from '../../lib/api-client';
import { useToast } from '../../components/ui/ToastProvider';
import { Badge } from '../../components/ui/Badge';
import styles from '../ProjectSettingsTab.module.css';

/**
 * O que um texto digitado quer dizer, ou que ele não quer dizer nada.
 *
 * Duas variantes e não `{ valido: boolean; valor?: TValor }` porque `null` é um
 * VALOR legítimo aqui (o `Teto de gasto` vazio é "sem teto", que a api grava
 * como `budgetMicros: null`). Um campo opcional não distinguiria "não tem
 * valor" de "o valor é a ausência de teto", e foi exatamente essa confusão que
 * a `BudgetSection` já tinha resolvido no comentário do `numero`.
 */
export type Interpretacao<TValor> =
  | { valido: true; valor: TValor }
  | { valido: false };

interface ConfigDeSecao<TItem, TValor> {
  /** As linhas da seção, na ordem em que a tela as mostra. */
  itens: TItem[] | undefined;
  chaveDe: (item: TItem) => string;
  /** O valor que o SERVIDOR tem hoje, na forma em que o campo o mostra. */
  textoDoServidor: (item: TItem) => string;
  interpretar: (texto: string) => Interpretacao<TValor>;
  salvar: (chave: string, valor: TValor) => Promise<unknown>;
  /** Releitura depois de a api confirmar ALGUMA linha (invalidação da query). */
  aoConcluir?: () => Promise<unknown> | void;
  /** A frase que a seção já tinha para UMA linha salva, com o nome dela. */
  sucessoDeUm: (chave: string) => string;
  /** O que dizer quando a api falha sem mensagem própria. */
  erroGenerico: string;
}

interface SecaoSalvavel<TItem> {
  textoDe: (item: TItem) => string;
  editar: (chave: string, texto: string) => void;
  /** Chaves cujo rascunho difere do que o servidor tem. */
  sujas: string[];
  /** Subconjunto de `sujas` cujo texto não é interpretável. */
  invalidas: string[];
  salvando: boolean;
  podeSalvar: boolean;
  salvarSecao: () => Promise<void>;
}

/**
 * Um botão de salvar por SEÇÃO, no lugar de um por linha.
 *
 * ## Para que forma de seção isto serve
 *
 * Para a seção cujas linhas são um ajuste ESCALAR por chave, digitado num
 * campo, e cujo valor atual o servidor devolve — hoje `ParallelismSection`
 * (`maxParallel`, por área) e `BudgetSection` (`budgetMicros`, por área). As
 * duas guardavam `drafts: Record<string, string>` com a MESMA convenção
 * (chave ausente = linha não tocada) e repetiam o mesmo `handleSave`; é essa
 * repetição que sai daqui.
 *
 * Não serve — e não foi contorcida para servir — à `CredentialsSection`, que
 * também tem `drafts: Record<string, string>` e mesmo assim é outro problema:
 * a credencial é write-only (ADR 0050) e NUNCA volta do servidor, então não há
 * `textoDoServidor` com que comparar; o botão da linha alterna entre "Salvar"
 * e "Trocar" conforme aquele provider já tenha chave, o que um botão só da
 * seção não consegue dizer; e ele divide o card com "Testar" e "Remover", que
 * são irredutivelmente da linha. Ver o comentário da própria seção.
 *
 * ## Sujo é comparação por VALOR, não por texto
 *
 * A comparação é entre `interpretar(rascunho)` e
 * `interpretar(textoDoServidor(item))`, não entre as duas strings: num campo
 * numérico `20.0` e `20` são o mesmo teto, e comparar texto mandaria uma
 * chamada que a api trata como no-op. Isso exige que `TValor` seja comparável
 * por `===` — o que é verdade dos escalares para os quais este hook existe, e é
 * o limite dele. Rascunho INVÁLIDO conta como sujo (nada com que compará-lo),
 * e é por isso que `invalidas` é subconjunto de `sujas`.
 *
 * Este é o mesmo `mudouAlgo` de `ExecutionModeSection`, generalizado: lá o par
 * (modo, caminho) é fixo e vira UM booleano; aqui as linhas são N e variam com
 * o `module_map`, então a resposta é uma LISTA de chaves — é ela que deixa a
 * marca de não salvo dizer QUANTAS linhas estão sujas em vez de só "há algo".
 *
 * ## Salvar a seção são N chamadas, e a tela nunca afirma o que não obteve
 *
 * Não existe endpoint transacional para "grave estes N tetos" e este hook NÃO
 * inventa um: cada linha suja é um PUT independente, em série e na ordem da
 * tela. Em série porque a ordem do relatório precisa ser a ordem que a pessoa
 * vê, e porque disparar N escritas simultâneas no mesmo agregado não compra
 * nada aqui. Uma falha NÃO interrompe as seguintes — quem clicou pediu as N, e
 * abortar deixaria linhas sem tentativa nenhuma sem que a tela soubesse dizer
 * quais.
 *
 * O desfecho é POR LINHA, e é isso que a UI mostra:
 *
 * - só o rascunho que a api CONFIRMOU é descartado; o que falhou permanece, e
 *   a seção continua marcada como não salva por exatamente essas linhas —
 *   clicar Salvar de novo tenta só elas;
 * - todas passaram → toast de sucesso (a frase da própria seção quando foi uma
 *   linha só, que é o caso comum; a contagem quando foram várias);
 * - nenhuma passou → toast de erro com a mensagem que a API deu, como antes;
 * - algumas passaram → toast de AVISO, que diz quantas de quantas e NOMEIA as
 *   que ficaram. Nunca "salvo", nunca "não salvo": as duas seriam mentira.
 */
export function useSecaoSalvavel<TItem, TValor>({
  itens,
  chaveDe,
  textoDoServidor,
  interpretar,
  salvar,
  aoConcluir,
  sucessoDeUm,
  erroGenerico,
}: ConfigDeSecao<TItem, TValor>): SecaoSalvavel<TItem> {
  const { t } = useTranslation('settings');
  const { showToast } = useToast();
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);

  const linhas = itens ?? [];

  function textoDe(item: TItem): string {
    return rascunhos[chaveDe(item)] ?? textoDoServidor(item);
  }

  function leitura(item: TItem) {
    const texto = textoDe(item);
    const rascunho = interpretar(texto);
    const servidor = interpretar(textoDoServidor(item));
    const suja =
      !rascunho.valido ||
      !servidor.valido ||
      rascunho.valor !== servidor.valor;
    return { rascunho, suja };
  }

  const sujas: string[] = [];
  const invalidas: string[] = [];
  for (const item of linhas) {
    const { rascunho, suja } = leitura(item);
    if (!suja) continue;
    sujas.push(chaveDe(item));
    if (!rascunho.valido) invalidas.push(chaveDe(item));
  }

  function editar(chave: string, texto: string) {
    setRascunhos((d) => ({ ...d, [chave]: texto }));
  }

  async function salvarSecao() {
    const pendentes = linhas.filter((item) => leitura(item).suja);
    if (pendentes.length === 0) return;

    setSalvando(true);
    const salvas: string[] = [];
    const falhas: { chave: string; erro: unknown }[] = [];
    try {
      for (const item of pendentes) {
        const chave = chaveDe(item);
        const lido = interpretar(textoDe(item));
        // `podeSalvar` já barra o clique com linha inválida; se um valor
        // inválido chegar aqui, ele é PULADO e continua sujo, nunca enviado.
        if (!lido.valido) continue;
        try {
          await salvar(chave, lido.valor);
          salvas.push(chave);
        } catch (erro) {
          falhas.push({ chave, erro });
        }
      }

      if (salvas.length > 0) {
        setRascunhos((d) => {
          const resto = { ...d };
          for (const chave of salvas) delete resto[chave];
          return resto;
        });
        await aoConcluir?.();
      }

      if (falhas.length === 0) {
        showToast({
          title:
            salvas.length === 1
              ? sucessoDeUm(salvas[0])
              : t('secao.toast.salvas', { count: salvas.length }),
          tone: 'success',
        });
      } else if (salvas.length === 0) {
        showToast({
          title: mensagemDaApi(falhas[0].erro, erroGenerico),
          tone: 'danger',
        });
      } else {
        showToast({
          title: t('secao.toast.parcial', {
            salvas: salvas.length,
            total: pendentes.length,
          }),
          message: t('secao.toast.parcialDetalhe', {
            itens: falhas.map((f) => f.chave).join(', '),
            motivo: mensagemDaApi(falhas[0].erro, erroGenerico),
          }),
          tone: 'warning',
        });
      }
    } finally {
      setSalvando(false);
    }
  }

  return {
    textoDe,
    editar,
    sujas,
    invalidas,
    salvando,
    podeSalvar: sujas.length > 0 && invalidas.length === 0 && !salvando,
    salvarSecao,
  };
}

/**
 * O que a seção deve à pessoa antes de ela clicar: QUANTAS linhas estão
 * pendentes, e não só que há algo pendente.
 *
 * Até aqui a única pista de "há trabalho não salvo" em toda a aba era o botão
 * desabilitado de `ExecutionModeSection` — um sinal por NEGAÇÃO, que some
 * justamente quando passa a haver algo a salvar. Com um botão por seção a
 * ausência de contagem fica pior: o botão diz "Salvar" igual com uma linha
 * suja e com cinco, e a pessoa não tem como conferir se editou o que achava
 * que tinha editado.
 *
 * A marca inválida SUBSTITUI a de não salvo em vez de somar-se a ela: as duas
 * juntas dão dois números sobre o mesmo conjunto (`invalidas` é subconjunto de
 * `sujas`), e quem tem valor inválido precisa do que BLOQUEIA o botão, não da
 * contagem geral. `role="status"` porque a mudança é a resposta a uma edição
 * feita em outro elemento — sem ele, quem usa leitor de tela descobre o estado
 * só ao chegar no botão desabilitado.
 */
export function MarcaDeNaoSalvo({
  sujas,
  invalidas,
}: {
  sujas: string[];
  invalidas: string[];
}) {
  const { t } = useTranslation('settings');
  if (sujas.length === 0) return null;
  const invalido = invalidas.length > 0;
  return (
    <span className={styles.naoSalvo} role="status">
      <Badge square tone={invalido ? 'danger' : 'warning'}>
        {invalido
          ? t('secao.invalidas', { count: invalidas.length })
          : t('secao.naoSalvas', { count: sujas.length })}
      </Badge>
    </span>
  );
}
