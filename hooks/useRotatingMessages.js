import { useState, useEffect } from 'react';

/**
 * Rotates through a messages array at a fixed interval while active.
 * Resets to index 0 when isActive becomes false.
 *
 * @param {string[]} messages  - Array of message strings to cycle through.
 * @param {number}   intervalMs - Milliseconds between rotations.
 * @param {boolean}  isActive  - Rotation only runs while this is true.
 * @returns {string} The current message string.
 */
export function useRotatingMessages(messages, intervalMs, isActive) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!isActive) {
      setIdx(0);
      return;
    }
    const id = setInterval(
      () => setIdx(prev => (prev + 1) % messages.length),
      intervalMs
    );
    return () => clearInterval(id);
  }, [isActive, messages.length, intervalMs]);

  return messages[idx] ?? '';
}
