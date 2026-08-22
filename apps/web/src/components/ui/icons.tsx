import type { SVGProps } from 'react';

// Ícones outline extraídos do design system (stroke 1.6, grid 24px,
// currentColor — ver design/COMPONENTS.md "Iconografia"). Um componente
// por ícone, todos com a mesma assinatura de props.

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base(paths: string[], props: IconProps, fill: 'none' | 'currentColor' = 'none') {
  const { size = 16, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export const SearchIcon = (props: IconProps) =>
  base(['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M21 21l-4-4'], props);

export const BellIcon = (props: IconProps) =>
  base(
    ['M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
    props,
  );

export const PlusIcon = (props: IconProps) => base(['M12 5v14M5 12h14'], props);

export const ChevronDownIcon = (props: IconProps) => base(['M6 9l6 6 6-6'], props);

export const ChevronRightIcon = (props: IconProps) => base(['M9 6l6 6-6 6'], props);

// Carrossel (RN-148) — o par que faltava do `ChevronRightIcon` para
// navegação "anterior".
export const ChevronLeftIcon = (props: IconProps) => base(['M15 6l-6 6 6 6'], props);

export const XIcon = (props: IconProps) => base(['M6 6l12 12M18 6L6 18'], props);

export const CheckIcon = (props: IconProps) => base(['M20 6L9 17l-5-5'], props);

export const AlertIcon = (props: IconProps) =>
  base(
    [
      'M12 9v4M12 17h.01',
      'M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    ],
    props,
  );

/*
 * Erro, e o par do `AlertIcon` de propósito: no mock de login o triângulo marca
 * ATENÇÃO (o aviso de migração, que não impede nada) e o círculo marca FALHA (a
 * credencial recusada). Duas coisas diferentes com o mesmo símbolo obrigariam a
 * ler o texto para saber qual é.
 */
export const AlertCircleIcon = (props: IconProps) =>
  base(['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 8v4M12 16h.01'], props);

export const ClockIcon = (props: IconProps) =>
  base(['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'], props);

export const TerminalIcon = (props: IconProps) =>
  base(['M4 6l5 5-5 5', 'M12 18h8'], props);

export const DiffIcon = (props: IconProps) =>
  base(['M12 5v14M5 8h6M5 12h6M16 12h3M17.5 10.5v3'], props);

/** Saída de comando/build — linhas de log, para distinguir do prompt do TerminalIcon. */
export const OutputIcon = (props: IconProps) =>
  base(['M4 6h16M4 12h10M4 18h13'], props);

export const ModelIcon = (props: IconProps) =>
  base(['M21 16V8l-9-5-9 5v8l9 5 9-5z', 'M3.5 7.5 12 12l8.5-4.5M12 12v9.5'], props);

export const GaugeIcon = (props: IconProps) =>
  base(['M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z', 'M12 12l4-2.5', 'M12 7v1'], props);

export const AgentBoxIcon = (props: IconProps) =>
  base(
    [
      'M6 6h12v12H6z',
      'M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3',
    ],
    props,
  );

export const BranchIcon = (props: IconProps) =>
  base(
    [
      'M6 8.4v7.2',
      'M8.2 6.6c6 0 7.8 1.2 7.8 4.4',
    ],
    { ...props },
  );

export const DeployIcon = (props: IconProps) =>
  base(
    ['M12 3c3.5 2 5 5.5 5 9 0 2-1 4-3 5H10c-2-1-3-3-3-5 0-3.5 1.5-7 5-9z', 'M9 17l-2 4M15 17l2 4'],
    props,
  );

export const CommitIcon = (props: IconProps) =>
  base(['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'M2 12h6M16 12h6'], props);

export const PrIcon = (props: IconProps) =>
  base(
    [
      'M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
      'M6 9v12',
      'M18 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
      'M18 12v3a3 3 0 0 1-3 3H9',
    ],
    props,
  );

export const HypothesisIcon = (props: IconProps) =>
  base(
    [
      'M9 21h6M10 21v-3M14 21v-3',
      'M12 3a6 6 0 0 1 4 10.5c-.6.5-1 1.2-1 2H9c0-.8-.4-1.5-1-2A6 6 0 0 1 12 3z',
    ],
    props,
  );

export const PermissionIcon = (props: IconProps) =>
  base(['M12 3l7 3v5c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z', 'M9 12l2 2 4-4'], props);

export const SessionIcon = (props: IconProps) =>
  base(['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M15 9l-6 6', 'M9 9l6 6'], props);

export const TrashIcon = (props: IconProps) =>
  base(['M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14'], props);

// FASE PROGRAMA 16-26 — afordância de RENOMEAR fora da tela de sessão
// (lista de sessões do projeto, RN-098 alcançável sem abrir a sessão).
export const PencilIcon = (props: IconProps) =>
  base(
    ['M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z', 'M14.5 5.5l3 3'],
    props,
  );

export const ArrowUpIcon = (props: IconProps) => base(['M12 20V4', 'M5 11l7-7 7 7'], props);

// FASE 20 — a seta de VOLTAR. A tela de sessão não tinha saída nenhuma: nem
// `Link`, nem `useNavigate`, e nenhum caminho de volta ao dashboard.
export const ArrowLeftIcon = (props: IconProps) =>
  base(['M20 12H4', 'M11 19l-7-7 7-7'], props);

export const LayoutSidebarIcon = (props: IconProps) =>
  base(['M3 4h18v16H3z', 'M15 4v16'], props);

export const StopSquareIcon = (props: IconProps) =>
  base(['M6 6h12v12H6z'], props);

export const SettingsIcon = (props: IconProps) =>
  base(
    [
      'M19.4 13a7.8 7.8 0 0 0 .1-2l2-1.6-2-3.4-2.4 1a7.8 7.8 0 0 0-1.7-1l-.4-2.5H9.9l-.4 2.5a7.8 7.8 0 0 0-1.7 1l-2.4-1-2 3.4L3.5 11a7.8 7.8 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.8 7.8 0 0 0 1.7 1l.4 2.5h4.2l.4-2.5a7.8 7.8 0 0 0 1.7-1l2.4 1 2-3.4z',
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    ],
    props,
  );

export const ChatIcon = (props: IconProps) =>
  base(['M21 11.5a8.4 8.4 0 0 1-9 8.4L3 21l1.1-3.6A8.4 8.4 0 1 1 21 11.5z'], props);

/**
 * Cubo isométrico. **Não é a marca do Brabo** — a marca é o `LogoMark` no fim
 * deste arquivo, o monograma B, e o handoff é explícito em que ela é o único
 * asset de marca do produto.
 *
 * Este desenho ocupava o cabeçalho da sidebar até a FASE 17a e é genérico:
 * serve como ícone de "pacote"/"artefato" onde fizer sentido. Não o use para
 * representar o produto.
 */
export const BrandIcon = (props: IconProps) =>
  base(['M12 3l7 4v10l-7 4-7-4V7z', 'M12 3v18M5 7l7 4 7-4'], props);

export const GitHubIcon = (props: IconProps) =>
  base(
    [
      'M12 2C6.5 2 2 6.5 2 12c0 4.4 2.9 8.2 6.8 9.5.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-4.9 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.8-2.3 4.6-4.6 4.9.4.3.7.9.7 1.8v2.7c0 .3.2.6.7.5A10 10 0 0 0 22 12c0-5.5-4.5-10-10-10z',
    ],
    props,
    'currentColor',
  );

export const GitLabIcon = (props: IconProps) =>
  base(['M12 21l3.5-10.5H8.5L12 21zM12 21 3.5 10.5 5 4l3.5 6.5M12 21l8.5-10.5L19 4l-3.5 6.5'], props);

export const LocalRepoIcon = (props: IconProps) =>
  base(['M4 5h16v11H4z', 'M2 20h20M9 16v4M15 16v4'], props);

export const BulbIcon = (props: IconProps) =>
  base(
    ['M9 21h6', 'M10 18h4', 'M12 3a6.5 6.5 0 0 0-3.5 12c.8.5 1.5 1.3 1.5 2.5h4c0-1.2.7-2 1.5-2.5A6.5 6.5 0 0 0 12 3z'],
    props,
  );

export const StackIcon = (props: IconProps) =>
  base(['M12 3 2 8l10 5 10-5-10-5z', 'M2 13l10 5 10-5', 'M2 18l10 5 10-5'], props);

export const UserIcon = (props: IconProps) =>
  base(['M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z', 'M4 21c0-4.5 3.6-7 8-7s8 2.5 8 7'], props);

export const CodeIcon = (props: IconProps) =>
  base(['M9 8 4 12l5 4', 'M15 8l5 4-5 4'], props);

/** Explorador de arquivos da aba Code (FASE 26). */
export const FolderIcon = (props: IconProps) =>
  base(['M3 6h6l2 2h10v11H3z'], props);

export const FileIcon = (props: IconProps) =>
  base(['M6 2h9l5 5v15H6z', 'M15 2v5h5'], props);

export const ServerIcon = (props: IconProps) =>
  base(['M4 4h16v6H4z', 'M4 14h16v6H4z', 'M7 7h.01M7 17h.01'], props);

export const LockIcon = (props: IconProps) =>
  base(['M6 11h12v9H6z', 'M8 11V7a4 4 0 1 1 8 0v4'], props);

export const EyeIcon = (props: IconProps) =>
  base(
    ['M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z', 'M14.6 12a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0z'],
    props,
  );

export const EyeOffIcon = (props: IconProps) =>
  base(
    [
      'M3 3l18 18',
      'M10.6 5.7A9.9 9.9 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-2.8 3.6',
      'M6.4 7.4A17 17 0 0 0 2 12s3.6 6.5 10 6.5c1 0 1.9-.1 2.7-.4',
      'M9.6 9.8a2.6 2.6 0 0 0 3.5 3.6',
    ],
    props,
  );

/**
 * A marca do Brabo, e a ÚNICA: haste vertical sólida e dois chevrons. De perto é
 * a letra B; de longe lê-se `>>` — agentes avançando em cadeia. Os paths são os
 * canônicos do `design_handoff_brabo/README.md`, seção "Marca".
 *
 * Aplicação: ladrilho `--accent` com traço `--on-accent` e raio ≈28% do lado
 * (32px→9px na sidebar, 40px→11px nas telas de auth). Nunca girar, esticar,
 * contornar nem aplicar gradiente. Abaixo de 16px o chevron inferior sobe para
 * .7 de opacidade.
 *
 * Foge do `base()` de propósito: os três traços têm espessuras diferentes (3.4 e
 * 2.8) e o segundo chevron tem opacidade própria (.58, que é o handoff ainda em
 * execução) — é isso que dá a sensação de profundidade. Um `stroke-width` único
 * achataria o desenho.
 */
// Botão de tema do rodapé da sidebar (PROGRAMA 28, Onda 2 — RN-199).
export const SunIcon = (props: IconProps) =>
  base(
    [
      'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
      'M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    ],
    props,
  );

export const MoonIcon = (props: IconProps) =>
  base(['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'], props);

// Seção "Atividades" da sidebar (PROGRAMA 28, Onda 2 — RN-198): o mesmo
// glifo de pulso/atividade nos dois lugares (item da barra e ícone da
// trilha recolhida).
export const ActivityIcon = (props: IconProps) =>
  base(['M3 12h4l2.5-7 4 14 2.5-7H21'], props);

// Botão "sair" no rodapé recolhido (PROGRAMA 28, Onda 2) — o texto some sob
// 62px, mas o botão continua acessível por `aria-label`/`title`.
export const LogoutIcon = (props: IconProps) =>
  base(['M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4', 'M15 16l4-4-4-4', 'M19 12H9'], props);

export const LogoMark = ({ size = 24, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    <path d="M5.4 3.6v16.8" strokeWidth={3.4} />
    <path d="M10.4 4.6l5.6 3.8-5.6 3.8" strokeWidth={2.8} />
    <path d="M10.4 12l5.6 3.8-5.6 3.8" strokeWidth={2.8} opacity={0.58} />
  </svg>
);
