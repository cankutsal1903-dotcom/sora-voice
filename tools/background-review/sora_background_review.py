#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sora · Arka Plan İnceleme

Sora Voice oda arka plan isteklerini masaüstünden incelemek için küçük bir
GTK 3 uygulaması. Yalnızca standart kütüphane + PyGObject (gi) kullanır.

Kullanım:
    ./sora_background_review.py            # uygulamayı aç
    ./sora_background_review.py --self-test  # ağ kullanmadan iç testleri çalıştır
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
from concurrent.futures import ThreadPoolExecutor
from collections import OrderedDict
from datetime import datetime, timedelta, timezone

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("GdkPixbuf", "2.0")
gi.require_version("Pango", "1.0")
from gi.repository import Gdk, GdkPixbuf, Gio, GLib, Gtk, Pango  # noqa: E402

APP_ID = "com.sora.BackgroundReview"
APP_TITLE = "Sora · Arka Plan İnceleme"
SETTING_KEY = "room_background_uploads_enabled"
BUCKET = "room-backgrounds"
REFRESH_SECONDS = 30
HTTP_TIMEOUT = 25
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
MAX_PREVIEW_EDGE = 1600
IMAGE_CACHE_ITEMS = 8
THUMB_WIDTH = 320
THUMB_MAX_HEIGHT = 568  # 9:16 telefon dikey oranı
PLACEHOLDER_HEIGHT = 420

SCRIPT_PATH = os.path.realpath(__file__)
SCRIPT_DIR = os.path.dirname(SCRIPT_PATH)
REPO_ROOT = os.path.realpath(os.path.join(SCRIPT_DIR, "..", ".."))
CONFIG_DIR = os.path.join(
    os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"),
    "sora-background-review",
)
SESSION_PATH = os.path.join(CONFIG_DIR, "session.json")
PREFS_PATH = os.path.join(CONFIG_DIR, "prefs.json")

