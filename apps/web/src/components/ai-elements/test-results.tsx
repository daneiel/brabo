import { useTranslation } from 'react-i18next';
import type { ExecucaoDeTestes } from '@/lib/api-types';
import { Badge } from '@/components/ui/Badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/shadcn/collapsible';

/* AT-687: testes que o gate de QA rodou (relatório JUnit lido pelo engine). */
const TOM = { passou: 'success', falhou: 'danger', pulado: 'muted' } as const;
const ROTULO = { passou: 'statusPassou', falhou: 'statusFalhou', pulado: 'statusPulado' } as const;

export function TestResults({ execucao }: { execucao: ExecucaoDeTestes }) {
  const { t } = useTranslation('approvals');
  if ('indisponivel' in execucao) {
    return <p data-slot="ai-test-results">{t(`prGateTimeline.tests.${execucao.indisponivel}`)}</p>;
  }
  const mostrados = execucao.suites.reduce((n, s) => n + s.casos.length, 0);
  return (
    <div data-slot="ai-test-results" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{t('prGateTimeline.tests.title')}</strong>
        <Badge tone="success">{t('prGateTimeline.tests.passed', { count: execucao.passaram })}</Badge>
        <Badge tone="danger">{t('prGateTimeline.tests.failed', { count: execucao.falharam })}</Badge>
        <Badge tone="muted">{t('prGateTimeline.tests.skipped', { count: execucao.pulados })}</Badge>
        <span>{execucao.duracaoMs} ms</span>
      </div>
      {execucao.suites.map((s) => (
        <div key={s.nome}>
          <div>{s.nome}</div>
          <ul className="flex flex-col gap-1">
            {s.casos.map((c, i) => (
              <li key={i}>
                <Collapsible>
                  <CollapsibleTrigger disabled={!c.mensagem} className="flex items-center gap-2">
                    <Badge tone={TOM[c.status] ?? 'muted'}>
                      {t(`prGateTimeline.tests.${ROTULO[c.status] ?? 'statusDesconhecido'}`)}
                    </Badge>
                    <span>{c.nome}</span>
                    <span>{c.duracaoMs} ms</span>
                  </CollapsibleTrigger>
                  {c.mensagem && (
                    <CollapsibleContent>
                      <pre>{c.mensagem}</pre>
                    </CollapsibleContent>
                  )}
                </Collapsible>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {execucao.casosOmitidos > 0 && (
        <p>{t('prGateTimeline.tests.omitted', { shown: mostrados, total: execucao.total, count: execucao.casosOmitidos })}</p>
      )}
    </div>
  );
}
