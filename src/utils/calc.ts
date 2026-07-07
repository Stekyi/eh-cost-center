// Cost-plus calculation helpers
export type ExpenseItem = {
  amount: number
  costType: 'variable'|'fixed'
}

export function variableCostPerUnit(variableTotal: number, units: number){
  if(units <= 0) return NaN
  return variableTotal / units
}

export function fixedCostPerUnit(fixedTotal: number, units: number){
  if(units <= 0) return NaN
  return fixedTotal / units
}

export function sellingPriceFromMargin(unitCost: number, marginPct: number){
  const m = marginPct / 100
  if(m >= 1) return Infinity
  return unitCost / (1 - m)
}
