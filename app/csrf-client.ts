"use client";

function tokenFromCookie() {
  return document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("fala_csrf="))?.slice("fala_csrf=".length) ?? "";
}

export function csrfFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = String(init.method ?? "GET").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return fetch(input, { ...init, credentials: init.credentials ?? "include" });
  const headers = new Headers(init.headers);
  headers.set("x-csrf-token", tokenFromCookie());
  return fetch(input, { ...init, credentials: init.credentials ?? "include", headers });
}
