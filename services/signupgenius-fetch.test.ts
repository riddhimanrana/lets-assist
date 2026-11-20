import { expect, test } from "bun:test";
import {
  fetchPublicSignUpGenius,
  isPublicSourceAddress,
  MAX_SOURCE_BYTES,
  type SourceTransport,
  type SourceResponse,
} from "./signupgenius-fetch";

const url =
  "https://www.signupgenius.com/go/10C0B4CAEAD2EA6FEC34-67010857-science";
function reply(
  html = "<html>synthetic source</html>",
  status = 200,
  headers: Record<string, string> = {},
): SourceResponse {
  return {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
    body: (async function* () {
      yield Buffer.from(html);
    })(),
    cancel: () => {},
  };
}
function transport(response = reply()): SourceTransport {
  return {
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async () => response,
  };
}
for (const ip of [
  "127.0.0.1",
  "10.2.3.4",
  "172.16.0.1",
  "192.168.1.1",
  "169.254.169.254",
  "100.64.0.1",
  "0.0.0.0",
  "198.18.0.1",
  "192.0.2.1",
  "198.51.100.1",
  "203.0.113.1",
  "224.0.0.1",
  "255.255.255.255",
  "::1",
  "::",
  "fc00::1",
  "fe80::1",
  "::ffff:127.0.0.1",
  "2001:db8::1",
  "2002:7f00:1::",
  "not-an-ip",
])
  test(`refuses nonpublic address ${ip}`, () =>
    expect(isPublicSourceAddress(ip)).toBe(false));
test("permits globally routed addresses", () => {
  expect(isPublicSourceAddress("93.184.216.34")).toBe(true);
  expect(isPublicSourceAddress("2606:4700:4700::1111")).toBe(true);
});
test("fetches only canonical URLs and pins a validated address", async () => {
  const t = transport();
  let seen = "";
  t.request = async (u, address) => {
    seen = u.href;
    expect(address.address).toBe("93.184.216.34");
    return reply();
  };
  expect(await fetchPublicSignUpGenius(url, t)).toEqual({
    html: "<html>synthetic source</html>",
    sourceUrl: url,
  });
  expect(seen).toBe(url);
});
test("rejects all unsafe DNS answers before connecting", async () => {
  const t = transport();
  let called = false;
  t.resolve = async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ];
  t.request = async () => {
    called = true;
    return reply();
  };
  await expect(fetchPublicSignUpGenius(url, t)).rejects.toMatchObject({
    code: "unsafe_address",
  });
  expect(called).toBe(false);
});
for (const location of [
  "http://www.signupgenius.com/go/10C0B4CAEAD2EA6FEC34",
  "https://evil.test/",
  "https://127.0.0.1/",
  "https://www.signupgenius.com/admin",
  "https://user@www.signupgenius.com/go/10C0B4CAEAD2EA6FEC34",
])
  test(`blocks redirect ${location}`, async () => {
    await expect(
      fetchPublicSignUpGenius(url, transport(reply("", 302, { location }))),
    ).rejects.toMatchObject({ code: "redirect" });
  });
test("revalidates DNS on allowed redirects", async () => {
  const t = transport(reply("", 302, { location: "/go/10C0B4CAEAD2EA6FEC34" }));
  let resolutions = 0;
  t.resolve = async () => [
    { address: ++resolutions === 1 ? "93.184.216.34" : "10.0.0.1", family: 4 },
  ];
  await expect(fetchPublicSignUpGenius(url, t)).rejects.toMatchObject({
    code: "unsafe_address",
  });
  expect(resolutions).toBe(2);
});
test("caps redirect chains", async () =>
  await expect(
    fetchPublicSignUpGenius(url, transport(reply("", 302, { location: url }))),
  ).rejects.toMatchObject({ code: "redirect" }));
test("bounds declared and streamed source size", async () => {
  await expect(
    fetchPublicSignUpGenius(
      url,
      transport(
        reply("", 200, { "content-length": String(MAX_SOURCE_BYTES + 1) }),
      ),
    ),
  ).rejects.toMatchObject({ code: "too_large" });
  await expect(
    fetchPublicSignUpGenius(
      url,
      transport(reply("x".repeat(MAX_SOURCE_BYTES + 1))),
    ),
  ).rejects.toMatchObject({ code: "too_large" });
});
test("bounds DNS and stalled response body duration and cancels", async () => {
  const t = transport();
  t.resolve = () => new Promise(() => {});
  await expect(fetchPublicSignUpGenius(url, t, 5)).rejects.toMatchObject({
    code: "timeout",
  });
  let canceled = false;
  const r = reply();
  r.cancel = () => {
    canceled = true;
  };
  r.body = {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
  };
  await expect(
    fetchPublicSignUpGenius(url, transport(r), 5),
  ).rejects.toMatchObject({ code: "timeout" });
  expect(canceled).toBe(true);
});
for (const [r, code] of [
  [reply("", 403), "unavailable"],
  [reply("", 200, { "content-type": "application/json" }), "unsupported"],
  [reply("Checking your browser"), "challenge"],
  [reply("", 200, { "content-encoding": "gzip" }), "unsupported"],
] as const)
  test(`handles source refusal ${code}`, async () =>
    await expect(
      fetchPublicSignUpGenius(url, transport(r)),
    ).rejects.toMatchObject({ code }));
