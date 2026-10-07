import { AdminMobileNav, AdminSidebar } from "./components/AdminSidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-background flex min-h-screen">
      <AdminSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background sticky top-0 z-30 flex items-center gap-2 border-b px-4 py-2 md:hidden">
          <AdminMobileNav />
          <p className="text-sm font-semibold">Admin console</p>
        </header>
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
