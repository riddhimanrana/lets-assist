"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { WaiverSignatureInput, WaiverSignatureType, WaiverTemplate } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FileText, PenTool, Type } from "lucide-react";
import { RichTextContent } from "@/components/ui/rich-text-content";

const SIGNATURE_CANVAS_HEIGHT = 160;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED_UPLOAD_TYPES = ["application/pdf", "image/png", "image/jpeg"];

interface WaiverSignatureSectionProps {
  template: WaiverTemplate | null;
  signerName?: string | null;
  signerEmail?: string | null;
  allowUpload?: boolean;
  required?: boolean;
  onChange: (signature: WaiverSignatureInput | null) => void;
}

export function WaiverSignatureSection({
  template,
  signerName,
  signerEmail,
  allowUpload = true,
  required = true,
  onChange,
}: WaiverSignatureSectionProps) {
  const [signatureType, setSignatureType] = useState<WaiverSignatureType>("draw");
  const [typedSignature, setTypedSignature] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [uploadDataUrl, setUploadDataUrl] = useState<string | null>(null);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [uploadFileType, setUploadFileType] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [drawn, setDrawn] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ratio = window.devicePixelRatio || 1;
    const width = container.clientWidth;

    canvas.width = width * ratio;
    canvas.height = SIGNATURE_CANVAS_HEIGHT * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${SIGNATURE_CANVAS_HEIGHT}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#111827";
    }
  }, []);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas]);

  const getCanvasPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const startDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawingRef.current = true;
    const point = getCanvasPoint(event);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  };

  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const point = getCanvasPoint(event);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    setDrawn(true);
  };

  const stopDrawing = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSignatureDataUrl(canvas.toDataURL("image/png"));
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureDataUrl(null);
    setDrawn(false);
  };

  const handleUpload = async (file: File | null) => {
    if (!file) {
      setUploadDataUrl(null);
      setUploadFileName(null);
      setUploadFileType(null);
      return;
    }

    if (!ACCEPTED_UPLOAD_TYPES.includes(file.type)) {
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setUploadDataUrl(reader.result as string);
      setUploadFileName(file.name);
      setUploadFileType(file.type);
    };
    reader.readAsDataURL(file);
  };

  const isSignatureValid = useMemo(() => {
    if (!agreed) return false;
    if (!template?.id) return false;

    if (signatureType === "draw") {
      return !!signatureDataUrl && drawn;
    }

    if (signatureType === "typed") {
      return typedSignature.trim().length > 1;
    }

    if (signatureType === "upload") {
      if (!allowUpload) return false;
      return !!uploadDataUrl && !!uploadFileName && !!uploadFileType;
    }

    return false;
  }, [agreed, allowUpload, drawn, signatureDataUrl, signatureType, template?.id, typedSignature, uploadDataUrl, uploadFileName, uploadFileType]);

  useEffect(() => {
    if (!isSignatureValid || !template?.id) {
      onChange(null);
      return;
    }

    const payload: WaiverSignatureInput = {
      templateId: template.id,
      signatureType,
      signatureText: signatureType === "typed" ? typedSignature.trim() : undefined,
      signatureImageDataUrl: signatureType === "draw" ? signatureDataUrl || undefined : undefined,
      uploadFileDataUrl: signatureType === "upload" ? uploadDataUrl || undefined : undefined,
      uploadFileName: signatureType === "upload" ? uploadFileName || undefined : undefined,
      uploadFileType: signatureType === "upload" ? uploadFileType || undefined : undefined,
      signerName: signerName || undefined,
      signerEmail: signerEmail || undefined,
    };

    onChange(payload);
  }, [isSignatureValid, onChange, signatureType, signatureDataUrl, typedSignature, uploadDataUrl, uploadFileName, uploadFileType, signerName, signerEmail, template?.id]);

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-primary" />
          Waiver Agreement
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {template ? (
          <div className="rounded-lg border bg-background p-3 max-h-48 overflow-y-auto text-sm">
            <RichTextContent content={template.content} className="text-muted-foreground text-sm" />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
            Waiver template is loading. Please wait a moment.
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Signature Method</Label>
            {required && (
              <span className="text-xs text-muted-foreground">Required</span>
            )}
          </div>
          <RadioGroup
            value={signatureType}
            onValueChange={(value) => setSignatureType(value as WaiverSignatureType)}
            className="grid gap-2 sm:grid-cols-3"
          >
            <Label
              htmlFor="signature-draw"
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium cursor-pointer",
                signatureType === "draw" && "border-primary bg-primary/10"
              )}
            >
              <RadioGroupItem value="draw" id="signature-draw" />
              <PenTool className="h-4 w-4" />
              Draw
            </Label>
            <Label
              htmlFor="signature-typed"
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium cursor-pointer",
                signatureType === "typed" && "border-primary bg-primary/10"
              )}
            >
              <RadioGroupItem value="typed" id="signature-typed" />
              <Type className="h-4 w-4" />
              Type
            </Label>
            <Label
              htmlFor="signature-upload"
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium cursor-pointer",
                signatureType === "upload" && "border-primary bg-primary/10",
                !allowUpload && "opacity-50 cursor-not-allowed"
              )}
            >
              <RadioGroupItem value="upload" id="signature-upload" disabled={!allowUpload} />
              <FileText className="h-4 w-4" />
              Upload
            </Label>
          </RadioGroup>
        </div>

        {signatureType === "draw" && (
          <div className="space-y-2">
            <div ref={containerRef} className="rounded-lg border bg-background">
              <canvas
                ref={canvasRef}
                className="w-full touch-none cursor-crosshair"
                onPointerDown={startDrawing}
                onPointerMove={draw}
                onPointerUp={stopDrawing}
                onPointerLeave={stopDrawing}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Draw your signature above.</span>
              <Button type="button" variant="ghost" size="sm" onClick={clearSignature}>
                Clear
              </Button>
            </div>
          </div>
        )}

        {signatureType === "typed" && (
          <div className="space-y-2">
            <Input
              placeholder="Type your full name"
              value={typedSignature}
              onChange={(event) => setTypedSignature(event.target.value)}
            />
            {typedSignature.trim().length > 0 && (
              <div className="rounded-lg border bg-background px-4 py-3 text-lg font-semibold tracking-wide">
                {typedSignature}
              </div>
            )}
          </div>
        )}

        {signatureType === "upload" && (
          <div className="space-y-2">
            <Input
              type="file"
              accept={ACCEPTED_UPLOAD_TYPES.join(",")}
              onChange={(event) => handleUpload(event.target.files?.[0] ?? null)}
              disabled={!allowUpload}
            />
            <p className="text-xs text-muted-foreground">
              Upload a signed PDF or image (max 10 MB).
            </p>
            {uploadFileName && (
              <div className="rounded-lg border bg-background px-3 py-2 text-xs text-muted-foreground">
                Uploaded: <span className="font-medium text-foreground">{uploadFileName}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex items-start gap-2">
          <Checkbox
            id="waiver-agree"
            checked={agreed}
            onCheckedChange={(value) => setAgreed(Boolean(value))}
          />
          <Label htmlFor="waiver-agree" className="text-xs text-muted-foreground leading-relaxed">
            I have read and agree to the waiver above. My electronic signature is legally binding.
          </Label>
        </div>

        {required && !isSignatureValid && (
          <div className="text-xs text-muted-foreground">
            Complete the waiver and signature to continue.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
