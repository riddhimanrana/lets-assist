/**
 * Just enough DOM for `react-dom/client` to mount, update and unmount a small
 * component tree in Bun, so tests can prove real React lifecycle behavior
 * (effects, cleanup on unmount, event handlers) without a browser or a new
 * dependency. It does no layout, styling or focus management, so it proves
 * nothing about those.
 */

type Listener = (event: MinimalEvent) => void;

class MinimalEvent {
  defaultPrevented = false;
  propagationStopped = false;
  target: MinimalNode | null = null;
  currentTarget: MinimalNode | null = null;
  readonly timeStamp = Date.now();
  constructor(
    readonly type: string,
    readonly init: { bubbles?: boolean; key?: string } = {},
  ) {}
  get bubbles() {
    return this.init.bubbles ?? true;
  }
  get key() {
    return this.init.key;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {
    this.propagationStopped = true;
  }
}

class MinimalNode {
  childNodes: MinimalNode[] = [];
  parentNode: MinimalNode | null = null;
  private listeners = new Map<string, Set<Listener>>();
  constructor(
    readonly nodeType: number,
    readonly nodeName: string,
    public ownerDocument: MinimalDocument | null,
  ) {}
  get firstChild(): MinimalNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): MinimalNode | null {
    return this.childNodes.at(-1) ?? null;
  }
  get nextSibling(): MinimalNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }
  set textContent(value: string) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (value) this.appendChild(new MinimalText(value, this.ownerDocument));
  }
  appendChild<T extends MinimalNode>(child: T): T {
    child.parentNode?.removeChild(child);
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }
  insertBefore<T extends MinimalNode>(child: T, before: MinimalNode | null): T {
    if (!before) return this.appendChild(child);
    child.parentNode?.removeChild(child);
    this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild<T extends MinimalNode>(child: T): T {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  contains(node: MinimalNode | null): boolean {
    for (let current = node; current; current = current.parentNode) {
      if (current === this) return true;
    }
    return false;
  }
  getRootNode(): MinimalNode {
    return this.parentNode ? this.parentNode.getRootNode() : this;
  }
  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatchEvent(event: MinimalEvent) {
    event.target ??= this;
    this.deliver(event);
    return !event.defaultPrevented;
  }
  /** Runs this node's listeners, then bubbles to the parent. */
  private deliver(event: MinimalEvent) {
    event.currentTarget = this;
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event);
    }
    if (event.bubbles && !event.propagationStopped) {
      this.parentNode?.deliver(event);
    }
  }
}

class MinimalText extends MinimalNode {
  constructor(
    public data: string,
    ownerDocument: MinimalDocument | null,
  ) {
    super(3, "#text", ownerDocument);
  }
  get nodeValue() {
    return this.data;
  }
  set nodeValue(value: string) {
    this.data = value;
  }
  override get textContent() {
    return this.data;
  }
  override set textContent(value: string) {
    this.data = value;
  }
}

class MinimalElement extends MinimalNode {
  attributes = new Map<string, string>();
  style: Record<string, string> & {
    setProperty: (name: string, value: string) => void;
    removeProperty: (name: string) => void;
  };
  readonly namespaceURI: string;
  readonly tagName: string;
  constructor(
    tagName: string,
    ownerDocument: MinimalDocument | null,
    namespaceURI = "http://www.w3.org/1999/xhtml",
  ) {
    super(1, tagName.toUpperCase(), ownerDocument);
    this.tagName = tagName.toUpperCase();
    this.namespaceURI = namespaceURI;
    const style: Record<string, string> = {};
    this.style = Object.assign(style, {
      setProperty: (name: string, value: string) => {
        style[name] = value;
      },
      removeProperty: (name: string) => {
        delete style[name];
      },
    });
  }
  get localName() {
    return this.tagName.toLowerCase();
  }
  /** HTML elements lowercase attribute names, as the real DOM does. */
  private attributeName(name: string) {
    return this.namespaceURI === "http://www.w3.org/1999/xhtml"
      ? name.toLowerCase()
      : name;
  }
  setAttribute(name: string, value: unknown) {
    this.attributes.set(this.attributeName(name), String(value));
  }
  setAttributeNS(_ns: string | null, name: string, value: unknown) {
    this.setAttribute(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(this.attributeName(name)) ?? null;
  }
  hasAttribute(name: string) {
    return this.attributes.has(this.attributeName(name));
  }
  removeAttribute(name: string) {
    this.attributes.delete(this.attributeName(name));
  }
  removeAttributeNS(_ns: string | null, name: string) {
    this.removeAttribute(name);
  }
  get children() {
    return this.childNodes.filter(
      (node): node is MinimalElement => node instanceof MinimalElement,
    );
  }
  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  blur() {
    if (this.ownerDocument?.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
  }
  getBoundingClientRect() {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    };
  }
  matches() {
    return false;
  }
  closest() {
    return null;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  /** Depth-first search by predicate, for test lookups. */
  find(predicate: (element: MinimalElement) => boolean): MinimalElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const nested = child.find(predicate);
      if (nested) return nested;
    }
    return null;
  }
}

