import { useState } from 'react';
import { Dumbbell } from 'lucide-react';

interface ResilientImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackLabel?: string;
}

export function ResilientImage({ src, alt, className = '', fallbackLabel }: ResilientImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#16191D] to-[#0C0E10] text-zinc-400 select-none ${className}`}
        role="img"
        aria-label={alt}
      >
        <Dumbbell className="w-7 h-7 text-[#A3E635]/70 mb-1.5" />
        {fallbackLabel && (
          <span className="text-xs font-medium tracking-wide text-zinc-400 px-3 text-center truncate max-w-full">
            {fallbackLabel}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
