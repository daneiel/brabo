import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { approveAction, approveAlwaysAction, denyAction } from '../lib/api-client';
import {
  FILAS_ACIONAVEIS,
  temAlgoEsperando,
  type AbaDeDestino,
  type ChaveDeFila,
  type FilaPrecisaDeVoce,
  type ItemDaFila, gateEsperandoClique } from '../lib/precisa-de-voce';
import { formatRelativeTime } from '../lib/time';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/shadcn/sheet';
import { ApprovalCard } from './ApprovalCard';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';
import { AlertCircleIcon, ChevronRightIcon, XIcon } from './ui/icons';
import styles from './PainelPrecisaDeVoce.module.css';

/** A chave de tradução do cabeçalho de cada fila, no `projectPage`. */
const CHAVE_DE_TITULO: Record<ChaveDeFila, string> = {
  aprovacoes: 'precisaDeVoce.filas.aprovacoes',
  prs: 'precisaDeVoce.filas.prs',
  promocoes: 'precisaDeVoce.filas.promocoes',
  arquitetura: 'precisaDeVoce.filas.arquitetura',
  hipoteses: 'precisaDeVoce.filas.hipoteses',
};

interface PainelPrecisaDeVoceProps {
  projectId: string;
  /** As cinco filas já montadas e ordenadas (`lib/precisa-de-voce.ts`). */
  filas: FilaPrecisaDeVoce[];
  /**
   * CONTROLADO por quem monta o painel, como no `NotificationBell`: quem
   * decide se a gaveta está aberta é a página, que é quem já tem o estado da
   * aba e sabe fechar o painel ao navegar. Diferença de motivo, e vale
   * dizer: aqui abrir NÃO dispara consulta nenhuma — as cinco filas já são
   * buscadas o tempo todo pelos contadores do trilho, e este painel lê o
   * mesmo cache do TanStack (mesmas `queryKey`), sem uma requisição a mais.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Leva o usuário à aba onde a decisão daquela linha mora. */
  onIrParaAba: (aba: AbaDeDestino) => void;
}

/**
 * O painel "precisa de você" — as CINCO filas de decisão do projeto num lugar
 * só, separadas.
 *
 * ## Por que existe
 *
 * As cinco filas já tinham cada uma o seu contador no trilho (ADR 0126), e
 * essa separação está certa: somá-las esconderia QUAL delas pede atenção. O
 * que faltava era o quadro inteiro — quem abre o projeto via cinco números
 * espalhados por cinco abas e nenhuma frase dizendo o que espera por ele.
 *
 * ## O que ele NÃO é
 *
 * Ele não soma nada: cada fila mantém o próprio cabeçalho e o próprio total,
 * e não existe "12 pendências" em lugar nenhum — nem no chip que o abre, que
 * anuncia PRESENÇA (um ponto) e não quantidade.
 *
 * E ele não executa nada. As duas filas acionáveis aqui (`aprovacoes`, `prs`)
 * renderizam o MESMO `ApprovalCard` da aba de Aprovações (uma variante só, AT-322)
 * — os botões chamam os mesmos endpoints de decisão, que continuam passando
 * pelo pipeline inteiro. Isso importa em especial para `git_merge`: merge em
 * branch protegida é rebaixado a `require_approval` INCONDICIONALMENTE
 * (`apps/api/src/domain/actions/decide.ts`, teto absoluto que nem
 * `agent_autonomy` nem `permissions.json` levantam). O painel é um atalho para
 * a decisão, nunca um substituto dela.
 *
 * `onActivateAutoMode` é omitido de propósito nos dois cards: ligar "auto
 * mode" (RN-153) é mudar POLÍTICA do agente, não decidir a ação que está na
 * frente. Quem quer isso decide na aba de Aprovações, onde o papel do
 * workspace já é checado. Omitir a prop esconde o botão — é o contrato que o
 * próprio `ApprovalCard` documenta.
 *
 * ## Acessibilidade
 *
 * A gramática visual vem do `NotificationBell` (cabeçalho fixo, lista por
 * grupo com contagem, estado vazio). A MECÂNICA não: aquele componente não
 * tem `role`, `aria-expanded`, foco gerenciado, `Esc` nem clique-fora — só um
 * `aria-label` no gatilho. Nada disso foi reaproveitado porque nada disso
 * existia. Aqui: `role="dialog"`/`aria-modal` com rótulo, foco levado ao
 * painel na abertura e DEVOLVIDO ao chip no fechamento, `Tab` preso dentro do
 * painel enquanto ele está aberto, `Esc` fecha e clique no scrim fecha.
 */
