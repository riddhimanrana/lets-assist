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
  schedule?: any;
  verificationMethod?: 'qr-code' | 'manual' | 'auto' | 'signup-only';
  requireLogin?: boolean;
  isPrivate?: boolean;
}

export default function AIAssistant({ onApplyData, onClose, isOpen }: AIAssistantProps) {
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error('Please describe your project');
      return;
    }

    setIsProcessing(true);

    try {
      const response = await fetch('/api/ai/parse-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      if (!response.ok) {
        throw new Error('Failed to parse project');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('0:')) {
              const jsonStr = line.slice(2);
              try {
                fullText += JSON.parse(jsonStr);
              } catch (e) {
                // Skip invalid chunks
              }
            }
          }
        }
      }

      // Parse the complete JSON response
      let parsedData: AIParseResult;
      try {
        parsedData = JSON.parse(fullText);
      } catch (e) {
        // If JSON parsing fails, try to extract JSON from the text
        const jsonMatch = fullText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Could not parse AI response');
        }
      }

      onApplyData(parsedData);
      toast.success('Project details filled! Review and adjust as needed.');
      setPrompt('');
    } catch (error) {
      console.error('AI generation error:', error);
      toast.error('Failed to generate project details. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Card className="mb-6 border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">AI Project Assistant</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 -mt-1 -mr-1"
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
            disabled={isProcessing}
            className="resize-none"
          />
          <div className="text-xs text-muted-foreground">
            💡 Try: "Food drive Monday-Friday", "Festival with setup crew and cleanup team", or "Tutoring on Tuesdays 3-5pm"
          </div>
        </div>
        <Button
          onClick={handleGenerate}
          disabled={isProcessing || !prompt.trim()}
          className="w-full"
        >
          {isProcessing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Generate Project Details
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
