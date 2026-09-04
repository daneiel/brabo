import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listAgentAreas, setAreaBudget } from '../../lib/api-client';
import type { AgentArea } from '../../lib/api-types';
import { microsParaUsd } from '../../lib/currency';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { formatarCustoMicros } from './shared';
import styles from '../ProjectSettingsTab.module.css';
import { MarcaDeHeranca } from './heranca';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';
import { MarcaDeNaoSalvo, useSecaoSalvavel } from './secao-salvavel';

/**
 * O teto de GASTO de cada área, opcional (ADR 0110, RN-443).
 *
 * Mesmo padrão de `ParallelismSection` — uma linha por área, botão de salvar
 * explícito (não autosave, pelo mesmo motivo: salvar a cada tecla mandaria
 * `2` a caminho de `20`) —, mas o campo fala em DÓLAR (não micro-USD, que
 * ninguém digita) e aceita ficar vazio: vazio é "sem teto", o mesmo valor de
 * `budgetMicros: null`. Este teto é ADITIVO ao budget de projeto/sessão que
 * já existe na tela — não substitui nenhum dos dois, e não é a cascata de
 * modelo herdável do ADR 0064 (áreas diferentes, mecanismos diferentes).
 *
 * O estado "sem valor próprio" é dito pela `MarcaDeHeranca`
 * (`settings/heranca.tsx`), como no resto da aba, e NÃO mais pelo placeholder
 * sozinho. O placeholder fazia dois trabalhos: texto-fantasma do campo e
 * único enunciado do estado. Ele é ruim no segundo — some assim que alguém
 * digita, não se lê sem olhar dentro do campo, e não tem como dizer o polo
 * POSITIVO ("esta área tem teto próprio"), que é metade da informação. Ficou
 * só com o primeiro trabalho.
 *
 * O botão é UM, da seção, pelo mesmo motivo de `ParallelismSection` e pelo
 * mesmo mecanismo (`settings/secao-salvavel.tsx`) — inclusive o desfecho POR
 * LINHA quando algumas das N chamadas falham.
 */
export function BudgetSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { data: areas } = useQuery({
    queryKey: ['agent-areas', projectId],
    queryFn: () => listAgentAreas(projectId),
  });

  const secao = useSecaoSalvavel<AgentArea, number | null>({
    itens: areas,
    chaveDe: (area) => area.key,
    textoDoServidor: (area) =>
      area.budgetMicros === null ? '' : String(microsParaUsd(area.budgetMicros)),
    // Vazio é um valor válido — "sem teto" — e não um erro digitando.
    interpretar: (texto) => {
      if (texto.trim() === '') return { valido: true, valor: null };
      const numero = Number(texto);
      return Number.isFinite(numero) && numero >= 0
        ? { valido: true, valor: numero }
        : { valido: false };
    },
    salvar: (chave, valor) => setAreaBudget(projectId, chave, valor),
    aoConcluir: () =>
      queryClient.invalidateQueries({ queryKey: ['agent-areas', projectId] }),
    sucessoDeUm: (chave) => t('budget.toast.success', { area: chave }),
    erroGenerico: t('budget.toast.error'),
  });

  return (
    <SecaoDeConfiguracoes chave="budget">
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('budget.title')}</h2>
        <span className={styles.eyebrow}>{t('budget.eyebrow')}</span>
      </div>
      <div className={styles.subtitle}>
        {t('budget.subtitle.before')}
        <strong>{t('budget.subtitle.strong')}</strong>
        {t('budget.subtitle.after')}
      </div>

      {!areas || areas.length === 0 ? (
        <div className={styles.subtitle}>
          {t('budget.empty.before')}
          <code>{t('budget.empty.code')}</code>
          {t('budget.empty.after')}
        </div>
      ) : (
        <>
          {areas.map((area) => (
            <div key={area.key} className={styles.ajusteCard}>
              <div className={styles.ajusteInfo}>
                <div className={styles.ajusteTitulo}>
                  {t('budget.card.title', { area: area.key })}
                </div>
                <div className={styles.ajusteHint}>
                  {t('budget.card.spent', {
                    amount: formatarCustoMicros(area.spentMicros),
                  })}
                </div>
                <div className={styles.ajusteHint}>
                  {/* O polo positivo não leva detalhe: o teto próprio está no
                      campo ao lado, e repeti-lo aqui seria a mesma duplicação
                      que este padrão existe para remover. */}
                  <MarcaDeHeranca
                    proprio={area.budgetMicros !== null}
                    detalhe={
                      area.budgetMicros === null
                        ? t('budget.card.noCap')
                        : undefined
                    }
                  />
                </div>
              </div>
              <div className={styles.ajusteNumero}>
                <Input
                  mono
                  type="number"
                  min={0}
                  step="any"
                  placeholder={t('budget.placeholder')}
                  aria-label={t('budget.card.capAria', { area: area.key })}
                  value={secao.textoDe(area)}
                  onChange={(e) => secao.editar(area.key, e.target.value)}
                />
              </div>
            </div>
          ))}

          <div className={styles.acoesDaSecao}>
            <Button
              onClick={() => void secao.salvarSecao()}
              disabled={!secao.podeSalvar}
            >
              {secao.salvando ? t('budget.saving') : t('budget.save')}
            </Button>
            <MarcaDeNaoSalvo sujas={secao.sujas} invalidas={secao.invalidas} />
          </div>
        </>
      )}
    </SecaoDeConfiguracoes>
  );
}
