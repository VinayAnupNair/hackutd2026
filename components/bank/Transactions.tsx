"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { transactions, formatCurrency } from "@/lib/bank-data";

export function Transactions() {
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState("all");
  const filtered = transactions.filter((tx) => filter === "all" || (filter === "deposits" ? tx.amount > 0 : tx.amount < 0));
  const visible = showAll ? filtered : filtered.slice(0, 5);
  return (
    <section id="activity" className="bank-panel transactions-panel" aria-labelledby="activity-title">
      <div className="section-heading"><h2 id="activity-title">Recent activity</h2><label className="activity-filter"><span className="sr-only">Filter transactions</span><select value={filter} onChange={(event) => { setFilter(event.target.value); setShowAll(false); }}><option value="all">All transactions</option><option value="deposits">Deposits</option><option value="payments">Payments</option></select><ChevronDown size={14} /></label></div>
      <ul className="transaction-list">
        {visible.map((tx) => (
          <li key={tx.id}>
            <div className="transaction-info"><span className="transaction-merchant">{tx.merchant}</span><span className="account-meta">{tx.account}{tx.pending ? " · Pending" : ""}</span></div>
            <div className="transaction-amount"><span className={tx.amount > 0 ? "deposit-amount" : ""}>{tx.amount > 0 ? "+" : "−"}{formatCurrency(Math.abs(tx.amount))}</span><span className="account-meta">{tx.date}</span></div>
          </li>
        ))}
      </ul>
      {filtered.length > 5 && <button className="view-all-button" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>{showAll ? "Show less" : "View all activity"}<ChevronDown size={15} className={showAll ? "rotate-180" : ""} /></button>}
    </section>
  );
}
