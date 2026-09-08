/**
 * The record's market, in its register: a PAIR (`USDe/USDC`) is the one
 * market word the type ruling keeps in the mono; a count (`2 markets`) or a
 * reserve name is a word and inherits the sans (design team, 2026-09-08,
 * item 8: "the market PAIR only, never the count or the protocol names").
 */
export function MarketWord({ market }: { market: string }) {
  return market.includes("/") ? <span className="pair">{market}</span> : <>{market}</>;
}
