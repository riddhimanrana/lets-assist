import { ReleaseCheckError } from "./app-release-checks.mjs";

const previousFingerprint =
  "md5(p.prosrc)='13e8ee1bc7b071f00664f808b2cf504a'";
const explicitFillFingerprint =
  "md5(p.prosrc)='1e64a6a32f22099e11367757990182a0'";

export function csf598Catalog(previous) {
  if (previous.split(previousFingerprint).length !== 2)
    throw new ReleaseCheckError(
      "The reviewed CSF preview append function predecessor changed.",
    );
  return previous.replace(previousFingerprint, explicitFillFingerprint);
}
