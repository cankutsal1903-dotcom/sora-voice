const clean = (value) => String(value || "").trim();

export const BANK_TRANSFER_DETAILS = {
  accountHolder: clean(process.env.EXPO_PUBLIC_BANK_ACCOUNT_HOLDER),
  bankName: clean(process.env.EXPO_PUBLIC_BANK_NAME),
  iban: clean(process.env.EXPO_PUBLIC_BANK_IBAN).replace(/\s/g, ""),
};

export const CREDIT_REQUEST_OPTIONS = [100, 500, 1000, 2500];
export const TRANSFER_AMOUNT_OPTIONS = [25, 50, 100, 250];

export const BANK_TRANSFER_STATUS = {
  awaiting_transfer: { label: "Ödeme bekleniyor", color: "#F4D168" },
  approved: { label: "Kredi yüklendi", color: "#B5FF78" },
  rejected: { label: "İncelenmedi", color: "#FF9FBA" },
  cancelled: { label: "İptal edildi", color: "#9699AC" },
};

export const hasBankTransferDetails = Boolean(
  BANK_TRANSFER_DETAILS.accountHolder
  && BANK_TRANSFER_DETAILS.bankName
  && /^TR\d{24}$/i.test(BANK_TRANSFER_DETAILS.iban),
);

export const formatIban = (iban = BANK_TRANSFER_DETAILS.iban) => clean(iban).replace(/(.{4})/g, "$1 ").trim();

export const formatTry = (amount) => new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(amount || 0));

export const formatBankRequestDate = (value) => new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "short",
  timeStyle: "short",
}).format(new Date(value));
