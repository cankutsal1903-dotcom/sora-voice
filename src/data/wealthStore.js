import { useEffect, useRef, useState } from "react";
import { supabase } from "../auth/supabase";

// Kullanıcıların hediye harcama toplamı (cömertlik seviyesi) için hedefli önbellek.
// Her bileşen yalnızca izlediği kullanıcı kimlikleri değiştiğinde yeniden çizilir.
const spentCache = new Map();
const listeners = new Set();
let columnSupported = null; // null: bilinmiyor, true/false: test edildi
let pendingIds = new Set();
let flushTimer = null;

const emitChanged = (changedIds) => {
  if (!changedIds || changedIds.size === 0) return;
  listeners.forEach((fn) => {
    try {
      fn(changedIds);
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
  emitChanged(new Set([userId]));
};

export const addLocalGiftSpent = (userId, amount) => {
  if (!userId) return;
  const delta = Math.max(0, Number(amount) || 0);
  if (!delta) return;
  spentCache.set(userId, (spentCache.get(userId) || 0) + delta);
  emitChanged(new Set([userId]));
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
    const changed = new Set();
    (data || []).forEach((row) => {
      if (!row?.id) return;
      const next = Math.max(0, Number(row.gift_spent_total) || 0);
      if (spentCache.get(row.id) !== next) {
        spentCache.set(row.id, next);
        changed.add(row.id);
      }
    });
    emitChanged(changed);
  } catch {
    // ağ hatası: daha sonra tekrar denenir
  }
};

export const requestGiftSpent = (userIds = []) => {
  if (columnSupported === false) return;
  let added = false;
  for (let i = 0; i < userIds.length; i += 1) {
    const id = userIds[i];
    if (id && !spentCache.has(id) && !pendingIds.has(id)) {
      pendingIds.add(id);
      added = true;
    }
  }
  if (added && !flushTimer) flushTimer = setTimeout(flush, 40);
};

export const loadOwnGiftSpent = async (userId) => {
  if (!userId || !supabase) return null;
  if (columnSupported !== false) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("gift_spent_total")
        .eq("id", userId)
        .maybeSingle();
      if (!error && data) {
        columnSupported = true;
        const total = Math.max(0, Number(data.gift_spent_total) || 0);
        setKnownGiftSpent(userId, total);
        return total;
      }
      if (error && (String(error.message || "").includes("gift_spent_total") || error.code === "42703")) {
        columnSupported = false;
      }
    } catch {
      return getCachedGiftSpent(userId);
    }
  }
  try {
    const { data, error } = await supabase
      .from("wallet_transactions")
      .select("amount")
      .eq("user_id", userId)
      .eq("type", "gift")
      .lt("amount", 0)
      .limit(2000);
    if (error) return null;
    const total = (data || []).reduce((sum, row) => sum + Math.max(0, -Number(row.amount) || 0), 0);
    setKnownGiftSpent(userId, total);
    return total;
  } catch {
    return null;
  }
};

export const useGiftSpent = (userId) => {
  const [val, setVal] = useState(() => getCachedGiftSpent(userId));
  useEffect(() => {
    setVal(getCachedGiftSpent(userId));
    if (!userId) return undefined;
    const fn = (changedIds) => {
      if (changedIds.has(userId)) {
        setVal(getCachedGiftSpent(userId));
      }
    };
    listeners.add(fn);
    requestGiftSpent([userId]);
    return () => listeners.delete(fn);
  }, [userId]);
  return val;
};

const buildSubsetMap = (ids) => {
  const out = {};
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (spentCache.has(id)) out[id] = spentCache.get(id);
  }
  return out;
};

export const useGiftSpentMap = (userIds = []) => {
  const uniqueIds = [];
  const seen = new Set();
  for (let i = 0; i < userIds.length; i += 1) {
    const id = userIds[i];
    if (id && !seen.has(id)) {
      seen.add(id);
      uniqueIds.push(id);
    }
  }
  uniqueIds.sort();
  const key = uniqueIds.join(",");
  const watchedRef = useRef(seen);
  watchedRef.current = seen;

  const [snapshot, setSnapshot] = useState(() => buildSubsetMap(uniqueIds));

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    setSnapshot(buildSubsetMap(ids));
    if (!ids.length) return undefined;
    const fn = (changedIds) => {
      for (const id of changedIds) {
        if (watchedRef.current.has(id)) {
          setSnapshot(buildSubsetMap(ids));
          return;
        }
      }
    };
    listeners.add(fn);
    requestGiftSpent(ids);
    return () => listeners.delete(fn);
  }, [key]);

  return snapshot;
};
