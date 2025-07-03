"use client";

import { motion } from "framer-motion";
import { Search, MapPin, Filter, Shield, Star, Clock, Users, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { GlowingEffect } from "@/components/ui/glowing-effect";

const mockOpportunities = [
  {
    title: "Beach Cleanup - Santa Monica",
    organization: "Ocean Conservation Society",
    verified: true,
    rating: 4.9,
    distance: "2.3 miles",
    category: "Environmental",
    hours: "3-4 hours",
    participants: 24,
    csfApproved: true,
  },
  {
    title: "Food Bank Sorting",
    organization: "LA Regional Food Bank",
    verified: true,
    rating: 4.8,
    distance: "1.8 miles", 
    category: "Community Service",
    hours: "2-3 hours",
    participants: 18,
    csfApproved: true,
  },
  {
    title: "Senior Reading Program",
    organization: "Golden Years Community",
    verified: true,
    rating: 5.0,
    distance: "4.1 miles",
    category: "Education",
    hours: "1-2 hours",
    participants: 8,
    csfApproved: true,
  },
];

const discoveryFeatures = [
  {
    icon: MapPin,
    title: "Location-Based Discovery",
    description: "Find opportunities within your preferred radius with real-time distance calculations",
  },
  {
    icon: Shield,
    title: "Verification Status Filtering", 
    description: "Filter by organization verification level and institutional partnerships",
  },
  {
    icon: Filter,
    title: "Advanced Category Matching",
    description: "Match opportunities to CSF categories and personal interest areas",
  },
  {
    icon: CheckCircle,
    title: "Pre-Approval Indicators",
    description: "See which opportunities are pre-approved by your school or organization",
  },
];

const OpportunityCard = ({ opportunity, index }: { opportunity: typeof mockOpportunities[0], index: number }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="relative"
    >
      <Card className="relative overflow-hidden border-2 hover:border-primary/30 transition-all duration-300">
        <GlowingEffect
          spread={30}
          glow={true}
          disabled={false}
          proximity={64}
          inactiveZone={0.01}
        />
        <CardContent className="p-6">
          <div className="flex justify-between items-start mb-3">
            <div className="flex items-center gap-2">
              {opportunity.verified && (
                <Shield className="w-4 h-4 text-green-500" />
              )}
              {opportunity.csfApproved && (
                <Badge variant="secondary" className="text-xs">CSF</Badge>
              )}
            </div>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
              <span>{opportunity.rating}</span>
            </div>
          </div>
          
          <h3 className="font-semibold text-lg mb-2">{opportunity.title}</h3>
          <p className="text-muted-foreground text-sm mb-3">{opportunity.organization}</p>
          
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="w-3 h-3" />
              <span>{opportunity.distance}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>{opportunity.hours}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="w-3 h-3" />
              <span>{opportunity.participants} signed up</span>
            </div>
          </div>
          
          <Badge variant="outline" className="text-xs mb-3">
            {opportunity.category}
          </Badge>
          
          <Button className="w-full" size="sm">
            View Details
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export const DiscoverySection = () => {
  return (
    <section className="py-20 bg-background">
      <div className="container mx-auto px-4 sm:px-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Sophisticated Opportunity Discovery
          </h2>
          <p className="text-muted-foreground max-w-3xl mx-auto text-sm sm:text-base">
            Advanced filtering and matching algorithms connect you with verified opportunities 
            that meet your specific requirements and institutional compliance needs.
          </p>
        </motion.div>

        {/* Discovery Features */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-16"
        >
          {discoveryFeatures.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="text-center"
            >
              <div className="w-fit mx-auto rounded-lg bg-primary/10 p-3 mb-3">
                <feature.icon className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold text-base mb-2">{feature.title}</h3>
              <p className="text-muted-foreground text-sm">{feature.description}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Search Interface Mockup */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mb-12"
        >
          <div className="relative max-w-4xl mx-auto">
            <Card className="p-6 border-2">
              <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                  <div className="w-full pl-10 pr-4 py-2 border rounded-md bg-background text-sm text-muted-foreground">
                    Environmental cleanup near me...
                  </div>
                </div>
                <div className="flex gap-2">
                  <Badge variant="secondary" className="px-3 py-1">
                    <MapPin className="w-3 h-3 mr-1" />
                    5 miles
                  </Badge>
                  <Badge variant="secondary" className="px-3 py-1">
                    <Shield className="w-3 h-3 mr-1" />
                    Verified only
                  </Badge>
                  <Badge variant="secondary" className="px-3 py-1">
                    CSF Approved
                  </Badge>
                </div>
              </div>
              
              <div className="text-sm text-muted-foreground mb-4">
                Found 24 verified opportunities • 18 CSF approved • 3 pre-approved by your school
              </div>
            </Card>
          </div>
        </motion.div>

        {/* Sample Opportunities */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="mb-12"
        >
          <h3 className="text-xl font-semibold text-center mb-8">
            Verified Network Results
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {mockOpportunities.map((opportunity, index) => (
              <OpportunityCard key={index} opportunity={opportunity} index={index} />
            ))}
          </div>
        </motion.div>

        {/* Network Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.8 }}
          className="text-center"
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto">
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">500+</h4>
              <p className="text-muted-foreground text-sm">Verified Organizations</p>
            </div>
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">95%</h4>
              <p className="text-muted-foreground text-sm">CSF Approval Rate</p>
            </div>
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">24/7</h4>
              <p className="text-muted-foreground text-sm">Real-time Updates</p>
            </div>
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">100%</h4>
              <p className="text-muted-foreground text-sm">Background Verified</p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};