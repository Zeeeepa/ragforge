import { signIn, auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { GlitchHeading } from "@/components/GlitchText";

export default async function LoginPage() {
  const session = await auth();

  if (session) {
    redirect("/search");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 relative">
      {/* Scanlines overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,255,0.1) 2px, rgba(0,255,255,0.1) 4px)',
        }}
      />

      <div className="max-w-md w-full relative">
        {/* Glow effect behind card */}
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 blur-3xl" />

        <div className="relative cyber-card p-8">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center
              shadow-[0_0_30px_rgba(0,255,255,0.3)]">
              <span className="text-black font-bold text-2xl">CD</span>
            </div>
          </div>

          <h1 className="text-3xl font-bold text-center mb-2">
            <GlitchHeading as="span" gradient="from-cyan-400 via-purple-500 to-pink-500">
              Community Docs Hub
            </GlitchHeading>
          </h1>
          <p className="text-slate-400 text-center mb-8">
            Sign in with Discord to access the documentation
          </p>

          <form
            action={async () => {
              "use server";
              await signIn("discord", { redirectTo: "/search" });
            }}
          >
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-3 px-4 py-3.5
                bg-[#5865F2] text-white rounded-lg font-medium
                border border-[#5865F2]
                hover:bg-[#4752C4] hover:border-cyan-400/50
                hover:shadow-[0_0_30px_rgba(88,101,242,0.4)]
                transition-all duration-300"
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
              Sign in with Discord
            </button>
          </form>

          {/* Decorative elements */}
          <div className="mt-8 flex justify-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
              Secure
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              Discord OAuth2
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
