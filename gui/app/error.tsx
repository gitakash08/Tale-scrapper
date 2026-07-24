"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

/**
 * Route-level error boundary. Without this, a transient runtime error (e.g. a
 * dev hot-reload hiccup or a brief DB blip) leaves Next with no error UI and it
 * shows "missing required error components". This catches it and offers a retry.
 */
export default function Error({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="grid min-h-screen place-items-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
          <AlertTriangle className="size-6" />
        </div>
        <h1 className="font-display text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message || "An unexpected error occurred. This is usually temporary."}
        </p>
        <button
          onClick={reset}
          className="tap-press mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          <RotateCw className="size-4" /> Try again
        </button>
      </div>
    </div>
  );
}
