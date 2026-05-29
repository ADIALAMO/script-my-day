import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Clock, WifiOff } from 'lucide-react';
import { isQuotaError, isRetryableError } from '../lib/messages.js';

/**
 * Unified error display component.
 *
 * Props:
 *   code        — CODES key from lib/messages.js (drives icon + color + CTA visibility)
 *   message     — The already-translated display string
 *   onRetry     — Optional callback; shown only for retryable errors
 *   lang        — 'he' | 'en'
 */
export default function ErrorMessage({ code, message, onRetry, lang = 'en' }) {
  if (!message) return null;

  const isHebrew = lang === 'he';
  const isQuota = isQuotaError(code);
  const isRetryable = isRetryableError(code);

  const Icon = isQuota ? Clock : WifiOff;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={`rounded-2xl border flex flex-col items-center gap-3 px-6 py-5 text-center ${
        isQuota
          ? 'bg-[#d4a373]/8 border-[#d4a373]/20'
          : 'bg-red-500/10 border-red-500/20'
      }`}
      dir={isHebrew ? 'rtl' : 'ltr'}
    >
      <div className={`flex items-center gap-2 text-sm font-bold ${isQuota ? 'text-[#d4a373]/80' : 'text-red-400'}`}>
        <Icon size={16} className="shrink-0" />
        <span>{message}</span>
      </div>

      {isRetryable && onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 px-5 py-1.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/60 hover:text-white hover:border-white/25 transition-all duration-200"
        >
          {isHebrew ? '↺ נסה שוב' : '↺ TRY AGAIN'}
        </button>
      )}
    </motion.div>
  );
}
