import { describe, expect, it } from 'vitest'
import { secondsFromHours, timeAmount } from './time'

describe('faturamento do tempo registrado', () => {
  it('mantém uma tarefa de 36 segundos em um dólar em todas as etapas', () => {
    const seconds = secondsFromHours(0.01)
    expect(seconds).toBe(36)
    expect(timeAmount(seconds, 100)).toBe(1)
    expect(timeAmount(secondsFromHours(seconds / 3600), 100)).toBe(1)
  })
  it('diferencia uma tarifa desconhecida de uma tarifa gratuita', () => {
    expect(timeAmount(60, null)).toBeNull()
    expect(timeAmount(60, 0)).toBe(0)
  })
  it('recusa durações vazias ou não finitas', () => {
    for (const value of [0, -1, Infinity, NaN, 25]) expect(() => secondsFromHours(value)).toThrow()
  })
})
