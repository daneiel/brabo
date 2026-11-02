import { GitCommitIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/*
 * Commit (AT-683, prévia v5). Mensagem, autor e arquivos do que o card já
 * tem; os diffs expansíveis continuam com o ApprovalCard.
 */
type CommitProps = {
  mensagem?: string;
  autor?: string;
  arquivos: { path: string; additions: number; deletions: number }[];
};

export function Commit({ mensagem, autor, arquivos }: CommitProps) {
  const { t } = useTranslation('approvals');
  if (!mensagem && !autor) return null;
  const mais = arquivos.reduce((n, f) => n + (f.additions || 0), 0);
  const menos = arquivos.reduce((n, f) => n + (f.deletions || 0), 0);
  return (
    <div data-slot="ai-commit" className="flex items-start gap-2 rounded-md border border-border bg-muted p-3 text-sm">
      <GitCommitIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {mensagem && <p data-slot="ai-commit-message" className="m-0 font-medium text-foreground">{mensagem}</p>}
        <p className="m-0 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          {autor && <span data-slot="ai-commit-author">{autor}</span>}
          <span>{t('approvalCard.body.commit.files', { count: arquivos.length })}</span>
          <span>+{mais} −{menos}</span>
        </p>
      </div>
    </div>
  );
}
