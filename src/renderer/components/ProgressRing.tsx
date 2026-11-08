import { clamp } from '../utils';

interface ProgressRingProps {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  subLabel?: string;
}

export default function ProgressRing({ value, size = 76, stroke = 7, label, subLabel }: ProgressRingProps) {
  const safeValue = clamp(value, 0, 100);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - safeValue / 100);

  return (
    <div className="progress-ring" style={{ width: size, height: size }} aria-label={`${Math.round(safeValue)} percent complete`}>
      <svg width={size} height={size}>
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        <circle
          className="ring-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="progress-ring-label">
        <strong>{label ?? `${Math.round(safeValue)}%`}</strong>
        {subLabel && <span>{subLabel}</span>}
      </div>
    </div>
  );
}
