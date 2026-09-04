import { listProjectFolders, mensagemDaApi } from './api-client';

/**
 * A INTERFACE do navegador de pastas — e os DOIS transportes que a
 * implementam (RN-504).
 *
 * ## Por que a interface saiu de `fs-browser-channel.ts`
 *
 * Porque ela deixou de ter um transporte só. O canal Phoenix
 * (`connectFsBrowserChannel`) fala com o RUNNER, na máquina do usuário; o
 * transporte novo (`criarFsBrowserViaApi`) fala com a API, que enxerga a base
 * de projetos montados (`BRABO_PROJECTS_BASE`, ADR 0141). Deixar a interface
 * morar dentro de uma das duas implementações faria a outra depender do
 * módulo da primeira só para pegar um `interface` — e o `FolderBrowserModal`,
 * que agora escolhe entre elas, importaria um socket Phoenix mesmo quando
 * nunca vai abrir um.
 *
 * ## Por que o modal precisa dos dois
 *
 * O de api é o que sobra quando o runner sai da criação de projeto: sem
 * runner, o navegador não tem como listar filesystem nenhum
 * (`showDirectoryPicker` devolve um handle do navegador, nunca um caminho
 * absoluto — e é caminho absoluto que `projects.workspace_path` guarda).
 *
 * O de runner FICA, e isso é decisão declarada do dono do produto: o runner
 * sai da interface de criação, mas o binário segue sendo refinado. Depois
 * desta entrega ele tem ZERO chamadores no web — se o refino escorregar, o
 * honesto é apagar o módulo daqui, e nada disso toca o protocolo em
 * `apps/runner/src/channel.ts` de qualquer forma.
 */

export interface FsEntrada {
  nome: string;
  isDir: boolean;
}

export interface ListagemResultado {
  path: string;
  entradas: FsEntrada[];
  erro?: string;
  /**
   * Quantos itens ficaram de FORA de `entradas`, e por quê.
   *
   * Só o transporte de api preenche — o do runner devolve pasta e arquivo
   * misturados e não conta nada. Opcional por isso, e não por ser detalhe:
   * uma tela que recebe `entradas: []` de uma pasta cheia de código diria
   * "pasta vazia", e a régua da RN-180 é que quem mostra recorte diz que é
   * recorte.
   */
  arquivos?: number;
  simbolicos?: number;
  truncado?: boolean;
}

export interface DiretorioInicialResultado {
  path?: string;
  erro?: string;
}

export interface FsBrowser {
  /** Lista o conteúdo de `path`. Nunca rejeita — falha vira `{ erro }`. */
  listarDiretorio(path: string): Promise<ListagemResultado>;
  /** Onde a navegação começa, sem exigir digitação. */
  diretorioInicial(): Promise<DiretorioInicialResultado>;
  fechar(): void;
}

/**
 * O transporte servido pela API, escopado à base de projetos montados.
 *
 * `fechar()` é NO-OP de propósito, e não uma omissão: aqui não há socket,
 * canal nem ticket — cada chamada é uma requisição HTTP independente que
 * termina sozinha. A interface mantém o método porque o modal fecha o que
 * abriu sem saber com qual transporte está falando, e um `FsBrowser` que
 * exigisse do chamador saber qual dos dois precisa de `fechar()` não seria
 * uma interface, seria dois tipos com o mesmo nome.
 *
 * `diretorioInicial()` devolve a BASE, e é uma chamada de verdade (não um
 * valor de configuração lido do cliente): a mesma resposta que traz a
 * listagem já traz `base`, então perguntar a base é perguntar a listagem
 * inicial, sem round-trip extra.
 */
export function criarFsBrowserViaApi(workspaceId: string): FsBrowser {
  async function pedir(path?: string): Promise<ListagemResultado> {
    const listagem = await listProjectFolders(workspaceId, path);
    return {
      path: listagem.path ?? '',
      // A api devolve SÓ nome de diretório — arquivo e symlink são contados,
      // nunca listados —, então `isDir` é verdade por construção. O campo
      // fica porque é o que o modal já sabe ler, e porque o transporte do
      // runner devolve os dois tipos.
      entradas: listagem.entries.map((nome) => ({ nome, isDir: true })),
      arquivos: listagem.arquivos,
      simbolicos: listagem.simbolicos,
      truncado: listagem.truncado,
    };
  }

  return {
    async listarDiretorio(path: string) {
      try {
        return await pedir(path);
      } catch (erro) {
        // Nunca rejeita: o contrato do `FsBrowser` é que falha vira estado de
        // tela, e a mensagem da api é o que ENSINA (ela nomeia a base e diz
        // o que fazer). Engoli-la por um texto genérico seria perder
        // justamente a metade útil.
        return { path, entradas: [], erro: mensagemDaApi(erro) };
      }
    },

    async diretorioInicial() {
      try {
        const listagem = await listProjectFolders(workspaceId);
        if (listagem.base === null) {
          return {
            erro:
              'Esta instalação não tem uma base de projetos configurada ' +
              '(BRABO_PROJECTS_BASE), então não há pasta para navegar.',
          };
        }
        return { path: listagem.path ?? listagem.base };
      } catch (erro) {
        return { erro: mensagemDaApi(erro) };
      }
    },

    fechar() {
      // Sem socket para desligar nem requisição em voo para cancelar.
    },
  };
}
