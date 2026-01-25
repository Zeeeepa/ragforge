"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

/**
 * OAuth callback page for Google authentication.
 *
 * This page receives the OAuth callback from Supabase after Google auth,
 * processes the session, and redirects back to the main page.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Get the auth code from URL hash or query params
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const queryParams = new URLSearchParams(window.location.search);

        // Check for error in callback
        const errorParam = hashParams.get("error") || queryParams.get("error");
        if (errorParam) {
          const errorDesc = hashParams.get("error_description") || queryParams.get("error_description");
          throw new Error(errorDesc || errorParam);
        }

        // Let Supabase handle the session from the URL
        const { data, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        if (data.session) {
          setStatus("success");
          // Small delay to show success message
          setTimeout(() => {
            router.push("/");
          }, 500);
        } else {
          // Try to exchange code for session
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
            window.location.href
          );

          if (exchangeError) {
            throw exchangeError;
          }

          setStatus("success");
          setTimeout(() => {
            router.push("/");
          }, 500);
        }
      } catch (err) {
        console.error("Auth callback error:", err);
        setError(err instanceof Error ? err.message : "Authentication failed");
        setStatus("error");

        // Redirect to home after showing error
        setTimeout(() => {
          router.push("/");
        }, 3000);
      }
    };

    handleCallback();
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-center p-8">
        {status === "loading" && (
          <>
            <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white text-lg">Connexion en cours...</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-white text-lg">Connecté !</p>
            <p className="text-slate-400 text-sm mt-2">Redirection...</p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-white text-lg">Erreur de connexion</p>
            <p className="text-red-400 text-sm mt-2">{error}</p>
            <p className="text-slate-400 text-sm mt-4">Redirection dans 3s...</p>
          </>
        )}
      </div>
    </div>
  );
}
