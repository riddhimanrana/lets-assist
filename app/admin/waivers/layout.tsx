import { checkSuperAdmin } from "@/app/admin/actions";
import { redirect } from "next/navigation";

export default async function WaiversLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAdmin } = await checkSuperAdmin();

  if (!isAdmin) {
    redirect("/not-found");
  }

  return <>{children}</>;
}
