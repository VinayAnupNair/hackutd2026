"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="site-header">
      <div className="header-top">
        <Link href="/" className="brand" aria-label="PNC home">
          <svg width="34" height="34" viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="#ed7000"/><path d="M20 8 32 29H8L20 8Z" stroke="white" strokeWidth="2.2" strokeLinejoin="round"/><path d="m20 8 4 14H12m20 7-14-4 6-3m-16 7 10-4 2-17" stroke="white" strokeWidth="1.8" strokeLinejoin="round"/></svg>
          <span>PNC</span><span className="brand-divider" /><span className="brand-product">Virtual Wallet</span>
        </Link>
        <div className="header-tools">
          <Popover>
            <PopoverTrigger asChild><button className="header-icon" aria-label="Notifications"><Bell size={20} strokeWidth={1.7} /></button></PopoverTrigger>
            <PopoverContent align="end" className="bank-popover"><h2>Notifications</h2><p>You’re all caught up.</p></PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild><button className="profile-button" aria-label="Account menu"><span className="avatar">NR</span><span className="profile-name">Nirav</span><ChevronDown size={14} /></button></PopoverTrigger>
            <PopoverContent align="end" className="bank-popover"><h2>Nirav Rohra</h2><p>Preview account</p><Link className="text-link" href="/connect">Manage linked banks</Link></PopoverContent>
          </Popover>
        </div>
      </div>
      <nav className="header-nav" aria-label="Main navigation">
        <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>Accounts</Link>
        <Link href="/connect" aria-current={pathname === "/connect" ? "page" : undefined}>Linked banks</Link>
      </nav>
    </header>
  );
}
