import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { StackIcon, ChevronRightIcon } from '../components/ui/icons';
import styles from './SessionPage.module.css';

/**
 * Um slide do carrossel de histórias aguardando promoção (RN-148) — o mesmo
 * conteúdo do card avulso de `backlog.story_promotion_proposed` (RN-126),
 * sem a caixa em volta: quem dá a caixa é o `Carousel`.
 *
 * `resumo` é opcional de propósito: `CreateStoryUseCase` hoje só grava
 * storyId/epicId/title no evento — nem descrição, nem RF. O slide já sabe
 * mostrar o campo quando ele existir no payload; até lá, degrada pro título
 * sozinho.
 */
export function StorySlide({
  projectId,
  titulo,
  resumo,
  promovendo,
  desabilitado,
  onPromover,
  onDevolver,
}: {
  projectId: string;
  titulo: string;
  resumo?: string;
  promovendo: boolean;
  desabilitado: boolean;
  onPromover: () => void;
  onDevolver: () => void;
}) {
  const { t } = useTranslation('sessionPage');
  return (
    <div className={styles.storySlide}>
      <span className={styles.handoffPill}>
        <StackIcon size={13} />
        {t('historia.pendente', { titulo })}
      </span>
      {resumo && <p className={styles.storySlideResumo}>{resumo}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          variant="success"
          disabled={desabilitado}
          loading={promovendo}
          onClick={onPromover}
        >
          {t('historia.promover')}
        </Button>
        <Button variant="ghost" disabled={desabilitado} onClick={onDevolver}>
          {t('historia.devolver')}
        </Button>
      </div>
      <Link
        to="/projects/$projectId"
        params={{ projectId }}
        search={{ tab: 'backlog' }}
        className={styles.timelineLink}
      >
        {t('compartilhado.verNoBacklog')}
        <ChevronRightIcon size={11} />
      </Link>
    </div>
  );
}
