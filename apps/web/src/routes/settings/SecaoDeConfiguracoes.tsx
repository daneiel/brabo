import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  chaveDoId,
  idDaSecao,
  ordemDaSecao,
  SECOES_DE_CONFIGURACOES,
  type ChaveDeSecao,
} from './sumario';
import { useSecaoInicial } from './secao-inicial';
import styles from '../ProjectSettingsTab.module.css';

/**
 * A moldura de UMA seção da aba Configurações, e o registro que o sumário lê.
 *
 * ## Por que um registro, e não a lista estática direto no sumário
 *
 * SETE das 17 seções renderizam `null` em condição normal — sem repositório
 * provisionado, sem projeto carregado, sem papel de `owner` (RN-060), sem
 * catálogo. Um sumário montado da lista estática ofereceria entrada para
 * seção que não está na tela, e clicar nela não rolaria para lugar nenhum: um
 * mapa que aponta para uma sala que não existe é pior que nenhum mapa. Cada
 * seção se REGISTRA ao montar e se desregistra ao desmontar, então o sumário
 * lista exatamente o que está no DOM — e volta a listar quando a query
 * responde.
 *
 * ## Nome acessível por `aria-label`, uma regra só para as 17
 *
 * O `<section>` ganha nome acessível (vira uma `region` para a tecnologia
 * assistiva) a partir da MESMA chave de i18n que o `<h2>` da seção renderiza —
 * as duas não têm como divergir. `aria-labelledby` apontando para o `<h2>`
 * seria o caminho canônico, mas DUAS das 17 (`model-catalog`, `key-spend`)
 * delegam para componentes compartilhados com outras abas
 * (`ModelCatalogSection`, `CredentialSpendSection`) e não têm `<h2>` próprio
 * para receber um `id`. Duas regras para 17 seções envelhecem pior que uma.
 */

interface RegistroDoSumario {
  /** As seções montadas AGORA, na ordem de render. */
  presentes: ChaveDeSecao[];
  /** A seção vigente segundo o scroll-spy — `undefined` antes do primeiro passo. */
  ativa: ChaveDeSecao | undefined;
  /** Rola até a seção e leva o foco para ela. */
  irPara: (chave: ChaveDeSecao) => void;
  registrar: (chave: ChaveDeSecao, el: HTMLElement) => () => void;
}

const SumarioContext = createContext<RegistroDoSumario | undefined>(undefined);

/**
 * Quanto da altura visível conta como "topo" para o scroll-spy.
 *
 * O observador corta 62% de baixo, então só a faixa SUPERIOR da área de
 * rolagem decide quem está vigente — sem isso, a seção que acabou de entrar
 * pelo rodapé disputaria a marcação com a que o leitor está de fato lendo.
 */
const FAIXA_DO_TOPO = '0px 0px -62% 0px';

