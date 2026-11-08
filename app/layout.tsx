import type { Metadata } from "next";
import { SiteHeader } from "@/components/bank/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "PNC | Virtual Wallet",
  description: "Your accounts, balances, and recent activity in one place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <SiteHeader />
        <main id="main-content" className="app-main">{children}</main>
        <footer className="app-footer">
          <span>PNC Virtual Wallet</span>
          <span>Sample balances · Preview</span>
        </footer>
      </body>
    </html>
  );
}
