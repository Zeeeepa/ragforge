import { auth, signOut } from "@/lib/auth";
import Link from "next/link";
import Image from "next/image";
import { GlitchLink } from "@/components/GlitchText";

type Role = "READ" | "WRITE" | "ADMIN";

interface ExtendedUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: Role;
  username?: string;
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const user = session?.user as ExtendedUser | undefined;
  const canWrite = user?.role === "WRITE" || user?.role === "ADMIN";
  const isAdmin = user?.role === "ADMIN";

  return (
    <div className="min-h-screen flex">
      {/* Sidebar - Cyberpunk style */}
      <aside className="w-64 border-r border-cyan-400/10 bg-slate-950/80 backdrop-blur-md flex flex-col relative">
        {/* Animated top border */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />

        {/* Logo */}
        <div className="p-4 border-b border-cyan-400/10">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center
              group-hover:shadow-[0_0_15px_rgba(0,255,255,0.5)] transition-all duration-300">
              <span className="text-black font-bold text-sm">CD</span>
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent
              group-hover:from-cyan-300 group-hover:to-purple-300 transition-all duration-300">
              Community Docs
            </span>
          </Link>
        </div>

        <nav className="flex-1 p-4">
          <ul className="space-y-1">
            <NavItem href="/chat" icon={<ChatIcon />} label="Chat" accent="cyan" />
            <NavItem href="/search" icon={<SearchIcon />} label="Search" />
            <NavItem href="/browse" icon={<FolderIcon />} label="Browse" />
            {canWrite && (
              <>
                <NavItem href="/upload" icon={<UploadIcon />} label="Upload" accent="cyan" />
                <NavItem href="/my-uploads" icon={<DocumentIcon />} label="My Uploads" />
              </>
            )}
            {isAdmin && (
              <NavItem href="/admin" icon={<SettingsIcon />} label="Admin" accent="magenta" />
            )}
          </ul>
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-cyan-400/10">
          <div className="flex items-center gap-3 mb-3">
            {user?.image && (
              <div className="relative">
                <Image
                  src={user.image}
                  alt={user.username || "User"}
                  width={36}
                  height={36}
                  className="rounded-full border border-cyan-400/30"
                />
                <div className="absolute inset-0 rounded-full border border-cyan-400/0 hover:border-cyan-400/50 transition-all duration-300" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate text-slate-200">{user?.username}</p>
              <p className="text-xs text-cyan-400/70">
                {user?.role === "ADMIN" ? "Admin" : user?.role === "WRITE" ? "Contributor" : "Reader"}
              </p>
            </div>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="w-full px-3 py-2 text-sm text-slate-400 hover:text-cyan-400
                hover:bg-cyan-400/5 rounded-lg transition-all duration-300
                border border-transparent hover:border-cyan-400/20"
            >
              Sign Out
            </button>
          </form>
        </div>

        {/* Subtle scanline effect */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.02]"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,255,0.1) 2px, rgba(0,255,255,0.1) 4px)',
          }}
        />
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto relative">
        {/* Top gradient border */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-cyan-400/20 via-purple-400/20 to-pink-400/20" />
        {children}
      </main>
    </div>
  );
}

// Nav item component with hover effects
function NavItem({
  href,
  icon,
  label,
  accent = "default"
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  accent?: "default" | "cyan" | "magenta";
}) {
  const accentColors = {
    default: "hover:text-cyan-400 hover:border-cyan-400/30",
    cyan: "hover:text-cyan-400 hover:border-cyan-400/30 hover:shadow-[0_0_15px_rgba(0,255,255,0.1)]",
    magenta: "hover:text-pink-400 hover:border-pink-400/30 hover:shadow-[0_0_15px_rgba(255,0,255,0.1)]",
  };

  return (
    <li>
      <Link
        href={href}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg
          text-slate-400 transition-all duration-300
          border border-transparent
          hover:bg-slate-800/50 ${accentColors[accent]}`}
      >
        <span className="opacity-70">{icon}</span>
        <span>{label}</span>
      </Link>
    </li>
  );
}

// Icons with glow effects
function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17,8 12,3 7,8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10,9 9,9 8,9" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
