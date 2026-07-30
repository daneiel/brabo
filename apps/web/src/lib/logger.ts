import { runtimeConfig } from './runtime-config';

/**
 * Log estruturado JSON e `traceparent` por requisição (Fase 5, item 6).
 *
 * ## Por que não o SDK de browser do OpenTelemetry
 *
 * `@opentelemetry/sdk-trace-web` custa perto de 90 kB no bundle e traz um
 * exportador que precisa de CORS no coletor e de uma entrada no `connect-src` do
 * CSP. O que o item 6 pede é log JSON com `trace_id` correlacionado — e para
 * isso basta a web GERAR um `traceparent` W3C por requisição e mandá-lo no
 * header: a api o adota como parent (é o propagador padrão), então a ação do
 * usuário e o trabalho de servidor que ela disparou ficam na mesma trace, e a
 * linha de log do browser carrega o mesmo `trace_id`.
 *
 * Trocar isso pelo SDK depois é substituir esta função, sem tocar em quem loga.
 *
 * ## Nome do campo
 *
 * `trace_id` com underscore, igual à api e ao engine — é o que o
 * `derivedFields` do Loki procura. Divergir aqui quebraria só a correlação da
 * web, que é o lugar onde ninguém olharia.
 */

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LEVELS)[number];

/** 16 bytes hex. `crypto.randomUUID` não serve: trace id não tem hífen. */
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  traceparent: string;
}

/**
 * Novo contexto de trace para uma requisição.
 *
 * A flag `01` marca a trace como amostrada. Amostragem no cliente seria decidir
 * pelo servidor o que ele pode ver; quem decide é o coletor.
 */
export function newTraceContext(): TraceContext {
  const traceId = randomHex(16);
  const spanId = randomHex(8);
  return { traceId, spanId, traceparent: `00-${traceId}-${spanId}-01` };
}

/**
 * Nova span DENTRO da mesma trace (ADR 0035).
 *
 * Existe para a retentativa depois do 401: o `api-client` reusava o MESMO
 * `traceparent` nas duas tentativas, então a original e a retentativa chegavam à
 * api declarando o mesmo `span_id` como pai. O Tempo desenha isso como um nó só,
 * ambíguo — e o fato interessante (houve refresh no meio) desaparece.
 *
 * Mantém o `traceId`, troca o `spanId`.
 */
export function childSpan(pai: TraceContext): TraceContext {
  const spanId = randomHex(8);
  return {
    traceId: pai.traceId,
    spanId,
    traceparent: `00-${pai.traceId}-${spanId}-01`,
  };
}

function currentLevel(): LogLevel {
  const configured = runtimeConfig.logLevel as LogLevel | undefined;
  return configured && LEVELS.includes(configured) ? configured : 'info';
}

function enabled(level: LogLevel): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(currentLevel());
}

function emit(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  if (!enabled(level)) return;

  const line = {
    time: new Date().toISOString(),
    level,
    message,
    service: 'brabo-web',
    ...fields,
  };

  // `console` é o transporte: o navegador não tem outro, e é o que as
  // ferramentas de desenvolvimento e qualquer coletor de front-end leem.
  const payload = JSON.stringify(line);
  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else console.log(payload);
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) =>
    emit('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) =>
    emit('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) =>
    emit('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) =>
    emit('error', message, fields),

  /**
   * Loga um erro já correlacionado a uma trace.
   *
   * `trace_id` no MESMO nome dos outros dois serviços: é assim que se sai da
   * linha de log do browser para o span de servidor no Grafana.
   */
  errorWithTrace: (
    message: string,
    traceId: string | undefined,
    fields?: Record<string, unknown>,
  ) => emit('error', message, { ...fields, trace_id: traceId }),
};
