// pdf.js ships no types for its worker, which only pdf.js itself reads.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
