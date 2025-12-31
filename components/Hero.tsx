"use client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoverGradientButton } from "@/components/effects/HoverGradientButton";
import { ArrowRight, CalendarCheck, CheckCircle, Search } from "lucide-react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";


const steps = [
	{
		icon: Search,
		title: "Discover",
		desc: "Browse local opportunities that match your interests.",
	},
	{
		icon: CalendarCheck,
		title: "Sign Up",
		desc: "Register and get reminders.",
	},
	{
		icon: CheckCircle,
		title: "Attend",
		desc: "Participate in events and log your hours.",
	},
];

export const HeroSection = () => {
	const shouldReduceMotion = useReducedMotion();

	return (
		<section className="container relative isolate mx-auto w-full overflow-hidden px-4 py-12 md:py-24">

			<div className="grid w-full place-items-center gap-6">
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5 }}
					className="w-full text-center space-y-4 sm:space-y-6"
				>
					<div className="flex justify-center">
						<Badge
							variant="outline"
							className="flex flex-wrap items-center justify-center gap-2 rounded-full border-primary/30 bg-primary/5 px-3 py-2 text-xs font-medium text-primary/80 sm:text-sm"
						>
							<span className="inline-flex h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
							<span className="font-semibold text-primary">New</span>
							<span className="text-center text-foreground/80">Submitted to 2025 Congressional App Challenge</span>
						</Badge>
					</div>

					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.2, duration: 0.5 }}
						className="mx-auto w-full max-w-screen-md px-2"
					>
						<h1 className="font-overusedgrotesk text-[2.7rem] font-extrabold leading-[1.1] tracking-tight sm:text-4xl sm:leading-tight md:text-5xl lg:text-6xl">
							Give back to your{" "}
							<span
								className="inline-block text-transparent bg-gradient-to-r from-[#4ed247] to-primary bg-clip-text align-baseline leading-[1.25]"
								style={{ WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
							>
								community
							</span>{" "}
							<span className="inline-block">your way</span>
						</h1>
					</motion.div>

					<motion.p
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 0.4, duration: 0.5 }}
						className="mx-auto max-w-screen-sm px-4 text-sm leading-relaxed text-muted-foreground sm:px-2 sm:text-base md:text-lg"
					>
						Find and track local volunteering opportunities, connect with organizations, and make a difference in your community.
					</motion.p>

					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.6, duration: 0.5 }}
							className="flex w-full flex-col items-center justify-center gap-4 px-4 sm:w-auto sm:flex-row sm:px-0"
					>
						<Link href="/signup" className="w-full max-w-[280px] sm:w-auto">
							<Button className="group/arrow h-12 w-full transform text-sm font-semibold shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md sm:h-11">
								Get Started
								<ArrowRight className="ml-2 size-5 transition-transform duration-500 group-hover/arrow:translate-x-1" />
							</Button>
						</Link>
						<Link href="/projects" className="w-full max-w-[280px] sm:w-auto">
							<Button
								variant="outline"
								className="h-12 w-full px-8 text-sm transition-colors hover:bg-secondary/80 sm:h-11"
							>
								Browse Opportunities
							</Button>
						</Link>
					</motion.div>

					
				</motion.div>

				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.8, duration: 0.5 }}
					className="mx-auto w-full max-w-3xl px-4"
				>
					<h3 className="mb-4 text-center text-lg font-semibold sm:text-xl">How It Works</h3>
					<div className="grid grid-cols-3 justify-items-center gap-2 sm:gap-4">
						{steps.map((step) => (
							<motion.div
								key={step.title}
								whileHover={shouldReduceMotion ? undefined : { scale: 1.03, y: -4 }}
								whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
								transition={{ type: "spring", stiffness: 260, damping: 20 }}
								className="flex h-full w-full flex-col items-center rounded-xl border border-border/60 bg-background/60 p-2 text-center shadow-sm transition-colors hover:border-primary/50 hover:bg-primary/5 sm:p-3"
							>
								<step.icon className="mb-1 h-5 w-5 text-primary sm:mb-2 sm:h-6 sm:w-6" />
								<h4 className="mb-1 text-xs font-semibold sm:text-sm">{step.title}</h4>
								<p className="hidden text-xs text-muted-foreground sm:block">{step.desc}</p>
							</motion.div>
						))}
					</div>
				</motion.div>
			</div>
		</section>
	);
};
