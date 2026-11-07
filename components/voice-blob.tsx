'use client';

import React, { useEffect, useRef } from 'react';
import { attachBlobMotion, VOICE_EYES } from '@/lib/voice/blob-motion';

export function VoiceBlob({ risk = false }: { risk?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) return attachBlobMotion(ref.current);
  }, []);
  return (
    <svg ref={ref} className="eva-voice-blob" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <circle cx="100" cy="100" r="96" fill={risk ? '#EF4444' : '#3C93F0'} />
      {VOICE_EYES.map(({ x, y }, index) => (
        <g key={index} transform={`translate(${x} ${y})`}>
          <g data-voice-eye="">
            <g transform="rotate(-9)">
              <g data-voice-blink="">
                <rect x="-7.5" y="-17.5" width="15" height="35" rx="7.5" fill="#F5F7F9" />
              </g>
            </g>
          </g>
        </g>
      ))}
    </svg>
  );
}
