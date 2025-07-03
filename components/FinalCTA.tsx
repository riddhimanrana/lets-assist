"use client";

import { motion } from "framer-motion";
import { ArrowRight, Users, Building2, GraduationCap, Calendar, Zap, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import Link from "next/link";

const personaCTAs = [
  {
    icon: GraduationCap,
    title: "CSF Students",
    description: "Automate your CSF compliance with guaranteed acceptance",
    features: ["One-click CSF reporting", "School-accepted certificates", "Real-time progress tracking"],
    primaryCTA: "Start Tracking CSF Hours",
    secondaryCTA: "View CSF Dashboard",
    primaryLink: "/signup",
    secondaryLink: "/projects",
    highlight: "Most Popular",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
  },
  {
    icon: Building2,
    title: "Organizations",
    description: "Scale your volunteer programs with enterprise tools",
    features: ["Manage 100+ volunteers", "Advanced analytics", "Custom workflows"],
    primaryCTA: "Schedule Demo",
    secondaryCTA: "Request Pricing",
    primaryLink: "/contact",
    secondaryLink: "/contact",
    highlight: "Enterprise",
    bgColor: "bg-green-50",
    borderColor: "border-green-200",
  },
  {
    icon: Users,
    title: "School Administrators",
    description: "Monitor student volunteer compliance at scale",
    features: ["Bulk student management", "Compliance reporting", "Institution integration"],
    primaryCTA: "Request Implementation",
    secondaryCTA: "View Success Stories",
    primaryLink: "/contact",
    secondaryLink: "/help",
    highlight: "Institutional",
    bgColor: "bg-purple-50",
    borderColor: "border-purple-200",
  },
];

const finalTrustIndicators = [
  "Used by 50+ schools nationwide",
  "1000+ verified certificates issued",
  "99.9% uptime guarantee",
  "SOC 2 Type II compliant",
  "FERPA compliant",
  "24/7 enterprise support"
];

const PersonaCTACard = ({ persona, index }: { persona: typeof personaCTAs[0], index: number }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="relative h-full"
    >
      <Card className={`relative h-full ${persona.bgColor} ${persona.borderColor} border-2 hover:shadow-lg transition-all duration-300`}>
        <GlowingEffect
          spread={40}
          glow={true}
          disabled={false}
          proximity={64}
          inactiveZone={0.01}
        />
        <CardContent className="p-6 h-full flex flex-col">
          <div className="flex items-start justify-between mb-4">
            <div className="w-fit rounded-lg bg-primary/10 p-3">
              <persona.icon className="w-6 h-6 text-primary" />
            </div>
            {persona.highlight && (
              <Badge variant="default" className="text-xs">
                {persona.highlight}
              </Badge>
            )}
          </div>
          
          <div className="flex-1">
            <h3 className="text-xl font-bold mb-2">{persona.title}</h3>
            <p className="text-muted-foreground text-sm mb-4">{persona.description}</p>
            
            <ul className="space-y-2 mb-6">
              {persona.features.map((feature, featureIndex) => (
                <li key={featureIndex} className="flex items-center text-sm">
                  <div className="w-1.5 h-1.5 bg-primary rounded-full mr-2 flex-shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
          
          <div className="space-y-2">
            <Link href={persona.primaryLink} className="block">
              <Button className="w-full group/arrow">
                {persona.primaryCTA}
                <ArrowRight className="w-4 h-4 ml-2 group-hover/arrow:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <Link href={persona.secondaryLink} className="block">
              <Button variant="outline" className="w-full">
                {persona.secondaryCTA}
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export const FinalCTA = () => {
  return (
    <section className="py-20 bg-background">
      <div className="container mx-auto px-4 sm:px-6">
        {/* Main Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Ready to Transform Your Volunteer Management?
          </h2>
          <p className="text-muted-foreground max-w-3xl mx-auto text-sm sm:text-base">
            Join thousands of students, organizations, and schools already using Let&apos;s Assist 
            for professional volunteer management and automated compliance.
          </p>
        </motion.div>

        {/* Persona-Specific CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-16"
        >
          {personaCTAs.map((persona, index) => (
            <PersonaCTACard key={index} persona={persona} index={index} />
          ))}
        </motion.div>

        {/* Urgency and Social Proof */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="text-center mb-12"
        >
          <Card className="relative max-w-4xl mx-auto border-2 border-primary/20">
            <GlowingEffect
              spread={50}
              glow={true}
              disabled={false}
              proximity={64}
              inactiveZone={0.01}
            />
            <CardContent className="p-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                <div className="text-left">
                  <Badge variant="secondary" className="mb-3 bg-green-100 text-green-700">
                    <Zap className="w-3 h-3 mr-1" />
                    Limited Time
                  </Badge>
                  <h3 className="text-2xl font-bold mb-2">Get Started This Semester</h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    CSF deadlines approaching? Join now and get your hours tracked automatically 
                    with guaranteed school acceptance.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Link href="/signup">
                      <Button size="lg" className="w-full sm:w-auto">
                        Start Free Today
                      </Button>
                    </Link>
                    <Link href="/contact">
                      <Button size="lg" variant="outline" className="w-full sm:w-auto">
                        Talk to Expert
                      </Button>
                    </Link>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <h4 className="font-semibold text-center mb-4">What&apos;s Included</h4>
                  <div className="grid grid-cols-1 gap-2">
                    <div className="flex items-center text-sm">
                      <Shield className="w-4 h-4 text-green-500 mr-2" />
                      <span>Unlimited QR attendance tracking</span>
                    </div>
                    <div className="flex items-center text-sm">
                      <Shield className="w-4 h-4 text-green-500 mr-2" />
                      <span>Professional certificate generation</span>
                    </div>
                    <div className="flex items-center text-sm">
                      <Shield className="w-4 h-4 text-green-500 mr-2" />
                      <span>Automated CSF compliance reporting</span>
                    </div>
                    <div className="flex items-center text-sm">
                      <Shield className="w-4 h-4 text-green-500 mr-2" />
                      <span>Real-time progress dashboard</span>
                    </div>
                    <div className="flex items-center text-sm">
                      <Shield className="w-4 h-4 text-green-500 mr-2" />
                      <span>Access to verified opportunity network</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Final Trust Indicators */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="text-center mb-12"
        >
          <h3 className="text-lg font-semibold mb-6">Trusted by Leading Institutions</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-4xl mx-auto text-sm text-muted-foreground">
            {finalTrustIndicators.map((indicator, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="flex items-center justify-center"
              >
                <div className="w-1.5 h-1.5 bg-primary rounded-full mr-2" />
                {indicator}
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Success Metrics Footer */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.8 }}
          className="text-center"
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto">
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">2.5M+</h4>
              <p className="text-muted-foreground text-sm">Volunteer Hours Tracked</p>
            </div>
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">100%</h4>
              <p className="text-muted-foreground text-sm">CSF Acceptance Rate</p>
            </div>
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">50+</h4>
              <p className="text-muted-foreground text-sm">Partner Schools</p>
            </div>
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">99.9%</h4>
              <p className="text-muted-foreground text-sm">Platform Uptime</p>
            </div>
          </div>
          
          <div className="mt-8 text-xs text-muted-foreground">
            <p>No setup fees • Cancel anytime • FERPA & SOC 2 compliant</p>
          </div>
        </motion.div>
      </div>
    </section>
  );
};