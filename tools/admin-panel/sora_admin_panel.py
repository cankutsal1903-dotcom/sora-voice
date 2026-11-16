#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sora Admin Panel

Sora Voice yönetim merkezi: 8 haneli ID ile coin ekleme/düşürme, süreli veya
süresiz oyundan banlama/susturma, aktif ban listesi, canlı oda ve aile yönetimi,
güvenlik raporları, IBAN talepleri, yasaklı kelime filtresi ve oda arka plan
inceleme modüllerini tek bir GTK 3 masaüstü uygulamasında birleştirir.

Kullanım:
    ./sora_admin_panel.py              # uygulamayı aç
    ./sora_admin_panel.py --self-test  # ağ kullanmadan iç testleri çalıştır
"""

import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("GdkPixbuf", "2.0")
gi.require_version("Pango", "1.0")
from gi.repository import Gdk, GdkPixbuf, Gio, GLib, Gtk, Pango  # noqa: E402

APP_ID = "com.sora.AdminPanel"
APP_TITLE = "Sora Admin Panel"
SETTING_KEY = "room_background_uploads_enabled"
BUCKET = "room-backgrounds"
REFRESH_SECONDS = 30
HTTP_TIMEOUT = 25
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
MAX_PREVIEW_EDGE = 1600
IMAGE_CACHE_ITEMS = 8
THUMB_WIDTH = 280
THUMB_MAX_HEIGHT = 498
PLACEHOLDER_HEIGHT = 360

SCRIPT_PATH = os.path.realpath(__file__)
SCRIPT_DIR = os.path.dirname(SCRIPT_PATH)
REPO_ROOT = os.path.realpath(os.path.join(SCRIPT_DIR, "..", ".."))
XDG_CONFIG = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
CONFIG_DIR = os.path.join(XDG_CONFIG, "sora-admin-panel")
LEGACY_CONFIG_DIR = os.path.join(XDG_CONFIG, "sora-background-review")
SESSION_PATH = os.path.join(CONFIG_DIR, "session.json")
PREFS_PATH = os.path.join(CONFIG_DIR, "prefs.json")

URL_KEY = "EXPO_PUBLIC_SUPABASE_URL"
API_KEY_NAMES = ("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "EXPO_PUBLIC_SUPABASE_ANON_KEY")

STATUS_CHOICES = (
    ("pending", "Bekleyen"),
    ("approved", "Onaylanan"),
    ("rejected", "Reddedilen"),
)

BAN_DURATION_CHOICES = (
    ("permanent", "Süresiz (Kalıcı)", None),
    ("15m", "15 Dakika", 15),
    ("1h", "1 Saat", 60),
    ("6h", "6 Saat", 360),
    ("24h", "24 Saat (1 Gün)", 1440),
    ("3d", "3 Gün", 4320),
    ("7d", "7 Gün (1 Hafta)", 10080),
    ("30d", "30 Gün (1 Ay)", 43200),
    ("custom", "Özel Süre (Saat gir)", -1),
)

COIN_PRESETS = (
    ("+100K", 100_000),
    ("+1M", 1_000_000),
    ("+5M", 5_000_000),
    ("+10M", 10_000_000),
    ("+50M", 50_000_000),
    ("+100M", 100_000_000),
    ("+500M", 500_000_000),
)

TR_MONTHS = ("Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara")

try:
    from zoneinfo import ZoneInfo

    LOCAL_TZ = ZoneInfo("Europe/Istanbul")
except Exception:  # pragma: no cover
    LOCAL_TZ = timezone(timedelta(hours=3), "TRT")


def migrate_legacy_config():
    """Eski sora-background-review yapılandırmasını ve oturumunu otomatik taşır."""
    if not os.path.isdir(LEGACY_CONFIG_DIR):
        return
    os.makedirs(CONFIG_DIR, mode=0o700, exist_ok=True)
    for fname in ("config.env", "session.json", "prefs.json"):
        src = os.path.join(LEGACY_CONFIG_DIR, fname)
        dst = os.path.join(CONFIG_DIR, fname)
        if os.path.isfile(src) and not os.path.isfile(dst):
            try:
                shutil.copy2(src, dst)
                os.chmod(dst, 0o600)
            except OSError:
                pass


def parse_env_text(text):
    values = {}
    for raw in text.splitlines():
        line = raw.strip().lstrip("\ufeff")
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        elif value[:1] in ("'", '"'):
            quote = value[0]
            end = value.find(quote, 1)
            value = value[1:end] if end > 0 else value[1:]
        else:
            hash_at = value.find(" #")
            if hash_at >= 0:
                value = value[:hash_at].rstrip()
        values[key] = value
    return values


def config_candidates():
    paths = []
    env_file = os.environ.get("SORA_ENV_FILE")
    if env_file:
        paths.append(os.path.expanduser(env_file))
    paths.append(os.path.join(CONFIG_DIR, "config.env"))
    paths.append(os.path.join(LEGACY_CONFIG_DIR, "config.env"))
    paths.append("/home/omer/Uygulama/.env")
    repo_env = os.path.join(REPO_ROOT, ".env")
    if repo_env not in paths:
        paths.append(repo_env)
    return paths


class ConfigError(Exception):
    pass


class Config:
    def __init__(self, url, key, source):
        self.url = url.rstrip("/")
        parsed = urllib.parse.urlsplit(self.url)
        local = parsed.hostname in ("localhost", "127.0.0.1", "::1")
        if (not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment
                or parsed.path or (parsed.scheme != "https" and not (local and parsed.scheme == "http"))):
            raise ConfigError("Supabase adresi HTTPS olmalı ve yol, kullanıcı bilgisi veya sorgu içermemeli.")
        if key.startswith("sb_secret_"):
            raise ConfigError("Bu program yalnızca publishable/anon anahtarı kullanır; secret anahtarı kabul edilmez.")
        if key.count(".") == 2:
            try:
                claims = key.split(".")[1]
                role = json.loads(base64.urlsafe_b64decode(claims + "=" * (-len(claims) % 4))).get("role")
            except (ValueError, TypeError, AttributeError):
                role = None
            if role != "anon":
                raise ConfigError("Legacy anahtarın rolü anon olmalı; ayrıcalıklı anahtar kabul edilmez.")
        self.key = key
        self.source = source

    def __repr__(self):
        return "Config(url=%r, key=<gizli>, source=%r)" % (self.url, self.source)


def load_config():
    migrate_legacy_config()
    checked = []
    for path in config_candidates():
        checked.append(path)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as handle:
                values = parse_env_text(handle.read())
        except OSError:
            continue
        url = values.get(URL_KEY, "").strip()
        key = next((values[k].strip() for k in API_KEY_NAMES if values.get(k, "").strip()), "")
        if url and key:
            return Config(url, key, path)
    url = os.environ.get(URL_KEY, "").strip()
    key = next((os.environ[k].strip() for k in API_KEY_NAMES if os.environ.get(k, "").strip()), "")
    if url and key:
        return Config(url, key, "ortam değişkenleri")
    raise ConfigError(
        "Supabase ayarları bulunamadı. %s ve %s değerlerini içeren bir .env dosyası gerekli.\n"
        "Bakılan konumlar:\n%s" % (URL_KEY, API_KEY_NAMES[0], "\n".join("  - " + p for p in checked))
    )


def read_json_file(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return default


def write_private_json(path, data):
    directory = os.path.dirname(path)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    try:
        os.chmod(directory, 0o700)
    except OSError:
        pass
    fd, tmp_path = tempfile.mkstemp(prefix=".session-", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
    os.chmod(path, 0o600)


def format_coins(value):
    try:
        num = int(value or 0)
    except (TypeError, ValueError):
        return "0"
    sign = "-" if num < 0 else ""
    s = "%d" % abs(num)
    groups = []
    while s:
        groups.append(s[-3:])
        s = s[:-3]
    return sign + ".".join(reversed(groups))


def parse_coin_input(raw_text):
    """'10.000.000', '10 000 000', '10,000,000' veya '25m' gibi girişleri tam sayıya çevirir."""
    clean = (raw_text or "").strip().lower()
    if not clean:
        return 0
    multiplier = 1
    if clean.endswith("m"):
        multiplier = 1_000_000
        clean = clean[:-1].strip()
    elif clean.endswith("k") or clean.endswith("b"):
        multiplier = 1_000 if clean[-1:] != "b" else 1_000_000_000
        if raw_text.strip().lower().endswith("k"):
            multiplier = 1_000
        clean = clean[:-1].strip()
    digits = "".join(ch for ch in clean if ch.isdigit())
    if not digits:
        return 0
    return int(digits) * multiplier


def parse_timestamp(value):
    if not value:
        return None
    text = str(value).strip().replace(" ", "T", 1)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    if "." in text:
        head, _, rest = text.partition(".")
        digits = ""
        idx = 0
        while idx < len(rest) and rest[idx].isdigit():
            digits += rest[idx]
            idx += 1
        tz_part = rest[idx:]
        text = head + "." + (digits + "000000")[:6] + tz_part
    if len(text) >= 3 and text[-3] in "+-" and text[-2:].isdigit() and ":" not in text[-6:]:
        text += ":00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def format_local_time(value):
    parsed = parse_timestamp(value)
    if parsed is None:
        return "—"
    local = parsed.astimezone(LOCAL_TZ)
    return "%d %s %d %02d:%02d" % (local.day, TR_MONTHS[local.month - 1], local.year, local.hour, local.minute)


def format_sanction_badge(action, expires_at):
    if not action:
        return "Temiz"
    label_map = {
        "ban": "Yasaklı",
        "suspend": "Uzaklaştırıldı",
        "chat_mute": "Susturuldu",
        "warning": "Uyarılı",
    }
    base = label_map.get(action, action)
    if action in ("ban", "suspend", "chat_mute"):
        if not expires_at:
            return "%s (Süresiz)" % base
        return "%s (%s)" % (base, format_local_time(expires_at))
    return base


ERROR_TRANSLATIONS = (
    ("admin access required",
     "Bu hesabın yönetici yetkisi yok. Hesabın Supabase'deki app_admins tablosunda olması gerekiyor."),
    ("admin or owner permission required", "Bu işlem için admin veya kurucu (owner) yetkisi gerekiyor."),
    ("owner permission required", "Bu işlem için kurucu (owner) yetkisi gerekiyor."),
    ("user not found", "Kullanıcı bulunamadı. 8 haneli ID veya @kullanıcı adını kontrol edin."),
    ("invalid login credentials", "E-posta veya şifre hatalı."),
    ("email not confirmed", "Bu e-posta adresi henüz doğrulanmamış."),
    ("invalid credit amount", "Geçerli bir coin miktarı girin."),
    ("request already reviewed", "Bu istek zaten incelenmiş."),
    ("transfer request was already reviewed", "Bu havale talebi zaten incelenmiş."),
    ("request not found", "İstek bulunamadı (silinmiş olabilir)."),
    ("authentication required", "Oturum gerekli. Lütfen tekrar giriş yapın."),
    ("object not found", "Görsel depolamada bulunamadı."),
    ("invalid refresh token", "Oturum süresi doldu. Lütfen tekrar giriş yapın."),
    ("refresh token not found", "Oturum süresi doldu. Lütfen tekrar giriş yapın."),
    ("jwt expired", "Oturum süresi doldu. Lütfen tekrar giriş yapın."),
    ("could not find the function", "Sunucuda gerekli admin fonksiyonu bulunamadı."),
    ("rate limit", "Çok fazla deneme yapıldı. Biraz bekleyip tekrar deneyin."),
)


def translate_error(message):
    text = (message or "").strip()
    lower = text.lower()
    for needle, turkish in ERROR_TRANSLATIONS:
        if needle in lower:
            return turkish
    return text or "Bilinmeyen hata."


class ApiError(Exception):
    def __init__(self, message, status=None, raw_message=None):
        super().__init__(message)
        self.status = status
        self.raw_message = raw_message or message

    @property
    def is_admin_error(self):
        return "admin access required" in (self.raw_message or "").lower()


class AuthRequired(ApiError):
    pass


def _extract_message(body_bytes):
    try:
        data = json.loads(body_bytes.decode("utf-8", "replace"))
    except ValueError:
        return body_bytes.decode("utf-8", "replace").strip()[:300]
    if isinstance(data, dict):
        for key in ("message", "msg", "error_description", "error"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value
        return json.dumps(data, ensure_ascii=False)[:300]
    return str(data)[:300]


def _is_jwt_problem(status, raw_message):
    lower = (raw_message or "").lower()
    if status == 401:
        return True
    return status in (400, 403) and "jwt" in lower and ("expired" in lower or "invalid" in lower)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class SupabaseClient:
    def __init__(self, config, session_path=SESSION_PATH):
        self.config = config
        self.session_path = session_path
        self._lock = threading.Lock()
        self._opener = urllib.request.build_opener(NoRedirect())
        self.session = self._load_session()

    def _load_session(self):
        for candidate in (self.session_path, os.path.join(LEGACY_CONFIG_DIR, "session.json")):
            data = read_json_file(candidate)
            if (isinstance(data, dict) and data.get("access_token") and data.get("refresh_token")
                    and data.get("project_url") == self.config.url):
                try:
                    if candidate == self.session_path:
                        os.chmod(self.session_path, 0o600)
                    else:
                        write_private_json(self.session_path, data)
                except OSError:
                    pass
                return data
        return None

    def _store_session(self, data):
        expires_at = data.get("expires_at")
        if not expires_at:
            expires_at = int(time.time()) + int(data.get("expires_in") or 3600)
        user = data.get("user") or {}
        session = {
            "project_url": self.config.url,
            "access_token": data["access_token"],
            "refresh_token": data["refresh_token"],
            "expires_at": int(expires_at),
            "email": user.get("email") or (self.session or {}).get("email"),
            "user_id": user.get("id") or (self.session or {}).get("user_id"),
        }
        write_private_json(self.session_path, session)
        self.session = session
        return session

    def clear_session(self):
        with self._lock:
            self.session = None
            for path in (self.session_path, os.path.join(LEGACY_CONFIG_DIR, "session.json")):
                try:
                    os.unlink(path)
                except FileNotFoundError:
                    pass

    def has_session(self):
        return bool(self.session)

    @property
    def email(self):
        return (self.session or {}).get("email") or ""

    def _http(self, method, url, headers, body=None):
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
        request = urllib.request.Request(url, data=data, method=method)
        for name, value in headers.items():
            request.add_header(name, value)
        try:
            with self._opener.open(request, timeout=HTTP_TIMEOUT) as response:
                payload = response.read(MAX_RESPONSE_BYTES + 1)
                if len(payload) > MAX_RESPONSE_BYTES:
                    raise ApiError("Sunucu yanıtı izin verilen boyutu aşıyor.")
                return response.status, payload
        except urllib.error.HTTPError as exc:
            try:
                payload = exc.read(16384)
            except Exception:
                payload = b""
            return exc.code, payload
        except urllib.error.URLError as exc:
            raise ApiError("Sunucuya ulaşılamadı: %s" % getattr(exc, "reason", exc))
        except (TimeoutError, OSError) as exc:
            raise ApiError("Bağlantı hatası: %s" % exc)

    def _auth_post(self, grant_type, body):
        url = "%s/auth/v1/token?grant_type=%s" % (self.config.url, grant_type)
        headers = {"apikey": self.config.key, "Content-Type": "application/json"}
        status, payload = self._http("POST", url, headers, body)
        if not 200 <= status < 300:
            raw = _extract_message(payload)
            raise ApiError(translate_error(raw), status, raw)
        try:
            return json.loads(payload.decode("utf-8"))
        except ValueError:
            raise ApiError("Sunucudan geçersiz yanıt alındı.", status)

    def sign_in(self, email, password):
        data = self._auth_post("password", {"email": email, "password": password})
        with self._lock:
            return self._store_session(data)

    def _refresh(self, failed_token=None):
        with self._lock:
            if not self.session:
                raise AuthRequired("Oturum bulunamadı. Lütfen giriş yapın.")
            if failed_token and self.session.get("access_token") != failed_token:
                return
            try:
                data = self._auth_post("refresh_token", {"refresh_token": self.session["refresh_token"]})
            except ApiError as exc:
                if exc.status in (400, 401, 403):
                    self.session = None
                    try:
                        os.unlink(self.session_path)
                    except FileNotFoundError:
                        pass
                    raise AuthRequired("Oturum süresi doldu. Lütfen tekrar giriş yapın.", exc.status)
                raise
            self._store_session(data)

    def _current_token(self):
        session = self.session
        if not session:
            raise AuthRequired("Oturum bulunamadı. Lütfen giriş yapın.")
        if int(session.get("expires_at") or 0) - 60 <= time.time():
            self._refresh(session.get("access_token"))
            session = self.session
            if not session:
                raise AuthRequired("Oturum bulunamadı. Lütfen giriş yapın.")
        return session["access_token"]

    def request(self, method, path, body=None, expect_json=True):
        url = self.config.url + path
        for attempt in (1, 2):
            token = self._current_token()
            headers = {
                "apikey": self.config.key,
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json",
            }
            status, payload = self._http(method, url, headers, body)
            if 200 <= status < 300:
                if not expect_json:
                    return payload
                if not payload:
                    return None
                try:
                    return json.loads(payload.decode("utf-8"))
                except ValueError:
                    raise ApiError("Sunucudan geçersiz yanıt alındı.", status)
            raw = _extract_message(payload)
            if attempt == 1 and _is_jwt_problem(status, raw):
                self._refresh(token)
                continue
            if _is_jwt_problem(status, raw):
                raise AuthRequired(translate_error(raw), status, raw)
            raise ApiError(translate_error(raw), status, raw)
        raise ApiError("İstek tamamlanamadı.")

    def rpc(self, name, params=None):
        return self.request("POST", "/rest/v1/rpc/" + name, params or {})

    def rpc_one(self, name, params=None):
        res = self.rpc(name, params)
        if isinstance(res, list):
            return res[0] if res else None
        return res

    # --- Admin RPC sarmalayıcıları ---
    def get_dashboard_summary(self):
        return self.rpc_one("admin_dashboard_summary") or {}

    def search_users(self, query="", limit=80):
        rows = self.rpc("admin_search_users", {"p_query": query or "", "p_limit": int(limit)})
        return rows if isinstance(rows, list) else []

    def adjust_user_coins(self, identifier, delta, bucket="promo", note="", idempotency_key=None):
        return self.rpc_one(
            "admin_adjust_user_coins",
            {
                "p_identifier": str(identifier).strip(),
                "p_delta": int(delta),
                "p_bucket": bucket,
                "p_note": note or "",
                "p_idempotency_key": idempotency_key or str(uuid.uuid4()),
            },
        )

    def apply_sanction(self, identifier, action, duration_minutes=None, reason=""):
        return self.rpc_one(
            "admin_apply_user_sanction",
            {
                "p_identifier": str(identifier).strip(),
                "p_action": action,
                "p_duration_minutes": int(duration_minutes) if duration_minutes else None,
                "p_reason": reason or "",
            },
        )

    def revoke_sanctions(self, identifier=None, sanction_id=None):
        return self.rpc(
            "admin_revoke_user_sanctions",
            {"p_identifier": identifier, "p_sanction_id": sanction_id},
        )

    def list_sanctions(self, only_active=True, limit=120):
        rows = self.rpc("admin_list_sanctions", {"p_only_active": bool(only_active), "p_limit": int(limit)})
        return rows if isinstance(rows, list) else []

    def list_user_transactions(self, identifier, limit=40):
        rows = self.rpc("admin_list_user_transactions", {"p_identifier": str(identifier), "p_limit": int(limit)})
        return rows if isinstance(rows, list) else []

    def set_user_level(self, identifier, level):
        return self.rpc_one("admin_set_user_level", {"p_identifier": str(identifier), "p_level": int(level)})

    def list_rooms(self, state="all"):
        rows = self.rpc("admin_list_rooms", {"p_state": state})
        return rows if isinstance(rows, list) else []

    def manage_room(self, room_id, action):
        return self.rpc("admin_manage_room", {"p_room_id": room_id, "p_action": action})

    def list_families(self):
        rows = self.rpc("admin_list_families")
        return rows if isinstance(rows, list) else []

    def manage_family(self, family_id, action, xp_delta=0):
        return self.rpc(
            "admin_manage_family",
            {"p_family_id": family_id, "p_action": action, "p_xp_delta": int(xp_delta)},
        )

    def list_safety_reports(self, status="open"):
        rows = self.rpc("admin_list_safety_reports", {"p_status": status})
        return rows if isinstance(rows, list) else []

    def resolve_report(self, report_id, status, resolution="", sanction_action=None, sanction_hours=None):
        return self.rpc(
            "admin_resolve_report",
            {
                "p_report_id": report_id,
                "p_status": status,
                "p_resolution": resolution or "",
                "p_sanction_action": sanction_action,
                "p_sanction_hours": sanction_hours,
            },
        )

    def list_bank_transfers(self, status="awaiting_transfer"):
        rows = self.rpc("admin_list_bank_transfer_requests", {"p_status": status})
        return rows if isinstance(rows, list) else []

    def review_bank_transfer(self, request_id, approved, credited_credits=None, note=""):
        return self.rpc_one(
            "admin_review_bank_transfer_request",
            {
                "p_request_id": request_id,
                "p_approved": bool(approved),
                "p_credited_credits": int(credited_credits) if credited_credits else None,
                "p_admin_note": note or "",
            },
        )

    def list_moderation_terms(self):
        rows = self.rpc("admin_list_moderation_terms")
        return rows if isinstance(rows, list) else []

    def manage_moderation_term(self, action, term="", term_id=None):
        return self.rpc(
            "admin_manage_moderation_term",
            {"p_action": action, "p_term": term or "", "p_term_id": term_id},
        )

    def list_requests(self, status):
        rows = self.rpc("admin_list_room_background_requests", {"p_status": status})
        return rows if isinstance(rows, list) else []

    def review_background(self, request_id, approve, note=""):
        return self.rpc(
            "admin_review_room_background",
            {"p_request_id": request_id, "p_approve": bool(approve), "p_note": note or ""},
        )

    def get_setting(self):
        rows = self.request(
            "GET", "/rest/v1/app_settings?key=eq.%s&select=value" % urllib.parse.quote(SETTING_KEY)
        )
        if isinstance(rows, list) and rows:
            return coerce_bool(rows[0].get("value"))
        return False

    def set_setting(self, enabled):
        saved = self.rpc("admin_set_app_setting", {"p_key": SETTING_KEY, "p_value": bool(enabled)})
        if isinstance(saved, list) and saved:
            saved = saved[0]
        if isinstance(saved, dict) and "value" in saved:
            return coerce_bool(saved["value"])
        return bool(enabled)

    def download_image(self, image_path):
        quoted = urllib.parse.quote(image_path.lstrip("/"), safe="/")
        return self.request(
            "GET", "/storage/v1/object/authenticated/%s/%s" % (BUCKET, quoted), expect_json=False
        )

    def sign_out_remote(self, access_token):
        if not access_token:
            return
        url = self.config.url + "/auth/v1/logout?scope=local"
        headers = {
            "apikey": self.config.key,
            "Authorization": "Bearer " + access_token,
            "Content-Type": "application/json",
        }
        try:
            self._http("POST", url, headers, {})
        except ApiError:
            pass


def coerce_bool(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().strip('"').lower() == "true"
    if isinstance(value, (int, float)):
        return value != 0
    return False


def pixbuf_from_bytes(data):
    if len(data) > MAX_RESPONSE_BYTES:
        raise ApiError("Görsel çok büyük.")
    if not (data.startswith(b"\xff\xd8\xff") or data.startswith(b"\x89PNG\r\n\x1a\n")
            or (data[:4] == b"RIFF" and data[8:12] == b"WEBP")):
        raise ApiError("Yalnızca JPEG, PNG ve WebP görselleri desteklenir.")
    loader = GdkPixbuf.PixbufLoader()
    oversized = []

    def size_prepared(image_loader, width, height):
        if width * height > MAX_IMAGE_PIXELS:
            oversized.append(True)
            image_loader.set_size(1, 1)
            return
        ratio = min(1.0, MAX_PREVIEW_EDGE / max(width, height))
        image_loader.set_size(max(1, int(width * ratio)), max(1, int(height * ratio)))

    loader.connect("size-prepared", size_prepared)
    try:
        loader.write(data)
        loader.close()
    except GLib.Error as exc:
        try:
            loader.close()
        except GLib.Error:
            pass
        raise ApiError("Görsel açılamadı: %s" % exc.message)
    pixbuf = loader.get_pixbuf()
    if oversized:
        raise ApiError("Görselin piksel boyutu çok büyük.")
    if pixbuf is None:
        raise ApiError("Görsel açılamadı.")
    oriented = pixbuf.apply_embedded_orientation()
    return oriented or pixbuf


def scale_to_fit(pixbuf, max_w, max_h):
    width, height = pixbuf.get_width(), pixbuf.get_height()
    if width <= 0 or height <= 0:
        return pixbuf
    ratio = min(float(max_w) / width, float(max_h) / height)
    new_w, new_h = max(1, int(width * ratio)), max(1, int(height * ratio))
    if (new_w, new_h) == (width, height):
        return pixbuf
    return pixbuf.scale_simple(new_w, new_h, GdkPixbuf.InterpType.BILINEAR)


def find_logo():
    for candidate in (
        os.path.join(SCRIPT_DIR, "sora-logo.png"),
        os.path.expanduser("~/.local/share/sora-admin-panel/sora-logo.png"),
        os.path.expanduser("~/.local/share/sora-background-review/sora-logo.png"),
        os.path.join(REPO_ROOT, "assets", "images", "sora-logo-blue.png"),
        os.path.join(REPO_ROOT, "assets", "images", "sora-logo.png"),
        "/home/omer/Uygulama/assets/images/sora-logo-blue.png",
        "/home/omer/Uygulama/assets/images/sora-logo.png",
    ):
        if os.path.isfile(candidate):
            return candidate
    return None


CSS = b"""
.sora-card {
  background-color: @theme_base_color;
  border: 1px solid alpha(@theme_fg_color, 0.14);
  border-radius: 12px;
  padding: 14px;
}
.sora-kpi-card {
  background-color: @theme_base_color;
  border: 1px solid alpha(#2F80ED, 0.28);
  border-radius: 12px;
  padding: 14px;
}
.sora-kpi-value {
  font-weight: 800;
  font-size: 20px;
  color: #2F80ED;
}
.sora-kpi-label {
  font-weight: 600;
  color: alpha(@theme_fg_color, 0.72);
}
.sora-section-title {
  font-weight: bold;
  font-size: large;
}
.sora-room-title { font-weight: bold; font-size: larger; }
.sora-dim { color: alpha(@theme_fg_color, 0.65); }
.sora-empty { font-size: x-large; color: alpha(@theme_fg_color, 0.55); }
.sora-error { color: #c62828; font-weight: bold; }
.sora-approved { color: #2e7d32; font-weight: bold; }
.sora-rejected { color: #c62828; font-weight: bold; }
.sora-thumb-frame { background-color: alpha(@theme_fg_color, 0.06); border-radius: 8px; }
.sora-login-title { font-weight: bold; font-size: x-large; }
.sora-sidebar { border-right: 1px solid alpha(@theme_fg_color, 0.12); }
"""


class RequestCard(Gtk.FlowBoxChild):
    def __init__(self, window, row):
        super().__init__()
        self.window = window
        self.row = row
        self.alive = True
        self.original = None
        self.set_valign(Gtk.Align.START)
        self.connect("destroy", self._on_destroy)

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        box.get_style_context().add_class("sora-card")
        box.set_size_request(THUMB_WIDTH + 24, -1)
        self.add(box)

        title = Gtk.Label(label=row.get("room_title") or "Adsız oda", xalign=0)
        title.set_ellipsize(Pango.EllipsizeMode.END)
        title.set_max_width_chars(26)
        title.get_style_context().add_class("sora-room-title")
        box.pack_start(title, False, False, 0)

        requester = Gtk.Label(label="İsteyen: %s" % (row.get("requester_name") or "Sora kullanıcısı"), xalign=0)
        requester.set_ellipsize(Pango.EllipsizeMode.END)
        box.pack_start(requester, False, False, 0)

        sent = Gtk.Label(label="Gönderim: %s" % format_local_time(row.get("created_at")), xalign=0)
        sent.get_style_context().add_class("sora-dim")
        box.pack_start(sent, False, False, 0)

        status = row.get("status") or "pending"
        if status != "pending":
            text = "Onaylandı" if status == "approved" else "Reddedildi"
            if row.get("reviewed_at"):
                text += " · " + format_local_time(row.get("reviewed_at"))
            status_label = Gtk.Label(label=text, xalign=0)
            status_label.get_style_context().add_class("sora-approved" if status == "approved" else "sora-rejected")
            box.pack_start(status_label, False, False, 0)

        self.thumb_event = Gtk.EventBox()
        self.thumb_event.set_tooltip_text("Büyütmek için tıklayın")
        self.thumb_event.connect("button-release-event", self._on_thumb_clicked)
        self.thumb_stack = Gtk.Stack()
        self.thumb_stack.get_style_context().add_class("sora-thumb-frame")
        self.thumb_stack.set_size_request(THUMB_WIDTH, PLACEHOLDER_HEIGHT)
        spinner = Gtk.Spinner()
        spinner.start()
        self.thumb_stack.add_named(spinner, "loading")
        self.thumb_error = Gtk.Label(label="")
        self.thumb_error.set_line_wrap(True)
        self.thumb_error.set_max_width_chars(28)
        self.thumb_error.get_style_context().add_class("sora-dim")
        self.thumb_stack.add_named(self.thumb_error, "error")
        self.thumb_image = Gtk.Image()
        self.thumb_stack.add_named(self.thumb_image, "image")
        self.thumb_event.add(self.thumb_stack)
        box.pack_start(self.thumb_event, False, False, 4)

        self.reject_button = None
        self.approve_button = None
        if status == "pending":
            buttons = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8, homogeneous=True)
            self.reject_button = Gtk.Button(label="Reddet")
            self.reject_button.get_style_context().add_class("destructive-action")
            self.reject_button.connect("clicked", lambda _b: self.window.on_reject_bg(self))
            self.approve_button = Gtk.Button(label="Onayla")
            self.approve_button.get_style_context().add_class("suggested-action")
            self.approve_button.connect("clicked", lambda _b: self.window.on_approve_bg(self))
            buttons.pack_start(self.reject_button, True, True, 0)
            buttons.pack_start(self.approve_button, True, True, 0)
            box.pack_start(buttons, False, False, 4)

        self.show_all()
        self.thumb_stack.set_visible_child_name("loading")

    def _on_destroy(self, *_args):
        self.alive = False

    def _on_thumb_clicked(self, _widget, event):
        if event.button == 1 and self.original is not None:
            ImageViewer(self.window, self.original, self.row)
        elif event.button == 1 and self.thumb_stack.get_visible_child_name() == "error":
            self.window.load_thumbnail(self, force=True)
        return True

    def set_pixbuf(self, pixbuf):
        if not self.alive:
            return
        self.original = pixbuf
        thumb = scale_to_fit(pixbuf, THUMB_WIDTH, THUMB_MAX_HEIGHT)
        self.thumb_image.set_from_pixbuf(thumb)
        self.thumb_stack.set_size_request(THUMB_WIDTH, thumb.get_height())
        self.thumb_stack.set_visible_child_name("image")

    def set_image_error(self, message):
        if not self.alive:
            return
        self.thumb_error.set_text("%s\n(Tekrar denemek için tıklayın)" % message)
        self.thumb_stack.set_visible_child_name("error")

    def set_busy(self, busy):
        for btn in (self.reject_button, self.approve_button):
            if btn is not None:
                btn.set_sensitive(not busy)


class ImageViewer(Gtk.Window):
    def __init__(self, parent, pixbuf, row):
        super().__init__(title="%s · %s" % (row.get("room_title") or "Oda", row.get("requester_name") or ""))
        self.set_transient_for(parent)
        self.set_destroy_with_parent(True)
        self.set_type_hint(Gdk.WindowTypeHint.DIALOG)
        scaled = scale_to_fit(pixbuf, 860, 860) if (pixbuf.get_width() > 860 or pixbuf.get_height() > 860) else pixbuf
        event = Gtk.EventBox()
        event.add(Gtk.Image.new_from_pixbuf(scaled))
        event.connect("button-release-event", lambda *_a: self.destroy())
        self.add(event)
        self.connect("key-press-event", lambda _w, e: self.destroy() if e.keyval == Gdk.KEY_Escape else False)
        self.set_default_size(scaled.get_width(), scaled.get_height())
        self.show_all()


class MainWindow(Gtk.ApplicationWindow):
    def __init__(self, app, client=None, config_error=None, autoload=True):
        super().__init__(application=app, title=APP_TITLE)
        self.app = app
        self.set_default_size(1320, 860)
        logo = find_logo()
        if logo:
            try:
                self.set_icon_from_file(logo)
            except GLib.Error:
                pass

        self.client = client
        self.config_error = config_error
        if autoload:
            try:
                self.client = SupabaseClient(load_config())
            except ConfigError as exc:
                self.config_error = str(exc)

        self.executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="sora-admin")
        self.image_cache = OrderedDict()
        self.bg_cards = []
        self.bg_status = "pending"
        self.operation_generation = 0
        self.refreshing = False
        self.known_pending = None
        self.switch_value = False
        self.switch_syncing = False
        self.switch_busy = False
        self.info_timeout_id = 0
        self.selected_user = None
        self.users_by_id = {}
        self.my_role = "admin"

        self._build_header()
        self._build_body()
        self.connect("destroy", self._on_destroy)
        self.tick_id = GLib.timeout_add_seconds(REFRESH_SECONDS, self._on_tick)

        if self.client is None:
            self._show_view("config")
        elif self.client.has_session():
            self._show_view("main")
            self.refresh_all()
        else:
            self._show_view("login")

    def _build_header(self):
        header = Gtk.HeaderBar()
        header.set_show_close_button(True)
        header.set_title(APP_TITLE)
        self.header = header
        self.set_titlebar(header)

        switch_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        switch_label = Gtk.Label(label="Oda arka plan yükleme")
        self.switch = Gtk.Switch()
        self.switch.set_valign(Gtk.Align.CENTER)
        self.switch.set_sensitive(False)
        self.switch.connect("state-set", self._on_switch_state_set)
        switch_box.pack_start(switch_label, False, False, 0)
        switch_box.pack_start(self.switch, False, False, 0)
        header.pack_start(switch_box)

        self.logout_button = Gtk.Button(label="Çıkış yap")
        self.logout_button.connect("clicked", self._on_logout)
        header.pack_end(self.logout_button)

        self.refresh_button = Gtk.Button.new_from_icon_name("view-refresh-symbolic", Gtk.IconSize.BUTTON)
        self.refresh_button.set_tooltip_text("Tüm verileri yenile (F5)")
        self.refresh_button.connect("clicked", lambda _b: self.refresh_all())
        header.pack_end(self.refresh_button)

        self.header_spinner = Gtk.Spinner()
        header.pack_end(self.header_spinner)

        self.header_controls = [switch_box, self.logout_button, self.refresh_button]
        header.show_all()
        self.connect("key-press-event", self._on_key)

    def _build_body(self):
        root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.add(root)

        self.info_bar = Gtk.InfoBar()
        self.info_bar.set_show_close_button(True)
        self.info_label = Gtk.Label(label="", xalign=0)
        self.info_label.set_line_wrap(True)
        self.info_label.set_selectable(True)
        self.info_bar.get_content_area().pack_start(self.info_label, True, True, 0)
        self.info_bar.connect("response", lambda *_a: self.hide_message())
        root.pack_start(self.info_bar, False, False, 0)

        self.stack = Gtk.Stack()
        self.stack.set_transition_type(Gtk.StackTransitionType.CROSSFADE)
        root.pack_start(self.stack, True, True, 0)

        self.stack.add_named(self._build_config_view(), "config")
        self.stack.add_named(self._build_login_view(), "login")
        self.stack.add_named(self._build_admin_shell(), "main")
        root.show_all()
        self.info_bar.set_no_show_all(True)
        self.info_bar.hide()

    def _build_config_view(self):
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        box.set_halign(Gtk.Align.CENTER)
        box.set_valign(Gtk.Align.CENTER)
        title = Gtk.Label(label="Yapılandırma eksik")
        title.get_style_context().add_class("sora-login-title")
        box.pack_start(title, False, False, 0)
        label = Gtk.Label(label=self.config_error or "")
        label.set_line_wrap(True)
        label.set_max_width_chars(70)
        label.set_selectable(True)
        box.pack_start(label, False, False, 0)
        return box

    def _build_login_view(self):
        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        outer.set_halign(Gtk.Align.CENTER)
        outer.set_valign(Gtk.Align.CENTER)
        outer.set_size_request(380, -1)

        logo = find_logo()
        if logo:
            try:
                pix = GdkPixbuf.Pixbuf.new_from_file_at_scale(logo, 96, 96, True)
                outer.pack_start(Gtk.Image.new_from_pixbuf(pix), False, False, 0)
            except GLib.Error:
                pass
        title = Gtk.Label(label="Sora Admin Panel")
        title.get_style_context().add_class("sora-login-title")
        outer.pack_start(title, False, False, 0)
        subtitle = Gtk.Label(label="Yönetici hesabınızla giriş yapın")
        subtitle.get_style_context().add_class("sora-dim")
        outer.pack_start(subtitle, False, False, 4)

        self.email_entry = Gtk.Entry()
        self.email_entry.set_placeholder_text("Yönetici e-posta adresi")
        prefs = read_json_file(PREFS_PATH) or read_json_file(os.path.join(LEGACY_CONFIG_DIR, "prefs.json")) or {}
        if isinstance(prefs, dict) and prefs.get("last_email"):
            self.email_entry.set_text(prefs["last_email"])
        self.email_entry.connect("activate", lambda _e: self.password_entry.grab_focus())
        outer.pack_start(self.email_entry, False, False, 0)

        self.password_entry = Gtk.Entry()
        self.password_entry.set_placeholder_text("Şifre")
        self.password_entry.set_visibility(False)
        self.password_entry.connect("activate", lambda _e: self._on_login())
        outer.pack_start(self.password_entry, False, False, 0)

        self.login_button = Gtk.Button(label="Giriş yap")
        self.login_button.get_style_context().add_class("suggested-action")
        self.login_button.connect("clicked", lambda _b: self._on_login())
        outer.pack_start(self.login_button, False, False, 4)

        self.login_spinner = Gtk.Spinner()
        outer.pack_start(self.login_spinner, False, False, 0)

        self.login_error = Gtk.Label(label="")
        self.login_error.set_line_wrap(True)
        self.login_error.set_max_width_chars(46)
        self.login_error.get_style_context().add_class("sora-error")
        outer.pack_start(self.login_error, False, False, 0)
        return outer

    def _build_admin_shell(self):
        hbox = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        self.nav_stack = Gtk.Stack()
        self.nav_stack.set_transition_type(Gtk.StackTransitionType.SLIDE_UP_DOWN)

        sidebar = Gtk.StackSidebar()
        sidebar.set_stack(self.nav_stack)
        sidebar.set_size_request(210, -1)
        sidebar.get_style_context().add_class("sora-sidebar")

        self.nav_stack.add_titled(self._build_overview_tab(), "overview", "Genel Bakış")
        self.nav_stack.add_titled(self._build_users_tab(), "users", "Kullanıcı, Coin & Ban")
        self.nav_stack.add_titled(self._build_bans_tab(), "bans", "Yasaklılar Listesi")
        self.nav_stack.add_titled(self._build_rooms_families_tab(), "rooms", "Odalar & Aileler")
        self.nav_stack.add_titled(self._build_reports_transfers_tab(), "reports", "Raporlar & IBAN")
        self.nav_stack.add_titled(self._build_terms_tab(), "terms", "Yasaklı Kelimeler")
        self.nav_stack.add_titled(self._build_backgrounds_tab(), "backgrounds", "Oda Arka Planları")

        hbox.pack_start(sidebar, False, False, 0)
        hbox.pack_start(self.nav_stack, True, True, 0)
        return hbox

    # --- SEKME 1: Genel Bakış + ID ile Hızlı İşlem ---
    def _build_overview_tab(self):
        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        vbox = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        vbox.set_margin_top(18)
        vbox.set_margin_bottom(18)
        vbox.set_margin_start(18)
        vbox.set_margin_end(18)
        scroll.add(vbox)

        heading = Gtk.Label(label="Canlı Sistem Durumu", xalign=0)
        heading.get_style_context().add_class("sora-section-title")
        vbox.pack_start(heading, False, False, 0)

        grid = Gtk.Grid()
        grid.set_column_spacing(12)
        grid.set_row_spacing(12)
        grid.set_column_homogeneous(True)
        vbox.pack_start(grid, False, False, 0)

        self.kpi_labels = {}
        kpi_defs = [
            ("total_users", "Toplam Kullanıcı"),
            ("total_coins", "Dolaşımdaki Coin"),
            ("live_rooms", "Canlı Odalar"),
            ("total_families", "Kurulu Aileler"),
            ("active_bans", "Aktif Oyun Banı"),
            ("active_mutes", "Aktif Susturma"),
            ("open_reports", "Açık Raporlar"),
            ("pending_backgrounds", "Bekleyen Arka Plan"),
        ]
        for idx, (key, title_txt) in enumerate(kpi_defs):
            card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
            card.get_style_context().add_class("sora-kpi-card")
            val_lbl = Gtk.Label(label="—", xalign=0)
            val_lbl.get_style_context().add_class("sora-kpi-value")
            cap_lbl = Gtk.Label(label=title_txt, xalign=0)
            cap_lbl.get_style_context().add_class("sora-kpi-label")
            card.pack_start(val_lbl, False, False, 0)
            card.pack_start(cap_lbl, False, False, 0)
            self.kpi_labels[key] = val_lbl
            grid.attach(card, idx % 4, idx // 4, 1, 1)

        # Hızlı ID ile Coin Gönderme Kartı
        quick_coin = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        quick_coin.get_style_context().add_class("sora-card")
        qc_title = Gtk.Label(label="ID ile Hızlı Coin Gönder / Düşür", xalign=0)
        qc_title.get_style_context().add_class("sora-section-title")
        quick_coin.pack_start(qc_title, False, False, 0)

        qc_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.qc_id_entry = Gtk.Entry()
        self.qc_id_entry.set_placeholder_text("8 haneli Kullanıcı ID veya @kullaniciadi")
        self.qc_id_entry.set_width_chars(26)
        self.qc_amount_entry = Gtk.Entry()
        self.qc_amount_entry.set_placeholder_text("Coin miktarı (örn: 10000000)")
        self.qc_amount_entry.set_width_chars(22)
        self.qc_note_entry = Gtk.Entry()
        self.qc_note_entry.set_placeholder_text("Not (isteğe bağlı)")
        qc_add_btn = Gtk.Button(label="Coin Ekle")
        qc_add_btn.get_style_context().add_class("suggested-action")
        qc_add_btn.connect("clicked", lambda _b: self._on_quick_coin(positive=True))
        qc_sub_btn = Gtk.Button(label="Coin Düşür")
        qc_sub_btn.get_style_context().add_class("destructive-action")
        qc_sub_btn.connect("clicked", lambda _b: self._on_quick_coin(positive=False))
        qc_inspect_btn = Gtk.Button(label="Kullanıcıyı İncele")
        qc_inspect_btn.connect("clicked", self._on_quick_inspect)

        qc_row.pack_start(self.qc_id_entry, False, False, 0)
        qc_row.pack_start(self.qc_amount_entry, False, False, 0)
        qc_row.pack_start(self.qc_note_entry, True, True, 0)
        qc_row.pack_start(qc_add_btn, False, False, 0)
        qc_row.pack_start(qc_sub_btn, False, False, 0)
        qc_row.pack_start(qc_inspect_btn, False, False, 0)
        quick_coin.pack_start(qc_row, False, False, 0)

        qc_presets = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        qc_presets.pack_start(Gtk.Label(label="Hazır tutarlar:"), False, False, 4)
        for label_txt, amt in COIN_PRESETS:
            b = Gtk.Button(label=label_txt)
            b.connect("clicked", lambda _btn, val=amt: self.qc_amount_entry.set_text(format_coins(val)))
            qc_presets.pack_start(b, False, False, 0)
        quick_coin.pack_start(qc_presets, False, False, 0)
        vbox.pack_start(quick_coin, False, False, 0)

        # Hızlı ID ile Banlama Kartı
        quick_ban = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        quick_ban.get_style_context().add_class("sora-card")
        qb_title = Gtk.Label(label="ID ile Hızlı Oyundan Banla / Ban Kaldır", xalign=0)
        qb_title.get_style_context().add_class("sora-section-title")
        quick_ban.pack_start(qb_title, False, False, 0)

        qb_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.qb_id_entry = Gtk.Entry()
        self.qb_id_entry.set_placeholder_text("8 haneli Kullanıcı ID veya @kullaniciadi")
        self.qb_id_entry.set_width_chars(26)
        self.qb_duration_combo = Gtk.ComboBoxText()
        for key, label_txt, _mins in BAN_DURATION_CHOICES:
            if key != "custom":
                self.qb_duration_combo.append(key, label_txt)
        self.qb_duration_combo.set_active_id("permanent")
        self.qb_reason_entry = Gtk.Entry()
        self.qb_reason_entry.set_placeholder_text("Ban sebebi (isteğe bağlı)")
        qb_ban_btn = Gtk.Button(label="Oyundan Banla")
        qb_ban_btn.get_style_context().add_class("destructive-action")
        qb_ban_btn.connect("clicked", self._on_quick_ban)
        qb_unban_btn = Gtk.Button(label="Banı Kaldır")
        qb_unban_btn.connect("clicked", self._on_quick_unban)

        qb_row.pack_start(self.qb_id_entry, False, False, 0)
        qb_row.pack_start(self.qb_duration_combo, False, False, 0)
        qb_row.pack_start(self.qb_reason_entry, True, True, 0)
        qb_row.pack_start(qb_ban_btn, False, False, 0)
        qb_row.pack_start(qb_unban_btn, False, False, 0)
        quick_ban.pack_start(qb_row, False, False, 0)
        vbox.pack_start(quick_ban, False, False, 0)

        return scroll

    # --- SEKME 2: Kullanıcı, Coin & Ban ---
    def _build_users_tab(self):
        paned = Gtk.Paned(orientation=Gtk.Orientation.HORIZONTAL)
        paned.set_position(580)

        # Sol: Arama + Kullanıcı listesi
        left = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        left.set_margin_top(12)
        left.set_margin_bottom(12)
        left.set_margin_start(12)
        left.set_margin_end(6)

        search_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        self.user_search_entry = Gtk.Entry()
        self.user_search_entry.set_placeholder_text("8 haneli ID, @kullaniciadi veya isim ara...")
        self.user_search_entry.connect("activate", lambda _e: self.refresh_users())
        search_btn = Gtk.Button(label="Ara")
        search_btn.get_style_context().add_class("suggested-action")
        search_btn.connect("clicked", lambda _b: self.refresh_users())
        clear_btn = Gtk.Button(label="Tümü")
        clear_btn.connect("clicked", self._on_clear_user_search)
        search_row.pack_start(self.user_search_entry, True, True, 0)
        search_row.pack_start(search_btn, False, False, 0)
        search_row.pack_start(clear_btn, False, False, 0)
        left.pack_start(search_row, False, False, 0)

        # user_id, public_id, display_name, handle_fmt, level_fmt, balance_fmt, status_fmt
        self.users_store = Gtk.ListStore(str, str, str, str, str, str, str)
        self.users_tree = Gtk.TreeView(model=self.users_store)
        self.users_tree.set_headers_visible(True)
        cols = [
            ("Özel ID", 1, 90),
            ("Görünen Ad", 2, 130),
            ("@Kullanıcı", 3, 110),
            ("Sv.", 4, 48),
            ("Coin Bakiyesi", 5, 115),
            ("Durum", 6, 110),
        ]
        for col_title, idx, width in cols:
            renderer = Gtk.CellRendererText()
            renderer.set_property("ellipsize", Pango.EllipsizeMode.END)
            column = Gtk.TreeViewColumn(col_title, renderer, text=idx)
            column.set_resizable(True)
            column.set_min_width(width)
            self.users_tree.append_column(column)
        sel = self.users_tree.get_selection()
        sel.connect("changed", self._on_user_selected)

        tree_scroll = Gtk.ScrolledWindow()
        tree_scroll.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
        tree_scroll.add(self.users_tree)
        left.pack_start(tree_scroll, True, True, 0)
        paned.pack1(left, resize=True, shrink=False)

        # Sağ: Seçili Kullanıcı Kontrol Merkezi
        right_scroll = Gtk.ScrolledWindow()
        right_scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        right = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        right.set_margin_top(12)
        right.set_margin_bottom(12)
        right.set_margin_start(6)
        right.set_margin_end(12)
        right_scroll.add(right)

        # Kimlik Kartı
        profile_card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        profile_card.get_style_context().add_class("sora-card")
        top_id_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.detail_name_lbl = Gtk.Label(label="Listeden bir kullanıcı seçin veya ID girin", xalign=0)
        self.detail_name_lbl.get_style_context().add_class("sora-section-title")
        self.copy_id_btn = Gtk.Button(label="ID Kopyala")
        self.copy_id_btn.set_sensitive(False)
        self.copy_id_btn.connect("clicked", self._on_copy_selected_id)
        self.tx_history_btn = Gtk.Button(label="Coin Geçmişi")
        self.tx_history_btn.set_sensitive(False)
        self.tx_history_btn.connect("clicked", self._on_show_user_transactions)
        top_id_row.pack_start(self.detail_name_lbl, True, True, 0)
        top_id_row.pack_start(self.tx_history_btn, False, False, 0)
        top_id_row.pack_start(self.copy_id_btn, False, False, 0)
        profile_card.pack_start(top_id_row, False, False, 0)

        self.detail_meta_lbl = Gtk.Label(label="8 haneli ID ile doğrudan da işlem yapabilirsiniz.", xalign=0)
        self.detail_meta_lbl.set_selectable(True)
        self.detail_meta_lbl.set_line_wrap(True)
        profile_card.pack_start(self.detail_meta_lbl, False, False, 0)

        self.detail_wallet_lbl = Gtk.Label(label="", xalign=0)
        self.detail_wallet_lbl.set_selectable(True)
        profile_card.pack_start(self.detail_wallet_lbl, False, False, 0)

        self.detail_sanction_lbl = Gtk.Label(label="", xalign=0)
        self.detail_sanction_lbl.set_line_wrap(True)
        profile_card.pack_start(self.detail_sanction_lbl, False, False, 0)
        right.pack_start(profile_card, False, False, 0)

        # Coin Ekle / Düşür Kartı
        coin_card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        coin_card.get_style_context().add_class("sora-card")
        c_title = Gtk.Label(label="Coin Ekle / Düşür (İstediğin Kadar)", xalign=0)
        c_title.get_style_context().add_class("sora-section-title")
        coin_card.pack_start(c_title, False, False, 0)

        id_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        id_row.pack_start(Gtk.Label(label="Hedef ID / @Kullanıcı:"), False, False, 0)
        self.coin_target_entry = Gtk.Entry()
        self.coin_target_entry.set_placeholder_text("8 haneli ID (örn: 95728097) veya @kullanici")
        id_row.pack_start(self.coin_target_entry, True, True, 0)
        coin_card.pack_start(id_row, False, False, 0)

        preset_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        for label_txt, amt in COIN_PRESETS:
            btn = Gtk.Button(label=label_txt)
            btn.connect("clicked", lambda _b, val=amt: self._add_to_coin_entry(val))
            preset_row.pack_start(btn, True, True, 0)
        coin_card.pack_start(preset_row, False, False, 0)

        amt_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.coin_amount_entry = Gtk.Entry()
        self.coin_amount_entry.set_placeholder_text("Miktar girin (örn: 25.000.000 veya 100000000)")
        self.coin_bucket_combo = Gtk.ComboBoxText()
        self.coin_bucket_combo.append("promo", "Promosyon / Hediye")
        self.coin_bucket_combo.append("paid", "Satın Alınmış")
        self.coin_bucket_combo.set_active_id("promo")
        amt_row.pack_start(self.coin_amount_entry, True, True, 0)
        amt_row.pack_start(self.coin_bucket_combo, False, False, 0)
        coin_card.pack_start(amt_row, False, False, 0)

        self.coin_note_entry = Gtk.Entry()
        self.coin_note_entry.set_placeholder_text("İşlem açıklaması (isteğe bağlı, örn: Etkinlik ödülü)")
        coin_card.pack_start(self.coin_note_entry, False, False, 0)

        coin_btns = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8, homogeneous=True)
        add_coin_btn = Gtk.Button(label="Hesaba Coin Ekle")
        add_coin_btn.get_style_context().add_class("suggested-action")
        add_coin_btn.connect("clicked", lambda _b: self._submit_coin_adjustment(positive=True))
        sub_coin_btn = Gtk.Button(label="Hesaptan Coin Düşür")
        sub_coin_btn.get_style_context().add_class("destructive-action")
        sub_coin_btn.connect("clicked", lambda _b: self._submit_coin_adjustment(positive=False))
        coin_btns.pack_start(add_coin_btn, True, True, 0)
        coin_btns.pack_start(sub_coin_btn, True, True, 0)
        coin_card.pack_start(coin_btns, False, False, 0)
        right.pack_start(coin_card, False, False, 0)

        # Ban / Susturma Kartı
        ban_card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        ban_card.get_style_context().add_class("sora-card")
        b_title = Gtk.Label(label="Oyundan Banla / Sustur (Süreli veya Süresiz)", xalign=0)
        b_title.get_style_context().add_class("sora-section-title")
        ban_card.pack_start(b_title, False, False, 0)

        ban_target_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        ban_target_row.pack_start(Gtk.Label(label="Hedef ID / @Kullanıcı:"), False, False, 0)
        self.ban_target_entry = Gtk.Entry()
        self.ban_target_entry.set_placeholder_text("8 haneli ID veya @kullanici")
        ban_target_row.pack_start(self.ban_target_entry, True, True, 0)
        ban_card.pack_start(ban_target_row, False, False, 0)

        ban_opts_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.ban_action_combo = Gtk.ComboBoxText()
        self.ban_action_combo.append("ban", "Oyundan Yasakla (Ban)")
        self.ban_action_combo.append("chat_mute", "Sohbet Susturma (Mute)")
        self.ban_action_combo.append("warning", "Resmi Uyarı")
        self.ban_action_combo.set_active_id("ban")

        self.ban_duration_combo = Gtk.ComboBoxText()
        for key, label_txt, _mins in BAN_DURATION_CHOICES:
            self.ban_duration_combo.append(key, label_txt)
        self.ban_duration_combo.set_active_id("permanent")
        self.ban_duration_combo.connect("changed", self._on_ban_duration_changed)

        self.ban_custom_hours = Gtk.SpinButton.new_with_range(1, 87600, 1)
        self.ban_custom_hours.set_value(24)
        self.ban_custom_hours.set_tooltip_text("Özel süre (Saat cinsinden)")
        self.ban_custom_hours.set_sensitive(False)

        ban_opts_row.pack_start(self.ban_action_combo, True, True, 0)
        ban_opts_row.pack_start(self.ban_duration_combo, True, True, 0)
        ban_opts_row.pack_start(self.ban_custom_hours, False, False, 0)
        ban_card.pack_start(ban_opts_row, False, False, 0)

        self.ban_reason_entry = Gtk.Entry()
        self.ban_reason_entry.set_placeholder_text("Sebep (isteğe bağlı, örn: Küfür / Hile / Spam)")
        ban_card.pack_start(self.ban_reason_entry, False, False, 0)

        ban_btns = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8, homogeneous=True)
        apply_ban_btn = Gtk.Button(label="Yaptırımı Uygula / Banla")
        apply_ban_btn.get_style_context().add_class("destructive-action")
        apply_ban_btn.connect("clicked", self._submit_ban_action)
        revoke_ban_btn = Gtk.Button(label="Aktif Ban / Cezaları Kaldır")
        revoke_ban_btn.connect("clicked", self._submit_unban_action)
        ban_btns.pack_start(apply_ban_btn, True, True, 0)
        ban_btns.pack_start(revoke_ban_btn, True, True, 0)
        ban_card.pack_start(ban_btns, False, False, 0)
        right.pack_start(ban_card, False, False, 0)

        # Kullanıcı Seviyesi Ayarlama Kartı
        lvl_card = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        lvl_card.get_style_context().add_class("sora-card")
        lvl_card.pack_start(Gtk.Label(label="Kullanıcı Seviyesi Ayarla (1-120):"), False, False, 0)
        self.user_level_spin = Gtk.SpinButton.new_with_range(1, 120, 1)
        self.user_level_spin.set_value(1)
        set_lvl_btn = Gtk.Button(label="Seviyeyi Kaydet")
        set_lvl_btn.connect("clicked", self._submit_set_user_level)
        lvl_card.pack_start(self.user_level_spin, False, False, 0)
        lvl_card.pack_end(set_lvl_btn, False, False, 0)
        right.pack_start(lvl_card, False, False, 0)

        paned.pack2(right_scroll, resize=True, shrink=False)
        return paned

    # --- SEKME 3: Yasaklılar Listesi ---
    def _build_bans_tab(self):
        vbox = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        vbox.set_margin_top(14)
        vbox.set_margin_bottom(14)
        vbox.set_margin_start(14)
        vbox.set_margin_end(14)

        top = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        lbl = Gtk.Label(label="Oyun Yaptırımları ve Ban Listesi", xalign=0)
        lbl.get_style_context().add_class("sora-section-title")
        self.bans_only_active_check = Gtk.CheckButton(label="Yalnızca aktif ban ve cezaları göster")
        self.bans_only_active_check.set_active(True)
        self.bans_only_active_check.connect("toggled", lambda _c: self.refresh_sanctions())
        unban_selected_btn = Gtk.Button(label="Seçili Cezayı Kaldır (Unban)")
        unban_selected_btn.get_style_context().add_class("suggested-action")
        unban_selected_btn.connect("clicked", self._on_revoke_selected_sanction_row)
        top.pack_start(lbl, True, True, 0)
        top.pack_start(self.bans_only_active_check, False, False, 0)
        top.pack_start(unban_selected_btn, False, False, 0)
        vbox.pack_start(top, False, False, 0)

        # sanction_id, public_id, display_name, handle, action_fmt, expires_fmt, reason, admin_name, created_fmt
        self.bans_store = Gtk.ListStore(str, str, str, str, str, str, str, str, str)
        self.bans_tree = Gtk.TreeView(model=self.bans_store)
        for title_txt, idx, w in [
            ("Özel ID", 1, 88),
            ("Kullanıcı", 2, 130),
            ("@Handle", 3, 105),
            ("Durum / Tür", 4, 120),
            ("Bitiş", 5, 135),
            ("Sebep", 6, 230),
            ("Uygulayan", 7, 110),
            ("Tarih", 8, 130),
        ]:
            r = Gtk.CellRendererText()
            r.set_property("ellipsize", Pango.EllipsizeMode.END)
            col = Gtk.TreeViewColumn(title_txt, r, text=idx)
            col.set_resizable(True)
            col.set_min_width(w)
            self.bans_tree.append_column(col)

        sc = Gtk.ScrolledWindow()
        sc.add(self.bans_tree)
        vbox.pack_start(sc, True, True, 0)
        return vbox

    # --- SEKME 4: Odalar & Aileler ---
    def _build_rooms_families_tab(self):
        paned = Gtk.Paned(orientation=Gtk.Orientation.VERTICAL)
        paned.set_position(390)

        # Üst: Odalar
        r_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        r_box.set_margin_top(12)
        r_box.set_margin_start(14)
        r_box.set_margin_end(14)
        r_box.set_margin_bottom(6)
        r_top = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        r_lbl = Gtk.Label(label="Sesli Odalar Yönetimi", xalign=0)
        r_lbl.get_style_context().add_class("sora-section-title")
        close_room_btn = Gtk.Button(label="Seçili Odayı Kapat")
        close_room_btn.connect("clicked", lambda _b: self._on_room_action("close"))
        chat_room_btn = Gtk.Button(label="Sohbet Kilidi Aç/Kapat")
        chat_room_btn.connect("clicked", lambda _b: self._on_room_action("toggle_chat"))
        lock_room_btn = Gtk.Button(label="Oda Kilidi Aç/Kapat")
        lock_room_btn.connect("clicked", lambda _b: self._on_room_action("toggle_lock"))
        del_room_btn = Gtk.Button(label="Odayı Kalıcı Sil")
        del_room_btn.get_style_context().add_class("destructive-action")
        del_room_btn.connect("clicked", lambda _b: self._on_room_action("delete"))
        r_top.pack_start(r_lbl, True, True, 0)
        for b in (close_room_btn, chat_room_btn, lock_room_btn, del_room_btn):
            r_top.pack_start(b, False, False, 0)
        r_box.pack_start(r_top, False, False, 0)

        # room_id, state, title, category, host_fmt, listeners, locks_fmt, active_fmt
        self.rooms_store = Gtk.ListStore(str, str, str, str, str, str, str, str)
        self.rooms_tree = Gtk.TreeView(model=self.rooms_store)
        for title_txt, idx, w in [
            ("Durum", 1, 75),
            ("Oda Başlığı", 2, 200),
            ("Kategori", 3, 90),
            ("Ev Sahibi (ID)", 4, 180),
            ("Dinleyici", 5, 75),
            ("Kilitler", 6, 130),
            ("Son Aktiflik", 7, 135),
        ]:
            r = Gtk.CellRendererText()
            r.set_property("ellipsize", Pango.EllipsizeMode.END)
            col = Gtk.TreeViewColumn(title_txt, r, text=idx)
            col.set_resizable(True)
            col.set_min_width(w)
            self.rooms_tree.append_column(col)
        r_sc = Gtk.ScrolledWindow()
        r_sc.add(self.rooms_tree)
        r_box.pack_start(r_sc, True, True, 0)
        paned.pack1(r_box, resize=True, shrink=False)

        # Alt: Aileler
        f_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        f_box.set_margin_top(6)
        f_box.set_margin_start(14)
        f_box.set_margin_end(14)
        f_box.set_margin_bottom(12)
        f_top = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        f_lbl = Gtk.Label(label="Aileler Yönetimi", xalign=0)
        f_lbl.get_style_context().add_class("sora-section-title")
        self.family_xp_entry = Gtk.Entry()
        self.family_xp_entry.set_placeholder_text("Eklenecek Aile XP (örn: 100000)")
        self.family_xp_entry.set_width_chars(22)
        add_fxp_btn = Gtk.Button(label="Seçili Aileye XP Ekle")
        add_fxp_btn.get_style_context().add_class("suggested-action")
        add_fxp_btn.connect("clicked", lambda _b: self._on_family_action("add_xp"))
        del_fam_btn = Gtk.Button(label="Aileyi Dağıt / Sil")
        del_fam_btn.get_style_context().add_class("destructive-action")
        del_fam_btn.connect("clicked", lambda _b: self._on_family_action("delete"))
        f_top.pack_start(f_lbl, True, True, 0)
        f_top.pack_start(self.family_xp_entry, False, False, 0)
        f_top.pack_start(add_fxp_btn, False, False, 0)
        f_top.pack_start(del_fam_btn, False, False, 0)
        f_box.pack_start(f_top, False, False, 0)

        # family_id, code, name, owner_fmt, members, level, xp_fmt, gift_coins_fmt
        self.families_store = Gtk.ListStore(str, str, str, str, str, str, str, str)
        self.families_tree = Gtk.TreeView(model=self.families_store)
        for title_txt, idx, w in [
            ("Aile ID", 1, 90),
            ("Aile Adı", 2, 180),
            ("Kurucu (ID)", 3, 180),
            ("Üye", 4, 60),
            ("Seviye", 5, 65),
            ("Toplam XP", 6, 120),
            ("Hediye Coin Hacmi", 7, 150),
        ]:
            r = Gtk.CellRendererText()
            r.set_property("ellipsize", Pango.EllipsizeMode.END)
            col = Gtk.TreeViewColumn(title_txt, r, text=idx)
            col.set_resizable(True)
            col.set_min_width(w)
            self.families_tree.append_column(col)
        f_sc = Gtk.ScrolledWindow()
        f_sc.add(self.families_tree)
        f_box.pack_start(f_sc, True, True, 0)
        paned.pack2(f_box, resize=True, shrink=False)
        return paned

    # --- SEKME 5: Güvenlik Raporları & IBAN Talepleri ---
    def _build_reports_transfers_tab(self):
        paned = Gtk.Paned(orientation=Gtk.Orientation.VERTICAL)
        paned.set_position(390)

        # Üst: Raporlar
        rep_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        rep_box.set_margin_top(12)
        rep_box.set_margin_start(14)
        rep_box.set_margin_end(14)
        rep_top = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        rep_lbl = Gtk.Label(label="Oyuncu Güvenlik Raporları", xalign=0)
        rep_lbl.get_style_context().add_class("sora-section-title")
        ban_rep_btn = Gtk.Button(label="Hedefi Süresiz Banla & Raporu Kapat")
        ban_rep_btn.get_style_context().add_class("destructive-action")
        ban_rep_btn.connect("clicked", lambda _b: self._on_resolve_selected_report("ban"))
        susp_rep_btn = Gtk.Button(label="7 Gün Uzaklaştır & Kapat")
        susp_rep_btn.connect("clicked", lambda _b: self._on_resolve_selected_report("suspend"))
        dis_rep_btn = Gtk.Button(label="Raporu Reddet")
        dis_rep_btn.connect("clicked", lambda _b: self._on_resolve_selected_report("dismiss"))
        rep_top.pack_start(rep_lbl, True, True, 0)
        rep_top.pack_start(ban_rep_btn, False, False, 0)
        rep_top.pack_start(susp_rep_btn, False, False, 0)
        rep_top.pack_start(dis_rep_btn, False, False, 0)
        rep_box.pack_start(rep_top, False, False, 0)

        # report_id, target_public_id, category, reporter_fmt, target_fmt, details, status, created_fmt
        self.reports_store = Gtk.ListStore(str, str, str, str, str, str, str, str)
        self.reports_tree = Gtk.TreeView(model=self.reports_store)
        for title_txt, idx, w in [
            ("Kategori", 2, 100),
            ("Bildiren", 3, 140),
            ("Şikayet Edilen", 4, 160),
            ("Açıklama", 5, 280),
            ("Durum", 6, 90),
            ("Tarih", 7, 130),
        ]:
            r = Gtk.CellRendererText()
            r.set_property("ellipsize", Pango.EllipsizeMode.END)
            col = Gtk.TreeViewColumn(title_txt, r, text=idx)
            col.set_resizable(True)
            col.set_min_width(w)
            self.reports_tree.append_column(col)
        rep_sc = Gtk.ScrolledWindow()
        rep_sc.add(self.reports_tree)
        rep_box.pack_start(rep_sc, True, True, 0)
        paned.pack1(rep_box, resize=True, shrink=False)

        # Alt: IBAN Talepleri
        tr_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        tr_box.set_margin_top(6)
        tr_box.set_margin_start(14)
        tr_box.set_margin_end(14)
        tr_box.set_margin_bottom(12)
        tr_top = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        tr_lbl = Gtk.Label(label="Bekleyen IBAN Coin Talepleri", xalign=0)
        tr_lbl.get_style_context().add_class("sora-section-title")
        approve_tr_btn = Gtk.Button(label="Seçili Talebi Onayla")
        approve_tr_btn.get_style_context().add_class("suggested-action")
        approve_tr_btn.connect("clicked", lambda _b: self._on_review_selected_transfer(True))
        reject_tr_btn = Gtk.Button(label="Talebi Reddet")
        reject_tr_btn.get_style_context().add_class("destructive-action")
        reject_tr_btn.connect("clicked", lambda _b: self._on_review_selected_transfer(False))
        tr_top.pack_start(tr_lbl, True, True, 0)
        tr_top.pack_start(approve_tr_btn, False, False, 0)
        tr_top.pack_start(reject_tr_btn, False, False, 0)
        tr_box.pack_start(tr_top, False, False, 0)

        # req_id, req_credits_raw, ref_code, user_fmt, credits_fmt, try_fmt, status, created_fmt
        self.transfers_store = Gtk.ListStore(str, int, str, str, str, str, str, str)
        self.transfers_tree = Gtk.TreeView(model=self.transfers_store)
        for title_txt, idx, w in [
            ("Referans Kodu", 2, 120),
            ("Kullanıcı", 3, 180),
            ("Talep Coin", 4, 120),
            ("Tutar (TL)", 5, 100),
            ("Durum", 6, 120),
            ("Tarih", 7, 140),
        ]:
            r = Gtk.CellRendererText()
            col = Gtk.TreeViewColumn(title_txt, r, text=idx)
            col.set_resizable(True)
            col.set_min_width(w)
            self.transfers_tree.append_column(col)
        tr_sc = Gtk.ScrolledWindow()
        tr_sc.add(self.transfers_tree)
        tr_box.pack_start(tr_sc, True, True, 0)
        paned.pack2(tr_box, resize=True, shrink=False)
        return paned

    # --- SEKME 6: Yasaklı Kelimeler ---
    def _build_terms_tab(self):
        vbox = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        vbox.set_margin_top(14)
        vbox.set_margin_bottom(14)
        vbox.set_margin_start(14)
        vbox.set_margin_end(14)

        top = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        lbl = Gtk.Label(label="Sohbet Moderasyon Filtresi (Yasaklı Kelimeler)", xalign=0)
        lbl.get_style_context().add_class("sora-section-title")
        self.term_entry = Gtk.Entry()
        self.term_entry.set_placeholder_text("Yeni yasaklı kelime yazın...")
        self.term_entry.connect("activate", lambda _e: self._on_term_action("add"))
        add_btn = Gtk.Button(label="Kelime Ekle")
        add_btn.get_style_context().add_class("suggested-action")
        add_btn.connect("clicked", lambda _b: self._on_term_action("add"))
        toggle_btn = Gtk.Button(label="Aktif / Pasif Yap")
        toggle_btn.connect("clicked", lambda _b: self._on_term_action("toggle"))
        del_btn = Gtk.Button(label="Kelimeyi Sil")
        del_btn.get_style_context().add_class("destructive-action")
        del_btn.connect("clicked", lambda _b: self._on_term_action("delete"))
        top.pack_start(lbl, True, True, 0)
        top.pack_start(self.term_entry, False, False, 0)
        top.pack_start(add_btn, False, False, 0)
        top.pack_start(toggle_btn, False, False, 0)
        top.pack_start(del_btn, False, False, 0)
        vbox.pack_start(top, False, False, 0)

        self.terms_store = Gtk.ListStore(int, str, str, str)
        self.terms_tree = Gtk.TreeView(model=self.terms_store)
        for title_txt, idx, w in [
            ("ID", 0, 60),
            ("Kelime / İfade", 1, 280),
            ("Durum", 2, 110),
            ("Eklenme Tarihi", 3, 160),
        ]:
            r = Gtk.CellRendererText()
            col = Gtk.TreeViewColumn(title_txt, r, text=idx)
            col.set_resizable(True)
            col.set_min_width(w)
            self.terms_tree.append_column(col)
        sc = Gtk.ScrolledWindow()
        sc.add(self.terms_tree)
        vbox.pack_start(sc, True, True, 0)
        return vbox

    # --- SEKME 7: Oda Arka Plan İnceleme ---
    def _build_backgrounds_tab(self):
        vbox = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        top = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        top.set_margin_top(12)
        top.set_margin_start(16)
        top.set_margin_end(16)
        lbl = Gtk.Label(label="Oda Arka Plan Görsel İstekleri", xalign=0)
        lbl.get_style_context().add_class("sora-section-title")
        self.bg_status_combo = Gtk.ComboBoxText()
        for value, label_txt in STATUS_CHOICES:
            self.bg_status_combo.append(value, label_txt)
        self.bg_status_combo.set_active_id("pending")
        self.bg_status_combo.connect("changed", self._on_bg_status_changed)
        top.pack_start(lbl, True, True, 0)
        top.pack_start(Gtk.Label(label="Filtre:"), False, False, 0)
        top.pack_start(self.bg_status_combo, False, False, 0)
        vbox.pack_start(top, False, False, 0)

        self.bg_stack = Gtk.Stack()
        scroller = Gtk.ScrolledWindow()
        scroller.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        self.flowbox = Gtk.FlowBox()
        self.flowbox.set_selection_mode(Gtk.SelectionMode.NONE)
        self.flowbox.set_valign(Gtk.Align.START)
        self.flowbox.set_max_children_per_line(5)
        self.flowbox.set_column_spacing(14)
        self.flowbox.set_row_spacing(14)
        self.flowbox.set_margin_top(12)
        self.flowbox.set_margin_bottom(12)
        self.flowbox.set_margin_start(16)
        self.flowbox.set_margin_end(16)
        scroller.add(self.flowbox)
        self.bg_stack.add_named(scroller, "list")

        self.bg_empty_label = Gtk.Label(label="Bekleyen arka plan isteği yok")
        self.bg_empty_label.get_style_context().add_class("sora-empty")
        self.bg_stack.add_named(self.bg_empty_label, "empty")
        vbox.pack_start(self.bg_stack, True, True, 0)
        return vbox

    # --- Yardımcılar & İş Parçacığı Yürütme ---
    def run_bg(self, func, on_ok=None, on_err=None):
        generation = self.operation_generation

        def worker():
            try:
                result = func()
            except Exception as exc:  # noqa: BLE001
                if not isinstance(exc, ApiError):
                    exc = ApiError("Beklenmeyen hata: %s" % exc)
                GLib.idle_add(self._dispatch_if_current, generation, on_err, exc)
            else:
                GLib.idle_add(self._dispatch_if_current, generation, on_ok, result)

        threading.Thread(target=worker, daemon=True).start()

    def _dispatch_if_current(self, generation, callback, value):
        if generation != self.operation_generation:
            return False
        if isinstance(value, AuthRequired):
            self._session_lost(str(value))
        elif callback is not None:
            callback(value)
        elif isinstance(value, ApiError):
            self.show_message(str(value), Gtk.MessageType.ERROR)
        return False

    def show_message(self, text, kind=Gtk.MessageType.ERROR, timeout=0):
        if self.info_timeout_id:
            GLib.source_remove(self.info_timeout_id)
            self.info_timeout_id = 0
        self.info_label.set_text(text)
        self.info_bar.set_message_type(kind)
        self.info_bar.show()
        self.info_label.show()
        if hasattr(self.info_bar, "set_revealed"):
            self.info_bar.set_revealed(True)
        if timeout:
            self.info_timeout_id = GLib.timeout_add_seconds(timeout, self._auto_hide)

    def _auto_hide(self):
        self.info_timeout_id = 0
        self.hide_message()
        return False

    def hide_message(self):
        if self.info_timeout_id:
            GLib.source_remove(self.info_timeout_id)
            self.info_timeout_id = 0
        self.info_bar.hide()

    def _show_view(self, name):
        self.stack.set_visible_child_name(name)
        logged_in = name == "main"
        for widget in self.header_controls:
            widget.set_visible(logged_in)
        if logged_in:
            self.header.set_subtitle(self.client.email if self.client else None)
        else:
            self.header.set_subtitle(None)
            self.header_spinner.stop()

    def _session_lost(self, message):
        if self.client is not None:
            self.client.clear_session()
        self.operation_generation += 1
        self.hide_message()
        self.login_error.set_text(message or "Oturum süresi doldu. Lütfen tekrar giriş yapın.")
        self._show_view("login")

    def _on_key(self, _widget, event):
        if event.keyval == Gdk.KEY_F5 and self.stack.get_visible_child_name() == "main":
            self.refresh_all()
            return True
        return False

    def _on_destroy(self, *_args):
        self.operation_generation += 1
        if self.tick_id:
            GLib.source_remove(self.tick_id)
            self.tick_id = 0
        self.executor.shutdown(wait=False)

    # --- Giriş / Çıkış ---
    def _on_login(self):
        email = self.email_entry.get_text().strip()
        password = self.password_entry.get_text()
        if not email or not password:
            self.login_error.set_text("E-posta ve şifre gerekli.")
            return
        self.login_error.set_text("")
        self.login_button.set_sensitive(False)
        self.login_spinner.start()
        client = self.client

        def job():
            client.sign_in(email, password)
            try:
                client.get_dashboard_summary()
            except ApiError as exc:
                if exc.is_admin_error:
                    token = (client.session or {}).get("access_token")
                    client.clear_session()
                    client.sign_out_remote(token)
                raise
            return email

        def done(_email):
            self.login_spinner.stop()
            self.login_button.set_sensitive(True)
            self.password_entry.set_text("")
            try:
                write_private_json(PREFS_PATH, {"last_email": email})
            except OSError:
                pass
            self._show_view("main")
            self.refresh_all()

        def failed(exc):
            self.login_spinner.stop()
            self.login_button.set_sensitive(True)
            self.login_error.set_text(str(exc))

        self.run_bg(job, done, failed)

    def _on_logout(self, *_args):
        token = (self.client.session or {}).get("access_token") if self.client else None
        self._session_lost("Çıkış yapıldı.")
        if token:
            client = self.client
            threading.Thread(target=client.sign_out_remote, args=(token,), daemon=True).start()

    # --- Yenileme ---
    def _on_tick(self):
        if (self.client is not None and self.client.has_session()
                and self.stack.get_visible_child_name() == "main" and not self.refreshing):
            self.refresh_all(silent=True)
        return True

    def refresh_all(self, silent=False):
        if self.client is None or not self.client.has_session():
            return
        self.refreshing = True
        self.header_spinner.start()
        client = self.client
        query = self.user_search_entry.get_text().strip()
        only_active_bans = self.bans_only_active_check.get_active()
        bg_status = self.bg_status

        def job():
            summary = client.get_dashboard_summary()
            users = client.search_users(query, 80)
            bans = client.list_sanctions(only_active_bans, 120)
            rooms = client.list_rooms("all")
            families = client.list_families()
            reports = client.list_safety_reports("open")
            transfers = client.list_bank_transfers("awaiting_transfer")
            terms = client.list_moderation_terms()
            bg_pending = client.list_requests("pending")
            bg_rows = bg_pending if bg_status == "pending" else client.list_requests(bg_status)
            setting = None
            try:
                setting = client.get_setting()
            except ApiError:
                pass
            return {
                "summary": summary,
                "users": users,
                "bans": bans,
                "rooms": rooms,
                "families": families,
                "reports": reports,
                "transfers": transfers,
                "terms": terms,
                "bg_pending": bg_pending,
                "bg_rows": bg_rows,
                "setting": setting,
            }

        def done(data):
            self.refreshing = False
            self.header_spinner.stop()
            self._apply_summary(data["summary"])
            self._apply_users(data["users"])
            self._apply_bans(data["bans"])
            self._apply_rooms(data["rooms"])
            self._apply_families(data["families"])
            self._apply_reports(data["reports"])
            self._apply_transfers(data["transfers"])
            self._apply_terms(data["terms"])
            self._apply_backgrounds(data["bg_rows"], bg_status)
            self._notify_new_bg(data["bg_pending"])
            if data["setting"] is not None and not self.switch_busy:
                self._set_switch(data["setting"])
                self.switch.set_sensitive(True)
            now = datetime.now(LOCAL_TZ)
            self.header.set_subtitle("%s · Rol: %s · Son güncelleme %02d:%02d" % (
                self.client.email or "Yönetici", self.my_role, now.hour, now.minute))

        def failed(exc):
            self.refreshing = False
            self.header_spinner.stop()
            if not silent:
                self.show_message("Veriler yenilenemedi: %s" % exc, Gtk.MessageType.ERROR)

        self.run_bg(job, done, failed)

    def _apply_summary(self, s):
        if not isinstance(s, dict):
            return
        self.my_role = s.get("my_role") or "admin"
        for key, lbl in self.kpi_labels.items():
            val = s.get(key, 0)
            lbl.set_text(format_coins(val))

    def _apply_users(self, rows):
        prev_uid = (self.selected_user or {}).get("user_id")
        self.users_store.clear()
        self.users_by_id.clear()
        reselect_iter = None
        for r in rows:
            uid = r.get("user_id") or ""
            self.users_by_id[uid] = r
            it = self.users_store.append([
                uid,
                r.get("public_id") or "—",
                r.get("display_name") or "İsimsiz",
                "@" + (r.get("handle") or ""),
                str(r.get("user_level") or 1),
                format_coins(r.get("balance") or 0),
                format_sanction_badge(r.get("active_sanction_action"), r.get("active_sanction_expires_at")),
            ])
            if prev_uid and uid == prev_uid:
                reselect_iter = it
        if reselect_iter is not None:
            self.users_tree.get_selection().select_iter(reselect_iter)

    def _apply_bans(self, rows):
        self.bans_store.clear()
        for r in rows:
            act = r.get("action") or "ban"
            active = bool(r.get("active"))
            act_txt = ("%s (Aktif)" if active else "%s (Kapandı)") % act.upper()
            exp_txt = "Süresiz" if not r.get("expires_at") else format_local_time(r.get("expires_at"))
            self.bans_store.append([
                r.get("sanction_id") or "",
                r.get("public_id") or "—",
                r.get("display_name") or "",
                "@" + (r.get("handle") or ""),
                act_txt,
                exp_txt,
                r.get("reason") or "",
                r.get("admin_name") or "Yönetici",
                format_local_time(r.get("created_at")),
            ])

    def _apply_rooms(self, rows):
        self.rooms_store.clear()
        for r in rows:
            locks = []
            if r.get("room_locked"):
                locks.append("Oda Kilitli")
            if r.get("chat_locked"):
                locks.append("Sohbet Kilitli")
            host_txt = "%s (%s)" % (r.get("host_name") or "?", r.get("host_public_id") or "—")
            self.rooms_store.append([
                r.get("room_id") or "",
                (r.get("state") or "").upper(),
                r.get("title") or "Adsız Oda",
                r.get("category") or "Sohbet",
                host_txt,
                str(r.get("listener_count") or 0),
                ", ".join(locks) if locks else "Açık",
                format_local_time(r.get("last_active_at")),
            ])

    def _apply_families(self, rows):
        self.families_store.clear()
        for r in rows:
            owner_txt = "%s (%s)" % (r.get("owner_name") or "?", r.get("owner_public_id") or "—")
            self.families_store.append([
                r.get("family_id") or "",
                r.get("family_code") or "—",
                r.get("name") or "",
                owner_txt,
                str(r.get("member_count") or 0),
                "Sv. %s" % (r.get("level") or 1),
                format_coins(r.get("xp") or 0),
                format_coins(r.get("gift_coins_total") or 0),
            ])

    def _apply_reports(self, rows):
        self.reports_store.clear()
        for r in rows:
            rep_txt = "%s (%s)" % (r.get("reporter_name") or "?", r.get("reporter_public_id") or "—")
            tgt_txt = "%s (%s)" % (r.get("target_name") or "—", r.get("target_public_id") or "—")
            self.reports_store.append([
                r.get("report_id") or "",
                r.get("target_public_id") or "",
                r.get("category") or "",
                rep_txt,
                tgt_txt,
                r.get("details") or "",
                r.get("status") or "",
                format_local_time(r.get("created_at")),
            ])

    def _apply_transfers(self, rows):
        self.transfers_store.clear()
        for r in rows:
            uid_txt = "%s (%s)" % (r.get("display_name") or r.get("user_id") or "Kullanıcı", r.get("handle") or "")
            credits = int(r.get("requested_credits") or 0)
            self.transfers_store.append([
                r.get("id") or "",
                credits,
                r.get("reference_code") or "—",
                uid_txt,
                format_coins(credits),
                "%s TL" % (r.get("amount_try") or 0),
                r.get("status") or "",
                format_local_time(r.get("created_at")),
            ])

    def _apply_terms(self, rows):
        self.terms_store.clear()
        for r in rows:
            self.terms_store.append([
                int(r.get("term_id") or 0),
                r.get("term") or "",
                "Aktif" if r.get("enabled") else "Pasif",
                format_local_time(r.get("created_at")),
            ])

    # --- Kullanıcı Arama & Seçim İşlemleri ---
    def refresh_users(self):
        q = self.user_search_entry.get_text().strip()
        self.run_bg(lambda: self.client.search_users(q, 80), self._apply_users)

    def _on_clear_user_search(self, *_args):
        self.user_search_entry.set_text("")
        self.refresh_users()

    def _on_user_selected(self, selection):
        model, treeiter = selection.get_selected()
        if treeiter is None:
            return
        uid = model[treeiter][0]
        user = self.users_by_id.get(uid)
        if not user:
            return
        self.selected_user = user
        pid = user.get("public_id") or uid
        self.copy_id_btn.set_sensitive(True)
        self.tx_history_btn.set_sensitive(True)
        self.coin_target_entry.set_text(pid)
        self.ban_target_entry.set_text(pid)
        self.user_level_spin.set_value(int(user.get("user_level") or 1))

        role_badge = " · [%s]" % user["admin_role"].upper() if user.get("admin_role") else ""
        self.detail_name_lbl.set_text("%s (@%s)%s" % (
            user.get("display_name") or "İsimsiz", user.get("handle") or "", role_badge))
        fam_txt = "%s (ID: %s)" % (user["family_name"], user.get("family_code") or "—") if user.get("family_name") else "Ailesi yok"
        self.detail_meta_lbl.set_text(
            "Özel 8 Haneli ID: %s   |   Seviye: %s (%s XP)   |   Aile: %s   |   Kayıt: %s" % (
                user.get("public_id") or "—",
                user.get("user_level") or 1,
                format_coins(user.get("user_xp") or 0),
                fam_txt,
                format_local_time(user.get("created_at")),
            )
        )
        self.detail_wallet_lbl.set_text(
            "Toplam Coin: %s   (Promosyon/Hediye: %s  ·  Satın Alınmış: %s)" % (
                format_coins(user.get("balance") or 0),
                format_coins(user.get("promo_balance") or 0),
                format_coins(user.get("paid_balance") or 0),
            )
        )
        s_act = user.get("active_sanction_action")
        if s_act:
            self.detail_sanction_lbl.set_text("AKTİF YAPTIRIM: %s — Sebep: %s" % (
                format_sanction_badge(s_act, user.get("active_sanction_expires_at")),
                user.get("active_sanction_reason") or "—",
            ))
        else:
            self.detail_sanction_lbl.set_text("Ceza durumu: Temiz (Aktif ban veya susturma yok)")

    def _on_copy_selected_id(self, *_args):
        if not self.selected_user:
            return
        pid = self.selected_user.get("public_id") or self.selected_user.get("user_id") or ""
        clip = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
        clip.set_text(pid, -1)
        self.show_message("Kullanıcı ID panoya kopyalandı: %s" % pid, Gtk.MessageType.INFO, timeout=3)

    def _add_to_coin_entry(self, delta):
        cur = parse_coin_input(self.coin_amount_entry.get_text())
        self.coin_amount_entry.set_text(format_coins(cur + delta))

    def _submit_coin_adjustment(self, positive=True):
        target = self.coin_target_entry.get_text().strip()
        amount = parse_coin_input(self.coin_amount_entry.get_text())
        bucket = self.coin_bucket_combo.get_active_id() or "promo"
        note = self.coin_note_entry.get_text().strip()
        if not target:
            self.show_message("Lütfen 8 haneli Kullanıcı ID veya @kullaniciadi girin.", Gtk.MessageType.WARNING)
            return
        if amount <= 0:
            self.show_message("Lütfen 0'dan büyük bir coin miktarı girin.", Gtk.MessageType.WARNING)
            return
        delta = amount if positive else -amount
        req_key = str(uuid.uuid4())

        def done(res):
            if not res:
                return
            self.coin_amount_entry.set_text("")
            self.coin_note_entry.set_text("")
            self.show_message(
                "%s (@%s, ID: %s) hesabına %s%s coin uygulandı. Yeni bakiye: %s coin." % (
                    res.get("display_name") or "",
                    res.get("handle") or "",
                    res.get("public_id") or "",
                    "+" if int(res.get("applied_delta") or 0) > 0 else "",
                    format_coins(res.get("applied_delta") or 0),
                    format_coins(res.get("balance") or 0),
                ),
                Gtk.MessageType.INFO,
                timeout=6,
            )
            self.refresh_all(silent=True)

        self.run_bg(
            lambda: self.client.adjust_user_coins(target, delta, bucket, note, req_key),
            done,
        )

    def _on_quick_coin(self, positive=True):
        target = self.qc_id_entry.get_text().strip()
        amount = parse_coin_input(self.qc_amount_entry.get_text())
        note = self.qc_note_entry.get_text().strip()
        if not target or amount <= 0:
            self.show_message("8 haneli Kullanıcı ID ve geçerli bir coin miktarı girin.", Gtk.MessageType.WARNING)
            return
        delta = amount if positive else -amount
        req_key = str(uuid.uuid4())

        def done(res):
            self.qc_amount_entry.set_text("")
            self.show_message(
                "%s (ID: %s) yeni bakiyesi: %s coin." % (
                    res.get("display_name") or "",
                    res.get("public_id") or "",
                    format_coins(res.get("balance") or 0),
                ),
                Gtk.MessageType.INFO,
                timeout=6,
            )
            self.refresh_all(silent=True)

        self.run_bg(lambda: self.client.adjust_user_coins(target, delta, "promo", note, req_key), done)

    def _on_quick_inspect(self, *_args):
        target = self.qc_id_entry.get_text().strip()
        if not target:
            self.show_message("İncelemek için 8 haneli ID veya @kullaniciadi yazın.", Gtk.MessageType.WARNING)
            return
        self.user_search_entry.set_text(target)
        self.nav_stack.set_visible_child_name("users")
        self.refresh_users()

    def _on_ban_duration_changed(self, combo):
        self.ban_custom_hours.set_sensitive(combo.get_active_id() == "custom")

    def _resolve_duration_minutes(self, combo, custom_spin=None):
        sel_id = combo.get_active_id() or "permanent"
        if sel_id == "custom" and custom_spin is not None:
            return int(custom_spin.get_value_as_int()) * 60
        for key, _lbl, mins in BAN_DURATION_CHOICES:
            if key == sel_id:
                return mins
        return None

    def _submit_ban_action(self, *_args):
        target = self.ban_target_entry.get_text().strip()
        action = self.ban_action_combo.get_active_id() or "ban"
        mins = self._resolve_duration_minutes(self.ban_duration_combo, self.ban_custom_hours)
        reason = self.ban_reason_entry.get_text().strip()
        if not target:
            self.show_message("Banlanacak kullanıcının 8 haneli ID'sini veya @kullanici adını girin.", Gtk.MessageType.WARNING)
            return

        dur_text = "SÜRESİZ" if not mins else "%d dakika" % mins
        dialog = Gtk.MessageDialog(
            transient_for=self, modal=True, message_type=Gtk.MessageType.WARNING,
            buttons=Gtk.ButtonsType.NONE, text="Yaptırım uygulansın mı?"
        )
        dialog.format_secondary_text("Hedef: %s\nİşlem: %s (%s)" % (target, action.upper(), dur_text))
        dialog.add_button("Vazgeç", Gtk.ResponseType.CANCEL)
        ok_btn = dialog.add_button("Onayla ve Uygula", Gtk.ResponseType.OK)
        ok_btn.get_style_context().add_class("destructive-action")
        resp = dialog.run()
        dialog.destroy()
        if resp != Gtk.ResponseType.OK:
            return

        def done(res):
            self.ban_reason_entry.set_text("")
            exp_txt = "Süresiz" if res.get("is_permanent") else format_local_time(res.get("expires_at"))
            self.show_message(
                "%s (ID: %s) için %s uygulandı (%s)." % (
                    res.get("display_name") or "", res.get("public_id") or "", action.upper(), exp_txt
                ),
                Gtk.MessageType.INFO,
                timeout=6,
            )
            self.refresh_all(silent=True)

        self.run_bg(lambda: self.client.apply_sanction(target, action, mins, reason), done)

    def _submit_unban_action(self, *_args):
        target = self.ban_target_entry.get_text().strip()
        if not target:
            self.show_message("Banı kaldırılacak kullanıcının ID'sini girin.", Gtk.MessageType.WARNING)
            return

        def done(count):
            self.show_message(
                "%s için %s aktif yaptırım kaldırıldı." % (target, count or 0),
                Gtk.MessageType.INFO, timeout=5
            )
            self.refresh_all(silent=True)

        self.run_bg(lambda: self.client.revoke_sanctions(identifier=target), done)

    def _on_quick_ban(self, *_args):
        target = self.qb_id_entry.get_text().strip()
        if not target:
            self.show_message("8 haneli Kullanıcı ID veya @kullaniciadi girin.", Gtk.MessageType.WARNING)
            return
        mins = self._resolve_duration_minutes(self.qb_duration_combo)
        reason = self.qb_reason_entry.get_text().strip()

        def done(res):
            self.qb_reason_entry.set_text("")
            exp_txt = "Süresiz" if res.get("is_permanent") else format_local_time(res.get("expires_at"))
            self.show_message(
                "%s (ID: %s) oyundan banlandı (%s)." % (
                    res.get("display_name") or "", res.get("public_id") or "", exp_txt
                ),
                Gtk.MessageType.INFO, timeout=6
            )
            self.refresh_all(silent=True)

        self.run_bg(lambda: self.client.apply_sanction(target, "ban", mins, reason), done)

    def _on_quick_unban(self, *_args):
        target = self.qb_id_entry.get_text().strip()
        if not target:
            self.show_message("8 haneli Kullanıcı ID veya @kullaniciadi girin.", Gtk.MessageType.WARNING)
            return
        self.run_bg(
            lambda: self.client.revoke_sanctions(identifier=target),
            lambda c: (
                self.show_message("%s aktif ceza kaldırıldı." % (c or 0), Gtk.MessageType.INFO, timeout=4),
                self.refresh_all(silent=True),
            ),
        )

    def _submit_set_user_level(self, *_args):
        target = self.coin_target_entry.get_text().strip()
        lvl = self.user_level_spin.get_value_as_int()
        if not target:
            self.show_message("Önce bir kullanıcı seçin veya ID girin.", Gtk.MessageType.WARNING)
            return
        self.run_bg(
            lambda: self.client.set_user_level(target, lvl),
            lambda r: (
                self.show_message(
                    "%s seviyesi Seviye %s (%s XP) olarak güncellendi." % (
                        r.get("display_name") or "", r.get("user_level") or lvl, format_coins(r.get("user_xp") or 0)
                    ),
                    Gtk.MessageType.INFO, timeout=5
                ),
                self.refresh_all(silent=True),
            ),
        )

    def _on_show_user_transactions(self, *_args):
        if not self.selected_user:
            return
        pid = self.selected_user.get("public_id") or self.selected_user.get("user_id")
        name = self.selected_user.get("display_name") or ""

        def done(rows):
            dlg = Gtk.Dialog(title="%s (%s) · Son Coin Hareketleri" % (name, pid), transient_for=self, modal=True)
            dlg.set_default_size(680, 420)
            dlg.add_button("Kapat", Gtk.ResponseType.CLOSE)
            store = Gtk.ListStore(str, str, str, str)
            for tx in rows:
                amt = int(tx.get("amount") or 0)
                store.append([
                    ("+" if amt > 0 else "") + format_coins(amt),
                    tx.get("tx_type") or "",
                    tx.get("description") or "",
                    format_local_time(tx.get("created_at")),
                ])
            tv = Gtk.TreeView(model=store)
            for t_lbl, idx, w in [("Tutar", 0, 120), ("Tür", 1, 110), ("Açıklama", 2, 260), ("Tarih", 3, 140)]:
                r = Gtk.CellRendererText()
                col = Gtk.TreeViewColumn(t_lbl, r, text=idx)
                col.set_min_width(w)
                tv.append_column(col)
            sc = Gtk.ScrolledWindow()
            sc.add(tv)
            dlg.get_content_area().pack_start(sc, True, True, 0)
            dlg.show_all()
            dlg.run()
            dlg.destroy()

        self.run_bg(lambda: self.client.list_user_transactions(pid, 50), done)

    # --- Yasaklılar Sekmesi İşlemleri ---
    def refresh_sanctions(self):
        only_active = self.bans_only_active_check.get_active()
        self.run_bg(lambda: self.client.list_sanctions(only_active, 120), self._apply_bans)

    def _on_revoke_selected_sanction_row(self, *_args):
        model, it = self.bans_tree.get_selection().get_selected()
        if it is None:
            self.show_message("Kaldırmak için listeden bir kayıt seçin.", Gtk.MessageType.WARNING)
            return
        sid = model[it][0]
        self.run_bg(
            lambda: self.client.revoke_sanctions(sanction_id=sid),
            lambda _c: (
                self.show_message("Seçili ceza kaldırıldı.", Gtk.MessageType.INFO, timeout=4),
                self.refresh_all(silent=True),
            ),
        )

    # --- Odalar & Aileler İşlemleri ---
    def _on_room_action(self, action):
        model, it = self.rooms_tree.get_selection().get_selected()
        if it is None:
            self.show_message("Lütfen listeden bir oda seçin.", Gtk.MessageType.WARNING)
            return
        room_id = model[it][0]
        room_title = model[it][2]
        if action == "delete":
            dlg = Gtk.MessageDialog(
                transient_for=self, modal=True, message_type=Gtk.MessageType.WARNING,
                buttons=Gtk.ButtonsType.OK_CANCEL, text="“%s” odası kalıcı olarak silinsin mi?" % room_title
            )
            resp = dlg.run()
            dlg.destroy()
            if resp != Gtk.ResponseType.OK:
                return
        self.run_bg(
            lambda: self.client.manage_room(room_id, action),
            lambda _r: (
                self.show_message("Oda işlemi tamamlandı: %s" % room_title, Gtk.MessageType.INFO, timeout=4),
                self.refresh_all(silent=True),
            ),
        )

    def _on_family_action(self, action):
        model, it = self.families_tree.get_selection().get_selected()
        if it is None:
            self.show_message("Lütfen listeden bir aile seçin.", Gtk.MessageType.WARNING)
            return
        fam_id = model[it][0]
        fam_name = model[it][2]
        xp_delta = 0
        if action == "add_xp":
            xp_delta = parse_coin_input(self.family_xp_entry.get_text())
            if xp_delta <= 0:
                self.show_message("Eklenecek XP miktarını girin.", Gtk.MessageType.WARNING)
                return
        elif action == "delete":
            dlg = Gtk.MessageDialog(
                transient_for=self, modal=True, message_type=Gtk.MessageType.WARNING,
                buttons=Gtk.ButtonsType.OK_CANCEL, text="“%s” ailesi kalıcı olarak silinsin mi?" % fam_name
            )
            resp = dlg.run()
            dlg.destroy()
            if resp != Gtk.ResponseType.OK:
                return
        self.run_bg(
            lambda: self.client.manage_family(fam_id, action, xp_delta),
            lambda _r: (
                self.family_xp_entry.set_text(""),
                self.show_message("Aile işlemi tamamlandı: %s" % fam_name, Gtk.MessageType.INFO, timeout=4),
                self.refresh_all(silent=True),
            ),
        )

    # --- Raporlar & IBAN İşlemleri ---
    def _on_resolve_selected_report(self, mode):
        model, it = self.reports_tree.get_selection().get_selected()
        if it is None:
            self.show_message("Lütfen listeden bir rapor seçin.", Gtk.MessageType.WARNING)
            return
        rep_id = model[it][0]
        target_pid = model[it][1]

        def job():
            if mode == "dismiss":
                return self.client.resolve_report(rep_id, "dismissed", "Yönetici tarafından kapatıldı.")
            if mode == "ban" and target_pid:
                self.client.apply_sanction(target_pid, "ban", None, "Güvenlik raporu sonucu süresiz yasaklama")
                return self.client.resolve_report(rep_id, "actioned", "Hedef kullanıcı süresiz banlandı.")
            if mode == "suspend" and target_pid:
                self.client.apply_sanction(target_pid, "suspend", 10080, "Güvenlik raporu sonucu 7 gün uzaklaştırma")
                return self.client.resolve_report(rep_id, "actioned", "Hedef kullanıcı 7 gün uzaklaştırıldı.")
            return self.client.resolve_report(rep_id, "actioned", "İşlem tamamlandı.")

        self.run_bg(
            job,
            lambda _r: (
                self.show_message("Rapor sonuçlandırıldı.", Gtk.MessageType.INFO, timeout=4),
                self.refresh_all(silent=True),
            ),
        )

    def _on_review_selected_transfer(self, approved):
        model, it = self.transfers_tree.get_selection().get_selected()
        if it is None:
            self.show_message("Lütfen listeden bir IBAN talebi seçin.", Gtk.MessageType.WARNING)
            return
        req_id = model[it][0]
        credits = model[it][1]
        self.run_bg(
            lambda: self.client.review_bank_transfer(
                req_id, approved, credits if approved else None,
                "Sora Admin Panel üzerinden onaylandı" if approved else "Sora Admin Panel üzerinden reddedildi"
            ),
            lambda _r: (
                self.show_message(
                    "IBAN talebi onaylandı ve coin yüklendi." if approved else "IBAN talebi reddedildi.",
                    Gtk.MessageType.INFO, timeout=5
                ),
                self.refresh_all(silent=True),
            ),
        )

    # --- Yasaklı Kelimeler İşlemleri ---
    def _on_term_action(self, action):
        term_txt = self.term_entry.get_text().strip()
        term_id = None
        if action in ("toggle", "delete"):
            model, it = self.terms_tree.get_selection().get_selected()
            if it is None:
                self.show_message("Lütfen listeden bir kelime seçin.", Gtk.MessageType.WARNING)
                return
            term_id = model[it][0]
        elif not term_txt:
            self.show_message("Eklenecek kelimeyi yazın.", Gtk.MessageType.WARNING)
            return
        self.run_bg(
            lambda: self.client.manage_moderation_term(action, term_txt, term_id),
            lambda _r: (
                self.term_entry.set_text("") if action == "add" else None,
                self.show_message("Kelime filtresi güncellendi.", Gtk.MessageType.INFO, timeout=3),
                self.refresh_all(silent=True),
            ),
        )

    # --- Oda Arka Plan İnceleme ---
    def _on_bg_status_changed(self, combo):
        self.bg_status = combo.get_active_id() or "pending"
        self.run_bg(
            lambda: self.client.list_requests(self.bg_status),
            lambda rows: self._apply_backgrounds(rows, self.bg_status),
        )

    def _apply_backgrounds(self, rows, status):
        for card in self.bg_cards:
            card.alive = False
            card.destroy()
        self.bg_cards = []
        if not rows:
            self.bg_stack.set_visible_child_name("empty")
            return
        if status != "pending":
            rows = list(reversed(rows))
        for row in rows:
            card = RequestCard(self, row)
            self.flowbox.add(card)
            self.bg_cards.append(card)
            self.load_thumbnail(card)
        self.bg_stack.set_visible_child_name("list")

    def load_thumbnail(self, card, force=False):
        path = card.row.get("image_path")
        if not path:
            card.set_image_error("Görsel yolu yok.")
            return
        if not force and path in self.image_cache:
            self.image_cache.move_to_end(path)
            card.set_pixbuf(self.image_cache[path])
            return
        card.thumb_stack.set_visible_child_name("loading")
        client = self.client
        gen = self.operation_generation

        def job():
            try:
                pixbuf = pixbuf_from_bytes(client.download_image(path))
            except Exception as exc:  # noqa: BLE001
                GLib.idle_add(self._thumb_err, gen, card, exc)
            else:
                GLib.idle_add(self._thumb_ok, gen, card, path, pixbuf)

        try:
            self.executor.submit(job)
        except RuntimeError:
            pass

    def _thumb_ok(self, gen, card, path, pixbuf):
        if gen != self.operation_generation or not card.alive:
            return False
        self.image_cache[path] = pixbuf
        self.image_cache.move_to_end(path)
        while len(self.image_cache) > IMAGE_CACHE_ITEMS:
            self.image_cache.popitem(last=False)
        card.set_pixbuf(pixbuf)
        return False

    def _thumb_err(self, gen, card, exc):
        if gen != self.operation_generation or not card.alive:
            return False
        card.set_image_error(str(exc))
        return False

    def _notify_new_bg(self, pending):
        ids = {r.get("id") for r in pending}
        if self.known_pending is not None:
            new_rows = [r for r in pending if r.get("id") not in self.known_pending]
            if new_rows and shutil.which("notify-send"):
                icon = find_logo() or "dialog-information"
                try:
                    subprocess.Popen(
                        ["notify-send", "--app-name=" + APP_TITLE, "--icon=" + icon,
                         "Yeni arka plan isteği", "%d yeni istek bekliyor." % len(new_rows)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                    )
                except OSError:
                    pass
        self.known_pending = ids

    def on_approve_bg(self, card):
        card.set_busy(True)
        self.run_bg(
            lambda: self.client.review_background(card.row.get("id"), True, ""),
            lambda _r: (
                self.show_message("Arka plan onaylandı.", Gtk.MessageType.INFO, timeout=4),
                self.refresh_all(silent=True),
            ),
            lambda exc: (card.set_busy(False), self.show_message(str(exc), Gtk.MessageType.ERROR)),
        )

    def on_reject_bg(self, card):
        dialog = Gtk.Dialog(title="Arka planı reddet", transient_for=self, modal=True)
        dialog.add_button("Vazgeç", Gtk.ResponseType.CANCEL)
        rej = dialog.add_button("Reddet", Gtk.ResponseType.OK)
        rej.get_style_context().add_class("destructive-action")
        entry = Gtk.Entry()
        entry.set_placeholder_text("Reddetme notu (isteğe bağlı)")
        area = dialog.get_content_area()
        area.set_margin_top(12)
        area.set_margin_bottom(12)
        area.set_margin_start(12)
        area.set_margin_end(12)
        area.pack_start(entry, False, False, 0)
        dialog.show_all()
        resp = dialog.run()
        note = entry.get_text().strip()
        dialog.destroy()
        if resp == Gtk.ResponseType.OK:
            card.set_busy(True)
            self.run_bg(
                lambda: self.client.review_background(card.row.get("id"), False, note),
                lambda _r: (
                    self.show_message("Arka plan reddedildi.", Gtk.MessageType.INFO, timeout=4),
                    self.refresh_all(silent=True),
                ),
                lambda exc: (card.set_busy(False), self.show_message(str(exc), Gtk.MessageType.ERROR)),
            )

    def _set_switch(self, value):
        self.switch_value = bool(value)
        self.switch_syncing = True
        try:
            self.switch.set_active(self.switch_value)
            self.switch.set_state(self.switch_value)
        finally:
            self.switch_syncing = False

    def _on_switch_state_set(self, switch, state):
        if self.switch_syncing or self.client is None or not self.client.has_session():
            return False
        switch.set_sensitive(False)
        self.switch_busy = True

        def done(val):
            self.switch_busy = False
            self._set_switch(val)
            switch.set_sensitive(True)
            self.show_message(
                "Oda arka plan yükleme açıldı." if val else "Oda arka plan yükleme kapatıldı.",
                Gtk.MessageType.INFO, timeout=4
            )

        def failed(exc):
            self.switch_busy = False
            self._set_switch(self.switch_value)
            switch.set_sensitive(True)
            self.show_message("Ayar değiştirilemedi: %s" % exc, Gtk.MessageType.ERROR)

        self.run_bg(lambda: self.client.set_setting(state), done, failed)
        return True


class AdminPanelApp(Gtk.Application):
    def __init__(self, flags=Gio.ApplicationFlags.FLAGS_NONE, on_activate=None):
        super().__init__(application_id=APP_ID, flags=flags)
        self.window = None
        self.on_activate = on_activate

    def do_startup(self):
        Gtk.Application.do_startup(self)
        provider = Gtk.CssProvider()
        provider.load_from_data(CSS)
        screen = Gdk.Screen.get_default()
        if screen is not None:
            Gtk.StyleContext.add_provider_for_screen(
                screen, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

    def do_activate(self):
        if self.on_activate is not None:
            self.on_activate(self)
            return
        if self.window is None:
            self.window = MainWindow(self)
            self.window.connect("destroy", self._on_window_destroy)
        self.window.present()

    def _on_window_destroy(self, *_args):
        self.window = None


def self_test():
    failures = []

    def check(name, condition):
        print(("  OK " if condition else "  FAIL ") + name)
        if not condition:
            failures.append(name)

    print("Sora Admin Panel · Kendi Kendine Test")
    check("coin biçimlendirme", format_coins(11200000) == "11.200.000" and format_coins(-2500) == "-2.500")
    check("coin ayrıştırma noktalı", parse_coin_input("10.000.000") == 10_000_000)
    check("coin ayrıştırma M soneki", parse_coin_input("25M") == 25_000_000)
    check("coin ayrıştırma K soneki", parse_coin_input("500k") == 500_000)
    check("zaman: UTC -> İstanbul", format_local_time("2026-11-14T18:50:48.123+00:00") == "14 Kas 2026 21:50")
    check("ban etiketi süresiz", format_sanction_badge("ban", None) == "Yasaklı (Süresiz)")
    check("ban etiketi temiz", format_sanction_badge(None, None) == "Temiz")
    check("hata çevirisi: admin", "yönetici yetkisi" in translate_error("Admin access required"))

    with tempfile.TemporaryDirectory() as tmp:
        session_file = os.path.join(tmp, "session.json")
        client = SupabaseClient(Config("https://example.supabase.co/", "k", "test"), session_path=session_file)
        client._store_session({"access_token": "a", "refresh_token": "r", "expires_in": 3600,
                               "user": {"email": "admin@example.com", "id": "u1"}})
        check("oturum 0600 izinli", (os.stat(session_file).st_mode & 0o777) == 0o600)
        client.clear_session()
        check("oturum silindi", not client.has_session())

    ok, _argv = Gtk.init_check(sys.argv[:1])
    if ok:
        def gui_test(app):
            try:
                window = MainWindow(app, client=None, config_error="Test", autoload=False)
                check("pencere başlığı Sora Admin Panel", window.get_title() == "Sora Admin Panel")
                for tab_name in ("overview", "users", "bans", "rooms", "reports", "terms", "backgrounds"):
                    check("sekme mevcut: " + tab_name, window.nav_stack.get_child_by_name(tab_name) is not None)
                window.destroy()
            except Exception as exc:  # noqa: BLE001
                check("arayüz hatasız (%s)" % exc, False)

        test_app = AdminPanelApp(flags=Gio.ApplicationFlags.NON_UNIQUE, on_activate=gui_test)
        test_app.run(sys.argv[:1])

    return 1 if failures else 0


def main(argv):
    if "--self-test" in argv:
        return self_test()
    GLib.set_prgname("sora-admin-panel")
    GLib.set_application_name(APP_TITLE)
    app = AdminPanelApp()
    return app.run([a for a in argv if a != "--self-test"])


if __name__ == "__main__":
    sys.exit(main(sys.argv))
