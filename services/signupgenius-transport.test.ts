import { beforeEach, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { RequestOptions } from "node:https";

let answers = [{ address: "93.184.216.34", family: 4 }];
const requests: Array<{ url: URL; options: RequestOptions }> = [];
let canceled = false;

mock.module("node:dns/promises", () => ({
  lookup: async (hostname: string, options: { all: boolean }) => {
    expect(hostname).toBe("www.signupgenius.com");
    expect(options.all).toBe(true);
    return answers;
  },
}));
mock.module("node:https", () => ({
  request: (
    url: URL,
    options: RequestOptions,
    callback: (response: unknown) => void,
  ) => {
    requests.push({ url, options });
    const req = Object.assign(new EventEmitter(), {
      end() {
        callback({
          statusCode: 200,
          headers: { "content-type": "text/html" },
          async *[Symbol.asyncIterator]() {
            yield Buffer.from("<html>Fictional public event</html>");
          },
          destroy() {
            canceled = true;
          },
        });
      },
    });
    return req;
  },
}));

const { fetchPublicSignUpGenius } = await import("./signupgenius-fetch");
const source = "https://www.signupgenius.com/go/10C0B4CAEAD2EA6FEC34";

beforeEach(() => {
  answers = [{ address: "93.184.216.34", family: 4 }];
  requests.length = 0;
  canceled = false;
});

test("native HTTPS retains the TLS hostname and pins only the validated DNS address", async () => {
  await expect(fetchPublicSignUpGenius(source)).resolves.toEqual({
    html: "<html>Fictional public event</html>",
    sourceUrl: source,
  });
  expect(requests).toHaveLength(1);
  const { url, options } = requests[0];
  expect(url.href).toBe(source);
  expect(url.hostname).toBe("www.signupgenius.com");
  expect(options.agent).toBe(false);
  expect(options.family).toBe(4);
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(options.headers).toEqual({
    Accept: "text/html",
    "Accept-Encoding": "identity",
    "User-Agent": "LetsAssist-PublicEventImporter/1.0",
  });
  // A connection cannot trigger a fresh, potentially rebound DNS lookup.
  const lookup = options.lookup;
  expect(lookup).toBeFunction();
  const pinned = await new Promise((resolve, reject) => {
    lookup!("www.signupgenius.com", { family: 4 }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  expect(pinned).toEqual({ address: "93.184.216.34", family: 4 });
  expect(canceled).toBe(true);
});

test("native transport never opens a request for a private DNS result", async () => {
  answers = [{ address: "169.254.169.254", family: 4 }];
  await expect(fetchPublicSignUpGenius(source)).rejects.toMatchObject({
    code: "unsafe_address",
  });
  expect(requests).toHaveLength(0);
});
