/**
 * Content-Security-Policy with a per-request nonce (set in src/proxy.ts).
 * Scripts: only Next's own (nonce + strict-dynamic). Styles allow inline
 * attributes (React style={{}} and CodeMirror). Images may come from any
 * https host because templates and inbound mail reference them.
 */
export function buildCsp(nonce: string, opts: { dev?: boolean; supabaseUrl: string }): string {
  const supabase = new URL(opts.supabaseUrl).origin;
  const supabaseWs = supabase.replace(/^https:/, "wss:");
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(opts.dev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", supabase, supabaseWs, ...(opts.dev ? ["ws:"] : [])],
    "frame-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    // Sign-in with Google/Microsoft submits a form that redirects through Supabase to the provider.
    "form-action": [
      "'self'",
      supabase,
      "https://accounts.google.com",
      "https://login.microsoftonline.com",
    ],
    "frame-ancestors": ["'none'"],
  };
  return [
    ...Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`),
    ...(opts.dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
