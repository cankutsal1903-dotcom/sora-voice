import { useEffect, useState } from "react";
import { supabase } from "../auth/supabase";

// Kullanıcıların hediye harcama toplamı (cömertlik seviyesi) için hafif önbellek.
// profiles.gift_spent_total sütunu henüz yoksa sessizce devre dışı kalır;
// kendi profilin için cüzdan işlemlerinden hesaplama yapılır.
const spentCache = new Map();
const listeners = new Set();
let columnSupported = null; // null: bilinmiyor, true/false: test edildi
let pendingIds = new Set();
let flushTimer = null;

const emit = () => {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // yoksay
    }
  });
};

export const setKnownGiftSpent = (userId, spent) => {
  if (!userId) return;
  const value = Math.max(0, Number(spent) || 0);
  if (spentCache.get(userId) === value) return;
  spentCache.set(userId, value);
  emit();
};

export const addLocalGiftSpent = (userId, amount) => {
  if (!userId) return;
  const delta = Math.max(0, Number(amount) || 0);
  if (!delta) return;
  spentCache.set(userId, (spentCache.get(userId) || 0) + delta);
  emit();
};

export const getCachedGiftSpent = (userId) =>
  userId && spentCache.has(userId) ? spentCache.get(userId) : null;

const flush = async () => {
  flushTimer = null;
  const ids = [...pendingIds];
  pendingIds = new Set();
  if (!ids.length || !supabase || columnSupported === false) return;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, gift_spent_total")
      .in("id", ids.slice(0, 80));
    if (error) {
      if (String(error.message || "").includes("gift_spent_total") || error.code === "42703") {
        columnSupported = false;
      }
      return;
    }
    columnSupported = true;
    (data || []).forEach((row) => {
      if (row?.id) spentCache.set(row.id, Math.max(0, Number(row.gift_spent_total) || 0));
    });
    emit();
  } catch {
    // ağ hatası: daha sonra tekrar denenir
  }
};

export const requestGiftSpent = (userIds = []) => {
  if (columnSupported === false) return;
  let added = false;
  userIds.forEach((id) => {
    if (id && !spentCache.has(id) && !pendingIds.has(id)) {
      pendingIds.add(id);
      added = true;
    }
  });
  if (added && !flushTimer) flushTimer = setTimeout(flush, 120);
};

export const loadOwnGiftSpent = async (userId) => {
  if (!userId || !supabase) return null;
  requestGiftSpent([userId]);
  await new Promise((resolve) => setTimeout(resolve, 260));
  if (columnSupported === true && spentCache.has(userId)) return spentCache.get(userId);
  try {
    const { data, error } = await supabase
      .from("wallet_transactions")
      .select("amount")
      .eq("user_id", userId)
      .eq("type", "gift")
      .lt("amount", 0)
      .limit(10000);
    if (error) return null;
    const total = (data || []).reduce((sum, row) => sum + Math.max(0, -Number(row.amount) || 0), 0);
    setKnownGiftSpent(userId, total);
    return total;
  } catch {
    return null;
  }
};

export const useGiftSpent = (userId) => {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    if (userId) requestGiftSpent([userId]);
    return () => listeners.delete(fn);
  }, [userId]);
  return getCachedGiftSpent(userId);
};

export const useGiftSpentMap = (userIds = []) => {
  const [, force] = useState(0);
  const key = userIds.filter(Boolean).sort().join(",");
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    requestGiftSpent(key ? key.split(",") : []);
    return () => listeners.delete(fn);
  }, [key]);
  const snapshot = {};
  spentCache.forEach((value, id) => {
    snapshot[id] = value;
  });
  return snapshot;
};
