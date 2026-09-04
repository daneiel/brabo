import { describe, expect, it } from 'vitest';
import {
  ConfiguracaoInvalidaError,
  lerConfiguracao,
  PORTA_PADRAO,
  tokenConfere,
} from './config.ts';

/**
 * A leitura de ambiente do broker, com a mesma régua do ADR 0059/RN-114 do
 * lado da api — e aqui ela pesa mais: o default está publicado neste
 * repositório e este processo fala com o Docker do host.
 */

describe('lerConfiguracao — desenvolvimento', () => {
  it('cai no default público quando a variável está ausente', () => {
    const config = lerConfiguracao({});

    expect(config.tokenDeServico).toBe('dev-service-token-change-me');
    expect(config.porta).toBe(PORTA_PADRAO);
    expect(config.apiUrl).toBe('http://api:3000');
    // Não configurada é estado LEGÍTIMO: só `start` recusa, e dizendo qual
    // variável falta.
    expect(config.raizDeWorkspacesNoHost).toBeNull();
    expect(config.baseDeProjetosNoHost).toBeNull();
  });

  it('lê as DUAS raízes de variáveis separadas, e nenhuma cai na outra (RN-501)', () => {
    const config = lerConfiguracao({
      PROJECT_WORKSPACES_HOST_ROOT: '/srv/brabo/project-workspaces',
      BRABO_PROJECTS_HOST_BASE: '/home/voce/brabo',
    });

    expect(config.raizDeWorkspacesNoHost).toBe('/srv/brabo/project-workspaces');
    expect(config.baseDeProjetosNoHost).toBe('/home/voce/brabo');
  });

  it('uma configurada e a outra não é estado legítimo — não há herança entre elas', () => {
    // Herdar seria o pior desfecho possível: a raiz gerenciada é nomeada por
    // `workspace_dir_name` e a base é nomeada pelo usuário, então o mesmo nome
    // aponta para pastas diferentes, e o container subiria com a pasta errada
    // sem nada indicando por quê.
    const soGerenciada = lerConfiguracao({
      PROJECT_WORKSPACES_HOST_ROOT: '/srv/brabo/project-workspaces',
    });
    const soBase = lerConfiguracao({
      BRABO_PROJECTS_HOST_BASE: '/home/voce/brabo',
    });

    expect(soGerenciada.baseDeProjetosNoHost).toBeNull();
    expect(soBase.raizDeWorkspacesNoHost).toBeNull();
  });

  it('tira a barra final da API_URL para não montar `//internal`', () => {
    expect(lerConfiguracao({ API_URL: 'http://api:3000/' }).apiUrl).toBe(
      'http://api:3000',
    );
  });

  it('recusa BROKER_PORT que não é porta', () => {
    expect(() => lerConfiguracao({ BROKER_PORT: 'oitenta' })).toThrow(
      ConfiguracaoInvalidaError,
    );
    expect(() => lerConfiguracao({ BROKER_PORT: '70000' })).toThrow(
      ConfiguracaoInvalidaError,
    );
  });
});

describe('lerConfiguracao — produção', () => {
  const producao = { NODE_ENV: 'production' };

  it('recusa subir sem BRABO_SERVICE_TOKEN', () => {
    expect(() => lerConfiguracao(producao)).toThrow(/obrigatória em produção/);
  });

  it('recusa o valor de exemplo do repositório MESMO definido', () => {
    // O caminho real de erro não é a variável ausente: é ela definida com o
    // valor público. Exigir "não vazia" não pegaria nada.
    expect(() =>
      lerConfiguracao({
        ...producao,
        BRABO_SERVICE_TOKEN: 'dev-service-token-change-me',
      }),
    ).toThrow(/público/);
  });

  it('recusa token curto demais', () => {
    expect(() =>
      lerConfiguracao({ ...producao, BRABO_SERVICE_TOKEN: 'curto' }),
    ).toThrow(/mínimo em produção/);
  });

  it('aceita um token próprio', () => {
    const config = lerConfiguracao({
      ...producao,
      BRABO_SERVICE_TOKEN: 'um-token-bem-longo-de-verdade',
    });

    expect(config.tokenDeServico).toBe('um-token-bem-longo-de-verdade');
  });
});

describe('tokenConfere', () => {
  const config = lerConfiguracao({
    BRABO_SERVICE_TOKEN: 'token-de-teste-atual-nao-e-segredo',
    BRABO_SERVICE_TOKEN_PREVIOUS: 'token-de-teste-anterior-nao-e-segredo',
  });

  it('aceita o atual e o anterior, recusa o resto', () => {
    expect(tokenConfere('token-de-teste-atual-nao-e-segredo', config)).toBe(true);
    expect(tokenConfere('token-de-teste-anterior-nao-e-segredo', config)).toBe(true);
    expect(tokenConfere('qualquer-outro', config)).toBe(false);
    expect(tokenConfere('', config)).toBe(false);
  });

  it('ignora um `PREVIOUS` igual ao atual — não haveria rotação nenhuma', () => {
    const semRotacao = lerConfiguracao({
      BRABO_SERVICE_TOKEN: 'token-de-teste-igual-nao-e-segredo',
      BRABO_SERVICE_TOKEN_PREVIOUS: 'token-de-teste-igual-nao-e-segredo',
    });

    expect(semRotacao.tokenAnterior).toBeNull();
  });

  it('compara em tempo constante — a comparação injetada é a usada', () => {
    // O `===` vazaria o segredo byte a byte para quem medisse o tempo, e esta
    // é uma porta que aceita tentativa repetida sem custo.
    const vistos: Array<[string, string]> = [];
    tokenConfere('apresentado', config, (a, b) => {
      vistos.push([a, b]);
      return false;
    });

    expect(vistos).toEqual([
      ['apresentado', 'token-de-teste-atual-nao-e-segredo'],
      ['apresentado', 'token-de-teste-anterior-nao-e-segredo'],
    ]);
  });
});
