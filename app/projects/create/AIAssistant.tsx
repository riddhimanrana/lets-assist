"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { EventType } from '@/types';

interface AIAssistantProps {
  onApplyData: (data: AIParseResult) => void;
  onClose: () => void;
  isOpen: boolean;
}

export interface AIParseResult {
  title?: string;
  location?: string;
  description?: string;
  eventType?: EventType;
  schedule?: unknown;
  verificationMethod?: 'qr-code' | 'manual' | 'auto' | 'signup-only';
  requireLogin?: boolean;
}

// Test data for demo purposes (removed - no longer needed)

export default function AIAssistant({ onApplyData, onClose, isOpen }: AIAssistantProps) {
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error('Please describe your project');
      return;
    }

    setIsProcessing(true);
    setIsApplying(true); // Start animation immediately

    try {
      const response = await fetch('/api/ai/parse-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      if (!response.ok) {
        throw new Error('Failed to parse project');
      }

      const parsedData: AIParseResult = await response.json();
      await applyWithAnimation(parsedData);
    } catch (error) {
      console.error('AI generation error:', error);
      toast.error('Failed to generate project details. Please try again.');
      setIsApplying(false); // Stop animation on error
    } finally {
      setIsProcessing(false);
    }
  };

  const applyWithAnimation = async (data: AIParseResult) => {
    // Animation is already running, just wait a bit for visual effect
    await new Promise(resolve => setTimeout(resolve, 400));
    
    onApplyData(data);
    toast.success('Project details filled! Review and adjust as needed.');
    setPrompt('');
    
    // Close after a brief moment
    setTimeout(() => {
      setIsApplying(false);
      onClose();
    }, 600);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Subtle overlay - only on main content, not navbar */}
      <div
        className={`fixed top-16 inset-x-0 bottom-0 bg-black/5 backdrop-blur-[1px] z-30 pointer-events-none transition-opacity duration-700 ${
          isApplying ? 'opacity-100' : 'opacity-0'
        }`}
        aria-hidden="true"
      />

      {/* Animated sparkles on apply */}
      {isApplying && (
        <div className="fixed inset-0 z-40 pointer-events-none overflow-hidden">
          {[...Array(12)].map((_, i) => (
            <div
              key={i}
              className="absolute"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animation: `float-up ${1.4 + Math.random() * 0.8}s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards`,
                animationDelay: `${i * 0.06}s`,
              }}
            >
              <Sparkles className="h-4 w-4 text-primary/70" />
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes float-up {
          0% {
            opacity: 0.9;
            transform: translateY(0) translateX(0) scale(1);
          }
          50% {
            opacity: 0.5;
          }
          100% {
            opacity: 0;
            transform: translateY(-100px) translateX(calc((Math.random() - 0.5) * 40px)) scale(0.2);
          }
        }
      `}</style>

      <Card className={`mb-6 border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent transition-all duration-500 ${
        isApplying ? 'scale-98 opacity-60' : 'scale-100 opacity-100'
      }`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Sparkles className="h-5 w-5 text-primary" />
                {isApplying && (
                  <div className="absolute inset-0 animate-ping">
                    <Sparkles className="h-5 w-5 text-primary opacity-50" />
                  </div>
                )}
              </div>
              <CardTitle className="text-lg">AI Project Assistant</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8 -mt-1 -mr-1"
              disabled={isProcessing || isApplying}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <CardDescription>
            Describe your project in natural language, and AI will help fill out the form
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Textarea
              placeholder="Example: 'We need volunteers for a beach cleanup this Saturday from 9am to 12pm at Santa Cruz Beach. Looking for about 20 volunteers to help pick up trash and recyclables.'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              disabled={isProcessing || isApplying}
              className="resize-none"
            />
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Examples:</div>
              <div className="ml-3 space-y-0.5">
                <div>• <span className="font-medium">Single day:</span> "Beach cleanup Saturday 9am-12pm"</div>
                <div>• <span className="font-medium">Multiple days:</span> "Food drive Monday through Friday 10am-4pm"</div>
                <div>• <span className="font-medium">Multiple roles:</span> "Festival with registration (9am-5pm) and cleanup (2-5pm)"</div>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleGenerate}
              disabled={isProcessing || isApplying || !prompt.trim()}
              className="flex-1"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : isApplying ? (
                <>
                  <Sparkles className="mr-2 h-4 w-4 animate-pulse" />
                  Applying...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate Project Details
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
