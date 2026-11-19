import { PageHeader } from "@/components/shared/page-header";

export default async function ReportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatórios"
        description="Resumo financeiro, faturamento, recebimentos e aging de contas a receber."
      />
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Dados de relatórios indisponíveis no momento.</p>
      </div>
    </div>
  );
}
