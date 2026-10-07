"use client";
import { safeConsole } from "@/lib/safe-console";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { SparklesIcon, useAnimatedIcon } from "@/components/icons/animated";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  parseProjectOutputSchema,
  type ParseProjectResult,
} from "@/lib/ai/parse-project-schema";

interface AIAssistantProps {
  onApplyData: (data: AIParseResult) => void;
  onClose: () => void;
  isOpen: boolean;
}

export type AIParseResult = ParseProjectResult;

export default function AIAssistant({
  onApplyData,
  onClose,
  isOpen,
}: AIAssistantProps) {
  const [prompt, setPrompt] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const generateIcon = useAnimatedIcon();

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error("Please describe your project");
      return;
    }

    setIsProcessing(true);
    setIsApplying(true); // Start animation immediately

    try {
      const response = await fetch("/api/ai/parse-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const parsedResponse = parseProjectOutputSchema.safeParse(
        await response.json(),
      );
      if (!parsedResponse.success) {
        throw new Error("AI did not return valid project data");
      }
      const parsedData = parsedResponse.data;

      await applyWithAnimation(parsedData);
    } catch (error) {
      safeConsole.error("AI generation error:", error);

      // Provide more specific error messages
      let errorMessage =
        "Failed to generate project details. Please try again.";
      if (error instanceof Error) {
        if (error.message.includes("fetch")) {
          errorMessage =
            "Network error. Please check your connection and try again.";
        } else if (error.message.includes("valid project data")) {
          errorMessage =
            "Could not understand your description. Please try rephrasing it.";
        } else if (error.message.includes("Server error")) {
          errorMessage = "Server error. Please try again in a moment.";
        }
      }

      toast.error(errorMessage);
      setIsApplying(false); // Stop animation on error
    } finally {
      setIsProcessing(false);
    }
  };

  const applyWithAnimation = async (data: AIParseResult) => {
    // Animation is already running, just wait a bit for visual effect
    await new Promise((resolve) => setTimeout(resolve, 400));

    try {
      onApplyData(data);
      toast.success("Project details filled! Review and adjust as needed.");
      setPrompt("");

      // Close after a brief moment
      setTimeout(() => {
        setIsApplying(false);
        onClose();
      }, 600);
    } catch (error) {
      safeConsole.error("Error applying AI data:", error);
      toast.error(
        "Failed to apply project details. Please try entering them manually.",
      );
      setIsApplying(false);
      onClose();
    }
  };

  if (!isOpen) return null;

  const isBusy = isProcessing || isApplying;

  return (
    <Card aria-busy={isBusy}>
      <CardHeader>
        <CardTitle>AI project assistant</CardTitle>
        <CardDescription>
          Describe your project in natural language, and AI will help fill out
          the form
        </CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close AI assistant"
            onClick={onClose}
            disabled={isBusy}
            className="-mt-1.5 -mr-1.5"
          >
            <X aria-hidden="true" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Textarea
          aria-label="Describe your project"
          placeholder="Example: 'We need volunteers for a beach cleanup this Saturday from 9am to 12pm at Santa Cruz Beach. Looking for about 20 volunteers to help pick up trash and recyclables.'"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          disabled={isBusy}
          className="resize-none"
        />
        <div className="text-muted-foreground grid gap-1 text-sm">
          <p>Examples:</p>
          <ul className="grid gap-0.5">
            <li>
              <span className="text-foreground font-medium">Single day:</span>{" "}
              &quot;Beach cleanup Saturday 9am-12pm&quot;
            </li>
            <li>
              <span className="text-foreground font-medium">
                Multiple days:
              </span>{" "}
              &quot;Food drive Monday through Friday 10am-4pm&quot;
            </li>
            <li>
              <span className="text-foreground font-medium">
                Multiple roles:
              </span>{" "}
              &quot;Festival with registration (9am-5pm) and cleanup
              (2-5pm)&quot;
            </li>
          </ul>
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          variant="secondary"
          onClick={handleGenerate}
          disabled={isBusy || !prompt.trim()}
          className="w-full sm:w-auto"
          {...generateIcon.triggerProps}
        >
          {isProcessing ? (
            <>
              <Loader2
                data-icon="inline-start"
                aria-hidden="true"
                className="animate-spin"
              />
              Generating...
            </>
          ) : isApplying ? (
            <>
              <Loader2
                data-icon="inline-start"
                aria-hidden="true"
                className="animate-spin"
              />
              Applying...
            </>
          ) : (
            <>
              <SparklesIcon
                ref={generateIcon.ref}
                size={16}
                data-icon="inline-start"
                aria-hidden="true"
              />
              Generate project details
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
