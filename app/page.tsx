import Link from "next/link";
import { ArrowUpRight, ChevronRight, Link2 } from "lucide-react";
import { AccountSlider } from "@/components/bank/AccountSlider";
import { NetWorthHero } from "@/components/bank/NetWorthHero";
import { SpendingChart } from "@/components/bank/SpendingChart";
import { Transactions } from "@/components/bank/Transactions";
import { accounts, formatCurrency } from "@/lib/bank-data";

export default function DashboardPage() {
  return (
    <>
      <NetWorthHero />
      <div className="dashboard-layout">
        <div className="primary-column">
          <AccountSlider />
          <Transactions />
        </div>
        <aside className="secondary-column" aria-label="Account overview">
          <section className="bank-panel linked-panel">
            <div className="section-heading"><h2>Other accounts</h2><Link href="/connect" className="text-link">Manage</Link></div>
            {accounts.filter((account) => account.bank !== "PNC" || account.type === "credit").map((account) => (
              <details className="external-account" key={account.id}>
                <summary>
                  <div><span className="account-bank">{account.bank}</span><span className="account-meta">{account.name} · {account.mask}</span></div>
                  <div className="external-balance"><span>{formatCurrency(Math.abs(account.balance))}</span><span className="account-meta">{account.type === "credit" ? "Current balance" : "Available balance"}</span></div>
                  <ChevronRight size={15} className="detail-chevron" />
                </summary>
                <div className="external-detail"><span>{account.type === "credit" ? "Credit card" : "External account"} ••{account.mask}</span>{account.type === "credit" ? <a href="#activity" className="text-link">View activity</a> : <Link href="/connect" className="text-link">Manage account</Link>}</div>
              </details>
            ))}
            <Link href="/connect" className="panel-action"><Link2 size={17} />Link another bank<ChevronRight size={16} /></Link>
          </section>
          <SpendingChart />
          <a href="#activity" className="activity-link"><ArrowUpRight size={18} /><span>View account activity</span><ChevronRight size={17} /></a>
        </aside>
      </div>
    </>
  );
}
