/**
 * Content links: a link inside a sentence, or a standalone text link in page
 * content. The green is `--primary`, the step that carries small text.
 * `--brand` is decorative and never colours a link. The underline keeps a link
 * distinguishable without colour. The focus ring names `ring-primary` because
 * the dark `--ring` is not green.
 *
 * Not for navigation, buttons, or whole-card links.
 */
export const TEXT_LINK_CLASS =
  "text-primary decoration-primary/40 hover:decoration-primary focus-visible:ring-primary focus-visible:ring-offset-background rounded-sm font-medium underline underline-offset-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-2";
