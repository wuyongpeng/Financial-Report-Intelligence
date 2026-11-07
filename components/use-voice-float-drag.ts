'use client';

import { useEffect, useRef } from 'react';
import { attachVoiceFloatDrag } from '@/lib/voice/float-drag';

export function useVoiceFloatDrag(enabled = true) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (enabled && rootRef.current) return attachVoiceFloatDrag(rootRef.current);
  }, [enabled]);
  return rootRef;
}
