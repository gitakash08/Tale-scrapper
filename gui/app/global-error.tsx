"use client";

/**
 * Root error boundary — the last line of defence when even the layout fails to
 * render. Must ship its own <html>/<body>. Inline styles only, since global CSS
 * may not have loaded at this point.
 */
export default function GlobalError({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          display: "grid", minHeight: "100vh", placeItems: "center", margin: 0,
          fontFamily: "system-ui, sans-serif", background: "#0a0a0c", color: "#ededf0",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem", maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ marginTop: "0.5rem", color: "#a1a1aa", fontSize: "0.875rem" }}>
            {error.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "1.25rem", padding: "0.5rem 1rem", borderRadius: "0.5rem",
              background: "#f43f5e", color: "#fff", border: 0, cursor: "pointer",
              fontSize: "0.875rem", fontWeight: 600,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
