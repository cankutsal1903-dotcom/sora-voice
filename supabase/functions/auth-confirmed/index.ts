const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const describeErrorCode = (code: string) => {
  const normalized = code.trim().toLowerCase();
  if (normalized === "otp_expired" || normalized === "access_denied") {
    return "Doğrulama bağlantısının süresi dolmuş veya bu bağlantı daha önce kullanılmış.";
  }
  return "Doğrulama tamamlanamadı. Lütfen Sora uygulamasına dönüp yeni bir bağlantı isteyin.";
};

Deno.serve((request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const errorCode = url.searchParams.get("error_code") || url.searchParams.get("error") || "";
  const hasError = Boolean(errorCode || url.searchParams.has("error_description"));
  const hasAuthCode = url.searchParams.has("code") || url.searchParams.has("token_hash");
  const ua = request.headers.get("user-agent") || "";
  const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua);

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

  // Static Turkish messages only (never reflect untrusted query text on *.supabase.co).
  const body = hasError
    ? `SORA HESABI — Doğrulama tamamlanamadı\n\n${describeErrorCode(errorCode)}`
    : "SORA HESABI — E-posta doğrulandı\n\nE-posta adresiniz başarıyla doğrulandı.\nBu pencereyi kapatıp Sora uygulamasına dönebilirsiniz.";

  return new Response(body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
});
