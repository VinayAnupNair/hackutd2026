"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { performance, netWorth, formatCurrency } from "@/lib/bank-data";

export function SpendingChart() {
  return (
    <section className="bank-panel balance-panel" aria-labelledby="net-worth-title">
      <h2 id="net-worth-title">Net worth</h2>
      <p className="net-worth-value">{formatCurrency(netWorth.total)}</p>
      <p className="balance-change">+{formatCurrency(netWorth.changeAmount)} <span>last 30 days</span></p>
      <div className="balance-chart" role="img" aria-label="Net worth rose from $214,200 in September to $248,642 in March.">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={performance} margin={{ top: 14, right: 12, left: 12, bottom: 0 }}>
            <XAxis dataKey="month" axisLine={false} tickLine={false} interval={2} tick={{ fill: "#6b7177", fontSize: 11 }} dy={7} />
            <YAxis hide domain={["dataMin - 10000", "dataMax + 5000"]} />
            <Tooltip contentStyle={{ borderRadius: 4, border: "1px solid #dce1e5", fontSize: 12, boxShadow: "none" }} formatter={(value: number) => [formatCurrency(value), "Net worth"]} />
            <Area type="monotone" dataKey="value" stroke="#1767a6" strokeWidth={2} fill="#edf4fa" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
