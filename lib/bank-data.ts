export type Account = {
  id: string;
  name: string;
  type: "checking" | "savings" | "credit" | "investment" | "external";
  bank: string;
  mask: string;
  balance: number;
  change30d: number;
  color: string;
};

export type Transaction = {
  id: string;
  merchant: string;
  category: string;
  amount: number;
  date: string;
  account: string;
  pending?: boolean;
};

export type LinkedBank = {
  id: string;
  name: string;
  short: string;
  color: string;
  accent: string;
  connected: boolean;
  accounts: number;
  lastSync?: string;
};

export const netWorth = {
  total: 248_642.18,
  cash: 18_420.55,
  investments: 196_881.4,
  credit: -4_210.77,
  change30d: 4.82,
  changeAmount: 11_428.6,
};

export const accounts: Account[] = [
  {
    id: "pnc-spend",
    name: "Virtual Wallet Spend",
    type: "checking",
    bank: "PNC",
    mask: "4821",
    balance: 4_812.44,
    change30d: 2.1,
    color: "#F47920",
  },
  {
    id: "pnc-reserve",
    name: "Virtual Wallet Reserve",
    type: "savings",
    bank: "PNC",
    mask: "0193",
    balance: 12_408.11,
    change30d: 0.8,
    color: "#E85D04",
  },
  {
    id: "pnc-growth",
    name: "Growth / Investment",
    type: "investment",
    bank: "PNC",
    mask: "7740",
    balance: 168_240.18,
    change30d: 5.4,
    color: "#1B3A4B",
  },
  {
    id: "chase-checking",
    name: "Total Checking",
    type: "external",
    bank: "Chase",
    mask: "2290",
    balance: 1_200.0,
    change30d: -1.2,
    color: "#117ACA",
  },
  {
    id: "bofa-sav",
    name: "Advantage Savings",
    type: "external",
    bank: "Bank of America",
    mask: "6612",
    balance: 3_840.55,
    change30d: 0.4,
    color: "#E31837",
  },
  {
    id: "pnc-credit",
    name: "Cash Rewards Visa",
    type: "credit",
    bank: "PNC",
    mask: "9033",
    balance: -4_210.77,
    change30d: -3.1,
    color: "#0B1F33",
  },
];

export const transactions: Transaction[] = [
  {
    id: "t1",
    merchant: "Whole Foods Market",
    category: "Groceries",
    amount: -86.42,
    date: "Today",
    account: "Spend · 4821",
  },
  {
    id: "t2",
    merchant: "Payroll · Meridian Labs",
    category: "Income",
    amount: 4_250.0,
    date: "Yesterday",
    account: "Spend · 4821",
  },
  {
    id: "t3",
    merchant: "Shell Gas",
    category: "Transport",
    amount: -54.18,
    date: "Yesterday",
    account: "Spend · 4821",
  },
  {
    id: "t4",
    merchant: "Auto transfer to Reserve",
    category: "Transfer",
    amount: -500.0,
    date: "Nov 5",
    account: "Spend → Reserve",
  },
  {
    id: "t5",
    merchant: "Apple.com",
    category: "Shopping",
    amount: -12.99,
    date: "Nov 4",
    account: "Cash Rewards · 9033",
    pending: true,
  },
  {
    id: "t6",
    merchant: "Dividend · Vanguard ETF",
    category: "Investments",
    amount: 218.4,
    date: "Nov 3",
    account: "Growth · 7740",
  },
  {
    id: "t7",
    merchant: "Uber Eats",
    category: "Dining",
    amount: -31.2,
    date: "Nov 2",
    account: "Spend · 4821",
  },
  {
    id: "t8",
    merchant: "Chase credit payment",
    category: "Payment",
    amount: -420.0,
    date: "Oct 31",
    account: "Chase · 2290",
  },
];

export const performance = [
  { month: "May", value: 214_200 },
  { month: "Jun", value: 218_940 },
  { month: "Jul", value: 221_100 },
  { month: "Aug", value: 226_880 },
  { month: "Sep", value: 231_450 },
  { month: "Oct", value: 237_210 },
  { month: "Nov", value: 248_642 },
];

/** Dashboard “as of” date — Saturday, Nov 7, 2026 */
export const asOfDate = "2026-11-07";
export const asOfLabel = "Nov 7, 2026";

export const banks: LinkedBank[] = [
  {
    id: "chase",
    name: "Chase",
    short: "CH",
    color: "#117ACA",
    accent: "#0B4F8A",
    connected: true,
    accounts: 1,
    lastSync: "2m ago",
  },
  {
    id: "bofa",
    name: "Bank of America",
    short: "BA",
    color: "#E31837",
    accent: "#9B1024",
    connected: true,
    accounts: 1,
    lastSync: "12m ago",
  },
  {
    id: "wells",
    name: "Wells Fargo",
    short: "WF",
    color: "#D71E28",
    accent: "#8B1218",
    connected: false,
    accounts: 0,
  },
  {
    id: "citi",
    name: "Citi",
    short: "CI",
    color: "#003B70",
    accent: "#002647",
    connected: false,
    accounts: 0,
  },
  {
    id: "capitalone",
    name: "Capital One",
    short: "CO",
    color: "#D03027",
    accent: "#8E1E18",
    connected: false,
    accounts: 0,
  },
  {
    id: "usbank",
    name: "U.S. Bank",
    short: "US",
    color: "#0C2074",
    accent: "#08154A",
    connected: false,
    accounts: 0,
  },
  {
    id: "amex",
    name: "American Express",
    short: "AX",
    color: "#006FCF",
    accent: "#004A8A",
    connected: false,
    accounts: 0,
  },
  {
    id: "schwab",
    name: "Charles Schwab",
    short: "CS",
    color: "#00A0DF",
    accent: "#0077A8",
    connected: false,
    accounts: 0,
  },
  {
    id: "fidelity",
    name: "Fidelity",
    short: "FD",
    color: "#4A8C2A",
    accent: "#2F5C18",
    connected: false,
    accounts: 0,
  },
  {
    id: "ally",
    name: "Ally",
    short: "AL",
    color: "#770457",
    accent: "#4D0238",
    connected: false,
    accounts: 0,
  },
  {
    id: "sofi",
    name: "SoFi",
    short: "SF",
    color: "#00A3E0",
    accent: "#0077A3",
    connected: false,
    accounts: 0,
  },
  {
    id: "td",
    name: "TD Bank",
    short: "TD",
    color: "#34A853",
    accent: "#1F6B34",
    connected: false,
    accounts: 0,
  },
];

export function formatCurrency(value: number, compact = false) {
  if (compact && Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}
