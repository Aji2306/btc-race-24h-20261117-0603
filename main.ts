import { runBars } from './vendor/makefun-bars.ts';

const closes: bigint[] = [];
let entryPrice: bigint | null = null;
let entryBarSeq = -1;
let peakSinceEntry: bigint | null = null;
let lastExitBarSeq = -999;

await runBars({
  onBatch(state, batch) {
    const bar = state.latest.get('CBBTC');
    if (!bar) return [];
    const close = BigInt(bar.c);
    closes.push(close);
    if (closes.length > 300) {
      closes.shift();
    }

    const pos = state.positions.get('CBBTC');
    const hasPosition = pos !== undefined && pos.qty > 0n;

    if (hasPosition) {
      if (entryPrice === null) {
        entryPrice = close;
        entryBarSeq = state.seq;
        peakSinceEntry = close;
      }
      if (peakSinceEntry === null || close > peakSinceEntry) {
        peakSinceEntry = close;
      }
    } else {
      entryPrice = null;
      entryBarSeq = -1;
      peakSinceEntry = null;
    }

    // EXIT
    if (hasPosition && entryPrice !== null && peakSinceEntry !== null) {
      const pnlBps = ((close - entryPrice) * 10000n) / entryPrice;
      const trailBps = ((peakSinceEntry - close) * 10000n) / peakSinceEntry;
      const timeoutReached = (state.seq - entryBarSeq) >= 480;
      if (pnlBps >= 180n || trailBps >= 150n || timeoutReached) {
        const qtyToSell = pos.qty;
        entryPrice = null;
        peakSinceEntry = null;
        lastExitBarSeq = state.seq;
        return [{ side: 'sell', symbol: 'CBBTC', qty: qtyToSell, max_slippage_bps: 200 }];
      }
    }

    // ENTRY
    if (!hasPosition && closes.length >= 120 && (state.seq - lastExitBarSeq) >= 30) {
      const slice120 = closes.slice(-120);
      let high = slice120[0]!;
      for (const p of slice120) {
        if (p > high) high = p;
      }

      const dropBps = ((high - close) * 10000n) / high;

      const slice10 = closes.slice(-10);
      let low10 = slice10[0]!;
      for (const p of slice10) {
        if (p < low10) low10 = p;
      }

      const bounceBps = ((close - low10) * 10000n) / low10;

      if (dropBps >= 100n && bounceBps >= 10n) {
        const cashToUse = (state.cash * 95n) / 100n;
        const minNotional = BigInt(state.hello.fees.min_notional_quote_units ?? 1_000_000n);
        if (cashToUse >= minNotional && state.weightRoom('CBBTC') >= minNotional) {
          return [{ side: 'buy', symbol: 'CBBTC', notional_quote_units: cashToUse, max_slippage_bps: 200 }];
        }
      }
    }

    return [];
  },
});