/** Form controls keep `value`, `disabled` and `readOnly` as properties. */
class MinimalFormElement extends MinimalElement {
  private currentValue = "";
  type = "";
  // Reflected like the real DOM, since React writes these as attributes.
  get disabled() {
    return this.hasAttribute("disabled");
  }
  set disabled(next: boolean) {
    if (next) this.setAttribute("disabled", "");
    else this.removeAttribute("disabled");
  }
  get readOnly() {
    return this.hasAttribute("readonly");
  }
  set readOnly(next: boolean) {
    if (next) this.setAttribute("readonly", "");
    else this.removeAttribute("readonly");
  }
  checked = false;
  private dirty = false;
  // Until `value` is written, it reads the default, as in the real DOM.
  get value() {
    return this.dirty ? this.currentValue : this.defaultValue;
  }
  set value(next: string) {
    this.dirty = true;
    this.currentValue = String(next);
  }
  get defaultValue() {
    return this.tagName === "TEXTAREA"
      ? this.textContent
      : (this.getAttribute("value") ?? "");
  }
  set defaultValue(next: string) {
    if (this.tagName === "TEXTAREA") this.textContent = String(next);
    else this.setAttribute("value", next);
  }
}

class MinimalDocument extends MinimalNode {
  activeElement: MinimalElement | null = null;
  // React probes `"oninput" in document` to pick its change-event path.
  oninput = null;
  onchange = null;
  readonly documentElement: MinimalElement;
  readonly body: MinimalElement;
  readonly head: MinimalElement;
  defaultView: typeof globalThis | null = null;
  constructor() {
    super(9, "#document", null);
    this.ownerDocument = null;
    this.documentElement = new MinimalElement("html", this);
    this.head = new MinimalElement("head", this);
    this.body = new MinimalElement("body", this);
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }
  createElement(tagName: string) {
    const lower = tagName.toLowerCase();
    return ["input", "textarea", "select", "button", "option"].includes(lower)
      ? new MinimalFormElement(lower, this)
      : new MinimalElement(lower, this);
  }
  createElementNS(namespaceURI: string, tagName: string) {
    return new MinimalElement(tagName, this, namespaceURI);
  }
  createTextNode(data: string) {
    return new MinimalText(data, this);
  }
  createComment(data: string) {
    const node = new MinimalText(data, this);
    return Object.assign(node, { nodeType: 8 });
  }
  getElementById() {
    return null;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  hasFocus() {
    return true;
  }
}

let installed: { document: MinimalDocument } | null = null;

/**
 * Installs the shim on `globalThis` once per test process. Call before
 * importing `react-dom/client`.
 */
export function installMinimalDom() {
  if (installed) return installed;
  const document = new MinimalDocument();
  const g = globalThis as Record<string, unknown>;
  document.defaultView = globalThis;
  Object.assign(g, {
    window: globalThis,
    document,
    navigator: g.navigator ?? { userAgent: "bun-minimal-dom" },
    Node: MinimalNode,
    Element: MinimalElement,
    HTMLElement: MinimalElement,
    SVGElement: MinimalElement,
    HTMLIFrameElement: class HTMLIFrameElement extends MinimalElement {},
    HTMLInputElement: MinimalFormElement,
    HTMLTextAreaElement: MinimalFormElement,
    Text: MinimalText,
    Event: MinimalEvent,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }),
    requestAnimationFrame: (callback: (time: number) => void) =>
      setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (handle: ReturnType<typeof setTimeout>) =>
      clearTimeout(handle),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  installed = { document };
  return installed;
}

export type { MinimalElement, MinimalFormElement };

/** Dispatches a bubbling event of `type` on `target`, as React listens for it. */
export function fireEvent(
  target: MinimalElement,
  type: string,
  init: { key?: string } = {},
) {
  return target.dispatchEvent(
    new MinimalEvent(type, { bubbles: true, ...init }),
  );
}
