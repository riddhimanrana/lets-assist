/**
 * Content links: a link inside a sentence, or a standalone text link in page
 * content. The green is `--content-link`, a token only this class reads, so
 * opting a link in never recolours another anchor, a button, or navigation.
 * `--brand` is decorative and never colours a link. The underline keeps a link
 * distinguishable without colour. The focus ring names `ring-content-link`
 * because the dark `--ring` is not green.
 *
 * Not for navigation, buttons, or whole-card links.
 */
export const TEXT_LINK_CLASS =
  "text-content-link decoration-content-link/40 hover:decoration-content-link focus-visible:ring-content-link focus-visible:ring-offset-background rounded-sm font-medium underline underline-offset-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-2";
