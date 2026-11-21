import { describe, expect, it } from 'vitest'
import { escapeLike, likeAnyFilter, quoteFilterValue } from './shared'

/**
 * A gramática de filtros do PostgREST, não a gramática LIKE do SQL.
 *
 * `escapeLike` trata `%` e `_`, que são os caracteres relevantes para SQL, mas
 * não para PostgREST. `.or()` recebe uma EXPRESSÃO de filtro bruta, então um
 * termo de busca com vírgula e ponto podia se transformar em filtros extras controlados por
 * quem chamava a ferramenta. Isso foi verificado em um PostgREST ativo: a forma sem aspas
 * abaixo retornou `42703 a coluna clients.nosuchcol não existe`; ou seja, o
 * trecho injetado chegou ao planejador como referência de coluna.
 */
const INJECTION = 'a,nosuchcol.eq.1,name.ilike.'

describe('quoteFilterValue', () => {
  it('envolve um valor para que o PostgREST o interprete como um único literal', () => {
    expect(quoteFilterValue('plain')).toBe('"plain"')
  })

  it('escapa os dois caracteres que encerrariam o literal antes da hora', () => {
    expect(quoteFilterValue('a"b')).toBe('"a\\"b"')
    expect(quoteFilterValue('a\\b')).toBe('"a\\\\b"')
  })

  it('duplica os escapes de LIKE gerados por escapeLike, pois o PostgREST os reduz pela metade', () => {
    // Verificado em um PostgREST ativo: dentro de um valor entre aspas, uma ÚNICA
    // barra invertida é descartada (então `\%` deixaria % como curinga) e `\\` é
    // convertido em uma barra invertida. Duplicá-la aqui faz com que o escape de escapeLike
    // mantenha % literal em ILIKE.
    expect(quoteFilterValue(escapeLike('50% off_now'))).toBe('"50\\\\% off\\\\_now"')
  })
})

describe('likeAnyFilter', () => {
  it('busca um trecho em todas as colunas indicadas', () => {
    expect(likeAnyFilter(['name', 'email'], 'acme')).toBe(
      'name.ilike."%acme%",email.ilike."%acme%"',
    )
  })

  it('mantém uma expressão de filtro injetada dentro do literal', () => {
    const filter = likeAnyFilter(['name', 'email'], INJECTION)
    expect(filter).toBe(
      `name.ilike."%${INJECTION}%",email.ilike."%${INJECTION}%"`,
    )
    // Exatamente dois filtros: todas as vírgulas fornecidas por quem chama ficam dentro de um
    // literal entre aspas e nenhuma delas pode iniciar um terceiro filtro.
    const outsideQuotes = filter.split('"').filter((_, i) => i % 2 === 0).join('')
    expect(outsideQuotes.split(',')).toHaveLength(2)
    expect(outsideQuotes).not.toContain('nosuchcol')
  })

  it('continua escapando curingas SQL para que % literal não seja interpretado como padrão', () => {
    expect(likeAnyFilter(['name'], '50%')).toBe('name.ilike."%50\\\\%%"')
  })

  it('escapa aspas para que o termo não encerre o próprio literal', () => {
    expect(likeAnyFilter(['name'], '",id.not.is.null,name.ilike."')).toBe(
      'name.ilike."%\\",id.not.is.null,name.ilike.\\"%"',
    )
  })
})
