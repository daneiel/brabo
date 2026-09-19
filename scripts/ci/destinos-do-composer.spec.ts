import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * RN-584 — todo destino que a tela de Sessão pode dar a uma mensagem tem, no
 * engine, uma cláusula PRÓPRIA de `message/2` ou uma recusa NOMEADA. Nunca um
 * destinatário padrão.
 *
 * O defeito que isto fecha (AT-098): a última cláusula de
 * `EngineWeb.AgentCommandController.message/2` não olhava o agente, e uma
 * mensagem escrita para o `infra` era lida pelo CRIATIVO. Nada quebrava: o
 * clique respondia 202, e outro agente respondia.
 *
 * Por que a guarda mora aqui: o destino nasce em TypeScript (a tela) e a
 * cláusula mora em Elixir (o engine). ExUnit não lê TypeScript e a suíte do web
 * não lê Elixir, então esta é a mesma casa das outras guardas entre linguagens
 * (`marca-de-credencial-do-runner.spec.ts`, `flags-do-engine-no-compose.spec.ts`).
 *
 * Os destinos são DERIVADOS da fonte, nunca copiados:
 * - `AGENTES_DE_CHAT` (`apps/web/src/lib/session-readiness.ts`) é quem o
 *   composer endereça (`activeAgent`), e os literais `agentParaEnviar = '…'` de
 *   `SessionPage.tsx` são o fallback dele (o Criativo, na sessão criativa);
 * - `AgentKey` (`apps/web/src/lib/agents.ts`) é o universo: o formulário de
 *   perguntas estruturadas responde ao ATOR que perguntou (`agent={event.actor.id}`),
 *   e o ator pode ser qualquer agente do roster.
 */

const RAIZ = join(import.meta.dirname, '..', '..');

function ler(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), 'utf8');
}

function literaisEntreAspasSimples(trecho: string): string[] {
  return [...trecho.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

function extrair(texto: string, padrao: RegExp, oque: string): string {
  const achado = texto.match(padrao);
  if (!achado?.[1]) {
    throw new Error(
      `não achei ${oque}. A fonte mudou de FORMA (nome ou sintaxe) — ajuste ` +
        `este teste junto, nunca deixe a guarda cega.`,
    );
  }
  return achado[1];
}

// --- A tela ---

const agentesDeChat = literaisEntreAspasSimples(
  extrair(
    ler('apps/web/src/lib/session-readiness.ts'),
    /export const AGENTES_DE_CHAT = \[([^\]]*)\] as const/,
    '`AGENTES_DE_CHAT` em apps/web/src/lib/session-readiness.ts',
  ),
);

const fallbacksDoComposer = [
  ...ler('apps/web/src/routes/SessionPage.tsx').matchAll(
    /agentParaEnviar = '([^']+)'/g,
  ),
].map((m) => m[1]!);

const roster = literaisEntreAspasSimples(
  extrair(
    ler('apps/web/src/lib/agents.ts'),
    /export type AgentKey =([^;]*);/,
    '`AgentKey` em apps/web/src/lib/agents.ts',
  ),
);

/** O que o composer ENDEREÇA — e por isso tem de ter conversa do outro lado. */
const destinosQueConversam = [...new Set([...agentesDeChat, ...fallbacksDoComposer])];

// --- O engine ---

const CONTROLLER = 'apps/engine/lib/engine_web/controllers/agent_command_controller.ex';
const controller = ler(CONTROLLER);

interface ClausulaDeMensagem {
  /** O literal de `"agent" => "…"` da cabeça, ou `null` quando a cabeça não fixa agente. */
  agente: string | null;
  /** A cláusula entrega a um `*Server.user_message/2`. */
  conversa: boolean;
  /**
   * A cláusula responde com `recusar_mensagem/5` (4xx com `motivo` E o
   * `agent.error` durável, RN-587). `recusar/4` cru NÃO conta: a recusa que não
   * grava deixa a mensagem no fio com cara de entregue.
   */
  recusa: boolean;
  texto: string;
}

// Toda definição de topo do módulo começa em `\n  def `/`\n  defp `: o corte
// por aí isola cada cláusula com o corpo dela.
const clausulasDeMensagem: ClausulaDeMensagem[] = controller
  .split(/\n  (?=defp? )/)
  .filter((trecho) => trecho.startsWith('def message('))
  .map((texto) => {
    const cabeca = texto.slice(0, texto.indexOf(' do\n'));
    const agente = cabeca.match(/"agent" => "([^"]+)"/)?.[1] ?? null;
    return {
      agente,
      conversa: /\.user_message\(/.test(texto),
      recusa: /recusar_mensagem\(/.test(texto),
      texto,
    };
  });

const agentesDeConversaDoEngine = literaisEntreEspacos(
  extrair(
    controller,
    /@agentes_de_conversa ~w\(([^)]*)\)/,
    `\`@agentes_de_conversa\` em ${CONTROLLER}`,
  ),
);