export function PainelPrecisaDeVoce({
  projectId,
  filas,
  open,
  onOpenChange,
  onIrParaAba,
}: PainelPrecisaDeVoceProps) {
  const { t } = useTranslation('projectPage');
  const queryClient = useQueryClient();
  const painelId = useId();
  const tituloId = useId();

  const temPendencia = temAlgoEsperando(filas);
  const comItens = filas.filter((fila) => fila.itens.length > 0);

  // Foco preso, Esc, clique fora e devolução do foco ao chip: do Sheet (Base UI).

  // As decisões usam o `sessionId` que a PRÓPRIA ação carrega, nunca a sessão
  // mais recente: a fila de `git_merge` é project-wide e a ação pode ter
  // nascido em qualquer sessão (mesma disciplina de `ProjectPrsTab`).
  function invalidar(acaoSessionId: string) {
    queryClient.invalidateQueries({
      queryKey: ['project-pending-actions', projectId, 'git_merge'],
    });
    queryClient.invalidateQueries({
      queryKey: ['session-actions', projectId, acaoSessionId],
    });
  }

  async function aprovar(item: ItemDaFila) {
    if (!item.acao) return;
    try {
      await approveAction(projectId, item.acao.sessionId, item.acao.id);
    } finally {
      invalidar(item.acao.sessionId);
    }
  }
  async function negar(item: ItemDaFila) {
    if (!item.acao) return;
    try {
      await denyAction(projectId, item.acao.sessionId, item.acao.id);
    } finally {
      invalidar(item.acao.sessionId);
    }
  }
  async function semprePermitir(item: ItemDaFila) {
    if (!item.acao) return;
    try {
      await approveAlwaysAction(projectId, item.acao.sessionId, item.acao.id);
    } finally {
      invalidar(item.acao.sessionId);
    }
    queryClient.invalidateQueries({ queryKey: ['permissions', projectId] });
  }

  function irPara(aba: AbaDeDestino) {
    onIrParaAba(aba);
    onOpenChange(false);
  }

  /**
   * O tempo de espera de uma linha, dito com a honestidade que o dado permite.
   * A pendência de arquitetura não tem data própria — a que aparece é a da
   * história relacionada, e a tela DIZ isso em vez de fingir precisão.
   */
  function tempo(item: ItemDaFila) {
    if (item.desde === null) {
      return <span className={styles.tempoAusente}>{t('precisaDeVoce.semData')}</span>;
    }
    const relativo = formatRelativeTime(item.desde);
    if (!item.dataEmprestada) return <span className={styles.tempo}>{relativo}</span>;
    return (
      <span className={styles.tempoEmprestado} title={t('precisaDeVoce.notaDeArquitetura')}>
        {t('precisaDeVoce.tempoEmprestado', { tempo: relativo })}
      </span>
    );
  }

  return (
    <div className={styles.wrapper}>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger
          render={
            <Button
              variant="secondary"
              size="sm"
              className={styles.chip}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-controls={painelId}
            />
          }
        >
          <AlertCircleIcon size={14} />
          <span>{t('precisaDeVoce.chip')}</span>
          {/* PONTO, não número: o chip anuncia que HÁ algo esperando. O quanto
              cada fila tem continua na aba dela, separado — um total aqui seria
              a soma que este painel existe para não fazer. */}
          {temPendencia && <span className={styles.ponto} aria-hidden="true" />}
        </SheetTrigger>

        <SheetContent
          id={painelId}
          showCloseButton={false}
          className={styles.painel}
          aria-labelledby={tituloId}
        >
            <div className={styles.cabecalho}>
              <div>
                <SheetTitle id={tituloId} className={styles.titulo}>
                  {t('precisaDeVoce.titulo')}
                </SheetTitle>
                <SheetDescription className={styles.subtitulo}>{t('precisaDeVoce.subtitulo')}</SheetDescription>
              </div>
              <SheetClose
                render={
                  <Button variant="secondary" icon size="sm" aria-label={t('precisaDeVoce.fechar')} />
                }
              >
                <XIcon size={16} />
              </SheetClose>
            </div>

            {comItens.length === 0 && (
              <EmptyState>{t('precisaDeVoce.vazio')}</EmptyState>
            )}

            {comItens.map((fila) => (
              <section
                key={fila.chave}
                className={styles.grupo}
                aria-labelledby={`${painelId}-${fila.chave}`}
              >
                <h3 id={`${painelId}-${fila.chave}`} className={styles.grupoCabecalho}>
                  <span className={styles.grupoPonto} aria-hidden="true" />
                  {t(CHAVE_DE_TITULO[fila.chave])}
                  {/* A contagem é DESTA fila e só dela. */}
                  <Badge tone="muted" className={styles.grupoContagem}>{fila.itens.length}</Badge>
                </h3>

                <div className={styles.lista}>
                  {fila.itens.map((item) =>
                    FILAS_ACIONAVEIS.has(fila.chave) && item.acao ? (
                      <div key={item.id} className={styles.linhaDeCard}>
                        {gateEsperandoClique(item.acao) && (
                          <p className={styles.gateParado} role="status">
                            {t('precisaDeVoce.gateParado', {
                              gate: gateEsperandoClique(item.acao) === 'qa' ? 'QA' : 'SecOps',
                            })}
                          </p>
                        )}
                        <ApprovalCard
                          action={item.acao}
                          detalheRecolhido
                          onApprove={() => aprovar(item)}
                          onDeny={() => negar(item)}
                          onAlwaysAllow={() => semprePermitir(item)}
                        />
                        <div className={styles.rodapeDoCard}>{tempo(item)}</div>
                      </div>
                    ) : (
                      <Button
                        key={item.id}
                        variant="ghost"
                        className={styles.linha}
                        onClick={() => item.aba && irPara(item.aba)}
                      >
                        <span className={styles.linhaTexto}>
                          <span className={styles.linhaTitulo}>{item.titulo}</span>
                          {item.detalhe && (
                            <span className={styles.linhaDetalhe}>{item.detalhe}</span>
                          )}
                        </span>
                        {tempo(item)}
                        <ChevronRightIcon size={14} />
                      </Button>
                    ),
                  )}
                </div>
              </section>
            ))}
        </SheetContent>
      </Sheet>
    </div>
  );
}
