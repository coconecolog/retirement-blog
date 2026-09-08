import type { APIRoute } from "astro";
import { SITE_URL } from "@/consts";

export const GET: APIRoute = ({ site }) => {
  const siteUrl = site?.toString().replace(/\/$/, "") || SITE_URL;
  const body = `User-agent: *
  Content-Signal: search=yes,ai-train=no,ai-input=yes,use=reference
Allow: /

Sitemap: ${siteUrl}/sitemap-index.xml
`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
