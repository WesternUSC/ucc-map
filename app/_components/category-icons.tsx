"use client";

import React, { useId } from "react";
import { Droplets, UtensilsCrossed, BookOpen, Wrench, ArrowUpDown } from "lucide-react";

type IconProps = {
  active?: boolean;
  className?: string;
};

export type CategoryShortcut = {
  id: "service" | "elevator" | "classroom" | "food" | "bathroom";
  label: string;
  Icon: React.FC<IconProps>;
};

type GradientStops = {
  default: [string, string, string];
  active: [string, string, string];
};

const iconBaseClass = "h-14 w-14 drop-shadow-[0_6px_12px_rgba(17,24,39,0.25)]";

const createIcon = (
  gradient: GradientStops,
  LucideIcon: React.FC<any>,
  displayName: string,
): React.FC<IconProps> => {
  const IconComponent: React.FC<IconProps> = ({ active, className }) => {
    const gradientId = useId();
    const [from, via, to] = active ? gradient.active : gradient.default;

    return (
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <svg
            viewBox="0 0 64 64"
            role="img"
            aria-hidden="true"
            className={[iconBaseClass, className].filter(Boolean).join(" ")}
          >
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={from} />
                <stop offset="50%" stopColor={via} />
                <stop offset="100%" stopColor={to} />
              </linearGradient>
            </defs>
            <circle cx={32} cy={32} r={28} fill={`url(#${gradientId})`} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <LucideIcon className="w-6 h-6 text-white" strokeWidth={2} />
          </div>
        </div>
      </div>
    );
  };

  IconComponent.displayName = displayName;
  return IconComponent;
};

const RestroomIcon = createIcon(
  {
    default: ["#93c5fd", "#3b82f6", "#1e3a8a"],
    active: ["#60a5fa", "#2563eb", "#1e40af"],
  },
  Droplets,
  "RestroomShortcutIcon",
);

const FoodIcon = createIcon(
  {
    default: ["#fb923c", "#ea580c", "#b91c1c"],
    active: ["#f97316", "#dc2626", "#991b1b"],
  },
  UtensilsCrossed,
  "FoodShortcutIcon",
);

const ClassroomIcon = createIcon(
  {
    default: ["#c084fc", "#9333ea", "#4338ca"],
    active: ["#a855f7", "#7c3aed", "#3730a3"],
  },
  BookOpen,
  "ClassroomShortcutIcon",
);

const ServiceIcon = createIcon(
  {
    default: ["#4ade80", "#16a34a", "#065f46"],
    active: ["#22c55e", "#15803d", "#064e3b"],
  },
  Wrench,
  "ServiceShortcutIcon",
);

const ElevatorIcon = createIcon(
  {
    default: ["#94a3b8", "#475569", "#1f2937"],
    active: ["#64748b", "#334155", "#111827"],
  },
  ArrowUpDown,
  "ElevatorShortcutIcon",
);

export const CATEGORY_SHORTCUTS: readonly CategoryShortcut[] = [
  { id: "bathroom", label: "Bathrooms", Icon: RestroomIcon },
  { id: "food", label: "Food", Icon: FoodIcon },
  { id: "classroom", label: "Classrooms", Icon: ClassroomIcon },
  { id: "service", label: "Services", Icon: ServiceIcon },
  { id: "elevator", label: "Elevators", Icon: ElevatorIcon },
];