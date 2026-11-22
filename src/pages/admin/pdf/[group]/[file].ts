import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { APIRoute, GetStaticPaths } from "astro";

const pdfAssets = ["cmaps", "standard_fonts", "wasm", "iccs"];
const language = "spa.traineddata.gz";

export const prerender = true;

export const getStaticPaths = (async () => {
  const pdfRoot = join(process.cwd(), "node_modules", "pdfjs-dist");
  const paths = await Promise.all(pdfAssets.map(async group => {
    const base = join(pdfRoot, group);
    const files = (await readdir(base)).filter(file => /\.(?:bcmap|pfb|ttf|wasm|js|icc)$/i.test(file));
    return files.map(file => ({ params: { group, file }, props: { asset: join(base, file) } }));
  }));
  return [...paths.flat(), {
    params: { group: "ocr", file: language },
    props: { asset: join(process.cwd(), "node_modules", "@tesseract.js-data", "spa", "4.0.0_best_int", language) },
  }];
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props, params }) => {
  const type = params.file?.endsWith(".wasm") ? "application/wasm"
    : params.file?.endsWith(".js") ? "text/javascript" : "application/octet-stream";
  const bytes = await readFile(props.asset);
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": type } });
};
