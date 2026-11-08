"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronRight, Search } from "lucide-react";
import { banks as seedBanks, type LinkedBank } from "@/lib/bank-data";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function ConnectBanks() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState(seedBanks);
  const [selected, setSelected] = useState<LinkedBank | null>(null);
  const [notice, setNotice] = useState("");
  const filtered = items.filter((bank) => bank.name.toLowerCase().includes(query.trim().toLowerCase()));

  function previewConnection() {
    if (!selected) return;
    setItems((previous) => previous.map((bank) => bank.id === selected.id ? { ...bank, connected: true, accounts: 1, lastSync: "just now" } : bank));
    setNotice(`${selected.name} added to this preview.`);
    setSelected(null);
  }

  return (
    <>
      <section className="welcome-band connect-welcome"><div><Link href="/" className="back-link"><ArrowLeft size={15} />Accounts</Link><h1>Linked banks</h1></div><span className="welcome-label">{items.filter((bank) => bank.connected).length} banks linked</span></section>
      <section className="bank-panel connect-panel">
        <div className="connect-intro"><h2>Link a bank</h2><p>See your other accounts in one place.</p></div>
        <label className="bank-search"><Search size={18} /><span className="sr-only">Search banks</span><input type="search" placeholder="Search banks" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {notice && <p className="connection-notice" role="status"><Check size={16} />{notice}</p>}
        <div className="bank-directory">
          {filtered.map((bank) => <button key={bank.id} className="bank-directory-row" onClick={() => setSelected(bank)}><span className="bank-initials" style={{ color: bank.color }}>{bank.short}</span><span className="bank-directory-name">{bank.name}</span>{bank.connected ? <span className="linked-status"><Check size={14} />Linked</span> : <ChevronRight size={17} />}</button>)}
          {filtered.length === 0 && <p className="empty-state">No banks found. Try another name.</p>}
        </div>
      </section>
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="bank-dialog"><DialogHeader><DialogTitle>{selected?.name}</DialogTitle><DialogDescription>{selected?.connected ? `${selected.accounts} account linked · Updated ${selected.lastSync}` : "Demo connection. No sign-in or bank data is required."}</DialogDescription></DialogHeader>{selected?.connected ? <button className="bank-button" onClick={() => setSelected(null)}>Done</button> : <button className="bank-button" onClick={previewConnection}>Preview connection</button>}</DialogContent>
      </Dialog>
    </>
  );
}
