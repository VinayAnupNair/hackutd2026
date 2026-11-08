"use client";

import { useEffect, useRef, useState } from "react";

function format(value: number, prefix: string, decimals: number) {
  return `${prefix}${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function AnimatedNumber({
  value,
  prefix = "",
  decimals = 2,
  className,
  duration = 1400,
}: {
  value: number;
  prefix?: string;
  decimals?: number;
  className?: string;
  duration?: number;
}) {
  const [text, setText] = useState(format(0, prefix, decimals));
  const started = useRef(false);

  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const from = started.current ? Number(text.replace(/[^0-9.-]/g, "")) || 0 : 0;
    started.current = true;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (value - from) * eased;
      setText(format(current, prefix, decimals));
      if (t < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // intentionally re-run when value changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, prefix, decimals, duration]);

  return (
    <span className={className} aria-label={`${prefix}${value}`}>
      {text}
    </span>
  );
}
