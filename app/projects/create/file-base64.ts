/** Reads a file as a base64 data URL, the form the upload actions accept. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The file could not be read."));
    };
    reader.onerror = () => reject(reader.error);
  });
}
