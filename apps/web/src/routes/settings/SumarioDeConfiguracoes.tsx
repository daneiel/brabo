import { useTranslation } from 'react-i18next';
import { useSumario } from './SecaoDeConfiguracoes';
import { GRUPOS_DO_SUMARIO, SECOES_DE_CONFIGURACOES } from './sumario';
import styles from './sumario.module.css';

/**
 * O sumário ancorado da aba Configurações.
 *
 * A aba renderiza 17 seções numa rolagem só, e até aqui sem mapa nenhum: nem
 * índice, nem âncora, nem noção de onde se está. Este é o mapa.
 *
 * ## Onde ele mora — e por que NÃO é uma quarta faixa
 *
 * O corpo do projeto já fica à direita de um trilho de 180px (ADR 0126), que
 * por sua vez fica à direita da sidebar do Shell. Uma coluna de sumário POR
 * FORA disso somaria uma quarta faixa vertical de moldura antes de qualquer
 * conteúdo — o mesmo custo que o ADR 0126 já pagou e mediu na aba Código, e
 * que não vale a pena pagar duas vezes. Então o sumário mora DENTRO da área
 * de conteúdo, repartindo a largura máxima que `.body` já tinha
 * (`ProjectPage.module.css`): a moldura da tela não cresce um pixel.
 *
 * ## O que ele lista
 *
 * Só o que está no DOM. As entradas vêm do REGISTRO
 * (`SecaoDeConfiguracoes.tsx`), não da lista estática — sete das 17 seções
 * somem em condição normal (sem repositório, sem papel de `owner`, sem
 * catálogo), e oferecer entrada para uma delas seria um mapa apontando para
 * uma sala que não existe.
 *
 * Um grupo cujas seções sumiram todas não aparece: cabeçalho sozinho é rótulo
 * de nada.
 */
export function SumarioDeConfiguracoes() {
  const { t } = useTranslation(['settings', 'models']);
  const { presentes, ativa, irPara } = useSumario();

  if (presentes.length === 0) return null;

  const porGrupo = GRUPOS_DO_SUMARIO.map((grupo) => ({
    grupo,
    secoes: SECOES_DE_CONFIGURACOES.filter(
      (s) => s.grupo === grupo && presentes.includes(s.chave),
    ),
  })).filter((g) => g.secoes.length > 0);

  return (
    <nav className={styles.sumario} aria-label={t('summary.ariaLabel', { ns: 'settings' })}>
      <span className={styles.cabecalho}>{t('summary.title', { ns: 'settings' })}</span>

      {porGrupo.map(({ grupo, secoes }) => (
        <div key={grupo} className={styles.grupo}>
          <span className={styles.grupoLabel}>
            {t(`summary.groups.${grupo}`, { ns: 'settings' })}
          </span>
          {secoes.map((secao) => {
            const atual = secao.chave === ativa;
            return (
              <button
                key={secao.chave}
                type="button"
                // `aria-current="location"` e não `aria-selected`: o sumário
                // não é um `tablist`, e o que ele marca é "você está aqui na
                // página", não "este painel está aberto".
                aria-current={atual ? 'location' : undefined}
                className={[styles.item, atual && styles.itemAtivo]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => irPara(secao.chave)}
              >
                {t(secao.titulo, { ns: secao.ns })}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
