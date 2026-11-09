const tokenServerUrl = process.env.EXPO_PUBLIC_TOKEN_SERVER_URL?.replace(/\/$/, "");

export const moderateLiveParticipant = async ({ roomId, targetUserId, action, accessToken }) => {
  if (!tokenServerUrl) throw new Error("Canlı ses sunucusu yapılandırılmadı.");
  if (!accessToken) throw new Error("Oturum bulunamadı.");
  const response = await fetch(`${tokenServerUrl}/rooms/${roomId}/moderate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ targetUserId, action }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Moderasyon işlemi tamamlanamadı.");
  return payload.membership;
};
