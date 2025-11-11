"use client";

import { motion } from "framer-motion";
import { QrCode, Smartphone, CheckCircle, Clock, Shield, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { useState } from "react";

const qrBenefits = [
  {
    icon: Zap,
    title: "Instant Check-In",
    description: "Scan QR code for immediate attendance confirmation - no manual entry required",
  },
  {
    icon: Shield,
    title: "Tamper-Proof Verification",
    description: "Cryptographically secure QR codes prevent fraud and ensure accurate tracking",
  },
  {
    icon: Clock,
    title: "Real-Time Synchronization",
    description: "Attendance data updates instantly across all admin dashboards and reports",
  },
  {
    icon: CheckCircle,
    title: "Automated Approval",
    description: "Pre-configured workflows automatically approve verified attendance",
  },
];

const QRDemoCard = ({ title, description, step, isActive }: { 
  title: string; 
  description: string; 
  step: number; 
  isActive: boolean; 
}) => {
  return (
    <Card className={`relative transition-all duration-300 ${isActive ? 'border-primary ring-2 ring-primary/20' : ''}`}>
      <GlowingEffect
        spread={isActive ? 40 : 20}
        glow={isActive}
        disabled={!isActive}
        proximity={64}
        inactiveZone={0.01}
      />
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
            isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}>
            {step}
          </div>
          <CardTitle className="text-lg">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">{description}</p>
      </CardContent>
    </Card>
  );
};

const QRCodeSimulation = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isScanning, setIsScanning] = useState(false);

  const steps = [
    "Generate QR Code",
    "Volunteer Scans",
    "Instant Verification",
    "Data Synchronized"
  ];

  const handleStartDemo = () => {
    setIsScanning(true);
    setCurrentStep(0);
    
    const stepInterval = setInterval(() => {
      setCurrentStep(prev => {
        if (prev >= 3) {
          clearInterval(stepInterval);
          setIsScanning(false);
          return 0;
        }
        return prev + 1;
      });
    }, 1500);
  };

  return (
    <div className="relative max-w-4xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
        {/* QR Code Visualization */}
        <div className="text-center">
          <Card className="relative p-8 border-2 border-dashed border-primary/30">
            <motion.div
              animate={isScanning ? { scale: [1, 1.05, 1] } : { scale: 1 }}
              transition={{ duration: 1, repeat: isScanning ? Infinity : 0 }}
              className="relative"
            >
              <div className="w-48 h-48 mx-auto bg-white border-4 border-black rounded-lg flex items-center justify-center relative overflow-hidden">
                {/* QR Code Pattern Simulation */}
                <div className="grid grid-cols-8 gap-1 w-40 h-40">
                  {Array.from({ length: 64 }).map((_, i) => (
                    <motion.div
                      key={i}
                      className="w-full h-full"
                      animate={{
                        backgroundColor: isScanning 
                          ? ['#000', '#4ade80', '#000'] 
                          : ['#000', '#000', '#000']
                      }}
                      transition={{
                        duration: 0.3,
                        delay: i * 0.01,
                        repeat: isScanning ? Infinity : 0,
                        repeatType: "reverse"
                      }}
                      style={{
                        backgroundColor: Math.random() > 0.6 ? '#000' : '#fff'
                      }}
                    />
                  ))}
                </div>
                
                {/* Scanning Line Effect */}
                {isScanning && (
                  <motion.div
                    className="absolute top-0 left-0 w-full h-1 bg-green-500 shadow-lg"
                    animate={{ y: [0, 192, 0] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  />
                )}
              </div>
              
              {/* Status Indicators */}
              <div className="mt-4 space-y-2">
                <Badge 
                  variant={currentStep >= 2 ? "default" : "secondary"}
                  className={currentStep >= 2 ? "bg-green-500" : ""}
                >
                  {currentStep >= 2 ? (
                    <>
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Verified
                    </>
                  ) : currentStep === 1 ? (
                    <>
                      <QrCode className="w-3 h-3 mr-1" />
                      Scanning...
                    </>
                  ) : (
                    <>
                      <Clock className="w-3 h-3 mr-1" />
                      Ready to Scan
                    </>
                  )}
                </Badge>
                
                {currentStep >= 3 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-sm text-green-600 font-medium"
                  >
                    ✓ Attendance recorded at 2:34 PM
                  </motion.div>
                )}
              </div>
            </motion.div>
          </Card>
          
          <Button 
            onClick={handleStartDemo}
            disabled={isScanning}
            className="mt-6"
            size="lg"
          >
            <Smartphone className="w-4 h-4 mr-2" />
            {isScanning ? "Processing..." : "Simulate QR Scan"}
          </Button>
        </div>

        {/* Process Steps */}
        <div className="space-y-4">
          <QRDemoCard
            step={1}
            title="Event QR Code Generated"
            description="Unique, tamper-proof QR code created for each volunteer event with encrypted attendance data"
            isActive={currentStep === 0}
          />
          <QRDemoCard
            step={2}
            title="Volunteer Scans with Phone"
            description="Simple camera scan from any smartphone - no app download required for basic check-in"
            isActive={currentStep === 1}
          />
          <QRDemoCard
            step={3}
            title="Instant Verification"
            description="Attendance verified against event roster and volunteer eligibility in real-time"
            isActive={currentStep === 2}
          />
          <QRDemoCard
            step={4}
            title="Data Synchronized"
            description="Hours automatically added to volunteer profile, CSF dashboard, and organization reports"
            isActive={currentStep === 3}
          />
        </div>
      </div>
    </div>
  );
};

