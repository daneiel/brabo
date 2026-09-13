/**
 * assets-do-instalador — os arquivos que o `install.sh` precisa para SUBIR a
 * instalação, publicados como assets da Release e cobertos pelo
 * `checksums.txt` assinado ([ADR 0160](../../docs/adr/0160-o-compose-do-instalador-viaja-assinado.md),
 * RN-570).
 *
 * Até o ADR 0160 o instalador subia a pilha com
 * `docker compose -f docker/docker-compose.install.yml`, um caminho RELATIVO ao
 * diretório de onde rodava — e nenhum dos arquivos atrás desse caminho viajava
 * com ele. Quem seguia o one-liner do runbook numa pasta vazia morria em "no
 * such file or directory" DEPOIS de o script ter gravado o `.env` com os
 * segredos (medido pela AT-008, RN-549). A decisão foi publicar os arquivos
 * como assets e pô-los no MESMO manifesto assinado que já cobre o binário do
 * runner e o próprio `install.sh`: o que sobe a instalação passa a ser
 * verificado como o resto, e não confiado ao transporte de ninguém.
 *
 * ## Por que o nome do asset não é o nome do arquivo
 *
 * A Release é PLANA: um asset é um nome, sem pasta. `init.sql` e
 * `pull-models.sh` são nomes genéricos o bastante para colidir com o próximo
 * asset que alguém anexar, e o `checksums.txt` é indexado por nome — dois
 * arquivos com o mesmo nome seriam uma linha só, e a verificação de um deles
 * passaria contra o hash do outro. Por isso todo asset daqui carrega o prefixo
 * `brabo-install-`, e o `caminho` diz onde ele volta a morar na máquina de quem
 * instala (relativo à pasta de onde o instalador roda — a mesma do `.env`).
 *
 * ## Por que a tabela existe DUAS vezes
 *
 * Aqui (quem PUBLICA, no job `checksums` de `build-runner-binaries.yml`) e no
 * `case` de `destino_do_asset_do_instalador` em `install.sh` (quem BAIXA). O
 * instalador roda na máquina dos outros, com bash 3.2 no macOS e sem Node, e
 * não pode ler este arquivo. A divergência entre as duas é reprovada por
 * `assets-do-instalador.spec.ts`, que lê o `case` do shell — e é o mesmo teste
 * que reprova o compose ganhar um bind-mount `./…` que não esteja nesta lista,
 * que é exatamente como o defeito original nasceu.
 *
 * Sem dependência de pacote de propósito: o job `checksums` não roda
 * `pnpm install`, só `node` sobre este arquivo (type stripping).
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export interface AssetDoInstalador {
  /** O nome do asset na Release — e a chave da linha no `checksums.txt`. */
  readonly asset: string;
  /** Onde ele mora no repositório E sob a pasta da instalação. */
  readonly caminho: string;
  /** Por que o instalador precisa dele. */
  readonly papel: string;
}

export const PREFIXO_DOS_ASSETS = 'brabo-install-';

export const ASSETS_DO_INSTALADOR: readonly AssetDoInstalador[] = [
  {
    asset: 'brabo-install-compose.yml',
    caminho: 'docker/docker-compose.install.yml',
    papel: 'o compose que sobe a instalação',
  },
  {
    asset: 'brabo-install-postgres-init.sql',
    caminho: 'docker/postgres/init.sql',
    papel: 'bind-montado pelo `postgres` do compose — é ele que cria a extensão pgvector',
  },
  {
    asset: 'brabo-install-ollama-pull-models.sh',
    caminho: 'docker/ollama/pull-models.sh',
    papel: 'bind-montado pelo `ollama-model-loader`, sob o profile `llm`',
  },
  {
    asset: 'brabo-install-backup-test-restore.sh',
    caminho: 'docker/backup/test-restore-compose.sh',
    papel: 'a prova de restauração que a migração roda ANTES de apagar (RN-530)',
  },
];

/**
 * Os assets que a Release JÁ publica, por nome exato, e os prefixos que um
 * `gh release download --pattern` já usa. Um asset do instalador que casasse
 * com qualquer um deles seria baixado, hasheado ou sobrescrito por quem não o
 * espera.
 */
