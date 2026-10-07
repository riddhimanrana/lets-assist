export function mountCertificatePrintFrame(
  html: string,
  onError: (error: unknown) => void,
  target: Document = document,
): () => void {
  const frame = target.createElement("iframe");
  frame.title = "Certificate print preview";
  frame.style.position = "absolute";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.visibility = "hidden";
  let disposed = false;
  let started = false;
  let printWindow: Window | null = null;

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    frame.onload = null;
    printWindow?.removeEventListener("afterprint", cleanup);
    frame.remove();
  };
  frame.onload = () => {
    if (disposed || started) return;
    started = true;
    try {
      printWindow = frame.contentWindow;
      if (!printWindow)
        throw new Error("Certificate print window is unavailable.");
      printWindow.addEventListener("afterprint", cleanup, { once: true });
      printWindow.focus();
      printWindow.print();
    } catch (error) {
      cleanup();
      onError(error);
    }
  };
  frame.srcdoc = html;
  target.body.appendChild(frame);
  return cleanup;
}
