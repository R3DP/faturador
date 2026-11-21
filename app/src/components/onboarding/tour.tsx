'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useBusiness } from '@/lib/hooks/use-business'
import type { UseOnboardingResult } from '@/lib/onboarding/use-onboarding'

interface TourStepDef {
  id: string
  selector: string
  title: string
  body: string
  placement: 'right' | 'bottom'
}

const TOUR_STEPS: TourStepDef[] = [
  {
    id: 'nav',
    selector: '[data-tour="nav"]',
    title: 'Seu espaço de trabalho',
    body: 'Tudo o que você precisa para administrar sua empresa está nesta barra lateral.',
    placement: 'right',
  },
  {
    id: 'dashboard',
    selector: '[data-tour="dashboard"]',
    title: 'Resumo do dia',
    body: 'Seu painel mostra o que precisa de atenção hoje: valores a receber, faturas prestes a vencer e quanto você ganhou neste mês.',
    placement: 'right',
  },
  {
    id: 'clients',
    selector: '[data-tour="clients"]',
    title: 'Seus clientes',
    body: 'Mantenha contatos, endereços de cobrança e condições de pagamento em um só lugar. Para cobrar, comece escolhendo um cliente aqui.',
    placement: 'right',
  },
  {
    id: 'invoices',
    selector: '[data-tour="invoices"]',
    title: 'Faturas',
    body: 'Monte uma fatura, envie um link para pagamento e deixe os lembretes automáticos cobrarem os atrasados por você.',
    placement: 'right',
  },
  {
    id: 'estimates',
    selector: '[data-tour="estimates"]',
    title: 'Orçamentos e propostas',
    body: 'Envie uma proposta antes de começar o trabalho e obtenha a aprovação por escrito. Quando o cliente aceitar, converta-a em fatura com um clique.',
    placement: 'right',
  },
  {
    id: 'items',
    selector: '[data-tour="items"]',
    title: 'Itens salvos',
    body: 'Cadastre serviços e produtos que você cobra com frequência, com valores e impostos definidos, para preencher novas faturas em segundos.',
    placement: 'right',
  },
  {
    id: 'time',
    selector: '[data-tour="time"]',
    title: 'Controle de tempo',
    body: 'Registre as horas faturáveis de um cliente ou projeto enquanto trabalha. O tempo ainda não faturado vai direto para sua próxima fatura.',
    placement: 'right',
  },
  {
    id: 'expenses',
    selector: '[data-tour="expenses"]',
    title: 'Despesas',
    body: 'Registre custos e fornecedores. Marque uma despesa como faturável para repassá-la ao cliente e mantenha as demais organizadas para a contabilidade.',
    placement: 'right',
  },
  {
    id: 'payments',
    selector: '[data-tour="payments"]',
    title: 'Recebimentos',
    body: 'Os clientes pagam com cartão ou transferência bancária, e o dinheiro vai para sua própria conta Stripe. O Faturador não cobra nada sobre os valores recebidos.',
    placement: 'right',
  },
  {
    id: 'reports',
    selector: '[data-tour="reports"]',
    title: 'Relatórios',
    body: 'Acompanhe a receita ao longo do tempo, seus melhores clientes e o que ainda falta receber. Exporte os números quando seu contador solicitar.',
    placement: 'right',
  },
  {
    id: 'agents',
    selector: '[data-tour="agents"]',
    title: 'Seus agentes',
    body: 'Conecte um assistente de IA para adicionar clientes, criar rascunhos e enviar faturas, registrar horas e despesas e lançar pagamentos. Deixe as tarefas repetitivas com ele.',
    placement: 'right',
  },
  {
    id: 'settings',
    selector: '[data-tour="settings"]',
    title: 'Configurações',
    body: 'Configure aqui os dados da empresa, o logotipo, as alíquotas de impostos e as opções de pagamento. Faça isso uma vez para padronizar todos os documentos enviados.',
    placement: 'right',
  },
  {
    id: 'setup',
    selector: '[data-tour="setup"]',
    title: 'Acompanhe sua configuração',
    body: 'Esta barra mostra o que falta para concluir a configuração da sua conta.',
    placement: 'bottom',
  },
]

const GAP = 12
const POPOVER_WIDTH = 288
// Os textos agora têm algumas frases e o popover exibe o número da etapa
// e uma barra de progresso; por isso, a altura estimada para posicioná-lo é maior
// que no layout original de uma única linha.
const POPOVER_EST_HEIGHT = 210
const SPOTLIGHT_PADDING = 6

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (notify) => { const mq=window.matchMedia('(prefers-reduced-motion: reduce)'); mq.addEventListener('change',notify); return ()=>mq.removeEventListener('change',notify) },
    ()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    ()=>false
  )
}

