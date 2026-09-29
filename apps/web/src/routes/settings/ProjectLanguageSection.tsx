import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getProject, mensagemDaApi, updateProject } from '../../lib/api-client';
import { useCurrentWorkspaceWithRole } from '../../lib/hooks';
import { roleAtLeast } from '../../lib/roles';
import {
  OPCAO_OUTRO_CODIGO,
  nomeDoIdioma,
  opcoesDeIdioma,
} from '../../lib/idioma-da-resposta';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/ToastProvider';
import styles from '../ProjectSettingsTab.module.css';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

/**
 * O idioma do PROJETO ([RN-619](../../../../../docs/business-rules.md#rn-619)):
 * o de tudo que não tem autor humano — artefatos compartilhados e turnos que
 * ninguém digitou. O que um agente responde a uma PESSOA é o idioma das
 * respostas dela (RN-618), na Conta, e a seção diz isso para não parecer que
 * trocar aqui muda a conversa de cada um.
 *
 * ## Quem pode
 *
 * O mínimo é o do ENDPOINT (`@RequireRole('maintainer')` em
 * `PATCH projects/:projectId`), por `roleAtLeast`. O papel lido é o do
 * WORKSPACE, e a lacuna é a declarada no CLAUDE.md para as seções que não
 * buscam `project_members`: quem é restringido no projeto vê o controle e
 * leva a recusa do `RolesGuard` num toast. Quem não alcança vê o valor e o
 * motivo em TEXTO; o controle fica inerte no lugar (ADR 0064).
 *
 * ## Quando salva
 *
 * A régua da RN-469, como na Conta: idioma NOMEADO no seletor salva no
 * `onChange`; o código DIGITADO em "Outro código…" pede o botão. Não há
 * "automático" aqui — o projeto tem sempre um idioma concreto.
 */
export function ProjectLanguageSection({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: comPapel } = useCurrentWorkspaceWithRole();
  const podeEditar = roleAtLeast(comPapel?.role, 'maintainer');
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  const [salvando, setSalvando] = useState(false);
  const [digitando, setDigitando] = useState(false);
  const [codigo, setCodigo] = useState('');

  const idiomaDaInterface = i18n.language || 'en';

  async function salvar(language: string) {
    setSalvando(true);
    try {
      await updateProject(projectId, { language });
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setDigitando(false);
      setCodigo('');
      showToast({ title: t('projectLanguage.toast.saved'), tone: 'success' });
    } catch (erro) {
      showToast({
        title: t('projectLanguage.toast.error'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    } finally {
      setSalvando(false);
    }
  }

  function escolher(valor: string) {
    if (valor === OPCAO_OUTRO_CODIGO) {
      setDigitando(true);
      return;
    }
    setDigitando(false);
    if (project && valor !== project.language) void salvar(valor);
  }

  if (!project) return null;

  return (
    <SecaoDeConfiguracoes chave="project-language">
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('projectLanguage.title')}</h2>
        <span className={styles.eyebrow}>{t('projectLanguage.eyebrow')}</span>
      </div>
      <div className={styles.subtitle}>{t('projectLanguage.subtitle')}</div>
      {/* Desde a RN-622 os turnos SEM autor recebem este idioma. O que a
          RN-619 promete para os artefatos compartilhados ainda não vale
          quando o artefato nasce num turno COM autor (lá vale o idioma das
          respostas da pessoa), e a tela diz isso em vez de afirmar o todo. */}
      <div className={styles.subtitle}>{t('projectLanguage.artifactsGap')}</div>
      {!podeEditar && (
        <div className={styles.subtitle}>{t('projectLanguage.readOnly')}</div>
      )}

      <div className={styles.ajusteCard}>
        <div className={styles.ajusteInfo}>
          <div className={styles.ajusteTitulo}>{t('projectLanguage.card.title')}</div>
          <div className={styles.ajusteHint}>
            {t('projectLanguage.card.hint', {
              idioma: nomeDoIdioma(project.language, idiomaDaInterface),
            })}
          </div>
        </div>
        <div className={styles.ajusteControle}>
          <Select
            value={digitando ? OPCAO_OUTRO_CODIGO : project.language}
            disabled={!podeEditar || salvando}
            aria-label={t('projectLanguage.selectAria')}
            onChange={(e) => escolher(e.target.value)}
          >
            {opcoesDeIdioma(project.language).map((c) => (
              <option key={c} value={c}>
                {nomeDoIdioma(c, idiomaDaInterface)}
              </option>
            ))}
            <option value={OPCAO_OUTRO_CODIGO}>{t('projectLanguage.otherCode')}</option>
          </Select>
        </div>
      </div>

      {digitando && podeEditar && (
        <form
          className={styles.ajusteCard}
          onSubmit={(e) => {
            e.preventDefault();
            if (codigo.trim()) void salvar(codigo.trim());
          }}
        >
          <Input
            label={t('projectLanguage.otherLabel')}
            hint={t('projectLanguage.otherHint')}
            value={codigo}
            mono
            onChange={(e) => setCodigo(e.target.value)}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={!codigo.trim()}
            loading={salvando}
          >
            {t('projectLanguage.save')}
          </Button>
        </form>
      )}
    </SecaoDeConfiguracoes>
  );
}