export function ProvedorDoSumario({ children }: { children: ReactNode }) {
  const elementos = useRef(new Map<ChaveDeSecao, HTMLElement>());
  const [presentes, setPresentes] = useState<ChaveDeSecao[]>([]);
  const [ativa, setAtiva] = useState<ChaveDeSecao | undefined>(undefined);
  const secaoInicial = useSecaoInicial();
  const jaRolouParaOInicial = useRef(false);

  const registrar = useCallback((chave: ChaveDeSecao, el: HTMLElement) => {
    elementos.current.set(chave, el);
    setPresentes((antes) =>
      antes.includes(chave)
        ? antes
        : [...antes, chave].sort((a, b) => ordemDaSecao(a) - ordemDaSecao(b)),
    );
    return () => {
      elementos.current.delete(chave);
      setPresentes((antes) => antes.filter((c) => c !== chave));
    };
  }, []);

  const irPara = useCallback((chave: ChaveDeSecao) => {
    const el = elementos.current.get(chave);
    if (!el) return;
    setAtiva(chave);
    // Guarda de existência no mesmo padrão de `SessionPage.tsx`: jsdom não
    // implementa `scrollIntoView`, e chamá-lo direto quebraria todo teste que
    // monta a aba. Nos navegadores o método sempre existe.
    //
    // SEM `behavior: 'smooth'`, e isso foi MEDIDO, não presumido: no Chrome,
    // dentro do container `.body` desta página, a rolagem suave simplesmente
    // não acontece — a animação é cancelada e o `scrollTop` fica onde estava
    // (0 de 1277px num salto curto, 163 de 10057 num longo). A aba tem
    // consulta em polling e 17 seções que remontam quando a resposta chega, e
    // qualquer mudança de layout aborta a animação de rolagem do container.
    // `SessionPage.tsx` usa `smooth` e funciona lá porque o alvo é um evento
    // PERTO, num container que não está se reconstruindo. Um salto instantâneo
    // é também o que um link de âncora faz.
    el.scrollIntoView?.({ block: 'start' });
    // Rolar move os OLHOS; sem isto o teclado continuaria de onde estava, e o
    // próximo `Tab` voltaria para o item seguinte do sumário em vez de entrar
    // na seção que se acabou de escolher. `preventScroll` porque quem rola é a
    // linha acima, com o comportamento suave.
    el.focus?.({ preventScroll: true });
  }, []);

  // Scroll-spy. `presentes` na dependência porque o conjunto observado muda
  // quando uma query responde e uma seção nasce ou some.
  useEffect(() => {
    // Mesma guarda de existência do `scrollIntoView`: jsdom não implementa
    // `IntersectionObserver`. Sem spy o sumário continua navegando — só não
    // acompanha a rolagem.
    if (typeof IntersectionObserver === 'undefined') return;

    const visiveis = new Set<ChaveDeSecao>();
    const observador = new IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          const chave = chaveDoId(entrada.target.id);
          if (!chave) continue;
          if (entrada.isIntersecting) visiveis.add(chave);
          else visiveis.delete(chave);
        }
        // A PRIMEIRA na ordem de render entre as visíveis — a que está mais
        // acima na tela. Nenhuma visível (uma seção altíssima cobrindo a faixa
        // inteira, ou o fim da rolagem) MANTÉM a última: apagar a marcação
        // deixaria o sumário afirmando que o leitor não está em lugar nenhum.
        const primeira = SECOES_DE_CONFIGURACOES.find((s) =>
          visiveis.has(s.chave),
        )?.chave;
        if (primeira) setAtiva(primeira);
      },
      { rootMargin: FAIXA_DO_TOPO, threshold: 0 },
    );

    for (const el of elementos.current.values()) observador.observe(el);
    return () => observador.disconnect();
  }, [presentes]);

  // Deep-link `?section=`: rola assim que a seção pedida EXISTE no DOM (ela
  // pode depender de uma query). Roda uma vez só — depois disso quem manda na
  // rolagem é o leitor, e uma segunda rolagem automática seria a tela puxando
  // a página de volta debaixo dele.
  useEffect(() => {
    if (!secaoInicial || jaRolouParaOInicial.current) return;
    if (!elementos.current.has(secaoInicial)) return;
    jaRolouParaOInicial.current = true;
    irPara(secaoInicial);
  }, [secaoInicial, presentes, irPara]);

  const valor = useMemo<RegistroDoSumario>(
    () => ({ presentes, ativa, irPara, registrar }),
    [presentes, ativa, irPara, registrar],
  );

  return <SumarioContext.Provider value={valor}>{children}</SumarioContext.Provider>;
}

/**
 * O registro, para o sumário. Fora do provedor devolve um registro VAZIO em
 * vez de estourar: as seções são renderizadas isoladamente em teste, e uma
 * seção não deve exigir a aba inteira em volta para montar.
 */
const REGISTRO_VAZIO: RegistroDoSumario = {
  presentes: [],
  ativa: undefined,
  irPara: () => {},
  registrar: () => () => {},
};

export function useSumario(): RegistroDoSumario {
  return useContext(SumarioContext) ?? REGISTRO_VAZIO;
}

interface SecaoDeConfiguracoesProps {
  chave: ChaveDeSecao;
  children: ReactNode;
  /**
   * A seção delega para um componente que já desenha a PRÓPRIA moldura
   * (`.section`) — caso das duas que embrulham componentes compartilhados.
   * Sem isto a margem de 44px sairia dobrada.
   */
  semMoldura?: boolean;
}

export function SecaoDeConfiguracoes({
  chave,
  children,
  semMoldura,
}: SecaoDeConfiguracoesProps) {
  const { t } = useTranslation(['settings', 'models']);
  const { registrar } = useSumario();
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return registrar(chave, el);
  }, [chave, registrar]);

  const descricao = SECOES_DE_CONFIGURACOES.find((s) => s.chave === chave);

  return (
    <section
      ref={ref}
      id={idDaSecao(chave)}
      // `-1`: alvo de foco programático quando o sumário navega, nunca uma
      // parada a mais na ordem natural do `Tab`.
      tabIndex={-1}
      className={[semMoldura ? undefined : styles.section, styles.ancora]
        .filter(Boolean)
        .join(' ')}
      aria-label={descricao ? t(descricao.titulo, { ns: descricao.ns }) : undefined}
    >
      {children}
    </section>
  );
}
