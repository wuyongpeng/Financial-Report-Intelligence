'use client';

import React, { useEffect, useRef } from 'react';
import { attachBlobMotion, VOICE_BLOB_PATH } from '@/lib/voice/blob-motion';

export function VoiceBlob({ risk = false }: { risk?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) return attachBlobMotion(ref.current);
  }, []);
  return (
    <svg ref={ref} className="eva-voice-blob" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <path d={VOICE_BLOB_PATH} fill={risk ? '#EF4444' : '#3B82F6'} />
      <g transform="translate(85 75)"><ellipse cx="0" cy="0" rx="4" ry="12" fill="#FFFFFF" /></g>
      <g transform="translate(115 75)"><ellipse cx="0" cy="0" rx="4" ry="12" fill="#FFFFFF" /></g>
    </svg>
  );
}
