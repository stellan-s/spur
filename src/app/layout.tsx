import type { Metadata } from "next";
import Script from "next/script";

import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spur — Organizational memory for AI",
  description: "Investigate, retain, and query evidence-backed organizational knowledge.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script
          id="spur-theme"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `try{const saved=localStorage.getItem("spur-theme");const preference=saved==="light"||saved==="dark"||saved==="system"?saved:"system";const dark=preference==="dark"||(preference==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark);document.documentElement.style.colorScheme=dark?"dark":"light"}catch{}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
