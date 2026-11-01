import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle } from '@/components/shadcn/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/shadcn/command';
import { sair } from '../lib/auth';
import { alternarTema } from '../lib/tema';
import type { Project, ProjectCardSummary, Session } from '../lib/api-types';
import {
  itensDaPaleta,
  type DestinoDaPaleta,
  type GrupoDaPaleta,
  type ItemDaPaleta,
} from '../lib/paleta-de-comandos';
import { ABAS_DO_PROJETO } from '../routes/project-tabs';

interface Props {
  onClose: () => void;
  projetos: readonly Project[];
  resumo: readonly ProjectCardSummary[];
  projetoAbertoId: string | undefined;
  irParaAba: (projectId: string, chave: string) => void;
  abrirNovoProjeto: () => void;
}

const GRUPOS: GrupoDaPaleta[] = ['projetos', 'abas', 'sessoes', 'acoes'];
type RotaFixa = '/spend' | '/containers' | '/providers' | '/account';
const rota = (to: RotaFixa): DestinoDaPaleta => ({ tipo: 'rota', to });

export default function PaletaDeComandos(p: Props) {
  const { t } = useTranslation('shell');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const itens = itensDaPaleta({
    projetos: p.projetos,
    resumo: p.resumo,
    // Só leitura do cache: abrir a paleta não faz requisição (RN-971).
    sessoesEmCache: p.projetoAbertoId
      ? qc.getQueryData<Session[]>(['sessions', p.projetoAbertoId])
      : undefined,
    projetoAbertoId: p.projetoAbertoId,
    abas: ABAS_DO_PROJETO,
    rotuloSessao: (nome, id) => nome ?? `#${id.slice(0, 8)}`,
    acoes: [
      { destino: { tipo: 'novo-projeto' }, rotulo: t('palette.actions.newProject') },
      { destino: { tipo: 'tema' }, rotulo: t('palette.actions.theme') },
      { destino: rota('/spend'), rotulo: t('palette.actions.spend') },
      { destino: rota('/containers'), rotulo: t('palette.actions.containers') },
      { destino: rota('/providers'), rotulo: t('palette.actions.providers') },
      { destino: rota('/account'), rotulo: t('palette.actions.account') },
      { destino: { tipo: 'sair' }, rotulo: t('palette.actions.logout') },
    ],
  });
  const grupos = GRUPOS.map((g) => ({ value: g, items: itens.filter((i) => i.grupo === g) })).filter(
    (g) => g.items.length > 0,
  );

  function executar(d: DestinoDaPaleta) {
    p.onClose();
    if (d.tipo === 'projeto')
      void navigate({ to: '/projects/$projectId', params: { projectId: d.projectId } });
    else if (d.tipo === 'aba') p.irParaAba(d.projectId, d.chave);
    else if (d.tipo === 'sessao')
      void navigate({
        to: '/projects/$projectId/sessions/$sessionId',
        params: { projectId: d.projectId, sessionId: d.sessionId },
      });
    else if (d.tipo === 'rota') void navigate({ to: d.to });
    else if (d.tipo === 'novo-projeto') p.abrirNovoProjeto();
    else if (d.tipo === 'tema') alternarTema();
    else void sair().then(() => navigate({ to: '/login' }));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent showCloseButton={false} className="top-[20%] -translate-y-0 p-0">
        <DialogTitle className="sr-only">{t('palette.title')}</DialogTitle>
        <Command items={grupos} itemToStringValue={(i: unknown) => (i as ItemDaPaleta).rotulo}>
          <CommandInput placeholder={t('palette.placeholder')} aria-label={t('palette.title')} />
          <CommandEmpty>{t('palette.empty')}</CommandEmpty>
          <CommandList>
            {(g: { value: GrupoDaPaleta; items: ItemDaPaleta[] }) => (
              <CommandGroup key={g.value} items={g.items}>
                <CommandGroupLabel>
                  {t(`palette.groups.${g.value}`)}
                  {g.value === 'sessoes' ? ` — ${t('palette.sessionsScope')}` : ''}
                </CommandGroupLabel>
                {g.items.map((i) => (
                  <CommandItem key={i.id} value={i} onClick={() => executar(i.destino)}>
                    {i.rotulo}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