interface PopoverPosition {
  top: number
  left: number
}

/**
 * Posiciona o popover junto aos limites do elemento âncora, priorizando o
 * lado indicado, mantendo-o dentro da tela e mudando para o lado que
 * tiver espaço, para que o popover não cubra a âncora nem fique
 * fora da tela.
 */
function computePosition(rect: DOMRect, preferred: 'right' | 'bottom'): PopoverPosition {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  // Centraliza na parte visível da âncora, e não em sua extensão total (que pode estar
  // fora da tela), para que âncoras altas, como a navegação lateral, não empurrem o
  // popover para o topo da página.
  const visibleTop = Math.max(rect.top, 0)
  const visibleBottom = Math.min(rect.bottom, viewportHeight)
  const anchorCenterY = (visibleTop + visibleBottom) / 2
  const anchorCenterX = rect.left + rect.width / 2

  const candidates: Record<'right' | 'left' | 'bottom' | 'top', { top: number; left: number; fits: boolean }> = {
    right: {
      left: rect.right + GAP,
      top: clamp(anchorCenterY - POPOVER_EST_HEIGHT / 2, GAP, viewportHeight - POPOVER_EST_HEIGHT - GAP),
      fits: rect.right + GAP + POPOVER_WIDTH <= viewportWidth - GAP,
    },
    left: {
      left: rect.left - GAP - POPOVER_WIDTH,
      top: clamp(anchorCenterY - POPOVER_EST_HEIGHT / 2, GAP, viewportHeight - POPOVER_EST_HEIGHT - GAP),
      fits: rect.left - GAP - POPOVER_WIDTH >= GAP,
    },
    bottom: {
      top: rect.bottom + GAP,
      left: clamp(anchorCenterX - POPOVER_WIDTH / 2, GAP, viewportWidth - POPOVER_WIDTH - GAP),
      fits: rect.bottom + GAP + POPOVER_EST_HEIGHT <= viewportHeight - GAP,
    },
    top: {
      top: rect.top - GAP - POPOVER_EST_HEIGHT,
      left: clamp(anchorCenterX - POPOVER_WIDTH / 2, GAP, viewportWidth - POPOVER_WIDTH - GAP),
      fits: rect.top - GAP - POPOVER_EST_HEIGHT >= GAP,
    },
  }

  const order: Array<'right' | 'left' | 'bottom' | 'top'> =
    preferred === 'right' ? ['right', 'bottom', 'left', 'top'] : ['bottom', 'right', 'left', 'top']

  const chosen = order.find((side) => candidates[side].fits) ?? preferred
  const { top, left } = candidates[chosen]

  return {
    top: clamp(top, GAP, viewportHeight - POPOVER_EST_HEIGHT - GAP),
    left: clamp(left, GAP, viewportWidth - POPOVER_WIDTH - GAP),
  }
}

interface TourProps {
  onboarding: UseOnboardingResult
}

/**
 * Tour inicial ancorado, implementado manualmente. Posiciona um pequeno popover junto a
 * elementos reais da interface (localizados pelos atributos data-tour), em vez de uma
 * sobreposição modal roteirizada, destacando a âncora para que o popover
 * pareça ligado a ela. Abre automaticamente uma vez por conta e não volta a abrir
 * sozinho depois que a pessoa conclui ou pula o tour.
 */
