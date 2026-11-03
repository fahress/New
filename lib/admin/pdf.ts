'use client';
/** Turns the pages of a PDF into JPEG files (page 1, page 2, …) in the browser, for presentation images. */
export async function pdfToImages(data: ArrayBuffer, baseName: string, opts: { maxPages?: number; width?: number; onPage?: (done: number, total: number) => void } = {}): Promise<File[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const total = Math.min(doc.numPages, opts.maxPages ?? 40);
  const width = opts.width ?? 2000;
  const files: File[] = [];
  const name = baseName.replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'specimen';
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob>((ok) => canvas.toBlob((b) => ok(b!), 'image/jpeg', 0.88));
    files.push(new File([blob], `${name}-page-${String(i).padStart(2, '0')}.jpg`, { type: 'image/jpeg' }));
    page.cleanup();
    opts.onPage?.(i, total);
  }
  await doc.destroy();
  return files;
}

export const isPdfLink = (u: string) => /\.pdf(\?|#|$)/i.test(u.split('#')[0]);
