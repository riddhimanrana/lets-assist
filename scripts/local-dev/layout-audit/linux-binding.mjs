import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  binding = require("./linux-binding.cjs");
export const BINDING = binding.load();
export const REPO = BINDING.repoRoot;
export const requireLiveBinding = () => binding.live(BINDING);
