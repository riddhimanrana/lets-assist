"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Eraser, PenTool, Type, Upload } from "lucide-react";
import { WaiverDefinitionSigner, SignerData } from "@/types/waiver-definitions";
import { useTheme } from "next-themes";

const SIGNATURE_CANVAS_HEIGHT = 160;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg"];

interface SignatureCaptureProps {
  signerRole: WaiverDefinitionSigner;
  onSignatureComplete: (signature: SignerData | null) => void;
  existingSignature?: SignerData;
  userName?: string;
  allowUpload?: boolean; // Phase 1: Control upload tab visibility
}

export function SignatureCapture({
  signerRole,
  onSignatureComplete,
  existingSignature,
  userName,
  allowUpload = true, // Phase 1: Default true for backward compatibility
}: SignatureCaptureProps) {
  // Phase 1: Gracefully handle case where existingSignature.method is "upload" but allowUpload is false
  // Fall back to "draw" in this case to avoid selecting a non-existent tab
  const initialMethod = existingSignature?.method && 
    (existingSignature.method !== 'upload' || allowUpload)
    ? (existingSignature.method as "draw" | "typed" | "upload")
    : "draw";
    
  const [method, setMethod] = useState<"draw" | "typed" | "upload">(initialMethod);
  const [drawn, setDrawn] = useState(false);
  const [typedValue, setTypedValue] = useState(existingSignature?.method === "typed" ? existingSignature.data : (userName || ""));
  const [uploadDataUrl, setUploadDataUrl] = useState<string | null>(existingSignature?.method === "upload" ? existingSignature.data : null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  
  const { theme, resolvedTheme } = useTheme();

  // Get stroke color based on theme
  const getStrokeColor = () => {
    // resolvedTheme is the actual applied theme (light or dark)
    const currentTheme = resolvedTheme || theme || 'light';
    return currentTheme === 'dark' ? '#ffffff' : '#000000';
  };

  // Initialize canvas only if method is draw
  useEffect(() => {
    if (method === "draw") {
      resizeCanvas();
      window.addEventListener("resize", resizeCanvas);
      return () => window.removeEventListener("resize", resizeCanvas);
    }
  }, [method, resolvedTheme]); // Re-initialize when theme changes

  const emitSignature = (data: string | null, sigMethod: "draw" | "typed" | "upload") => {
    if (data) {
        onSignatureComplete({
            role_key: signerRole.role_key,
            method: sigMethod,
            data,
            timestamp: new Date().toISOString(),
            signer_name: sigMethod === "typed" ? data : userName // For typed, the signature IS the name
        });
    } else {
        onSignatureComplete(null);
    }
  };

  useEffect(() => {
     if (method === "typed") {
         emitSignature(typedValue.trim().length > 1 ? typedValue.trim() : null, "typed");
     } else if (method === "upload") {
         emitSignature(uploadDataUrl || null, "upload");
     } else if (method === "draw") {
         // If we switch to draw and stick with previous state (which is empty initially), we might want to emit null if not drawn
         // BUT we rely on stopDrawing to emit.
         // If we switch TABS, we should probably emit current state of that tab.
         // If drawn is false, emit null.
         if (!drawn) emitSignature(null, "draw");
         // If drawn is true, we should re-emit what's on canvas... but canvas might be cleared or not ready. 
         // Since we don't persist canvas state across tab switching easily, we accept it clears.
     }
  }, [method, typedValue, uploadDataUrl, drawn]);


  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ratio = window.devicePixelRatio || 1;
    const width = container.clientWidth;

    canvas.width = width * ratio;
    canvas.height = SIGNATURE_CANVAS_HEIGHT * ratio;
    canvas.style.width = `100%`;
    canvas.style.height = `${SIGNATURE_CANVAS_HEIGHT}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 2.5; // Slightly thicker for better visibility
      ctx.lineCap = "round";
      ctx.strokeStyle = getStrokeColor(); // Dynamic color based on theme
    }
    setDrawn(false); // Reset drawn state on resize as canvas is cleared
    emitSignature(null, "draw");
  };

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

    // Ensure stroke color is up to date
    ctx.strokeStyle = getStrokeColor();
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";

    drawingRef.current = true;
    const point = getCanvasPoint(event);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
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

  const stopDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    
    // Save signature
    const canvas = canvasRef.current;
    if (canvas) {
        emitSignature(canvas.toDataURL("image/png"), "draw");
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setDrawn(false);
    emitSignature(null, "draw");
  };

  const handleUpload = (file: File | null) => {
    if (!file) {
      setUploadDataUrl(null);
      setUploadError(null);
      return;
    }

    // Phase 1: Only accept image types for signature upload
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setUploadError("Please upload an image (PNG, JPG) for your signature.");
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError("File is too large. Maximum size is 10 MB.");
      return;
    }

    setUploadError(null);
    const reader = new FileReader();
    reader.onload = () => {
      setUploadDataUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>Signature for <span className="font-semibold text-primary">{signerRole.label}</span></Label>
        {signerRole.required && <span className="text-xs text-muted-foreground">Required</span>}
      </div>

      <Tabs value={method} onValueChange={(v) => { 
          setMethod(v as "draw" | "typed" | "upload");
      }} className="w-full">
        <TabsList className={`grid w-full ${allowUpload ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <TabsTrigger value="draw" className="flex gap-2"><PenTool className="h-4 w-4" /> Draw</TabsTrigger>
          <TabsTrigger value="typed" className="flex gap-2"><Type className="h-4 w-4" /> Type</TabsTrigger>
          {/* Phase 1: Only show upload tab when explicitly allowed */}
          {allowUpload && (
            <TabsTrigger value="upload" className="flex gap-2"><Upload className="h-4 w-4" /> Upload</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="draw" className="space-y-2 mt-4">
           <div ref={containerRef} className="rounded-lg border bg-background relative overflow-hidden">
            <canvas
              ref={canvasRef}
              className="w-full touch-none cursor-crosshair block"
              style={{ height: SIGNATURE_CANVAS_HEIGHT }}
              onPointerDown={startDrawing}
              onPointerMove={draw}
              onPointerUp={stopDrawing}
              
              onPointerCancel={stopDrawing}
            />
          </div>
          <div className="flex justify-between items-center">
            <p className="text-xs text-muted-foreground">Sign with your mouse or finger</p>
            <Button variant="ghost" size="sm" onClick={clearSignature} className="h-8">
              <Eraser className="h-3 w-3 mr-1" /> Clear
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="typed" className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="type-sig">Full Name</Label>
            <Input 
              id="type-sig"
              placeholder="Start typing your name..." 
              value={typedValue}
              onChange={(e) => setTypedValue(e.target.value)}
            />
          </div>
          {typedValue.trim() && (
            <div className="p-6 border rounded-lg bg-background text-center">
              <p className="font-signature text-3xl italic">{typedValue}</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
             I understand this typed name constitutes a legal signature.
          </p>
        </TabsContent>

        {/* Phase 1: Only render upload tab content when allowed */}
        {allowUpload && (
          <TabsContent value="upload" className="space-y-4 mt-4">
            <div className="flex flex-col gap-3">
              <Label htmlFor="upload-sig">Upload Signature Image</Label>
              <Input 
                id="upload-sig"
                type="file" 
                accept={ACCEPTED_IMAGE_TYPES.join(",")}
                onChange={(e) => handleUpload(e.target.files?.[0] || null)}
              />
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
            
            {uploadDataUrl && !uploadError && (
               <div className="p-3 border rounded-lg bg-green-50/50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-sm flex items-center gap-2">
                  <span className="font-medium">✓ File selected</span>
               </div>
            )}
             <p className="text-xs text-muted-foreground">
              Upload a PNG or JPG image of your signature. Max size 10MB.
            </p>
          </div>
        </TabsContent>
        )}
      </Tabs>
    </div>
  );
}