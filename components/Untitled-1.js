// components/ComicPanelCard.jsx
import { motion } from "framer-motion";
import { cn } from "@/lib/utils"; // shadcn/ui utility for className merging

export function ComicPanelCard({
  title,
  children,
  bg = "yellow", // "yellow" | "blue" | "red" | "green"
  className = "",
  ...props
}) {
  // Comic halftone backgrounds (SVG or CSS patterns)
  const bgStyles = {
    yellow: "bg-yellow-100",
    blue: "bg-blue-100",
    red: "bg-red-100",
    green: "bg-green-100",
  };

  return (
    <motion.div
      initial={{ scale: 0.92, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={cn(
        "relative border-4 border-black rounded-2xl shadow-comic p-4 mb-4 overflow-hidden",
        bgStyles[bg],
        className
      )}
      {...props}
    >
      {/* Halftone dots or action lines as background SVG */}
      <div className="absolute inset-0 pointer-events-none opacity-20">
        {/* Example: yellow dots */}
        {bg === "yellow" && (
          <svg width="100%" height="100%">
            <defs>
              <pattern id="dots" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
                <circle cx="4" cy="4" r="2" fill="#ffe600" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#dots)" />
          </svg>
        )}
        {/* Add more SVGs for blue/red/green if desired */}
      </div>
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">💬</span>
          <h4 className="font-comic text-lg font-bold text-black drop-shadow-sm">{title}</h4>
        </div>
        <div className="bg-white border-4 border-black rounded-[2.5rem] px-5 py-4 shadow-comic font-comic text-base text-black relative">
          {children}
          {/* Speech bubble tail */}
          <span className="absolute left-8 -bottom-4 w-8 h-8">
            <svg width="32" height="32" viewBox="0 0 32 32">
              <path d="M0,32 Q16,0 32,32" fill="#fff" stroke="#222" strokeWidth="4" />
            </svg>
          </span>
        </div>
      </div>
    </motion.div>
  );
}