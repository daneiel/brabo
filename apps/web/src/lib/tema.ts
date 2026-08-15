/**
 * A preferência de tema — ler, gravar, alternar e observar (RN-182/RN-183,
 * ADR 0074).
 *
 * O tema claro existe em `design/tokens.css` desde sempre e era INALCANÇÁVEL:
 * nenhum caminho do produto escrevia `data-theme` no `<html>`. Este módulo é a
 * metade "produto" da correção; a metade "boot" é
 * `apps/web/public/theme-boot.js`, síncrono no `<head>`, que aplica o atributo
 * antes do primeiro paint. Os dois compartilham a chave e o default por
 * contrato, e `tema.test.ts` lê o arquivo de boot e reprova se divergirem.
 *
 * ## O que a UI consome
 *
 * O BOTÃO não mora aqui — ele é do shell (`components/Shell.tsx`). Esta é a
 * API que ele usa:
 *
 * ```tsx
 * const [tema, setTema] = useState(temaAtual);
 * useEffect(() => observarTema(setTema), []);
 * <button onClick={() => setTema(alternarTema())}>…</button>
 * ```
 *
 * - {@link temaAtual} — o tema em vigor AGORA (o atributo do `<html>` é a
 *   verdade; `localStorage` e o default são os fallbacks, nessa ordem).
 * - {@link aplicarTema} — grava a preferência E pinta a tela.
 * - {@link alternarTema} — troca para o outro e devolve o novo.
 * - {@link observarTema} — assina mudanças (inclusive de outra aba) e devolve
 *   a função que cancela a assinatura.
 *
 * Nenhuma delas lança: tema é preferência, não função. `localStorage`
 * indisponível (modo privado, storage bloqueado em iframe) degrada para
 * "aplica na tela e não persiste".
 */

export type Tema = 'dark' | 'light';

/** A chave do `localStorage`. Igual à do `public/theme-boot.js` — travado por teste. */
export const CHAVE_TEMA = 'brabo.theme';

/** O default quando não há preferência gravada. Dark é o tema primário do design system. */
export const TEMA_PADRAO: Tema = 'dark';

/** O atributo que `design/tokens.css` observa (`[data-theme='light']`). */
export const ATRIBUTO_TEMA = 'data-theme';

function ehTema(valor: unknown): valor is Tema {
  return valor === 'dark' || valor === 'light';
}

/**
 * A preferência GRAVADA, ou `null` se não houver nenhuma.
 *
 * `null` não é o mesmo que `TEMA_PADRAO`: quem nunca escolheu pode um dia
 * seguir o sistema operacional, e apagar essa distinção aqui tiraria a
 * informação de quem decidir isso depois. Valor desconhecido conta como
 * ausente — nunca vira um `data-theme` que o CSS não conhece.
 */
export function lerTemaSalvo(): Tema | null {
  try {
    const salvo = window.localStorage.getItem(CHAVE_TEMA);
    return ehTema(salvo) ? salvo : null;
  } catch {
    return null;
  }
}

/**
 * O tema em vigor. O ATRIBUTO vem primeiro de propósito: é o que a tela está
 * mostrando, e é ele que o `theme-boot.js` já resolveu. Cair no
 * `localStorage` antes disso faria a UI afirmar um tema diferente do que se vê
 * quando o boot falhou.
 */
export function temaAtual(): Tema {
  const atributo = document.documentElement.getAttribute(ATRIBUTO_TEMA);
  if (ehTema(atributo)) return atributo;
  return lerTemaSalvo() ?? TEMA_PADRAO;
}

const ouvintes = new Set<(tema: Tema) => void>();

/** Aplica o tema na tela e persiste a escolha. Devolve o tema aplicado. */
export function aplicarTema(tema: Tema): Tema {
  document.documentElement.setAttribute(ATRIBUTO_TEMA, tema);
  try {
    window.localStorage.setItem(CHAVE_TEMA, tema);
  } catch {
    // Sem persistência: a escolha vale para esta aba e se perde no reload. É
    // pior que persistir e melhor que não deixar o usuário trocar de tema.
  }
  for (const ouvinte of ouvintes) ouvinte(tema);
  return tema;
}

/** Troca para o outro tema e devolve o NOVO — o valor que a UI deve exibir. */
export function alternarTema(): Tema {
  return aplicarTema(temaAtual() === 'dark' ? 'light' : 'dark');
}

/**
 * Assina as mudanças de tema. Devolve a função que cancela — a assinatura de
 * cleanup que o `useEffect` espera.
 *
 * Cobre os dois caminhos: {@link aplicarTema} nesta aba e o evento `storage`,
 * que o navegador dispara nas OUTRAS abas do mesmo origin. Sem o segundo, dois
 * separadores abertos ficariam em temas diferentes até o próximo reload.
 */
export function observarTema(aoMudar: (tema: Tema) => void): () => void {
  ouvintes.add(aoMudar);

  const deOutraAba = (evento: StorageEvent) => {
    if (evento.key !== CHAVE_TEMA) return;
    const novo = ehTema(evento.newValue) ? evento.newValue : TEMA_PADRAO;
    document.documentElement.setAttribute(ATRIBUTO_TEMA, novo);
    aoMudar(novo);
  };
  window.addEventListener('storage', deOutraAba);

  return () => {
    ouvintes.delete(aoMudar);
    window.removeEventListener('storage', deOutraAba);
  };
}
