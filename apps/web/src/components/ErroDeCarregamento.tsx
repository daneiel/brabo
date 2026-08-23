import { useTranslation } from 'react-i18next';
import { ApiError, mensagemDaApi } from '../lib/api-client';
import { Alert } from './ui/Alert';
import { Button } from './ui/Button';
import styles from './ErroDeCarregamento.module.css';

interface ErroDeCarregamentoProps {
  /** O que não carregou, na língua do usuário: "Não foi possível abrir o projeto." */
  titulo: string;
  /** O erro cru da query — a frase que a api mandou sai daqui. */
  erro: unknown;
  /** Normalmente `() => void query.refetch()`. Sem ele, o botão não aparece. */
  onTentarDeNovo?: () => void;
}

/**
 * Erro de CARREGAMENTO dito na tela (não em toast, não só no console).
 *
 * O caminho de mutação já tinha isso: `mensagemDaApi` extrai a frase da api e
 * o toast a mostra. O caminho de query não tinha nada — quem chamava fazia
 * `if (!data) return null`, e uma api respondendo 429 ficava indistinguível de
 * um projeto sem dados. Numa tela inteira de queries, o desfecho observado foi
 * o pior possível: **área principal em branco**, sem mensagem, sem estado de
 * erro, com o motivo existindo apenas nas 1128 linhas do console.
 *
 * É a mesma regra que a RN-059 fixou para o agente, do outro lado do fio:
 * falha nunca vira resposta vazia. Quem falha, diz.
 *
 * A frase vem da api de propósito, e não de um texto genérico nosso: é ela que
 * sabe a diferença entre "limite de requisições excedido, tente em instantes"
 * (espere) e "você não tem acesso a este projeto" (não adianta esperar). O
 * `trace_id` acompanha quando houver — é o que liga esta tela ao span de
 * servidor no Grafana (ADR 0035).
 */
export function ErroDeCarregamento({
  titulo,
  erro,
  onTentarDeNovo,
}: ErroDeCarregamentoProps) {
  const { t } = useTranslation('ui');
  const traceId = erro instanceof ApiError ? erro.traceId : undefined;

  return (
    <Alert tone="danger" role="alert">
      <strong>{titulo}</strong>
      <p>{mensagemDaApi(erro, t('erroDeCarregamento.defaultMessage'))}</p>
      {traceId && (
        <div className={styles.trace}>{t('erroDeCarregamento.trace', { traceId })}</div>
      )}
      {onTentarDeNovo && (
        <div className={styles.acao}>
          <Button variant="secondary" onClick={onTentarDeNovo}>
            {t('erroDeCarregamento.retry')}
          </Button>
        </div>
      )}
    </Alert>
  );
}
