'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  return (
    <Button
      type="button"
      variant="ghost"
      className="mb-1 w-full justify-start gap-2.5 px-3 text-muted-foreground hover:text-foreground"
      aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
      aria-pressed={isDark}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
      <span>{isDark ? 'Modo escuro' : 'Modo claro'}</span>
    </Button>
  )
}
