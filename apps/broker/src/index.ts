#!/usr/bin/env node
/**
 * O broker de container — o ÚNICO processo deste produto que fala com o daemon
 * Docker do servidor (ADR 0130).
 *
 * ## O que ele é, em cinco linhas
 *
 * Recebe da api um `projectId` e uma das cinco operações da `DockerPort`. Vai
 * à api LER a decisão do Arquiteto e o contexto do projeto. COMPÕE a
 * especificação ele mesmo e a faz passar pelo parse que produz o tipo fechado.
 * Entrega ao daemon pelo mesmo adaptador de CLI que o runner usa. Nunca aceita
 * especificação, porque não existe campo em que se escreva uma.
 *
 * ## Por que ele não tem porta publicada
 *
 * `/var/run/docker.sock` é root no host, e quem alcança este processo alcança
 * aquilo por procuração. A contenção é em camadas, e nenhuma delas confia nas
 * outras: sem porta publicada (só a rede interna do Compose, com a api do
 * outro lado), token de serviço comparado em tempo constante, cinco operações
 * de superfície fechada, e a especificação COMPUTADA e não recebida.
 *
 * ## O que ele NÃO faz, e não é esquecimento
 *
 * Não sobe container por conta própria: não há laço, não há fila, não há
 * gatilho. Ele age quando chamado, e quem o chama hoje só faz LEITURA
 * (`inspect`, pela rota de ciclo de vida da api). Quem vai propor uma subida é
 * o Infra Lead, por `proposed_action`, com autoridade final do usuário — e
 * isso é outro PR. Um serviço que subisse container sozinho seria efeito
 * externo sem aprovação, que é a regra mais antiga deste produto.
 */

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DockerViaCli } from '@brabo/docker-port';
import { criarBuscadorDeContexto } from './api-client.ts';
import { ConfiguracaoInvalidaError, lerConfiguracao } from './config.ts';
import { criarServidor } from './servidor.ts';
import type { DependenciasDoBroker } from './operacoes.ts';

export function main(): void {
  let config;
  try {
    config = lerConfiguracao();
  } catch (erro) {
    if (erro instanceof ConfiguracaoInvalidaError) {
      // Recusa de boot com a mensagem inteira, como os resolutores de segredo
      // da api (ADR 0059/RN-114): subir com configuração errada é pior do que
      // não subir, porque a falha aparece longe da causa.
      console.error(`broker: ${erro.message}`);
      process.exit(2);
    }
    throw erro;
  }

  const deps: DependenciasDoBroker = {
    docker: new DockerViaCli(),
    buscarContexto: criarBuscadorDeContexto(config),
    config,
  };

  const servidor = criarServidor(deps);
  servidor.listen(config.porta, () => {
    console.log(
      `broker de container ouvindo na porta ${config.porta} — api em ` +
        `${config.apiUrl}, raiz de workspaces no host: ` +
        `${config.raizDeWorkspacesNoHost ?? '(não configurada — `start` recusa)'}`,
    );
  });

  // SIGTERM sem intermediário: o processo é PID 1 na imagem, e um `exec` em
  // andamento é um subprocesso `docker` que o daemon não perde se este morrer.
  process.on('SIGTERM', () => {
    servidor.close(() => process.exit(0));
  });
}

// Guarda de auto-run, mesma forma do runner (`apps/runner/src/index.ts`) e
// pela mesma razão: importar este módulo num teste não pode subir servidor
// nenhum. `realpathSync` porque `process.argv[1]` pode ser um symlink e
// `import.meta.url` nunca é — sem ele a comparação daria `false` sempre que o
// processo fosse iniciado por um link. O caso do binário `bun --compile` do
// runner não existe aqui: este pacote nunca vira binário standalone.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  main();
}
