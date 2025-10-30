"use client";

import { motion } from "framer-motion";
import { Users, BarChart3, Clock, Settings, Calendar, MessageSquare, FileText, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { GlowingEffect } from "@/components/ui/glowing-effect";

const organizationFeatures = [
  {
    icon: Users,
    title: "Bulk Volunteer Management",
    description: "Coordinate 100+ volunteers simultaneously with automated scheduling and role assignments",
  },
  {
    icon: BarChart3,
    title: "Advanced Analytics Dashboard",
    description: "Track ROI, engagement metrics, and impact measurement with detailed reporting",
  },
  {
    icon: Clock,
    title: "Automated Time Tracking",
    description: "QR-based attendance with supervisor approval workflows and compliance automation",
  },
  {
    icon: MessageSquare,
    title: "Team Communication Tools",
    description: "Built-in messaging, announcements, and coordination features for large teams",
  },
];

const mockOrganizationData = {
  totalVolunteers: 234,
  activeProjects: 12,
  monthlyHours: 1847,
  retention: 89,
  volunteers: [
    { name: "Sarah Chen", hours: 24, projects: 3, status: "Active" },
    { name: "Mike Johnson", hours: 18, projects: 2, status: "Active" },
    { name: "Emily Davis", hours: 31, projects: 4, status: "Pending" },
    { name: "Alex Rivera", hours: 22, projects: 3, status: "Active" },
  ],
  projects: [
    { name: "Community Garden", volunteers: 45, completion: 78 },
    { name: "Senior Care Program", volunteers: 32, completion: 92 },
    { name: "Youth Mentoring", volunteers: 28, completion: 65 },
  ],
};

const OrganizationDashboardPreview = () => {
  return (
    <div className="relative max-w-5xl mx-auto">
      <Card className="relative overflow-hidden border-2 border-primary/20">
        <GlowingEffect
          spread={50}
          glow={true}
          disabled={false}
          proximity={64}
          inactiveZone={0.01}
        />
        <CardHeader className="pb-3">
          <div className="flex justify-between items-center">
            <CardTitle className="text-xl">Organization Dashboard</CardTitle>
            <Badge variant="secondary" className="bg-green-100 text-green-700">
              Enterprise Plan
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="text-center p-4 rounded-lg bg-primary/5">
              <div className="text-2xl font-bold text-primary">{mockOrganizationData.totalVolunteers}</div>
              <div className="text-sm text-muted-foreground">Total Volunteers</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-blue-50">
              <div className="text-2xl font-bold text-blue-600">{mockOrganizationData.activeProjects}</div>
              <div className="text-sm text-muted-foreground">Active Projects</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-green-50">
              <div className="text-2xl font-bold text-green-600">{mockOrganizationData.monthlyHours}</div>
              <div className="text-sm text-muted-foreground">Monthly Hours</div>
            </div>
            <div className="text-center p-4 rounded-lg bg-yellow-50">
              <div className="text-2xl font-bold text-yellow-600">{mockOrganizationData.retention}%</div>
              <div className="text-sm text-muted-foreground">Retention Rate</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Active Volunteers */}
            <div>
              <h4 className="font-semibold mb-3 flex items-center">
                <Users className="w-4 h-4 mr-2" />
                Recent Volunteer Activity
              </h4>
              <div className="space-y-2">
                {mockOrganizationData.volunteers.map((volunteer, index) => (
                  <div key={index} className="flex justify-between items-center p-3 rounded bg-secondary/30">
                    <div>
                      <div className="font-medium text-sm">{volunteer.name}</div>
                      <div className="text-xs text-muted-foreground">{volunteer.projects} projects</div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-sm">{volunteer.hours}h</div>
                      <Badge 
                        variant={volunteer.status === "Active" ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {volunteer.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Project Progress */}
            <div>
              <h4 className="font-semibold mb-3 flex items-center">
                <BarChart3 className="w-4 h-4 mr-2" />
                Project Completion
              </h4>
              <div className="space-y-4">
                {mockOrganizationData.projects.map((project, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>{project.name}</span>
                      <span>{project.volunteers} volunteers</span>
                    </div>
                    <Progress 
                      value={project.completion} 
                      className="h-2"
                    />
                    <div className="text-xs text-muted-foreground text-right">
                      {project.completion}% complete
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="text-xs">
              <Users className="w-3 h-3 mr-1" />
              Manage Volunteers
            </Button>
            <Button size="sm" variant="outline" className="text-xs">
              <Calendar className="w-3 h-3 mr-1" />
              Schedule Event
            </Button>
            <Button size="sm" variant="outline" className="text-xs">
              <FileText className="w-3 h-3 mr-1" />
              Export Reports
            </Button>
            <Button size="sm" variant="outline" className="text-xs">
              <MessageSquare className="w-3 h-3 mr-1" />
              Send Announcement
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export const OrganizationManagementSection = () => {
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
          <Badge variant="outline" className="mb-4">
            Organization Admins
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Professional Volunteer Management
          </h2>
          <p className="text-muted-foreground max-w-3xl mx-auto text-sm sm:text-base">
            Scale your volunteer programs with enterprise-grade tools. Manage hundreds of volunteers, 
            track impact metrics, and automate administrative workflows.
          </p>
        </motion.div>

        {/* ROI and Time Savings */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-center mb-12"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
            <div className="p-6 rounded-lg bg-green-50 border border-green-100">
              <div className="text-2xl font-bold text-green-600 mb-2">75%</div>
              <div className="text-green-700 font-medium text-sm mb-1">Administrative Time Saved</div>
              <div className="text-green-600 text-xs">Automate scheduling, tracking, and reporting</div>
            </div>
            <div className="p-6 rounded-lg bg-blue-50 border border-blue-100">
              <div className="text-2xl font-bold text-blue-600 mb-2">3x</div>
              <div className="text-blue-700 font-medium text-sm mb-1">Volunteer Retention</div>
              <div className="text-blue-600 text-xs">Better coordination and engagement tools</div>
            </div>
            <div className="p-6 rounded-lg bg-purple-50 border border-purple-100">
              <div className="text-2xl font-bold text-purple-600 mb-2">$15K</div>
              <div className="text-purple-700 font-medium text-sm mb-1">Annual Cost Savings</div>
              <div className="text-purple-600 text-xs">Reduced overhead and improved efficiency</div>
            </div>
          </div>
        </motion.div>

        {/* Organization Features */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-16"
        >
          {organizationFeatures.map((feature, index) => (
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

        {/* Dashboard Preview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="mb-16"
        >
          <h3 className="text-2xl font-semibold text-center mb-8">
            Enterprise Management Dashboard
          </h3>
          <OrganizationDashboardPreview />
        </motion.div>

        {/* Enterprise Features */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.8 }}
          className="mb-12"
        >
          <h3 className="text-xl font-semibold text-center mb-8">Advanced Capabilities</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card>
              <CardContent className="p-6 text-center">
                <Settings className="w-8 h-8 mx-auto mb-3 text-primary" />
                <h4 className="font-semibold mb-2">Custom Workflows</h4>
                <p className="text-muted-foreground text-sm">
                  Configure approval processes, role hierarchies, and automated actions
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center">
                <Zap className="w-8 h-8 mx-auto mb-3 text-primary" />
                <h4 className="font-semibold mb-2">API Integration</h4>
                <p className="text-muted-foreground text-sm">
                  Connect with existing systems via REST API and webhook support
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center">
                <FileText className="w-8 h-8 mx-auto mb-3 text-primary" />
                <h4 className="font-semibold mb-2">White-Label Reports</h4>
                <p className="text-muted-foreground text-sm">
                  Branded reports for stakeholders with custom metrics and branding
                </p>
              </CardContent>
            </Card>
          </div>
        </motion.div>

        {/* Organization Success Metrics */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 1.0 }}
          className="text-center"
        >
          <h3 className="text-xl font-semibold mb-6">Trusted by Leading Organizations</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto">
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">200+</h4>
              <p className="text-muted-foreground text-sm">Organizations</p>
            </div>
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">50K+</h4>
              <p className="text-muted-foreground text-sm">Volunteers Managed</p>
            </div>
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">99.9%</h4>
              <p className="text-muted-foreground text-sm">Uptime SLA</p>
            </div>
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">24/7</h4>
              <p className="text-muted-foreground text-sm">Enterprise Support</p>
            </div>
          </div>
          
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="text-base px-8">
              Schedule Demo
            </Button>
            <Button size="lg" variant="outline" className="text-base px-8">
              Request Pricing
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  );
};