import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { getChatGPTUser } from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";
const MAX_SIZE = 10 * 1024 * 1024;
const MAX_PAGES = 8;

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Fichier PDF manquant" }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ error: "Le fichier dépasse la taille maximale autorisée (10 Mo)." }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (!header.includes("%PDF-")) return Response.json({ error: "Le fichier ne correspond pas à un PDF valide." }, { status: 400 });

  try {
    const document = await pdfjs.getDocument({ data: bytes, disableWorker: true, isEvalSupported: false } as never).promise;
    if (document.numPages > MAX_PAGES) return Response.json({ error: `Le PDF dépasse la limite de ${MAX_PAGES} pages.` }, { status: 413 });
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? String(item.str) : "")).filter(Boolean).join(" "));
    }
    const text = pages.join("\n\n").replace(/[ \t]+/g, " ").trim();
    if (text.length < 80) return Response.json({ error: "Ce PDF ne contient pas assez de texte lisible." }, { status: 422 });
    return Response.json({ ok: true, text, pages: document.numPages, characters: text.length });
  } catch (error) {
    console.error("[Fala AI] server PDF extraction failed", error);
    return Response.json({ error: "Lecture du PDF impossible sur le serveur." }, { status: 422 });
  }
}
