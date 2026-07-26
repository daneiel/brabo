/*
 * Previews do TokenMeter. Valores realistas de metering: `used`/`limit` em
 * tokens, custo nas duas moedas, e `savings*` quando o roteador escolheu um
 * modelo local em vez de nuvem.
 */
import { TokenMeter } from 'web';

const bloco: React.CSSProperties = { maxWidth: 420 };

/** O medidor cheio, dentro do orçamento. */
export function Padrao() {
  return (
    <div style={bloco}>
      <TokenMeter used={184_320} limit={500_000} costBRL={12.47} costUSD={2.29} />
    </div>
  );
}

/** Com economia — o que o roteador poupou usando Ollama em vez de nuvem. */
export function ComEconomia() {
  return (
    <div style={bloco}>
      <TokenMeter
        used={184_320}
        limit={500_000}
        costBRL={12.47}
        costUSD={2.29}
        savingsBRL={38.9}
        savingsPct={76}
      />
    </div>
  );
}

/** Perto do teto: é o estado em que a política de budget vai barrar. */
export function QuaseNoLimite() {
  return (
    <div style={bloco}>
      <TokenMeter used={487_600} limit={500_000} costBRL={33.12} costUSD={6.08} />
    </div>
  );
}

/** `compact` é a versão de barra lateral; `live` é a da sessão em andamento. */
export function Variantes() {
  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 420 }}>
      <TokenMeter
        used={184_320}
        limit={500_000}
        costBRL={12.47}
        costUSD={2.29}
        variant="compact"
      />
      <TokenMeter
        used={9_840}
        limit={50_000}
        costBRL={0.71}
        costUSD={0.13}
        variant="live"
      />
    </div>
  );
}

/** `unitLabel` troca a unidade do topo quando a fonte é orçamento, não token. */
export function MedindoOrcamento() {
  return (
    <div style={bloco}>
      <TokenMeter
        used={6}
        limit={25}
        costBRL={32.7}
        costUSD={6.0}
        unitLabel="USD"
      />
    </div>
  );
}
