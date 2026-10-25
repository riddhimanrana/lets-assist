import { createRoot } from "react-dom/client";
import { PrintCertificate } from "../../../app/certificates/[id]/_components/PrintCertificate";
import { printCertificates } from "../../../app/certificates/_components/print-certificates";

import { certificate, user } from "./certificate-timezone-data";
createRoot(document.getElementById("root")!).render(
  <main className="bg-background text-foreground mx-auto grid max-w-3xl gap-6 p-6">
    <PrintCertificate data={{ ...certificate, durationText: "1 hour" }} />
    <button
      onClick={() =>
        printCertificates({
          certificatesWithHours: [certificate],
          filteredCertificates: [certificate],
          dateFilter: "all",
          startDate: undefined,
          endDate: undefined,
          user,
        })
      }
    >
      Print all certificates
    </button>
  </main>,
);
