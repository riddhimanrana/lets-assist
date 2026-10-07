/** Keep same-origin print previews, camera scanning and maps available. */
export function securityResponseHeaders(hosted: boolean) {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Referrer-Policy", value: "no-referrer" },
    {
      key: "Content-Security-Policy",
      value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
    },
    {
      key: "Permissions-Policy",
      value:
        "camera=(self), geolocation=(self), microphone=(), accelerometer=(), gyroscope=(), magnetometer=(), usb=(), serial=(), browsing-topics=()",
    },
  ];
  if (hosted)
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000",
    });
  return [{ source: "/:path*", headers }];
}
