import React, { useState, useRef, useEffect, useCallback } from "react";
import Icon from "@/components/ui/icon";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

// ─── API Config ───────────────────────────────────────────────────────────────

const AUTH_URL = "https://functions.poehali.dev/7f5e5202-ad61-4f31-8181-6393be10b3ed";
const CHATS_URL = "https://functions.poehali.dev/a33600bd-358e-45e6-a8d5-4e32707a3ef1";
const CALLS_URL = "https://functions.poehali.dev/ec19ea73-ee73-48c3-a4cc-a6104054ed8e";

function apiHeaders(token?: string | null) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["X-Auth-Token"] = token;
  return h;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "chats" | "contacts" | "calls" | "status" | "profile" | "settings";
type UserRole = "admin" | "member" | "moderator";

interface User {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  bio?: string;
  status?: string;
  avatar_url?: string | null;
}

interface Reaction { emoji: string; count: number; i_reacted: boolean; }

interface Message {
  id: number | string;
  text: string;
  time: string;
  out: boolean;
  is_read: boolean;
  sender_name?: string;
  sender_avatar?: string | null;
  file_url?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  file_type?: string | null;
  reactions?: Reaction[];
  is_edited?: boolean;
  is_deleted?: boolean;
  is_pinned?: boolean;
  date?: string;
  reply_to_id?: number | null;
  reply_to_text?: string | null;
  reply_to_name?: string | null;
  _failed?: boolean;
}

interface Chat {
  id: number;
  name: string;
  last_msg: string;
  last_time: string | null;
  unread: number;
  is_group: boolean;
  is_channel?: boolean;
  description?: string | null;
  avatar_url?: string | null;
  is_public?: boolean;
  can_post?: boolean;
  my_role?: UserRole;
  member_count?: number;
  online?: boolean;
  pinned?: boolean;
  muted?: boolean;
  muted_until?: string | null;
  peer_online?: boolean;
  peer_last_seen?: string | null;
  peer_id?: number | null;
}

// ─── Call types ───────────────────────────────────────────────────────────────

interface CallSession {
  callId: number;
  peerId: number;
  peerName: string;
  peerAvatar?: string | null;
  direction: "outgoing" | "incoming";
  status: "ringing" | "active" | "ended";
  isVideo?: boolean;
}

// ─── Mock data for non-chat tabs ──────────────────────────────────────────────

const MOCK_STATUSES = [
  { id: "1", name: "Анна Смирнова", time: "5 мин", viewed: false, color: "from-blue-500 to-cyan-400", text: "Новый день — новые возможности! ✨" },
  { id: "2", name: "Антон Волков", time: "12 мин", viewed: false, color: "from-pink-500 to-orange-400", text: "На конференции по дизайну 🎨" },
  { id: "3", name: "Дарья Новикова", time: "1 ч", viewed: true, color: "from-green-400 to-cyan-500" },
];

// ─── Avatar helpers ───────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "from-blue-600 to-blue-700", "from-cyan-400 to-blue-500",
  "from-pink-400 to-rose-500", "from-green-400 to-emerald-500",
  "from-orange-400 to-amber-500", "from-indigo-500 to-blue-600",
];

function getAvatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h += name.charCodeAt(i);
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function AvatarEl({ name, size = "md", status, avatarUrl }: {
  name: string; size?: "xs" | "sm" | "md" | "lg" | "xl"; status?: string; avatarUrl?: string | null;
}) {
  const sizes = { xs: "w-8 h-8 text-xs", sm: "w-10 h-10 text-xs", md: "w-12 h-12 text-sm", lg: "w-14 h-14 text-base", xl: "w-20 h-20 text-xl" };
  return (
    <div className="relative flex-shrink-0">
      {avatarUrl
        ? <img src={avatarUrl} alt={name} className={`rounded-full object-cover ${sizes[size]}`} />
        : <div className={`rounded-full bg-gradient-to-br ${getAvatarColor(name)} flex items-center justify-center font-golos font-bold text-white ${sizes[size]}`}>
            {(name || "?").slice(0, 2).toUpperCase()}
          </div>
      }
      {status && (
        <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background
          ${status === "online" ? "status-online" : status === "away" ? "status-away" : "status-offline"}`} />
      )}
    </div>
  );
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────

function AuthScreen({ onAuth }: { onAuth: (token: string, user: User, isNew?: boolean) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPolicy, setShowPolicy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandaloneMode = window.matchMedia("(display-mode: standalone)").matches;

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function handleSubmit() {
    setError("");
    if (!phone.trim()) { setError("Введите номер телефона"); return; }
    if (mode === "register" && !name.trim()) { setError("Введите имя"); return; }
    if (!password) { setError("Введите пароль"); return; }
    if (mode === "register" && password.length < 6) { setError("Пароль минимум 6 символов"); return; }
    setLoading(true);
    try {
      const res = await fetch(AUTH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode === "register" ? "register" : "login", phone: phone.trim(), name: name.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Ошибка"); return; }
      onAuth(data.token, data.user, mode === "register");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Ошибка соединения: ${msg}`);
    } finally { setLoading(false); }
  }

  const inputClass = "w-full bg-secondary/60 border border-white/10 rounded-2xl pl-11 pr-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-sky-500/50 focus:bg-secondary/80 transition-all";

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-full h-1/2" style={{ background: "radial-gradient(ellipse at 30% 20%, rgba(0,119,182,0.18) 0%, transparent 60%)" }} />
        <div className="absolute bottom-0 right-0 w-full h-1/2" style={{ background: "radial-gradient(ellipse at 70% 80%, rgba(34,211,238,0.1) 0%, transparent 60%)" }} />
        {[{ top: "8%", left: "15%", size: 60, delay: "0s", dur: "4s", c: 0 },
          { top: "20%", left: "72%", size: 40, delay: "1s", dur: "3.5s", c: 1 },
          { top: "60%", left: "5%", size: 30, delay: "0.5s", dur: "5s", c: 0 }].map((b, i) => (
          <div key={i} className="absolute rounded-full opacity-[0.07]"
            style={{ width: b.size, height: b.size, top: b.top, left: b.left,
              background: b.c === 0 ? "radial-gradient(circle, #0077b6, transparent)" : "radial-gradient(circle, #22d3ee, transparent)",
              animation: `float ${b.dur} ease-in-out infinite`, animationDelay: b.delay }} />
        ))}
      </div>

      <div className="relative z-10 flex flex-col justify-center flex-1 px-6 py-8 scroll-container overflow-y-auto">
        {/* Лого */}
        <div className="text-center mb-6 animate-fade-in">
          <div className="w-20 h-20 mx-auto mb-4">
            <img src="https://cdn.poehali.dev/projects/84792fb2-1985-42c4-8056-a4e27799a11a/bucket/2069fcb7-f721-4674-b0d8-51603e738767.png"
              alt="Каспер" className="w-full h-full object-cover rounded-full" />
          </div>
          <h1 className="text-4xl font-golos font-black italic mb-1 kasper-title uppercase">Каспер</h1>
          <p className="text-muted-foreground text-sm">Мессенджер вашего сообщества</p>
        </div>

        <>
          {/* Переключатель Войти/Регистрация */}
          <div className="glass rounded-2xl p-1 flex gap-1 mb-5 animate-fade-in" style={{ animationDelay: "0.05s" }}>
            {(["login", "register"] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setError(""); }}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200
                  ${mode === m ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-[0_0_20px_rgba(0,180,230,0.4)]" : "text-muted-foreground hover:text-foreground"}`}>
                {m === "login" ? "Войти" : "Регистрация"}
              </button>
            ))}
          </div>

          <div className="space-y-3 animate-fade-in" style={{ animationDelay: "0.1s" }}>
            {mode === "register" && (
              <div className="relative animate-fade-in">
                <div className="absolute left-4 top-1/2 -translate-y-1/2">
                  <Icon name="User" size={16} className="text-muted-foreground" />
                </div>
                <input value={name} onChange={e => setName(e.target.value)}
                  placeholder="Ваше имя" autoComplete="name"
                  className={inputClass} />
              </div>
            )}

            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2">
                <Icon name="Phone" size={16} className="text-muted-foreground" />
              </div>
              <input value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="Номер телефона" type="tel" autoComplete="tel"
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
                className={inputClass} />
            </div>

            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2">
                <Icon name="Lock" size={16} className="text-muted-foreground" />
              </div>
              <input value={password} onChange={e => setPassword(e.target.value)}
                placeholder={mode === "register" ? "Придумайте пароль" : "Пароль"}
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
                className={inputClass + " pr-11"} />
              <button type="button" onClick={() => setShowPassword(v => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                <Icon name={showPassword ? "EyeOff" : "Eye"} size={16} />
              </button>
            </div>

            {error && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 animate-fade-in">
                <Icon name="AlertCircle" size={14} className="text-red-400 flex-shrink-0" />
                <span className="text-xs text-red-300">{error}</span>
              </div>
            )}

            <button onClick={handleSubmit} disabled={loading}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-golos font-semibold text-base hover:opacity-90 active:scale-[0.98] transition-all shadow-[0_0_30px_rgba(0,180,230,0.4)] disabled:opacity-60 mt-2 flex items-center justify-center gap-2">
              {loading
                ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{mode === "register" ? "Создаём аккаунт..." : "Входим..."}</>
                : <><Icon name={mode === "register" ? "UserPlus" : "LogIn"} size={16} />{mode === "register" ? "Создать аккаунт" : "Войти"}</>}
            </button>

            {installPrompt && (
              <button onClick={() => { (installPrompt as BeforeInstallPromptEvent).prompt(); setInstallPrompt(null); }}
                className="w-full py-3.5 rounded-2xl border border-sky-500/30 bg-sky-500/10 text-sky-300 font-semibold text-sm hover:bg-sky-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                <Icon name="Download" size={16} />Установить приложение на телефон
              </button>
            )}

            {isIos && !isInStandaloneMode && !installPrompt && (
              <>
                <button onClick={() => setShowIosHint(v => !v)}
                  className="w-full py-3.5 rounded-2xl border border-sky-500/30 bg-sky-500/10 text-sky-300 font-semibold text-sm hover:bg-sky-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                  <Icon name="Download" size={16} />Установить приложение на iPhone
                </button>
                {showIosHint && (
                  <div className="rounded-2xl border border-white/10 bg-secondary/60 p-4 space-y-2 animate-fade-in text-sm text-muted-foreground">
                    <p className="font-semibold text-foreground">Как установить на iPhone:</p>
                    <div className="flex items-start gap-2">
                      <span className="text-sky-400 font-bold flex-shrink-0">1.</span>
                      <span>Нажмите кнопку <span className="inline-flex items-center gap-1 text-sky-400">поделиться <Icon name="Share" size={13} /></span> внизу Safari</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-sky-400 font-bold flex-shrink-0">2.</span>
                      <span>Выберите <span className="text-foreground font-medium">"На экран «Домой»"</span></span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-sky-400 font-bold flex-shrink-0">3.</span>
                      <span>Нажмите <span className="text-foreground font-medium">"Добавить"</span></span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>

        <p className="text-center text-xs text-muted-foreground mt-5 animate-fade-in" style={{ animationDelay: "0.2s" }}>
          Продолжая, вы соглашаетесь с{" "}
          <button onClick={() => setShowTerms(true)}
            className="text-sky-400 hover:text-sky-300 underline underline-offset-2 transition-colors">
            условиями использования
          </button>
          {" "}и{" "}
          <button onClick={() => setShowPolicy(true)}
            className="text-sky-400 hover:text-sky-300 underline underline-offset-2 transition-colors">
            политикой конфиденциальности
          </button>
        </p>

        {/* Модалка с условиями использования */}
        {showTerms && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
            onClick={() => setShowTerms(false)}>
            <div className="w-full max-w-lg bg-[hsl(var(--background))] border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[85vh] flex flex-col"
              onClick={e => e.stopPropagation()}>
              {/* Шапка */}
              <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/8 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/15 flex items-center justify-center">
                    <Icon name="FileText" size={16} className="text-cyan-400" />
                  </div>
                  <div>
                    <h2 className="font-golos font-bold text-foreground text-base">Условия использования</h2>
                    <p className="text-[11px] text-muted-foreground">Версия 1.0 · 23 марта 2026</p>
                  </div>
                </div>
                <button onClick={() => setShowTerms(false)}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors text-muted-foreground">
                  <Icon name="X" size={18} />
                </button>
              </div>

              {/* Контент */}
              <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5 scroll-container">

                <p className="text-sm text-muted-foreground leading-relaxed">
                  Используя мессенджер <strong className="text-foreground">Каспер</strong>, вы принимаете настоящие Условия. Пожалуйста, ознакомьтесь с ними внимательно.
                </p>

                {[
                  {
                    num: "1", color: "cyan", icon: "UserCheck", title: "Регистрация и аккаунт",
                    items: [
                      "Для использования сервиса необходимо создать аккаунт с подтверждением через телефон или email.",
                      "Вам должно быть не менее 14 лет для регистрации.",
                      "Вы несёте ответственность за сохранность доступа к своему аккаунту.",
                      "Один человек — один аккаунт. Создание множества аккаунтов запрещено.",
                    ],
                  },
                  {
                    num: "2", color: "green", icon: "CheckCircle", title: "Допустимое использование",
                    items: [
                      "Сервис предназначен для личного и делового общения.",
                      "Разрешено обмениваться текстом, медиафайлами, документами и голосовыми сообщениями.",
                      "Вы можете создавать группы и каналы для общения с несколькими людьми.",
                      "Звонки доступны в формате аудио и видео между пользователями.",
                    ],
                  },
                  {
                    num: "3", color: "red", icon: "Ban", title: "Запрещённые действия",
                    items: [
                      "Рассылка спама, нежелательных сообщений и навязчивая реклама.",
                      "Распространение незаконного, оскорбительного или вредоносного контента.",
                      "Попытки взлома, обход систем защиты, DDoS-атаки.",
                      "Выдача себя за другого человека или организацию.",
                      "Сбор персональных данных других пользователей без их согласия.",
                    ],
                  },
                  {
                    num: "4", color: "yellow", icon: "Copyright", title: "Контент и права",
                    items: [
                      "Вы сохраняете все права на контент, который публикуете.",
                      "Загружая контент, вы даёте нам право хранить и передавать его адресатам.",
                      "Запрещено загружать контент, нарушающий авторские права третьих лиц.",
                      "Мы не претендуем на владение вашими сообщениями и файлами.",
                    ],
                  },
                  {
                    num: "5", color: "orange", icon: "AlertTriangle", title: "Ответственность",
                    items: [
                      "Сервис предоставляется «как есть». Мы не гарантируем бесперебойную работу 24/7.",
                      "Мы не несём ответственности за содержание переписки между пользователями.",
                      "Мы оставляем за собой право заблокировать аккаунт при нарушении условий.",
                      "При обнаружении нарушений — свяжитесь с поддержкой.",
                    ],
                  },
                  {
                    num: "6", color: "purple", icon: "RefreshCw", title: "Изменение условий",
                    items: [
                      "Мы можем обновлять настоящие Условия. Уведомление поступит в приложении.",
                      "Продолжение использования сервиса после изменений означает согласие с ними.",
                      "Если вы не согласны с условиями — вы вправе удалить свой аккаунт.",
                    ],
                  },
                ].map(section => {
                  const colorMap: Record<string, { dot: string; text: string }> = {
                    cyan:   { dot: "bg-cyan-500/20",   text: "text-cyan-400"   },
                    green:  { dot: "bg-green-500/20",  text: "text-green-400"  },
                    red:    { dot: "bg-red-500/20",    text: "text-red-400"    },
                    yellow: { dot: "bg-yellow-500/20", text: "text-yellow-400" },
                    orange: { dot: "bg-orange-500/20", text: "text-orange-400" },
                    purple: { dot: "bg-purple-500/20", text: "text-purple-400" },
                  };
                  const c = colorMap[section.color];
                  return (
                    <div key={section.num} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-5 h-5 rounded-full ${c.dot} ${c.text} text-[11px] font-bold flex items-center justify-center flex-shrink-0`}>
                          {section.num}
                        </span>
                        <h3 className="text-sm font-golos font-bold text-foreground">{section.title}</h3>
                      </div>
                      <ul className="space-y-1.5 pl-1">
                        {section.items.map(item => (
                          <li key={item} className="flex items-start gap-2">
                            <Icon name="ChevronRight" size={12} className={`${c.text} mt-0.5 flex-shrink-0 opacity-70`} />
                            <span className="text-xs text-muted-foreground leading-relaxed">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}

                <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-white/4 border border-white/8">
                  <Icon name="Info" size={14} className="text-muted-foreground flex-shrink-0" />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    По всем вопросам обращайтесь в службу поддержки. Нажимая «Понятно», вы подтверждаете, что ознакомились с условиями.
                  </p>
                </div>

                <div className="text-center text-[11px] text-muted-foreground/50 pt-1 pb-1">
                  Каспер · Условия использования · v1.0
                </div>
              </div>

              {/* Кнопка */}
              <div className="px-5 pb-5 pt-3 flex-shrink-0 border-t border-white/8">
                <button onClick={() => setShowTerms(false)}
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-golos font-semibold text-sm hover:opacity-90 transition-all shadow-[0_0_20px_rgba(0,119,182,0.3)]">
                  Понятно
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Модалка с политикой конфиденциальности */}
        {showPolicy && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
            onClick={() => setShowPolicy(false)}>
            <div className="w-full max-w-lg bg-[hsl(var(--background))] border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[85vh] flex flex-col"
              onClick={e => e.stopPropagation()}>
              {/* Шапка */}
              <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/8 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/15 flex items-center justify-center">
                    <Icon name="Shield" size={16} className="text-blue-400" />
                  </div>
                  <div>
                    <h2 className="font-golos font-bold text-foreground text-base">Политика конфиденциальности</h2>
                    <p className="text-[11px] text-muted-foreground">Версия 1.0 · 23 марта 2026</p>
                  </div>
                </div>
                <button onClick={() => setShowPolicy(false)}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors text-muted-foreground">
                  <Icon name="X" size={18} />
                </button>
              </div>

              {/* Контент */}
              <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5 scroll-container">

                <p className="text-sm text-muted-foreground leading-relaxed">
                  Настоящая Политика описывает, какие данные собирает мессенджер <strong className="text-foreground">Каспер</strong>, как они используются и защищаются.
                </p>

                {[
                  {
                    num: "1", color: "sky", title: "Данные, которые мы собираем",
                    items: [
                      "Номер телефона или email для регистрации и входа.",
                      "Имя, аватар и биография — только то, что вы добавляете сами.",
                      "Сообщения, файлы, голосовые — только в рамках вашей переписки.",
                      "Время последней активности для отображения статуса «онлайн».",
                    ],
                  },
                  {
                    num: "2", color: "green", title: "Как мы используем данные",
                    items: [
                      "Обеспечение работы мессенджера: отправка сообщений, звонки.",
                      "Авторизация через одноразовые OTP-коды.",
                      "Защита от спама и несанкционированного доступа.",
                      "Системные push-уведомления о новых сообщениях.",
                    ],
                  },
                  {
                    num: "3", color: "purple", title: "Защита данных",
                    items: [
                      "Все данные передаются по зашифрованному протоколу HTTPS/TLS.",
                      "Пароли хранятся в виде хешей, не в открытом виде.",
                      "Сессионные токены обновляются при каждом входе.",
                    ],
                  },
                  {
                    num: "4", color: "orange", title: "Передача третьим лицам",
                    items: [
                      "Мы не продаём и не передаём ваши данные рекламным сетям.",
                      "Без аналитики третьих лиц. Без отслеживания.",
                      "Данные раскрываются только по законному требованию госорганов.",
                    ],
                  },
                  {
                    num: "5", color: "cyan", title: "Ваши права",
                    items: [
                      "Изменить имя, аватар и биографию в разделе «Профиль».",
                      "Удалить аккаунт и все данные через раздел «Профиль».",
                      "Запросить экспорт данных через службу поддержки.",
                    ],
                  },
                ].map(section => {
                  const colorMap: Record<string, { bg: string; text: string; dot: string }> = {
                    sky:    { bg: "bg-sky-500/15",    text: "text-sky-400",    dot: "bg-sky-500/20" },
                    green:  { bg: "bg-green-500/15",  text: "text-green-400",  dot: "bg-green-500/20" },
                    purple: { bg: "bg-purple-500/15", text: "text-purple-400", dot: "bg-purple-500/20" },
                    orange: { bg: "bg-orange-500/15", text: "text-orange-400", dot: "bg-orange-500/20" },
                    cyan:   { bg: "bg-cyan-500/15",   text: "text-cyan-400",   dot: "bg-cyan-500/20" },
                  };
                  const c = colorMap[section.color];
                  return (
                    <div key={section.num} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-5 h-5 rounded-full ${c.dot} ${c.text} text-[11px] font-bold flex items-center justify-center flex-shrink-0`}>
                          {section.num}
                        </span>
                        <h3 className="text-sm font-golos font-bold text-foreground">{section.title}</h3>
                      </div>
                      <ul className="space-y-1.5 pl-1">
                        {section.items.map(item => (
                          <li key={item} className="flex items-start gap-2">
                            <span className={`w-1 h-1 rounded-full ${c.bg} mt-2 flex-shrink-0`}
                              style={{ minWidth: 4, minHeight: 4, background: "currentColor", opacity: 0.7 }} />
                            <span className="text-xs text-muted-foreground leading-relaxed">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}

                <div className="text-center text-[11px] text-muted-foreground/50 pt-2 pb-1">
                  Каспер · Политика конфиденциальности · v1.0
                </div>
              </div>

              {/* Кнопка закрыть */}
              <div className="px-5 pb-5 pt-3 flex-shrink-0 border-t border-white/8">
                <button onClick={() => setShowPolicy(false)}
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-golos font-semibold text-sm hover:opacity-90 transition-all shadow-[0_0_20px_rgba(0,119,182,0.3)]">
                  Понятно
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Bottom Nav ───────────────────────────────────────────────────────────────

const NAV_ITEMS: { tab: Tab; icon: string; label: string }[] = [
  { tab: "chats", icon: "MessageCircle", label: "Чаты" },
  { tab: "contacts", icon: "Users", label: "Контакты" },
  { tab: "calls", icon: "Phone", label: "Звонки" },
  { tab: "status", icon: "Circle", label: "Статус" },
  { tab: "profile", icon: "User", label: "Профиль" },
  { tab: "settings", icon: "Settings", label: "Настройки" },
];

function BottomNav({ active, onChange, unreadCount }: {
  active: Tab; onChange: (t: Tab) => void; unreadCount: number;
}) {
  return (
    <nav className="flex-shrink-0 glass-strong border-t border-white/5 px-1 pb-safe">
      <div className="flex items-center justify-around py-1.5">
        {NAV_ITEMS.map(({ tab, icon, label }) => {
          const isActive = active === tab;
          return (
            <button key={tab} onClick={() => onChange(tab)}
              className={`relative flex flex-col items-center gap-0.5 px-2 py-2 rounded-2xl transition-all duration-200 min-w-[48px]
                ${isActive ? "nav-item-active" : "hover:bg-white/5 active:scale-95"}`}>
              <div className="relative">
                <Icon name={icon} size={20} className={`transition-all ${isActive ? "text-sky-400" : "text-muted-foreground"}`} />
                {tab === "chats" && unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-gradient-to-br from-blue-500 to-pink-500 rounded-full text-[9px] text-white font-bold flex items-center justify-center">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </div>
              <span className={`text-[9px] font-medium ${isActive ? "text-sky-400" : "text-muted-foreground"}`}>{label}</span>
              {isActive && <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-sky-400" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─── Voice Player ─────────────────────────────────────────────────────────────

function VoicePlayer({ src, isOut, isRead, msgId, token, onRead }: {
  src: string; isOut: boolean; isRead: boolean; msgId: number | string;
  token: string; onRead?: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrent] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const a = new Audio(src);
    a.preload = "metadata";
    a.onloadedmetadata = () => { setDuration(isFinite(a.duration) ? a.duration : 0); };
    a.ontimeupdate = () => {
      setCurrent(a.currentTime);
      setProgress(a.duration ? a.currentTime / a.duration : 0);
    };
    a.onended = () => { setPlaying(false); setProgress(0); setCurrent(0); };
    audioRef.current = a;
    return () => { a.pause(); a.src = ""; };
  }, [src]);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else {
      a.play().then(() => { setPlaying(true); }).catch(() => {});
      if (!isOut && !isRead && typeof msgId === "number") {
        fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "read", message_id: msgId }) })
          .then(() => onRead?.()).catch(() => {});
      }
    }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    a.currentTime = ratio * a.duration;
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const accent = isOut ? "bg-white/70" : (isRead ? "bg-sky-400" : "bg-amber-400");
  const trackBg = isOut ? "bg-white/20" : "bg-white/10";

  // Псевдо-волна из seed по url
  const bars = Array.from({ length: 28 }, (_, i) => {
    const seed = (src.charCodeAt(i % src.length) + i * 7) % 24;
    return 4 + seed;
  });

  return (
    <div className="flex items-center gap-2.5 min-w-[200px] max-w-[260px]">
      {/* Play/Pause */}
      <button onClick={toggle}
        className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-95
          ${isOut ? "bg-white/20 hover:bg-white/30" : "bg-sky-500/20 hover:bg-sky-500/30"}`}>
        <Icon name={playing ? "Pause" : "Play"} size={16}
          className={isOut ? "text-white" : (isRead ? "text-sky-400" : "text-amber-400")} />
      </button>

      {/* Волна + прогресс */}
      <div className="flex-1 flex flex-col gap-1">
        <div className={`relative flex items-end gap-[2px] h-6 cursor-pointer rounded-sm overflow-hidden ${trackBg}`}
          onClick={seek}>
          {bars.map((h, i) => {
            const barProgress = (i + 1) / bars.length;
            const filled = barProgress <= progress;
            return (
              <div key={i} className={`flex-1 rounded-full transition-colors duration-75 ${filled ? accent : (isOut ? "bg-white/25" : "bg-white/15")}`}
                style={{ height: `${h}px`, minHeight: "3px" }} />
            );
          })}
        </div>
        <div className="flex justify-between">
          <span className={`text-[10px] tabular-nums ${isOut ? "text-white/60" : "text-muted-foreground"}`}>
            {playing ? fmt(currentTime) : (duration > 0 ? fmt(duration) : "--:--")}
          </span>
          {!isOut && !isRead && (
            <span className="text-[10px] text-amber-400/80">●</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Chat Screen ──────────────────────────────────────────────────────────────

function ChatScreen({ chat, token, currentUserId, onBack, allChats, onMessageRead, initialMsgId, onCall, onChatUpdate }: {
  chat: Chat; token: string; currentUserId: number; onBack: () => void; allChats: Chat[]; onMessageRead?: () => void; initialMsgId?: number; onCall?: (userId: number, userName: string, isVideo?: boolean) => void; onChatUpdate?: (updated: Partial<Chat>) => void;
}) {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [typists, setTypists] = useState<string[]>([]);
  const [showMembers, setShowMembers] = useState(false);
  const [members, setMembers] = useState<{ id: number; name: string; status: string; role: string; can_post: boolean; is_me: boolean; avatar_url?: string | null }[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmKick, setConfirmKick] = useState<{ id: number; name: string } | null>(null);
  const [editingChat, setEditingChat] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editPublic, setEditPublic] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [uploadingGroupAvatar, setUploadingGroupAvatar] = useState(false);
  const groupAvatarInputRef = useRef<HTMLInputElement>(null);
  const [addMemberSearch, setAddMemberSearch] = useState("");
  const [addMemberResults, setAddMemberResults] = useState<{ id: number; name: string; phone: string; status: string; avatar_url?: string | null }[]>([]);
  const [addMemberLoading, setAddMemberLoading] = useState(false);
  const [leftGroup, setLeftGroup] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIdx, setSearchIdx] = useState(0);
  const [showStats, setShowStats] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockedMe, setBlockedMe] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [showBlockMenu, setShowBlockMenu] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportComment, setReportComment] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const [reportMsgId, setReportMsgId] = useState<number | null>(null);
  const [forwardMsg, setForwardMsg] = useState<{ text: string; file_url?: string | null; file_name?: string | null; file_type?: string | null } | null>(null);
  const [forwardSearch, setForwardSearch] = useState("");
  const [forwarding, setForwarding] = useState<number | null>(null);
  const [forwardDone, setForwardDone] = useState<number | null>(null);
  const [pinnedMsg, setPinnedMsg] = useState<{ id: number; text: string; sender_name: string; file_type: string | null } | null>(null);
  const [stats, setStats] = useState<{
    total_messages: number; total_files: number; total_photos: number;
    first_message_at: string | null; active_members: number;
    member_count: number; days_active: number;
  } | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ url: string; name: string; size: number; type: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [pickerMsgId, setPickerMsgId] = useState<number | string | null>(null);
  const [menuMsgId, setMenuMsgId] = useState<number | string | null>(null);
  const [editingMsg, setEditingMsg] = useState<{ id: number | string; text: string } | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: number | string; text: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const msgRefs = useRef<Record<string | number, HTMLDivElement | null>>({});
  const endRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingSent = useRef(false);

  // Voice recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [voicePreview, setVoicePreview] = useState<{ blob: Blob; url: string; duration: number } | null>(null);
  const [waveformBars, setWaveformBars] = useState<number[]>(Array(28).fill(3));
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waveAnimRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const isAtBottom = useRef(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isInContext, setIsInContext] = useState(false);
  const isInContextRef = useRef(false);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [peerStatus, setPeerStatus] = useState<{ online: boolean; last_seen: string | null }>({
    online: !!chat.peer_online,
    last_seen: chat.peer_last_seen ?? null,
  });

  useEffect(() => {
    if (chat.is_group) return;
    async function pollPresence() {
      try {
        const res = await fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "presence", chat_id: chat.id }) });
        const data = await res.json();
        setPeerStatus({ online: data.status === "online", last_seen: data.last_seen });
      } catch { /* ignore */ }
    }
    pollPresence();
    const id = setInterval(pollPresence, 15000);
    return () => clearInterval(id);
  }, [chat.id, chat.is_group, token]);

  // Загружаем статус блокировки для личных чатов
  useEffect(() => {
    if (chat.is_group || !chat.peer_id) return;
    fetch(AUTH_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "block-status", user_id: chat.peer_id }) })
      .then(r => r.json())
      .then(d => { setIsBlocked(!!d.i_blocked); setBlockedMe(!!d.blocked_me); })
      .catch(() => {});
  }, [chat.id, chat.is_group, chat.peer_id, token]);

  function formatLastSeen(iso: string | null): string {
    if (!iso) return "давно";
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "только что";
    if (mins < 60) return `${mins} мин назад`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} ч назад`;
    return `${Math.floor(hrs / 24)} дн назад`;
  }

  const loadMessages = useCallback(async (silent = false) => {
    try {
      const res = await fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "messages", chat_id: chat.id }) });
      if (!res.ok) return;
      const data = await res.json();
      if (data.has_more !== undefined) setHasMore(data.has_more);
      if ("pinned" in data) setPinnedMsg(data.pinned);
      if (!data.messages) return;

      setMessages(prev => {
        // Индекс уже существующих реальных ID (не opt-)
        const prevIds = new Set(prev.map(m => String(m.id)));
        // Новые сообщения которых ещё нет (игнорируем optimistic)
        const incoming = data.messages.filter((m: Message) => !prevIds.has(String(m.id)));
        const newIncoming = incoming.filter((m: Message) => !m.out);

        if (silent && newIncoming.length > 0) {
          if (navigator.vibrate) navigator.vibrate([40, 30, 40]);
          try {
            const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.08);
            gain.gain.setValueAtTime(0.18, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
            osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.18);
          } catch { /* браузер может заблокировать без жеста */ }
          setNewMsgCount(n => n + newIncoming.length);
        }

        // В старом контексте — только добавляем новые, не заменяем всё
        if (silent && isInContextRef.current) {
          if (incoming.length === 0) return prev;
          return [...prev, ...incoming];
        }

        if (!silent) return data.messages;

        // При polling: если нет новых — не обновляем (избегаем лишних ре-рендеров)
        if (incoming.length === 0) return prev;

        // Склеиваем: optimistic сообщения + обновлённые данные с сервера
        const optimisticOnly = prev.filter(m => String(m.id).startsWith("opt-"));
        return [...data.messages, ...optimisticOnly];
      });
    } catch {
      // сеть недоступна — тихо игнорируем при polling
    } finally {
      if (!silent) setLoading(false);
    }
  }, [chat.id, token]);

  function formatDateLabel(dateStr: string): string {
    const d = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const toDay = (x: Date) => x.toISOString().slice(0, 10);
    if (dateStr === toDay(today)) return "Сегодня";
    if (dateStr === toDay(yesterday)) return "Вчера";
    return d.toLocaleDateString("ru", { day: "numeric", month: "long", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
  }

  const messagesRef = useRef<Message[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const loadOlder = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const container = scrollContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;
    try {
      const firstId = messagesRef.current[0]?.id;
      if (!firstId || String(firstId).startsWith("opt-")) return;
      const res = await fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "messages", chat_id: chat.id, before_id: firstId }) });
      const data = await res.json();
      if (data.has_more !== undefined) setHasMore(data.has_more);
      if (data.messages?.length) {
        setMessages(prev => [...data.messages, ...prev]);
        requestAnimationFrame(() => {
          if (container) container.scrollTop = container.scrollHeight - prevScrollHeight;
        });
      }
    } finally { setLoadingMore(false); }
  }, [chat.id, token, hasMore, loadingMore]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  // Скролл к initialMsgId после загрузки; если не найдено — подгружаем через around_id
  const initialScrollDone = useRef(false);
  const aroundLoadDone = useRef(false);
  useEffect(() => {
    if (!initialMsgId || loading || initialScrollDone.current) return;
    const el = msgRefs.current[initialMsgId];
    if (el) {
      initialScrollDone.current = true;
      setTimeout(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("msg-highlight");
        setTimeout(() => el.classList.remove("msg-highlight"), 2500);
      }, 150);
    } else if (!aroundLoadDone.current) {
      // Сообщение не в текущей порции — грузим контекст вокруг него
      aroundLoadDone.current = true;
      fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "messages", chat_id: chat.id, around_id: initialMsgId }) })
        .then(r => r.json())
        .then(data => {
          if (data.messages?.length) {
            setMessages(data.messages);
            if (data.has_more !== undefined) setHasMore(data.has_more);
            setIsInContext(true);
            isInContextRef.current = true;
          }
        });
    }
  }, [initialMsgId, loading, messages, chat.id, token]);

  function jumpToLatest() {
    setIsInContext(false);
    isInContextRef.current = false;
    setNewMsgCount(0);
    loadMessages().then(() => {
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    });
  }

  // Poll for new messages every 4s (не агрессивнее чем нужно)
  useEffect(() => {
    const id = setInterval(() => loadMessages(true), 4000);
    return () => clearInterval(id);
  }, [loadMessages]);

  // Poll typing status every 2s
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "typing", chat_id: chat.id }) });
        const data = await res.json();
        setTypists(data.typists ?? []);
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [chat.id, token]);

  function sendTyping() {
    if (isTypingSent.current) return;
    isTypingSent.current = true;
    fetch(CHATS_URL, {
      method: "POST", headers: apiHeaders(token),
      body: JSON.stringify({ action: "typing", chat_id: chat.id }),
    }).catch(() => {});
    // Reset flag after 3s so next keystroke fires again
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => { isTypingSent.current = false; }, 3000);
  }

  async function loadMembers() {
    if (!chat.is_group) return;
    setMembersLoading(true);
    try {
      const res = await fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "members", chat_id: chat.id }) });
      const data = await res.json();
      if (data.members) setMembers(data.members);
    } finally { setMembersLoading(false); }
  }

  function toggleMembers() {
    if (!showMembers) loadMembers();
    setShowMembers(v => !v);
  }

  async function leaveGroup() {
    try {
      await fetch(CHATS_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: "leave", chat_id: chat.id }),
      });
      setLeftGroup(true);
      setTimeout(() => onBack(), 800);
    } catch { /* ignore */ } finally { setConfirmLeave(false); }
  }

  async function kickMember(memberId: number) {
    try {
      await fetch(CHATS_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: "kick", chat_id: chat.id, user_id: memberId }),
      });
      setMembers(prev => prev.filter(m => m.id !== memberId));
      loadMessages(true);
    } catch { /* ignore */ } finally { setConfirmKick(null); }
  }

  const myRole = members.find(m => m.is_me)?.role ?? chat.my_role;
  const myCanPost = members.find(m => m.is_me)?.can_post ?? chat.can_post ?? false;

  async function uploadGroupAvatar(file: File) {
    setUploadingGroupAvatar(true);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        const res = await fetch(CHATS_URL, {
          method: "POST", headers: apiHeaders(token),
          body: JSON.stringify({ action: "upload-group-avatar", chat_id: chat.id, image: dataUrl }),
        });
        const data = await res.json();
        if (data.avatar_url) onChatUpdate?.({ avatar_url: data.avatar_url });
        setUploadingGroupAvatar(false);
      };
      reader.readAsDataURL(file);
    } catch { setUploadingGroupAvatar(false); }
  }

  async function saveEditChat() {
    setEditSaving(true);
    try {
      const res = await fetch(CHATS_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: "update-chat", chat_id: chat.id, name: editName, description: editDesc, is_public: editPublic }),
      });
      const data = await res.json();
      if (data.ok) {
        onChatUpdate?.({
          name: data.name,
          description: data.description,
          is_public: data.is_public,
        });
        setEditingChat(false);
      }
    } finally { setEditSaving(false); }
  }

  async function setMemberRole(memberId: number, role: string, canPost?: boolean) {
    try {
      await fetch(CHATS_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: "set-role", chat_id: chat.id, user_id: memberId, role, can_post: canPost }),
      });
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role, can_post: canPost ?? m.can_post } : m));
    } catch { /* ignore */ }
  }

  async function searchAddMember(q: string) {
    setAddMemberSearch(q);
    if (!q.trim()) { setAddMemberResults([]); return; }
    setAddMemberLoading(true);
    try {
      const res = await fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "users", q }) });
      const data = await res.json();
      if (data.users) {
        const memberIds = new Set(members.map(m => m.id));
        setAddMemberResults(data.users.filter((u: { id: number }) => !memberIds.has(u.id)));
      }
    } finally { setAddMemberLoading(false); }
  }

  async function addMember(userId: number, userName: string) {
    try {
      await fetch(CHATS_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: "add-members", chat_id: chat.id, members: [userId] }),
      });
      setMembers(prev => [...prev, { id: userId, name: userName, status: "offline", role: "member", can_post: !chat.is_channel, is_me: false }]);
      setAddMemberSearch(""); setAddMemberResults([]);
    } catch { /* ignore */ }
  }

  // Scroll to bottom only when at bottom or new own message
  useEffect(() => {
    if (isAtBottom.current) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Mark incoming messages as read when they appear on screen
  useEffect(() => {
    const unread = messages.filter(m => !m.out && !m.is_read && typeof m.id === "number");
    if (!unread.length) return;

    const markRead = async (msgId: number) => {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_read: true } : m));
      onMessageRead?.();
      await fetch(CHATS_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: "read", message_id: msgId }),
      }).catch(() => {});
    };

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = Number((entry.target as HTMLElement).dataset.msgId);
          if (id) { markRead(id); observer.unobserve(entry.target); }
        }
      });
    }, { threshold: 0.5, root: scrollContainerRef.current });

    unread.forEach(m => {
      const el = msgRefs.current[m.id];
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [messages, token]);

  const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "👏", "🎉"];

  async function sendReaction(msgId: number | string, emoji: string) {
    setPickerMsgId(null);
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      const existing = (m.reactions || []).find(r => r.emoji === emoji);
      let updated: Reaction[];
      if (existing?.i_reacted) {
        updated = (m.reactions || [])
          .map(r => r.emoji === emoji ? { ...r, count: r.count - 1, i_reacted: false } : r)
          .filter(r => r.count > 0);
      } else if (existing) {
        updated = (m.reactions || []).map(r => r.emoji === emoji ? { ...r, count: r.count + 1, i_reacted: true } : r);
      } else {
        updated = [...(m.reactions || []), { emoji, count: 1, i_reacted: true }];
      }
      return { ...m, reactions: updated };
    }));
    try {
      const res = await fetch(CHATS_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: "react", message_id: msgId, emoji }),
      });
      const data = await res.json();
      if (data.reactions !== undefined) {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reactions: data.reactions } : m));
      }
    } catch { /* keep optimistic */ }
  }

  async function forwardTo(targetChatId: number) {
    if (!forwardMsg) return;
    setForwarding(targetChatId);
    try {
      await fetch(CHATS_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({
          action: "send",
          chat_id: targetChatId,
          text: forwardMsg.text || "",
          file_url: forwardMsg.file_url, file_name: forwardMsg.file_name, file_type: forwardMsg.file_type,
        }),
      });
      setForwardDone(targetChatId);
      setTimeout(() => { setForwardDone(null); setForwardMsg(null); setForwardSearch(""); }, 1200);
    } finally { setForwarding(null); }
  }

  async function pinMessage(msgId: number | string, pin: boolean) {
    setMenuMsgId(null);
    const msg = messagesRef.current.find(m => m.id === msgId);
    if (pin && msg) {
      setPinnedMsg({ id: Number(msgId), text: msg.text, sender_name: msg.sender_name || "Вы", file_type: msg.file_type ?? null });
    } else if (!pin) {
      setPinnedMsg(null);
    }
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_pinned: pin } : pin ? { ...m, is_pinned: false } : m));
    fetch(CHATS_URL, {
      method: "POST", headers: apiHeaders(token),
      body: JSON.stringify({ action: "pin-message", message_id: msgId, pin }),
    }).catch(() => {});
  }

  async function toggleBlock() {
    if (!chat.peer_id) return;
    setBlockLoading(true);
    setShowBlockMenu(false);
    try {
      const endpoint = isBlocked ? "/unblock" : "/block";
      const res = await fetch(AUTH_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: endpoint.replace("/", ""), user_id: chat.peer_id }),
      });
      const data = await res.json();
      if (data.ok) setIsBlocked(!isBlocked);
    } catch { /* ignore */ }
    finally { setBlockLoading(false); }
  }

  async function sendReport() {
    if (!reportReason) return;
    setReportLoading(true);
    try {
      const body: Record<string, unknown> = { action: "report", reason: reportReason, comment: reportComment };
      if (reportMsgId) body.message_id = reportMsgId;
      else if (chat.peer_id) body.user_id = chat.peer_id;
      const res = await fetch(AUTH_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) setReportDone(true);
    } catch { /* ignore */ }
    finally { setReportLoading(false); }
  }

  async function loadStats() {
    if (stats || statsLoading) return;
    setStatsLoading(true);
    try {
      const res = await fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "stats", chat_id: chat.id }) });
      const data = await res.json();
      if (data.total_messages !== undefined) setStats(data);
    } finally { setStatsLoading(false); }
  }

  function toggleStats() {
    setShowStats(v => !v);
    if (!stats) loadStats();
  }

  async function editMessage(msgId: number | string, newText: string) {
    if (!newText.trim()) return;
    setEditingMsg(null);
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, text: newText, is_edited: true } : m));
    try {
      const res = await fetch(CHATS_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: "edit-message", message_id: msgId, text: newText }),
      });
      const data = await res.json();
      if (data.text) {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, text: data.text, is_edited: true } : m));
      }
    } catch { /* keep optimistic */ }
  }

  async function deleteMessage(msgId: number | string) {
    setMenuMsgId(null);
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_deleted: true, text: "" } : m));
    try {
      await fetch(CHATS_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: "delete-message", message_id: msgId }),
      });
    } catch { /* keep optimistic */ }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploadError(null);

    if (file.size > 25 * 1024 * 1024) {
      setUploadError("Файл слишком большой. Максимум 25 МБ");
      return;
    }

    setUploading(true);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch(CHATS_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: "upload", file: b64, file_name: file.name, file_type: file.type }),
      });
      const data = await res.json();
      if (data.file_url) {
        setPendingFile({ url: data.file_url, name: data.file_name ?? file.name, size: data.file_size ?? file.size, type: data.file_type ?? file.type });
      } else {
        setUploadError(data.error || "Не удалось загрузить файл");
      }
    } catch {
      setUploadError("Ошибка сети при загрузке файла");
    } finally {
      setUploading(false);
    }
  }

  const searchMatches = searchQuery.trim()
    ? messages.filter(m => m.text.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  function openSearch() {
    setSearchOpen(true);
    setSearchQuery("");
    setSearchIdx(0);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchIdx(0);
  }

  function scrollToMatch(idx: number) {
    const msg = searchMatches[idx];
    if (!msg) return;
    const el = msgRefs.current[msg.id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function searchNext() {
    const next = searchMatches.length === 0 ? 0 : (searchIdx + 1) % searchMatches.length;
    setSearchIdx(next);
    scrollToMatch(next);
  }

  function searchPrev() {
    const prev = searchMatches.length === 0 ? 0 : (searchIdx - 1 + searchMatches.length) % searchMatches.length;
    setSearchIdx(prev);
    scrollToMatch(prev);
  }

  useEffect(() => {
    if (searchMatches.length > 0) {
      setSearchIdx(0);
      scrollToMatch(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  useEffect(() => {
    if (editingMsg) { setText(editingMsg.text); }
  }, [editingMsg]);

  async function doSend(optId: string, payload: { text: string; file_url?: string | null; file_name?: string | null; file_size?: number | null; file_type?: string | null; reply_to_id?: number | null }) {
    setMessages(prev => prev.map(m => m.id === optId ? { ...m, _failed: false } : m));
    try {
      const res = await fetch(CHATS_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: "send", chat_id: chat.id, ...payload }),
      });
      const data = await res.json();
      if (data.message) {
        setMessages(prev => prev.map(m => m.id === optId ? { ...data.message, out: true } : m));
      } else {
        setMessages(prev => prev.map(m => m.id === optId ? { ...m, _failed: true } : m));
      }
    } catch {
      setMessages(prev => prev.map(m => m.id === optId ? { ...m, _failed: true } : m));
    }
  }

  async function retrySend(msg: Message) {
    const payload = {
      text: msg.text, file_url: msg.file_url, file_name: msg.file_name,
      file_size: msg.file_size, file_type: msg.file_type, reply_to_id: msg.reply_to_id ?? null,
    };
    await doSend(String(msg.id), payload);
  }

  async function send() {
    if (editingMsg) {
      await editMessage(editingMsg.id, text);
      setText("");
      return;
    }
    const t = text.trim();
    const pf = pendingFile;
    if (!t && !pf) return;
    const rp = replyTo;
    const optId = `opt-${Date.now()}-${Math.random()}`;
    const optimistic: Message = {
      id: optId, text: t,
      time: new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }),
      out: true, is_read: false,
      file_url: pf?.url, file_name: pf?.name, file_size: pf?.size, file_type: pf?.type,
      reply_to_id: rp ? Number(rp.id) : null,
      reply_to_text: rp?.text ?? null,
      reply_to_name: rp?.name ?? null,
    };
    setMessages(prev => [...prev, optimistic]);
    setText(""); setPendingFile(null); setReplyTo(null);
    await doSend(optId, {
      text: t, file_url: pf?.url, file_name: pf?.name, file_size: pf?.size, file_type: pf?.type,
      reply_to_id: rp ? Number(rp.id) : null,
    });
  }

  async function startRecording() {
    if (isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.start(100);
      mediaRecorderRef.current = mr;
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);

      // Визуализация волны через AnalyserNode
      try {
        const AudioCtx = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 64;
          ctx.createMediaStreamSource(stream).connect(analyser);
          analyserRef.current = analyser;
          audioCtxRef.current = ctx;
          const data = new Uint8Array(analyser.frequencyBinCount);
          const draw = () => {
            analyser.getByteFrequencyData(data);
            const bars = Array.from({ length: 28 }, (_, i) => {
              const idx = Math.floor(i * data.length / 28);
              return Math.max(3, Math.round((data[idx] / 255) * 32));
            });
            setWaveformBars(bars);
            waveAnimRef.current = requestAnimationFrame(draw);
          };
          draw();
        }
      } catch { /* без визуализации */ }
    } catch { /* нет доступа к микрофону */ }
  }

  function cancelRecording() {
    if (waveAnimRef.current) { cancelAnimationFrame(waveAnimRef.current); waveAnimRef.current = null; }
    analyserRef.current = null;
    audioCtxRef.current?.close().catch(() => {}); audioCtxRef.current = null;
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      try { mediaRecorderRef.current.stop(); } catch { /* уже остановлен */ }
      mediaRecorderRef.current = null;
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    audioChunksRef.current = [];
    setIsRecording(false);
    setRecordingTime(0);
    setWaveformBars(Array(28).fill(3));
    setVoicePreview(null);
  }

  async function stopRecording() {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    setIsRecording(false);
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (waveAnimRef.current) { cancelAnimationFrame(waveAnimRef.current); waveAnimRef.current = null; }
    analyserRef.current = null;
    audioCtxRef.current?.close().catch(() => {}); audioCtxRef.current = null;

    const duration = recordingTime;
    await new Promise<void>(resolve => { mr.onstop = () => resolve(); mr.stop(); });
    mr.stream.getTracks().forEach(t => t.stop());
    mediaRecorderRef.current = null;

    const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || "audio/webm" });
    audioChunksRef.current = [];
    setRecordingTime(0);
    setWaveformBars(Array(28).fill(3));
    if (blob.size < 500) return;

    const url = URL.createObjectURL(blob);
    setVoicePreview({ blob, url, duration });
  }

  async function sendVoiceBlob(blob: Blob, duration: number) {
    if (voicePreview) { URL.revokeObjectURL(voicePreview.url); setVoicePreview(null); }
    if (blob.size < 500) return;
    setUploading(true);
    const optId = `opt-${Date.now()}-${Math.random()}`;
    const fmtDur = `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`;
    const mimeType = blob.type || "audio/webm";
    const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : "webm";
    // Добавляем optimistic сразу
    const optimistic: Message = {
      id: optId, text: "",
      time: new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }),
      out: true, is_read: false,
      file_url: null, file_name: `Голосовое · ${fmtDur}`, file_size: blob.size, file_type: mimeType,
    };
    setMessages(prev => [...prev, optimistic]);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      const dataUrl = await new Promise<string>((res, rej) => {
        reader.onload = () => res(reader.result as string);
        reader.onerror = rej;
      });
      const base64 = dataUrl.split(",")[1];
      const upRes = await fetch(CHATS_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: "upload", file_data: base64, file_name: `voice_${Date.now()}.${ext}`, file_type: mimeType }),
      });
      const upData = await upRes.json();
      if (!upData.url) throw new Error("Upload failed");

      const sendRes = await fetch(CHATS_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: "send", chat_id: chat.id, text: "", file_url: upData.url, file_name: optimistic.file_name, file_size: blob.size, file_type: mimeType }),
      });
      const sendData = await sendRes.json();
      if (sendData.message) {
        setMessages(prev => prev.map(m => m.id === optId ? { ...sendData.message, out: true } : m));
      } else {
        setMessages(prev => prev.map(m => m.id === optId ? { ...m, _failed: true } : m));
      }
    } catch {
      setMessages(prev => prev.map(m => m.id === optId ? { ...m, _failed: true } : m));
    } finally { setUploading(false); }
  }

  if (leftGroup) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 animate-fade-in">
        <div className="w-16 h-16 rounded-3xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
          <Icon name="LogOut" size={28} className="text-blue-400" />
        </div>
        <p className="text-muted-foreground text-sm">Вы покинули группу</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full animate-slide-in-right">
      <div className="flex-shrink-0 glass border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 -ml-2 hover:bg-white/10 rounded-full transition-colors">
            <Icon name="ArrowLeft" size={20} />
          </button>
          <button onClick={chat.is_group ? toggleMembers : undefined} className="flex items-center gap-3 flex-1 min-w-0">
            <AvatarEl name={chat.name} size="sm" status={!chat.is_group ? (peerStatus.online ? "online" : "offline") : undefined} avatarUrl={chat.avatar_url} />
            <div className="flex-1 min-w-0 text-left">
              <div className="font-golos font-semibold text-foreground text-sm truncate">{chat.name}</div>
              <div className="text-xs flex items-center gap-1">
                {chat.is_channel
                  ? <><Icon name="Radio" size={10} className="text-purple-400" />
                      <span className="text-purple-300">{chat.member_count ?? 0} {chat.is_public ? "· публичный" : "· приватный"}</span></>
                  : chat.is_group
                    ? <span className="text-muted-foreground">{chat.member_count ?? 0} участников · нажмите для управления</span>
                    : peerStatus.online
                      ? <><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block animate-pulse" /><span className="text-green-400">в сети</span></>
                      : <span className="text-muted-foreground">был(а) {formatLastSeen(peerStatus.last_seen)}</span>
                }
              </div>
              {chat.is_channel && chat.description && !showMembers && (
                <div className="text-[10px] text-muted-foreground truncate mt-0.5">{chat.description}</div>
              )}
            </div>
          </button>
          {chat.is_group && (
            <button onClick={toggleMembers}
              className={`p-2 rounded-full transition-colors ${showMembers
                ? chat.is_channel ? "bg-purple-500/20 text-purple-400" : "bg-blue-500/20 text-sky-400"
                : "hover:bg-white/10 text-muted-foreground"}`}>
              <Icon name={chat.is_channel ? "Radio" : "Users"} size={18} />
            </button>
          )}
          <button onClick={openSearch}
            className={`p-2 rounded-full transition-colors ${searchOpen ? "bg-blue-500/20 text-sky-400" : "hover:bg-white/10 text-muted-foreground"}`}>
            <Icon name="Search" size={18} />
          </button>
          <button onClick={toggleStats}
            className={`p-2 rounded-full transition-colors ${showStats ? "bg-blue-500/20 text-sky-400" : "hover:bg-white/10 text-muted-foreground"}`}>
            <Icon name="ChartBar" size={18} />
          </button>
          {!chat.is_group && onCall && chat.peer_id && (
            <>
              <button onClick={() => onCall(chat.peer_id!, chat.name, false)} className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Аудиозвонок">
                <Icon name="Phone" size={18} className="text-cyan-400" />
              </button>
              <button onClick={() => onCall(chat.peer_id!, chat.name, true)} className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Видеозвонок">
                <Icon name="Video" size={18} className="text-cyan-400" />
              </button>
            </>
          )}
          {/* Меню блокировки для личных чатов */}
          {!chat.is_group && chat.peer_id && (
            <div className="relative">
              <button onClick={() => setShowBlockMenu(v => !v)}
                className={`p-2 rounded-full transition-colors ${showBlockMenu ? "bg-white/10" : "hover:bg-white/10 text-muted-foreground"}`}>
                {blockLoading
                  ? <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                  : <Icon name="MoreVertical" size={18} />}
              </button>
              {showBlockMenu && (
                <div className="absolute right-0 top-10 z-30 w-56 glass border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-fade-in">
                  {isBlocked ? (
                    <button onClick={toggleBlock}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-green-500/10 transition-colors text-left border-b border-white/5">
                      <Icon name="ShieldOff" size={15} className="text-green-400" />
                      <div>
                        <p className="text-sm text-green-300 font-medium">Разблокировать</p>
                        <p className="text-[11px] text-muted-foreground">Снять ограничения</p>
                      </div>
                    </button>
                  ) : (
                    <button onClick={toggleBlock}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-500/10 transition-colors text-left border-b border-white/5">
                      <Icon name="Shield" size={15} className="text-red-400" />
                      <div>
                        <p className="text-sm text-red-300 font-medium">Заблокировать</p>
                        <p className="text-[11px] text-muted-foreground">Добавить в чёрный список</p>
                      </div>
                    </button>
                  )}
                  <button onClick={() => { setShowBlockMenu(false); setReportMsgId(null); setReportReason(""); setReportComment(""); setReportDone(false); setShowReportModal(true); }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-orange-500/10 transition-colors text-left">
                    <Icon name="Flag" size={15} className="text-orange-400" />
                    <div>
                      <p className="text-sm text-orange-300 font-medium">Пожаловаться</p>
                      <p className="text-[11px] text-muted-foreground">На пользователя</p>
                    </div>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Баннер блокировки */}
        {!chat.is_group && (isBlocked || blockedMe) && (
          <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-xl bg-red-500/8 border border-red-500/15 animate-fade-in">
            <Icon name="Shield" size={13} className="text-red-400 flex-shrink-0" />
            <span className="text-xs text-red-300">
              {isBlocked ? "Вы заблокировали этого пользователя" : "Этот пользователь вас заблокировал"}
            </span>
            {isBlocked && (
              <button onClick={toggleBlock} className="ml-auto text-[11px] text-red-400 hover:text-red-300 underline transition-colors">
                Разблокировать
              </button>
            )}
          </div>
        )}

        {/* Модалка жалобы */}
        {showReportModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
            onClick={() => !reportLoading && setShowReportModal(false)}>
            <div className="w-full max-w-md bg-[hsl(var(--background))] border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/8">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-orange-500/15 flex items-center justify-center">
                    <Icon name="Flag" size={16} className="text-orange-400" />
                  </div>
                  <h2 className="font-golos font-bold text-foreground">
                    {reportMsgId ? "Жалоба на сообщение" : "Жалоба на пользователя"}
                  </h2>
                </div>
                {!reportLoading && (
                  <button onClick={() => setShowReportModal(false)}
                    className="p-2 rounded-full hover:bg-white/10 transition-colors text-muted-foreground">
                    <Icon name="X" size={18} />
                  </button>
                )}
              </div>

              <div className="px-5 py-4 space-y-4">
                {reportDone ? (
                  <div className="flex flex-col items-center gap-3 py-6 animate-fade-in">
                    <div className="w-14 h-14 rounded-2xl bg-green-500/15 flex items-center justify-center">
                      <Icon name="CheckCircle" size={28} className="text-green-400" />
                    </div>
                    <p className="font-golos font-bold text-foreground">Жалоба отправлена</p>
                    <p className="text-sm text-muted-foreground text-center leading-relaxed">
                      Мы рассмотрим её в течение 24 часов. Спасибо, что помогаете сделать сообщество безопаснее.
                    </p>
                    <button onClick={() => setShowReportModal(false)}
                      className="w-full mt-2 py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-golos font-semibold text-sm hover:opacity-90 transition-all">
                      Закрыть
                    </button>
                  </div>
                ) : (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Причина</p>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: "spam",          icon: "Megaphone",   label: "Спам" },
                          { id: "abuse",         icon: "AlertOctagon", label: "Оскорбления" },
                          { id: "fraud",         icon: "CreditCard",  label: "Мошенничество" },
                          { id: "inappropriate", icon: "EyeOff",      label: "Неприемлемый контент" },
                          { id: "threats",       icon: "Swords",      label: "Угрозы" },
                          { id: "other",         icon: "MoreHorizontal", label: "Другое" },
                        ].map(r => (
                          <button key={r.id} onClick={() => setReportReason(r.id)}
                            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all
                              ${reportReason === r.id
                                ? "bg-orange-500/15 border-orange-500/40 text-orange-300"
                                : "bg-secondary/40 border-white/8 text-muted-foreground hover:border-white/20"}`}>
                            <Icon name={r.icon} size={14} className="flex-shrink-0" />
                            <span className="text-xs font-medium leading-tight">{r.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Комментарий <span className="normal-case">(необязательно)</span></p>
                      <textarea
                        value={reportComment}
                        onChange={e => setReportComment(e.target.value)}
                        placeholder="Опишите подробнее, что произошло..."
                        rows={3}
                        maxLength={500}
                        className="w-full bg-secondary/60 border border-white/10 rounded-2xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-orange-500/40 transition-all"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1 text-right">{reportComment.length}/500</p>
                    </div>

                    <div className="flex gap-3 pt-1">
                      <button onClick={() => setShowReportModal(false)}
                        className="flex-1 py-3 rounded-2xl bg-secondary/60 text-sm text-muted-foreground hover:bg-white/10 transition-colors">
                        Отмена
                      </button>
                      <button onClick={sendReport}
                        disabled={!reportReason || reportLoading}
                        className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-orange-500 to-red-500 text-white font-golos font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                        {reportLoading
                          ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Отправляем...</>
                          : <><Icon name="Flag" size={14} />Отправить</>}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Members / Channel management panel */}
        {chat.is_group && showMembers && (
          <div className="mt-3 animate-fade-in space-y-3">

            {/* Настройки канала/группы для админа */}
            {myRole === "admin" && (
              <div className="rounded-xl border border-white/10 overflow-hidden">
                {!editingChat ? (
                  <button onClick={() => { setEditName(chat.name); setEditDesc(chat.description ?? ""); setEditPublic(chat.is_public ?? false); setEditingChat(true); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-white/5 transition-colors text-left">
                    <Icon name={chat.is_channel ? "Radio" : "Settings"} size={14} className={chat.is_channel ? "text-purple-400" : "text-sky-400"} />
                    <span className="text-xs font-semibold text-foreground flex-1">
                      {chat.is_channel ? "Настройки канала" : "Настройки группы"}
                    </span>
                    <Icon name="ChevronRight" size={14} className="text-muted-foreground" />
                  </button>
                ) : (
                  <div className="p-3 space-y-2">
                    <p className="text-[11px] font-semibold text-sky-400 uppercase tracking-wide mb-2">
                      {chat.is_channel ? "Настройки канала" : "Настройки группы"}
                    </p>
                    {/* Фото группы/канала */}
                    <div className="flex items-center gap-3 mb-1">
                      <div className="relative group flex-shrink-0">
                        <AvatarEl name={chat.name} size="lg" avatarUrl={chat.avatar_url} />
                        <button onClick={() => groupAvatarInputRef.current?.click()}
                          className="absolute inset-0 rounded-full flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                          {uploadingGroupAvatar
                            ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                            : <Icon name="Camera" size={16} className="text-white" />}
                        </button>
                        <input ref={groupAvatarInputRef} type="file" accept="image/*" className="hidden"
                          onChange={e => { const f = e.target.files?.[0]; if (f) uploadGroupAvatar(f); e.target.value = ""; }} />
                      </div>
                      <div className="text-xs text-muted-foreground leading-relaxed">
                        Нажмите на фото чтобы изменить обложку {chat.is_channel ? "канала" : "группы"}
                      </div>
                    </div>
                    <input value={editName} onChange={e => setEditName(e.target.value)}
                      placeholder="Название..."
                      className="w-full bg-secondary/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-sky-500/50 transition-all" />
                    <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)}
                      placeholder="Описание..." rows={2}
                      className="w-full bg-secondary/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-sky-500/50 transition-all resize-none" />
                    {chat.is_channel && (
                      <button onClick={() => setEditPublic(p => !p)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-xs transition-all ${editPublic ? "bg-purple-500/15 border-purple-500/30 text-purple-300" : "bg-secondary/40 border-white/10 text-muted-foreground"}`}>
                        <Icon name={editPublic ? "Globe" : "Lock"} size={13} />
                        {editPublic ? "Публичный канал" : "Приватный канал"}
                      </button>
                    )}
                    <div className="flex gap-2">
                      <button onClick={() => setEditingChat(false)}
                        className="flex-1 py-2 rounded-xl bg-secondary/60 text-xs text-muted-foreground hover:bg-white/10 transition-colors">
                        Отмена
                      </button>
                      <button onClick={saveEditChat} disabled={editSaving || !editName.trim()}
                        className={`flex-1 py-2 rounded-xl text-xs text-white font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-1.5
                          ${chat.is_channel ? "bg-gradient-to-r from-purple-600 to-violet-700" : "bg-gradient-to-r from-blue-600 to-blue-700"}`}>
                        {editSaving ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Icon name="Check" size={12} />}
                        Сохранить
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Добавить участника (только для админа) */}
            {myRole === "admin" && (
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <div className="relative">
                  <Icon name="UserPlus" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input value={addMemberSearch} onChange={e => searchAddMember(e.target.value)}
                    placeholder={chat.is_channel ? "Добавить подписчика..." : "Добавить участника..."}
                    className="w-full bg-transparent pl-8 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none" />
                  {addMemberLoading && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />}
                </div>
                {addMemberResults.length > 0 && (
                  <div className="border-t border-white/5 divide-y divide-white/5 max-h-40 overflow-y-auto scroll-container">
                    {addMemberResults.map(u => (
                      <button key={u.id} onClick={() => addMember(u.id, u.name)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors text-left">
                        <AvatarEl name={u.name} size="xs" status={u.status} avatarUrl={u.avatar_url} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{u.name}</p>
                          <p className="text-[10px] text-muted-foreground">{u.phone}</p>
                        </div>
                        <Icon name="Plus" size={13} className="text-sky-400 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Список участников */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-sky-400 uppercase tracking-wide">
                  {chat.is_channel ? "Подписчики" : "Участники"} · {members.length}
                </span>
                {!chat.is_channel && (
                  <button onClick={() => setConfirmLeave(true)}
                    className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10">
                    <Icon name="LogOut" size={11} />
                    Покинуть
                  </button>
                )}
              </div>
              {membersLoading ? (
                <div className="flex justify-center py-3">
                  <div className="w-5 h-5 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
                </div>
              ) : (
                <div className="space-y-0.5 max-h-52 overflow-y-auto scroll-container">
                  {members.map(m => {
                    const roleColors: Record<string, string> = {
                      admin: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
                      moderator: "text-cyan-400 bg-cyan-400/10 border-cyan-400/20",
                      member: "text-muted-foreground bg-white/5 border-white/10",
                    };
                    const roleLabels: Record<string, string> = {
                      admin: chat.is_channel ? "Автор" : "Админ",
                      moderator: "Модер",
                      member: chat.is_channel ? "Читатель" : "Участник",
                    };
                    return (
                      <div key={m.id} className="flex items-center gap-2 p-2 rounded-xl hover:bg-white/5 transition-all group">
                        <AvatarEl name={m.name} size="xs" status={m.status} avatarUrl={m.avatar_url} />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-foreground truncate block">{m.is_me ? "Вы" : m.name}</span>
                          {chat.is_channel && m.can_post && !m.is_me && (
                            <span className="text-[10px] text-purple-400">может публиковать</span>
                          )}
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border flex-shrink-0 ${roleColors[m.role] ?? roleColors.member}`}>
                          {roleLabels[m.role] ?? m.role}
                        </span>
                        {!m.is_me && myRole === "admin" && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                            {/* Повысить/понизить */}
                            {m.role !== "admin" && (
                              <button onClick={() => setMemberRole(m.id, "admin", chat.is_channel ? true : undefined)}
                                title="Сделать администратором"
                                className="p-1 rounded-full hover:bg-yellow-500/20 transition-colors">
                                <Icon name="ShieldCheck" size={12} className="text-yellow-400" />
                              </button>
                            )}
                            {chat.is_channel && (
                              <button onClick={() => setMemberRole(m.id, m.role, !m.can_post)}
                                title={m.can_post ? "Запретить публикации" : "Разрешить публикации"}
                                className="p-1 rounded-full hover:bg-purple-500/20 transition-colors">
                                <Icon name={m.can_post ? "PenOff" : "Pen"} size={12} className="text-purple-400" />
                              </button>
                            )}
                            {m.role !== "member" && (
                              <button onClick={() => setMemberRole(m.id, "member", false)}
                                title="Разжаловать"
                                className="p-1 rounded-full hover:bg-white/10 transition-colors">
                                <Icon name="ShieldMinus" size={12} className="text-muted-foreground" />
                              </button>
                            )}
                            <button onClick={() => setConfirmKick({ id: m.id, name: m.name })}
                              title="Удалить"
                              className="p-1 rounded-full hover:bg-red-500/20 transition-colors">
                              <Icon name="UserMinus" size={12} className="text-muted-foreground hover:text-red-400 transition-colors" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Диалог подтверждения выхода из группы */}
      {confirmLeave && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-black/50 animate-fade-in" onClick={() => setConfirmLeave(false)}>
          <div className="w-full max-w-md glass border border-white/10 rounded-2xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold text-foreground">Покинуть {chat.is_channel ? "канал" : "группу"}?</p>
            <p className="text-xs text-muted-foreground">Вы больше не будете получать сообщения из «{chat.name}»</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmLeave(false)} className="flex-1 py-2.5 rounded-xl bg-secondary/60 text-sm text-muted-foreground hover:bg-white/10 transition-colors">Отмена</button>
              <button onClick={leaveGroup} className="flex-1 py-2.5 rounded-xl bg-red-600 text-sm text-white font-semibold hover:bg-red-700 transition-colors">Покинуть</button>
            </div>
          </div>
        </div>
      )}

      {/* Диалог подтверждения удаления участника */}
      {confirmKick && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-black/50 animate-fade-in" onClick={() => setConfirmKick(null)}>
          <div className="w-full max-w-md glass border border-white/10 rounded-2xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold text-foreground">Удалить {confirmKick.name}?</p>
            <p className="text-xs text-muted-foreground">Участник будет удалён из {chat.is_channel ? "канала" : "группы"}</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmKick(null)} className="flex-1 py-2.5 rounded-xl bg-secondary/60 text-sm text-muted-foreground hover:bg-white/10 transition-colors">Отмена</button>
              <button onClick={() => kickMember(confirmKick.id)} className="flex-1 py-2.5 rounded-xl bg-red-600 text-sm text-white font-semibold hover:bg-red-700 transition-colors">Удалить</button>
            </div>
          </div>
        </div>
      )}

      {/* Pinned message banner */}
      {pinnedMsg && (
        <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 glass border-t border-white/5 animate-fade-in cursor-pointer hover:bg-white/5 transition-colors group"
          onClick={() => {
            const el = msgRefs.current[pinnedMsg.id];
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          }}>
          <div className="w-0.5 h-8 rounded-full bg-sky-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-sky-400 flex items-center gap-1">
              <Icon name="Pin" size={10} />
              Закреплено · {pinnedMsg.sender_name}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {pinnedMsg.file_type?.startsWith("image/") ? "📷 Фото" : pinnedMsg.file_type ? "📎 Файл" : pinnedMsg.text || "Сообщение"}
            </p>
          </div>
          <button onClick={e => { e.stopPropagation(); pinMessage(pinnedMsg.id, false); }}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded-full transition-all flex-shrink-0">
            <Icon name="X" size={13} className="text-muted-foreground" />
          </button>
        </div>
      )}

      {showStats && (
        <div className="flex-shrink-0 px-4 py-3 glass border-t border-white/5 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Icon name="ChartBar" size={14} className="text-sky-400" />
              <span className="text-xs font-semibold text-sky-400 uppercase tracking-wide">Статистика чата</span>
            </div>
            <button onClick={() => setShowStats(false)} className="p-1 hover:bg-white/10 rounded-full transition-colors">
              <Icon name="X" size={14} className="text-muted-foreground" />
            </button>
          </div>
          {statsLoading ? (
            <div className="flex justify-center py-3">
              <div className="w-5 h-5 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
            </div>
          ) : stats ? (
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: "MessageCircle", label: "Сообщений", value: stats.total_messages, color: "text-sky-400" },
                { icon: "Image", label: "Фото", value: stats.total_photos, color: "text-cyan-400" },
                { icon: "Paperclip", label: "Файлов", value: stats.total_files, color: "text-blue-400" },
                { icon: "Users", label: "Участников", value: stats.member_count, color: "text-sky-400" },
                { icon: "UserCheck", label: "Активных", value: stats.active_members, color: "text-green-400" },
                { icon: "CalendarDays", label: "Дней", value: stats.days_active, color: "text-cyan-400" },
              ].map(s => (
                <div key={s.label} className="glass rounded-2xl p-3 flex flex-col items-center gap-1 border border-white/5">
                  <Icon name={s.icon as Parameters<typeof Icon>[0]["name"]} size={16} className={s.color} />
                  <span className="text-base font-golos font-black text-foreground">{s.value.toLocaleString("ru")}</span>
                  <span className="text-[10px] text-muted-foreground leading-tight text-center">{s.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">Нет данных</p>
          )}
          {stats?.first_message_at && (
            <p className="text-[11px] text-muted-foreground text-center mt-2">
              Первое сообщение: {new Date(stats.first_message_at).toLocaleDateString("ru", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          )}
        </div>
      )}

      {searchOpen && (
        <div className="flex-shrink-0 px-3 py-2 glass border-t border-white/5 animate-fade-in">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { if (e.shiftKey) { searchPrev(); } else { searchNext(); } } else if (e.key === "Escape") { closeSearch(); } }}
                placeholder="Поиск по сообщениям..."
                className="w-full bg-secondary/60 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-sky-500/50 transition-all" />
            </div>
            {searchQuery.trim() && (
              <span className="text-xs text-muted-foreground whitespace-nowrap min-w-[52px] text-center">
                {searchMatches.length === 0 ? "0 / 0" : `${searchIdx + 1} / ${searchMatches.length}`}
              </span>
            )}
            <button onClick={searchPrev} disabled={searchMatches.length === 0}
              className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30 transition-colors">
              <Icon name="ChevronUp" size={16} className="text-muted-foreground" />
            </button>
            <button onClick={searchNext} disabled={searchMatches.length === 0}
              className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30 transition-colors">
              <Icon name="ChevronDown" size={16} className="text-muted-foreground" />
            </button>
            <button onClick={closeSearch} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
              <Icon name="X" size={16} className="text-muted-foreground" />
            </button>
          </div>
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto scroll-container px-4 py-4 space-y-2"
        style={{ background: "radial-gradient(ellipse at top, rgba(0,119,182,0.04) 0%, transparent 60%)" }}
        onScroll={e => {
          const el = e.currentTarget;
          isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (el.scrollTop < 80 && hasMore && !loadingMore) loadOlder();
        }}>
        {/* Load older indicator */}
        {loadingMore && (
          <div className="flex justify-center py-3 animate-fade-in">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full glass border border-white/10 text-xs text-muted-foreground">
              <div className="w-3.5 h-3.5 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
              Загрузка истории...
            </div>
          </div>
        )}
        {hasMore && !loadingMore && (
          <div className="flex justify-center py-1">
            <button onClick={loadOlder}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full glass border border-white/10 text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all">
              <Icon name="ChevronsUp" size={13} />
              Загрузить ещё
            </button>
          </div>
        )}
        {loading && (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Icon name="MessageCircle" size={24} className="text-blue-400" />
            </div>
            <p className="text-muted-foreground text-sm">Начните переписку! 👋</p>
          </div>
        )}
        {messages.map((msg, i) => {
          const showDateSep = msg.date && (i === 0 || messages[i - 1].date !== msg.date);
          const isMatch = searchQuery.trim() && msg.text.toLowerCase().includes(searchQuery.toLowerCase());
          const isActive = isMatch && searchMatches[searchIdx]?.id === msg.id;
          const q = searchQuery.trim();

          function highlightText(text: string) {
            if (!q) return <>{text}</>;
            const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
            return (
              <>
                {parts.map((part, pi) =>
                  part.toLowerCase() === q.toLowerCase()
                    ? <mark key={pi} className={`rounded px-0.5 ${isActive ? "bg-yellow-300 text-black" : "bg-yellow-300/40 text-white"}`}>{part}</mark>
                    : part
                )}
              </>
            );
          }

          return (
            <div key={msg.id}>
            {showDateSep && (
              <div className="flex items-center gap-3 my-3">
                <div className="flex-1 h-px bg-white/8" />
                <span className="text-[11px] font-medium text-muted-foreground px-3 py-1 rounded-full glass border border-white/8 whitespace-nowrap">
                  {formatDateLabel(msg.date!)}
                </span>
                <div className="flex-1 h-px bg-white/8" />
              </div>
            )}
            <div
              ref={el => { msgRefs.current[msg.id] = el; }}
              data-msg-id={msg.id}
              className={`flex flex-col ${msg.out ? "items-end" : "items-start"} animate-fade-in`}
              style={{ animationDelay: `${i * 0.02}s` }}>
              <div className={`flex items-end gap-1 group ${msg.out ? "flex-row-reverse" : "flex-row"}`}>
              <div className={`max-w-[75%] px-4 py-2.5 transition-all ${msg.out ? "msg-bubble-out" : "msg-bubble-in"} ${isActive ? "ring-2 ring-yellow-400/60" : isMatch ? "ring-1 ring-yellow-400/25" : ""}`}>
                {!msg.out && chat.is_group && msg.sender_name && (
                  <div className="text-[10px] text-sky-400 font-semibold mb-1">{msg.sender_name}</div>
                )}
                {/* Reply quote */}
                {msg.reply_to_id && (
                  <button onClick={() => {
                    const el = msgRefs.current[msg.reply_to_id!];
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                    className={`w-full text-left mb-2 pl-2 border-l-2 border-sky-400/60 rounded-r-lg py-1 pr-2 transition-all hover:opacity-80
                      ${msg.out ? "bg-black/15" : "bg-black/10"}`}>
                    <p className="text-[10px] font-semibold text-sky-300 mb-0.5 truncate">{msg.reply_to_name}</p>
                    <p className="text-[11px] text-white/60 truncate">{msg.reply_to_text || "Сообщение"}</p>
                  </button>
                )}
                {/* File attachment */}
                {/* Изображения */}
                {msg.file_url && msg.file_type?.startsWith("image/") && (
                  <div className="mb-1.5 relative group/img max-w-[240px]">
                    <button onClick={() => setLightboxUrl(msg.file_url!)}
                      className="block rounded-xl overflow-hidden border border-white/10 w-full">
                      <img src={msg.file_url} alt={msg.file_name || "фото"}
                        className="w-full object-cover max-h-56 hover:opacity-90 transition-opacity"
                        loading="lazy" />
                    </button>
                    <a href={msg.file_url} download={msg.file_name || "photo"}
                      onClick={e => e.stopPropagation()}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-black/80">
                      <Icon name="Download" size={13} className="text-white" />
                    </a>
                  </div>
                )}
                {/* Видео */}
                {msg.file_url && msg.file_type?.startsWith("video/") && (
                  <div className="mb-1.5 relative group/vid max-w-[260px]">
                    <video src={msg.file_url} controls preload="metadata"
                      className="w-full rounded-xl border border-white/10 max-h-48 bg-black"
                      playsInline />
                    <a href={msg.file_url} download={msg.file_name || "video"}
                      onClick={e => e.stopPropagation()}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 opacity-0 group-hover/vid:opacity-100 transition-opacity hover:bg-black/80">
                      <Icon name="Download" size={13} className="text-white" />
                    </a>
                  </div>
                )}
                {/* Аудио / голосовые */}
                {msg.file_url && msg.file_type?.startsWith("audio/") && (
                  <div className="mb-1.5 px-3 py-2.5 rounded-xl bg-black/20 border border-white/10">
                    <VoicePlayer
                      src={msg.file_url}
                      isOut={msg.out}
                      isRead={msg.is_read}
                      msgId={msg.id}
                      token={token}
                      onRead={() => {
                        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, is_read: true } : m));
                        onMessageRead?.();
                      }}
                    />
                  </div>
                )}
                {/* Документы и прочие файлы */}
                {msg.file_url && !msg.file_type?.startsWith("image/") && !msg.file_type?.startsWith("audio/") && !msg.file_type?.startsWith("video/") && (
                  <a href={msg.file_url} download={msg.file_name || "file"}
                    className="flex items-center gap-2.5 mb-1.5 px-3 py-2.5 rounded-xl bg-black/20 hover:bg-black/30 transition-colors border border-white/10 max-w-[240px]">
                    <div className="w-8 h-8 rounded-lg bg-sky-500/20 flex items-center justify-center flex-shrink-0">
                      <Icon name={msg.file_type?.includes("pdf") ? "FileText" : msg.file_type?.includes("zip") ? "Archive" : "File"} size={15} className="text-sky-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white truncate">{msg.file_name || "Файл"}</p>
                      <p className="text-[10px] text-white/50">
                        {msg.file_size ? (msg.file_size > 1024 * 1024 ? `${(msg.file_size / 1024 / 1024).toFixed(1)} МБ` : `${(msg.file_size / 1024).toFixed(0)} КБ`) : ""}
                      </p>
                    </div>
                    <Icon name="Download" size={14} className="text-sky-400 flex-shrink-0" />
                  </a>
                )}
                {msg.is_deleted
                  ? <p className="text-sm text-white/40 italic">Сообщение удалено</p>
                  : msg.text && <p className="text-sm text-white leading-relaxed">{highlightText(msg.text)}</p>
                }
                <div className={`flex items-center gap-1.5 mt-1 ${msg.out ? "justify-end" : "justify-start"}`}>
                  {msg.is_edited && !msg.is_deleted && <span className="text-[10px] text-white/40 italic">изменено</span>}
                  <span className="text-[10px] text-white/50">{msg.time}</span>
                  {msg.out && !msg._failed && <Icon name={msg.is_read ? "CheckCheck" : "Check"} size={12} className={msg.is_read ? "text-cyan-400" : "text-white/50"} />}
                  {msg._failed && (
                    <button onClick={() => retrySend(msg)} className="flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors" title="Нажми чтобы повторить">
                      <Icon name="AlertCircle" size={12} />
                      <span className="text-[10px]">повторить</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className={`flex flex-col gap-1 self-end mb-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ${msg.out ? "order-first mr-1 items-end" : "ml-1 items-start"}`}>
                <button onClick={() => setPickerMsgId(pickerMsgId === msg.id ? null : msg.id)}
                  className="p-1 rounded-full hover:bg-white/10 transition-colors">
                  <span className="text-sm leading-none">😊</span>
                </button>
                {msg.out && !msg.is_deleted && (
                  <button onClick={() => setMenuMsgId(menuMsgId === msg.id ? null : msg.id)}
                    className="p-1 rounded-full hover:bg-white/10 transition-colors">
                    <Icon name="MoreVertical" size={14} className="text-white/50" />
                  </button>
                )}
              </div>
            </div>

            {/* Context menu */}
            {menuMsgId === msg.id && (
              <div className={`flex gap-1 mb-1 animate-fade-in flex-wrap ${msg.out ? "self-end justify-end" : "self-start justify-start"}`}>
                <button onClick={() => { setMenuMsgId(null); setReplyTo({ id: msg.id, text: msg.is_deleted ? "Сообщение удалено" : msg.text, name: msg.sender_name || "Вы" }); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass border border-white/10 text-xs text-foreground hover:bg-white/10 transition-all">
                  <Icon name="Reply" size={12} className="text-sky-400" />
                  Ответить
                </button>
                {!msg.is_deleted && (
                  <button onClick={() => { setMenuMsgId(null); setForwardMsg({ text: msg.text, file_url: msg.file_url, file_name: msg.file_name, file_type: msg.file_type }); setForwardSearch(""); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass border border-white/10 text-xs text-foreground hover:bg-white/10 transition-all">
                    <Icon name="Forward" size={12} className="text-sky-400" />
                    Переслать
                  </button>
                )}
                {!msg.is_deleted && (
                  <button onClick={() => pinMessage(msg.id, !msg.is_pinned)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass border text-xs transition-all
                      ${msg.is_pinned ? "border-amber-500/20 text-amber-400 hover:bg-amber-500/10" : "border-white/10 text-foreground hover:bg-white/10"}`}>
                    <Icon name="Pin" size={12} className={msg.is_pinned ? "text-amber-400" : "text-sky-400"} />
                    {msg.is_pinned ? "Открепить" : "Закрепить"}
                  </button>
                )}
                {msg.out && !msg.is_deleted && (
                  <button onClick={() => { setMenuMsgId(null); setEditingMsg({ id: msg.id, text: msg.text }); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass border border-white/10 text-xs text-foreground hover:bg-white/10 transition-all">
                    <Icon name="Pencil" size={12} className="text-sky-400" />
                    Изменить
                  </button>
                )}
                {msg.out && !msg.is_deleted && (
                  <button onClick={() => deleteMessage(msg.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass border border-red-500/20 text-xs text-red-400 hover:bg-red-500/10 transition-all">
                    <Icon name="Trash2" size={12} />
                    Удалить
                  </button>
                )}
                {!msg.out && !msg.is_deleted && (
                  <button onClick={() => {
                    setMenuMsgId(null);
                    setReportMsgId(typeof msg.id === "number" ? msg.id : null);
                    setReportReason("");
                    setReportComment("");
                    setReportDone(false);
                    setShowReportModal(true);
                  }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass border border-orange-500/20 text-xs text-orange-400 hover:bg-orange-500/10 transition-all">
                    <Icon name="Flag" size={12} />
                    Жалоба
                  </button>
                )}
              </div>
            )}

            {/* Reaction picker popup */}
            {pickerMsgId === msg.id && (
              <div className={`flex items-center gap-1 px-2 py-1.5 rounded-2xl glass border border-white/10 shadow-xl animate-fade-in mb-1 w-fit ${msg.out ? "self-end" : "self-start"}`}>
                {EMOJIS.map(e => {
                  const r = (msg.reactions || []).find(rx => rx.emoji === e);
                  return (
                    <button key={e} onClick={() => sendReaction(msg.id, e)}
                      className={`text-lg leading-none p-1 rounded-xl transition-all hover:scale-125 active:scale-95 ${r?.i_reacted ? "bg-blue-500/25" : "hover:bg-white/10"}`}>
                      {e}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Reactions display */}
            {(msg.reactions || []).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {(msg.reactions || []).map(r => (
                  <button key={r.emoji} onClick={() => sendReaction(msg.id, r.emoji)}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-all hover:scale-105 active:scale-95
                      ${r.i_reacted
                        ? "bg-blue-500/25 border-blue-500/40 text-white"
                        : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"}`}>
                    <span className="text-sm leading-none">{r.emoji}</span>
                    <span className="font-medium">{r.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          </div>
        );
        }
        )}
        <div ref={endRef} />
      </div>

      {isInContext && (
        <div className="flex-shrink-0 flex justify-center py-2 animate-fade-in">
          <button onClick={jumpToLatest}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-sky-500/20 border border-sky-500/40 text-sky-300 text-sm hover:bg-sky-500/30 transition-all shadow-lg">
            <Icon name="ChevronsDown" size={15} />
            К последним сообщениям
            {newMsgCount > 0 && (
              <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-sky-500 text-white text-[10px] font-bold flex items-center justify-center">
                {newMsgCount > 99 ? "99+" : newMsgCount}
              </span>
            )}
          </button>
        </div>
      )}

      {typists.length > 0 && (
        <div className="flex-shrink-0 px-5 py-1.5 flex items-center gap-2 animate-fade-in">
          <div className="flex gap-0.5 items-end">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-1.5 h-1.5 rounded-full bg-sky-400"
                style={{ animation: "typingBounce 1.2s ease-in-out infinite", animationDelay: `${i * 0.2}s` }} />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {typists.length === 1
              ? `${typists[0]} печатает...`
              : `${typists.join(", ")} печатают...`}
          </span>
        </div>
      )}

      <div className="flex-shrink-0 glass border-t border-white/5 px-4 pt-2 pb-3 space-y-2">
        {/* Reply banner */}
        {replyTo && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-sky-500/10 border border-sky-500/20 animate-fade-in">
            <Icon name="Reply" size={13} className="text-sky-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-sky-400 truncate">{replyTo.name}</p>
              <p className="text-xs text-muted-foreground truncate">{replyTo.text || "Сообщение"}</p>
            </div>
            <button onClick={() => setReplyTo(null)}
              className="p-0.5 rounded-full hover:bg-white/10 transition-colors flex-shrink-0">
              <Icon name="X" size={13} className="text-muted-foreground" />
            </button>
          </div>
        )}
        {/* Edit mode banner */}
        {editingMsg && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-sky-500/10 border border-sky-500/20 animate-fade-in">
            <Icon name="Pencil" size={13} className="text-sky-400 flex-shrink-0" />
            <span className="text-xs text-sky-400 font-medium flex-1 truncate">Редактирование сообщения</span>
            <button onClick={() => { setEditingMsg(null); setText(""); }}
              className="p-0.5 rounded-full hover:bg-white/10 transition-colors">
              <Icon name="X" size={13} className="text-muted-foreground" />
            </button>
          </div>
        )}
        {/* Ошибка загрузки */}
        {uploadError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 animate-fade-in">
            <Icon name="AlertCircle" size={14} className="text-red-400 flex-shrink-0" />
            <p className="text-xs text-red-300 flex-1">{uploadError}</p>
            <button onClick={() => setUploadError(null)} className="p-0.5 hover:bg-white/10 rounded-full transition-colors">
              <Icon name="X" size={12} className="text-red-400" />
            </button>
          </div>
        )}
        {/* Pending file preview */}
        {pendingFile && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20 animate-fade-in">
            {pendingFile.type.startsWith("image/") ? (
              <img src={pendingFile.url} alt={pendingFile.name}
                className="w-12 h-12 rounded-lg object-cover flex-shrink-0 border border-white/10" />
            ) : pendingFile.type.startsWith("video/") ? (
              <div className="w-12 h-12 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                <Icon name="Video" size={20} className="text-purple-400" />
              </div>
            ) : pendingFile.type.startsWith("audio/") ? (
              <div className="w-12 h-12 rounded-lg bg-sky-500/20 flex items-center justify-center flex-shrink-0">
                <Icon name="Music" size={20} className="text-sky-400" />
              </div>
            ) : (
              <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                <Icon name="FileText" size={20} className="text-blue-400" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{pendingFile.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {pendingFile.size > 1024 * 1024 ? `${(pendingFile.size / 1024 / 1024).toFixed(1)} МБ` : `${(pendingFile.size / 1024).toFixed(0)} КБ`}
              </p>
            </div>
            <button onClick={() => setPendingFile(null)}
              className="p-1 rounded-full hover:bg-white/10 transition-colors flex-shrink-0">
              <Icon name="X" size={14} className="text-muted-foreground" />
            </button>
          </div>
        )}

        {/* Предпросмотр голосового перед отправкой */}
        {voicePreview && (
          <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-2xl bg-secondary/80 border border-white/10 animate-fade-in">
            <button onClick={() => { URL.revokeObjectURL(voicePreview.url); setVoicePreview(null); }}
              className="p-1.5 rounded-full hover:bg-red-500/20 transition-colors flex-shrink-0">
              <Icon name="Trash2" size={14} className="text-red-400" />
            </button>
            <audio src={voicePreview.url} controls preload="auto"
              className="flex-1 h-8"
              style={{ filter: "invert(0.8) sepia(1) saturate(2) hue-rotate(185deg)" }} />
            <span className="text-[11px] text-muted-foreground flex-shrink-0">
              {Math.floor(voicePreview.duration / 60)}:{String(voicePreview.duration % 60).padStart(2, "0")}
            </span>
            <button onClick={() => sendVoiceBlob(voicePreview.blob, voicePreview.duration)}
              disabled={uploading}
              className="p-2.5 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 hover:scale-105 shadow-[0_0_16px_rgba(0,180,230,0.4)] transition-all flex-shrink-0 disabled:opacity-50">
              {uploading
                ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Icon name="Send" size={14} className="text-white" />}
            </button>
          </div>
        )}

        {chat.is_channel && !myCanPost
          ? <div className="flex items-center justify-center gap-2 py-3 text-muted-foreground">
              <Icon name="Radio" size={14} className="text-purple-400" />
              <span className="text-sm">Только администраторы могут писать в канале</span>
            </div>
          : isRecording
            ? /* ── Панель записи ── */
              <div className="flex items-center gap-3 px-3 py-2 animate-fade-in">
                {/* Отмена */}
                <button onClick={cancelRecording}
                  className="p-2 rounded-full hover:bg-red-500/20 transition-colors flex-shrink-0">
                  <Icon name="X" size={18} className="text-red-400" />
                </button>

                {/* Волна + таймер */}
                <div className="flex-1 flex items-center gap-2 bg-red-500/8 border border-red-500/20 rounded-2xl px-3 py-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                  <div className="flex items-end gap-[2px] flex-1 h-6 overflow-hidden">
                    {waveformBars.map((h, i) => (
                      <div key={i}
                        className="flex-1 rounded-full bg-red-400/70 transition-all duration-100"
                        style={{ height: `${h}px`, minHeight: "3px" }} />
                    ))}
                  </div>
                  <span className="text-xs text-red-400 font-mono flex-shrink-0 tabular-nums">
                    {String(Math.floor(recordingTime / 60)).padStart(2, "0")}:{String(recordingTime % 60).padStart(2, "0")}
                  </span>
                </div>

                {/* Остановить и перейти к предпросмотру */}
                <button onClick={stopRecording}
                  className="p-3 rounded-full bg-gradient-to-br from-red-500 to-red-600 hover:scale-105 shadow-[0_0_20px_rgba(239,68,68,0.5)] transition-all flex-shrink-0">
                  <Icon name="Square" size={16} className="text-white" />
                </button>
              </div>

            : /* ── Обычная панель ввода ── */
              <div className="flex items-end gap-2">
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect}
                  accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.zip,.txt,.mp4,.mp3,.mov,.webm" />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className={`p-2 rounded-full transition-all flex-shrink-0 ${uploading ? "opacity-50" : "hover:bg-white/10"}`}>
                  {uploading
                    ? <div className="w-5 h-5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                    : <Icon name="Paperclip" size={20} className="text-muted-foreground" />}
                </button>
                <textarea value={text} onChange={e => { setText(e.target.value); sendTyping(); }}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Сообщение..." rows={1}
                  className="flex-1 bg-secondary/60 border border-white/10 rounded-2xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-sky-500/50 transition-all"
                  style={{ maxHeight: "100px" }} />
                {(text.trim() || pendingFile)
                  ? <button onClick={send}
                      className="p-3 rounded-full transition-all flex-shrink-0 bg-gradient-to-br from-blue-600 to-blue-700 hover:scale-105 shadow-[0_0_20px_rgba(0,180,230,0.5)]">
                      <Icon name="Send" size={16} className="text-white" />
                    </button>
                  : <button onClick={startRecording}
                      className="p-3 rounded-full transition-all flex-shrink-0 bg-secondary hover:bg-white/10 active:scale-95">
                      <Icon name="Mic" size={16} className="text-muted-foreground" />
                    </button>
                }
              </div>
        }
      </div>

      {/* Forward modal */}
      {forwardMsg && (
        <div className="absolute inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm animate-fade-in">
          <div className="flex items-center gap-3 px-4 py-4 glass border-b border-white/5">
            <button onClick={() => { setForwardMsg(null); setForwardSearch(""); }}
              className="p-2 -ml-2 hover:bg-white/10 rounded-full transition-colors">
              <Icon name="ArrowLeft" size={20} />
            </button>
            <div>
              <h2 className="font-golos font-bold text-foreground text-sm">Переслать сообщение</h2>
              <p className="text-xs text-muted-foreground truncate max-w-[220px]">
                {forwardMsg.file_type?.startsWith("image/") ? "📷 Фото" : forwardMsg.file_type ? "📎 Файл" : forwardMsg.text || "Сообщение"}
              </p>
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="relative">
              <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={forwardSearch} onChange={e => setForwardSearch(e.target.value)}
                placeholder="Поиск чата..."
                className="w-full bg-secondary/60 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-sky-500/50 transition-all" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scroll-container px-4 space-y-1 pb-4">
            {allChats
              .filter(c => c.id !== chat.id && c.name.toLowerCase().includes(forwardSearch.toLowerCase()))
              .map(c => {
                const done = forwardDone === c.id;
                const loading = forwarding === c.id;
                return (
                  <button key={c.id} onClick={() => !loading && !done && forwardTo(c.id)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-all
                      ${done ? "bg-green-500/10 border border-green-500/20" : "hover:bg-white/5 glass"}`}>
                    <AvatarEl name={c.name} size="sm" />
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                      {c.is_group && <p className="text-xs text-muted-foreground">{c.member_count} участников</p>}
                    </div>
                    <div className="flex-shrink-0">
                      {done
                        ? <Icon name="CheckCheck" size={16} className="text-green-400" />
                        : loading
                          ? <div className="w-4 h-4 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
                          : <Icon name="Forward" size={16} className="text-muted-foreground" />
                      }
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Лайтбокс для просмотра фото */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col animate-fade-in"
          onClick={() => setLightboxUrl(null)}>
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
            <button onClick={() => setLightboxUrl(null)} className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors">
              <Icon name="X" size={20} className="text-white" />
            </button>
            <a href={lightboxUrl} download
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white text-sm font-medium">
              <Icon name="Download" size={16} />
              Сохранить
            </a>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
            <img src={lightboxUrl} alt="фото"
              className="max-w-full max-h-full object-contain rounded-lg select-none"
              onClick={e => e.stopPropagation()} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Chats Tab ────────────────────────────────────────────────────────────────

function ChatsTab({ token, currentUserId, onMessageRead, onCall, openChatId, onChatOpened }: { token: string; currentUserId: number; onMessageRead: (chatId: number) => void; onCall?: (userId: number, userName: string, isVideo?: boolean) => void; openChatId?: number | null; onChatOpened?: () => void }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createMode, setCreateMode] = useState<"direct" | "group" | "channel">("direct");
  const [newChatSearch, setNewChatSearch] = useState("");
  const [foundUsers, setFoundUsers] = useState<{ id: number; name: string; phone: string; status: string }[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<{ id: number; name: string }[]>([]);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [channelPublic, setChannelPublic] = useState(false);
  const [groupCreating, setGroupCreating] = useState(false);
  const [contextChat, setContextChat] = useState<Chat | null>(null);
  const [muteChat, setMuteChat] = useState<Chat | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ chat: Chat; action: "leave" | "delete" | "hide" } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [globalResults, setGlobalResults] = useState<{ msg_id: number; text: string; time: string | null; chat_id: number; chat_name: string; is_group: boolean; sender_name: string; is_out: boolean }[]>([]);
  const [globalSearching, setGlobalSearching] = useState(false);
  const globalSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [initialMsgId, setInitialMsgId] = useState<number | undefined>(undefined);

  const loadChats = useCallback(async () => {
    try {
      const res = await fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "chats" }) });
      const data = await res.json();
      if (data.chats) setChats(data.chats);
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { loadChats(); }, [loadChats]);

  // Открыть конкретный чат по id (из Контактов)
  useEffect(() => {
    if (!openChatId) return;
    const found = chats.find(c => c.id === openChatId);
    if (found) {
      setActiveChat(found);
      onChatOpened?.();
    } else if (chats.length > 0) {
      // Чат не найден локально — перезагружаем
      loadChats().then(() => {
        setChats(prev => {
          const f = prev.find(c => c.id === openChatId);
          if (f) { setActiveChat(f); onChatOpened?.(); }
          return prev;
        });
      });
    }
  }, [openChatId, chats, onChatOpened, loadChats]);

  // Poll chats every 5s when not in a conversation
  useEffect(() => {
    if (activeChat) return;
    const id = setInterval(() => loadChats(), 5000);
    return () => clearInterval(id);
  }, [loadChats, activeChat]);

  async function searchUsers(q: string) {
    if (!q.trim()) { setFoundUsers([]); return; }
    const res = await fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "users", q }) });
    const data = await res.json();
    if (data.users) setFoundUsers(data.users);
  }

  function resetCreate() {
    setCreating(false); setNewChatSearch(""); setFoundUsers([]);
    setSelectedUsers([]); setGroupName(""); setGroupDescription(""); setChannelPublic(false); setCreateMode("direct");
  }

  async function startChat(userId: number) {
    const res = await fetch(CHATS_URL, {
      method: "POST", headers: apiHeaders(token),
      body: JSON.stringify({ action: "create", is_group: false, members: [userId] }),
    });
    const data = await res.json();
    if (data.chat_id) {
      const chatRes = await fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "chats" }) });
      const chatData = await chatRes.json();
      if (chatData.chats) {
        setChats(chatData.chats);
        const found = chatData.chats.find((c: Chat) => c.id === data.chat_id);
        if (found) setActiveChat(found);
      }
      resetCreate();
    }
  }

  async function createGroup() {
    if (!groupName.trim()) return;
    setGroupCreating(true);
    try {
      const isChannel = createMode === "channel";
      const res = await fetch(CHATS_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({
          action: "create",
          is_group: !isChannel,
          is_channel: isChannel,
          name: groupName.trim(),
          description: groupDescription.trim() || null,
          is_public: isChannel ? channelPublic : false,
          members: selectedUsers.map(u => u.id),
        }),
      });
      const data = await res.json();
      if (data.chat_id) { await loadChats(); resetCreate(); }
    } finally { setGroupCreating(false); }
  }

  function toggleUser(u: { id: number; name: string; phone: string; status: string }) {
    setSelectedUsers(prev =>
      prev.find(s => s.id === u.id)
        ? prev.filter(s => s.id !== u.id)
        : [...prev, { id: u.id, name: u.name }]
    );
  }

  async function togglePin(chat: Chat) {
    const pin = !chat.pinned;
    setChats(prev => prev.map(c => c.id === chat.id ? { ...c, pinned: pin } : c));
    await fetch(CHATS_URL, {
      method: "POST", headers: apiHeaders(token),
      body: JSON.stringify({ action: "pin-chat", chat_id: chat.id, pin }),
    });
    setContextChat(null);
  }

  async function applyMute(chat: Chat, minutes: number | null) {
    const muted = true;
    const muted_until = minutes ? new Date(Date.now() + minutes * 60000).toISOString() : null;
    setChats(prev => prev.map(c => c.id === chat.id ? { ...c, muted, muted_until } : c));
    await fetch(CHATS_URL, {
      method: "POST", headers: apiHeaders(token),
      body: JSON.stringify({ action: "mute-chat", chat_id: chat.id, mute: true, minutes }),
    });
    setMuteChat(null);
    setContextChat(null);
  }

  async function unmute(chat: Chat) {
    setChats(prev => prev.map(c => c.id === chat.id ? { ...c, muted: false, muted_until: null } : c));
    setContextChat(null);
    setMuteChat(null);
    await fetch(CHATS_URL, {
      method: "POST", headers: apiHeaders(token),
      body: JSON.stringify({ action: "mute-chat", chat_id: chat.id, mute: false }),
    });
  }

  async function execChatAction(chat: Chat, action: "leave" | "delete" | "hide") {
    setConfirmAction(null);
    setContextChat(null);
    if (activeChat?.id === chat.id) setActiveChat(null);
    setChats(prev => prev.filter(c => c.id !== chat.id));
    if (action === "leave") {
      await fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "leave", chat_id: chat.id }) });
    } else if (action === "delete") {
      await fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "delete-chat", chat_id: chat.id }) });
    } else {
      await fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "hide-chat", chat_id: chat.id }) });
    }
  }

  const filtered = chats
    .filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      const ta = a.last_time ? new Date(a.last_time).getTime() : 0;
      const tb = b.last_time ? new Date(b.last_time).getTime() : 0;
      return tb - ta;
    });

  function handleSearchChange(val: string) {
    setSearch(val);
    setGlobalResults([]);
    if (globalSearchTimer.current) clearTimeout(globalSearchTimer.current);
    if (val.trim().length < 2) { setGlobalSearching(false); return; }
    setGlobalSearching(true);
    globalSearchTimer.current = setTimeout(async () => {
      const res = await fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "global-search", q: val.trim() }) });
      const data = await res.json();
      setGlobalResults(data.results || []);
      setGlobalSearching(false);
    }, 400);
  }

  function openChatFromSearch(chatId: number, msgId?: number) {
    const chat = chats.find(c => c.id === chatId);
    if (chat) {
      setInitialMsgId(msgId);
      setActiveChat(chat);
      setSearch("");
      setGlobalResults([]);
    }
  }

  if (activeChat) {
    return <ChatScreen chat={activeChat} token={token} currentUserId={currentUserId}
      onBack={() => { setActiveChat(null); loadChats(); setInitialMsgId(undefined); }} allChats={chats}
      onMessageRead={() => onMessageRead(activeChat.id)} initialMsgId={initialMsgId} onCall={onCall}
      onChatUpdate={(updated) => {
        setActiveChat(prev => prev ? { ...prev, ...updated } : prev);
        setChats(prev => prev.map(c => c.id === activeChat.id ? { ...c, ...updated } : c));
      }} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-golos font-black text-gradient">Чаты</h1>
          <button onClick={() => creating ? resetCreate() : setCreating(true)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <Icon name={creating ? "X" : "PenSquare"} size={20} className="text-sky-400" />
          </button>
        </div>

        {creating && (
          <div className="glass rounded-2xl p-3 mb-3 animate-fade-in space-y-3">
            {/* Mode switcher: Личный / Группа / Канал */}
            <div className="flex gap-1 p-1 glass rounded-xl">
              {([
                { id: "direct", label: "Личный", icon: "MessageCircle" },
                { id: "group", label: "Группа", icon: "Users" },
                { id: "channel", label: "Канал", icon: "Radio" },
              ] as const).map(m => (
                <button key={m.id}
                  onClick={() => { setCreateMode(m.id); setSelectedUsers([]); setNewChatSearch(""); setFoundUsers([]); setGroupName(""); setGroupDescription(""); }}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                    ${createMode === m.id
                      ? m.id === "channel" ? "bg-gradient-to-r from-purple-600 to-violet-700 text-white" : "bg-gradient-to-r from-blue-600 to-blue-700 text-white"
                      : "text-muted-foreground hover:text-foreground"}`}>
                  <Icon name={m.icon} size={11} />
                  {m.label}
                </button>
              ))}
            </div>

            {/* Название группы / канала */}
            {(createMode === "group" || createMode === "channel") && (
              <div className="space-y-2 animate-fade-in">
                <input value={groupName} onChange={e => setGroupName(e.target.value)}
                  placeholder={createMode === "channel" ? "Название канала..." : "Название группы..."}
                  className="w-full bg-secondary/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-sky-500/50 transition-all" />
                <textarea value={groupDescription} onChange={e => setGroupDescription(e.target.value)}
                  placeholder="Описание (необязательно)..."
                  rows={2}
                  className="w-full bg-secondary/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-sky-500/50 transition-all resize-none" />
                {createMode === "channel" && (
                  <button onClick={() => setChannelPublic(p => !p)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${channelPublic ? "bg-purple-500/15 border-purple-500/30" : "bg-secondary/40 border-white/10"}`}>
                    <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-all ${channelPublic ? "bg-purple-500 border-purple-500" : "border-white/30"}`}>
                      {channelPublic && <Icon name="Check" size={10} className="text-white" />}
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-xs font-medium text-foreground">Публичный канал</p>
                      <p className="text-[10px] text-muted-foreground">Любой может найти и подписаться</p>
                    </div>
                    <Icon name={channelPublic ? "Globe" : "Lock"} size={14} className={channelPublic ? "text-purple-400" : "text-muted-foreground"} />
                  </button>
                )}
              </div>
            )}

            {/* Выбранные участники */}
            {(createMode === "group" || createMode === "channel") && selectedUsers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 animate-fade-in">
                {selectedUsers.map(u => (
                  <div key={u.id} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/30">
                    <span className="text-xs text-sky-300">{u.name.split(" ")[0]}</span>
                    <button onClick={() => setSelectedUsers(prev => prev.filter(s => s.id !== u.id))}
                      className="w-4 h-4 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors">
                      <Icon name="X" size={10} className="text-sky-300" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Поиск пользователей */}
            <div className="relative">
              <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={newChatSearch}
                onChange={e => { setNewChatSearch(e.target.value); searchUsers(e.target.value); }}
                placeholder={createMode === "direct" ? "Имя или номер..." : createMode === "channel" ? "Добавить администраторов..." : "Добавить участников..."}
                className="w-full bg-secondary/60 border border-white/10 rounded-xl pl-8 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-sky-500/50 transition-all" />
            </div>

            {/* Результаты поиска */}
            {foundUsers.length > 0 && (
              <div className="space-y-0.5 max-h-40 overflow-y-auto scroll-container">
                {foundUsers.map(u => {
                  const selected = createMode !== "direct" && selectedUsers.some(s => s.id === u.id);
                  return (
                    <button key={u.id}
                      onClick={() => createMode === "direct" ? startChat(u.id) : toggleUser(u)}
                      className={`w-full flex items-center gap-2 p-2 rounded-xl transition-all ${selected ? "bg-blue-500/15 border border-blue-500/20" : "hover:bg-white/5"}`}>
                      <AvatarEl name={u.name} size="xs" status={u.status} />
                      <div className="flex-1 min-w-0 text-left">
                        <div className="text-sm font-medium text-foreground truncate">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.phone}</div>
                      </div>
                      {createMode === "direct"
                        ? <Icon name="MessageCircle" size={14} className="text-sky-400" />
                        : <div className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 transition-all ${selected ? "bg-blue-500 border-blue-500" : "border-white/20"}`}>
                            {selected && <Icon name="Check" size={10} className="text-white" />}
                          </div>}
                    </button>
                  );
                })}
              </div>
            )}
            {newChatSearch && foundUsers.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-1">Пользователи не найдены</p>
            )}

            {/* Кнопка создания группы/канала */}
            {(createMode === "group" || createMode === "channel") && groupName.trim() && (
              <button onClick={createGroup} disabled={groupCreating}
                className={`w-full py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-60 flex items-center justify-center gap-2 animate-fade-in
                  ${createMode === "channel" ? "bg-gradient-to-r from-purple-600 to-violet-700" : "bg-gradient-to-r from-blue-600 to-blue-700"}`}>
                {groupCreating
                  ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Создаём...</>
                  : createMode === "channel"
                    ? <><Icon name="Radio" size={14} />Создать канал «{groupName}»{selectedUsers.length > 0 ? ` · ${selectedUsers.length + 1} чел.` : ""}</>
                    : <><Icon name="Users" size={14} />Создать группу «{groupName}» · {selectedUsers.length + 1} чел.</>}
              </button>
            )}
          </div>
        )}

        <div className="relative">
          <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => handleSearchChange(e.target.value)} placeholder="Поиск чатов и сообщений..."
            className="w-full bg-secondary/60 border border-white/10 rounded-2xl pl-9 pr-9 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-sky-500/50 transition-all" />
          {search && (
            <button onClick={() => { setSearch(""); setGlobalResults([]); setGlobalSearching(false); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              <Icon name="X" size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-container">
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-8 h-8 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">Загружаем чаты...</p>
          </div>
        )}
        {/* Глобальный поиск по сообщениям */}
        {search.trim().length >= 2 && (
          <div className="pb-2">
            <p className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Сообщения</p>
            {globalSearching && (
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-4 h-4 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
                <span className="text-sm text-muted-foreground">Ищем...</span>
              </div>
            )}
            {!globalSearching && globalResults.length === 0 && (
              <p className="px-4 py-3 text-sm text-muted-foreground">Сообщений не найдено</p>
            )}
            {!globalSearching && globalResults.map(r => {
              const hi = r.text;
              const idx = hi.toLowerCase().indexOf(search.trim().toLowerCase());
              const before = idx >= 0 ? hi.slice(0, idx) : hi;
              const match = idx >= 0 ? hi.slice(idx, idx + search.trim().length) : "";
              const after = idx >= 0 ? hi.slice(idx + search.trim().length) : "";
              const t = r.time ? new Date(r.time).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }) : "";
              return (
                <button key={r.msg_id} onClick={() => openChatFromSearch(r.chat_id, r.msg_id)}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left border-b border-white/5">
                  <div className="w-9 h-9 rounded-2xl bg-sky-500/15 border border-sky-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon name={r.is_group ? "Users" : "MessageCircle"} size={15} className="text-sky-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-sky-400 truncate">{r.chat_name}</span>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{t}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-0.5">{r.is_out ? "Вы" : r.sender_name}</p>
                    <p className="text-sm text-foreground/80 line-clamp-2 break-words">
                      {before}<span className="text-sky-300 font-semibold">{match}</span>{after}
                    </p>
                  </div>
                </button>
              );
            })}
            {filtered.length > 0 && <p className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-t border-white/5 mt-1">Чаты</p>}
          </div>
        )}

        {!loading && filtered.length === 0 && search.trim().length < 2 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
            <div className="w-16 h-16 rounded-3xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Icon name="MessageCircle" size={28} className="text-blue-400" />
            </div>
            <div>
              <p className="font-golos font-semibold text-foreground mb-1">Нет чатов</p>
              <p className="text-sm text-muted-foreground">Нажмите ✏️ чтобы начать разговор</p>
            </div>
          </div>
        )}
        {!loading && filtered.map((chat, i) => {
          const relTime = chat.last_time
            ? new Date(chat.last_time).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })
            : "";
          return (
            <button key={chat.id}
              onClick={() => setActiveChat(chat)}
              onMouseDown={() => { longPressTimer.current = setTimeout(() => setContextChat(chat), 500); }}
              onMouseUp={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
              onMouseLeave={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
              onTouchStart={() => { longPressTimer.current = setTimeout(() => setContextChat(chat), 500); }}
              onTouchEnd={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-all active:scale-[0.98] animate-fade-in"
              style={{ animationDelay: `${i * 0.04}s` }}>
              <div className="relative flex-shrink-0">
                <AvatarEl name={chat.name} size="md" status={!chat.is_group ? (chat.peer_online ? "online" : "offline") : undefined} avatarUrl={chat.avatar_url} />
                {chat.is_channel && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
                    <Icon name="Radio" size={10} className="text-white" />
                  </div>
                )}
                {chat.is_group && !chat.is_channel && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
                    <Icon name="Users" size={10} className="text-white" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-golos font-semibold text-foreground text-sm truncate">{chat.name}</span>
                    {chat.is_channel && chat.is_public && <Icon name="Globe" size={10} className="text-purple-400 flex-shrink-0" />}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                    {chat.muted && <Icon name="BellOff" size={11} className="text-muted-foreground" />}
                    {chat.pinned && <Icon name="Pin" size={11} className="text-sky-400" />}
                    <span className={`text-[11px] ${chat.unread > 0 && !chat.muted ? "text-sky-400" : "text-muted-foreground"}`}>{relTime}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs text-muted-foreground truncate">
                    {chat.last_msg || (chat.is_channel && chat.description ? chat.description : "Нет сообщений")}
                  </span>
                  {chat.unread > 0 && (
                    <span className={`flex-shrink-0 ml-2 min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center ${chat.muted ? "bg-white/10 text-muted-foreground" : "bg-gradient-to-r from-blue-600 to-blue-700 text-white"}`}>
                      {chat.unread}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Context menu for long press */}
      {contextChat && (
        <div className="absolute inset-0 z-50 flex items-end justify-center pb-8 bg-black/40 backdrop-blur-sm animate-fade-in"
          onClick={() => setContextChat(null)}>
          <div className="w-full max-w-sm mx-4 glass rounded-3xl border border-white/10 overflow-hidden animate-slide-up"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
              <AvatarEl name={contextChat.name} size="sm" />
              <span className="font-golos font-semibold text-foreground text-sm truncate">{contextChat.name}</span>
            </div>
            <button onClick={() => togglePin(contextChat)}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-colors">
              <Icon name={contextChat.pinned ? "PinOff" : "Pin"} size={18} className="text-sky-400" />
              <span className="text-sm text-foreground">{contextChat.pinned ? "Открепить" : "Закрепить"}</span>
            </button>
            {contextChat.muted ? (
              <button onClick={() => unmute(contextChat)}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-colors border-t border-white/5">
                <Icon name="Bell" size={18} className="text-amber-400" />
                <div className="text-left">
                  <div className="text-sm text-foreground">Включить уведомления</div>
                  {contextChat.muted_until && <div className="text-[11px] text-muted-foreground">до {new Date(contextChat.muted_until).toLocaleString("ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>}
                </div>
              </button>
            ) : (
              <button onClick={() => { setMuteChat(contextChat); setContextChat(null); }}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-colors border-t border-white/5">
                <Icon name="BellOff" size={18} className="text-amber-400" />
                <span className="text-sm text-foreground">Отключить уведомления</span>
              </button>
            )}
            {contextChat.is_group ? (
              <>
                <button onClick={() => { setConfirmAction({ chat: contextChat, action: "leave" }); setContextChat(null); }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-500/10 transition-colors border-t border-white/5">
                  <Icon name="LogOut" size={18} className="text-red-400" />
                  <span className="text-sm text-red-400">{contextChat.is_channel ? "Покинуть канал" : "Покинуть группу"}</span>
                </button>
                {(contextChat.my_role === "owner" || contextChat.my_role === "admin") && (
                  <button onClick={() => { setConfirmAction({ chat: contextChat, action: "delete" }); setContextChat(null); }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-500/10 transition-colors border-t border-white/5">
                    <Icon name="Trash2" size={18} className="text-red-400" />
                    <span className="text-sm text-red-400">{contextChat.is_channel ? "Удалить канал" : "Удалить группу"}</span>
                  </button>
                )}
              </>
            ) : (
              <button onClick={() => { setConfirmAction({ chat: contextChat, action: "hide" }); setContextChat(null); }}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-500/10 transition-colors border-t border-white/5">
                <Icon name="Trash2" size={18} className="text-red-400" />
                <span className="text-sm text-red-400">Удалить переписку</span>
              </button>
            )}
            <button onClick={() => setContextChat(null)}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-colors border-t border-white/5">
              <Icon name="X" size={18} className="text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Отмена</span>
            </button>
          </div>
        </div>
      )}

      {/* Диалог выбора времени заглушки */}
      {muteChat && (
        <div className="absolute inset-0 z-50 flex items-end justify-center pb-8 bg-black/50 backdrop-blur-sm animate-fade-in"
          onClick={() => setMuteChat(null)}>
          <div className="w-full max-w-sm mx-4 glass rounded-3xl border border-white/10 overflow-hidden animate-slide-up"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
              <Icon name="BellOff" size={18} className="text-amber-400" />
              <span className="font-golos font-semibold text-foreground text-sm">Отключить уведомления</span>
            </div>
            {([
              { label: "На 1 час", minutes: 60 },
              { label: "На 8 часов", minutes: 480 },
              { label: "На 24 часа", minutes: 1440 },
              { label: "На неделю", minutes: 10080 },
              { label: "Навсегда", minutes: null },
            ] as { label: string; minutes: number | null }[]).map(({ label, minutes }) => (
              <button key={label} onClick={() => applyMute(muteChat, minutes)}
                className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-white/5 transition-colors border-t border-white/5">
                <span className="text-sm text-foreground">{label}</span>
                {minutes === null && <Icon name="Infinity" size={14} className="text-muted-foreground" />}
              </button>
            ))}
            <button onClick={() => setMuteChat(null)}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-colors border-t border-white/5">
              <Icon name="X" size={18} className="text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Отмена</span>
            </button>
          </div>
        </div>
      )}

      {/* Диалог подтверждения действия с чатом */}
      {confirmAction && (() => {
        const { chat, action } = confirmAction;
        const isDelete = action === "delete";
        const isLeave = action === "leave";
        const title = isDelete
          ? `Удалить ${chat.is_channel ? "канал" : "группу"}?`
          : isLeave
          ? `Покинуть ${chat.is_channel ? "канал" : "группу"}?`
          : "Удалить переписку?";
        const desc = isDelete
          ? `«${chat.name}» будет удалён${chat.is_channel ? "" : "а"} для всех участников без возможности восстановления.`
          : isLeave
          ? `Вы покинете «${chat.name}» и больше не будете получать сообщения.`
          : `История переписки с «${chat.name}» будет удалена только у вас.`;
        const btnLabel = isDelete ? "Удалить" : isLeave ? "Покинуть" : "Удалить";
        return (
          <div className="absolute inset-0 z-50 flex items-end justify-center pb-8 bg-black/50 backdrop-blur-sm animate-fade-in"
            onClick={() => setConfirmAction(null)}>
            <div className="w-full max-w-sm mx-4 glass rounded-3xl border border-white/10 overflow-hidden animate-slide-up"
              onClick={e => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-white/5">
                <p className="font-golos font-semibold text-foreground text-sm">{title}</p>
                <p className="text-xs text-muted-foreground mt-1">{desc}</p>
              </div>
              <button onClick={() => execChatAction(chat, action)}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-500/10 transition-colors">
                <Icon name={isLeave ? "LogOut" : "Trash2"} size={18} className="text-red-400" />
                <span className="text-sm text-red-400 font-medium">{btnLabel}</span>
              </button>
              <button onClick={() => setConfirmAction(null)}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-colors border-t border-white/5">
                <Icon name="X" size={18} className="text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Отмена</span>
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────

function ProfileTab({ user, token, onLogout, onUserUpdate, onDeleteAccount }: {
  user: User; token: string; onLogout: () => void; onUserUpdate: (u: User) => void; onDeleteAccount: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [showBlacklist, setShowBlacklist] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<{ id: number; name: string; phone?: string | null; avatar_url?: string | null; blocked_at: string | null }[]>([]);
  const [blacklistLoading, setBlacklistLoading] = useState(false);
  const [unblockingId, setUnblockingId] = useState<number | null>(null);

  const [changingPw, setChangingPw] = useState(false);
  const [pinMode, setPinMode] = useState<"setup" | "change" | null>(null);
  const [hasPin, setHasPin] = useState(!!localStorage.getItem(PIN_KEY));
  const [pinSaved, setPinSaved] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSaved, setPwSaved] = useState(false);
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  async function uploadAvatar(file: File) {
    setUploadingAvatar(true);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        const res = await fetch(AUTH_URL, {
          method: "POST", headers: apiHeaders(token),
          body: JSON.stringify({ action: "upload-avatar", image: dataUrl }),
        });
        const data = await res.json();
        if (data.user) { onUserUpdate(data.user); setSaved(true); setTimeout(() => setSaved(false), 2000); }
        setUploadingAvatar(false);
      };
      reader.readAsDataURL(file);
    } catch { setUploadingAvatar(false); }
  }

  function startEdit() { setName(user.name); setBio(user.bio ?? ""); setError(""); setEditing(true); }
  function cancelEdit() { setEditing(false); setError(""); }

  function cancelPw() {
    setChangingPw(false); setCurPw(""); setNewPw(""); setConfirmPw("");
    setPwError(""); setShowCur(false); setShowNew(false);
  }

  async function changePassword() {
    setPwError("");
    if (!curPw || !newPw || !confirmPw) { setPwError("Заполните все поля"); return; }
    if (newPw.length < 6) { setPwError("Новый пароль минимум 6 символов"); return; }
    if (newPw !== confirmPw) { setPwError("Пароли не совпадают"); return; }
    setPwSaving(true);
    try {
      const res = await fetch(AUTH_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: "change-password", current_password: curPw, new_password: newPw }),
      });
      const data = await res.json();
      if (!res.ok) { setPwError(data.error || "Ошибка"); return; }
      cancelPw();
      setPwSaved(true);
      setTimeout(() => setPwSaved(false), 2500);
    } finally { setPwSaving(false); }
  }

  async function saveProfile() {
    if (!name.trim()) { setError("Имя не может быть пустым"); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch(AUTH_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: "update-profile", name: name.trim(), bio: bio.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Ошибка сохранения"); return; }
      onUserUpdate(data.user);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally { setSaving(false); }
  }

  if (pinMode) {
    return (
      <PinScreen mode={pinMode} onSuccess={pin => {
        if (pin) { localStorage.setItem(PIN_KEY, pin); setHasPin(true); setPinSaved(true); setTimeout(() => setPinSaved(false), 2500); }
        setPinMode(null);
      }} onCancel={() => setPinMode(null)} />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto scroll-container">
      {/* Hero */}
      <div className="relative px-4 pt-8 pb-6 text-center overflow-hidden"
        style={{ background: "radial-gradient(ellipse at top, rgba(0,119,182,0.15) 0%, transparent 70%)" }}>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="absolute rounded-full opacity-10"
              style={{ width: 30 + i * 20, height: 30 + i * 20, background: "linear-gradient(135deg, #0077b6, #22d3ee)",
                top: `${10 + i * 15}%`, left: `${5 + i * 20}%`,
                animation: `float ${3 + i * 0.5}s ease-in-out infinite`, animationDelay: `${i * 0.3}s` }} />
          ))}
        </div>
        <div className="relative z-10">
          <div className="flex justify-center mb-4">
            <div className="relative group">
              <div className="p-0.5 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 shadow-[0_0_30px_rgba(0,180,230,0.5)]">
                <div className="p-0.5 rounded-full bg-background">
                  <AvatarEl name={user.name} size="xl" avatarUrl={user.avatar_url} />
                </div>
              </div>
              <button onClick={() => avatarInputRef.current?.click()}
                className="absolute inset-0 rounded-full flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                {uploadingAvatar
                  ? <div className="w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  : <Icon name="Camera" size={22} className="text-white" />}
              </button>
              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = ""; }} />
            </div>
          </div>
          <h2 className="text-2xl font-golos font-black text-foreground mb-1">{user.name}</h2>
          <p className="text-muted-foreground text-sm mb-2 min-h-[20px]">{user.bio || "Нет статуса"}</p>
          <div className="flex items-center justify-center gap-1.5">
            <div className="w-2 h-2 rounded-full status-online" />
            <span className="text-xs text-green-400">В сети</span>
          </div>
        </div>

        {/* Edit toggle */}
        <button onClick={editing ? cancelEdit : startEdit}
          className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full transition-colors">
          <Icon name={editing ? "X" : "Edit2"} size={16} className="text-muted-foreground" />
        </button>
      </div>

      <div className="px-4 space-y-3 pb-6">
        {/* Edit form */}
        {editing && (
          <div className="glass rounded-3xl p-4 space-y-3 animate-fade-in border border-blue-500/20">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="Edit3" size={14} className="text-sky-400" />
              <span className="text-xs font-semibold text-sky-400 uppercase tracking-wide">Редактирование профиля</span>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground font-medium">Имя</label>
              <div className="relative">
                <Icon name="User" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={name} onChange={e => setName(e.target.value)}
                  placeholder="Ваше имя"
                  className="w-full bg-secondary/60 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-sky-500/50 transition-all" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground font-medium">О себе</label>
              <div className="relative">
                <Icon name="AlignLeft" size={14} className="absolute left-3 top-3 text-muted-foreground" />
                <textarea value={bio} onChange={e => setBio(e.target.value)}
                  placeholder="Расскажите о себе..." rows={2}
                  className="w-full bg-secondary/60 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-sky-500/50 transition-all resize-none" />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
                <Icon name="AlertCircle" size={13} className="text-red-400 flex-shrink-0" />
                <span className="text-xs text-red-300">{error}</span>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={cancelEdit}
                className="flex-1 py-2.5 rounded-xl glass text-sm font-medium text-muted-foreground hover:text-foreground transition-all">
                Отмена
              </button>
              <button onClick={saveProfile} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                {saving
                  ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Сохраняем...</>
                  : <><Icon name="Check" size={14} />Сохранить</>}
              </button>
            </div>
          </div>
        )}

        {/* Success toast */}
        {saved && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-green-500/10 border border-green-500/20 animate-fade-in">
            <Icon name="CheckCircle" size={16} className="text-green-400 flex-shrink-0" />
            <span className="text-sm text-green-300 font-medium">Профиль успешно обновлён!</span>
          </div>
        )}

        {/* Info fields */}
        {[
          { icon: "Phone", label: "Телефон", value: user.phone, color: "text-sky-400", bg: "bg-blue-500/15 border-blue-500/20" },
          { icon: "Hash", label: "ID пользователя", value: `#${user.id}`, color: "text-cyan-400", bg: "bg-cyan-500/15 border-cyan-500/20" },
        ].map(item => (
          <div key={item.label} className="glass rounded-2xl p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${item.bg}`}>
              <Icon name={item.icon} size={16} className={item.color} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground">{item.label}</div>
              <div className="text-sm font-medium text-foreground">{item.value}</div>
            </div>
          </div>
        ))}

        {!editing && (
          <button onClick={startEdit}
            className="w-full glass rounded-2xl p-4 flex items-center gap-3 hover:bg-white/5 transition-all">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
              <Icon name="Edit3" size={16} className="text-sky-400" />
            </div>
            <span className="text-sm font-medium text-foreground">Редактировать профиль</span>
            <Icon name="ChevronRight" size={16} className="text-muted-foreground ml-auto" />
          </button>
        )}

        {/* Change password */}
        {!changingPw ? (
          <button onClick={() => setChangingPw(true)}
            className="w-full glass rounded-2xl p-4 flex items-center gap-3 hover:bg-white/5 transition-all">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center flex-shrink-0">
              <Icon name="KeyRound" size={16} className="text-cyan-400" />
            </div>
            <span className="text-sm font-medium text-foreground">Сменить пароль</span>
            <Icon name="ChevronRight" size={16} className="text-muted-foreground ml-auto" />
          </button>
        ) : (
          <div className="glass rounded-3xl p-4 space-y-3 animate-fade-in border border-cyan-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon name="KeyRound" size={14} className="text-cyan-400" />
                <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wide">Смена пароля</span>
              </div>
              <button onClick={cancelPw} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                <Icon name="X" size={14} className="text-muted-foreground" />
              </button>
            </div>

            {[
              { label: "Текущий пароль", val: curPw, set: setCurPw, show: showCur, toggleShow: () => setShowCur(v => !v) },
              { label: "Новый пароль", val: newPw, set: setNewPw, show: showNew, toggleShow: () => setShowNew(v => !v) },
              { label: "Повторите новый пароль", val: confirmPw, set: setConfirmPw, show: showNew, toggleShow: () => setShowNew(v => !v) },
            ].map((f, idx) => (
              <div key={f.label} className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">{f.label}</label>
                <div className="relative">
                  <Icon name="Lock" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={f.val} onChange={e => f.set(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && changePassword()}
                    type={f.show ? "text" : "password"}
                    placeholder={idx === 0 ? "Введите текущий пароль" : idx === 1 ? "Минимум 6 символов" : "Повторите пароль"}
                    className="w-full bg-secondary/60 border border-white/10 rounded-xl pl-9 pr-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-cyan-500/50 transition-all" />
                  {idx <= 1 && (
                    <button onClick={f.toggleShow} tabIndex={-1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      <Icon name={f.show ? "EyeOff" : "Eye"} size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Strength indicator */}
            {newPw.length > 0 && (
              <div className="space-y-1 animate-fade-in">
                <div className="flex gap-1">
                  {[...Array(4)].map((_, i) => {
                    const strength = newPw.length >= 12 ? 4 : newPw.length >= 8 ? 3 : newPw.length >= 6 ? 2 : 1;
                    const colors = ["bg-red-400", "bg-orange-400", "bg-yellow-400", "bg-green-400"];
                    return (
                      <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i < strength ? colors[strength - 1] : "bg-white/10"}`} />
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {newPw.length < 6 ? "Слишком короткий" : newPw.length < 8 ? "Слабый" : newPw.length < 12 ? "Хороший" : "Надёжный"}
                </p>
              </div>
            )}

            {pwError && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 animate-fade-in">
                <Icon name="AlertCircle" size={13} className="text-red-400 flex-shrink-0" />
                <span className="text-xs text-red-300">{pwError}</span>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={cancelPw}
                className="flex-1 py-2.5 rounded-xl glass text-sm font-medium text-muted-foreground hover:text-foreground transition-all">
                Отмена
              </button>
              <button onClick={changePassword} disabled={pwSaving}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                {pwSaving
                  ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Меняем...</>
                  : <><Icon name="Check" size={14} />Изменить</>}
              </button>
            </div>
          </div>
        )}

        {pwSaved && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-green-500/10 border border-green-500/20 animate-fade-in">
            <Icon name="ShieldCheck" size={16} className="text-green-400 flex-shrink-0" />
            <span className="text-sm text-green-300 font-medium">Пароль успешно изменён!</span>
          </div>
        )}

        {/* Pin code */}
        <button onClick={() => setPinMode(hasPin ? "change" : "setup")}
          className="w-full glass rounded-2xl p-4 flex items-center gap-3 hover:bg-white/5 transition-all">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
            <Icon name="Shield" size={16} className="text-emerald-400" />
          </div>
          <div className="flex-1 text-left">
            <span className="text-sm font-medium text-foreground">{hasPin ? "Изменить пин-код" : "Установить пин-код"}</span>
            {hasPin && <p className="text-[11px] text-emerald-400 mt-0.5">Защита включена</p>}
          </div>
          {hasPin && (
            <button onClick={e => { e.stopPropagation(); localStorage.removeItem(PIN_KEY); setHasPin(false); }}
              className="text-[11px] text-muted-foreground hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10">
              Снять
            </button>
          )}
          {!hasPin && <Icon name="ChevronRight" size={16} className="text-muted-foreground" />}
        </button>

        {pinSaved && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-green-500/10 border border-green-500/20 animate-fade-in">
            <Icon name="ShieldCheck" size={16} className="text-green-400 flex-shrink-0" />
            <span className="text-sm text-green-300 font-medium">Пин-код установлен!</span>
          </div>
        )}

        {/* Чёрный список */}
        <button onClick={() => {
          setShowBlacklist(v => !v);
          if (!showBlacklist) {
            setBlacklistLoading(true);
            fetch(AUTH_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "blocked-list" }) })
              .then(r => r.json())
              .then(d => { if (d.blocked) setBlockedUsers(d.blocked); })
              .catch(() => {})
              .finally(() => setBlacklistLoading(false));
          }
        }}
          className="w-full glass rounded-2xl p-4 flex items-center gap-3 hover:bg-white/5 transition-all">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/15 flex items-center justify-center flex-shrink-0">
            <Icon name="ShieldBan" size={16} className="text-red-400" />
          </div>
          <div className="flex-1 text-left">
            <span className="text-sm font-medium text-foreground">Чёрный список</span>
            {blockedUsers.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-0.5">{blockedUsers.length} пользователей</p>
            )}
          </div>
          <Icon name={showBlacklist ? "ChevronDown" : "ChevronRight"} size={16} className="text-muted-foreground" />
        </button>

        {showBlacklist && (
          <div className="glass rounded-2xl overflow-hidden animate-fade-in">
            {blacklistLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
              </div>
            ) : blockedUsers.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <Icon name="ShieldCheck" size={28} className="opacity-30" />
                <p className="text-sm">Чёрный список пуст</p>
              </div>
            ) : (
              <div>
                {blockedUsers.map((u, i) => (
                  <div key={u.id}
                    className={`flex items-center gap-3 px-4 py-3 ${i < blockedUsers.length - 1 ? "border-b border-white/5" : ""}`}>
                    <AvatarEl name={u.name} size="sm" avatarUrl={u.avatar_url} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{u.name}</p>
                      {u.phone && <p className="text-[11px] text-muted-foreground">{u.phone}</p>}
                    </div>
                    <button
                      disabled={unblockingId === u.id}
                      onClick={async () => {
                        setUnblockingId(u.id);
                        try {
                          const res = await fetch(AUTH_URL, {
                            method: "POST", headers: apiHeaders(token),
                            body: JSON.stringify({ action: "unblock", user_id: u.id }),
                          });
                          const data = await res.json();
                          if (data.ok) setBlockedUsers(prev => prev.filter(x => x.id !== u.id));
                        } catch { /* ignore */ }
                        finally { setUnblockingId(null); }
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-medium bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 transition-all disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0">
                      {unblockingId === u.id
                        ? <div className="w-3 h-3 border border-green-400/30 border-t-green-400 rounded-full animate-spin" />
                        : <Icon name="ShieldOff" size={12} />}
                      Разблокировать
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <button onClick={onLogout}
          className="w-full glass rounded-2xl p-4 flex items-center gap-3 hover:bg-red-500/5 transition-all">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
            <Icon name="LogOut" size={16} className="text-red-400" />
          </div>
          <span className="text-sm font-medium text-red-400">Выйти из аккаунта</span>
        </button>

        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)}
            className="w-full glass rounded-2xl p-4 flex items-center gap-3 hover:bg-red-500/5 transition-all">
            <div className="w-10 h-10 rounded-xl bg-red-900/20 border border-red-700/30 flex items-center justify-center flex-shrink-0">
              <Icon name="Trash2" size={16} className="text-red-500" />
            </div>
            <span className="text-sm font-medium text-red-500">Удалить профиль</span>
          </button>
        ) : (
          <div className="glass rounded-2xl p-4 border border-red-500/30 animate-fade-in">
            <p className="text-sm text-foreground font-semibold mb-1">Удалить профиль?</p>
            <p className="text-xs text-muted-foreground mb-4">Это действие необратимо. Все ваши данные будут удалены.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(false)} disabled={deleting}
                className="flex-1 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-muted-foreground hover:bg-white/10 transition-all">
                Отмена
              </button>
              <button disabled={deleting} onClick={async () => {
                setDeleting(true);
                try {
                  await fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "delete-account" }) });
                  onDeleteAccount();
                } catch { setDeleting(false); }
              }}
                className="flex-1 py-2 rounded-xl bg-red-600 text-sm text-white font-semibold hover:bg-red-700 transition-all disabled:opacity-50">
                {deleting ? "Удаляем..." : "Удалить"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Other Tabs ───────────────────────────────────────────────────────────────

function CallScreen({ session, token, onEnd }: { session: CallSession; token: string; onEnd: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [callStatus, setCallStatus] = useState<"ringing" | "active">(session.status === "active" ? "active" : "ringing");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [noMic, setNoMic] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastSignalIdRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endedRef = useRef(false);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescSetRef = useRef(false);
  const callStatusRef = useRef<"ringing" | "active">(session.status === "active" ? "active" : "ringing");

  const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ];

  async function sendSignal(type: string, payload: unknown) {
    await fetch(CALLS_URL, {
      method: "POST", headers: apiHeaders(token),
      body: JSON.stringify({ action: "signal", call_id: session.callId, type, payload }),
    }).catch(() => {});
  }

  async function endCall() {
    if (endedRef.current) return;
    endedRef.current = true;
    if (pollRef.current) clearInterval(pollRef.current);
    pcRef.current?.close();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    if (remoteAudioRef.current) { remoteAudioRef.current.srcObject = null; remoteAudioRef.current.remove(); remoteAudioRef.current = null; }
    await fetch(CALLS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "end", call_id: session.callId }) }).catch(() => {});
    onEnd();
  }

  useEffect(() => { callStatusRef.current = callStatus; }, [callStatus]);

  useEffect(() => {
    if (callStatus !== "active") return;
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, [callStatus]);

  useEffect(() => {
    async function init() {
      const constraints = session.isVideo
        ? { audio: true, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } }
        : { audio: true, video: false };

      const stream = await navigator.mediaDevices.getUserMedia(constraints).catch(async () => {
        // Fallback: только аудио если нет видео
        if (session.isVideo) return navigator.mediaDevices.getUserMedia({ audio: true, video: false }).catch(() => null);
        return null;
      });

      if (!stream) { setNoMic(true); return; }
      localStreamRef.current = stream;

      if (session.isVideo && localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 10 });
      pcRef.current = pc;
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      // Аудио для голосового звонка
      if (!session.isVideo) {
        if (!remoteAudioRef.current) {
          remoteAudioRef.current = document.createElement("audio");
          remoteAudioRef.current.autoplay = true;
          document.body.appendChild(remoteAudioRef.current);
        }
      }

      pc.ontrack = (e) => {
        if (!e.streams[0]) return;
        if (session.isVideo && remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = e.streams[0];
          remoteVideoRef.current.play().catch(() => {});
        } else if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = e.streams[0];
          remoteAudioRef.current.play().catch(() => {});
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === "connected") { callStatusRef.current = "active"; setCallStatus("active"); }
        if (state === "disconnected" || state === "failed") endCall();
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) sendSignal("ice-candidate", e.candidate.toJSON());
      };

      async function flushPendingCandidates() {
        for (const c of pendingCandidatesRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
        pendingCandidatesRef.current = [];
      }

      const offerConstraints = session.isVideo
        ? { offerToReceiveAudio: true, offerToReceiveVideo: true }
        : { offerToReceiveAudio: true, offerToReceiveVideo: false };

      if (session.direction === "outgoing") {
        const offer = await pc.createOffer(offerConstraints);
        await pc.setLocalDescription(offer);
        await sendSignal("offer", { sdp: offer.sdp, type: offer.type });
      }

      pollRef.current = setInterval(async () => {
        if (endedRef.current) return;
        const res = await fetch(CALLS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "poll", call_id: session.callId, last_signal_id: lastSignalIdRef.current }) }).catch(() => null);
        if (!res) return;
        const data = await res.json().catch(() => ({}));

        if (data.call?.status === "ended" || data.call?.status === "declined") { endCall(); return; }
        if (data.call?.status === "active" && callStatusRef.current !== "active") {
          callStatusRef.current = "active";
          setCallStatus("active");
        }

        for (const sig of (data.signals ?? [])) {
          lastSignalIdRef.current = sig.id;
          const pl = typeof sig.payload === "string" ? JSON.parse(sig.payload) : sig.payload;

          if (sig.type === "offer" && session.direction === "incoming") {
            if (pc.signalingState !== "stable") continue;
            await pc.setRemoteDescription(new RTCSessionDescription(pl));
            remoteDescSetRef.current = true;
            await flushPendingCandidates();
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendSignal("answer", { sdp: answer.sdp, type: answer.type });

          } else if (sig.type === "answer" && session.direction === "outgoing") {
            if (pc.signalingState === "have-local-offer") {
              await pc.setRemoteDescription(new RTCSessionDescription(pl));
              remoteDescSetRef.current = true;
              await flushPendingCandidates();
            }

          } else if (sig.type === "ice-candidate") {
            if (remoteDescSetRef.current) {
              await pc.addIceCandidate(new RTCIceCandidate(pl)).catch(() => {});
            } else {
              pendingCandidatesRef.current.push(pl);
            }
          }
        }
      }, 1000);
    }
    init();
    return () => {
      endedRef.current = true;
      if (pollRef.current) clearInterval(pollRef.current);
      if (remoteAudioRef.current) { remoteAudioRef.current.srcObject = null; remoteAudioRef.current.remove(); remoteAudioRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleMute() {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    tracks.forEach(t => { t.enabled = muted; });
    setMuted(m => !m);
  }

  function toggleVideo() {
    const tracks = localStreamRef.current?.getVideoTracks() ?? [];
    tracks.forEach(t => { t.enabled = videoOff; });
    setVideoOff(v => !v);
  }

  async function flipCamera() {
    const newFacing = facingMode === "user" ? "environment" : "user";
    setFacingMode(newFacing);
    const pc = pcRef.current;
    if (!pc) return;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: newFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) return;
      const sender = pc.getSenders().find(s => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(newVideoTrack);
      // Останавливаем старые треки видео
      localStreamRef.current?.getVideoTracks().forEach(t => t.stop());
      // Заменяем стрим
      const audioTracks = localStreamRef.current?.getAudioTracks() ?? [];
      const newCombined = new MediaStream([...audioTracks, newVideoTrack]);
      localStreamRef.current = newCombined;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = newCombined;
        localVideoRef.current.play().catch(() => {});
      }
    } catch { /* камера недоступна */ }
  }

  function toggleSpeaker() {
    setSpeaker(s => !s);
    // На мобильных устройствах setSinkId позволяет переключить на наушник/динамик
    if (remoteAudioRef.current && "setSinkId" in remoteAudioRef.current) {
      (remoteAudioRef.current as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> })
        .setSinkId(speaker ? "" : "default").catch(() => {});
    }
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const statusLabel = callStatus === "active" ? fmt(elapsed) : (session.direction === "outgoing" ? "Вызов..." : "Соединение...");

  // ── Видеозвонок ──
  if (session.isVideo) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col animate-fade-in">
        {/* Удалённое видео (фон) */}
        <video ref={remoteVideoRef} autoPlay playsInline
          className="absolute inset-0 w-full h-full object-cover"
          style={{ background: "#000" }} />

        {/* Оверлей когда нет соединения */}
        {callStatus !== "active" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10"
            style={{ background: "linear-gradient(160deg, #0a1628dd 0%, #0d2040dd 100%)" }}>
            <div className="w-24 h-24 rounded-full overflow-hidden ring-4 ring-white/20 shadow-[0_0_60px_rgba(0,180,230,0.4)] animate-pulse">
              {session.peerAvatar
                ? <img src={session.peerAvatar} className="w-full h-full object-cover" alt="" />
                : <div className="w-full h-full bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center">
                    <span className="text-3xl font-golos font-black text-white">{session.peerName[0]}</span>
                  </div>}
            </div>
            <p className="text-white text-xl font-golos font-bold">{session.peerName}</p>
            <p className="text-cyan-300 text-sm">{statusLabel}</p>
          </div>
        )}

        {/* Таймер поверх видео */}
        {callStatus === "active" && (
          <div className="absolute top-safe-top left-0 right-0 flex items-center justify-between px-4 pt-12 z-20">
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-white text-sm font-medium">{fmt(elapsed)}</span>
            </div>
            <div className="text-white/80 text-sm font-medium bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5">
              {session.peerName}
            </div>
          </div>
        )}

        {/* Своё видео — маленькое в углу */}
        <div className="absolute top-16 right-4 z-20 mt-8">
          <div className="w-28 h-40 rounded-2xl overflow-hidden ring-2 ring-white/20 shadow-xl bg-black"
            style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.6)" }}>
            {videoOff
              ? <div className="w-full h-full flex items-center justify-center bg-gray-900">
                  <Icon name="VideoOff" size={24} className="text-white/40" />
                </div>
              : <video ref={localVideoRef} autoPlay playsInline muted
                  className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />
            }
          </div>
        </div>

        {/* Кнопки управления */}
        <div className="absolute bottom-0 left-0 right-0 z-20 px-6 pb-12 pt-6"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)" }}>
          <div className="flex justify-center gap-4 mb-6">
            {/* Микрофон */}
            <button onClick={toggleMute}
              className={`flex flex-col items-center gap-1.5 w-16 h-16 rounded-2xl justify-center transition-all active:scale-95
                ${muted ? "bg-red-500/80" : "bg-white/15 backdrop-blur-sm"}`}>
              <Icon name={muted ? "MicOff" : "Mic"} size={22} className="text-white" />
              <span className="text-[10px] text-white/80">{muted ? "Вкл" : "Микр"}</span>
            </button>

            {/* Видео вкл/выкл */}
            <button onClick={toggleVideo}
              className={`flex flex-col items-center gap-1.5 w-16 h-16 rounded-2xl justify-center transition-all active:scale-95
                ${videoOff ? "bg-red-500/80" : "bg-white/15 backdrop-blur-sm"}`}>
              <Icon name={videoOff ? "VideoOff" : "Video"} size={22} className="text-white" />
              <span className="text-[10px] text-white/80">{videoOff ? "Вкл" : "Видео"}</span>
            </button>

            {/* Перевернуть камеру */}
            <button onClick={flipCamera}
              className="flex flex-col items-center gap-1.5 w-16 h-16 rounded-2xl justify-center bg-white/15 backdrop-blur-sm transition-all active:scale-95">
              <Icon name="FlipHorizontal2" size={22} className="text-white" />
              <span className="text-[10px] text-white/80">Камера</span>
            </button>
          </div>

          {/* Завершить */}
          <div className="flex justify-center">
            <button onClick={endCall}
              className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.6)] transition-all active:scale-95">
              <Icon name="PhoneOff" size={30} className="text-white" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Аудиозвонок ──
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between py-16 px-8 animate-fade-in"
      style={{ background: "linear-gradient(160deg, #0a1628 0%, #0d2040 60%, #071020 100%)" }}>

      {/* Декор */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className={`absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-1000
          ${callStatus === "active" ? "w-96 h-96 opacity-10" : "w-72 h-72 opacity-5"}`}
          style={{ background: "radial-gradient(circle, #0ea5e9, transparent)" }} />
      </div>

      <div className="flex flex-col items-center gap-4 mt-8 relative z-10">
        <div className={`w-28 h-28 rounded-full overflow-hidden ring-4 transition-all duration-500
          ${callStatus === "active" ? "ring-green-400/50 shadow-[0_0_60px_rgba(74,222,128,0.3)]" : "ring-blue-500/30 shadow-[0_0_60px_rgba(0,180,230,0.3)] animate-pulse"}`}>
          {session.peerAvatar
            ? <img src={session.peerAvatar} className="w-full h-full object-cover" alt="" />
            : <div className="w-full h-full bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center">
                <span className="text-4xl font-golos font-black text-white">{session.peerName[0]}</span>
              </div>}
        </div>
        <div className="text-xl font-golos font-bold text-white">{session.peerName}</div>
        <div className={`text-sm font-medium flex items-center gap-2 ${callStatus === "active" ? "text-green-400" : "text-cyan-300"}`}>
          {callStatus === "active" && <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
          {statusLabel}
        </div>
        {noMic && <p className="text-xs text-red-400 mt-1">Нет доступа к микрофону</p>}
      </div>

      <div className="flex flex-col items-center gap-8 w-full relative z-10">
        <div className="flex justify-center gap-6">
          {/* Микрофон */}
          <button onClick={toggleMute}
            className={`flex flex-col items-center gap-2 w-16 h-16 rounded-2xl justify-center transition-all active:scale-95
              ${muted ? "bg-red-500/30 text-red-300" : "bg-white/10 text-white"}`}>
            <Icon name={muted ? "MicOff" : "Mic"} size={22} />
            <span className="text-[10px]">{muted ? "Выкл" : "Микр"}</span>
          </button>

          {/* Спикерфон */}
          <button onClick={toggleSpeaker}
            className={`flex flex-col items-center gap-2 w-16 h-16 rounded-2xl justify-center transition-all active:scale-95
              ${speaker ? "bg-blue-500/30 text-blue-300" : "bg-white/10 text-white"}`}>
            <Icon name={speaker ? "Volume2" : "VolumeX"} size={22} />
            <span className="text-[10px]">{speaker ? "Громко" : "Тихо"}</span>
          </button>
        </div>

        <button onClick={endCall}
          className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.5)] transition-all active:scale-95">
          <Icon name="PhoneOff" size={32} className="text-white" />
        </button>
      </div>
    </div>
  );
}

function IncomingCallBanner({ session, onAccept, onDecline }: { session: CallSession; onAccept: () => void; onDecline: () => void }) {
  useEffect(() => {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    let stopped = false;

    async function ring() {
      while (!stopped) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(1000, ctx.currentTime);
        osc.frequency.setValueAtTime(800, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
        await new Promise(r => setTimeout(r, 1200));
      }
    }
    ring();

    let vibrateInterval: ReturnType<typeof setInterval> | null = null;
    if ("vibrate" in navigator) {
      navigator.vibrate([400, 200, 400]);
      vibrateInterval = setInterval(() => navigator.vibrate([400, 200, 400]), 1200);
    }
    return () => {
      stopped = true;
      ctx.close();
      if (vibrateInterval) clearInterval(vibrateInterval);
      if ("vibrate" in navigator) navigator.vibrate(0);
    };
  }, []);

  return (
    <div className="fixed top-4 left-0 right-0 z-50 flex justify-center px-4 animate-fade-in">
      <div className="w-full max-w-lg glass border border-white/10 rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-3">
        {/* Аватар */}
        <div className="w-11 h-11 rounded-full overflow-hidden flex-shrink-0 ring-2 ring-white/10">
          {session.peerAvatar
            ? <img src={session.peerAvatar} className="w-full h-full object-cover" alt="" />
            : <div className="w-full h-full bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center">
                <span className="font-golos font-bold text-white text-sm">{session.peerName[0]}</span>
              </div>}
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-golos font-semibold text-sm text-foreground truncate">{session.peerName}</div>
          <div className="flex items-center gap-1.5 text-xs text-cyan-400">
            <Icon name={session.isVideo ? "Video" : "Phone"} size={11} />
            <span>Входящий {session.isVideo ? "видеозвонок" : "звонок"}</span>
          </div>
        </div>

        {/* Отклонить */}
        <button onClick={onDecline}
          className="flex flex-col items-center gap-0.5 p-2.5 rounded-full bg-red-500/20 hover:bg-red-500/40 transition-colors">
          <Icon name="PhoneOff" size={18} className="text-red-400" />
        </button>

        {/* Принять — иконка зависит от типа звонка */}
        <button onClick={onAccept}
          className="flex flex-col items-center gap-0.5 p-2.5 rounded-full bg-green-500/20 hover:bg-green-500/40 transition-colors">
          <Icon name={session.isVideo ? "Video" : "Phone"} size={18} className="text-green-400" />
        </button>
      </div>
    </div>
  );
}

function CallsTab({ token, onCall }: { token: string; onCall: (userId: number, userName: string, isVideo?: boolean) => void }) {
  const [calls, setCalls] = useState<{ id: number; caller_id: number; callee_id: number; status: string; is_video: boolean; duration: string | null; type: string; caller_name: string; callee_name: string; caller_avatar?: string | null; callee_avatar?: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "incoming" | "outgoing" | "missed">("all");

  useEffect(() => {
    fetch(CALLS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "history" }) })
      .then(r => r.json())
      .then(d => { if (d.calls) setCalls(d.calls); })
      .finally(() => setLoading(false));
  }, [token]);

  const filtered = calls.filter(c => {
    if (filter === "all") return true;
    if (filter === "missed") return c.status === "missed" || (c.type === "incoming" && c.status !== "ended");
    return c.type === filter;
  });

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 flex-shrink-0">
        <h1 className="text-2xl font-golos font-black text-gradient mb-3">Звонки</h1>
        {/* Фильтры */}
        <div className="flex gap-1.5">
          {(["all", "incoming", "outgoing", "missed"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all
                ${filter === f ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-[0_0_12px_rgba(0,119,182,0.4)]" : "bg-white/8 text-muted-foreground hover:text-foreground hover:bg-white/12"}`}>
              {{ all: "Все", incoming: "Входящие", outgoing: "Исходящие", missed: "Пропущенные" }[f]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-container">
        {loading && <div className="text-center py-8 text-sm text-muted-foreground">Загрузка...</div>}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
            <Icon name="Phone" size={36} className="opacity-30" />
            <p className="text-sm">Звонков пока нет</p>
          </div>
        )}
        {filtered.map((call, i) => {
          const isMissed = call.status === "missed" || (call.type === "incoming" && call.status === "ringing");
          const cfg = isMissed
            ? { icon: "PhoneMissed", color: "text-red-400", label: "Пропущенный" }
            : call.type === "outgoing"
              ? { icon: "PhoneOutgoing", color: "text-cyan-400", label: "Исходящий" }
              : { icon: "PhoneIncoming", color: "text-green-400", label: "Входящий" };

          const peerName = call.type === "outgoing" ? call.callee_name : call.caller_name;
          const peerId = call.type === "outgoing" ? call.callee_id : call.caller_id;
          const peerAvatar = call.type === "outgoing" ? call.callee_avatar : call.caller_avatar;

          return (
            <div key={call.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-all animate-fade-in"
              style={{ animationDelay: `${i * 0.04}s` }}>
              <AvatarEl name={peerName} size="md" avatarUrl={peerAvatar} />
              <div className="flex-1 min-w-0">
                <div className="font-golos font-semibold text-foreground text-sm truncate">{peerName}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Icon name={cfg.icon} size={12} className={cfg.color} />
                  <span className={`text-xs ${cfg.color}`}>{cfg.label}</span>
                  {call.is_video && (
                    <span className="flex items-center gap-0.5 text-xs text-purple-400">
                      <Icon name="Video" size={10} />видео
                    </span>
                  )}
                  {call.duration && <span className="text-xs text-muted-foreground">· {call.duration}</span>}
                </div>
              </div>
              {/* Перезвонить — аудио или видео в зависимости от типа */}
              <div className="flex items-center gap-1">
                <button onClick={() => onCall(peerId, peerName, false)}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Аудиозвонок">
                  <Icon name="Phone" size={15} className="text-sky-400" />
                </button>
                <button onClick={() => onCall(peerId, peerName, true)}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Видеозвонок">
                  <Icon name="Video" size={15} className="text-purple-400" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusTab({ user }: { user: User }) {
  const [posting, setPosting] = useState(false);
  const [myText, setMyText] = useState("");
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-2xl font-golos font-black text-gradient mb-4">Статусы</h1>
        <div className="glass rounded-3xl p-4 mb-3">
          <div className="flex items-center gap-3">
            <div className="p-0.5 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400">
              <div className="p-0.5 rounded-full bg-background"><AvatarEl name={user.name} size="sm" /></div>
            </div>
            <div className="flex-1">
              <div className="font-golos font-semibold text-sm text-foreground">Мой статус</div>
              <div className="text-xs text-muted-foreground">Добавить обновление</div>
            </div>
            <button onClick={() => setPosting(!posting)}
              className="p-2.5 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 hover:scale-105 transition-all">
              <Icon name={posting ? "X" : "Plus"} size={16} className="text-white" />
            </button>
          </div>
          {posting && (
            <div className="mt-3 animate-fade-in">
              <textarea value={myText} onChange={e => setMyText(e.target.value)}
                placeholder="Что у вас происходит?" rows={2}
                className="w-full bg-secondary/60 border border-white/10 rounded-2xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-sky-500/50 transition-all mb-2" />
              <button className="w-full py-2.5 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm font-semibold">
                Опубликовать
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scroll-container px-4">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Обновления</div>
        <div className="space-y-3">
          {MOCK_STATUSES.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 animate-fade-in" style={{ animationDelay: `${i * 0.06}s` }}>
              <div className={`p-0.5 rounded-full bg-gradient-to-br ${s.color} ${s.viewed ? "opacity-40" : ""}`}>
                <div className="p-0.5 rounded-full bg-background"><AvatarEl name={s.name} size="md" /></div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-golos font-semibold text-foreground text-sm">{s.name}</div>
                {s.text && <div className="text-xs text-muted-foreground truncate">{s.text}</div>}
                <div className="text-xs text-muted-foreground">{s.time} назад</div>
              </div>
              {!s.viewed && <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse-dot flex-shrink-0" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface Contact {
  id: number;
  name: string;
  phone: string;
  user_id: number | null;
  status: string | null;
  avatar_url: string | null;
}

function ContactsTab({ token, onCall, onOpenChat }: { token: string; onCall: (userId: number, userName: string, isVideo?: boolean) => void; onOpenChat?: (userId: number) => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState("");
  const [tab, setTab] = useState<"my" | "search">("my");
  const [searchUsers, setSearchUsers] = useState<{ id: number; name: string; phone: string; status: string; avatar_url?: string | null }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchQ, setSearchQ] = useState("");

  const [showSyncBanner, setShowSyncBanner] = useState(false);

  useEffect(() => {
    loadContacts();
    // Показываем баннер синхронизации если ещё не синхронизировали
    const syncKey = `pulse_contacts_synced_${token?.slice(0, 8)}`;
    if (!localStorage.getItem(syncKey) && "contacts" in navigator) {
      setShowSyncBanner(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function loadContacts() {
    setLoading(true);
    try {
      const res = await fetch(AUTH_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "contacts" }) });
      const data = await res.json();
      if (data.contacts) setContacts(data.contacts.filter((c: Contact) => c.name !== "[удалён]" && c.phone));
    } finally { setLoading(false); }
  }

  async function syncPhonebook() {
    if (!("contacts" in navigator)) {
      alert("Ваш браузер не поддерживает доступ к телефонной книге. Попробуйте в Chrome на Android.");
      return;
    }
    setSyncing(true);
    try {
      // @ts-expect-error — Contact Picker API
      const raw = await navigator.contacts.select(["name", "tel"], { multiple: true });
      const entries: { name: string; phone: string }[] = [];
      for (const c of raw) {
        const name = (c.name && c.name[0]) || "Без имени";
        for (const tel of (c.tel || [])) {
          const phone = tel.replace(/\s+/g, "").replace(/[^+\d]/g, "");
          if (phone) entries.push({ name, phone });
        }
      }
      if (!entries.length) { setSyncing(false); return; }
      const res = await fetch(AUTH_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: "contacts/sync", contacts: entries }),
      });
      const data = await res.json();
      setSyncDone(data.synced ?? 0);
      setTimeout(() => setSyncDone(null), 3000);
      const syncKey = `pulse_contacts_synced_${token?.slice(0, 8)}`;
      localStorage.setItem(syncKey, "1");
      setShowSyncBanner(false);
      await loadContacts();
    } finally { setSyncing(false); }
  }

  async function addContact() {
    if (!addName.trim() || !addPhone.trim()) { setAddError("Заполните имя и номер"); return; }
    setAddLoading(true); setAddError("");
    try {
      const res = await fetch(AUTH_URL, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ action: "contacts/add", name: addName.trim(), phone: addPhone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error || "Ошибка"); return; }
      setContacts(prev => {
        const exists = prev.findIndex(c => c.id === data.contact.id);
        if (exists >= 0) { const n = [...prev]; n[exists] = data.contact; return n; }
        return [data.contact, ...prev];
      });
      setShowAdd(false); setAddName(""); setAddPhone("");
    } finally { setAddLoading(false); }
  }

  async function removeContact(id: number) {
    await fetch(AUTH_URL, {
      method: "POST", headers: apiHeaders(token),
      body: JSON.stringify({ action: "contacts/remove", contact_id: id }),
    });
    setContacts(prev => prev.filter(c => c.id !== id));
  }

  async function doSearch(q: string) {
    setSearchQ(q);
    if (!q.trim()) { setSearchUsers([]); return; }
    setSearchLoading(true);
    try {
      const res = await fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "users", q }) });
      const data = await res.json();
      if (data.users) setSearchUsers(data.users);
    } finally { setSearchLoading(false); }
  }

  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search)
  );

  const grouped: Record<string, Contact[]> = {};
  for (const c of filtered) {
    const letter = c.name[0]?.toUpperCase() || "#";
    if (!grouped[letter]) grouped[letter] = [];
    grouped[letter].push(c);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-golos font-black text-gradient">Контакты</h1>
          <div className="flex gap-1.5">
            <button onClick={syncPhonebook} disabled={syncing}
              className="p-2 hover:bg-white/10 rounded-xl transition-colors flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              {syncing
                ? <div className="w-4 h-4 border-2 border-sky-500/40 border-t-sky-500 rounded-full animate-spin" />
                : <Icon name="RefreshCw" size={16} className="text-sky-400" />}
            </button>
            <button onClick={() => { setShowAdd(true); setAddError(""); }}
              className="p-2 hover:bg-white/10 rounded-xl transition-colors">
              <Icon name="UserPlus" size={16} className="text-cyan-400" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-secondary/40 rounded-2xl mb-3">
          {([["my", "Мои"], ["search", "Поиск"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex-1 py-1.5 text-sm font-medium rounded-xl transition-all ${tab === key ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          {tab === "my"
            ? <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Поиск в контактах..."
                className="w-full bg-secondary/60 border border-white/10 rounded-2xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-sky-500/50 transition-all" />
            : <input value={searchQ} onChange={e => doSearch(e.target.value)}
                placeholder="Поиск пользователей..."
                className="w-full bg-secondary/60 border border-white/10 rounded-2xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-sky-500/50 transition-all" />
          }
        </div>
      </div>

      {/* Баннер предложения синхронизации */}
      {showSyncBanner && (
        <div className="mx-4 mb-2 flex items-center gap-3 px-4 py-3 rounded-2xl bg-sky-500/10 border border-sky-500/20 animate-fade-in">
          <Icon name="BookUser" size={16} className="text-sky-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-sky-300 font-medium">Синхронизировать телефонную книгу?</p>
            <p className="text-[11px] text-muted-foreground">Найдём друзей из контактов в приложении</p>
          </div>
          <div className="flex gap-1.5">
            <button onClick={syncPhonebook} className="px-3 py-1.5 rounded-xl bg-sky-500 text-white text-xs font-semibold hover:bg-sky-400 transition-colors">
              Да
            </button>
            <button onClick={() => { setShowSyncBanner(false); const k = `pulse_contacts_synced_${token?.slice(0,8)}`; localStorage.setItem(k,"1"); }}
              className="px-3 py-1.5 rounded-xl bg-white/10 text-muted-foreground text-xs hover:bg-white/20 transition-colors">
              Нет
            </button>
          </div>
        </div>
      )}

      {/* Sync banner */}
      {syncDone !== null && (
        <div className="mx-4 mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-green-500/10 border border-green-500/20 animate-fade-in">
          <Icon name="CheckCircle" size={14} className="text-green-400" />
          <span className="text-xs text-green-300">Синхронизировано {syncDone} контактов</span>
        </div>
      )}

      {/* Add contact form */}
      {showAdd && (
        <div className="mx-4 mb-3 glass rounded-3xl p-4 border border-blue-500/20 animate-fade-in space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-sky-400 uppercase tracking-wide">Новый контакт</span>
            <button onClick={() => setShowAdd(false)} className="text-muted-foreground hover:text-foreground">
              <Icon name="X" size={14} />
            </button>
          </div>
          <div className="relative">
            <Icon name="User" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={addName} onChange={e => setAddName(e.target.value)}
              placeholder="Имя"
              className="w-full bg-secondary/60 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-sky-500/50 transition-all" />
          </div>
          <div className="relative">
            <Icon name="Phone" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={addPhone} onChange={e => setAddPhone(e.target.value)}
              placeholder="+7 999 000 00 00"
              type="tel"
              className="w-full bg-secondary/60 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-sky-500/50 transition-all" />
          </div>
          {addError && <p className="text-xs text-red-400">{addError}</p>}
          <button onClick={addContact} disabled={addLoading}
            className="w-full py-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2">
            {addLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : "Добавить"}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto scroll-container">
        {tab === "my" ? (
          loading
            ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" /></div>
            : contacts.length === 0
              ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
                  <div className="w-16 h-16 rounded-3xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                    <Icon name="Users" size={28} className="text-cyan-400" />
                  </div>
                  <div>
                    <p className="font-golos font-semibold text-foreground mb-1">Нет контактов</p>
                    <p className="text-sm text-muted-foreground">Добавьте контакт вручную или синхронизируйте с телефонной книгой</p>
                  </div>
                  <button onClick={syncPhonebook}
                    className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-sm font-semibold hover:opacity-90 transition-all flex items-center gap-2">
                    <Icon name="RefreshCw" size={14} />Синхронизировать
                  </button>
                </div>
              )
              : Object.keys(grouped).sort().map(letter => (
                <div key={letter}>
                  <div className="px-4 py-1 text-[11px] font-bold text-muted-foreground uppercase tracking-widest">{letter}</div>
                  {grouped[letter].map(c => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-all group">
                      <AvatarEl name={c.name} size="md" status={c.status ?? undefined} avatarUrl={c.avatar_url} />
                      <div className="flex-1 min-w-0">
                        <div className="font-golos font-semibold text-foreground text-sm truncate">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{c.phone}</div>
                        {c.user_id && <div className="text-[10px] text-sky-400 mt-0.5">В приложении</div>}
                      </div>
                      <div className="flex gap-1">
                        {c.user_id && (
                          <>
                            <button onClick={() => onOpenChat?.(c.user_id!)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                              <Icon name="MessageCircle" size={15} className="text-sky-400" />
                            </button>
                            <button onClick={() => onCall(c.user_id!, c.name)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                              <Icon name="Phone" size={15} className="text-cyan-400" />
                            </button>
                          </>
                        )}
                        <button onClick={() => removeContact(c.id)} className="p-2 hover:bg-red-500/10 rounded-full transition-colors opacity-0 group-hover:opacity-100 transition-opacity">
                          <Icon name="Trash2" size={15} className="text-muted-foreground hover:text-red-400 transition-colors" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))
        ) : (
          <>
            {searchLoading && <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" /></div>}
            {!searchQ && !searchLoading && (
              <div className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
                <Icon name="Search" size={32} className="text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Введите имя или номер телефона</p>
              </div>
            )}
            {searchUsers.map((u, i) => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-all animate-fade-in"
                style={{ animationDelay: `${i * 0.04}s` }}>
                <AvatarEl name={u.name} size="md" status={u.status} avatarUrl={u.avatar_url} />
                <div className="flex-1 min-w-0">
                  <div className="font-golos font-semibold text-foreground text-sm truncate">{u.name}</div>
                  <div className="text-xs text-muted-foreground">{u.phone}</div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => onOpenChat?.(u.id)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                    <Icon name="MessageCircle" size={16} className="text-sky-400" />
                  </button>
                  <button onClick={() => onCall(u.id, u.name)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                    <Icon name="Phone" size={16} className="text-cyan-400" />
                  </button>
                  <button onClick={() => { setAddName(u.name); setAddPhone(u.phone); setTab("my"); setShowAdd(true); }}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors">
                    <Icon name="UserPlus" size={16} className="text-emerald-400" />
                  </button>
                </div>
              </div>
            ))}
            {searchQ && !searchLoading && searchUsers.length === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground">Пользователи не найдены</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function applyTheme(isDark: boolean) {
  const root = document.documentElement;
  if (isDark) { root.classList.remove("light"); }
  else { root.classList.add("light"); }
  localStorage.setItem("pulse_theme", isDark ? "dark" : "light");
}

type SettingsSection = "main" | "chats" | "privacy" | "notifications" | "data" | "folders" | "devices" | "language" | "policy";

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)}
      className={`w-11 h-6 rounded-full transition-all duration-300 relative flex-shrink-0 ${value ? "bg-gradient-to-r from-blue-600 to-blue-700" : "bg-secondary"}`}>
      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-300 ${value ? "left-5" : "left-0.5"}`} />
    </button>
  );
}

function SettingsRow({ icon, iconBg, label, value, desc, onClick, right, noBorder }: {
  icon: string; iconBg: string; label: string; value?: string; desc?: string;
  onClick?: () => void; right?: React.ReactNode; noBorder?: boolean;
}) {
  return (
    <button onClick={onClick} className={`flex items-center gap-3 px-4 py-3.5 w-full hover:bg-white/5 transition-all ${!noBorder ? "border-b border-white/5" : ""}`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        <Icon name={icon as Parameters<typeof Icon>[0]["name"]} size={16} className="text-white/90" />
      </div>
      <div className="flex-1 text-left min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {desc && <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>}
      </div>
      {value && <span className="text-xs text-muted-foreground mr-1">{value}</span>}
      {right ?? <Icon name="ChevronRight" size={15} className="text-muted-foreground flex-shrink-0" />}
    </button>
  );
}

// ─── Install App Button (PWA) ─────────────────────────────────────────────────

function InstallAppButton() {
  const [prompt, setPrompt] = useState<{ prompt: () => void } | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandalone = ("standalone" in navigator) && (navigator as { standalone?: boolean }).standalone;

  useEffect(() => {
    if (isInStandalone) { setInstalled(true); return; }
    const handler = (e: Event) => { e.preventDefault(); setPrompt(e as { prompt: () => void }); };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", () => setInstalled(true));
    };
  }, [isInStandalone]);

  if (installed) {
    return (
      <div className="w-full glass rounded-2xl flex items-center gap-3 px-4 py-3.5">
        <div className="w-10 h-10 rounded-xl bg-green-500/15 border border-green-500/20 flex items-center justify-center flex-shrink-0">
          <Icon name="CheckCircle" size={18} className="text-green-400" />
        </div>
        <div className="flex-1 text-left">
          <div className="text-sm font-semibold text-foreground">Приложение установлено</div>
          <div className="text-xs text-green-400">Открывайте с экрана «Домой»</div>
        </div>
      </div>
    );
  }

  if (!prompt && !isIOS) return null;

  return (
    <>
      <button
        onClick={() => {
          if (prompt) {
            prompt.prompt();
            setInstalled(true);
          } else if (isIOS) {
            setShowIOSGuide(true);
          }
        }}
        className="w-full glass rounded-2xl flex items-center gap-3 px-4 py-3.5 hover:bg-blue-500/5 transition-all border border-blue-500/15">
        <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
          <Icon name="Download" size={18} className="text-blue-400" />
        </div>
        <div className="flex-1 text-left">
          <div className="text-sm font-semibold text-foreground">Установить приложение</div>
          <div className="text-xs text-muted-foreground">
            {isIOS ? "Добавить на экран «Домой»" : "Работает без браузера"}
          </div>
        </div>
        <Icon name="ChevronRight" size={16} className="text-muted-foreground" />
      </button>

      {/* iOS guide modal */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 animate-fade-in"
          onClick={() => setShowIOSGuide(false)}>
          <div className="w-full max-w-md glass border border-white/10 rounded-3xl p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <img src="https://cdn.poehali.dev/projects/84792fb2-1985-42c4-8056-a4e27799a11a/files/8f6169f2-71c4-4f34-8ad2-ca3c377792eb.jpg"
                  className="w-10 h-10 rounded-2xl" alt="Каспер" />
                <div>
                  <p className="font-golos font-bold text-foreground">Установка на iPhone</p>
                  <p className="text-xs text-muted-foreground">Safari · iOS</p>
                </div>
              </div>
              <button onClick={() => setShowIOSGuide(false)} className="p-2 hover:bg-white/10 rounded-full">
                <Icon name="X" size={16} className="text-muted-foreground" />
              </button>
            </div>
            <div className="space-y-3">
              {[
                { n: "1", icon: "Share2", title: "Нажмите кнопку «Поделиться»", desc: "Кнопка в нижней панели Safari" },
                { n: "2", icon: "PlusSquare", title: "«На экран «Домой»»", desc: "Прокрутите список действий вниз" },
                { n: "3", icon: "Check", title: "Нажмите «Добавить»", desc: "Иконка появится на рабочем столе" },
              ].map(s => (
                <div key={s.n} className="flex items-center gap-3 p-3 rounded-2xl bg-white/4">
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 font-bold text-sm flex items-center justify-center flex-shrink-0">
                    {s.n}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{s.title}</p>
                    <p className="text-xs text-muted-foreground">{s.desc}</p>
                  </div>
                  <Icon name={s.icon} size={18} className="text-sky-400 flex-shrink-0" />
                </div>
              ))}
            </div>
            <div className="flex justify-center mt-4">
              <Icon name="ArrowDown" size={16} className="text-muted-foreground animate-bounce" />
              <span className="text-xs text-muted-foreground ml-1">Кнопка Share внизу экрана</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SettingsTab({ onLogout, onTestSound }: { onLogout: () => void; onTestSound: () => void }) {
  const [section, setSection] = useState<SettingsSection>("main");
  const [dark, setDark] = useState(() => localStorage.getItem("pulse_theme") !== "light");
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>("Notification" in window ? Notification.permission : "denied");

  // Chat settings
  const [enterSend, setEnterSend] = useState(() => localStorage.getItem("s_enter_send") !== "0");
  const [bubbleStyle, setBubbleStyle] = useState(() => localStorage.getItem("s_bubble") || "modern");
  const [fontSize, setFontSize] = useState(() => localStorage.getItem("s_fontsize") || "medium");

  // Privacy
  const [showPhone, setShowPhone] = useState(() => localStorage.getItem("s_show_phone") !== "0");
  const [showOnline, setShowOnline] = useState(() => localStorage.getItem("s_show_online") !== "0");
  const [readReceipts, setReadReceipts] = useState(() => localStorage.getItem("s_read_receipts") !== "0");

  // Notifications
  const [msgSound, setMsgSound] = useState(() => localStorage.getItem("s_msg_sound") !== "0");
  const [groupNotif, setGroupNotif] = useState(() => localStorage.getItem("s_group_notif") !== "0");
  const [callNotif, setCallNotif] = useState(() => localStorage.getItem("s_call_notif") !== "0");
  const [preview, setPreview] = useState(() => localStorage.getItem("s_preview") !== "0");

  // Data
  const [autoDownload, setAutoDownload] = useState(() => localStorage.getItem("s_auto_download") !== "0");
  const [dataSaver, setDataSaver] = useState(() => localStorage.getItem("s_data_saver") === "1");

  // Folders
  const [folders] = useState([
    { id: 1, name: "Личные", icon: "User", count: 3 },
    { id: 2, name: "Работа", icon: "Briefcase", count: 5 },
    { id: 3, name: "Каналы", icon: "Radio", count: 2 },
  ]);

  function save(key: string, val: boolean | string) {
    localStorage.setItem(key, typeof val === "boolean" ? (val ? "1" : "0") : val);
  }

  function toggleDark(val: boolean) { setDark(val); applyTheme(val); }

  async function requestNotifPermission() {
    if (!("Notification" in window)) return;
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
    if (perm === "granted") new Notification("Каспер", { body: "Уведомления включены!", icon: "/favicon.svg" });
  }

  if (section !== "main") {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <button onClick={() => setSection("main")} className="p-2 -ml-2 hover:bg-white/10 rounded-full transition-colors">
            <Icon name="ArrowLeft" size={20} className="text-foreground" />
          </button>
          <h1 className="text-xl font-golos font-black text-foreground">
            {section === "chats" ? "Настройки чатов" : section === "privacy" ? "Конфиденциальность" :
             section === "notifications" ? "Уведомления" : section === "data" ? "Данные и память" :
             section === "folders" ? "Папки с чатами" : section === "devices" ? "Устройства" :
             section === "language" ? "Язык" : "Политика конфиденциальности"}
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto scroll-container px-4 pb-6 space-y-4">

          {section === "chats" && (
            <>
              <div className="glass rounded-3xl overflow-hidden">
                <SettingsRow icon="CornerDownLeft" iconBg="bg-blue-500/20" label="Enter — отправить" desc="Отправка по Enter, перенос строки — Shift+Enter"
                  right={<Toggle value={enterSend} onChange={v => { setEnterSend(v); save("s_enter_send", v); }} />} noBorder />
              </div>

              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 px-1">Стиль пузырей</div>
                <div className="glass rounded-3xl overflow-hidden">
                  {[["modern", "Современный", "Скруглённые углы"], ["classic", "Классический", "Прямоугольные"], ["minimal", "Минимальный", "Без фона"]].map(([val, label, desc], i, arr) => (
                    <button key={val} onClick={() => { setBubbleStyle(val); save("s_bubble", val); }}
                      className={`flex items-center gap-3 px-4 py-3 w-full hover:bg-white/5 transition-all ${i < arr.length - 1 ? "border-b border-white/5" : ""}`}>
                      <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${bubbleStyle === val ? "border-blue-500 bg-blue-500" : "border-muted-foreground"}`} />
                      <div className="flex-1 text-left">
                        <div className="text-sm font-medium text-foreground">{label}</div>
                        <div className="text-xs text-muted-foreground">{desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 px-1">Размер шрифта</div>
                <div className="glass rounded-3xl overflow-hidden">
                  {[["small", "Маленький"], ["medium", "Средний"], ["large", "Крупный"]].map(([val, label], i, arr) => (
                    <button key={val} onClick={() => { setFontSize(val); save("s_fontsize", val); }}
                      className={`flex items-center gap-3 px-4 py-3 w-full hover:bg-white/5 transition-all ${i < arr.length - 1 ? "border-b border-white/5" : ""}`}>
                      <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${fontSize === val ? "border-blue-500 bg-blue-500" : "border-muted-foreground"}`} />
                      <span className="text-sm font-medium text-foreground">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 px-1">Оформление</div>
                <div className="glass rounded-3xl overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <div className="w-9 h-9 rounded-xl bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                      <Icon name={dark ? "Moon" : "Sun"} size={16} className="text-indigo-400" />
                    </div>
                    <span className="flex-1 text-sm font-medium text-foreground">{dark ? "Тёмная тема" : "Светлая тема"}</span>
                    <Toggle value={dark} onChange={toggleDark} />
                  </div>
                </div>
              </div>
            </>
          )}

          {section === "privacy" && (
            <>
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 px-1">Кто видит мои данные</div>
                <div className="glass rounded-3xl overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/5">
                    <div className="w-9 h-9 rounded-xl bg-sky-500/20 flex items-center justify-center flex-shrink-0">
                      <Icon name="Phone" size={16} className="text-sky-400" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">Номер телефона</div>
                      <div className="text-xs text-muted-foreground">Показывать контактам</div>
                    </div>
                    <Toggle value={showPhone} onChange={v => { setShowPhone(v); save("s_show_phone", v); }} />
                  </div>
                  <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/5">
                    <div className="w-9 h-9 rounded-xl bg-green-500/20 flex items-center justify-center flex-shrink-0">
                      <Icon name="Activity" size={16} className="text-green-400" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">Статус «онлайн»</div>
                      <div className="text-xs text-muted-foreground">Показывать, когда вы в сети</div>
                    </div>
                    <Toggle value={showOnline} onChange={v => { setShowOnline(v); save("s_show_online", v); }} />
                  </div>
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <div className="w-9 h-9 rounded-xl bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                      <Icon name="CheckCheck" size={16} className="text-cyan-400" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">Уведомления о прочтении</div>
                      <div className="text-xs text-muted-foreground">Двойная галочка при прочтении</div>
                    </div>
                    <Toggle value={readReceipts} onChange={v => { setReadReceipts(v); save("s_read_receipts", v); }} />
                  </div>
                </div>
              </div>

              <div className="glass rounded-3xl p-4 border border-amber-500/10">
                <div className="flex items-start gap-3">
                  <Icon name="Info" size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-muted-foreground leading-relaxed">Настройки конфиденциальности применяются к вашему аккаунту и влияют на то, что видят другие пользователи.</p>
                </div>
              </div>
            </>
          )}

          {section === "notifications" && (
            <>
              <div className="glass rounded-3xl p-4 flex items-center gap-3 mb-2">
                <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 ${notifPerm === "granted" ? "bg-green-500/10 border-green-500/20" : "bg-amber-500/10 border-amber-500/20"}`}>
                  <Icon name={notifPerm === "granted" ? "BellRing" : "Bell"} size={16} className={notifPerm === "granted" ? "text-green-400" : "text-amber-400"} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">{notifPerm === "granted" ? "Уведомления активны" : "Разрешить уведомления"}</div>
                  <div className="text-xs text-muted-foreground">{notifPerm === "granted" ? "Браузерные push-уведомления включены" : "Нажмите, чтобы разрешить"}</div>
                </div>
                {notifPerm === "default" && (
                  <button onClick={requestNotifPermission} className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-white text-xs font-semibold">Включить</button>
                )}
                {notifPerm === "granted" && (
                  <button onClick={onTestSound} className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-green-500/15 border border-green-500/20 text-green-400 text-xs font-semibold flex items-center gap-1">
                    <Icon name="Volume2" size={12} />Тест
                  </button>
                )}
              </div>

              <div className="glass rounded-3xl overflow-hidden">
                {[
                  { icon: "MessageCircle", bg: "bg-blue-500/20", label: "Звук сообщений", val: msgSound, set: (v: boolean) => { setMsgSound(v); save("s_msg_sound", v); }, color: "text-blue-400" },
                  { icon: "Users", bg: "bg-purple-500/20", label: "Уведомления групп", val: groupNotif, set: (v: boolean) => { setGroupNotif(v); save("s_group_notif", v); }, color: "text-purple-400" },
                  { icon: "Phone", bg: "bg-green-500/20", label: "Уведомления о звонках", val: callNotif, set: (v: boolean) => { setCallNotif(v); save("s_call_notif", v); }, color: "text-green-400" },
                  { icon: "Eye", bg: "bg-cyan-500/20", label: "Предпросмотр сообщений", val: preview, set: (v: boolean) => { setPreview(v); save("s_preview", v); }, color: "text-cyan-400" },
                ].map(({ icon, bg, label, val, set, color }, i, arr) => (
                  <div key={label} className={`flex items-center gap-3 px-4 py-3.5 ${i < arr.length - 1 ? "border-b border-white/5" : ""}`}>
                    <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
                      <Icon name={icon as Parameters<typeof Icon>[0]["name"]} size={16} className={color} />
                    </div>
                    <span className="flex-1 text-sm font-medium text-foreground">{label}</span>
                    <Toggle value={val} onChange={set} />
                  </div>
                ))}
              </div>
            </>
          )}

          {section === "data" && (
            <>
              <div className="glass rounded-3xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/5">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                    <Icon name="Download" size={16} className="text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-foreground">Авто-загрузка медиа</div>
                    <div className="text-xs text-muted-foreground">Загружать фото и видео автоматически</div>
                  </div>
                  <Toggle value={autoDownload} onChange={v => { setAutoDownload(v); save("s_auto_download", v); }} />
                </div>
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                    <Icon name="Wifi" size={16} className="text-amber-400" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-foreground">Экономия трафика</div>
                    <div className="text-xs text-muted-foreground">Уменьшить качество медиа</div>
                  </div>
                  <Toggle value={dataSaver} onChange={v => { setDataSaver(v); save("s_data_saver", v); }} />
                </div>
              </div>

              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 px-1">Кэш и хранилище</div>
                <div className="glass rounded-3xl p-4 space-y-3">
                  {[["Кэш чатов", "~2.4 МБ"], ["Медиафайлы", "~18 МБ"], ["Голосовые", "~1.1 МБ"]].map(([label, size]) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-sm text-foreground">{label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{size}</span>
                        <button className="text-xs text-sky-400 hover:text-sky-300 font-medium px-2 py-0.5 rounded-lg hover:bg-sky-500/10 transition-all">Очистить</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {section === "folders" && (
            <>
              <div className="glass rounded-3xl overflow-hidden">
                {folders.map((f, i) => (
                  <div key={f.id} className={`flex items-center gap-3 px-4 py-3.5 ${i < folders.length - 1 ? "border-b border-white/5" : ""}`}>
                    <div className="w-9 h-9 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                      <Icon name={f.icon as Parameters<typeof Icon>[0]["name"]} size={16} className="text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">{f.name}</div>
                      <div className="text-xs text-muted-foreground">{f.count} чатов</div>
                    </div>
                    <Icon name="ChevronRight" size={15} className="text-muted-foreground" />
                  </div>
                ))}
              </div>

              <button className="w-full glass rounded-3xl p-4 flex items-center gap-3 hover:bg-white/5 transition-all border border-dashed border-white/10">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                  <Icon name="Plus" size={16} className="text-emerald-400" />
                </div>
                <span className="text-sm font-medium text-foreground">Создать папку</span>
              </button>

              <div className="glass rounded-3xl p-4 border border-blue-500/10">
                <p className="text-xs text-muted-foreground leading-relaxed">Папки помогают организовать чаты по категориям. Перетащите чаты в папку в разделе «Чаты».</p>
              </div>
            </>
          )}

          {section === "devices" && (
            <div className="space-y-3">
              <div className="glass rounded-3xl overflow-hidden">
                <div className="px-4 py-3.5 border-b border-white/5">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-green-500/20 flex items-center justify-center flex-shrink-0">
                      <Icon name="Monitor" size={16} className="text-green-400" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">Это устройство</div>
                      <div className="text-xs text-muted-foreground">Активна сейчас · Веб-браузер</div>
                    </div>
                    <div className="w-2 h-2 rounded-full bg-green-400" />
                  </div>
                </div>
                <div className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                      <Icon name="Smartphone" size={16} className="text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">Мобильное устройство</div>
                      <div className="text-xs text-muted-foreground">Последняя активность: сегодня</div>
                    </div>
                    <button className="text-xs text-red-400 hover:text-red-300 font-medium px-2 py-0.5 rounded-lg hover:bg-red-500/10 transition-all">Выйти</button>
                  </div>
                </div>
              </div>
              <button className="w-full glass rounded-3xl p-4 flex items-center gap-3 justify-center hover:bg-red-500/5 transition-all border border-red-500/10">
                <Icon name="LogOut" size={16} className="text-red-400" />
                <span className="text-sm font-medium text-red-400">Завершить все сеансы</span>
              </button>
            </div>
          )}

          {section === "language" && (
            <div className="glass rounded-3xl overflow-hidden">
              {[["ru", "Русский", "Текущий"], ["en", "English", ""], ["uk", "Українська", ""], ["kk", "Қазақша", ""]].map(([code, label, hint], i, arr) => (
                <button key={code} className={`flex items-center gap-3 px-4 py-3.5 w-full hover:bg-white/5 transition-all ${i < arr.length - 1 ? "border-b border-white/5" : ""}`}>
                  <div className="w-9 h-9 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-blue-400">{code.toUpperCase()}</span>
                  </div>
                  <span className="flex-1 text-left text-sm font-medium text-foreground">{label}</span>
                  {hint && <span className="text-xs text-sky-400">{hint}</span>}
                  {code === "ru" && <Icon name="Check" size={15} className="text-sky-400" />}
                </button>
              ))}
            </div>
          )}

          {section === "policy" && (
            <div className="space-y-4 pb-4">

              {/* Вводный блок */}
              <div className="glass rounded-3xl p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                    <Icon name="Shield" size={18} className="text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-golos font-bold text-foreground text-base">Политика конфиденциальности</h3>
                    <p className="text-xs text-muted-foreground">Версия 1.0 · Дата вступления в силу: 23 марта 2026 г.</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Настоящая Политика конфиденциальности описывает, какие данные собирает мессенджер <strong className="text-foreground">Каспер</strong>, как они используются и защищаются, а также ваши права в отношении персональных данных.
                </p>
              </div>

              {/* 1. Какие данные собираем */}
              <div className="glass rounded-3xl p-5 space-y-3">
                <h4 className="font-golos font-bold text-foreground flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-400 text-xs flex items-center justify-center font-bold">1</span>
                  Данные, которые мы собираем
                </h4>
                {[
                  { icon: "Phone", label: "Контактные данные", desc: "Номер телефона или адрес электронной почты, использованные при регистрации." },
                  { icon: "User", label: "Данные профиля", desc: "Имя, аватар и биография, которые вы добавляете самостоятельно." },
                  { icon: "MessageCircle", label: "Сообщения и медиафайлы", desc: "Текст, изображения, видео, документы и голосовые сообщения, отправленные через приложение." },
                  { icon: "Clock", label: "Технические данные", desc: "Время последней активности, IP-адрес для защиты от злоупотреблений, тип браузера." },
                ].map(item => (
                  <div key={item.label} className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-xl bg-white/5 border border-white/8 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon name={item.icon} size={13} className="text-sky-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* 2. Как используем */}
              <div className="glass rounded-3xl p-5 space-y-3">
                <h4 className="font-golos font-bold text-foreground flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-green-500/20 text-green-400 text-xs flex items-center justify-center font-bold">2</span>
                  Как мы используем данные
                </h4>
                {[
                  "Предоставление функций мессенджера: отправка и получение сообщений, звонки.",
                  "Идентификация и аутентификация пользователей через OTP-коды.",
                  "Обеспечение безопасности: защита от спама, несанкционированного доступа.",
                  "Улучшение качества сервиса на основе агрегированной статистики (без привязки к личности).",
                  "Отправка системных уведомлений о новых сообщениях.",
                ].map(item => (
                  <div key={item} className="flex items-start gap-2.5">
                    <Icon name="CheckCircle" size={14} className="text-green-400 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-muted-foreground leading-relaxed">{item}</p>
                  </div>
                ))}
              </div>

              {/* 3. Хранение и защита */}
              <div className="glass rounded-3xl p-5 space-y-3">
                <h4 className="font-golos font-bold text-foreground flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 text-xs flex items-center justify-center font-bold">3</span>
                  Хранение и защита
                </h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Все данные передаются по зашифрованному протоколу <strong className="text-foreground">HTTPS/TLS</strong>. Данные хранятся на серверах в защищённой инфраструктуре. Мы применяем отраслевые стандарты безопасности для предотвращения утечек.
                </p>
                <div className="flex flex-wrap gap-2 mt-1">
                  {["HTTPS/TLS", "Хешированные пароли", "Токены сессий", "OTP-авторизация"].map(tag => (
                    <span key={tag} className="px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-xs text-purple-300">{tag}</span>
                  ))}
                </div>
              </div>

              {/* 4. Передача третьим лицам */}
              <div className="glass rounded-3xl p-5 space-y-3">
                <h4 className="font-golos font-bold text-foreground flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-orange-500/20 text-orange-400 text-xs flex items-center justify-center font-bold">4</span>
                  Передача данных третьим лицам
                </h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Мы <strong className="text-foreground">не продаём и не передаём</strong> ваши персональные данные третьим лицам в коммерческих целях. Данные могут быть раскрыты только по законному требованию государственных органов.
                </p>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-green-500/8 border border-green-500/15">
                  <Icon name="ShieldCheck" size={14} className="text-green-400 flex-shrink-0" />
                  <span className="text-xs text-green-300">Без рекламных сетей. Без аналитики третьих лиц.</span>
                </div>
              </div>

              {/* 5. Ваши права */}
              <div className="glass rounded-3xl p-5 space-y-3">
                <h4 className="font-golos font-bold text-foreground flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs flex items-center justify-center font-bold">5</span>
                  Ваши права
                </h4>
                {[
                  { icon: "Eye", text: "Просмотр данных — запросите список данных, которые мы храним о вас." },
                  { icon: "Edit3", text: "Исправление — измените имя, аватар и биографию в профиле в любое время." },
                  { icon: "Trash2", text: "Удаление — удалите аккаунт и все данные через раздел «Профиль»." },
                  { icon: "Download", text: "Экспорт — обратитесь в поддержку для получения архива ваших данных." },
                ].map(item => (
                  <div key={item.text} className="flex items-start gap-2.5">
                    <Icon name={item.icon} size={14} className="text-cyan-400 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.text}</p>
                  </div>
                ))}
              </div>

              {/* 6. Cookie */}
              <div className="glass rounded-3xl p-5 space-y-2">
                <h4 className="font-golos font-bold text-foreground flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-yellow-500/20 text-yellow-400 text-xs flex items-center justify-center font-bold">6</span>
                  Локальное хранилище (localStorage)
                </h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Приложение использует <strong className="text-foreground">localStorage</strong> браузера для сохранения сессии, темы и настроек. Данные не покидают ваше устройство и могут быть удалены в настройках браузера.
                </p>
              </div>

              {/* 7. Контакт */}
              <div className="glass rounded-3xl p-5 space-y-2">
                <h4 className="font-golos font-bold text-foreground flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-slate-500/20 text-slate-400 text-xs flex items-center justify-center font-bold">7</span>
                  Обратная связь
                </h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  По вопросам обработки персональных данных обращайтесь через раздел поддержки в приложении. Мы ответим в течение 3 рабочих дней.
                </p>
              </div>

              <div className="text-center text-xs text-muted-foreground/60 py-2 space-y-1">
                <p>Политика конфиденциальности Каспер · Версия 1.0</p>
                <p>Дата вступления в силу: 23 марта 2026 г.</p>
              </div>
            </div>
          )}

        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto scroll-container">
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-2xl font-golos font-black text-gradient mb-1">Настройки</h1>
      </div>
      <div className="px-4 pb-6 space-y-2">

        {[
          { id: "chats", icon: "MessageCircle", bg: "bg-blue-500/20", iconColor: "text-blue-400", label: "Настройки чатов", desc: "Стиль, шрифт, Enter" },
          { id: "notifications", icon: "Bell", bg: "bg-purple-500/20", iconColor: "text-purple-400", label: "Уведомления", desc: "Звуки, предпросмотр" },
          { id: "privacy", icon: "Lock", bg: "bg-emerald-500/20", iconColor: "text-emerald-400", label: "Конфиденциальность", desc: "Кто видит ваши данные" },
          { id: "data", icon: "HardDrive", bg: "bg-orange-500/20", iconColor: "text-orange-400", label: "Данные и память", desc: "Кэш, авто-загрузка" },
          { id: "folders", icon: "FolderOpen", bg: "bg-yellow-500/20", iconColor: "text-yellow-400", label: "Папки с чатами", desc: "Организация чатов" },
          { id: "devices", icon: "Monitor", bg: "bg-cyan-500/20", iconColor: "text-cyan-400", label: "Устройства", desc: "Активные сеансы" },
          { id: "language", icon: "Globe", bg: "bg-sky-500/20", iconColor: "text-sky-400", label: "Язык", desc: "Русский" },
        ].map(({ id, icon, bg, iconColor, label, desc }, i, arr) => (
          <button key={id} onClick={() => setSection(id as SettingsSection)}
            className={`w-full glass rounded-2xl flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-all animate-fade-in`}
            style={{ animationDelay: `${i * 0.04}s` }}>
            <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon name={icon as Parameters<typeof Icon>[0]["name"]} size={18} className={iconColor} />
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm font-semibold text-foreground">{label}</div>
              <div className="text-xs text-muted-foreground">{desc}</div>
            </div>
            <Icon name="ChevronRight" size={16} className="text-muted-foreground" />
          </button>
        ))}

        <div className="pt-2">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 px-1">Оформление</div>
          <div className="glass rounded-2xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                <Icon name={dark ? "Moon" : "Sun"} size={18} className="text-indigo-400" />
              </div>
              <div className="flex-1 text-left">
                <div className="text-sm font-semibold text-foreground">{dark ? "Тёмная тема" : "Светлая тема"}</div>
                <div className="text-xs text-muted-foreground">Внешний вид приложения</div>
              </div>
              <Toggle value={dark} onChange={toggleDark} />
            </div>
          </div>
        </div>

        <div className="pt-2 space-y-2">
          {/* Установить приложение */}
          <InstallAppButton />

          <button onClick={() => setSection("policy")}
            className="w-full glass rounded-2xl flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-all">
            <div className="w-10 h-10 rounded-xl bg-slate-500/20 flex items-center justify-center flex-shrink-0">
              <Icon name="FileText" size={18} className="text-slate-400" />
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm font-semibold text-foreground">Политика конфиденциальности</div>
              <div className="text-xs text-muted-foreground">Версия 1.0.0</div>
            </div>
            <Icon name="ChevronRight" size={16} className="text-muted-foreground" />
          </button>
        </div>

        <div className="pt-2">
          <button onClick={onLogout}
            className="w-full glass rounded-2xl p-4 flex items-center gap-3 hover:bg-red-500/5 transition-all border border-red-500/10">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
              <Icon name="LogOut" size={18} className="text-red-400" />
            </div>
            <span className="text-sm font-semibold text-red-400">Выйти из аккаунта</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Onboarding Screen ────────────────────────────────────────────────────────

const ONBOARDING_KEY = "nash_dom_onboarded";

const ONBOARDING_SLIDES = [
  {
    icon: "MessageCircle",
    gradient: "from-blue-600 to-sky-500",
    glow: "rgba(0,119,182,0.5)",
    title: "Общайтесь свободно",
    desc: "Личные чаты и групповые беседы — всё в одном месте. Отправляйте сообщения, фото и файлы мгновенно.",
  },
  {
    icon: "Users",
    gradient: "from-sky-500 to-cyan-400",
    glow: "rgba(0,180,230,0.5)",
    title: "Сообщество соседей",
    desc: "Создавайте группы для своего дома, подъезда или двора. Решайте вопросы вместе быстро и удобно.",
  },
  {
    icon: "Shield",
    gradient: "from-blue-700 to-blue-500",
    glow: "rgba(26,58,107,0.6)",
    title: "Безопасно и надёжно",
    desc: "Пин-код защищает ваши переписки. Только вы решаете, кто видит ваш статус и профиль.",
  },
  {
    icon: "Bell",
    gradient: "from-cyan-500 to-sky-400",
    glow: "rgba(56,217,245,0.5)",
    title: "Всегда на связи",
    desc: "Уведомления о новых сообщениях, статус «онлайн» и индикаторы прочтения — ничего не пропустите.",
  },
];

function OnboardingScreen({ userName, onDone }: { userName: string; onDone: () => void }) {
  const [slide, setSlide] = useState(0);
  const total = ONBOARDING_SLIDES.length;
  const s = ONBOARDING_SLIDES[slide];
  const isLast = slide === total - 1;

  function next() {
    if (isLast) { onDone(); } else { setSlide(i => i + 1); }
  }

  return (
    <div className="flex flex-col h-[100dvh] max-w-md mx-auto overflow-hidden relative"
      style={{ background: "hsl(var(--background))" }}>

      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full opacity-10 blur-3xl transition-all duration-700"
          style={{ background: `radial-gradient(circle, ${s.glow}, transparent)` }} />
      </div>

      {/* Skip */}
      <div className="flex justify-end px-6 pt-6 relative z-10">
        {!isLast && (
          <button onClick={onDone} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Пропустить
          </button>
        )}
      </div>

      {/* Slides */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-8 relative z-10">

        {/* Icon */}
        <div key={slide} className={`w-28 h-28 rounded-3xl bg-gradient-to-br ${s.gradient} flex items-center justify-center animate-pop`}
          style={{ boxShadow: `0 0 60px ${s.glow}` }}>
          <Icon name={s.icon as Parameters<typeof Icon>[0]["name"]} size={52} className="text-white" />
        </div>

        {/* Text */}
        <div className="text-center space-y-3 animate-fade-in" key={`text-${slide}`}>
          <h2 className="text-2xl font-golos font-black text-foreground leading-tight">{s.title}</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">{s.desc}</p>
        </div>

        {/* Dots */}
        <div className="flex gap-2">
          {ONBOARDING_SLIDES.map((_, i) => (
            <button key={i} onClick={() => setSlide(i)}
              className={`rounded-full transition-all duration-300 ${i === slide ? "w-6 h-2 bg-sky-400" : "w-2 h-2 bg-white/20"}`} />
          ))}
        </div>
      </div>

      {/* Bottom */}
      <div className="px-6 pb-10 space-y-3 relative z-10">
        {isLast && (
          <div className="text-center animate-fade-in">
            <p className="text-lg font-golos font-bold text-foreground">Добро пожаловать, {userName}! 🏠</p>
            <p className="text-sm text-muted-foreground mt-1">Рады видеть вас в «Каспер»</p>
          </div>
        )}
        <button onClick={next}
          className={`w-full py-4 rounded-2xl font-golos font-bold text-white text-base transition-all active:scale-[0.98]
            bg-gradient-to-r from-blue-600 to-sky-500 hover:opacity-90`}
          style={{ boxShadow: "0 0 30px rgba(0,119,182,0.4)" }}>
          {isLast ? "Начать общение" : "Далее"}
        </button>
      </div>
    </div>
  );
}

// ─── Pin Screen ───────────────────────────────────────────────────────────────

const PIN_KEY = "pulse_pin";
const PIN_LOCKED_KEY = "pulse_pin_locked";

function PinScreen({ mode, onSuccess, onCancel }: {
  mode: "enter" | "setup" | "change";
  onSuccess: (pin: string) => void;
  onCancel?: () => void;
}) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [step, setStep] = useState<"enter" | "confirm">(mode === "setup" || mode === "change" ? "enter" : "enter");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);

  const isSetup = mode === "setup" || mode === "change";
  const title = mode === "enter" ? "Введите пин-код"
    : step === "enter" ? "Создайте пин-код"
    : "Повторите пин-код";
  const subtitle = mode === "enter" ? "Для входа в приложение"
    : step === "enter" ? "4 цифры для защиты"
    : "Подтвердите пин-код";

  function triggerShake() {
    setShake(true);
    setTimeout(() => setShake(false), 500);
    if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
  }

  function handleDigit(d: string) {
    setError("");
    const current = isSetup && step === "confirm" ? confirmPin : pin;
    if (current.length >= 4) return;
    const next = current + d;
    if (isSetup && step === "confirm") {
      setConfirmPin(next);
      if (next.length === 4) {
        if (next === pin) {
          onSuccess(next);
        } else {
          triggerShake();
          setError("Пин-коды не совпадают");
          setTimeout(() => setConfirmPin(""), 600);
        }
      }
    } else {
      setPin(next);
      if (next.length === 4) {
        if (isSetup) {
          setStep("confirm");
        } else {
          const saved = localStorage.getItem(PIN_KEY);
          if (next === saved) {
            onSuccess(next);
          } else {
            triggerShake();
            setError("Неверный пин-код");
            setTimeout(() => setPin(""), 600);
          }
        }
      }
    }
  }

  function handleDelete() {
    setError("");
    if (isSetup && step === "confirm") {
      setConfirmPin(p => p.slice(0, -1));
    } else {
      setPin(p => p.slice(0, -1));
    }
  }

  const displayPin = isSetup && step === "confirm" ? confirmPin : pin;

  return (
    <div className="flex flex-col h-[100dvh] max-w-md mx-auto items-center justify-center px-8 gap-8"
      style={{ background: "hsl(var(--background))" }}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow-[0_0_40px_rgba(0,119,182,0.4)]">
          <Icon name="Lock" size={28} className="text-white" />
        </div>
        <div className="text-center">
          <h2 className="font-golos font-bold text-xl text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
      </div>

      {/* Dots */}
      <div className={`flex gap-4 ${shake ? "animate-[shake_0.4s_ease-in-out]" : ""}`}>
        {[0,1,2,3].map(i => (
          <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all duration-150
            ${displayPin.length > i
              ? "bg-blue-500 border-blue-500 scale-110"
              : "border-white/30 bg-transparent"}`} />
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-400 -mt-4 animate-fade-in">{error}</p>
      )}

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-[280px]">
        {["1","2","3","4","5","6","7","8","9","","0","del"].map((key) => {
          if (key === "") return <div key="empty" />;
          return (
            <button key={key}
              onClick={() => key === "del" ? handleDelete() : handleDigit(key)}
              className={`h-16 rounded-2xl flex items-center justify-center transition-all active:scale-95
                ${key === "del"
                  ? "bg-transparent hover:bg-white/5 text-muted-foreground"
                  : "glass hover:bg-white/10 text-foreground font-semibold text-xl"}`}>
              {key === "del"
                ? <Icon name="Delete" size={22} className="text-muted-foreground" />
                : key}
            </button>
          );
        })}
      </div>

      {onCancel && (
        <button onClick={onCancel}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          Отмена
        </button>
      )}
      {mode === "enter" && (
        <button onClick={() => {
          localStorage.removeItem(PIN_KEY);
          localStorage.removeItem(PIN_LOCKED_KEY);
          onSuccess("");
        }} className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">
          Забыл пин-код · сбросить
        </button>
      )}
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  useEffect(() => { applyTheme(localStorage.getItem("pulse_theme") !== "light"); }, []);

  // PWA install prompt (Android Chrome)
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [swReady, setSwReady] = useState(false);

  // ── Регистрируем SW сразу при загрузке (до авторизации) ──
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js")
      .then(reg => {
        setSwReady(true);
        // Слушаем сообщение SYNC_REQUIRED от SW
        navigator.serviceWorker.addEventListener("message", (e) => {
          if (e.data?.type === "SYNC_REQUIRED") {
            window.dispatchEvent(new CustomEvent("kasper:sync"));
          }
        });
        // Проверяем обновление каждые 60 сек
        setInterval(() => reg.update().catch(() => {}), 60_000);
      })
      .catch(() => {}); // Ошибка регистрации SW — не критично
  }, []);

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e); setShowInstallBanner(true); };
    window.addEventListener("beforeinstallprompt", handler);
    // На iOS нет beforeinstallprompt — показываем баннер через 3 сек если iOS Safari
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isInStandalone = ("standalone" in navigator) && (navigator as { standalone?: boolean }).standalone;
    const shownBefore = localStorage.getItem("kasper_install_shown");
    if (isIOS && !isInStandalone && !shownBefore) {
      setTimeout(() => setShowInstallBanner(true), 3000);
    }
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const [token, setToken] = useState<string | null>(() => localStorage.getItem("pulse_token"));
  const [user, setUser] = useState<User | null>(() => {
    const u = localStorage.getItem("pulse_user");
    return u ? JSON.parse(u) : null;
  });
  const [tab, setTab] = useState<Tab>("chats");
  const [chatsForBadge, setChatsForBadge] = useState<{ unread: number }[]>([]);
  const [authChecked, setAuthChecked] = useState(false);
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const prevUnreadRef = useRef<Record<number, number>>();
  prevUnreadRef.current = prevUnreadRef.current ?? {};
  const [activeCall, setActiveCall] = useState<CallSession | null>(null);
  const [incomingCall, setIncomingCall] = useState<CallSession | null>(null);
  const [pendingOpenChatId, setPendingOpenChatId] = useState<number | null>(null);

  useEffect(() => {
    if (!token) { setAuthChecked(true); return; }
    fetch(AUTH_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "me" }) })
      .then(r => r.json())
      .then(data => {
        if (data.user) {
          setUser(data.user);
          localStorage.setItem("pulse_user", JSON.stringify(data.user));
        } else {
          setToken(null); setUser(null);
          localStorage.removeItem("pulse_token"); localStorage.removeItem("pulse_user");
        }
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);

  // Подписка на Push-уведомления (после логина + после регистрации SW)
  useEffect(() => {
    if (!token || !swReady || !("PushManager" in window)) return;

    async function setupPush() {
      try {
        const perm = Notification.permission === "default"
          ? await Notification.requestPermission()
          : Notification.permission;
        if (perm !== "granted") return;

        const reg = await navigator.serviceWorker.ready;
        const keyRes = await fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "vapid-public-key" }) });
        const keyData = await keyRes.json();
        if (!keyData.public_key) return;

        const existing = await reg.pushManager.getSubscription();
        const sub = existing ?? await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyData.public_key,
        });

        await fetch(CHATS_URL, {
          method: "POST",
          headers: apiHeaders(token),
          body: JSON.stringify({ action: "subscribe", ...sub.toJSON() }),
        });
      } catch { /* push not supported or blocked */ }
    }

    setupPush();
  }, [token, swReady]);

  const playSound = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      // Two-tone pop: short high note → short low note
      const notes = [
        { freq: 880, start: 0,    dur: 0.08, gain: 0.18 },
        { freq: 660, start: 0.09, dur: 0.12, gain: 0.12 },
      ];
      notes.forEach(({ freq, start, dur, gain }) => {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        env.gain.setValueAtTime(0, ctx.currentTime + start);
        env.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
        env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
        osc.connect(env);
        env.connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur + 0.01);
      });
      setTimeout(() => ctx.close(), 500);
    } catch { /* ignore */ }
  }, []);

  const showNotification = useCallback((title: string, body: string) => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return;
    try {
      new Notification(title, {
        body,
        icon: "/favicon.svg",
        tag: "pulse-message",
        silent: false,
      });
    } catch { /* ignore */ }
  }, []);

  const refreshBadge = useCallback(() => {
    if (!token) return;
    fetch(CHATS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "chats" }) })
      .then(r => r.json())
      .then(d => {
        if (!d.chats) return;
        const newChats: Chat[] = d.chats;
        setChatsForBadge(newChats);

        // Compare with previous unread counts — fire notification for newly arrived messages
        newChats.forEach(c => {
          const prev = prevUnreadRef.current[c.id] ?? c.unread;
          if (c.unread > prev) {
            playSound();
            showNotification(`💬 ${c.name}`, c.last_msg || "Новое сообщение");
          }
          prevUnreadRef.current[c.id] = c.unread;
        });
      })
      .catch(() => {});
  }, [token, showNotification, playSound]);

  useEffect(() => { refreshBadge(); }, [refreshBadge, tab]);

  // Poll badge every 5s
  useEffect(() => {
    const id = setInterval(refreshBadge, 5000);
    return () => clearInterval(id);
  }, [refreshBadge]);

  function handleAuth(newToken: string, newUser: User, isNew = false) {
    setToken(newToken); setUser(newUser);
    localStorage.setItem("pulse_token", newToken);
    localStorage.setItem("pulse_user", JSON.stringify(newUser));
    if (isNew && !localStorage.getItem(ONBOARDING_KEY)) {
      setShowOnboarding(true);
    }
  }

  async function handleLogout() {
    if (token) fetch(AUTH_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "logout" }) }).catch(() => {});
    setToken(null); setUser(null);
    localStorage.removeItem("pulse_token"); localStorage.removeItem("pulse_user");
    setTab("chats");
  }

  async function openChatWith(userId: number) {
    if (!token) return;
    const res = await fetch(CHATS_URL, {
      method: "POST", headers: apiHeaders(token),
      body: JSON.stringify({ action: "create", is_group: false, members: [userId] }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (data?.chat_id) {
      setPendingOpenChatId(data.chat_id);
      setTab("chats");
      // Небольшой delay чтобы ChatsTab успел подгрузить чаты
      setTimeout(() => setPendingOpenChatId(data.chat_id), 300);
    }
  }

  async function startCall(calleeId: number, calleeName: string, isVideo = false) {
    if (!token) return;
    const res = await fetch(CALLS_URL, {
      method: "POST", headers: apiHeaders(token),
      body: JSON.stringify({ action: "initiate", callee_id: calleeId, is_video: isVideo }),
    });
    const data = await res.json();
    if (data.call_id) {
      setActiveCall({ callId: data.call_id, peerId: calleeId, peerName: calleeName, direction: "outgoing", status: "ringing", isVideo });
      setIncomingCall(null);
    }
  }

  async function acceptCall(session: CallSession) {
    if (!token) return;
    await fetch(CALLS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "answer", call_id: session.callId }) });
    setActiveCall({ ...session, status: "ringing" });
    setIncomingCall(null);
  }

  async function declineCall(session: CallSession) {
    if (!token) return;
    await fetch(CALLS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "decline", call_id: session.callId }) });
    setIncomingCall(null);
  }

  useEffect(() => {
    if (!token || !user) return;
    const poll = setInterval(async () => {
      if (activeCall) return;
      const res = await fetch(CALLS_URL, { method: "POST", headers: apiHeaders(token), body: JSON.stringify({ action: "incoming" }) }).catch(() => null);
      if (!res) return;
      const data = await res.json();
      if (data.call) {
        setIncomingCall({ callId: data.call.id, peerId: data.call.caller_id, peerName: data.call.caller_name, peerAvatar: data.call.caller_avatar ?? null, direction: "incoming", status: "ringing", isVideo: !!data.call.is_video });
      } else {
        setIncomingCall(null);
      }
    }, 3000);
    return () => clearInterval(poll);
  }, [token, user, activeCall]);

  const unreadCount = chatsForBadge.reduce((a, c) => a + (c.unread || 0), 0);

  if (!authChecked) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: "hsl(var(--background))" }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow-[0_0_40px_rgba(0,119,182,0.5)]">
            <Icon name="House" size={28} className="text-white" />
          </div>
          <div className="w-6 h-6 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!token || !user) {
    return (
      <div className="flex items-center justify-center h-[100dvh]" style={{ background: "hsl(var(--background))" }}>
        <div className="w-full max-w-md h-full flex flex-col overflow-hidden">
          <AuthScreen onAuth={handleAuth} />
        </div>
      </div>
    );
  }

  const hasPin = !!localStorage.getItem(PIN_KEY);
  if (hasPin && !pinUnlocked) {
    return <PinScreen mode="enter" onSuccess={() => setPinUnlocked(true)} />;
  }

  if (showOnboarding && user) {
    return (
      <OnboardingScreen
        userName={user.name.split(" ")[0]}
        onDone={() => {
          localStorage.setItem(ONBOARDING_KEY, "1");
          setShowOnboarding(false);
        }}
      />
    );
  }

  const tabs: Record<Tab, React.ReactNode> = {
    chats: <ChatsTab token={token} currentUserId={user.id} onCall={startCall} openChatId={pendingOpenChatId} onChatOpened={() => setPendingOpenChatId(null)} onMessageRead={(chatId: number) => {
      setChatsForBadge(prev => prev.map(c =>
        c.id === chatId ? { ...c, unread: Math.max(0, c.unread - 1) } : c
      ));
    }} />,
    contacts: <ContactsTab token={token} onCall={startCall} onOpenChat={openChatWith} />,
    calls: <CallsTab token={token} onCall={startCall} />,
    status: <StatusTab user={user} />,
    profile: <ProfileTab user={user} token={token} onLogout={handleLogout} onUserUpdate={u => { setUser(u); localStorage.setItem("pulse_user", JSON.stringify(u)); }} onDeleteAccount={handleLogout} />,
    settings: <SettingsTab onLogout={handleLogout} onTestSound={playSound} />,
  };

  const NAV_ITEMS_DESKTOP = [
    { tab: "chats" as Tab, icon: "MessageCircle", label: "Чаты" },
    { tab: "contacts" as Tab, icon: "Users", label: "Контакты" },
    { tab: "calls" as Tab, icon: "Phone", label: "Звонки" },
    { tab: "status" as Tab, icon: "Circle", label: "Статус" },
    { tab: "profile" as Tab, icon: "User", label: "Профиль" },
    { tab: "settings" as Tab, icon: "Settings", label: "Настройки" },
  ];

  return (
    <div className="flex h-[100dvh] font-rubik overflow-hidden relative"
      style={{ background: "hsl(var(--background))" }}>

      {/* Декоративный фон */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full opacity-[0.04]"
          style={{ background: "radial-gradient(circle, #0077b6, transparent)" }} />
        <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full opacity-[0.04]"
          style={{ background: "radial-gradient(circle, #22d3ee, transparent)" }} />
      </div>

      {/* ── МОБИЛЬНЫЙ режим (< md) ── */}
      <div className="flex flex-col flex-1 overflow-hidden md:hidden">
        <div className="flex-1 overflow-hidden relative z-10">{tabs[tab]}</div>
        <BottomNav active={tab} onChange={setTab} unreadCount={unreadCount} />
      </div>

      {/* ── ДЕСКТОПНЫЙ режим (≥ md) ── */}
      <div className="hidden md:flex flex-1 overflow-hidden relative z-10">
        {/* Sidebar */}
        <div className="flex flex-col w-[72px] border-r border-white/5 flex-shrink-0"
          style={{ background: "hsl(var(--background))" }}>
          <div className="flex items-center justify-center h-16 border-b border-white/5 flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center shadow-[0_0_20px_rgba(0,119,182,0.4)]">
              <span className="text-white font-golos font-black text-sm">К</span>
            </div>
          </div>
          <nav className="flex flex-col items-center gap-1 py-3 flex-1">
            {NAV_ITEMS_DESKTOP.map(({ tab: t, icon, label }) => (
              <button key={t} onClick={() => setTab(t)}
                title={label}
                className={`relative w-12 h-12 rounded-2xl flex items-center justify-center transition-all
                  ${tab === t
                    ? "bg-gradient-to-br from-blue-600 to-blue-700 shadow-[0_0_16px_rgba(0,119,182,0.5)]"
                    : "hover:bg-white/8 text-muted-foreground hover:text-foreground"}`}>
                <Icon name={icon} size={20} className={tab === t ? "text-white" : ""} />
                {t === "chats" && unreadCount > 0 && tab !== "chats" && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
          {/* Аватар внизу */}
          <div className="flex items-center justify-center pb-4 flex-shrink-0">
            <button onClick={() => setTab("profile")} title={user.name}
              className="w-10 h-10 rounded-full overflow-hidden ring-2 ring-white/10 hover:ring-sky-500/50 transition-all">
              {user.avatar_url
                ? <img src={user.avatar_url} className="w-full h-full object-cover" alt={user.name} />
                : <div className="w-full h-full bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center text-white font-bold text-sm font-golos">
                    {user.name[0]}
                  </div>}
            </button>
          </div>
        </div>

        {/* Контент */}
        <div className="flex-1 overflow-hidden max-w-2xl">
          {tabs[tab]}
        </div>

        {/* Правая декоративная панель на очень широких экранах */}
        <div className="hidden xl:flex flex-1 items-center justify-center border-l border-white/5"
          style={{ background: "hsl(220 55% 6%)" }}>
          <div className="flex flex-col items-center gap-4 text-center px-8">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-600/20 to-cyan-500/10 border border-white/5 flex items-center justify-center">
              <Icon name="MessageCircle" size={36} className="text-blue-400/50" />
            </div>
            <p className="text-muted-foreground/50 text-sm leading-relaxed max-w-xs">
              Выберите чат слева, чтобы начать общение
            </p>
          </div>
        </div>
      </div>

      {/* Всплывающие элементы (звонки, баннеры) */}
      {incomingCall && !activeCall && (
        <IncomingCallBanner
          session={incomingCall}
          onAccept={() => acceptCall(incomingCall)}
          onDecline={() => declineCall(incomingCall)}
        />
      )}
      {activeCall && (
        <CallScreen session={activeCall} token={token} onEnd={() => setActiveCall(null)} />
      )}
      {/* ── Install banner (Android/Chrome) ── */}
      {showInstallBanner && installPrompt && (
        <div className="fixed bottom-20 md:bottom-4 left-4 right-4 z-50 animate-fade-in" style={{ maxWidth: 480, margin: "0 auto" }}>
          <div className="glass border border-white/15 rounded-3xl p-4 shadow-2xl flex items-center gap-3"
            style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)" }}>
            <div className="w-12 h-12 rounded-2xl overflow-hidden flex-shrink-0 ring-2 ring-white/10">
              <img src="https://cdn.poehali.dev/projects/84792fb2-1985-42c4-8056-a4e27799a11a/files/8f6169f2-71c4-4f34-8ad2-ca3c377792eb.jpg"
                className="w-full h-full object-cover" alt="Каспер" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-golos font-bold text-foreground text-sm">Установить Каспер</p>
              <p className="text-xs text-muted-foreground">Работает как приложение, без браузера</p>
            </div>
            <button onClick={() => {
              localStorage.setItem("kasper_install_shown", "1");
              (installPrompt as { prompt: () => void }).prompt();
              setShowInstallBanner(false);
            }} className="px-4 py-2 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm font-semibold hover:opacity-90 transition-all shadow-[0_0_20px_rgba(0,119,182,0.4)] flex-shrink-0">
              Установить
            </button>
            <button onClick={() => { localStorage.setItem("kasper_install_shown", "1"); setShowInstallBanner(false); }}
              className="p-1.5 hover:bg-white/10 rounded-full transition-colors flex-shrink-0">
              <Icon name="X" size={16} className="text-muted-foreground" />
            </button>
          </div>
        </div>
      )}

      {/* ── Install banner iOS (Safari) ── */}
      {showInstallBanner && !installPrompt && (
        <div className="fixed bottom-20 left-4 right-4 z-50 animate-fade-in" style={{ maxWidth: 480, margin: "0 auto" }}>
          <div className="glass border border-white/15 rounded-3xl p-4 shadow-2xl"
            style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.6)" }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-2xl overflow-hidden flex-shrink-0 ring-2 ring-white/10">
                <img src="https://cdn.poehali.dev/projects/84792fb2-1985-42c4-8056-a4e27799a11a/files/8f6169f2-71c4-4f34-8ad2-ca3c377792eb.jpg"
                  className="w-full h-full object-cover" alt="Каспер" />
              </div>
              <div className="flex-1">
                <p className="font-golos font-bold text-foreground text-sm">Добавить на экран «Домой»</p>
                <p className="text-xs text-muted-foreground">Установить как приложение на iPhone/iPad</p>
              </div>
              <button onClick={() => { localStorage.setItem("kasper_install_shown", "1"); setShowInstallBanner(false); }}
                className="p-1.5 hover:bg-white/10 rounded-full transition-colors flex-shrink-0">
                <Icon name="X" size={16} className="text-muted-foreground" />
              </button>
            </div>
            <div className="space-y-2 pl-1">
              {[
                { n: "1", text: "Нажмите кнопку", icon: "Share" },
                { n: "2", text: "Выберите «На экран Домой»", icon: "Plus" },
                { n: "3", text: "Нажмите «Добавить»", icon: "Check" },
              ].map(s => (
                <div key={s.n} className="flex items-center gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-[11px] font-bold flex items-center justify-center flex-shrink-0">{s.n}</span>
                  <span className="text-xs text-muted-foreground flex-1">{s.text}</span>
                  <div className="w-6 h-6 rounded-lg bg-white/8 flex items-center justify-center flex-shrink-0">
                    <Icon name={s.icon} size={12} className="text-sky-400" />
                  </div>
                </div>
              ))}
            </div>
            {/* Стрелка вниз указывающая на кнопку поделиться Safari */}
            <div className="flex items-center justify-center mt-3 gap-1 text-xs text-muted-foreground/60">
              <Icon name="ArrowDown" size={12} />
              <span>Кнопка Share внизу браузера</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}