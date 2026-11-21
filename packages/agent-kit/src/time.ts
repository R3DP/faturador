/** Preserve os segundos medidos; arredonde o valor somente após aplicar a tarifa acordada. */
export function secondsFromHours(hours: number): number {
  const seconds = Math.round(hours * 3600)
  if (!Number.isFinite(hours) || seconds < 1 || seconds > 86400) {
    throw new Error('O tempo deve estar entre um segundo e 24 horas')
  }
  return seconds
}

export function timeAmount(
  seconds: number,
  rate: number | null
): number | null {
  if (!Number.isSafeInteger(seconds) || seconds < 0)
    throw new Error('A duração deve ser expressa em segundos inteiros não negativos')
  if (rate === null) return null
  if (!Number.isFinite(rate) || rate < 0)
    throw new Error('A tarifa não pode ser negativa')
  return Math.round(((seconds * rate) / 3600 + Number.EPSILON) * 100) / 100
}

export function entrySeconds(entry: {
  duration_seconds?: number | null
  duration_minutes?: number | null
}): number {
  return entry.duration_seconds ?? (entry.duration_minutes ?? 0) * 60
}
