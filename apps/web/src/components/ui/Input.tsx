import type { InputHTMLAttributes, ReactNode } from 'react';
import { useId, useState } from 'react';
import { EyeIcon, EyeOffIcon } from './icons';
import styles from './Input.module.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  icon?: ReactNode;
  /** Rótulo visível, associado ao campo por id. */
  label?: string;
  /** Mensagem de erro sob o campo. Também marca o input como inválido. */
  error?: string | null;
  /** Texto de apoio, mostrado quando não há erro. */
  hint?: string;
  /**
   * Fundo preenchido (`--surface-2`), para o campo se separar do card que o
   * contém (ADR 0036).
   *
   * É prop e não default porque o `Input` é usado por cinco telas fora de auth, e
   * o `design/COMPONENTS.md` especifica `--surface-0`/`--surface-1` para campo.
   * Trocar o default restilizaria essas cinco em silêncio.
   *
   * Vale saber: sobre um card `--surface-1`, o default deixa campo e card com o
   * MESMO fundo, separados só por 1px de borda. As outras telas têm o mesmo
   * problema; resolvê-las é mudança própria.
   */
  preenchido?: boolean;
  /**
   * Botão de mostrar/esconder, para campo de senha.
   *
   * Fica no `Input` e não na tela porque é anatomia de campo: o botão precisa se
   * posicionar dentro da caixa e alternar o `type`, e as duas telas com senha
   * herdam o comportamento em vez de reimplementá-lo.
   */
  revelavel?: boolean;
  /**
   * Ação alinhada à direita do rótulo — no mock de login, o "Esqueci minha
   * senha" ao lado de "Senha".
   *
   * O mock põe esse link DENTRO do `<label>`. Aqui ele é irmão, porque clicar em
   * qualquer lugar de um `<label>` ativa o campo associado: dentro do rótulo, o
   * clique no link também focaria o campo de senha, e alguns navegadores tratam
   * o alvo do clique de forma diferente. Rótulo e ação lado a lado, num flex, dão
   * o mesmo resultado visual sem o conflito.
   */
  acaoNoLabel?: ReactNode;
}

/**
 * `label` e `error` entraram na Fase 7a, com as telas de auth.
 *
 * Antes o `Input` era só a caixa, e cada tela montava rótulo e erro à mão. Um
 * formulário de login sem `<label for>` é inacessível de um jeito que não
 * aparece em nenhum teste de fluxo — leitor de tela e clique no rótulo
 * simplesmente não funcionam. Como o `id` precisa ser único e estável, ele sai
 * de `useId()` em vez de ser inventado pelo chamador.
 */
export function Input({
  mono,
  icon,
  label,
  error,
  hint,
  preenchido,
  revelavel,
  acaoNoLabel,
  className,
  id,
  type,
  ...rest
}: InputProps) {
  const gerado = useId();
  const inputId = id ?? gerado;
  const descricaoId = `${inputId}-desc`;
  const [revelado, setRevelado] = useState(false);

  // Só faz sentido revelar o que está escondido. Num campo que não é senha a
  // prop é ignorada em vez de desenhar um olho que não faz nada.
  const podeRevelar = revelavel === true && type === 'password';
  const tipoEfetivo = podeRevelar && revelado ? 'text' : type;

  const classes = [
    styles.input,
    mono && styles.mono,
    icon && styles.withIcon,
    podeRevelar && styles.withToggle,
    preenchido && styles.preenchido,
    error && styles.invalid,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const campo = (
    <input
      id={inputId}
      className={classes}
      type={tipoEfetivo}
      aria-invalid={error ? true : undefined}
      aria-describedby={error || hint ? descricaoId : undefined}
      {...rest}
    />
  );

  const corpo =
    icon || podeRevelar ? (
      <div className={styles.wrapper}>
        {icon && <span className={styles.icon}>{icon}</span>}
        {campo}
        {podeRevelar && (
          <button
            type="button"
            className={styles.toggle}
            // Rótulo diz a AÇÃO, não o estado: é o que o leitor de tela anuncia
            // ao focar, e "senha visível" deixaria a pessoa sem saber o que o
            // botão faz.
            aria-label={revelado ? 'Esconder senha' : 'Mostrar senha'}
            aria-pressed={revelado}
            onClick={() => setRevelado((v) => !v)}
          >
            {revelado ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
          </button>
        )}
      </div>
    ) : (
      campo
    );

  if (!label && !error && !hint && !acaoNoLabel) return corpo;

  const rotulo = label && (
    <label className={styles.label} htmlFor={inputId}>
      {label}
    </label>
  );

  return (
    <div className={styles.campo}>
      {acaoNoLabel ? (
        <div className={styles.linhaLabel}>
          {rotulo}
          {acaoNoLabel}
        </div>
      ) : (
        rotulo
      )}
      {corpo}
      {error ? (
        <span id={descricaoId} className={styles.erro} role="alert">
          {error}
        </span>
      ) : (
        hint && (
          <span id={descricaoId} className={styles.hint}>
            {hint}
          </span>
        )
      )}
    </div>
  );
}
