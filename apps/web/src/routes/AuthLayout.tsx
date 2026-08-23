import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LogoMark } from '../components/ui/icons';
import { runtimeConfig } from '../lib/runtime-config';
import styles from './AuthLayout.module.css';

/**
 * O site publicado da documentação.
 *
 * Constante e não configuração de ambiente: as URLs em `runtime-config` são
 * propriedade do ambiente (cada deploy fala com a sua api), mas a documentação
 * do Brabo é um único site público, o mesmo para qualquer instalação. O valor
 * espelha `url` + `baseUrl` de produção em `website/docusaurus.config.ts`.
 */
const URL_DOCUMENTACAO = 'https://daneiel.github.io/brabo/';

interface AuthLayoutProps {
  /** Título do card — o que a tela faz ("Entrar", "Criar conta"). */
  titulo: string;
  /** Uma frase sob o título, dizendo o que acontece depois. */
  subtitulo: string;
  /** Corpo do card: alerta de erro, quando houver, e o formulário. */
  children: ReactNode;
  /** Faixa inferior do card, para a ação que leva a outra tela. */
  rodapeDoCartao?: ReactNode;
  /**
   * Bloco entre o card e o rodapé da página.
   *
   * Fica FORA do card de propósito: é contexto sobre a conta, não campo do
   * formulário. Dentro do card competiria com o que a pessoa veio fazer.
   */
  abaixoDoCartao?: ReactNode;
  /** Navegação, para o "Status" do rodapé da página. */
  irPara: (rota: string) => void;
}

/**
 * A moldura das quatro telas de auth (ADR 0036).
 *
 * ## Por que a moldura inteira, e não só o card
 *
 * Até a Fase 7a este componente era o card e mais nada: as telas nasceram junto
 * com o corte do Keycloak, funcionais e sem design — o Keycloak servia essas
 * telas, então elas nunca foram desenhadas. O mock aprovado acrescentou duas
 * peças que valem para as quatro telas igualmente: o cabeçalho de marca acima do
 * card e o rodapé de página abaixo. Deixá-las em cada tela significaria copiar as
 * duas quatro vezes, e ver a quarta cópia divergir na primeira mudança.
 *
 * Então a divisão é: a moldura sabe de marca, fundo e rodapé de página; a tela
 * sabe do formulário. `titulo`, `subtitulo`, `rodapeDoCartao` e `abaixoDoCartao`
 * são os quatro pontos em que a tela preenche a moldura.
 *
 * ## O fundo é decorativo, e o leitor de tela não o vê
 *
 * A grade e o brilho são dois `<div aria-hidden>` vazios. Poderiam ser
 * `background` do `<main>`, mas são duas camadas com opacidades diferentes, e
 * empilhá-las num `background-image` só amarraria a ordem delas à ordem dos
 * gradientes — mais frágil de ler do que dois elementos com nome.
 */
export function AuthLayout({
  titulo,
  subtitulo,
  children,
  rodapeDoCartao,
  abaixoDoCartao,
  irPara,
}: AuthLayoutProps) {
  const { t } = useTranslation('auth');
  return (
    <main className={styles.tela}>
      <div className={styles.grade} aria-hidden="true" />
      <div className={styles.brilho} aria-hidden="true" />

      <div className={styles.container}>
        <header className={styles.marca}>
          <span className={styles.selo} aria-hidden="true">
            <LogoMark size={23} />
          </span>
          <span className={styles.nomes}>
            <span className={styles.nome}>Brabo</span>
            <span className={styles.tagline}>{t('authLayout.tagline')}</span>
          </span>
        </header>

        <section className={styles.cartao}>
          <div className={styles.cabeca}>
            <h1 className={styles.titulo}>{titulo}</h1>
            <p className={styles.subtitulo}>{subtitulo}</p>
          </div>
          <div className={styles.corpo}>{children}</div>
          {rodapeDoCartao && (
            <div className={styles.rodapeCartao}>{rodapeDoCartao}</div>
          )}
        </section>

        {abaixoDoCartao && (
          <div className={styles.abaixoDoCartao}>{abaixoDoCartao}</div>
        )}

        <footer className={styles.rodapePagina}>
          {/*
            A versão vem crua do artefato: fora de um release ela é "dev", e isso
            é informação verdadeira — este build não nasceu de uma tag.
          */}
          <span>{runtimeConfig.version}</span>
          <span className={styles.separador} aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            className={styles.linkRodape}
            onClick={() => irPara('/status')}
          >
            {t('authLayout.statusLink')}
          </button>
          <span className={styles.separador} aria-hidden="true">
            ·
          </span>
          <a
            className={styles.linkRodape}
            href={URL_DOCUMENTACAO}
            target="_blank"
            rel="noreferrer"
          >
            {t('authLayout.docsLink')}
          </a>
        </footer>
      </div>
    </main>
  );
}
