"use client";

import { motion, useReducedMotion } from "framer-motion";
import { QrCode, Scan, CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export function QRScannerPreview() {
  const prefersReduced = useReducedMotion();
  const [detected, setDetected] = useState(false);
  const [detectedAt, setDetectedAt] = useState<string>("");

  useEffect(() => {
    const interval = setInterval(() => {
      setDetected(true);
      const now = new Date();
      const ts = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      setDetectedAt(ts);
      const timeout = setTimeout(() => setDetected(false), 900);
      // cleanup inner timeout on unmount of interval cycle
      return () => clearTimeout(timeout);
    }, 2800);
    return () => clearInterval(interval);
  }, []);

  const scanLineAnim = useMemo(() => (prefersReduced ? {} : { y: [0, 144, 0] }), [prefersReduced]);
  const scanLineTransition = useMemo(
    () => (prefersReduced ? { duration: 0 } : { repeat: Infinity, duration: 2.2, ease: "linear" as any, repeatDelay: 0.4 }),
    [prefersReduced]
  );
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-6">
      {/* Phone-like scanner frame */}
      <div className="relative w-[250px] h-[290px] rounded-3xl border border-border/60 bg-card shadow-lg overflow-hidden">
        {/* Top bar (camera / notch hint) */}
        <div className="absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-background/80 to-transparent" />

        {/* Subtle camera feed placeholder */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,theme(colors.gray.200/_60%),transparent_60%)] dark:bg-[radial-gradient(ellipse_at_top,theme(colors.gray.900/_60%),transparent_60%)]" />

        {/* Vignette */}
        <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-black/0 [box-shadow:inset_0_0_120px_rgba(0,0,0,0.22)] dark:[box-shadow:inset_0_0_120px_rgba(0,0,0,0.45)]" />

        {/* Scanner square */}
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            animate={{ scale: [1, 1.02, 1] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
            className="relative h-40 w-40 rounded-xl bg-background/50 backdrop-blur-sm border-2 border-primary/40"
          >
            {/* QR hint */}
            <QrCode className="absolute inset-0 m-auto h-24 w-24 text-muted-foreground/30" />

            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-primary/70 rounded-tl-lg" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-primary/70 rounded-tr-lg" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-primary/70 rounded-bl-lg" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-primary/70 rounded-br-lg" />

            <motion.div
              animate={scanLineAnim}
              transition={scanLineTransition}
              className="absolute left-1 right-1 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent opacity-90"
            />
          </motion.div>
        </div>

        {/* Success flash overlay */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: detected ? 0.18 : 0 }}
          transition={{ duration: prefersReduced ? 0 : 0.25 }}
          className="absolute inset-0 bg-green-500 pointer-events-none"
        />

        {/* Scanning indicator pill */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="absolute bottom-5 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-background/80 backdrop-blur border border-border/60 text-xs text-muted-foreground flex items-center gap-2"
        >
          <Scan className="h-3.5 w-3.5 text-primary" /> Scanning…
        </motion.div>

        {/* Detection toast */}
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: detected ? 1 : 0, y: detected ? 0 : 6, scale: detected ? 1 : 0.98 }}
          transition={{ duration: prefersReduced ? 0 : 0.2 }}
          className="absolute bottom-16 right-6 flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-green-500/90 text-white shadow-md"
        >
          <CheckCircle2 className="h-4 w-4" />
          <span className="text-[11px] font-semibold">Checked in • {detectedAt}</span>
        </motion.div>
      </div>

      <div className="text-center">
        <p className="text-sm font-semibold mb-1">Scan to check in</p>
        <p className="text-xs text-muted-foreground">Secure, tamper-proof mobile check‑in ID link bound to this device that cannot be reused or forwarded.</p>
      </div>
    </div>
  );
}
