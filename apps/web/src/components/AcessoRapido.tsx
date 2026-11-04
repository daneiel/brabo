import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Shield, UserCog, Wrench, type LucideIcon } from 'lucide-react';
import { Button } from './ui/Button';
import { Alert } from './ui/Alert';
import { Modal } from './ui/Modal';
import { entrarRapido, papeisDoAcessoRapido } from '../lib/auth';
import styles from '../routes/AuthLayout.module.css';

const ICONES: Record<string, LucideIcon> = {
  owner: Shield,
  maintainer: UserCog,
  developer: Wrench,
  viewer: Eye,
};

/**
 * Diálogo de acesso rápido por papel (AT-722). Só é importado, por `lazy`, no
 * ramo `VITE_BRABO_AMBIENTE === 'local'` da LoginPage; a api também responde
 * 404 fora de `local`, e então nada aparece.
 */
export default function AcessoRapido({ irPara }: { irPara: (rota: string) => void }) {
  const { t } = useTranslation('auth');
  const [papeis, setPapeis] = useState<{ papel: string; email: string }[] | null>(null);
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void papeisDoAcessoRapido().then((p) => {
      if (vivo) setPapeis(p);
    });
    return () => {
      vivo = false;
    };
  }, []);

  if (!papeis) return null;

  async function escolher(papel: string) {
    setErro(null);
    setEntrando(true);
    try {
      const r = await entrarRapido(papel);
      if (r.ok) irPara('/');
      else setErro(t('loginPage.quickAccess.error'));
    } catch {
      setErro(t('loginPage.quickAccess.error'));
    } finally {
      setEntrando(false);
    }
  }

  return (
    <div data-acesso-rapido>
      <Button
        type="button"
        variant="secondary"
        className={styles.botaoSocial}
        onClick={() => {
          setErro(null);
          setAberto(true);
        }}
      >
        <Wrench size={17} aria-hidden="true" />
        {t('loginPage.quickAccess.button')}
      </Button>
      {aberto && (
        <Modal title={t('loginPage.quickAccess.title')} onClose={() => setAberto(false)}>
          <Alert tone="warning">{t('loginPage.quickAccess.warning')}</Alert>
          {erro && (
            <Alert tone="danger" role="alert">
              {erro}
            </Alert>
          )}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {papeis.map(({ papel, email }) => {
              const Icone = ICONES[papel] ?? UserCog;
              return (
                <li key={papel}>
                  <Button
                    type="button"
                    variant="secondary"
                    className={styles.botaoSocial}
                    style={{ width: '100%' }}
                    disabled={entrando}
                    onClick={() => void escolher(papel)}
                  >
                    <Icone size={17} aria-hidden="true" />
                    <strong>{papel}</strong>
                    <span>{email}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        </Modal>
      )}
    </div>
  );
}
