import { useState } from 'react';
import { detectPdfWidgets, type PdfFieldDetectionResult } from '@/lib/waiver/pdf-field-detect';

export function usePdfFieldDetection() {
  const [isDetecting, setIsDetecting] = useState(false);
  const [result, setResult] = useState<PdfFieldDetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const detectFields = async (file: File): Promise<PdfFieldDetectionResult | null> => {
    setIsDetecting(true);
    setError(null);

    try {
      const detectionResult = await detectPdfWidgets(file);
      setResult(detectionResult);
      return detectionResult;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to detect PDF fields';
      setError(errorMessage);
      console.error('PDF field detection error:', err);
      return null;
    } finally {
      setIsDetecting(false);
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
    setIsDetecting(false);
  };

  return {
    detectFields,
    isDetecting,
    result,
    error,
    reset,
  };
}
