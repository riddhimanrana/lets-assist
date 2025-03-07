import { Toaster } from "sonner";

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {children}
      <Toaster position="bottom-right" richColors theme="dark" />
    </>
  );
}
