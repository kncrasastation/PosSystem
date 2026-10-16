import { AutoRefresh } from "@/components/auto-refresh";
import { repo } from "@/server/repository";
import { requireBranchPage } from "@/server/session";
import { PosClient } from "./pos-client";

export default async function PosPage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = await params;
  const { actor } = await requireBranchPage(branchId);
  const catalog = await repo.getPosCatalog(actor, branchId);

  return (
    <>
      {/* Keeps serving estimates fresh while another device takes orders. */}
      <AutoRefresh intervalMs={15000} />
      <PosClient branchId={branchId} catalog={catalog} />
    </>
  );
}
