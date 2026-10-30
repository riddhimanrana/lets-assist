"use client";
import { safeConsole } from "@/lib/safe-console";

import { useLayoutEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { SparklesIcon, useAnimatedIcon } from "@/components/icons/animated";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import type { ParseProjectResult } from "@/lib/ai/parse-project-schema";

import {
  createAssistantRequestController,
  type AssistantRequestController,
  type AssistantRequestDeps,
} from "./ai-assistant-request";

interface AIAssistantProps {
  onApplyData: (data: AIParseResult) => void;
  onClose: () => void;
  isOpen: boolean;
  /** The project's timezone, so "today" means today where the project is. */
  projectTimezone?: string;
  /** Test seam for the request lifecycle. Production uses the defaults. */
  requestDeps?: AssistantRequestDeps;
}

export type AIParseResult = ParseProjectResult;

export const AI_APPLIED_MESSAGE =
  "Project details filled. Review and adjust them before you publish.";
export const AI_APPLY_FAILED_MESSAGE =
  "Could not fill in the project details. Please enter them manually.";

/**
 * The prompt lives here so it survives closing and reopening. The request
 * lives in the panel, which only exists while the assistant is open, so any
 * way of closing it (this card, the header toggle, leaving the step) cancels
 * the request.
 */
export default function AIAssistant({
  isOpen,
  ...panelProps
}: AIAssistantProps) {
  const [prompt, setPrompt] = useState("");

  if (!isOpen) return null;

  return (
    <AssistantPanel {...panelProps} prompt={prompt} setPrompt={setPrompt} />
  );
}

type PanelProps = Omit<AIAssistantProps, "isOpen"> & {
  prompt: string;
  setPrompt: (prompt: string) => void;
};

/**
 * Wires the request controller to one open panel. Exported for tests, which
 * drive these handlers without a DOM.
 */
export function createAssistantPanelHandlers({
  controller,
  getPrompt,
  projectTimezone,
  onApplyData,
  onClose,
  setPrompt,
  setPending,
  setError,
  notify,
}: {
  controller: AssistantRequestController;
  getPrompt: () => string;
  projectTimezone?: string;
  onApplyData: (data: AIParseResult) => void;
  onClose: () => void;
  setPrompt: (prompt: string) => void;
  setPending: (pending: boolean) => void;
  setError: (message: string | null) => void;
  notify: { success: (message: string) => void };
}) {
  const generate = async () => {
    setError(null);
    setPending(true);
    await controller.start(getPrompt(), projectTimezone, {
      onSuccess: (data) => {
        setPending(false);
        try {
          onApplyData(data);
        } catch (error) {
          safeConsole.error("Error applying AI data:", error);
          setError(AI_APPLY_FAILED_MESSAGE);
          return;
        }
        notify.success(AI_APPLIED_MESSAGE);
        setPrompt("");
        onClose();
      },
      onFailure: (_reason, message) => {
        setPending(false);
        setError(message);
      },
    });
  };

  const cancel = () => {
    controller.cancel();
    setPending(false);
  };

  const close = () => {
    controller.cancel();
    onClose();
  };

  return { generate, cancel, close };
}

function AssistantPanel({
  onApplyData,
  onClose,
  projectTimezone,
  requestDeps,
  prompt,
  setPrompt,
}: PanelProps) {
  const [controller] = useState(() =>
    createAssistantRequestController(requestDeps),
  );
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generateIcon = useAnimatedIcon();

  // Unmounting (closing, leaving the step) retires the request, so a late
  // answer can never fill the form. A layout cleanup runs inside the commit
  // that removes the panel, so there is no gap before a passive cleanup in
  // which an answer could still apply.
  useLayoutEffect(() => () => controller.cancel(), [controller]);

  const handlers = createAssistantPanelHandlers({
    controller,
    getPrompt: () => prompt,
    projectTimezone,
    onApplyData,
    onClose,
    setPrompt,
    setPending,
    setError,
    notify: toast,
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && isPending) {
      event.preventDefault();
      handlers.cancel();
    }
  };

  return (
    <Card aria-busy={isPending} onKeyDown={handleKeyDown}>
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
            onClick={handlers.close}
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
          onChange={(e) => {
            setPrompt(e.target.value);
            if (error) setError(null);
          }}
          rows={4}
          readOnly={isPending}
          aria-invalid={error ? true : undefined}
          className="resize-none"
        />
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
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
      <CardFooter className="flex-wrap justify-end gap-2">
        {isPending ? (
          <Button
            variant="outline"
            onClick={handlers.cancel}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => void handlers.generate()}
          disabled={isPending || !prompt.trim()}
          className="w-full sm:w-auto"
          {...generateIcon.triggerProps}
        >
          {isPending ? (
            <>
              <Loader2
                data-icon="inline-start"
                aria-hidden="true"
                className="animate-spin"
              />
              Generating...
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
