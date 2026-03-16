import { useState, useRef, useEffect, useCallback } from "react";
import Icon from "@/components/ui/icon";

// ─── API Config ───────────────────────────────────────────────────────────────

const AUTH_URL = "https://functions.poehali.dev/7f5e5202-ad61-4f31-8181-6393be10b3ed";
const CHATS_URL = "https://functions.poehali.dev/a33600bd-358e-45e6-a8d5-4e32707a3ef1";

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
  phone: string;
  bio?: string;
  status?: string;
}

interface Message {
  id: number | string;
  text: string;
  time: string;
  out: boolean;
  is_read: boolean;
  sender_name?: string;
}

interface Chat {
  id: number;
  name: string;
  last_msg: string;
  last_time: string | null;
  unread: number;
  is_group: boolean;
  my_role?: UserRole;
  member_count?: number;
  online?: boolean;
  pinned?: boolean;
}

// ─── Mock data for non-chat tabs ──────────────────────────────────────────────

const MOCK_CALLS = [
  { id: "1", name: "Анна Смирнова", type: "incoming" as const, callType: "video" as const, time: "сегодня", duration: "5:32" },
  { id: "2", name: "Антон Волков", type: "outgoing" as const, callType: "voice" as const, time: "вчера", duration: "2:10" },
  { id: "3", name: "Михаил Козлов", type: "missed" as const, callType: "voice" as const, time: "вс" },
];

const MOCK_STATUSES = [
  { id: "1", name: "Анна Смирнова", time: "5 мин", viewed: false, color: "from-violet-500 to-cyan-400", text: "Новый день — новые возможности! ✨" },
  { id: "2", name: "Антон Волков", time: "12 мин", viewed: false, color: "from-pink-500 to-orange-400", text: "На конференции по дизайну 🎨" },
  { id: "3", name: "Дарья Новикова", time: "1 ч", viewed: true, color: "from-green-400 to-cyan-500" },
];

// ─── Avatar helpers ───────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "from-violet-500 to-purple-600", "from-cyan-400 to-blue-500",
  "from-pink-400 to-rose-500", "from-green-400 to-emerald-500",
  "from-orange-400 to-amber-500", "from-indigo-500 to-blue-600",
];

function getAvatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h += name.charCodeAt(i);
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function AvatarEl({ name, size = "md", status }: {
  name: string; size?: "xs" | "sm" | "md" | "lg" | "xl"; status?: string;
}) {
  const sizes = { xs: "w-8 h-8 text-xs", sm: "w-10 h-10 text-xs", md: "w-12 h-12 text-sm", lg: "w-14 h-14 text-base", xl: "w-20 h-20 text-xl" };
  return (
    <div className="relative flex-shrink-0">
      <div className={`rounded-full bg-gradient-to-br ${getAvatarColor(name)} flex items-center justify-center font-golos font-bold text-white ${sizes[size]}`}>
        {name.slice(0, 2)}
      </div>
      {status && (
        <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background
          ${status === "online" ? "status-online" : status === "away" ? "status-away" : "status-offline"}`} />
      )}
    </div>
  );
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────

function AuthScreen({ onAuth }: { onAuth: (token: string, user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPass, setShowPass] = useState(false);

  async function submit() {
    setError("");
    if (!phone.trim() || !password) { setError("Заполните все поля"); return; }
    if (mode === "register" && !name.trim()) { setError("Введите имя"); return; }
    setLoading(true);
    try {
      const endpoint = mode === "register" ? "/register" : "/login";
      const body: Record<string, string> = { phone: phone.trim(), password };
      if (mode === "register") body.name = name.trim();
      const res = await fetch(AUTH_URL + endpoint, {
        method: "POST", headers: apiHeaders(), body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Ошибка"); return; }
      onAuth(data.token, data.user);
    } catch {
      setError("Ошибка сети. Попробуйте снова");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-full h-1/2"
          style={{ background: "radial-gradient(ellipse at 30% 20%, rgba(168,85,247,0.18) 0%, transparent 60%)" }} />
        <div className="absolute bottom-0 right-0 w-full h-1/2"
          style={{ background: "radial-gradient(ellipse at 70% 80%, rgba(34,211,238,0.1) 0%, transparent 60%)" }} />
        {[{ top: "8%", left: "15%", size: 60, delay: "0s", dur: "4s", c: 0 },
          { top: "20%", left: "72%", size: 40, delay: "1s", dur: "3.5s", c: 1 },
          { top: "60%", left: "5%", size: 30, delay: "0.5s", dur: "5s", c: 0 }].map((b, i) => (
          <div key={i} className="absolute rounded-full opacity-[0.07]"
            style={{ width: b.size, height: b.size, top: b.top, left: b.left,
              background: b.c === 0 ? "radial-gradient(circle, #a855f7, transparent)" : "radial-gradient(circle, #22d3ee, transparent)",
              animation: `float ${b.dur} ease-in-out infinite`, animationDelay: b.delay }} />
        ))}
      </div>

      <div className="relative z-10 flex flex-col justify-center flex-1 px-6 py-8">
        <div className="text-center mb-8 animate-fade-in">
          <div className="w-20 h-20 mx-auto mb-4 rounded-3xl bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shadow-[0_0_40px_rgba(168,85,247,0.5)]">
            <Icon name="Zap" size={36} className="text-white" />
          </div>
          <h1 className="text-3xl font-golos font-black text-gradient mb-1">Pulse</h1>
          <p className="text-muted-foreground text-sm">Мессенджер нового поколения</p>
        </div>

        <div className="glass rounded-2xl p-1 flex gap-1 mb-6 animate-fade-in" style={{ animationDelay: "0.05s" }}>
          {(["login", "register"] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setError(""); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200
                ${mode === m ? "bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-[0_0_20px_rgba(168,85,247,0.4)]" : "text-muted-foreground hover:text-foreground"}`}>
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
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Ваше имя"
                className="w-full bg-secondary/60 border border-white/10 rounded-2xl pl-11 pr-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-purple-500/50 focus:bg-secondary transition-all" />
            </div>
          )}
          <div className="relative">
            <div className="absolute left-4 top-1/2 -translate-y-1/2">
              <Icon name="Phone" size={16} className="text-muted-foreground" />
            </div>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+7 999 000-00-00" type="tel"
              className="w-full bg-secondary/60 border border-white/10 rounded-2xl pl-11 pr-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-purple-500/50 focus:bg-secondary transition-all" />
          </div>
          <div className="relative">
            <div className="absolute left-4 top-1/2 -translate-y-1/2">
              <Icon name="Lock" size={16} className="text-muted-foreground" />
            </div>
            <input value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              placeholder="Пароль" type={showPass ? "text" : "password"}
              className="w-full bg-secondary/60 border border-white/10 rounded-2xl pl-11 pr-12 py-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-purple-500/50 focus:bg-secondary transition-all" />
            <button onClick={() => setShowPass(!showPass)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              <Icon name={showPass ? "EyeOff" : "Eye"} size={16} />
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 animate-fade-in">
              <Icon name="AlertCircle" size={14} className="text-red-400 flex-shrink-0" />
              <span className="text-xs text-red-300">{error}</span>
            </div>
          )}

          <button onClick={submit} disabled={loading}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-golos font-semibold text-base hover:opacity-90 active:scale-[0.98] transition-all shadow-[0_0_30px_rgba(168,85,247,0.4)] disabled:opacity-60 disabled:cursor-not-allowed mt-2">
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {mode === "register" ? "Создаём аккаунт..." : "Входим..."}
              </span>
            ) : mode === "register" ? "Создать аккаунт" : "Войти"}
          </button>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6 animate-fade-in" style={{ animationDelay: "0.2s" }}>
          Продолжая, вы соглашаетесь с условиями использования
        </p>
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
    <nav className="flex-shrink-0 glass-strong border-t border-white/5 px-1 pb-1">
      <div className="flex items-center justify-around py-1.5">
        {NAV_ITEMS.map(({ tab, icon, label }) => {
          const isActive = active === tab;
          return (
            <button key={tab} onClick={() => onChange(tab)}
              className={`relative flex flex-col items-center gap-0.5 px-2 py-2 rounded-2xl transition-all duration-200 min-w-[48px]
                ${isActive ? "nav-item-active" : "hover:bg-white/5 active:scale-95"}`}>
              <div className="relative">
                <Icon name={icon} size={20} className={`transition-all ${isActive ? "text-purple-400" : "text-muted-foreground"}`} />
                {tab === "chats" && unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-gradient-to-br from-violet-500 to-pink-500 rounded-full text-[9px] text-white font-bold flex items-center justify-center">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </div>
              <span className={`text-[9px] font-medium ${isActive ? "text-purple-400" : "text-muted-foreground"}`}>{label}</span>
              {isActive && <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-purple-400" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─── Chat Screen ──────────────────────────────────────────────────────────────

function ChatScreen({ chat, token, currentUserId, onBack }: {
  chat: Chat; token: string; currentUserId: number; onBack: () => void;
}) {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [typists, setTypists] = useState<string[]>([]);
  const [showMembers, setShowMembers] = useState(false);
  const [members, setMembers] = useState<{ id: number; name: string; status: string; role: string; is_me: boolean }[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [leftGroup, setLeftGroup] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIdx, setSearchIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const msgRefs = useRef<Record<string | number, HTMLDivElement | null>>({});
  const endRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingSent = useRef(false);

  const isAtBottom = useRef(true);

  const loadMessages = useCallback(async (silent = false) => {
    try {
      const res = await fetch(`${CHATS_URL}/messages?chat_id=${chat.id}`, { headers: apiHeaders(token) });
      const data = await res.json();
      if (data.messages) setMessages(prev => {
        const prevIds = new Set(prev.map(m => String(m.id)));
        const hasNew = data.messages.some((m: Message) => !prevIds.has(String(m.id)));
        if (!silent || hasNew) return data.messages;
        return prev;
      });
    } finally { if (!silent) setLoading(false); }
  }, [chat.id, token]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  // Poll for new messages every 3s
  useEffect(() => {
    const id = setInterval(() => loadMessages(true), 3000);
    return () => clearInterval(id);
  }, [loadMessages]);

  // Poll typing status every 2s
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${CHATS_URL}/typing?chat_id=${chat.id}`, { headers: apiHeaders(token) });
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
    fetch(`${CHATS_URL}/typing`, {
      method: "POST", headers: apiHeaders(token),
      body: JSON.stringify({ chat_id: chat.id }),
    }).catch(() => {});
    // Reset flag after 3s so next keystroke fires again
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => { isTypingSent.current = false; }, 3000);
  }

  async function loadMembers() {
    if (!chat.is_group) return;
    setMembersLoading(true);
    try {
      const res = await fetch(`${CHATS_URL}/members?chat_id=${chat.id}`, { headers: apiHeaders(token) });
      const data = await res.json();
      if (data.members) setMembers(data.members);
    } finally { setMembersLoading(false); }
  }

  function toggleMembers() {
    if (!showMembers) loadMembers();
    setShowMembers(v => !v);
  }

  async function leaveGroup() {
    const ok = window.confirm(`Покинуть группу «${chat.name}»?`);
    if (!ok) return;
    await fetch(`${CHATS_URL}/leave`, {
      method: "POST", headers: apiHeaders(token),
      body: JSON.stringify({ chat_id: chat.id }),
    });
    setLeftGroup(true);
    setTimeout(() => onBack(), 800);
  }

  async function kickMember(memberId: number, memberName: string) {
    const ok = window.confirm(`Удалить ${memberName} из группы?`);
    if (!ok) return;
    await fetch(`${CHATS_URL}/kick`, {
      method: "POST", headers: apiHeaders(token),
      body: JSON.stringify({ chat_id: chat.id, user_id: memberId }),
    });
    setMembers(prev => prev.filter(m => m.id !== memberId));
    loadMessages(true);
  }

  const myRole = members.find(m => m.is_me)?.role ?? chat.my_role;

  // Scroll to bottom only when at bottom or new own message
  useEffect(() => {
    if (isAtBottom.current) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

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

  async function send() {
    if (!text.trim()) return;
    const optimistic: Message = {
      id: `opt-${Date.now()}`, text: text.trim(),
      time: new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }),
      out: true, is_read: false,
    };
    setMessages(prev => [...prev, optimistic]);
    const t = text.trim();
    setText("");
    try {
      const res = await fetch(`${CHATS_URL}/send`, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ chat_id: chat.id, text: t }),
      });
      const data = await res.json();
      if (data.message) {
        setMessages(prev => prev.map(m => m.id === optimistic.id ? { ...data.message, out: true } : m));
      }
    } catch { /* keep optimistic */ }
  }

  if (leftGroup) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 animate-fade-in">
        <div className="w-16 h-16 rounded-3xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
          <Icon name="LogOut" size={28} className="text-violet-400" />
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
            <AvatarEl name={chat.name} size="sm" status={!chat.is_group ? "online" : undefined} />
            <div className="flex-1 min-w-0 text-left">
              <div className="font-golos font-semibold text-foreground text-sm truncate">{chat.name}</div>
              <div className="text-xs text-muted-foreground">
                {chat.is_group ? `${chat.member_count ?? 0} участников · нажмите для управления` : "в сети"}
              </div>
            </div>
          </button>
          {chat.is_group && (
            <button onClick={toggleMembers}
              className={`p-2 rounded-full transition-colors ${showMembers ? "bg-violet-500/20 text-purple-400" : "hover:bg-white/10 text-muted-foreground"}`}>
              <Icon name="Users" size={18} />
            </button>
          )}
          <button onClick={openSearch}
            className={`p-2 rounded-full transition-colors ${searchOpen ? "bg-violet-500/20 text-purple-400" : "hover:bg-white/10 text-muted-foreground"}`}>
            <Icon name="Search" size={18} />
          </button>
          {!chat.is_group && (
            <>
              <button className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <Icon name="Video" size={18} className="text-cyan-400" />
              </button>
              <button className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <Icon name="Phone" size={18} className="text-cyan-400" />
              </button>
            </>
          )}
        </div>

        {/* Members panel */}
        {chat.is_group && showMembers && (
          <div className="mt-3 animate-fade-in">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-purple-400 uppercase tracking-wide">Участники</span>
              <button onClick={leaveGroup}
                className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10">
                <Icon name="LogOut" size={12} />
                Покинуть
              </button>
            </div>
            {membersLoading ? (
              <div className="flex justify-center py-3">
                <div className="w-5 h-5 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {members.map(m => {
                  const roleColors: Record<string, string> = {
                    admin: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
                    moderator: "text-cyan-400 bg-cyan-400/10 border-cyan-400/20",
                    member: "text-muted-foreground bg-white/5 border-white/10",
                  };
                  const roleLabels: Record<string, string> = { admin: "Админ", moderator: "Модер", member: "Участник" };
                  return (
                    <div key={m.id} className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-white/5 transition-all">
                      <AvatarEl name={m.name} size="xs" status={m.status} />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-foreground truncate">
                          {m.is_me ? "Вы" : m.name}
                        </span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${roleColors[m.role] ?? roleColors.member}`}>
                        {roleLabels[m.role] ?? m.role}
                      </span>
                      {!m.is_me && myRole === "admin" && (
                        <button onClick={() => kickMember(m.id, m.name)}
                          className="p-1 rounded-full hover:bg-red-500/20 transition-colors flex-shrink-0 group">
                          <Icon name="UserMinus" size={13} className="text-muted-foreground group-hover:text-red-400 transition-colors" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

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
                className="w-full bg-secondary/60 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-violet-500/50 transition-all" />
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
        className="flex-1 overflow-y-auto px-4 py-4 space-y-2"
        style={{ background: "radial-gradient(ellipse at top, rgba(168,85,247,0.04) 0%, transparent 60%)" }}
        onScroll={e => {
          const el = e.currentTarget;
          isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}>
        {loading && (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
              <Icon name="MessageCircle" size={24} className="text-violet-400" />
            </div>
            <p className="text-muted-foreground text-sm">Начните переписку! 👋</p>
          </div>
        )}
        {messages.map((msg, i) => {
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
            <div key={msg.id}
              ref={el => { msgRefs.current[msg.id] = el; }}
              className={`flex ${msg.out ? "justify-end" : "justify-start"} animate-fade-in`}
              style={{ animationDelay: `${i * 0.02}s` }}>
              <div className={`max-w-[75%] px-4 py-2.5 transition-all ${msg.out ? "msg-bubble-out" : "msg-bubble-in"} ${isActive ? "ring-2 ring-yellow-400/60" : isMatch ? "ring-1 ring-yellow-400/25" : ""}`}>
                {!msg.out && chat.is_group && msg.sender_name && (
                  <div className="text-[10px] text-purple-400 font-semibold mb-1">{msg.sender_name}</div>
                )}
                <p className="text-sm text-white leading-relaxed">{highlightText(msg.text)}</p>
                <div className={`flex items-center gap-1 mt-1 ${msg.out ? "justify-end" : "justify-start"}`}>
                  <span className="text-[10px] text-white/50">{msg.time}</span>
                  {msg.out && <Icon name={msg.is_read ? "CheckCheck" : "Check"} size={12} className={msg.is_read ? "text-cyan-400" : "text-white/50"} />}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {typists.length > 0 && (
        <div className="flex-shrink-0 px-5 py-1.5 flex items-center gap-2 animate-fade-in">
          <div className="flex gap-0.5 items-end">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-1.5 h-1.5 rounded-full bg-purple-400"
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

      <div className="flex-shrink-0 glass border-t border-white/5 px-4 py-3">
        <div className="flex items-end gap-2">
          <button className="p-2 hover:bg-white/10 rounded-full transition-colors flex-shrink-0">
            <Icon name="Plus" size={20} className="text-muted-foreground" />
          </button>
          <textarea value={text} onChange={e => { setText(e.target.value); sendTyping(); }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Сообщение..." rows={1}
            className="flex-1 bg-secondary/60 border border-white/10 rounded-2xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-purple-500/50 transition-all"
            style={{ maxHeight: "100px" }} />
          <button onClick={send}
            className={`p-3 rounded-full transition-all flex-shrink-0 ${text.trim()
              ? "bg-gradient-to-br from-violet-500 to-purple-600 hover:scale-105 shadow-[0_0_20px_rgba(168,85,247,0.5)]"
              : "bg-secondary"}`}>
            <Icon name="Send" size={16} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Chats Tab ────────────────────────────────────────────────────────────────

function ChatsTab({ token, currentUserId }: { token: string; currentUserId: number }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createMode, setCreateMode] = useState<"direct" | "group">("direct");
  const [newChatSearch, setNewChatSearch] = useState("");
  const [foundUsers, setFoundUsers] = useState<{ id: number; name: string; phone: string; status: string }[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<{ id: number; name: string }[]>([]);
  const [groupName, setGroupName] = useState("");
  const [groupCreating, setGroupCreating] = useState(false);

  const loadChats = useCallback(async () => {
    try {
      const res = await fetch(`${CHATS_URL}/chats`, { headers: apiHeaders(token) });
      const data = await res.json();
      if (data.chats) setChats(data.chats);
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { loadChats(); }, [loadChats]);

  // Poll chats every 5s when not in a conversation
  useEffect(() => {
    if (activeChat) return;
    const id = setInterval(() => loadChats(), 5000);
    return () => clearInterval(id);
  }, [loadChats, activeChat]);

  async function searchUsers(q: string) {
    if (!q.trim()) { setFoundUsers([]); return; }
    const res = await fetch(`${CHATS_URL}/users?q=${encodeURIComponent(q)}`, { headers: apiHeaders(token) });
    const data = await res.json();
    if (data.users) setFoundUsers(data.users);
  }

  function resetCreate() {
    setCreating(false); setNewChatSearch(""); setFoundUsers([]);
    setSelectedUsers([]); setGroupName(""); setCreateMode("direct");
  }

  async function startChat(userId: number) {
    const res = await fetch(`${CHATS_URL}/create`, {
      method: "POST", headers: apiHeaders(token),
      body: JSON.stringify({ is_group: false, members: [userId] }),
    });
    const data = await res.json();
    if (data.chat_id) { await loadChats(); resetCreate(); }
  }

  async function createGroup() {
    if (!groupName.trim() || selectedUsers.length < 1) return;
    setGroupCreating(true);
    try {
      const res = await fetch(`${CHATS_URL}/create`, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({
          is_group: true,
          name: groupName.trim(),
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

  const filtered = chats.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  if (activeChat) {
    return <ChatScreen chat={activeChat} token={token} currentUserId={currentUserId}
      onBack={() => { setActiveChat(null); loadChats(); }} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-golos font-black text-gradient">Чаты</h1>
          <button onClick={() => creating ? resetCreate() : setCreating(true)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <Icon name={creating ? "X" : "PenSquare"} size={20} className="text-purple-400" />
          </button>
        </div>

        {creating && (
          <div className="glass rounded-2xl p-3 mb-3 animate-fade-in space-y-3">
            {/* Mode switcher */}
            <div className="flex gap-1 p-1 glass rounded-xl">
              {(["direct", "group"] as const).map(m => (
                <button key={m} onClick={() => { setCreateMode(m); setSelectedUsers([]); setNewChatSearch(""); setFoundUsers([]); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all
                    ${createMode === m ? "bg-gradient-to-r from-violet-500 to-purple-600 text-white" : "text-muted-foreground hover:text-foreground"}`}>
                  <Icon name={m === "direct" ? "MessageCircle" : "Users"} size={12} />
                  {m === "direct" ? "Личный" : "Группа"}
                </button>
              ))}
            </div>

            {/* Group name field */}
            {createMode === "group" && (
              <div className="animate-fade-in">
                <input value={groupName} onChange={e => setGroupName(e.target.value)}
                  placeholder="Название группы..."
                  className="w-full bg-secondary/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-purple-500/50 transition-all" />
              </div>
            )}

            {/* Selected chips (group mode) */}
            {createMode === "group" && selectedUsers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 animate-fade-in">
                {selectedUsers.map(u => (
                  <div key={u.id} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/30">
                    <span className="text-xs text-violet-300">{u.name.split(" ")[0]}</span>
                    <button onClick={() => setSelectedUsers(prev => prev.filter(s => s.id !== u.id))}
                      className="w-4 h-4 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors">
                      <Icon name="X" size={10} className="text-violet-300" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Search */}
            <div className="relative">
              <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={newChatSearch}
                onChange={e => { setNewChatSearch(e.target.value); searchUsers(e.target.value); }}
                placeholder={createMode === "group" ? "Добавить участников..." : "Имя или номер..."}
                className="w-full bg-secondary/60 border border-white/10 rounded-xl pl-8 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-purple-500/50 transition-all" />
            </div>

            {/* Results */}
            {foundUsers.length > 0 && (
              <div className="space-y-0.5 max-h-40 overflow-y-auto">
                {foundUsers.map(u => {
                  const selected = createMode === "group" && selectedUsers.some(s => s.id === u.id);
                  return (
                    <button key={u.id}
                      onClick={() => createMode === "group" ? toggleUser(u) : startChat(u.id)}
                      className={`w-full flex items-center gap-2 p-2 rounded-xl transition-all
                        ${selected ? "bg-violet-500/15 border border-violet-500/20" : "hover:bg-white/5"}`}>
                      <AvatarEl name={u.name} size="xs" status={u.status} />
                      <div className="flex-1 min-w-0 text-left">
                        <div className="text-sm font-medium text-foreground truncate">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.phone}</div>
                      </div>
                      {createMode === "group"
                        ? <div className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 transition-all ${selected ? "bg-violet-500 border-violet-500" : "border-white/20"}`}>
                            {selected && <Icon name="Check" size={10} className="text-white" />}
                          </div>
                        : <Icon name="MessageCircle" size={14} className="text-purple-400" />}
                    </button>
                  );
                })}
              </div>
            )}
            {newChatSearch && foundUsers.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-1">Пользователи не найдены</p>
            )}

            {/* Create group button */}
            {createMode === "group" && selectedUsers.length > 0 && groupName.trim() && (
              <button onClick={createGroup} disabled={groupCreating}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-60 flex items-center justify-center gap-2 animate-fade-in">
                {groupCreating
                  ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Создаём...</>
                  : <><Icon name="Users" size={14} />Создать группу «{groupName}» · {selectedUsers.length + 1} чел.</>}
              </button>
            )}
          </div>
        )}

        <div className="relative">
          <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск чатов..."
            className="w-full bg-secondary/60 border border-white/10 rounded-2xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-purple-500/50 transition-all" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">Загружаем чаты...</p>
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
            <div className="w-16 h-16 rounded-3xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
              <Icon name="MessageCircle" size={28} className="text-violet-400" />
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
            <button key={chat.id} onClick={() => setActiveChat(chat)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-all active:scale-[0.98] animate-fade-in"
              style={{ animationDelay: `${i * 0.04}s` }}>
              <div className="relative flex-shrink-0">
                <AvatarEl name={chat.name} size="md" status={!chat.is_group ? "online" : undefined} />
                {chat.is_group && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 flex items-center justify-center">
                    <Icon name="Users" size={10} className="text-white" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center justify-between">
                  <span className="font-golos font-semibold text-foreground text-sm truncate">{chat.name}</span>
                  <span className={`text-[11px] flex-shrink-0 ml-2 ${chat.unread > 0 ? "text-purple-400" : "text-muted-foreground"}`}>
                    {relTime}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs text-muted-foreground truncate">{chat.last_msg || "Нет сообщений"}</span>
                  {chat.unread > 0 && (
                    <span className="flex-shrink-0 ml-2 min-w-[20px] h-5 px-1.5 rounded-full bg-gradient-to-r from-violet-500 to-purple-600 text-white text-[10px] font-bold flex items-center justify-center">
                      {chat.unread}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────

function ProfileTab({ user, token, onLogout, onUserUpdate }: {
  user: User; token: string; onLogout: () => void; onUserUpdate: (u: User) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [changingPw, setChangingPw] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSaved, setPwSaved] = useState(false);
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);

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
      const res = await fetch(`${AUTH_URL}/change-password`, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ current_password: curPw, new_password: newPw }),
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
      const res = await fetch(`${AUTH_URL}/update-profile`, {
        method: "POST", headers: apiHeaders(token),
        body: JSON.stringify({ name: name.trim(), bio: bio.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Ошибка сохранения"); return; }
      onUserUpdate(data.user);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Hero */}
      <div className="relative px-4 pt-8 pb-6 text-center overflow-hidden"
        style={{ background: "radial-gradient(ellipse at top, rgba(168,85,247,0.15) 0%, transparent 70%)" }}>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="absolute rounded-full opacity-10"
              style={{ width: 30 + i * 20, height: 30 + i * 20, background: "linear-gradient(135deg, #a855f7, #22d3ee)",
                top: `${10 + i * 15}%`, left: `${5 + i * 20}%`,
                animation: `float ${3 + i * 0.5}s ease-in-out infinite`, animationDelay: `${i * 0.3}s` }} />
          ))}
        </div>
        <div className="relative z-10">
          <div className="flex justify-center mb-4">
            <div className="p-0.5 rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 shadow-[0_0_30px_rgba(168,85,247,0.5)]">
              <div className="p-0.5 rounded-full bg-background">
                <AvatarEl name={user.name} size="xl" />
              </div>
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
          <div className="glass rounded-3xl p-4 space-y-3 animate-fade-in border border-violet-500/20">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="Edit3" size={14} className="text-purple-400" />
              <span className="text-xs font-semibold text-purple-400 uppercase tracking-wide">Редактирование профиля</span>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground font-medium">Имя</label>
              <div className="relative">
                <Icon name="User" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={name} onChange={e => setName(e.target.value)}
                  placeholder="Ваше имя"
                  className="w-full bg-secondary/60 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-purple-500/50 transition-all" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground font-medium">О себе</label>
              <div className="relative">
                <Icon name="AlignLeft" size={14} className="absolute left-3 top-3 text-muted-foreground" />
                <textarea value={bio} onChange={e => setBio(e.target.value)}
                  placeholder="Расскажите о себе..." rows={2}
                  className="w-full bg-secondary/60 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-purple-500/50 transition-all resize-none" />
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
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2">
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
          { icon: "Phone", label: "Телефон", value: user.phone, color: "text-purple-400", bg: "bg-violet-500/15 border-violet-500/20" },
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
            <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
              <Icon name="Edit3" size={16} className="text-purple-400" />
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

        <button onClick={onLogout}
          className="w-full glass rounded-2xl p-4 flex items-center gap-3 hover:bg-red-500/5 transition-all">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
            <Icon name="LogOut" size={16} className="text-red-400" />
          </div>
          <span className="text-sm font-medium text-red-400">Выйти из аккаунта</span>
        </button>
      </div>
    </div>
  );
}

// ─── Other Tabs ───────────────────────────────────────────────────────────────

function CallsTab() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-2xl font-golos font-black text-gradient mb-4">Звонки</h1>
      </div>
      <div className="flex-1 overflow-y-auto">
        {MOCK_CALLS.map((call, i) => {
          const cfg = {
            incoming: { icon: "PhoneIncoming", color: "text-green-400", label: "Входящий" },
            outgoing: { icon: "PhoneOutgoing", color: "text-cyan-400", label: "Исходящий" },
            missed: { icon: "PhoneMissed", color: "text-red-400", label: "Пропущенный" },
          }[call.type];
          return (
            <div key={call.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-all animate-fade-in"
              style={{ animationDelay: `${i * 0.05}s` }}>
              <AvatarEl name={call.name} size="md" />
              <div className="flex-1">
                <div className="font-golos font-semibold text-foreground text-sm">{call.name}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Icon name={cfg.icon} size={12} className={cfg.color} />
                  <span className={`text-xs ${cfg.color}`}>{cfg.label}</span>
                  {call.callType === "video" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-400/10 text-cyan-400 border border-cyan-400/20">видео</span>
                  )}
                  {call.duration && <span className="text-xs text-muted-foreground">· {call.duration}</span>}
                </div>
              </div>
              <button className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <Icon name={call.callType === "video" ? "Video" : "Phone"} size={16} className="text-purple-400" />
              </button>
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
            <div className="p-0.5 rounded-full bg-gradient-to-br from-violet-500 to-cyan-400">
              <div className="p-0.5 rounded-full bg-background"><AvatarEl name={user.name} size="sm" /></div>
            </div>
            <div className="flex-1">
              <div className="font-golos font-semibold text-sm text-foreground">Мой статус</div>
              <div className="text-xs text-muted-foreground">Добавить обновление</div>
            </div>
            <button onClick={() => setPosting(!posting)}
              className="p-2.5 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 hover:scale-105 transition-all">
              <Icon name={posting ? "X" : "Plus"} size={16} className="text-white" />
            </button>
          </div>
          {posting && (
            <div className="mt-3 animate-fade-in">
              <textarea value={myText} onChange={e => setMyText(e.target.value)}
                placeholder="Что у вас происходит?" rows={2}
                className="w-full bg-secondary/60 border border-white/10 rounded-2xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-purple-500/50 transition-all mb-2" />
              <button className="w-full py-2.5 rounded-2xl bg-gradient-to-r from-violet-500 to-purple-600 text-white text-sm font-semibold">
                Опубликовать
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4">
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
              {!s.viewed && <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse-dot flex-shrink-0" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ContactsTab({ token }: { token: string }) {
  const [users, setUsers] = useState<{ id: number; name: string; phone: string; status: string }[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  async function searchUsers(q: string) {
    if (!q.trim()) { setUsers([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`${CHATS_URL}/users?q=${encodeURIComponent(q)}`, { headers: apiHeaders(token) });
      const data = await res.json();
      if (data.users) setUsers(data.users);
    } finally { setLoading(false); }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-2xl font-golos font-black text-gradient mb-4">Контакты</h1>
        <div className="relative">
          <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => { setSearch(e.target.value); searchUsers(e.target.value); }}
            placeholder="Поиск по имени или номеру..."
            className="w-full bg-secondary/60 border border-white/10 rounded-2xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-purple-500/50 transition-all" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {!search && (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
            <div className="w-16 h-16 rounded-3xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <Icon name="Search" size={28} className="text-cyan-400" />
            </div>
            <div>
              <p className="font-golos font-semibold text-foreground mb-1">Найти пользователей</p>
              <p className="text-sm text-muted-foreground">Введите имя или номер телефона</p>
            </div>
          </div>
        )}
        {loading && <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" /></div>}
        {users.map((u, i) => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-all animate-fade-in"
            style={{ animationDelay: `${i * 0.04}s` }}>
            <AvatarEl name={u.name} size="md" status={u.status} />
            <div className="flex-1">
              <div className="font-golos font-semibold text-foreground text-sm">{u.name}</div>
              <div className="text-xs text-muted-foreground">{u.phone}</div>
            </div>
            <div className="flex gap-1">
              <button className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <Icon name="MessageCircle" size={16} className="text-purple-400" />
              </button>
              <button className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <Icon name="Phone" size={16} className="text-cyan-400" />
              </button>
            </div>
          </div>
        ))}
        {search && !loading && users.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">Пользователи не найдены</div>
        )}
      </div>
    </div>
  );
}

function SettingsTab({ onLogout, onTestSound }: { onLogout: () => void; onTestSound: () => void }) {
  const [notif, setNotif] = useState(true);
  const [readR, setReadR] = useState(true);
  const [dark, setDark] = useState(true);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(
    "Notification" in window ? Notification.permission : "denied"
  );

  async function requestNotifPermission() {
    if (!("Notification" in window)) return;
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
    if (perm === "granted") {
      new Notification("Pulse", { body: "Уведомления включены! 🚀", icon: "/favicon.svg" });
    }
  }

  const sections = [
    { title: "Уведомления", items: [
      { icon: "Bell", label: "Push-уведомления", v: notif, set: setNotif },
      { icon: "Volume2", label: "Звуки", v: true, set: () => {} },
    ]},
    { title: "Приватность", items: [
      { icon: "Eye", label: "Уведомления о прочтении", v: readR, set: setReadR },
    ]},
    { title: "Оформление", items: [
      { icon: "Moon", label: "Тёмная тема", v: dark, set: setDark },
    ]},
  ];

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-2xl font-golos font-black text-gradient mb-4">Настройки</h1>
      </div>
      <div className="px-4 space-y-4 pb-6">
        {sections.map((s, si) => (
          <div key={s.title} className="animate-fade-in" style={{ animationDelay: `${si * 0.08}s` }}>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 px-1">{s.title}</div>
            <div className="glass rounded-3xl overflow-hidden">
              {s.items.map((item, ii) => (
                <div key={item.label}
                  className={`flex items-center gap-3 px-4 py-3.5 ${ii < s.items.length - 1 ? "border-b border-white/5" : ""}`}>
                  <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-white/5 flex items-center justify-center flex-shrink-0">
                    <Icon name={item.icon} size={16} className="text-purple-400" />
                  </div>
                  <span className="flex-1 text-sm font-medium text-foreground">{item.label}</span>
                  <button onClick={() => item.set(!item.v)}
                    className={`w-11 h-6 rounded-full transition-all duration-300 relative flex-shrink-0 ${item.v ? "bg-gradient-to-r from-violet-500 to-purple-600" : "bg-secondary"}`}>
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-300 ${item.v ? "left-5" : "left-0.5"}`} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
        {/* Notification permission block */}
        <div className="animate-fade-in" style={{ animationDelay: "0.28s" }}>
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 px-1">Браузерные уведомления</div>
          <div className="glass rounded-3xl p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0
              ${notifPerm === "granted" ? "bg-green-500/10 border-green-500/20" : notifPerm === "denied" ? "bg-red-500/10 border-red-500/20" : "bg-amber-500/10 border-amber-500/20"}`}>
              <Icon name={notifPerm === "granted" ? "BellRing" : notifPerm === "denied" ? "BellOff" : "Bell"}
                size={16} className={notifPerm === "granted" ? "text-green-400" : notifPerm === "denied" ? "text-red-400" : "text-amber-400"} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground">
                {notifPerm === "granted" ? "Уведомления включены" : notifPerm === "denied" ? "Уведомления заблокированы" : "Разрешить уведомления"}
              </div>
              <div className="text-xs text-muted-foreground">
                {notifPerm === "granted" ? "Вы получите уведомления о новых сообщениях" : notifPerm === "denied" ? "Разрешите доступ в настройках браузера" : "Нажмите, чтобы разрешить"}
              </div>
            </div>
            {notifPerm === "default" && (
              <button onClick={requestNotifPermission}
                className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white text-xs font-semibold hover:opacity-90 transition-all">
                Включить
              </button>
            )}
            {notifPerm === "granted" && (
              <button onClick={onTestSound}
                className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-green-500/15 border border-green-500/20 text-green-400 text-xs font-semibold hover:bg-green-500/25 transition-all flex items-center gap-1.5">
                <Icon name="Volume2" size={12} />
                Тест
              </button>
            )}
          </div>
        </div>

        <button onClick={onLogout}
          className="w-full glass rounded-3xl p-4 flex items-center gap-3 hover:bg-red-500/5 transition-all">
          <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
            <Icon name="LogOut" size={16} className="text-red-400" />
          </div>
          <span className="text-sm font-medium text-red-400">Выйти из аккаунта</span>
        </button>
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("pulse_token"));
  const [user, setUser] = useState<User | null>(() => {
    const u = localStorage.getItem("pulse_user");
    return u ? JSON.parse(u) : null;
  });
  const [tab, setTab] = useState<Tab>("chats");
  const [chatsForBadge, setChatsForBadge] = useState<{ unread: number }[]>([]);
  const [authChecked, setAuthChecked] = useState(false);
  const prevUnreadRef = useRef<Record<number, number>>({});

  useEffect(() => {
    if (!token) { setAuthChecked(true); return; }
    fetch(`${AUTH_URL}/me`, { headers: apiHeaders(token) })
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

  // Request notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

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
    fetch(`${CHATS_URL}/chats`, { headers: apiHeaders(token) })
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

  function handleAuth(newToken: string, newUser: User) {
    setToken(newToken); setUser(newUser);
    localStorage.setItem("pulse_token", newToken);
    localStorage.setItem("pulse_user", JSON.stringify(newUser));
  }

  async function handleLogout() {
    if (token) fetch(`${AUTH_URL}/logout`, { method: "POST", headers: apiHeaders(token) }).catch(() => {});
    setToken(null); setUser(null);
    localStorage.removeItem("pulse_token"); localStorage.removeItem("pulse_user");
    setTab("chats");
  }

  const unreadCount = chatsForBadge.reduce((a, c) => a + (c.unread || 0), 0);

  if (!authChecked) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: "hsl(var(--background))" }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shadow-[0_0_40px_rgba(168,85,247,0.5)]">
            <Icon name="Zap" size={28} className="text-white" />
          </div>
          <div className="w-6 h-6 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!token || !user) {
    return (
      <div className="flex flex-col h-screen max-w-md mx-auto overflow-hidden" style={{ background: "hsl(var(--background))" }}>
        <AuthScreen onAuth={handleAuth} />
      </div>
    );
  }

  const tabs: Record<Tab, React.ReactNode> = {
    chats: <ChatsTab token={token} currentUserId={user.id} />,
    contacts: <ContactsTab token={token} />,
    calls: <CallsTab />,
    status: <StatusTab user={user} />,
    profile: <ProfileTab user={user} token={token} onLogout={handleLogout} onUserUpdate={u => { setUser(u); localStorage.setItem("pulse_user", JSON.stringify(u)); }} />,
    settings: <SettingsTab onLogout={handleLogout} onTestSound={playSound} />,
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto font-rubik overflow-hidden relative"
      style={{ background: "hsl(var(--background))" }}>
      <div className="fixed inset-0 max-w-md mx-auto pointer-events-none overflow-hidden">
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full opacity-[0.04]"
          style={{ background: "radial-gradient(circle, #a855f7, transparent)" }} />
        <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full opacity-[0.04]"
          style={{ background: "radial-gradient(circle, #22d3ee, transparent)" }} />
      </div>
      <div className="flex-shrink-0 flex items-center justify-between px-6 pt-2 pb-1 text-xs text-muted-foreground relative z-10">
        <span className="font-semibold">9:41</span>
        <div className="flex items-center gap-1.5">
          <Icon name="Wifi" size={11} className="text-muted-foreground" />
          <Icon name="Battery" size={11} className="text-muted-foreground" />
        </div>
      </div>
      <div className="flex-1 overflow-hidden relative z-10">{tabs[tab]}</div>
      <BottomNav active={tab} onChange={setTab} unreadCount={unreadCount} />
    </div>
  );
}