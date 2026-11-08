import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/Toast";
import "./globals.scss";

export const metadata: Metadata = {
  title: "Creative Variant Factory — SockLock",
  description: "Turn one source video into three vertical ad variations, and measure the human effort it took.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