export const QRVerificationSection = () => {
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
            <QrCode className="w-3 h-3 mr-1" />
            QR Technology
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Revolutionary QR Attendance System
          </h2>
          <p className="text-muted-foreground max-w-3xl mx-auto text-sm sm:text-base">
            Eliminate manual attendance tracking with our patent-pending QR verification system. 
            Instant, accurate, and tamper-proof attendance for volunteers and organizations.
          </p>
        </motion.div>

        {/* Problem vs Solution */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-center mb-16"
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-4xl mx-auto">
            <div className="p-6 rounded-lg bg-red-50 border border-red-100">
              <h3 className="text-red-600 font-semibold text-lg mb-3">Traditional Attendance</h3>
              <ul className="text-red-700 text-sm space-y-2 text-left">
                <li>• Manual sign-in sheets (easily lost/forged)</li>
                <li>• Delays in hour verification and approval</li>
                <li>• Human error in time calculation</li>
                <li>• No real-time visibility for supervisors</li>
                <li>• Difficult to track large groups</li>
              </ul>
            </div>
            <div className="p-6 rounded-lg bg-green-50 border border-green-100">
              <h3 className="text-green-600 font-semibold text-lg mb-3">QR Attendance System</h3>
              <ul className="text-green-700 text-sm space-y-2 text-left">
                <li>• Instant check-in with smartphone scan</li>
                <li>• Real-time verification and approval</li>
                <li>• Automatic time calculation and logging</li>
                <li>• Live dashboard for supervisors</li>
                <li>• Handles 100+ volunteers simultaneously</li>
              </ul>
            </div>
          </div>
        </motion.div>

        {/* Interactive QR Demo */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mb-16"
        >
          <h3 className="text-2xl font-semibold text-center mb-8">
            See QR Verification in Action
          </h3>
          <QRCodeSimulation />
        </motion.div>

        {/* Benefits Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-16"
        >
          {qrBenefits.map((benefit, index) => (
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

        {/* Technical Advantages */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.8 }}
          className="mb-12"
        >
          <h3 className="text-xl font-semibold text-center mb-8">Technical Excellence</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl mx-auto">
            <Card>
              <CardContent className="p-6 text-center">
                <Shield className="w-8 h-8 mx-auto mb-3 text-primary" />
                <h4 className="font-semibold mb-2">Bank-Grade Security</h4>
                <p className="text-muted-foreground text-sm">
                  AES-256 encryption with timestamp validation prevents tampering
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center">
                <Zap className="w-8 h-8 mx-auto mb-3 text-primary" />
                <h4 className="font-semibold mb-2">Sub-Second Response</h4>
                <p className="text-muted-foreground text-sm">
                  Average scan-to-confirmation time under 800 milliseconds
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center">
                <Smartphone className="w-8 h-8 mx-auto mb-3 text-primary" />
                <h4 className="font-semibold mb-2">Universal Compatibility</h4>
                <p className="text-muted-foreground text-sm">
                  Works with any smartphone camera - no app installation required
                </p>
              </CardContent>
            </Card>
          </div>
        </motion.div>

        {/* Success Metrics */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 1.0 }}
          className="text-center"
        >
          <h3 className="text-xl font-semibold mb-6">Proven Results</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto">
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">99.8%</h4>
              <p className="text-muted-foreground text-sm">Scan Success Rate</p>
            </div>
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">90%</h4>
              <p className="text-muted-foreground text-sm">Time Savings</p>
            </div>
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">Zero</h4>
              <p className="text-muted-foreground text-sm">Fraud Cases</p>
            </div>
            <div>
              <h4 className="text-2xl font-bold text-primary mb-1">50K+</h4>
              <p className="text-muted-foreground text-sm">Scans Processed</p>
            </div>
          </div>
          
          <div className="mt-8">
            <Button size="lg" className="text-base px-8">
              Try QR Attendance
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  );
};