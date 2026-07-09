export function margin(performance: number, expense: number): number | null {
  if (performance === 0) return null;
  return (performance - expense) / performance;
}

export function attainment(performance: number, contract: number): number | null {
  if (contract === 0) return null;
  return performance / contract;
}

export function billingRate(billing: number, performance: number): number | null {
  if (performance === 0) return null;
  return billing / performance;
}

export function collectionRate(deposit: number, billing: number): number | null {
  if (billing === 0) return null;
  return deposit / billing;
}
