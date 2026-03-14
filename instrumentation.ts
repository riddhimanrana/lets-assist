// ---------------------------------------------------------------------------
// Browser API polyfills for pdfjs-dist running in Node.js / serverless runtimes.
// These must be set up before pdfjs-dist is first required.
// ---------------------------------------------------------------------------
if (typeof globalThis.DOMMatrix === 'undefined') {
  class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true;
    isIdentity = true;

    constructor(init?: string | number[]) {
      if (Array.isArray(init)) {
        if (init.length === 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init;
          this.m11 = this.a; this.m12 = this.b;
          this.m21 = this.c; this.m22 = this.d;
          this.m41 = this.e; this.m42 = this.f;
        } else if (init.length === 16) {
          [this.m11, this.m12, this.m13, this.m14,
           this.m21, this.m22, this.m23, this.m24,
           this.m31, this.m32, this.m33, this.m34,
           this.m41, this.m42, this.m43, this.m44] = init;
          this.a = this.m11; this.b = this.m12;
          this.c = this.m21; this.d = this.m22;
          this.e = this.m41; this.f = this.m42;
        }
      }
    }
    multiply(_other: DOMMatrix): DOMMatrix { return new DOMMatrix(); }
    translate(tx = 0, ty = 0, _tz = 0): DOMMatrix {
      const m = new DOMMatrix();
      m.e = tx; m.f = ty; m.m41 = tx; m.m42 = ty;
      return m;
    }
    scale(scaleX = 1, scaleY?: number, _scaleZ = 1): DOMMatrix {
      const m = new DOMMatrix();
      m.a = scaleX; m.m11 = scaleX;
      m.d = scaleY ?? scaleX; m.m22 = scaleY ?? scaleX;
      return m;
    }
    rotate(_rotX = 0, _rotY?: number, _rotZ?: number): DOMMatrix { return new DOMMatrix(); }
    inverse(): DOMMatrix { return new DOMMatrix(); }
    transformPoint(point: { x?: number; y?: number; z?: number; w?: number } = {}) {
      return { x: point.x ?? 0, y: point.y ?? 0, z: point.z ?? 0, w: point.w ?? 1 };
    }
    toFloat32Array(): Float32Array {
      return new Float32Array([
        this.m11, this.m12, this.m13, this.m14,
        this.m21, this.m22, this.m23, this.m24,
        this.m31, this.m32, this.m33, this.m34,
        this.m41, this.m42, this.m43, this.m44,
      ]);
    }
    toFloat64Array(): Float64Array {
      return new Float64Array([
        this.m11, this.m12, this.m13, this.m14,
        this.m21, this.m22, this.m23, this.m24,
        this.m31, this.m32, this.m33, this.m34,
        this.m41, this.m42, this.m43, this.m44,
      ]);
    }
    toString(): string {
      return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
    }
    // Static factory used by pdfjs-dist internally
    static fromMatrix(other: Partial<DOMMatrix>): DOMMatrix {
      return new DOMMatrix([
        other.m11 ?? 1, other.m12 ?? 0, other.m13 ?? 0, other.m14 ?? 0,
        other.m21 ?? 0, other.m22 ?? 1, other.m23 ?? 0, other.m24 ?? 0,
        other.m31 ?? 0, other.m32 ?? 0, other.m33 ?? 1, other.m34 ?? 0,
        other.m41 ?? 0, other.m42 ?? 0, other.m43 ?? 0, other.m44 ?? 1,
      ]);
    }
    static fromFloat32Array(arr: Float32Array): DOMMatrix { return new DOMMatrix(Array.from(arr)); }
    static fromFloat64Array(arr: Float64Array): DOMMatrix { return new DOMMatrix(Array.from(arr)); }
  }
  (globalThis as Record<string, unknown>).DOMMatrix = DOMMatrix;
}

if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as Record<string, unknown>).Path2D = class Path2D {
    constructor(_path?: string | Path2D) {}
    addPath(_path: Path2D, _transform?: DOMMatrix) {}
    closePath() {}
    moveTo(_x: number, _y: number) {}
    lineTo(_x: number, _y: number) {}
    bezierCurveTo(_cp1x: number, _cp1y: number, _cp2x: number, _cp2y: number, _x: number, _y: number) {}
    quadraticCurveTo(_cpx: number, _cpy: number, _x: number, _y: number) {}
    arc(_x: number, _y: number, _radius: number, _startAngle: number, _endAngle: number, _anticlockwise?: boolean) {}
    arcTo(_x1: number, _y1: number, _x2: number, _y2: number, _radius: number) {}
    ellipse(_x: number, _y: number, _radiusX: number, _radiusY: number, _rotation: number, _startAngle: number, _endAngle: number, _anticlockwise?: boolean) {}
    rect(_x: number, _y: number, _width: number, _height: number) {}
    roundRect(_x: number, _y: number, _width: number, _height: number, _radii?: number | number[]) {}
  };
}

if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as Record<string, unknown>).ImageData = class ImageData {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly colorSpace: string = 'srgb';
    constructor(widthOrData: number | Uint8ClampedArray, height: number, _optionsOrWidth?: number | { colorSpace?: string }) {
      if (typeof widthOrData === 'number') {
        this.width = widthOrData;
        this.height = height;
        this.data = new Uint8ClampedArray(widthOrData * height * 4);
      } else {
        this.data = widthOrData;
        this.width = height; // second arg is width when first arg is data
        this.height = typeof _optionsOrWidth === 'number' ? _optionsOrWidth : widthOrData.length / (height * 4);
      }
    }
  };
}
// ---------------------------------------------------------------------------

import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { logs } from '@opentelemetry/api-logs'
import { resourceFromAttributes } from '@opentelemetry/resources'

// Create LoggerProvider outside register() so it can be exported and flushed in route handlers
const processors: BatchLogRecordProcessor[] = [];

// Only configure the PostHog OTLP exporter if a key is present
if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  processors.push(
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: 'https://us.i.posthog.com/i/v1/logs',
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_POSTHOG_KEY}`,
          'Content-Type': 'application/json',
        },
      })
    )
  );
} else {
  // Avoid leaking undefined Authorization headers when no key is configured
  // and make it obvious in logs that instrumentation is disabled.
  // Note: this is useful for local dev where you don't want to send logs.
  console.warn('[Instrumentation] NEXT_PUBLIC_POSTHOG_KEY not set — skipping PostHog log exporter');
}

export const loggerProvider = new LoggerProvider({
  resource: resourceFromAttributes({ 'service.name': 'lets-assist' }),
  processors,
})

export function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    logs.setGlobalLoggerProvider(loggerProvider)
  }
}
