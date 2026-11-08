import { ChevronDown } from "lucide-react";
import { accounts, formatCurrency } from "@/lib/bank-data";

const walletAccounts = accounts.filter((account) => account.bank === "PNC" && account.type !== "credit");
const labels: Record<string, string> = { "pnc-spend": "Spend", "pnc-reserve": "Reserve", "pnc-growth": "Growth" };

export function AccountSlider() {
  return (
    <section className="bank-panel wallet-panel" aria-labelledby="wallet-title">
      <div className="panel-title"><h2 id="wallet-title">Virtual Wallet</h2><span>{walletAccounts.length} accounts</span></div>
      {walletAccounts.map((account) => (
        <details className="wallet-account" key={account.id}>
          <summary>
            <div className="account-label"><span>{labels[account.id]} <span className="account-mask">••{account.mask}</span></span><span className="account-meta">{account.type === "investment" ? "Investment account" : account.type === "checking" ? "Checking account" : "Savings account"}</span></div>
            <div className="wallet-balance"><span>{formatCurrency(account.balance)}</span><span className="account-meta">{account.type === "investment" ? "Current value" : "Available balance"}</span></div>
            <ChevronDown size={18} className="detail-chevron" />
          </summary>
          <div className="account-detail"><div><span className="account-meta">Account number</span><span>•••• •••• {account.mask}</span></div><div><span className="account-meta">Account balance</span><span>{formatCurrency(account.balance)}</span></div><a href="#activity" className="text-link">View activity</a></div>
        </details>
      ))}
      <div className="wallet-total"><span>Total balance</span><strong>{formatCurrency(walletAccounts.reduce((sum, account) => sum + account.balance, 0))}</strong></div>
    </section>
  );
}