function literaisEntreEspacos(trecho: string): string[] {
  return trecho.split(/\s+/).filter(Boolean);
}

describe('RN-584 — os destinos que a tela oferece, contra as cláusulas do engine', () => {
  it('a derivação não está cega', () => {
    // Se um dos padrões parar de casar, a lista sai vazia e todo `for` abaixo
    // passa em silêncio — é esta asserção que impede o verde vazio.
    expect(agentesDeChat.length).toBeGreaterThan(0);
    expect(fallbacksDoComposer.length).toBeGreaterThan(0);
    expect(roster.length).toBeGreaterThan(agentesDeChat.length);
    expect(clausulasDeMensagem.length).toBeGreaterThan(destinosQueConversam.length);
  });

  it('todo destino do composer tem cláusula PRÓPRIA que conversa', () => {
    const semClausula = destinosQueConversam.filter(
      (agente) =>
        !clausulasDeMensagem.some((c) => c.agente === agente && c.conversa),
    );
    expect(semClausula).toEqual([]);
  });

  it('todo destino do composer também pode ser PARADO (`via_for/2` do cancel)', () => {
    const semParar = destinosQueConversam.filter(
      (agente) => !controller.includes(`defp via_for("${agente}", session_id)`),
    );
    expect(semParar).toEqual([]);
  });

  it('nenhuma cláusula sem agente fixo na cabeça entrega a um agente', () => {
    // Era o defeito: a cláusula final casava qualquer nome e chamava o Criativo.
    const padrao = clausulasDeMensagem.filter((c) => c.agente === null && c.conversa);
    expect(padrao.map((c) => c.texto.split('\n')[0])).toEqual([]);
  });

  it('a ÚLTIMA cláusula de `message/2` é recusa nomeada', () => {
    const ultima = clausulasDeMensagem.at(-1)!;
    expect(ultima.recusa).toBe(true);
    expect(ultima.conversa).toBe(false);
  });

  it('todo agente do roster fora do composer cai numa RECUSA, nunca numa conversa', () => {
    const foraDoComposer = roster.filter((a) => !destinosQueConversam.includes(a));
    const entreguesAssimMesmo = foraDoComposer.filter((agente) =>
      clausulasDeMensagem.some((c) => c.agente === agente && c.conversa),
    );
    expect(entreguesAssimMesmo).toEqual([]);
    // Sem cláusula própria, o nome desce até a recusa genérica (cabeça sem
    // agente fixo) — que precisa existir para ele ter onde cair.
    expect(
      clausulasDeMensagem.some((c) => c.agente === null && c.recusa),
    ).toBe(true);
  });

  it('`infra` NÃO é destino do composer e tem recusa PRÓPRIA no engine', () => {
    // Decisão da RN-584: o Infra Lead é propositivo (RN-499), e o
    // `user_message/2` dele roda o turno inteiro no `handle_call`, sem o
    // aceite do ADR 0163. A tela não o oferece e o engine diz por quê.
    expect(roster).toContain('infra');
    expect(destinosQueConversam).not.toContain('infra');
    const daInfra = clausulasDeMensagem.filter((c) => c.agente === 'infra');
    expect(daInfra).toHaveLength(1);
    expect(daInfra[0]!.recusa).toBe(true);
    expect(daInfra[0]!.conversa).toBe(false);
  });

  it('a recusa de `message/2` GRAVA o `agent.error` (RN-587)', () => {
    // O `chat.message` já está no log quando o engine recusa (a api grava
    // antes). Sem o registro, a mensagem fica no fio como entregue.
    const corpo = extrair(
      controller,
      /defp recusar_mensagem\(conn, params, status, motivo, mensagem\) do\n([\s\S]*?)\n  end\n/,
      '`recusar_mensagem/5` no controller',
    );
    expect(corpo).toMatch(/registrar_recusa_de_mensagem\(params, motivo, mensagem\)/);
    expect(corpo).toMatch(/recusar\(conn, status, motivo, mensagem\)/);
    const registro = extrair(
      controller,
      /defp registrar_recusa_de_mensagem\(\n([\s\S]*?)\n  defp registrar_recusa_de_mensagem\(_params/,
      '`registrar_recusa_de_mensagem/3` no controller',
    );
    expect(registro).toMatch(/EngineApiClient\.append_event\(/);
    expect(registro).toMatch(/type: "agent\.error"/);
    // Nenhuma cláusula de `message/2` responde com `recusar/4` cru.
    const cruas = clausulasDeMensagem.filter((c) => /\brecusar\(/.test(c.texto));
    expect(cruas.map((c) => c.texto.split('\n')[0])).toEqual([]);
  });

  it('`@agentes_de_conversa` é exatamente o conjunto das cláusulas que conversam', () => {
    const queConversam = clausulasDeMensagem
      .filter((c) => c.conversa)
      .map((c) => c.agente);
    expect([...agentesDeConversaDoEngine].sort()).toEqual(
      [...(queConversam as string[])].sort(),
    );
  });
});