URL_KEY = "EXPO_PUBLIC_SUPABASE_URL"
API_KEY_NAMES = ("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "EXPO_PUBLIC_SUPABASE_ANON_KEY")

STATUS_CHOICES = (
    ("pending", "Bekleyen"),
    ("approved", "Onaylanan"),
    ("rejected", "Reddedilen"),
)

TR_MONTHS = ("Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara")

try:
    from zoneinfo import ZoneInfo

    LOCAL_TZ = ZoneInfo("Europe/Istanbul")
except Exception:  # pragma: no cover - zoneinfo/tzdata yoksa
    LOCAL_TZ = timezone(timedelta(hours=3), "TRT")


# ---------------------------------------------------------------------------
# Yapılandırma (.env)
# ---------------------------------------------------------------------------

def parse_env_text(text):
    """Basit .env ayrıştırıcı: KEY=VALUE, `export`, tırnak ve yorum desteği."""
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
    paths.append("/home/omer/Uygulama/.env")
    repo_env = os.path.join(REPO_ROOT, ".env")
    if repo_env not in paths:
        paths.append(repo_env)
    return paths


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

    def __repr__(self):  # anahtarı asla yazdırma
        return "Config(url=%r, key=<gizli>, source=%r)" % (self.url, self.source)


class ConfigError(Exception):
    pass


def load_config():
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
    # Son çare: süreç ortam değişkenleri
    url = os.environ.get(URL_KEY, "").strip()
    key = next((os.environ[k].strip() for k in API_KEY_NAMES if os.environ.get(k, "").strip()), "")
    if url and key:
        return Config(url, key, "ortam değişkenleri")
    raise ConfigError(
        "Supabase ayarları bulunamadı. %s ve %s değerlerini içeren bir .env dosyası gerekli.\n"
        "Bakılan konumlar:\n%s" % (URL_KEY, API_KEY_NAMES[0], "\n".join("  • " + p for p in checked))
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


# ---------------------------------------------------------------------------
# Yardımcılar
# ---------------------------------------------------------------------------

def parse_timestamp(value):
    if not value:
        return None
    text = str(value).strip().replace(" ", "T", 1)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    # Eski Python sürümleri için kesirli saniyeyi 6 haneye normalize et
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
        text += ":00"  # "+03" -> "+03:00"
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


ERROR_TRANSLATIONS = (
    ("admin access required",
     "Bu hesabın yönetici yetkisi yok. Hesabın Supabase'deki app_admins tablosunda olması gerekiyor."),
    ("invalid login credentials", "E-posta veya şifre hatalı."),
    ("email not confirmed", "Bu e-posta adresi henüz doğrulanmamış."),
    ("request already reviewed", "Bu istek zaten incelenmiş."),
    ("request not found", "İstek bulunamadı (silinmiş olabilir)."),
    ("unknown setting", "Bilinmeyen ayar."),
    ("authentication required", "Oturum gerekli. Lütfen tekrar giriş yapın."),
    ("object not found", "Görsel depolamada bulunamadı."),
    ("invalid refresh token", "Oturum süresi doldu. Lütfen tekrar giriş yapın."),
    ("refresh token not found", "Oturum süresi doldu. Lütfen tekrar giriş yapın."),
    ("jwt expired", "Oturum süresi doldu. Lütfen tekrar giriş yapın."),
    ("could not find the function", "Sunucuda gerekli fonksiyon yok. Migration uygulanmış mı?"),
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
    """Oturum yok veya yenilenemedi; kullanıcı tekrar giriş yapmalı."""


def _extract_message(body_bytes):
    try:
        data = json.loads(body_bytes.decode("utf-8", "replace"))
    except ValueError:
        text = body_bytes.decode("utf-8", "replace").strip()
        return text[:300]
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


# ---------------------------------------------------------------------------
# Supabase istemcisi (iş parçacığı güvenli)
# ---------------------------------------------------------------------------

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Auth başlıklarını veya parolayı başka bir adrese taşımayın.
        return None


class SupabaseClient:
    def __init__(self, config, session_path=SESSION_PATH):
        self.config = config
        self.session_path = session_path
        self._lock = threading.Lock()
        self._opener = urllib.request.build_opener(NoRedirect())
        self.session = self._load_session()

    # --- oturum dosyası ---
    def _load_session(self):
        data = read_json_file(self.session_path)
        if (isinstance(data, dict) and data.get("access_token") and data.get("refresh_token")
                and data.get("project_url") == self.config.url):
            os.chmod(self.session_path, 0o600)
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
            try:
                os.unlink(self.session_path)
            except FileNotFoundError:
                pass

    def has_session(self):
        return bool(self.session)

    @property
    def email(self):
        return (self.session or {}).get("email") or ""

    # --- HTTP ---
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
                return  # başka bir iş parçacığı zaten yeniledi
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

    def rpc(self, name, params):
        return self.request("POST", "/rest/v1/rpc/" + name, params)

    # --- uygulama işlemleri ---
    def list_requests(self, status):
        rows = self.rpc("admin_list_room_background_requests", {"p_status": status})
        return rows if isinstance(rows, list) else []

    def review(self, request_id, approve, note=""):
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
        """Sunucu tarafında oturumu kapat (en iyi çaba)."""
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
        raise ApiError("Görsel açılamadı (biçim desteklenmiyor olabilir): %s" % exc.message)
    pixbuf = loader.get_pixbuf()
    if oversized:
        raise ApiError("Görselin piksel boyutu çok büyük (en fazla 40 megapiksel).")
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
    installed = os.path.join(SCRIPT_DIR, "sora-logo.png")
    if os.path.isfile(installed):
        return installed
    for name in ("sora-logo-blue.png", "sora-logo.png"):
        path = os.path.join(REPO_ROOT, "assets", "images", name)
        if os.path.isfile(path):
            return path
    return None


CSS = b"""
.sora-card {
  background-color: @theme_base_color;
  border: 1px solid alpha(@theme_fg_color, 0.14);
  border-radius: 12px;
  padding: 12px;
}
.sora-room-title { font-weight: bold; font-size: larger; }
.sora-dim { color: alpha(@theme_fg_color, 0.65); }
.sora-empty { font-size: x-large; color: alpha(@theme_fg_color, 0.55); }
.sora-error { color: #c62828; }
.sora-approved { color: #2e7d32; font-weight: bold; }
.sora-rejected { color: #c62828; font-weight: bold; }
.sora-thumb-frame { background-color: alpha(@theme_fg_color, 0.06); border-radius: 8px; }
.sora-login-title { font-weight: bold; font-size: x-large; }
"""


# ---------------------------------------------------------------------------
# Arayüz
# ---------------------------------------------------------------------------

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
        title.set_max_width_chars(28)
        title.get_style_context().add_class("sora-room-title")
        title.set_tooltip_text(row.get("room_title") or "")
        box.pack_start(title, False, False, 0)

        requester = Gtk.Label(label="İsteyen: %s" % (row.get("requester_name") or "Sora kullanıcısı"), xalign=0)
        requester.set_ellipsize(Pango.EllipsizeMode.END)
        requester.set_max_width_chars(32)
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
            if row.get("review_note"):
                note = Gtk.Label(label="Not: %s" % row["review_note"], xalign=0)
                note.set_line_wrap(True)
                note.set_max_width_chars(36)
                note.get_style_context().add_class("sora-dim")
                box.pack_start(note, False, False, 0)

        # Küçük resim alanı
        self.thumb_event = Gtk.EventBox()
        self.thumb_event.set_tooltip_text("Büyütmek için tıklayın")
        self.thumb_event.connect("button-release-event", self._on_thumb_clicked)
        self.thumb_event.connect("realize", self._on_thumb_realize)
        self.thumb_stack = Gtk.Stack()
        self.thumb_stack.get_style_context().add_class("sora-thumb-frame")
        self.thumb_stack.set_size_request(THUMB_WIDTH, PLACEHOLDER_HEIGHT)
        spinner = Gtk.Spinner()
        spinner.start()
        self.thumb_stack.add_named(spinner, "loading")
        self.thumb_error = Gtk.Label(label="")
        self.thumb_error.set_line_wrap(True)
        self.thumb_error.set_max_width_chars(30)
        self.thumb_error.set_justify(Gtk.Justification.CENTER)
        self.thumb_error.get_style_context().add_class("sora-dim")
        self.thumb_stack.add_named(self.thumb_error, "error")
        self.thumb_image = Gtk.Image()
        self.thumb_stack.add_named(self.thumb_image, "image")
        self.thumb_event.add(self.thumb_stack)
        box.pack_start(self.thumb_event, False, False, 4)

        path_label = Gtk.Label(label=row.get("image_path") or "", xalign=0)
        path_label.set_ellipsize(Pango.EllipsizeMode.START)
        path_label.set_max_width_chars(36)
        path_label.set_selectable(True)
        path_label.get_style_context().add_class("sora-dim")
        box.pack_start(path_label, False, False, 0)

        self.reject_button = None
        self.approve_button = None
        if status == "pending":
            buttons = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8, homogeneous=True)
            self.reject_button = Gtk.Button(label="Reddet")
            self.reject_button.get_style_context().add_class("destructive-action")
            self.reject_button.connect("clicked", lambda _b: self.window.on_reject(self))
            self.approve_button = Gtk.Button(label="Onayla")
            self.approve_button.get_style_context().add_class("suggested-action")
            self.approve_button.connect("clicked", lambda _b: self.window.on_approve(self))
            buttons.pack_start(self.reject_button, True, True, 0)
            buttons.pack_start(self.approve_button, True, True, 0)
            box.pack_start(buttons, False, False, 4)

        self.show_all()
        self.thumb_stack.set_visible_child_name("loading")

    def _on_destroy(self, *_args):
        self.alive = False

    def _on_thumb_realize(self, widget):
        window = widget.get_window()
        if window is not None:
            cursor = Gdk.Cursor.new_from_name(widget.get_display(), "pointer")
            if cursor is not None:
                window.set_cursor(cursor)

    def _on_thumb_clicked(self, _widget, event):
        if event.button == 1 and self.original is not None:
            self.window.show_large_image(self.original, self.row)
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
        self.thumb_error.set_text("%s\n\n(Tekrar denemek için tıklayın)" % message)
        self.thumb_stack.set_visible_child_name("error")

    def set_busy(self, busy):
        for button in (self.reject_button, self.approve_button):
            if button is not None:
                button.set_sensitive(not busy)


class ImageViewer(Gtk.Window):
    def __init__(self, parent, pixbuf, row):
        super().__init__(title="%s · %s" % (row.get("room_title") or "Oda", row.get("requester_name") or ""))
        self.set_transient_for(parent)
        self.set_modal(False)
        self.set_destroy_with_parent(True)
        self.set_type_hint(Gdk.WindowTypeHint.DIALOG)

        max_w, max_h = 900, 900
        display = parent.get_display()
        gdk_window = parent.get_window()
        if display is not None and gdk_window is not None:
            monitor = display.get_monitor_at_window(gdk_window)
            if monitor is not None:
                area = monitor.get_workarea()
                max_w, max_h = int(area.width * 0.85), int(area.height * 0.85)
        scaled = scale_to_fit(pixbuf, max_w, max_h) if (
            pixbuf.get_width() > max_w or pixbuf.get_height() > max_h) else pixbuf

        event = Gtk.EventBox()
        event.add(Gtk.Image.new_from_pixbuf(scaled))
        event.set_tooltip_text("Kapatmak için tıklayın veya Esc'ye basın · %d×%d piksel" % (
            pixbuf.get_width(), pixbuf.get_height()))
        event.connect("button-release-event", lambda *_a: self.destroy())
        self.add(event)
        self.connect("key-press-event", self._on_key)
        self.set_default_size(scaled.get_width(), scaled.get_height())
        self.show_all()

    def _on_key(self, _widget, event):
        if event.keyval == Gdk.KEY_Escape:
            self.destroy()
            return True
        return False


class MainWindow(Gtk.ApplicationWindow):
    def __init__(self, app, client=None, config_error=None, autoload=True):
        super().__init__(application=app, title=APP_TITLE)
        self.app = app
        self.set_default_size(1120, 820)
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

        self.executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="sora-img")
        self.image_cache = OrderedDict()
        self.cards = []
        self.current_status = "pending"
        self.refresh_generation = 0
        self.operation_generation = 0
        self.refreshing = False
        self.list_signature = None
        self.known_pending = None
        self.switch_value = False
        self.switch_syncing = False
        self.switch_busy = False
        self.info_timeout_id = 0

        self._build_header()
        self._build_body()
        self.connect("destroy", self._on_destroy)

        self.tick_id = GLib.timeout_add_seconds(REFRESH_SECONDS, self._on_tick)

        if self.client is None:
            self._show_view("config")
        elif self.client.has_session():
            self._show_view("main")
            self.refresh()
        else:
            self._show_view("login")

    # --- yapı ---
    def _build_header(self):
        header = Gtk.HeaderBar()
        header.set_show_close_button(True)
        header.set_title(APP_TITLE)
        self.header = header
        self.set_titlebar(header)

        switch_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        switch_label = Gtk.Label(label="Arka plan değiştirme")
        self.switch = Gtk.Switch()
        self.switch.set_valign(Gtk.Align.CENTER)
        self.switch.set_tooltip_text(
            "Açıkken oda sahipleri yeni arka plan yükleyebilir. Kapalıyken yükleme yapılamaz.")
        self.switch.set_sensitive(False)
        self.switch.connect("state-set", self._on_switch_state_set)
        switch_box.pack_start(switch_label, False, False, 0)
        switch_box.pack_start(self.switch, False, False, 0)
        header.pack_start(switch_box)

        self.status_combo = Gtk.ComboBoxText()
        for value, label in STATUS_CHOICES:
            self.status_combo.append(value, label)
        self.status_combo.set_active_id("pending")
        self.status_combo.set_tooltip_text("Gösterilecek istekler")
        self.status_combo.connect("changed", self._on_status_changed)
        header.pack_start(self.status_combo)

        self.logout_button = Gtk.Button(label="Çıkış yap")
        self.logout_button.connect("clicked", self._on_logout)
        header.pack_end(self.logout_button)

        self.refresh_button = Gtk.Button.new_from_icon_name("view-refresh-symbolic", Gtk.IconSize.BUTTON)
        self.refresh_button.set_tooltip_text("Yenile (F5)")
        self.refresh_button.connect("clicked", lambda _b: self.refresh())
        header.pack_end(self.refresh_button)

        self.header_spinner = Gtk.Spinner()
        header.pack_end(self.header_spinner)

        self.header_controls = [switch_box, self.status_combo, self.logout_button, self.refresh_button]
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
        self.stack.add_named(self._build_main_view(), "main")
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
        outer.set_size_request(360, -1)

        logo = find_logo()
        if logo:
            try:
                pix = GdkPixbuf.Pixbuf.new_from_file_at_scale(logo, 96, 96, True)
                outer.pack_start(Gtk.Image.new_from_pixbuf(pix), False, False, 0)
            except GLib.Error:
                pass
        title = Gtk.Label(label="Sora Arka Plan İnceleme")
        title.get_style_context().add_class("sora-login-title")
        outer.pack_start(title, False, False, 0)
        subtitle = Gtk.Label(label="Yönetici hesabınızla giriş yapın")
        subtitle.get_style_context().add_class("sora-dim")
        outer.pack_start(subtitle, False, False, 4)

        self.email_entry = Gtk.Entry()
        self.email_entry.set_placeholder_text("E-posta")
        self.email_entry.set_input_purpose(Gtk.InputPurpose.EMAIL)
        prefs = read_json_file(PREFS_PATH, {}) or {}
        if isinstance(prefs, dict) and prefs.get("last_email"):
            self.email_entry.set_text(prefs["last_email"])
        self.email_entry.connect("activate", lambda _e: self.password_entry.grab_focus())
        outer.pack_start(self.email_entry, False, False, 0)

        self.password_entry = Gtk.Entry()
        self.password_entry.set_placeholder_text("Şifre")
        self.password_entry.set_visibility(False)
        self.password_entry.set_input_purpose(Gtk.InputPurpose.PASSWORD)
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
        self.login_error.set_max_width_chars(44)
        self.login_error.set_justify(Gtk.Justification.CENTER)
        self.login_error.get_style_context().add_class("sora-error")
        outer.pack_start(self.login_error, False, False, 0)
        return outer

    def _build_main_view(self):
        self.main_stack = Gtk.Stack()

        scroller = Gtk.ScrolledWindow()
        scroller.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        self.flowbox = Gtk.FlowBox()
        self.flowbox.set_selection_mode(Gtk.SelectionMode.NONE)
        self.flowbox.set_valign(Gtk.Align.START)
        self.flowbox.set_homogeneous(False)
        self.flowbox.set_max_children_per_line(6)
        self.flowbox.set_column_spacing(16)
        self.flowbox.set_row_spacing(16)
        self.flowbox.set_margin_top(16)
        self.flowbox.set_margin_bottom(16)
        self.flowbox.set_margin_start(16)
        self.flowbox.set_margin_end(16)
        scroller.add(self.flowbox)
        self.main_stack.add_named(scroller, "list")

        self.empty_label = Gtk.Label(label="Bekleyen arka plan yok")
        self.empty_label.get_style_context().add_class("sora-empty")
        self.main_stack.add_named(self.empty_label, "empty")

        loading = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        loading.set_valign(Gtk.Align.CENTER)
        loading_spinner = Gtk.Spinner()
        loading_spinner.set_size_request(32, 32)
        loading_spinner.start()
        loading.pack_start(loading_spinner, False, False, 0)
        loading.pack_start(Gtk.Label(label="Yükleniyor…"), False, False, 0)
        self.main_stack.add_named(loading, "loading")
        return self.main_stack

    # --- genel yardımcılar ---
    def run_bg(self, func, on_ok=None, on_err=None):
        generation = self.operation_generation

        def worker():
            try:
                result = func()
            except Exception as exc:  # noqa: BLE001 - arayüze hata olarak iletilir
                if not isinstance(exc, ApiError):
                    exc = ApiError("Beklenmeyen hata: %s" % exc)
                GLib.idle_add(self._dispatch_if_current, generation, on_err, exc)
            else:
                GLib.idle_add(self._dispatch_if_current, generation, on_ok, result)

        threading.Thread(target=worker, daemon=True).start()

    def _dispatch_if_current(self, generation, callback, value):
        if generation != self.operation_generation:
            return False
        return self._dispatch(callback, value)

    def _dispatch(self, callback, value):
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
        if name == "login":
            if self.email_entry.get_text():
                self.password_entry.grab_focus()
            else:
                self.email_entry.grab_focus()

    def _session_lost(self, message):
        if self.client is not None:
            self.client.clear_session()
        self._reset_main_state()
        self.hide_message()
        self.login_error.set_text(message or "Oturum süresi doldu. Lütfen tekrar giriş yapın.")
        self._show_view("login")

    def _reset_main_state(self):
        self.operation_generation += 1
        self.refresh_generation += 1
        self.refreshing = False
        self.list_signature = None
        self.known_pending = None
        self.image_cache.clear()
        self._clear_cards()
        self.switch.set_sensitive(False)

    def _on_key(self, _widget, event):
        if event.keyval == Gdk.KEY_F5 and self.stack.get_visible_child_name() == "main":
            self.refresh()
            return True
        return False

    def _on_destroy(self, *_args):
        self.operation_generation += 1
        if self.tick_id:
            GLib.source_remove(self.tick_id)
            self.tick_id = 0
        self.executor.shutdown(wait=False)

    # --- giriş / çıkış ---
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
                client.list_requests("pending")  # yönetici yetkisini doğrula
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
            self.refresh()

        def failed(exc):
            self.login_spinner.stop()
            self.login_button.set_sensitive(True)
            self.login_error.set_text(str(exc))

        self.run_bg(job, done, failed)

    def _on_logout(self, *_args):
        token = (self.client.session or {}).get("access_token") if self.client else None
        self._session_lost("")
        self.login_error.set_text("Çıkış yapıldı.")
        if token:
            client = self.client
            threading.Thread(target=client.sign_out_remote, args=(token,), daemon=True).start()

    # --- liste ---
    def _on_status_changed(self, combo):
        self.current_status = combo.get_active_id() or "pending"
        labels = dict(STATUS_CHOICES)
        self.empty_label.set_text(
            "Bekleyen arka plan yok" if self.current_status == "pending"
            else "%s arka plan yok" % labels.get(self.current_status, ""))
        self.list_signature = None
        self.refresh()

    def _on_tick(self):
        if (self.client is not None and self.client.has_session()
                and self.stack.get_visible_child_name() == "main" and not self.refreshing):
            self.refresh(silent=True)
        return True

    def refresh(self, silent=False):
        if self.client is None or not self.client.has_session():
            return
        self.refresh_generation += 1
        generation = self.refresh_generation
        status = self.current_status
        self.refreshing = True
        self.header_spinner.start()
        if not self.cards and not silent:
            self.main_stack.set_visible_child_name("loading")
        client = self.client

        def job():
            pending = client.list_requests("pending")
            current = pending if status == "pending" else client.list_requests(status)
            setting, setting_error = None, None
            try:
                setting = client.get_setting()
            except AuthRequired:
                raise
            except ApiError as exc:
                setting_error = str(exc)
            return pending, current, setting, setting_error

        def done(result):
            if generation != self.refresh_generation:
                return
            self.refreshing = False
            self.header_spinner.stop()
            pending, current, setting, setting_error = result
            self._apply_rows(current, status)
            self._notify_new(pending)
            if setting is not None and not self.switch_busy:
                self._set_switch(setting)
                self.switch.set_sensitive(True)
            now = datetime.now(LOCAL_TZ)
            self.header.set_subtitle("%s · %d bekleyen · Son güncelleme %02d:%02d" % (
                self.client.email or "Yönetici", len(pending), now.hour, now.minute))
            if setting_error:
                self.show_message("Ayar okunamadı: %s" % setting_error, Gtk.MessageType.WARNING)
            elif self.info_bar.get_visible() and self.info_bar.get_message_type() == Gtk.MessageType.ERROR:
                self.hide_message()

        def failed(exc):
            if generation != self.refresh_generation:
                return
            self.refreshing = False
            self.header_spinner.stop()
            if not self.cards:
                self.main_stack.set_visible_child_name("empty")
            self.show_message("Liste alınamadı: %s" % exc, Gtk.MessageType.ERROR)

        self.run_bg(job, done, failed)

    def _clear_cards(self):
        for card in self.cards:
            card.alive = False
            card.destroy()
        self.cards = []

    def _apply_rows(self, rows, status):
        signature = (status, tuple((r.get("id"), r.get("status"), r.get("reviewed_at")) for r in rows))
        if signature == self.list_signature:
            return
        self.list_signature = signature
        self._clear_cards()
        if not rows:
            self.main_stack.set_visible_child_name("empty")
            return
        if status != "pending":
            rows = list(reversed(rows))  # incelenenlerde en yeni üstte
        for row in rows:
            card = RequestCard(self, row)
            self.flowbox.add(card)
            self.cards.append(card)
            self.load_thumbnail(card)
        self.main_stack.set_visible_child_name("list")
        # Önbelleği yalnızca görünen görsellerle sınırla
        visible = {r.get("image_path") for r in rows}
        for key in list(self.image_cache):
            if key not in visible:
                del self.image_cache[key]

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
        generation = self.operation_generation

        def job():
            try:
                pixbuf = pixbuf_from_bytes(client.download_image(path))
            except Exception as exc:  # noqa: BLE001
                GLib.idle_add(self._thumbnail_failed, generation, card, exc)
            else:
                GLib.idle_add(self._thumbnail_loaded, generation, card, path, pixbuf)

        try:
            self.executor.submit(job)
        except RuntimeError:
            pass  # pencere kapanıyor

    def _thumbnail_loaded(self, generation, card, path, pixbuf):
        if generation != self.operation_generation or not card.alive:
            return False
        self.image_cache[path] = pixbuf
        self.image_cache.move_to_end(path)
        while len(self.image_cache) > IMAGE_CACHE_ITEMS:
            self.image_cache.popitem(last=False)
        card.set_pixbuf(pixbuf)
        return False

    def _thumbnail_failed(self, generation, card, exc):
        if generation != self.operation_generation or not card.alive:
            return False
        if isinstance(exc, AuthRequired):
            self._session_lost(str(exc))
        else:
            card.set_image_error(str(exc) if isinstance(exc, ApiError) else "Görsel yüklenemedi: %s" % exc)
        return False

    def show_large_image(self, pixbuf, row):
        ImageViewer(self, pixbuf, row)

    def _notify_new(self, pending):
        ids = {r.get("id") for r in pending}
        if self.known_pending is not None:
            new_rows = [r for r in pending if r.get("id") not in self.known_pending]
            if new_rows:
                if len(new_rows) == 1:
                    body = "%s odası için %s yeni arka plan gönderdi." % (
                        new_rows[0].get("room_title") or "Bir oda", new_rows[0].get("requester_name") or "bir kullanıcı")
                else:
                    body = "%d yeni arka plan isteği incelenmeyi bekliyor." % len(new_rows)
                send_notification(self.app, "Yeni arka plan isteği", body)
        self.known_pending = ids

    # --- inceleme ---
    def on_approve(self, card):
        dialog = Gtk.MessageDialog(
            transient_for=self, modal=True, message_type=Gtk.MessageType.QUESTION,
            buttons=Gtk.ButtonsType.NONE, text="Arka plan onaylansın mı?")
        dialog.format_secondary_text(
            "“%s” odasının arka planı hemen bu görselle değişecek." % (card.row.get("room_title") or "Oda"))
        dialog.add_button("Vazgeç", Gtk.ResponseType.CANCEL)
        ok = dialog.add_button("Onayla", Gtk.ResponseType.OK)
        ok.get_style_context().add_class("suggested-action")
        dialog.set_default_response(Gtk.ResponseType.OK)
        response = dialog.run()
        dialog.destroy()
        if response == Gtk.ResponseType.OK:
            self._submit_review(card, True, "")

    def on_reject(self, card):
        dialog = Gtk.Dialog(title="Arka planı reddet", transient_for=self, modal=True)
        dialog.add_button("Vazgeç", Gtk.ResponseType.CANCEL)
        reject = dialog.add_button("Reddet", Gtk.ResponseType.OK)
        reject.get_style_context().add_class("destructive-action")
        dialog.set_default_response(Gtk.ResponseType.OK)
        area = dialog.get_content_area()
        area.set_spacing(8)
        area.set_margin_top(12)
        area.set_margin_bottom(12)
        area.set_margin_start(12)
        area.set_margin_end(12)
        area.pack_start(Gtk.Label(
            label="“%s” odası için gönderilen arka plan reddedilecek." % (card.row.get("room_title") or "Oda"),
            xalign=0), False, False, 0)
        entry = Gtk.Entry()
        entry.set_max_length(200)
        entry.set_placeholder_text("Not (isteğe bağlı, en fazla 200 karakter)")
        entry.set_activates_default(True)
        entry.set_width_chars(44)
        area.pack_start(entry, False, False, 0)
        dialog.show_all()
        response = dialog.run()
        note = entry.get_text().strip()
        dialog.destroy()
        if response == Gtk.ResponseType.OK:
            self._submit_review(card, False, note)

    def _submit_review(self, card, approve, note):
        card.set_busy(True)
        request_id = card.row.get("id")
        client = self.client

        def done(_result):
            self.show_message(
                "Arka plan onaylandı, oda arka planı güncellendi." if approve else "Arka plan reddedildi.",
                Gtk.MessageType.INFO, timeout=5)
            self.list_signature = None
            if card.alive and self.current_status == "pending":
                self.cards = [c for c in self.cards if c is not card]
                card.destroy()
                if not self.cards:
                    self.main_stack.set_visible_child_name("empty")
            self.refresh(silent=True)

        def failed(exc):
            if card.alive:
                card.set_busy(False)
            self.show_message(str(exc), Gtk.MessageType.ERROR)
            if "zaten incelenmiş" in str(exc) or "bulunamadı" in str(exc):
                self.list_signature = None
                self.refresh(silent=True)

        self.run_bg(lambda: client.review(request_id, approve, note), done, failed)

    # --- özellik anahtarı ---
    def _set_switch(self, value):
        self.switch_value = bool(value)
        self.switch_syncing = True
        try:
            self.switch.set_active(self.switch_value)
            self.switch.set_state(self.switch_value)
        finally:
            self.switch_syncing = False

    def _on_switch_state_set(self, switch, state):
        if self.switch_syncing:
            return False
        if self.client is None or not self.client.has_session():
            return True
        switch.set_sensitive(False)
        self.switch_busy = True
        client = self.client

        def done(value):
            self.switch_busy = False
            self._set_switch(value)
            switch.set_sensitive(True)
            self.show_message(
                "Arka plan değiştirme açıldı." if value else "Arka plan değiştirme kapatıldı.",
                Gtk.MessageType.INFO, timeout=4)

        def failed(exc):
            self.switch_busy = False
            self._set_switch(self.switch_value)
            switch.set_sensitive(True)
            self.show_message("Ayar değiştirilemedi: %s" % exc, Gtk.MessageType.ERROR)

        self.run_bg(lambda: client.set_setting(state), done, failed)
        return True  # durum sunucu onaylayınca güncellenecek


def send_notification(app, title, body):
    if shutil.which("notify-send"):
        icon = find_logo() or "dialog-information"
        try:
            subprocess.Popen(
                ["notify-send", "--app-name=" + APP_TITLE, "--icon=" + icon, title, body],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except OSError:
            pass
    try:
        notification = Gio.Notification.new(title)
        notification.set_body(body)
        app.send_notification("new-background", notification)
    except Exception:  # noqa: BLE001
        pass


class ReviewApp(Gtk.Application):
    def __init__(self, flags=Gio.ApplicationFlags.FLAGS_NONE, on_activate=None):
        super().__init__(application_id=APP_ID, flags=flags)
        self.window = None
        self.on_activate = on_activate  # yalnızca kendi kendine test için

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


# ---------------------------------------------------------------------------
# Kendi kendine test (ağ kullanmaz)
# ---------------------------------------------------------------------------

def self_test():
    failures = []

    def check(name, condition):
        print(("  ✓ " if condition else "  ✗ ") + name)
        if not condition:
            failures.append(name)

    print("Sora arka plan inceleme · kendi kendine test")
    sample = (
        "\ufeff# yorum\r\n"
        "EXPO_PUBLIC_SUPABASE_URL=https://example.supabase.co/\r\n"
        "export EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=\"sb_publishable_abc\"\r\n"
        "OTHER='a b' \r\n"
        "PLAIN=value # inline yorum\r\n"
        "EMPTY=\r\n"
    )
    parsed = parse_env_text(sample)
    check(".env: URL", parsed.get(URL_KEY) == "https://example.supabase.co/")
    check(".env: export + çift tırnak", parsed.get(API_KEY_NAMES[0]) == "sb_publishable_abc")
    check(".env: tek tırnak", parsed.get("OTHER") == "a b")
    check(".env: satır içi yorum", parsed.get("PLAIN") == "value")
    check(".env: boş değer", parsed.get("EMPTY") == "")

    check("zaman: UTC → İstanbul", format_local_time("2026-11-14T18:50:48.123+00:00") == "14 Kas 2026 21:50")
    check("zaman: Z soneki", format_local_time("2026-01-02T00:05:00Z") == "2 Oca 2026 03:05")
    check("zaman: +03 kısa ofset", format_local_time("2026-06-01 12:00:00+03") == "1 Haz 2026 12:00")
    check("zaman: geçersiz", format_local_time("bozuk") == "—")

    check("hata çevirisi: admin", "yönetici yetkisi" in translate_error("Admin access required"))
    check("hata çevirisi: giriş", translate_error("Invalid login credentials") == "E-posta veya şifre hatalı.")
    check("hata: admin bayrağı", ApiError("x", 400, "Admin access required").is_admin_error)
    check("bool dönüşümü", coerce_bool(True) and coerce_bool("true") and not coerce_bool("false") and not coerce_bool(None))

    with tempfile.TemporaryDirectory() as tmp:
        session_file = os.path.join(tmp, "sub", "session.json")
        client = SupabaseClient(Config("https://example.supabase.co/", "k", "test"), session_path=session_file)
        check("istemci: oturum yok", not client.has_session())
        client._store_session({"access_token": "a", "refresh_token": "r", "expires_in": 3600,
                               "user": {"email": "admin@example.com", "id": "u1"}})
        mode = os.stat(session_file).st_mode & 0o777
        check("oturum dosyası izni 0600", mode == 0o600)
        reloaded = SupabaseClient(Config("https://example.supabase.co", "k", "test"), session_path=session_file)
        check("oturum yeniden yüklendi", reloaded.has_session() and reloaded.email == "admin@example.com")
        check("URL sonundaki / temizlendi", reloaded.config.url == "https://example.supabase.co")
        check("anahtar repr'de gizli", "<gizli>" in repr(reloaded.config) and "'k'" not in repr(reloaded.config))
        reloaded.clear_session()
        check("çıkış oturumu sildi", not os.path.exists(session_file) and not reloaded.has_session())

    try:
        config = load_config()
        print("  • yapılandırma: %s (URL: %s, anahtar: var)" % (config.source, config.url))
    except ConfigError as exc:
        print("  ! yapılandırma bulunamadı (uygulama açılışta uyarı gösterir):")
        print("    " + str(exc).replace("\n", "\n    "))

    ok, _argv = Gtk.init_check(sys.argv[:1])
    if ok:
        def gui_test(app):
            try:
                window = MainWindow(app, client=None, config_error="Test", autoload=False)
                check("arayüz: ana pencere oluşturuldu", window.get_title() == APP_TITLE)
                check("arayüz: yapılandırma görünümü", window.stack.get_visible_child_name() == "config")
                window.client = SupabaseClient(
                    Config("https://example.invalid", "k", "test"),
                    session_path=os.path.join(tempfile.gettempdir(), "sora-bg-selftest-none.json"))
                window._show_view("login")
                check("arayüz: giriş görünümü, başlık kontrolleri gizli",
                      window.stack.get_visible_child_name() == "login" and not window.logout_button.get_visible())
                window.show_message("Deneme", Gtk.MessageType.ERROR)
                check("arayüz: bilgi çubuğu", window.info_bar.get_visible())
                window.hide_message()
                card = RequestCard(window, {
                    "id": "00000000-0000-0000-0000-000000000000", "room_title": "Test odası",
                    "requester_name": "Deneme", "image_path": "room/test.jpg", "status": "pending",
                    "created_at": "2026-11-14T18:50:48Z"})
                pix = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, False, 8, 1080, 1920)
                pix.fill(0x3366FFFF)
                card.set_pixbuf(pix)
                thumb = card.thumb_image.get_pixbuf()
                check("arayüz: küçük resim ~320 px, dikey sınır içinde",
                      thumb is not None and THUMB_WIDTH - 2 <= thumb.get_width() <= THUMB_WIDTH
                      and thumb.get_height() <= THUMB_MAX_HEIGHT)
                ok_png, png = pix.save_to_bufferv("png", [], [])
                decoded = pixbuf_from_bytes(png) if ok_png else None
                check("arayüz: PNG güvenli önizleme sınırı",
                      decoded is not None and max(decoded.get_width(), decoded.get_height()) <= MAX_PREVIEW_EDGE)
                window._apply_rows([], "pending")
                check("arayüz: boş durum", window.main_stack.get_visible_child_name() == "empty"
                      and window.empty_label.get_text() == "Bekleyen arka plan yok")
                card.destroy()
                window.destroy()
            except Exception as exc:  # noqa: BLE001
                import traceback
                traceback.print_exc()
                check("arayüz: istisna yok (%s)" % exc, False)

        test_app = ReviewApp(flags=Gio.ApplicationFlags.NON_UNIQUE, on_activate=gui_test)
        test_app.run(sys.argv[:1])
    else:
        print("  • arayüz testi atlandı (ekran yok)")

    if failures:
        print("BAŞARISIZ: %d test" % len(failures))
        return 1
    print("Tüm testler geçti.")
    return 0


def main(argv):
    if "--self-test" in argv:
        return self_test()
    GLib.set_prgname("sora-background-review")
    GLib.set_application_name(APP_TITLE)
    app = ReviewApp()
    return app.run([a for a in argv if a != "--self-test"])


if __name__ == "__main__":
    sys.exit(main(sys.argv))
