declare module 'harfbuzzjs' {
  /**
   * The minimal HarfBuzzJS surface the shaper uses.
   *
   * The package ships no types; this is a hand-written declaration for the
   * subset the port touches, so the rest of the code stays typed.
   */
  export function createBlob(bytes: Uint8Array): unknown;
  export function createFace(blob: unknown): { upem: number };
  export function createFont(face: unknown): { setScale(x: number, y: number): void };
  export function createBuffer(): HarfBuzzBuffer;
  export function shape(
    font: unknown,
    buffer: HarfBuzzBuffer,
    features?: Record<string, unknown> | null,
  ): void;

  interface HarfBuzzBuffer {
    addText(text: string): void;
    clearContents(): void;
    guessSegmentProperties(): void;
    setScript(script: string): void;
    setDirection(direction: string): void;
    setLanguage(language: string): void;
    json(): Array<{
      g: number;
      cl: number;
      ax: number;
      ay: number;
      dx: number;
      dy: number;
      flags: number;
    }>;
  }
}
