const { lineTaxBreakdown } = require('./taxService');

function poGrandTotal(lines) {
  return Number(
    (lines || []).reduce((sum, l) => sum + Number(l.line_amount || 0), 0).toFixed(2)
  );
}

function termAmount(term, grandTotal) {
  if (!term) return grandTotal;
  if (term.amount_type === 'PERCENT' || term.amountType === 'PERCENT') {
    const pct = Number(term.amount_value ?? term.amountValue ?? 0);
    return Number((grandTotal * pct / 100).toFixed(2));
  }
  return Number(Number(term.amount_value ?? term.amountValue ?? 0).toFixed(2));
}

/** Breakdown DPP/PPN dari total tagihan (sudah termasuk PPN) */
function totalToBreakdown(total, ppnRate) {
  const rate = Number(ppnRate) || 11;
  const factor = 1 + rate / 100;
  const subtotal = Number((total / factor).toFixed(2));
  const ppnAmount = Number((total - subtotal).toFixed(2));
  return { subtotal, ppnAmount, total: Number(Number(total).toFixed(2)) };
}

module.exports = { poGrandTotal, termAmount, totalToBreakdown, lineTaxBreakdown };
