import { useTranslation } from 'react-i18next';
import type { SessionEvent } from '../lib/api-types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/shadcn/popover';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';
import { EventItem } from './EventItem';
import { BellIcon } from './ui/icons';
import styles from './NotificationBell.module.css';

export interface NotificationGroup {
  projectId: string;
  projectName: string;
  /**
   * Já ORDENADOS pela api, do mais recente para o mais antigo (RN-100) — e
   * renderizados nessa ordem, sem `.sort()` aqui.
   *
   * Não é preciosismo: a consulta corta em 50 por projeto escolhendo os mais
   * NOVOS, então a lista que chega é uma janela, não uma amostra reordenável.
   * Ordenar de novo aqui só teria efeito se a api tivesse escolhido errado —
   * e aí o erro estaria escondido, não corrigido.
   */
  events: SessionEvent[];
  /** Total de não lidos do projeto, inclusive o que não coube na janela. */
  unreadCount: number;
  /** Quantos ficaram fora da janela — sempre os mais antigos. */
  olderCount: number;
}

interface NotificationBellProps {
  groups: NotificationGroup[];
  unreadCount: number;
  /**
   * CONTROLADO por quem monta o sino, e não estado interno: abrir a gaveta é
   * o que dispara a busca dos eventos não lidos (uma consulta por projeto com
   * pendência). Com o estado aqui dentro, quem faz as consultas não tinha como
   * saber que ninguém estava olhando — e pagava por todas o tempo todo.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMarkRead: () => void;
}

export function NotificationBell({
  groups,
  unreadCount,
  open,
  onOpenChange,
  onMarkRead,
}: NotificationBellProps) {
  const { t } = useTranslation('shell');
  // O que o botão "marcar lidas" REALMENTE faz, dito antes de ele ser clicado.
  //
  // O corte de leitura é UM `seq` por projeto no `localStorage`, e não existe
  // endpoint de marcar lido, por decisão registrada (RN-091). Um corte por
  // `seq` marca um PREFIXO; a gaveta mostra um SUFIXO (os mais recentes). Os
  // dois únicos cortes que ele consegue expressar são "nada" e "tudo até
  // agora" — não há como marcar lidos só os 50 exibidos sem inventar um
  // conjunto de lidos por evento, que é tabela nova e está fora de escopo.
  //
  // Então a semântica NÃO muda (continua avançando para o último `seq`), e o
  // que muda é a gaveta parar de esconder o que esse avanço engole: o total
  // aparece no botão, e cada projeto diz quantos ficaram fora da janela.
  const ocultos = groups.reduce((total, g) => total + g.olderCount, 0);
  const totalNaGaveta = groups.reduce((total, g) => total + g.unreadCount, 0);

  return (
    <div className={styles.wrapper}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger
          render={<Button variant="secondary" className={styles.button} aria-label={t('notificationBell.label')} />}
        >
          <BellIcon size={17} />
          {unreadCount > 0 && (
            <Badge tone="accent" className={styles.badge}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </PopoverTrigger>

        <PopoverContent align="end" sideOffset={8} className={styles.dropdown}>
          <div className={styles.header}>
            <span className={styles.headerTitle}>{t('notificationBell.label')}</span>
            <Button variant="ghost" size="sm" className={styles.markRead} onClick={onMarkRead}>
              {ocultos > 0
                ? t('notificationBell.markRead.withCount', { total: totalNaGaveta })
                : t('notificationBell.markRead.default')}
            </Button>
          </div>

          {ocultos > 0 && (
            <div className={styles.windowNote}>
              {t('notificationBell.windowNote', { count: ocultos })}
            </div>
          )}

          {groups.length === 0 && (
            <EmptyState>{t('notificationBell.empty')}</EmptyState>
          )}

          {groups.map((group) => (
            <div key={group.projectId} className={styles.group}>
              <div className={styles.groupHeader}>
                <span className={styles.groupDot} />
                {group.projectName}
                <Badge tone="muted" className={styles.groupCount}>{group.unreadCount}</Badge>
              </div>
              <div className={styles.list}>
                {group.events.map((event) => (
                  <EventItem key={event.id} event={event} />
                ))}
              </div>
              {group.olderCount > 0 && (
                <div className={styles.older}>
                  {t('notificationBell.older', { count: group.olderCount })}
                </div>
              )}
            </div>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}
