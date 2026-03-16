import { useState, useRef, useEffect } from "react";
import Icon from "@/components/ui/icon";

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = "chats" | "contacts" | "calls" | "status" | "profile" | "settings";
type UserRole = "admin" | "member" | "moderator";

interface User {
  id: string;
  name: string;
  avatar: string;
  status: "online" | "away" | "offline";
  lastSeen?: string;
  bio?: string;
  phone?: string;
}

interface Message {
  id: string;
  text: string;
  time: string;
  out: boolean;
  read: boolean;
}

interface ChatMember {
  userId: string;
  role: UserRole;
}

interface Chat {
  id: string;
  name: string;
  lastMsg: string;
  time: string;
  unread: number;
  isGroup: boolean;
  members?: ChatMember[];
  messages: Message[];
  online?: boolean;
  pinned?: boolean;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  status: "online" | "away" | "offline";
  lastSeen?: string;
}

interface Call {
  id: string;
  name: string;
  type: "incoming" | "outgoing" | "missed";
  callType: "voice" | "video";
  time: string;
  duration?: string;
}

interface Status {
  id: string;
  userId: string;
  name: string;
  time: string;
  viewed: boolean;
  color: string;
  text?: string;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const CURRENT_USER: User = {
  id: "me",
  name: "Алексей Петров",
  avatar: "АП",
  status: "online",
  bio: "Всегда на связи 🚀",
  phone: "+7 999 123-45-67",
};

const CHATS: Chat[] = [
  {
    id: "1", name: "Команда Pulse", lastMsg: "Антон: Когда релиз?", time: "сейчас",
    unread: 5, isGroup: true, pinned: true,
    members: [
      { userId: "1", role: "admin" }, { userId: "2", role: "moderator" },
      { userId: "3", role: "member" }, { userId: "me", role: "admin" },
    ],
    messages: [
      { id: "1", text: "Привет всем! 👋", time: "10:00", out: false, read: true },
      { id: "2", text: "Когда релиз новой версии?", time: "10:05", out: false, read: true },
      { id: "3", text: "Планируем на пятницу 🚀", time: "10:10", out: true, read: true },
      { id: "4", text: "Отлично! Буду ждать 🔥", time: "10:12", out: false, read: true },
      { id: "5", text: "Нужно ещё протестировать push-уведомления", time: "10:15", out: false, read: false },
    ],
  },
  {
    id: "2", name: "Анна Смирнова", lastMsg: "Увидимся завтра?", time: "14:22",
    unread: 1, isGroup: false, online: true,
    messages: [
      { id: "1", text: "Привет! Как дела?", time: "13:00", out: false, read: true },
      { id: "2", text: "Всё хорошо, спасибо!", time: "13:05", out: true, read: true },
      { id: "3", text: "Увидимся завтра?", time: "14:22", out: false, read: false },
    ],
  },
  {
    id: "3", name: "Дизайн-ревью", lastMsg: "Я: Отличная работа!", time: "вчера",
    unread: 0, isGroup: true,
    members: [
      { userId: "me", role: "admin" }, { userId: "1", role: "member" }, { userId: "4", role: "member" },
    ],
    messages: [
      { id: "1", text: "Давайте обсудим макеты", time: "вчера 15:00", out: true, read: true },
      { id: "2", text: "Выглядит классно!", time: "вчера 15:30", out: false, read: true },
      { id: "3", text: "Отличная работа!", time: "вчера 16:00", out: true, read: true },
    ],
  },
  {
    id: "4", name: "Михаил Козлов", lastMsg: "Хорошо, договорились", time: "пн",
    unread: 0, isGroup: false, online: false,
    messages: [
      { id: "1", text: "Можешь посмотреть PR?", time: "пн 11:00", out: false, read: true },
      { id: "2", text: "Конечно, сейчас гляну", time: "пн 11:15", out: true, read: true },
      { id: "3", text: "Хорошо, договорились", time: "пн 11:20", out: false, read: true },
    ],
  },
  {
    id: "5", name: "Маркетинг", lastMsg: "Катя: Запускаем кампанию!", time: "вс",
    unread: 12, isGroup: true,
    members: [
      { userId: "me", role: "member" }, { userId: "5", role: "admin" }, { userId: "6", role: "member" },
    ],
    messages: [
      { id: "1", text: "Новая кампания стартует в понедельник", time: "вс 09:00", out: false, read: true },
      { id: "2", text: "Запускаем кампанию!", time: "вс 09:30", out: false, read: false },
    ],
  },
];

const CONTACTS: Contact[] = [
  { id: "1", name: "Анна Смирнова", phone: "+7 900 111-22-33", status: "online" },
  { id: "2", name: "Антон Волков", phone: "+7 900 222-33-44", status: "online" },
  { id: "3", name: "Дарья Новикова", phone: "+7 900 333-44-55", status: "away", lastSeen: "5 мин назад" },
  { id: "4", name: "Екатерина Иванова", phone: "+7 900 444-55-66", status: "offline", lastSeen: "час назад" },
  { id: "5", name: "Михаил Козлов", phone: "+7 900 555-66-77", status: "offline", lastSeen: "вчера" },
  { id: "6", name: "Ольга Петрова", phone: "+7 900 666-77-88", status: "online" },
  { id: "7", name: "Сергей Лебедев", phone: "+7 900 777-88-99", status: "away", lastSeen: "10 мин назад" },
];

const CALLS: Call[] = [
  { id: "1", name: "Анна Смирнова", type: "incoming", callType: "video", time: "сейчас", duration: "5:32" },
  { id: "2", name: "Антон Волков", type: "outgoing", callType: "voice", time: "14:05", duration: "2:10" },
  { id: "3", name: "Михаил Козлов", type: "missed", callType: "voice", time: "вчера" },
  { id: "4", name: "Команда Pulse", type: "outgoing", callType: "video", time: "пн", duration: "45:00" },
  { id: "5", name: "Дарья Новикова", type: "missed", callType: "video", time: "вс" },
  { id: "6", name: "Ольга Петрова", type: "incoming", callType: "voice", time: "сб", duration: "12:45" },
];

const STATUSES: Status[] = [
  { id: "1", userId: "2", name: "Анна Смирнова", time: "5 мин", viewed: false, color: "from-violet-500 to-cyan-400", text: "Новый день — новые возможности! ✨" },
  { id: "2", userId: "3", name: "Антон Волков", time: "12 мин", viewed: false, color: "from-pink-500 to-orange-400", text: "На конференции по дизайну 🎨" },
  { id: "3", userId: "4", name: "Дарья Новикова", time: "1 ч", viewed: true, color: "from-green-400 to-cyan-500" },
  { id: "4", userId: "5", name: "Михаил Козлов", time: "2 ч", viewed: true, color: "from-blue-500 to-violet-600", text: "Работаю из кафе ☕" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "from-violet-500 to-purple-600",
  "from-cyan-400 to-blue-500",
  "from-pink-400 to-rose-500",
  "from-green-400 to-emerald-500",
  "from-orange-400 to-amber-500",
  "from-indigo-500 to-blue-600",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

// ─── Avatar Component ─────────────────────────────────────────────────────────

function Avatar({ name, size = "md", showRing = false, status }: {
  name: string; size?: "xs" | "sm" | "md" | "lg" | "xl";
  showRing?: boolean; status?: "online" | "away" | "offline";
}) {
  const sizes = {
    xs: "w-8 h-8 text-xs", sm: "w-10 h-10 text-xs", md: "w-12 h-12 text-sm",
    lg: "w-14 h-14 text-base", xl: "w-20 h-20 text-xl",
  };
  const color = getAvatarColor(name);

  return (
    <div className="relative flex-shrink-0">
      {showRing ? (
        <div className={`p-0.5 rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 inline-flex ${sizes[size]}`}>
          <div className={`flex-1 rounded-full bg-gradient-to-br ${color} flex items-center justify-center font-golos font-bold text-white m-[2px]`}>
            {name.slice(0, 2)}
          </div>
        </div>
      ) : (
        <div className={`rounded-full bg-gradient-to-br ${color} flex items-center justify-center font-golos font-bold text-white flex-shrink-0 ${sizes[size]}`}>
          {name.slice(0, 2)}
        </div>
      )}
      {status && (
        <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background
          ${status === "online" ? "status-online" : status === "away" ? "status-away" : "status-offline"}`} />
      )}
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
                <Icon name={icon} size={20}
                  className={`transition-all duration-200 ${isActive ? "text-purple-400" : "text-muted-foreground"}`} />
                {tab === "chats" && unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-gradient-to-br from-violet-500 to-pink-500 rounded-full text-[9px] text-white font-bold flex items-center justify-center">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </div>
              <span className={`text-[9px] font-medium transition-all ${isActive ? "text-purple-400" : "text-muted-foreground"}`}>
                {label}
              </span>
              {isActive && <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-purple-400" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─── Chat Screen ──────────────────────────────────────────────────────────────

function ChatScreen({ chat, onBack }: { chat: Chat; onBack: () => void }) {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState(chat.messages);
  const [showInfo, setShowInfo] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function send() {
    if (!text.trim()) return;
    setMessages(prev => [...prev, {
      id: String(Date.now()), text: text.trim(),
      time: new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }),
      out: true, read: false,
    }]);
    setText("");
  }

  const myRole = chat.members?.find(m => m.userId === "me")?.role;

  return (
    <div className="flex flex-col h-full animate-slide-in-right">
      <div className="flex-shrink-0 glass border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 -ml-2 hover:bg-white/10 rounded-full transition-colors">
            <Icon name="ArrowLeft" size={20} />
          </button>
          <button onClick={() => setShowInfo(!showInfo)} className="flex items-center gap-3 flex-1 min-w-0">
            <Avatar name={chat.name} size="sm" status={!chat.isGroup ? (chat.online ? "online" : "offline") : undefined} />
            <div className="flex-1 min-w-0 text-left">
              <div className="font-golos font-semibold text-foreground text-sm truncate">{chat.name}</div>
              <div className="text-xs text-muted-foreground">
                {chat.isGroup ? `${chat.members?.length ?? 0} участников` : chat.online ? "в сети" : "не в сети"}
              </div>
            </div>
          </button>
          <button className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <Icon name="Video" size={18} className="text-cyan-400" />
          </button>
          <button className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <Icon name="Phone" size={18} className="text-cyan-400" />
          </button>
        </div>

        {showInfo && chat.isGroup && (
          <div className="mt-3 p-3 glass rounded-2xl animate-fade-in">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-purple-400 uppercase tracking-wide">Участники</span>
              {myRole === "admin" && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Вы администратор
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {chat.members?.map(member => {
                const labels: Record<UserRole, string> = { admin: "Админ", moderator: "Модер", member: "Участник" };
                const colors: Record<UserRole, string> = {
                  admin: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
                  moderator: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30",
                  member: "text-muted-foreground bg-white/5 border-white/10",
                };
                return (
                  <div key={member.userId} className={`text-[11px] px-2 py-0.5 rounded-full border ${colors[member.role]}`}>
                    {member.userId === "me" ? "Вы" : member.userId === "1" ? "Антон" : member.userId === "2" ? "Дарья" : `#${member.userId}`} · {labels[member.role]}
                  </div>
                );
              })}
            </div>
            {myRole === "admin" && (
              <button className="mt-2 w-full text-xs text-center text-purple-400 hover:text-purple-300 transition-colors py-1">
                + Добавить участника
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2"
        style={{ background: "radial-gradient(ellipse at top, rgba(168,85,247,0.04) 0%, transparent 60%)" }}>
        {messages.map((msg, i) => (
          <div key={msg.id} className={`flex ${msg.out ? "justify-end" : "justify-start"} animate-fade-in`}
            style={{ animationDelay: `${i * 0.03}s` }}>
            <div className={`max-w-[75%] px-4 py-2.5 ${msg.out ? "msg-bubble-out" : "msg-bubble-in"}`}>
              <p className="text-sm text-white leading-relaxed">{msg.text}</p>
              <div className={`flex items-center gap-1 mt-1 ${msg.out ? "justify-end" : "justify-start"}`}>
                <span className="text-[10px] text-white/50">{msg.time}</span>
                {msg.out && (
                  <Icon name={msg.read ? "CheckCheck" : "Check"} size={12}
                    className={msg.read ? "text-cyan-400" : "text-white/50"} />
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="flex-shrink-0 glass border-t border-white/5 px-4 py-3">
        <div className="flex items-end gap-2">
          <button className="p-2 hover:bg-white/10 rounded-full transition-colors flex-shrink-0">
            <Icon name="Plus" size={20} className="text-muted-foreground" />
          </button>
          <textarea value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Сообщение..." rows={1}
            className="flex-1 bg-secondary/60 border border-white/10 rounded-2xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-purple-500/50 transition-all"
            style={{ maxHeight: "100px" }} />
          <button className="p-2 hover:bg-white/10 rounded-full transition-colors flex-shrink-0">
            <Icon name="Smile" size={20} className="text-muted-foreground" />
          </button>
          <button onClick={send}
            className={`p-3 rounded-full transition-all duration-200 flex-shrink-0 ${text.trim()
              ? "bg-gradient-to-br from-violet-500 to-purple-600 hover:scale-105 hover:shadow-[0_0_20px_rgba(168,85,247,0.5)]"
              : "bg-secondary"}`}>
            <Icon name="Send" size={16} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Chats Tab ────────────────────────────────────────────────────────────────

function ChatsTab() {
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [search, setSearch] = useState("");
  const filtered = CHATS.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  if (activeChat) return <ChatScreen chat={activeChat} onBack={() => setActiveChat(null)} />;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-golos font-black text-gradient">Чаты</h1>
          <button className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <Icon name="PenSquare" size={20} className="text-purple-400" />
          </button>
        </div>
        <div className="relative">
          <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск чатов..."
            className="w-full bg-secondary/60 border border-white/10 rounded-2xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-purple-500/50 transition-all" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.filter(c => c.pinned).length > 0 && (
          <div className="px-4 py-1">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Закреплённые</span>
          </div>
        )}
        {filtered.map((chat, i) => (
          <button key={chat.id} onClick={() => setActiveChat(chat)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-all duration-150 active:scale-[0.98] animate-fade-in"
            style={{ animationDelay: `${i * 0.05}s` }}>
            <div className="relative flex-shrink-0">
              <Avatar name={chat.name} size="md" status={!chat.isGroup ? (chat.online ? "online" : "offline") : undefined} />
              {chat.isGroup && (
                <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 flex items-center justify-center">
                  <Icon name="Users" size={10} className="text-white" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 min-w-0">
                  {chat.pinned && <Icon name="Pin" size={10} className="text-purple-400 flex-shrink-0" />}
                  <span className="font-golos font-semibold text-foreground text-sm truncate">{chat.name}</span>
                </div>
                <span className={`text-[11px] flex-shrink-0 ml-2 ${chat.unread > 0 ? "text-purple-400" : "text-muted-foreground"}`}>
                  {chat.time}
                </span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-xs text-muted-foreground truncate">{chat.lastMsg}</span>
                {chat.unread > 0 && (
                  <span className="flex-shrink-0 ml-2 min-w-[20px] h-5 px-1.5 rounded-full bg-gradient-to-r from-violet-500 to-purple-600 text-white text-[10px] font-bold flex items-center justify-center">
                    {chat.unread}
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
        {!filtered.filter(c => c.pinned).length && filtered.filter(c => !c.pinned).length > 0 && filtered.filter(c => c.pinned).length === 0 && null}
        {filtered.filter(c => !c.pinned).length > 0 && filtered.filter(c => c.pinned).length > 0 && (
          <div className="px-4 py-1 mt-1">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Все чаты</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Contacts Tab ─────────────────────────────────────────────────────────────

function ContactsTab() {
  const [search, setSearch] = useState("");
  const filtered = CONTACTS.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
  const online = filtered.filter(c => c.status === "online");
  const away = filtered.filter(c => c.status === "away");
  const offline = filtered.filter(c => c.status === "offline");

  const ContactRow = ({ c, i }: { c: Contact; i: number }) => (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-all animate-fade-in"
      style={{ animationDelay: `${i * 0.04}s` }}>
      <Avatar name={c.name} size="md" status={c.status} />
      <div className="flex-1 min-w-0">
        <div className="font-golos font-semibold text-foreground text-sm">{c.name}</div>
        <div className="text-xs text-muted-foreground">
          {c.status === "online" ? "в сети" : c.lastSeen ?? "не в сети"}
        </div>
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
  );

  const Section = ({ title, items }: { title: string; items: Contact[] }) =>
    items.length > 0 ? (
      <>
        <div className="px-4 py-2">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{title} · {items.length}</span>
        </div>
        {items.map((c, i) => <ContactRow key={c.id} c={c} i={i} />)}
      </>
    ) : null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-golos font-black text-gradient">Контакты</h1>
          <button className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <Icon name="UserPlus" size={20} className="text-purple-400" />
          </button>
        </div>
        <div className="relative">
          <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск контактов..."
            className="w-full bg-secondary/60 border border-white/10 rounded-2xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-purple-500/50 transition-all" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Section title="Онлайн" items={online} />
        <Section title="Недавно" items={away} />
        <Section title="Не в сети" items={offline} />
      </div>
    </div>
  );
}

// ─── Calls Tab ────────────────────────────────────────────────────────────────

function CallsTab() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-golos font-black text-gradient">Звонки</h1>
          <button className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <Icon name="PhoneCall" size={20} className="text-purple-400" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {CALLS.map((call, i) => {
          const cfg = {
            incoming: { icon: "PhoneIncoming", color: "text-green-400", label: "Входящий" },
            outgoing: { icon: "PhoneOutgoing", color: "text-cyan-400", label: "Исходящий" },
            missed: { icon: "PhoneMissed", color: "text-red-400", label: "Пропущенный" },
          }[call.type];
          return (
            <div key={call.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-all animate-fade-in"
              style={{ animationDelay: `${i * 0.05}s` }}>
              <Avatar name={call.name} size="md" />
              <div className="flex-1 min-w-0">
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
              <div className="text-right">
                <div className="text-xs text-muted-foreground mb-1">{call.time}</div>
                <button className="p-2 hover:bg-white/10 rounded-full transition-colors">
                  <Icon name={call.callType === "video" ? "Video" : "Phone"} size={16} className="text-purple-400" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Status Tab ───────────────────────────────────────────────────────────────

function StatusTab() {
  const [posting, setPosting] = useState(false);
  const [myText, setMyText] = useState("");

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-4 pt-4 pb-3">
        <h1 className="text-2xl font-golos font-black text-gradient mb-4">Статусы</h1>
        <div className="glass rounded-3xl p-4 mb-3">
          <div className="flex items-center gap-3">
            <div className="p-0.5 rounded-full bg-gradient-to-br from-violet-500 to-cyan-400">
              <div className="p-0.5 rounded-full bg-background">
                <Avatar name={CURRENT_USER.name} size="sm" />
              </div>
            </div>
            <div className="flex-1">
              <div className="font-golos font-semibold text-sm text-foreground">Мой статус</div>
              <div className="text-xs text-muted-foreground">Добавить обновление</div>
            </div>
            <button onClick={() => setPosting(!posting)}
              className="p-2.5 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 hover:scale-105 transition-all hover:shadow-[0_0_20px_rgba(168,85,247,0.5)]">
              <Icon name={posting ? "X" : "Plus"} size={16} className="text-white" />
            </button>
          </div>
          {posting && (
            <div className="mt-3 animate-fade-in">
              <textarea value={myText} onChange={e => setMyText(e.target.value)}
                placeholder="Что у вас происходит?" rows={2}
                className="w-full bg-secondary/60 border border-white/10 rounded-2xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-purple-500/50 transition-all mb-2" />
              <button className="w-full py-2.5 rounded-2xl bg-gradient-to-r from-violet-500 to-purple-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity">
                Опубликовать
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Обновления · {STATUSES.length}</div>
        <div className="space-y-3">
          {STATUSES.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 animate-fade-in" style={{ animationDelay: `${i * 0.06}s` }}>
              <div className={`p-0.5 rounded-full bg-gradient-to-br ${s.color} ${s.viewed ? "opacity-40" : ""}`}>
                <div className="p-0.5 rounded-full bg-background">
                  <Avatar name={s.name} size="md" />
                </div>
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

// ─── Profile Tab ──────────────────────────────────────────────────────────────

function ProfileTab() {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="relative px-4 pt-8 pb-6 text-center overflow-hidden"
        style={{ background: "radial-gradient(ellipse at top, rgba(168,85,247,0.15) 0%, transparent 70%)" }}>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="absolute rounded-full opacity-10"
              style={{
                width: `${30 + i * 20}px`, height: `${30 + i * 20}px`,
                background: "linear-gradient(135deg, #a855f7, #22d3ee)",
                top: `${10 + i * 15}%`, left: `${5 + i * 18}%`,
                animation: `float ${3 + i * 0.5}s ease-in-out infinite`,
                animationDelay: `${i * 0.3}s`,
              }} />
          ))}
        </div>
        <div className="relative z-10">
          <div className="flex justify-center mb-4">
            <div className="p-0.5 rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 hover:shadow-[0_0_30px_rgba(168,85,247,0.6)] transition-all">
              <div className="p-0.5 rounded-full bg-background">
                <Avatar name={CURRENT_USER.name} size="xl" />
              </div>
            </div>
          </div>
          <h2 className="text-2xl font-golos font-black text-foreground mb-1">{CURRENT_USER.name}</h2>
          <p className="text-muted-foreground text-sm mb-2">{CURRENT_USER.bio}</p>
          <div className="flex items-center justify-center gap-1.5">
            <div className="w-2 h-2 rounded-full status-online" />
            <span className="text-xs text-green-400">В сети</span>
          </div>
        </div>
      </div>

      <div className="px-4 mb-4">
        <div className="glass rounded-3xl p-4 grid grid-cols-3 gap-4">
          {[{ label: "Чатов", value: CHATS.length }, { label: "Контактов", value: CONTACTS.length }, { label: "Статусов", value: STATUSES.length }].map(s => (
            <div key={s.label} className="text-center">
              <div className="text-2xl font-golos font-black text-gradient">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 space-y-3 pb-6">
        {[
          { icon: "Phone", label: "Телефон", value: CURRENT_USER.phone! },
          { icon: "AtSign", label: "Имя пользователя", value: "@aleksey_petrov" },
          { icon: "MapPin", label: "Местоположение", value: "Москва, Россия" },
        ].map(item => (
          <div key={item.label} className="glass rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
              <Icon name={item.icon} size={16} className="text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground">{item.label}</div>
              <div className="text-sm font-medium text-foreground truncate">{item.value}</div>
            </div>
            <button className="p-2 hover:bg-white/10 rounded-full transition-colors flex-shrink-0">
              <Icon name="Edit2" size={14} className="text-muted-foreground" />
            </button>
          </div>
        ))}
        <button className="w-full glass rounded-2xl p-4 flex items-center gap-3 hover:bg-white/5 transition-all">
          <div className="w-10 h-10 rounded-xl bg-pink-500/15 border border-pink-500/20 flex items-center justify-center flex-shrink-0">
            <Icon name="Camera" size={16} className="text-pink-400" />
          </div>
          <span className="text-sm font-medium text-foreground">Изменить фото профиля</span>
          <Icon name="ChevronRight" size={16} className="text-muted-foreground ml-auto" />
        </button>
      </div>
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

function SettingsTab() {
  const [notifications, setNotifications] = useState(true);
  const [readReceipts, setReadReceipts] = useState(true);
  const [sounds, setSounds] = useState(true);
  const [vibration, setVibration] = useState(false);
  const [lastSeen, setLastSeen] = useState(true);
  const [darkMode, setDarkMode] = useState(true);

  const sections = [
    {
      title: "Уведомления",
      items: [
        { icon: "Bell", label: "Push-уведомления", value: notifications, onChange: setNotifications },
        { icon: "Volume2", label: "Звуки сообщений", value: sounds, onChange: setSounds },
        { icon: "Vibrate", label: "Вибрация", value: vibration, onChange: setVibration },
      ],
    },
    {
      title: "Приватность",
      items: [
        { icon: "Eye", label: "Уведомления о прочтении", value: readReceipts, onChange: setReadReceipts },
        { icon: "Clock", label: "Время последней активности", value: lastSeen, onChange: setLastSeen },
      ],
    },
    {
      title: "Оформление",
      items: [
        { icon: "Moon", label: "Тёмная тема", value: darkMode, onChange: setDarkMode },
      ],
    },
  ];

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex-shrink-0 px-4 pt-4 pb-3">
        <h1 className="text-2xl font-golos font-black text-gradient mb-4">Настройки</h1>
      </div>
      <div className="px-4 space-y-4 pb-6">
        {sections.map((section, si) => (
          <div key={section.title} className="animate-fade-in" style={{ animationDelay: `${si * 0.08}s` }}>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 px-1">
              {section.title}
            </div>
            <div className="glass rounded-3xl overflow-hidden">
              {section.items.map((item, ii) => (
                <div key={item.label}
                  className={`flex items-center gap-3 px-4 py-3.5 ${ii < section.items.length - 1 ? "border-b border-white/5" : ""}`}>
                  <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-white/5 flex items-center justify-center flex-shrink-0">
                    <Icon name={item.icon} size={16} className="text-purple-400" />
                  </div>
                  <span className="flex-1 text-sm font-medium text-foreground">{item.label}</span>
                  <button onClick={() => item.onChange(!item.value)}
                    className={`w-11 h-6 rounded-full transition-all duration-300 relative flex-shrink-0 ${item.value
                      ? "bg-gradient-to-r from-violet-500 to-purple-600"
                      : "bg-secondary"}`}>
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-300 ${item.value ? "left-5" : "left-0.5"}`} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="animate-fade-in" style={{ animationDelay: "0.32s" }}>
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 px-1">Аккаунт</div>
          <div className="glass rounded-3xl overflow-hidden">
            {[
              { icon: "Lock", label: "Двухфакторная аутентификация", color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20" },
              { icon: "HardDrive", label: "Управление данными", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
            ].map((item, ii) => (
              <div key={item.label}
                className={`flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-all ${ii === 0 ? "border-b border-white/5" : ""}`}>
                <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 ${item.bg}`}>
                  <Icon name={item.icon} size={16} className={item.color} />
                </div>
                <span className="flex-1 text-sm font-medium text-foreground">{item.label}</span>
                <Icon name="ChevronRight" size={16} className="text-muted-foreground" />
              </div>
            ))}
          </div>
        </div>

        <button className="w-full glass rounded-3xl p-4 flex items-center gap-3 hover:bg-red-500/5 transition-all animate-fade-in"
          style={{ animationDelay: "0.4s" }}>
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
  const [tab, setTab] = useState<Tab>("chats");
  const unreadCount = CHATS.reduce((acc, c) => acc + c.unread, 0);

  const tabs: Record<Tab, React.ReactNode> = {
    chats: <ChatsTab />,
    contacts: <ContactsTab />,
    calls: <CallsTab />,
    status: <StatusTab />,
    profile: <ProfileTab />,
    settings: <SettingsTab />,
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto font-rubik overflow-hidden relative"
      style={{ background: "hsl(var(--background))" }}>

      {/* Ambient background blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden max-w-md mx-auto">
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full opacity-5"
          style={{ background: "radial-gradient(circle, #a855f7, transparent)" }} />
        <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full opacity-5"
          style={{ background: "radial-gradient(circle, #22d3ee, transparent)" }} />
      </div>

      {/* Status bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 pt-2 pb-1 text-xs text-muted-foreground">
        <span className="font-semibold">9:41</span>
        <div className="flex items-center gap-1.5">
          <Icon name="Wifi" size={11} className="text-muted-foreground" />
          <Icon name="Signal" size={11} className="text-muted-foreground" />
          <Icon name="Battery" size={11} className="text-muted-foreground" />
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {tabs[tab]}
      </div>

      <BottomNav active={tab} onChange={setTab} unreadCount={unreadCount} />
    </div>
  );
}
