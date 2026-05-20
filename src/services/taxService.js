const DEFAULT_PPN_RATE = 11;

function calcLineAmount(qty, unitPrice, ppnIncluded = true, ppnRate = DEFAULT_PPN_RATE) {
  const q = Number(qty) || 0;
  const p = Number(unitPrice) || 0;
  const net = q * p;
  const rate = Number(ppnRate) || DEFAULT_PPN_RATE;
  if (ppnIncluded) {
    return Number(net.toFixed(2));
  }
  const ppn = net * (rate / 100);
  return Number((net + ppn).toFixed(2));
}

function lineTaxBreakdown(qty, unitPrice, ppnIncluded = true, ppnRate = DEFAULT_PPN_RATE) {
  const q = Number(qty) || 0;
  const p = Number(unitPrice) || 0;
  const rate = Number(ppnRate) || DEFAULT_PPN_RATE;
  const gross = q * p;

  if (ppnIncluded) {
    const factor = 1 + rate / 100;
    const dpp = gross / factor;
    const ppn = gross - dpp;
    return {
      dpp: Number(dpp.toFixed(2)),
      ppn: Number(ppn.toFixed(2)),
      total: Number(gross.toFixed(2)),
    };
  }

  const dpp = gross;
  const ppn = dpp * (rate / 100);
  return {
    dpp: Number(dpp.toFixed(2)),
    ppn: Number(ppn.toFixed(2)),
    total: Number((dpp + ppn).toFixed(2)),
  };
}

module.exports = { DEFAULT_PPN_RATE, calcLineAmount, lineTaxBreakdown };
