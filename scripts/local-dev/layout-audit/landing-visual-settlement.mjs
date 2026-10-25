// Public landing view settlement only. Existing request/effect guards stay active.
export const LANDING_LIMITS = Object.freeze({ steps: 48, milliseconds: 20000 });
const SECTIONS = ["partners", "check-in", "org-tooling", "cta"];
export function landingSettlementScope(entry, baseURL, currentURL) {
  const base = new URL(baseURL),
    current = new URL(currentURL);
  return (
    entry?.id === "landing-baseline" &&
    !entry.actorKey &&
    entry.route === "/?noRedirect=1" &&
    JSON.stringify(entry.expectedRoutes) ===
      JSON.stringify(["/?noRedirect=1"]) &&
    base.origin === "http://127.0.0.1:3000" &&
    base.pathname === "/" &&
    !base.search &&
    !base.hash &&
    !base.username &&
    !base.password &&
    current.origin === base.origin &&
    current.pathname + current.search === entry.route &&
    !current.hash &&
    !current.username &&
    !current.password
  );
}
export function landingSnapshotReason(s) {
  if (
    !s ||
    ![s.height, s.viewport, s.top].every(Number.isFinite) ||
    s.height < 1 ||
    s.viewport < 1 ||
    s.top < 0 ||
    ![
      s.foreignImages,
      s.failedImages,
      s.pendingImages,
      s.missingSections,
    ].every((n) => Number.isInteger(n) && n >= 0) ||
    ![s.footer, s.footerVisited, s.reveal, s.fonts, s.focusCleared].every(
      (v) => typeof v === "boolean",
    )
  )
    return "invalid-layout";
  if (s.foreignImages) return "nonlocal-image";
  if (s.failedImages) return "image-failed";
  if (!s.footer || s.missingSections) return "missing-sections";
  if (!s.reveal) return "reveal-pending";
  if (!s.fonts || s.pendingImages) return "assets-pending";
  return null;
}
export async function settleLandingVisual(page, entry, baseURL) {
  const result = {
    status: "unsettled",
    reason: "scope",
    steps: 0,
    documentHeight: 0,
    topRestored: false,
    focusCleared: false,
  };
  try {
    if (!landingSettlementScope(entry, baseURL, page.url())) return result;
  } catch {
    return result;
  }
  const deadline = Date.now() + LANDING_LIMITS.milliseconds;
  const bounded = async (task) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Error("deadline");
    let timer;
    try {
      return await Promise.race([
        task(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error("deadline")), remaining);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const reset = () =>
    bounded(() =>
      page.evaluate(() => {
        document.activeElement?.blur?.();
        const nodes = [...document.querySelectorAll("*")];
        if (nodes.length > 20000) return false;
        let resets = 0;
        for (const node of nodes)
          if (node.scrollTop || node.scrollLeft) {
            if (++resets > 64) return false;
            node.scrollTo?.({ top: 0, left: 0, behavior: "instant" });
          }
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
        return true;
      }),
    );
  const snapshot = (allImages = false) =>
    bounded(() =>
      page.evaluate(
        async ({ origin, sections, allImages }) => {
          const timed = async (promise) => {
            let timer;
            try {
              return await Promise.race([
                promise.then(
                  () => true,
                  () => false,
                ),
                new Promise((resolve) => {
                  timer = setTimeout(() => resolve(false), 1000);
                }),
              ]);
            } finally {
              clearTimeout(timer);
            }
          };
          await timed(document.fonts.ready);
          const shown = (node) => {
            const box = node.getBoundingClientRect();
            if (
              !box.width ||
              !box.height ||
              box.right <= 0 ||
              box.left >= innerWidth
            )
              return false;
            if (!allImages && (box.bottom <= 0 || box.top >= innerHeight))
              return false;
            for (let p = node; p; p = p.parentElement) {
              const style = getComputedStyle(p);
              if (style.visibility === "hidden" || style.display === "none")
                return false;
              if (
                p !== node &&
                /hidden|clip|auto|scroll/u.test(
                  style.overflowY + style.overflowX,
                )
              ) {
                const clip = p.getBoundingClientRect();
                if (
                  box.right <= clip.left ||
                  box.left >= clip.right ||
                  box.bottom <= clip.top ||
                  box.top >= clip.bottom
                )
                  return false;
              }
            }
            return true;
          };
          const images = [...document.images].filter(shown);
          let foreignImages = 0,
            failedImages = 0,
            pendingImages = 0;
          if (images.length > 64) pendingImages++;
          else
            await Promise.all(
              images.map(async (image) => {
                let u;
                try {
                  u = new URL(image.currentSrc || image.src, location.href);
                } catch {
                  foreignImages++;
                  return;
                }
                if (
                  u.origin !== origin ||
                  u.protocol !== "http:" ||
                  u.username ||
                  u.password
                ) {
                  foreignImages++;
                  return;
                }
                if (!(await timed(image.decode()))) {
                  if (image.complete && !image.naturalWidth) failedImages++;
                  else pendingImages++;
                }
              }),
            );
          const footer = document
              .querySelector('footer nav[aria-label="Footer"]')
              ?.closest("footer"),
            org = document.querySelector(
              "#org-tooling .relative.mx-auto.mt-12.w-full.max-w-6xl",
            ),
            footerBox = footer?.getBoundingClientRect(),
            orgBox = org?.getBoundingClientRect(),
            active = document.activeElement;
          return {
            height: document.documentElement.scrollHeight,
            viewport: innerHeight,
            top: scrollY,
            fonts: document.fonts.status === "loaded",
            foreignImages,
            failedImages,
            pendingImages,
            footer:
              !!footer &&
              !!footerBox.height &&
              getComputedStyle(footer).visibility !== "hidden" &&
              Number(getComputedStyle(footer).opacity) >= 0.99,
            footerVisited:
              !!footer && footerBox.top < innerHeight && footerBox.bottom > 0,
            missingSections: sections.filter(
              (id) => !document.getElementById(id)?.getClientRects().length,
            ).length,
            reveal:
              !!org &&
              !!orgBox.width &&
              !!orgBox.height &&
              getComputedStyle(org).visibility !== "hidden" &&
              Number(getComputedStyle(org).opacity) >= 0.99,
            focusCleared:
              !active ||
              active === document.body ||
              active === document.documentElement,
          };
        },
        { origin: new URL(baseURL).origin, sections: SECTIONS, allImages },
      ),
    );
  try {
    if (!(await reset())) {
      result.reason = "reset-cap";
      return result;
    }
    let previousHeight = 0,
      stable = 0,
      walkSettled = false;
    for (let i = 0; i < LANDING_LIMITS.steps; i++) {
      if (!landingSettlementScope(entry, baseURL, page.url())) {
        result.reason = "scope";
        return result;
      }
      const s = await snapshot();
      result.steps = i + 1;
      result.documentHeight = s.height;
      const reason = landingSnapshotReason(s);
      if (
        reason === "invalid-layout" ||
        reason === "nonlocal-image" ||
        reason === "image-failed"
      ) {
        result.reason = reason;
        return result;
      }
      const bottom = s.top + s.viewport >= s.height - 2;
      stable =
        bottom && s.footerVisited && !reason && s.height === previousHeight
          ? stable + 1
          : 0;
      if (stable >= 3) {
        walkSettled = true;
        break;
      }
      previousHeight = s.height;
      const next = Math.min(
        Math.max(0, s.height - s.viewport),
        s.top + Math.max(1, Math.floor(s.viewport * 0.7)),
      );
      await bounded(() =>
        page.evaluate(
          (top) => window.scrollTo({ top, left: 0, behavior: "instant" }),
          next,
        ),
      );
      await bounded(() => page.waitForTimeout(160));
    }
    if (!walkSettled) {
      result.reason = "step-cap-or-unstable";
      return result;
    }
    if (!(await reset())) {
      result.reason = "reset-cap";
      return result;
    }
    for (let i = 0; i < 2; i++) {
      await bounded(() => page.waitForTimeout(180));
      const s = await snapshot(true),
        reason = landingSnapshotReason(s);
      result.topRestored = s.top === 0;
      result.focusCleared = s.focusCleared;
      if (
        reason ||
        s.height !== previousHeight ||
        !result.topRestored ||
        !result.focusCleared
      ) {
        result.reason = reason ?? "height-or-view-changing";
        return result;
      }
    }
    if (!landingSettlementScope(entry, baseURL, page.url())) {
      result.reason = "scope";
      return result;
    }
    result.status = "settled";
    result.reason = null;
    return result;
  } catch (error) {
    result.reason = error?.message === "deadline" ? "time-cap" : "evaluation";
    return result;
  }
}
