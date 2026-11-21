import { registerTaskTools } from './tools/tasks'
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOL_NAMES, TOOL_GROUPS, TOOL_COUNT } from './tool-catalog'

const TOOLS_DIR = join(process.cwd(), 'src/lib/mcp/tools')

function toolFiles(): string[] {
  return readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
}

function sourceOf(file: string): string {
  return readFileSync(join(TOOLS_DIR, file), 'utf8')
}

function registeredToolNames(): string[] {
  const names: string[] = []
  registerTaskTools({registerTool:(name:string)=>{names.push(name)}} as never, {} as never)
  for (const file of toolFiles().filter(f=>f!=='tasks.ts')) {
    for (const match of sourceOf(file).matchAll(/registerTool\(\s*'([a-z_]+)'/g)) {
      names.push(match[1])
    }
  }
  return names
}

describe('catálogo de ferramentas', () => {
  it('anuncia exatamente as ferramentas registradas pelo servidor', () => {
    expect([...TOOL_NAMES].sort()).toEqual([...registeredToolNames()].sort())
  })

  it('anuncia cada ferramenta uma única vez', () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length)
  })

  it('calcula a quantidade publicada a partir da lista, sem valor fixo', () => {
    expect(TOOL_COUNT).toBe(registeredToolNames().length)
  })

  it('fornece um nome, uma descrição e pelo menos uma ferramenta para cada grupo', () => {
    for (const group of TOOL_GROUPS) {
      expect(group.name.length).toBeGreaterThan(0)
      expect(group.blurb.length).toBeGreaterThan(0)
      expect(group.tools.length).toBeGreaterThan(0)
    }
  })

  it('não usa travessão longo nos textos exibidos às pessoas usuárias', () => {
    for (const group of TOOL_GROUPS) {
      expect(group.name).not.toContain('\u2014')
      expect(group.blurb).not.toContain('\u2014')
    }
  })
})

describe('regras de uso do ScopedDb', () => {
  it('impede que arquivos de ferramentas criem seu próprio cliente Supabase', () => {
    for (const file of toolFiles()) {
      const src = sourceOf(file)
      expect(src, `${file} não pode importar diretamente um cliente Supabase`).not.toMatch(
        /from '@\/lib\/supabase\/(service|server|client)'/
      )
      expect(src, `${file} não pode chamar createServiceClient`).not.toContain('createServiceClient(')
    }
  })

  it('direciona todo acesso a dados em arquivos de ferramentas por ctx.db', () => {
    for (const file of toolFiles()) {
      const src = sourceOf(file)
      // Remove espaços extras para que uma cadeia em várias linhas seja lida como uma única expressão e
      // identifique .from('table') especificamente, sem contar Array.from(...).
      const collapsed = src.replace(/\s+/g, '')
      const dataAccesses = collapsed.match(/\.from\('/g) ?? []
      const scopedAccesses = collapsed.match(/ctx\.db\.svc\.from\('/g) ?? []
      expect(dataAccesses.length, `${file} tem uma chamada .from( que não usa ctx.db.svc.from(`).toBe(
        scopedAccesses.length
      )
    }
  })

  it('exige que cada arquivo de ferramenta defina o escopo antes de consultar dados', () => {
    for (const file of toolFiles()) {
      const src = sourceOf(file)
      if (!src.includes('ctx.db.svc.from(')) continue
      expect(
        /resolveBusinessId|assertClientAccess|assertInvoiceAccess|assertEstimateAccess|assertTimeEntryAccess|assertExpenseAccess/.test(
          src
        ),
        `${file} consulta o banco sem definir o escopo com assert*/resolveBusinessId`
      ).toBe(true)
    }
  })
})

/**
 * Percorre um arquivo TypeScript e retorna todos os literais de texto: com aspas simples
 * ou duplas, além dos trechos literais de modelos de texto, ignorando
 * as interpolações `${...}`. Comentários de linha e de bloco são ignorados,
 * para que textos destinados à manutenção não sejam confundidos com conteúdo exibido às pessoas usuárias.
 */
function stringLiterals(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = []
  // Uma pilha de contextos: modelos de texto podem ser aninhados dentro de interpolações `${}`,
  // que também são código e podem iniciar outros modelos de texto.
  const stack: { kind: 'code' | 'template'; depth: number }[] = [{ kind: 'code', depth: 0 }]
  let i = 0
  let line = 1
  let buf = ''
  let bufLine = 1

  const flush = () => {
    if (buf) out.push({ line: bufLine, text: buf })
    buf = ''
  }

  while (i < src.length) {
    const frame = stack[stack.length - 1]
    const c = src[i]
    const n = src[i + 1]
    if (c === '\n') line++

    if (frame.kind === 'template') {
      if (c === '\\') {
        buf += n ?? ''
        i += 2
        continue
      }
      if (c === '`') {
        flush()
        stack.pop()
        i++
        continue
      }
      if (c === '$' && n === '{') {
        flush()
        stack.push({ kind: 'code', depth: 1 })
        i += 2
        continue
      }
      if (!buf) bufLine = line
      buf += c
      i++
      continue
    }

    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && n === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++
        i++
      }
      i += 2
      continue
    }
    if (c === "'" || c === '"') {
      const quote = c
      const startLine = line
      let text = ''
      i++
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') {
          text += src[i + 1] ?? ''
          i += 2
          continue
        }
        if (src[i] === '\n') line++
        text += src[i]
        i++
      }
      i++
      out.push({ line: startLine, text })
      continue
    }
    if (c === '`') {
      stack.push({ kind: 'template', depth: 0 })
      bufLine = line
      i++
      continue
    }
    if (c === '{') {
      frame.depth++
      i++
      continue
    }
    if (c === '}') {
      frame.depth--
      i++
      // profundidade 0 em um contexto que não seja raiz significa que acabamos de fechar `${...}`.
      if (frame.depth === 0 && stack.length > 1) stack.pop()
      continue
    }
    i++
  }
  flush()
  return out
}

describe('textos exibidos às pessoas usuárias', () => {
  // Travessão longo (U+2014) e travessão curto (U+2013) são proibidos em qualquer conteúdo que uma pessoa usuária
  // possa ver. Descrições de ferramentas e parâmetros, mensagens de erro e
  // resumos de resultados são repassados sem alterações pelo agente que chama a ferramenta,
  // portanto, todo literal de texto em um módulo de ferramenta conta como conteúdo exibido às pessoas usuárias.
  const BANNED_DASH = /[\u2013\u2014]/

  it('não usa travessões longos ou curtos em textos de módulos de ferramentas', () => {
    const offenders: string[] = []
    for (const file of toolFiles()) {
      for (const { line, text } of stringLiterals(sourceOf(file))) {
        if (BANNED_DASH.test(text)) {
          offenders.push(
            `src/lib/mcp/tools/${file}:${line} contém um travessão proibido: ${JSON.stringify(text)}`
          )
        }
      }
    }
    expect(
      offenders,
      [
        'Travessão longo (U+2014) ou curto (U+2013) proibido encontrado em conteúdo exibido às pessoas usuárias.',
        'Reescreva cada texto para que soe natural sem o travessão, geralmente como uma',
        'ponto-final e uma nova frase, preservando qualquer instrução para recuperação:',
        ...offenders,
      ].join('\n')
    ).toEqual([])
  })
})
