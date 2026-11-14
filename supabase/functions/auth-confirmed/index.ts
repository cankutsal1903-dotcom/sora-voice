const page = (hasError: boolean, errorMessage = "") => {
  const safeError = errorMessage.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
  const title = hasError ? "Doğrulama tamamlanamadı" : "Hesabınız doğrulandı";
  const description = hasError
    ? safeError || "Bağlantının süresi dolmuş veya daha önce kullanılmış olabilir."
    : "E-posta adresiniz başarıyla doğrulandı. Sora hesabınız artık kullanıma hazır.";
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} · Sora</title>
    <style>
      :root { color-scheme: light; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; color: #11161c; background: linear-gradient(145deg, #f7fbfb, #e7f7f2); }
      main { width: min(100%, 430px); padding: 34px 26px 26px; text-align: center; border: 1px solid rgba(1, 168, 132, .14); border-radius: 28px; background: rgba(255,255,255,.96); box-shadow: 0 20px 55px rgba(14, 67, 59, .16); }
      .mark { width: 76px; height: 76px; display: grid; place-items: center; margin: 0 auto 20px; border-radius: 50%; color: #063a2d; background: ${hasError ? "#ffd8df" : "#01d9a8"}; font-size: 38px; font-weight: 900; }
      .eyebrow { margin: 0 0 9px; color: #01a884; font-size: 11px; font-weight: 900; letter-spacing: 1.6px; }
      h1 { margin: 0; font-size: clamp(26px, 7vw, 36px); letter-spacing: -1.2px; }
      p { margin: 13px auto 0; max-width: 340px; color: #566171; font-size: 15px; line-height: 1.55; }
      a { display: flex; align-items: center; justify-content: space-between; margin-top: 26px; padding: 15px 17px; border-radius: 15px; color: #063a2d; background: #01d9a8; font-weight: 900; text-decoration: none; }
      small { display: block; margin-top: 17px; color: #8993a1; font-size: 11px; }
    </style>
  </head>
  <body>
    <main>
      <div class="mark">${hasError ? "!" : "✓"}</div>
      <p class="eyebrow">SORA HESABI</p>
      <h1>${title}</h1>
      <p>${description}</p>
      <a id="open-app" href="sora://auth/callback${hasError ? "" : "#"}">
        <span>Uygulamaya dön</span><span aria-hidden="true">→</span>
      </a>
      <small>Bu pencereyi kapatabilirsiniz.</small>
    </main>
    <script>
      const params = new URLSearchParams(location.search);
      const hash = location.hash || "";
      const error = params.get("error_description") || new URLSearchParams(hash.slice(1)).get("error_description");
      const target = document.getElementById("open-app");
      if (target) target.href = "sora://auth/callback" + location.search + hash;
      if (error) document.title = "Doğrulama tamamlanamadı · Sora";
    </script>
  </body>
</html>`;
};

Deno.serve((request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }
  const url = new URL(request.url);
  const error = url.searchParams.get("error_description") || "";
  return new Response(page(Boolean(error), error), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});