export function Tour({ onboarding }: TourProps) {
  const { currentBusiness } = useBusiness()
  const { isLoading, tourCompleted, completeTour } = onboarding
  const [open, setOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [availableSteps, setAvailableSteps] = useState<TourStepDef[]>([])
  const [rect, setRect] = useState<DOMRect | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const reducedMotion = usePrefersReducedMotion()

  const finish = useCallback(() => {
    setOpen(false)
    completeTour().catch((error) => console.error('Tour: falha ao salvar a conclusão', error))
  }, [completeTour])

  // Decide se deve abrir automaticamente quando o carregamento terminar. Inclui somente etapas cuja
  // âncora existe no DOM; se nenhuma existir, não abre o tour.
  useEffect(() => {
    if (isLoading || !currentBusiness || tourCompleted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Sincroniza a visibilidade do tour com as âncoras montadas no DOM.
      setOpen(false)
      return
    }
    if (typeof document === 'undefined') return
    // Uma âncora na barra lateral oculta para computador existe no DOM, mas não tem área visível no celular.
    const found = TOUR_STEPS.filter(
      (step) =>
        (document.querySelector(step.selector)?.getClientRects().length ?? 0) > 0,
    )
    if (found.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Sincroniza a visibilidade do tour com as âncoras montadas no DOM.
      setOpen(false)
      return
    }
    setAvailableSteps(found)
    setStepIndex(0)
    setOpen(true)
  }, [isLoading, currentBusiness, tourCompleted])

  const currentStep = availableSteps[stepIndex]

  const measure = useCallback(() => {
    if (!currentStep) {
      setRect(null)
      return
    }
    const el = document.querySelector(currentStep.selector)
    if (!el) {
      setRect(null)
      return
    }
    setRect(el.getBoundingClientRect())
  }, [currentStep])

  // A navegação lateral tem rolagem, então âncoras no fim de uma lista longa podem
  // ficar fora da área visível. Traga a âncora para a tela antes de medir
  // sua posição; o listener de rolagem abaixo mede novamente quando a rolagem terminar.
  useEffect(() => {
    if (!open || !currentStep) return
    const el = document.querySelector(currentStep.selector)
    if (!el) return
    el.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })
  }, [open, currentStep, reducedMotion])

  useLayoutEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- A medição do layout precisa ocorrer após a confirmação do DOM.
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, measure])

  // Se a âncora da etapa atual desaparecer durante o tour, avance
  // para a próxima etapa, em vez de travar ou ficar preso.
  useEffect(() => {
    if (!open || !currentStep) return
    if (!document.querySelector(currentStep.selector)) {
      if (stepIndex < availableSteps.length - 1) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Ignora uma âncora removida do DOM.
        setStepIndex((i) => i + 1)
      } else {
        finish()
      }
    }
  }, [open, currentStep, stepIndex, availableSteps.length, finish])

  // Armadilha de foco: move o foco para o popover e mantém a tecla Tab dentro dele.
  // Esc fecha o tour, o que conta como pular.
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const container = containerRef.current
    const focusables = container
      ? Array.from(
          container.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        )
      : []
    // Coloca o foco no próprio contêiner do diálogo, em vez de no primeiro controle
    // (o botão de fechar), para que a abertura do tour não deixe um
    // contorno de foco inesperado; a tecla Tab ainda percorre os controles abaixo.
    container?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish()
        return
      }
      if (e.key === 'Tab' && focusables.length > 0) {
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [open, stepIndex, finish])

  if (!open || !currentStep || !rect || typeof document === 'undefined') return null

  const isFirst = stepIndex === 0
  const isLast = stepIndex === availableSteps.length - 1
  const { top, left } = computePosition(rect, currentStep.placement)

  return createPortal(
    <>
      {/* Destaque: escurece o restante da página e mantém o próprio elemento rect visível, usando uma única caixa transparente cuja sombra também forma o contorno de destaque e o fundo escurecido. */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none fixed z-30 rounded-lg',
          !reducedMotion && 'transition-all duration-200 ease-out motion-reduce:transition-none'
        )}
        style={{
          top: rect.top - SPOTLIGHT_PADDING,
          left: rect.left - SPOTLIGHT_PADDING,
          width: rect.width + SPOTLIGHT_PADDING * 2,
          height: rect.height + SPOTLIGHT_PADDING * 2,
          boxShadow: '0 0 0 2px var(--ring), 0 0 0 9999px rgba(15, 23, 42, 0.45)',
        }}
      />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-step-title"
        aria-describedby="tour-step-body"
        tabIndex={-1}
        className="fixed z-40 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg outline-none"
        style={{ top, left, width: POPOVER_WIDTH }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {stepIndex + 1} de {availableSteps.length}
            </p>
            <h2 id="tour-step-title" className="mt-0.5 text-sm font-semibold">
              {currentStep.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={finish}
            aria-label="Fechar tour guiado"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p id="tour-step-body" className="mt-1.5 text-sm text-muted-foreground">
          {currentStep.body}
        </p>
        <div
          role="progressbar"
          aria-label="Progresso do tour guiado"
          aria-valuemin={1}
          aria-valuemax={availableSteps.length}
          aria-valuenow={stepIndex + 1}
          className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              'h-full rounded-full bg-primary',
              !reducedMotion && 'transition-[width] duration-200 ease-out motion-reduce:transition-none'
            )}
            style={{ width: `${((stepIndex + 1) / availableSteps.length) * 100}%` }}
          />
        </div>
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={finish}
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            Pular tour
          </button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button type="button" variant="outline" size="sm" onClick={() => setStepIndex((i) => i - 1)}>
                Voltar
              </Button>
            )}
            <Button type="button" size="sm" onClick={() => (isLast ? finish() : setStepIndex((i) => i + 1))}>
              {isLast ? 'Concluir' : 'Próximo'}
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}