export const NOMES_QUE_A_RELEASE_JA_USA: readonly string[] = [
  'install.sh',
  'checksums.txt',
  'checksums.txt.bundle',
  'images.json',
];
export const PREFIXOS_QUE_A_RELEASE_JA_USA: readonly string[] = ['brabo-runner-'];

/** Tudo o que está errado na tabela, em frases. Vazio é tabela boa. */
export function problemasDoMapeamento(lista: readonly AssetDoInstalador[]): string[] {
  const problemas: string[] = [];
  const assets = new Set<string>();
  const caminhos = new Set<string>();

  for (const { asset, caminho } of lista) {
    if (!asset.startsWith(PREFIXO_DOS_ASSETS)) {
      problemas.push(`${asset}: todo asset do instalador começa com '${PREFIXO_DOS_ASSETS}'`);
    }
    // O nome vai para um `awk '$2 == nome'` e para uma URL: sem espaço, sem
    // barra, sem nada que precise ser escapado em nenhum dos dois.
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(asset)) {
      problemas.push(`${asset}: nome de asset só com [a-z0-9.-]`);
    }
    if (NOMES_QUE_A_RELEASE_JA_USA.includes(asset)) {
      problemas.push(`${asset}: colide com um asset que a Release já publica`);
    }
    for (const prefixo of PREFIXOS_QUE_A_RELEASE_JA_USA) {
      if (asset.startsWith(prefixo)) {
        problemas.push(`${asset}: casa com o padrão '${prefixo}*' que o job \`checksums\` já baixa`);
      }
    }
    if (assets.has(asset)) problemas.push(`${asset}: asset repetido`);
    assets.add(asset);

    // O caminho é concatenado a uma raiz, dos DOIS lados. Absoluto ou com `..`
    // escreveria fora da pasta da instalação na máquina de quem instala.
    if (path.isAbsolute(caminho) || caminho.split('/').includes('..') || caminho !== path.posix.normalize(caminho)) {
      problemas.push(`${caminho}: caminho relativo, normalizado e sem '..'`);
    }
    if (caminhos.has(caminho)) problemas.push(`${caminho}: dois assets para o mesmo caminho`);
    caminhos.add(caminho);
  }

  return problemas;
}

/**
 * Copia cada arquivo do checkout para `destino/<asset>` e devolve os nomes, na
 * ordem da tabela. Lança nomeando o que falta — um asset ausente aqui é uma
 * linha a menos no manifesto, e o instalador recusaria na máquina de alguém.
 */
export function prepararAssets(raiz: string, destino: string, lista = ASSETS_DO_INSTALADOR): string[] {
  const problemas = problemasDoMapeamento(lista);
  if (problemas.length > 0) throw new Error(`tabela de assets inválida:\n  ${problemas.join('\n  ')}`);

  mkdirSync(destino, { recursive: true });
  const nomes: string[] = [];
  for (const { asset, caminho } of lista) {
    const origem = path.join(raiz, caminho);
    if (!existsSync(origem)) throw new Error(`${caminho} não existe no checkout — sem ele ${asset} não é publicado`);
    copyFileSync(origem, path.join(destino, asset));
    nomes.push(asset);
  }
  return nomes;
}

// ------------------------------------------------------------- adaptador CLI
//
//   node scripts/ci/assets-do-instalador.ts preparar <raiz-do-checkout> <destino>
//
// STDOUT é UM nome de asset por linha, e nada mais — é o contrato do `$(...)`
// do workflow, que os passa ao `sha256sum` e ao `gh release upload`. O resto
// vai para STDERR.

function principal(): void {
  const [, , comando = '', raiz = '', destino = ''] = process.argv;
  if (comando !== 'preparar' || !raiz || !destino) {
    console.error('uso: node scripts/ci/assets-do-instalador.ts preparar <raiz-do-checkout> <destino>');
    process.exit(2);
  }
  try {
    const nomes = prepararAssets(raiz, destino);
    for (const nome of nomes) console.log(nome);
    console.error(`assets-do-instalador: ${nomes.length} arquivos preparados em ${destino}`);
  } catch (erro) {
    console.error(`::error::assets-do-instalador: ${erro instanceof Error ? erro.message : String(erro)}`);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('assets-do-instalador.ts')) {
  principal();
}
