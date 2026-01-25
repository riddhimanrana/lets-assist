import { AdminMobileNav, AdminSidebar } from "./components/AdminSidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-muted/5">
      <AdminSidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/90 px-4 py-3 backdrop-blur-sm md:hidden">
          <div className="flex items-center gap-2">
            <AdminMobileNav />
            <div>
              <p className="text-sm font-semibold">Admin Console</p>
              <p className="text-xs text-muted-foreground">Let&apos;s Assist</p>
            </div>
          </div>
        </header>
        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-background">
          {children}
        </main>
      </div>
    </div>
  );
}
