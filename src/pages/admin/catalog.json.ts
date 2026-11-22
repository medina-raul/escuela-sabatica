import type { APIRoute } from "astro";
import { loadSnapshot } from "../../../cms/lib/catalog.mjs";
import { publicCatalog } from "../../../cms/lib/public-catalog.mjs";

export const prerender = true;

export const GET: APIRoute = () => {
  const snapshot = publicCatalog(loadSnapshot(process.cwd()));
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  return Response.json({ commit, snapshot }, { headers: { "Cache-Control": "no-store" } });
};
