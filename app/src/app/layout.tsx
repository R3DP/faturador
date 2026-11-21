import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { ThemeProvider } from "@/components/theme-provider"
import { appOrigin } from "@/lib/deployment"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  // URLs absolutas nos metadados são resolvidas com base na origem desta instalação.
  metadataBase: new URL(appOrigin()),
  title: {
    default: "Faturador - Faturamento profissional",
    template: "%s | Faturador",
  },
  description: "Faturador é uma solução de faturamento para agentes de IA. Cadastre clientes, registre trabalhos e envie faturas profissionais pelo Claude Code, Codex ou qualquer cliente MCP, mantendo o controle.",
  keywords: ["invoicing", "billing", "freelance", "small business", "ai agents", "mcp"],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <ThemeProvider>
          {children}
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}
