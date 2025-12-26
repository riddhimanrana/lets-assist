"use client";

import { motion } from "framer-motion";
import { CheckCircle, Award, FileText, Zap, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { GlowingEffect } from "@/components/ui/glowing-effect";

const csfBenefits = [
  {
    icon: Zap,
    title: "One-Click CSF Reporting",
    description: "Automatically generate and submit CSF forms with pre-filled data",
  },
  {
    icon: CheckCircle,
    title: "Real-Time Compliance Tracking",
    description: "Monitor your progress toward CSF requirements with live updates",
  },
  {
    icon: Award,
    title: "School-Accepted Certificates",
    description: "Generate verified certificates that are automatically accepted by partner schools",
  },
  {
    icon: FileText,
    title: "Automated Documentation",
    description: "All paperwork handled automatically - no more manual form filling",
  },
];

const mockCSFData = {
  totalHours: 42,
  requiredHours: 50,
  completedActivities: 8,
  pendingApprovals: 2,
  categories: [
    { name: "Community Service", hours: 18, required: 20, color: "bg-blue-500" },
    { name: "Environmental", hours: 15, required: 15, color: "bg-green-500" },
    { name: "Education", hours: 9, required: 15, color: "bg-yellow-500" },
  ],
  recentActivities: [
    { name: "Beach Cleanup", hours: 4, status: "Approved", date: "Dec 15" },
    { name: "Food Bank", hours: 3, status: "Pending", date: "Dec 12" },
    { name: "Tutoring", hours: 2, status: "Approved", date: "Dec 10" },
  ],
};

const CSFDashboardPreview = () => {
  return (
    <div className="relative max-w-4xl mx-auto">
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
            <CardTitle className="text-xl">CSF Progress Dashboard</CardTitle>
            <Badge variant="secondary" className="bg-green-100 text-green-700">
              84% Complete
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Progress Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="text-center p-3 rounded-lg bg-primary/5">
              <div className="text-2xl font-bold text-primary">{mockCSFData.totalHours}</div>
              <div className="text-sm text-muted-foreground">Total Hours</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-green-50">
              <div className="text-2xl font-bold text-green-600">{mockCSFData.completedActivities}</div>
              <div className="text-sm text-muted-foreground">Activities</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-yellow-50">
              <div className="text-2xl font-bold text-yellow-600">{mockCSFData.pendingApprovals}</div>
              <div className="text-sm text-muted-foreground">Pending</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-blue-50">
              <div className="text-2xl font-bold text-blue-600">8</div>
              <div className="text-sm text-muted-foreground">Days Left</div>
            </div>
          </div>

          {/* Category Progress */}
          <div>
            <h4 className="font-semibold mb-3">Category Requirements</h4>
            <div className="space-y-3">
              {mockCSFData.categories.map((category, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>{category.name}</span>
                    <span>{category.hours}/{category.required} hours</span>
                  </div>
                  <Progress 
                    value={(category.hours / category.required) * 100} 
                    className="h-2"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Recent Activities */}
          <div>
            <h4 className="font-semibold mb-3">Recent Activities</h4>
            <div className="space-y-2">
              {mockCSFData.recentActivities.map((activity, index) => (
                <div key={index} className="flex justify-between items-center p-2 rounded bg-secondary/30">
                  <div>
                    <div className="font-medium text-sm">{activity.name}</div>
                    <div className="text-xs text-muted-foreground">{activity.date}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-sm">{activity.hours}h</div>
                    <Badge 
                      variant={activity.status === "Approved" ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {activity.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="text-xs">
              <FileText className="w-3 h-3 mr-1" />
              Generate CSF Report
            </Button>
            <Button size="sm" variant="outline" className="text-xs">
              <Calendar className="w-3 h-3 mr-1" />
              Find Opportunities
            </Button>
            <Button size="sm" variant="outline" className="text-xs">
              <Award className="w-3 h-3 mr-1" />
              Download Certificate
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export const CSFDashboardSection = () => {
  return (
    <section className="py-20 bg-muted/30">
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
            CSF Students
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            CSF Made Simple
          </h2>
          <p className="text-muted-foreground max-w-3xl mx-auto text-sm sm:text-base">
            Eliminate the hassle of CSF tracking with automated compliance, one-click reporting, 
            and school-accepted certificates. Focus on volunteering, not paperwork.
          </p>
        </motion.div>

        {/* Pain Points Addressed */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-center mb-12"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            <div className="p-4 rounded-lg bg-red-50 border border-red-100">
              <div className="text-red-600 font-medium text-sm mb-1">Before Let&apos;s Assist</div>
              <div className="text-red-700 text-xs">Manual hour tracking • Rejected forms • Lost documentation</div>
            </div>
            <div className="p-4 rounded-lg bg-green-50 border border-green-100">
              <div className="text-green-600 font-medium text-sm mb-1">With Let&apos;s Assist</div>
              <div className="text-green-700 text-xs">Automated tracking • Guaranteed acceptance • Secure records</div>
            </div>
          </div>
        </motion.div>

        {/* CSF Benefits */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-16"
        >
          {csfBenefits.map((benefit, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="text-center"
            >
              <div className="w-fit mx-auto rounded-lg bg-primary/10 p-3 mb-3">
                <benefit.icon className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold text-base mb-2">{benefit.title}</h3>
              <p className="text-muted-foreground text-sm">{benefit.description}</p>
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
            Your Personal CSF Dashboard
          </h3>
          <CSFDashboardPreview />
        </motion.div>

        {/* Success Metrics */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.8 }}
          className="text-center"
        >
          <h3 className="text-xl font-semibold mb-6">CSF Student Success</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto">
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">100%</h4>
              <p className="text-muted-foreground text-sm">CSF Acceptance Rate</p>
            </div>
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">2.5x</h4>
              <p className="text-muted-foreground text-sm">Faster Completion</p>
            </div>
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">Zero</h4>
              <p className="text-muted-foreground text-sm">Rejected Forms</p>
            </div>
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">500+</h4>
              <p className="text-muted-foreground text-sm">CSF Students</p>
            </div>
          </div>
          
          <div className="mt-8">
            <Button size="lg" className="text-base px-8">
              Start CSF Tracking
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  );
};