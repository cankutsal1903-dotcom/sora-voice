const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve((request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const error = url.searchParams.get("error_description") || url.searchParams.get("error") || "";
  const hasAuthCode = url.searchParams.has("code") || url.searchParams.has("token_hash");
  const ua = request.headers.get("user-agent") || "";
  const isMobile = /android|iphone|ipad|ipod/i.test(ua);

  // Forward PKCE/deep-link callbacks straight to the installed mobile app.
  if (hasAuthCode && isMobile) {
    return new Response(null, {
      status: 302,
      headers: {
        ...CORS_HEADERS,
        Location: `sora://auth/callback${url.search}`,
      },
    });
  }

  // Supabase Edge Gateway serves default *.supabase.co function responses as
  // text/plain with nosniff, so return clean UTF-8 Turkish text rather than raw HTML source.
  const body = error
    ? `SORA HESABI — Doğrulama tamamlanamadı\n\n${error}\n\nLütfen Sora uygulamasına dönüp yeni bir bağlantı isteyin.`
    : "SORA HESABI — E-posta doğrulandı\n\nE-posta adresiniz başarıyla doğrulandı.\nBu pencereyi kapatıp Sora uygulamasına dönebilirsiniz.";

  return new Response(body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
});
