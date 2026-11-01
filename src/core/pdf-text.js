// Pull positioned text out of a PDF, on this device, using pdf.js. The library is passed
// in because Node (tests) and the browser (the app) load it differently.

// Returns [{ items: [{ x, y, w, s }] }, ...], one entry per page. y grows up the page.
export async function extractPages(pdfjs, bytes) {
  const task = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false, // never run code generated from a file's contents
    verbosity: 0,
  });
  const doc = await task.promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const { items } = await (await doc.getPage(p)).getTextContent();
    pages.push({
      items: items
        .filter((it) => it.str?.trim()) // layout markers have no str
        .map((it) => ({ x: it.transform[4], y: it.transform[5], w: it.width, s: it.str.trim() })),
    });
  }
  await task.destroy();
  return pages;
}
