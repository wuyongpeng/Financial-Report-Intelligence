'use client';

import type { ReactNode } from 'react';
import { VoiceSessionProvider } from '@/components/voice-session-provider';

export default function AppProviders({ children }: { children: ReactNode }) {
  return <VoiceSessionProvider>{children}</VoiceSessionProvider>;
}
