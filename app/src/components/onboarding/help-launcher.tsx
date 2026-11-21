'use client'

import { useState } from 'react'
import { HelpCircle, RotateCcw, ListChecks, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DOCS_URL } from '@/lib/deployment'
import type { UseOnboardingResult } from '@/lib/onboarding/use-onboarding'

interface HelpLauncherProps {
  onboarding: UseOnboardingResult
}

/**
 * Botão de ajuda fixo no canto inferior direito. Permite que a pessoa volte ao
 * tour inicial e à lista de configuração, mesmo depois de dispensá-los,
 * além de oferecer um link para a documentação.
 */
export function HelpLauncher({ onboarding }: HelpLauncherProps) {
  const [open, setOpen] = useState(false)

  const handleRestartTour = () => {
    setOpen(false)
    onboarding.resetTour().catch((error) => console.error('HelpLauncher: falha ao reiniciar o tour', error))
  }

  const handleShowChecklist = () => {
    setOpen(false)
    onboarding.restore().catch((error) => console.error('HelpLauncher: falha ao restaurar a lista de configuração', error))
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="icon-lg"
            aria-label="Ajuda"
            className="no-print fixed bottom-6 right-6 z-40 rounded-full shadow-lg"
          >
            <HelpCircle className="h-5 w-5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="w-64 p-1">
          <div className="flex flex-col">
            <button
              type="button"
              onClick={handleRestartTour}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
            >
              <RotateCcw className="h-4 w-4 text-muted-foreground" />
              Reiniciar o tour guiado
            </button>
            <button
              type="button"
              onClick={handleShowChecklist}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
            >
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              Mostrar lista de configuração
            </button>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
            >
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              Docs
            </a>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
