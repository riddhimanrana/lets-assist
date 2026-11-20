import { createRoot } from "react-dom/client";
import ImportPage from "@/app/tools/signupgenius/page";

// Browser component fixture only. API responses and navigation are controlled by
// the harness; this is not hosted extraction or authenticated creation proof.
createRoot(document.getElementById("root")!).render(
  <main>
    <ImportPage />
  </main>,
);
