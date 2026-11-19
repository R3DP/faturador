import { PageHeader } from "@/components/shared/page-header";

export default async function AgentsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Agentes e Conexões"
        description="Gerencie chaves de API, permissões e conexões MCP para Claude, Cursor e Codex."
      />
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Nenhuma chave de agente configurada.</p>
      </div>
    </div>
  );
}
