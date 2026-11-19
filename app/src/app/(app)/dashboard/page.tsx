import { QuickActions } from "@/components/dashboard/quick-actions";
import { RecentInvoices } from "@/components/dashboard/recent-invoices";
import { StatsCard } from "@/components/dashboard/stats-card";
import { PageHeader } from "@/components/shared/page-header";

export default async function DashboardPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Painel"
        description="Visão geral do faturamento, clientes e atividades do seu negócio."
      />
      <QuickActions />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Recebido (Este Mês)" value="R$ 0,00" />
        <StatsCard title="Pendente" value="R$ 0,00" />
        <StatsCard title="Vencido" value="R$ 0,00" />
        <StatsCard title="Clientes Ativos" value="0" />
      </div>
      <RecentInvoices invoices={[]} />
    </div>
  );
}
