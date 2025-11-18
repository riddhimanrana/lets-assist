"use client";

import { motion } from "framer-motion";

type Example = {
  name: string;
  acronym: string;
  logoUrl?: string | null;
};

const examples: Example[] = [
  { name: "Dougherty Valley High School", acronym: "DVHS" },
  { name: "Windemere Ranch Middle School", acronym: "WRMS" },
  { name: "Troop 941", acronym: "941" },
  { name: "More coming soon", acronym: "+" },
];

export default function IllustrativeExamplesSection() {
  return (
    <section className="py-6 sm:py-8">
      <div className="container mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.4 }}
          className="text-center mx-auto max-w-2xl mb-4"
        >
          <p className="text-xs sm:text-sm text-muted-foreground">Illustrative examples (grayscale, for demo)</p>
        </motion.div>

        {/* Marquee wrapper */}
        <div className="overflow-hidden">
          <motion.div
            className="flex items-center gap-6 sm:gap-8 will-change-transform"
            initial={{ x: 0 }}
            animate={{ x: [0, -600] }}
            transition={{ repeat: Infinity, duration: 22, ease: "linear" }}
            onMouseEnter={(e) => (e.currentTarget.style.animationPlayState = "paused")}
            onMouseLeave={(e) => (e.currentTarget.style.animationPlayState = "running")}
          >
            {[...examples, ...examples].map((ex, i) => (
              <div key={`${ex.name}-${i}`} className="flex items-center gap-2" aria-label={ex.name}>
                <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-md ring-1 ring-border/60 bg-muted/60 flex items-center justify-center font-semibold text-[10px] sm:text-xs text-muted-foreground select-none filter grayscale contrast-125">
                  {ex.acronym}
                </div>
                <span className="sr-only">{ex.name}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
