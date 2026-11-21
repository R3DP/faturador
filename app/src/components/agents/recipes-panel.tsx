'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { agentRecipes, type AgentRecipe } from '@/lib/agents/recipes'

function RecipeCard({ title, description, content }: AgentRecipe) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      toast.success('Copiado para a área de transferência')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto da receita e copie manualmente')
    }
  }

  return (
    <section>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      <div className="relative mt-3">
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 pr-14 font-mono text-xs leading-relaxed text-slate-300">
          {content}
        </pre>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="absolute right-3 top-3 h-8 w-8"
          onClick={handleCopy}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          <span className="sr-only">Copiar receita</span>
        </Button>
      </div>
    </section>
  )
}

export function RecipesPanel() {
  return (
    <div>
      <div>
        <h2 className="text-lg font-semibold text-foreground">Receitas</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Modelos para copiar e colar no CLAUDE.md ou AGENTS.md. Adicione um deles ao repositório e seu agente o seguirá dali em diante.
        </p>
      </div>

      <div className="mt-6 space-y-10">
        {agentRecipes.map((recipe) => (
          <RecipeCard key={recipe.id} {...recipe} />
        ))}
      </div>

      <p className="mt-10 max-w-2xl border-t pt-6 text-sm leading-relaxed text-muted-foreground">
        Estas receitas são executadas pelo seu próprio agente, na sua máquina e com sua chave de API. O Faturador não
        executa automações em seu nome.
      </p>
    </div>
  )
}
