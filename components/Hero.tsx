"use client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Search, CalendarCheck, CheckCircle } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

export const HeroSection = () => {
	return (
		<section className="container relative w-full overflow-hidden mx-auto px-4">
			<div className="grid place-items-center w-full gap-6 mx-auto py-12 md:py-28">
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5 }}
					className="text-center space-y-5 sm:space-y-8 w-full"
				>
					<Badge
						variant="outline"
						className="text-xs sm:text-sm py-2 sm:py-2"
					>
						<span className="mr-2 text-primary">
							<Badge>New</Badge>
						</span>
						<span> v1.0 released 🎉</span>
					</Badge>

					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.2, duration: 0.5 }}
						className="w-full max-w-screen-md mx-auto text-center px-2"
					>
						<h1 className="text-[2.7rem] sm:text-4xl md:text-5xl lg:text-6xl font-extrabold sm:font-extrabold font-overusedgrotesk tracking-tight leading-[1.1] sm:leading-tight">
							Give back to your{" "}
							<span className="text-transparent bg-gradient-to-r from-[#4ed247] to-primary bg-clip-text inline-block">
								community
							</span>{" "}
							<span className="inline-block">your way</span>
						</h1>
					</motion.div>

					<motion.p
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 0.4, duration: 0.5 }}
						className="max-w-screen-sm mx-auto text-sm sm:text-base md:text-lg text-muted-foreground px-4 sm:px-2 leading-relaxed"
					>
						Find and track local volunteering opportunities, connect with
						organizations, and make a difference in your community.
					</motion.p>

					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.6, duration: 0.5 }}
						className="flex flex-col sm:flex-row items-center justify-center gap-4 px-4 sm:px-0 w-full sm:w-auto"
					>
						<Link href="/signup" className="w-full sm:w-auto max-w-[280px]">
							<Button className="w-full h-12 sm:h-11 px-8 font-semibold text-sm group/arrow shadow-sm hover:shadow-md transform transition-all duration-200 hover:scale-[1.02]">
								Get Started
								<ArrowRight className="size-5 ml-2 group-hover/arrow:translate-x-1 transition-transform duration-500" />
							</Button>
						</Link>
						<Link href="/projects" className="w-full sm:w-auto max-w-[280px]">
							<Button
								variant="outline"
								className="w-full h-12 sm:h-11 px-8 text-sm hover:bg-secondary/80 transition-colors"
							>
								Browse Opportunities
							</Button>
						</Link>
					</motion.div>
				</motion.div>

				{/* How It Works section */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.8, duration: 0.5 }}
					className="w-full max-w-3xl mx-auto mt-6 sm:mt-8 px-4"
				>
					<h3 className="text-center text-lg sm:text-xl font-semibold mb-4">
						How It Works
					</h3>
					<div className="grid grid-cols-3 gap-2 sm:gap-4 justify-items-center">
						{[
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
              

						].map((step, i) => (
							<div
								key={i}
								className="flex flex-col items-center text-center p-2 sm:p-3 bg-background/50 backdrop-blur-sm rounded-lg shadow"
							>
								<step.icon className="w-5 h-5 sm:w-6 sm:h-6 text-primary mb-1 sm:mb-2" />
								<h4 className="font-semibold text-xs sm:text-sm mb-1">
									{step.title}
								</h4>
								<p className="hidden sm:block text-xs text-muted-foreground">
									{step.desc}
								</p>
							</div>
						))}
					</div>
				</motion.div>
			</div>
		</section>
	);
};