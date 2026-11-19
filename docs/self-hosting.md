# Guia de Auto-Hospedagem do Faturador

Este guia descreve como hospedar o Faturador em seu próprio servidor ou máquina.

## Requisitos
- Node.js 22+
- Docker e Docker Compose
- Supabase CLI (para gerenciamento do banco de dados local ou remoto)
- Chaves da API do Stripe (opcional, para pagamentos com cartão)

## Passos para execução
1. Clone o repositório e acesse a pasta do app:
   ```sh
   cd app
   cp .env.example .env.local && chmod 600 .env.local
   ```
2. Preencha as variáveis de ambiente em `.env.local`.
3. Inicie a aplicação via Docker Compose:
   ```sh
   docker compose --env-file .env.local build
   docker compose --env-file .env.local up -d
   ```
