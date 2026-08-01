const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#CBFF4D"/><path d="M20 15h28v9H31v8h15v9H31v16H20V15Z" fill="#171821"/></svg>`;

export function GET() {
  return new Response(FAVICON, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=86400",
    },
  });
}
