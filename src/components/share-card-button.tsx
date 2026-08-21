import * as React from "react";
import { Button } from "@/components/ui/button";

export interface ShareCardButtonProps {
  cardUrl: string; // relative or absolute URL to the immutable card PNG
  title: string;
  text: string;
  fileName: string;
}

// Wires the Web Share API where it exists, with a plain download-link
// fallback everywhere else (this session's brief, task 7). Three tiers,
// tried in order:
//   1. navigator.share with the image itself attached as a file — what
//      WhatsApp/Instagram-style "share a picture" actually needs; only
//      available where navigator.canShare({ files }) says so.
//   2. navigator.share with just { title, text, url } — still a native
//      share sheet, just without the image attached (some mobile browsers
//      support this half but not file-sharing).
//   3. No Web Share API at all (most desktop browsers): render a plain
//      `<a download>` link to the card image instead of a button.
export function ShareCardButton({ cardUrl, title, text, fileName }: ShareCardButtonProps) {
  const [sharing, setSharing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canUseWebShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function handleShare() {
    setError(null);
    setSharing(true);
    try {
      const absoluteUrl = new URL(cardUrl, window.location.origin).toString();

      if (typeof navigator.canShare === "function") {
        try {
          const response = await fetch(cardUrl);
          const blob = await response.blob();
          const file = new File([blob], fileName, { type: "image/png" });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ title, text, files: [file] });
            return;
          }
        } catch {
          // Fetching/attaching the image failed (e.g. offline) — fall
          // through to the URL-only share below rather than failing
          // silently.
        }
      }

      await navigator.share({ title, text, url: absoluteUrl });
    } catch (err) {
      // AbortError is the user dismissing the native share sheet — not a
      // failure worth surfacing.
      if (err instanceof Error && err.name !== "AbortError") {
        setError("Could not open the share sheet — use the download link instead.");
      }
    } finally {
      setSharing(false);
    }
  }

  if (!canUseWebShare) {
    return (
      <a
        href={cardUrl}
        download={fileName}
        className="text-primary text-sm underline"
      >
        Download share card
      </a>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="outline" size="sm" disabled={sharing} onClick={() => void handleShare()}>
        {sharing ? "Sharing…" : "Share card"}
      </Button>
      {error && (
        <p className="text-destructive text-xs">
          {error}{" "}
          <a href={cardUrl} download={fileName} className="underline">
            Download instead
          </a>
        </p>
      )}
    </div>
  );
}
