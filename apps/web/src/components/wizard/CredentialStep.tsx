import { useState } from 'react';
import type { UserCredentialMetadata } from '../../lib/api-types';
import { Button } from '../ui/Button';
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
  const [adding, setAdding] = useState(credentials.length === 0);
  const [token, setToken] = useState('');

  return (
    <div className={styles.root} data-testid="credential-step">
      <p className={styles.hint}>
        Provisionar no {PROVIDER_LABEL[provider]} exige um token de acesso
        pessoal (PAT). Selecione um já cadastrado ou adicione um novo — o
        token é cifrado ao salvar e nunca é reexibido. A verificação fica nas
        configurações do projeto, sobre o token já guardado.
      </p>

      {credentials.length > 0 && (
        <div className={styles.credList}>
          {credentials.map((cred) => {
            const selected = cred.id === selectedId;
            return (
              <button
                key={cred.id}
                type="button"
                data-testid="credential-option"
                data-selected={selected}
                className={[styles.credOption, selected && styles.selected]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelect(cred.id)}
              >
                <span className={styles.credIcon}>
                  {selected ? <CheckIcon size={14} /> : <LockIcon size={14} />}
                </span>
                <span className={styles.credLabel}>
                  {PROVIDER_LABEL[provider]} conectado
                </span>
                <span className={styles.credMeta}>
                  desde {formatRelativeTime(cred.createdAt)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {adding ? (
        <div className={styles.addForm}>
          <label className={styles.fieldLabel} htmlFor="git-token">
            Novo token do {PROVIDER_LABEL[provider]}
          </label>
          <Input
            id="git-token"
            type="password"
            mono
            autoComplete="off"
            placeholder="ghp_… / glpat-…"
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
                Cancelar
              </Button>
            )}
            <Button
              onClick={() => onRegister(token.trim())}
              disabled={registering || token.trim().length === 0}
            >
              {registering ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.addToggle}
          onClick={() => setAdding(true)}
        >
          <PlusIcon size={14} /> Adicionar novo token
        </button>
      )}
    </div>
  );
}
