"use client";

import { useEffect, type ReactNode } from "react";
import Lenis from "lenis";

type SmoothScrollProps = {
  children: ReactNode;
};

const easing = (t: number) => 1 - Math.pow(1 - t, 4);

export default function SmoothScroll({ children }: SmoothScrollProps) {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (prefersReducedMotion) {
      return;
    }

    const lenis = new Lenis({
      duration: 1.0,
      easing,
      smoothWheel: true,
      wheelMultiplier: 1.0,
      touchMultiplier: 1.0,
      lerp: 0.08,
    });

    let rafId = 0;

    const raf = (time: number) => {
      lenis.raf(time);
      rafId = window.requestAnimationFrame(raf);
    };

    rafId = window.requestAnimationFrame(raf);

    const handleResize = () => lenis.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}