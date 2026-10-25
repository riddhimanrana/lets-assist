// Serialized into the owned page. No HTML, text, selectors or raw axe data leave it.
export async function readAxeRows({ includeColorDetails = false } = {}) {
  const result = await window.axe.run(document, {
    resultTypes: ["violations"],
  });
  const hex = (value) =>
    typeof value === "string" && /^#[a-f0-9]{6}$/iu.test(value)
      ? value.toLowerCase()
      : null;
  const ratio = (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 21
      ? value
      : null;
  const expected = (value) => {
    if (typeof value === "number") return ratio(value);
    if (
      typeof value !== "string" ||
      !/^[0-9]{1,2}(?:\.[0-9]{1,3})?:1$/u.test(value)
    )
      return null;
    return ratio(Number(value.slice(0, -2)));
  };
  const tags = new Set([
    "a",
    "button",
    "input",
    "label",
    "span",
    "p",
    "div",
    "td",
    "th",
    "h1",
    "h2",
    "h3",
    "svg",
    "li",
  ]);
  const detail = (node) => {
    let element = null;
    try {
      if (
        Array.isArray(node.target) &&
        node.target.length === 1 &&
        typeof node.target[0] === "string" &&
        node.target[0].length <= 2048
      )
        element = document.querySelector(node.target[0]);
    } catch {
      /* Unknown selector remains an unknown region/tag. */
    }
    let region = "other";
    if (element) {
      for (const [selector, name] of [
        ["#partners", "partners"],
        ["#check-in", "check-in"],
        ["#journey", "journey"],
        ["#org-tooling", "org-tooling"],
        ["#cta", "cta"],
        ["#live-demo", "hero"],
        ['[data-slot="badge"]', "badge"],
        ['[data-slot="alert-description"]', "alert-description"],
      ])
        if (element.closest(selector)) {
          region = name;
          break;
        }
      if (region === "other") {
        if (element.closest("footer")) region = "footer";
        else if (element.closest("header")) region = "header";
        else if (element.closest("main")) region = "main";
      }
    }
    const tag =
      typeof element?.tagName === "string"
        ? element.tagName.toLowerCase()
        : "other";
    const check = [node.any, node.all, node.none]
        .flatMap((list) => (Array.isArray(list) ? list.slice(0, 16) : []))
        .find((value) => value?.id === "color-contrast"),
      data = check?.data;
    return {
      region,
      tag: tags.has(tag) ? tag : "other",
      foreground: hex(data?.fgColor),
      background: hex(data?.bgColor),
      contrastRatio: ratio(data?.contrastRatio),
      expectedRatio: expected(data?.expectedContrastRatio),
    };
  };
  return result.violations.map((violation) => {
    const row = {
      id: violation.id,
      impact: violation.impact,
      nodeCount: violation.nodes.length,
    };
    if (includeColorDetails === true && violation.id === "color-contrast") {
      row.colorDetails = violation.nodes.slice(0, 8).map(detail);
      row.colorDetailsTruncated = violation.nodes.length > 8;
    }
    return row;
  });
}
