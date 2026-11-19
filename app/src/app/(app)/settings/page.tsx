import { PageHeader } from "@/components/shared/page-header";

export default async function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações"
        description="Gerencie as configurações da empresa, dados bancários, marcas e chaves de acesso."
      />
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Selecione uma opção ao lado para configurar.</p>
      </div>
    </div>
  );
}
