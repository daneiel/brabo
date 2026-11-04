import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ajuda } from '../ui/Ajuda';
import type { UserCredentialMetadata } from '../../lib/api-types';
import { Button } from '../ui/Button';
import { ToggleGroup, ToggleGroupItem } from '../shadcn/toggle-group';
import { Input } from '../ui/Input';
import { CheckIcon, LockIcon, PlusIcon } from '../ui/icons';
import { formatRelativeTime } from '../../lib/time';
import styles from './CredentialStep.module.css';

interface CredentialStepProps {
  provider: 'github' | 'gitlab';
  credentials: UserCredentialMetadata[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onRegister: (token: string) => void;
  registering: boolean;
  error: string | null;
}

const PROVIDER_LABEL: Record<'github' | 'gitlab', string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
};

/**
 * Passo de credencial do wizard — presentacional (props in, callbacks out),
 * testável sem rede. Lista credenciais existentes do provider como chips
 * selecionáveis (só metadados, NUNCA o token) e um form write-only pra
 * cadastrar um PAT novo, que o backend cifra e grava sem testar (ADR 0050).
 *
 * A prop `error` continua: ela agora mostra falha de GRAVAÇÃO, não mais
 * recusa do provider.
 */
export function CredentialStep({
  provider,
  credentials,
  selectedId,
  onSelect,
  onRegister,
  registering,
  error,
}: CredentialStepProps) {
  const { t } = useTranslation('models');
  const [adding, setAdding] = useState(credentials.length === 0);
  const [token, setToken] = useState('');

  return (
    <div className={styles.root} data-testid="credential-step">
      <Ajuda assunto={t('credentialStep.assunto')}>
        {t('credentialStep.hint', { provider: PROVIDER_LABEL[provider] })}
      </Ajuda>

      {credentials.length > 0 && (
        <ToggleGroup
          className={styles.credList}
          value={selectedId ? [selectedId] : []}
          onValueChange={(v) => v[0] && onSelect(v[0])}
        >
          {credentials.map((cred) => {
            const selected = cred.id === selectedId;
            return (
              <ToggleGroupItem
                key={cred.id}
                value={cred.id}
                data-testid="credential-option"
                data-selected={selected}
                className={[styles.credOption, selected && styles.selected]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className={styles.credIcon}>
                  {selected ? <CheckIcon size={14} /> : <LockIcon size={14} />}
                </span>
                <span className={styles.credLabel}>
                  {t('credentialStep.credLabel', { provider: PROVIDER_LABEL[provider] })}
                </span>
                <span className={styles.credMeta}>
                  {t('credentialStep.credMeta', {
                    time: formatRelativeTime(cred.createdAt),
                  })}
                </span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      )}

      {adding ? (
        <div className={styles.addForm}>
          <label className={styles.fieldLabel} htmlFor="git-token">
            {t('credentialStep.fieldLabel', { provider: PROVIDER_LABEL[provider] })}
          </label>
          <Input
            id="git-token"
            type="password"
            mono
            autoComplete="off"
            placeholder={t('credentialStep.placeholder')}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            icon={<LockIcon size={14} />}
          />
          {error && (
            <div className={styles.error} data-testid="credential-error">
              {error}
            </div>
          )}
          <div className={styles.addActions}>
            {credentials.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => {
                  setAdding(false);
                  setToken('');
                }}
                disabled={registering}
              >
                {t('credentialStep.cancel')}
              </Button>
            )}
            <Button
              onClick={() => onRegister(token.trim())}
              disabled={registering || token.trim().length === 0}
            >
              {registering ? t('credentialStep.saving') : t('credentialStep.save')}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          icon
          className={styles.addToggle}
          onClick={() => setAdding(true)}
          aria-label={t('credentialStep.addNewToken')}
          title={t('credentialStep.addNewToken')}
        >
          <PlusIcon size={14} aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
