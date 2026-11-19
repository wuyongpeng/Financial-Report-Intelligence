'use client';

import type { ReactNode } from 'react';
import { AccountProvider } from '@/components/account-access';
import { VoiceSessionProvider } from '@/components/voice-session-provider';

export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AccountProvider>
      <VoiceSessionProvider>{children}</VoiceSessionProvider>
    </AccountProvider>
  );
}
