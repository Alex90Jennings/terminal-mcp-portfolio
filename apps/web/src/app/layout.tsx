import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { kb } from '@/lib/knowledge';
import './globals.css';

const mono = JetBrains_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-jetbrains' });

const { profile } = kb;

export const metadata: Metadata = {
  title: `${profile.name}: ${profile.title}`,
  description: profile.summary[0]?.text ?? `${profile.name}'s interactive portfolio`,
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The on-screen keyboard shrinks the layout instead of covering the prompt.
  interactiveWidget: 'resizes-content',
  themeColor: '#070809',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB" className={mono.variable}>
      <body>{children}</body>
    </html>
  );
}
